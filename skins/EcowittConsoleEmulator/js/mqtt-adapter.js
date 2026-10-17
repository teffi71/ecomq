/*
 * mqtt-adapter.js — EcoMQ addition to EcowittConsoleEmulator.
 *
 * Converts a WeeWX `mqtt` uploader loop payload (flat JSON, string values, each key
 * usually carrying a unit suffix) into the dashboard's canonical METRICWX field-name
 * model, the same model console.js's live.json path produces. See DESIGN.md section 3
 * for the pipeline and PLAN.md Phase 1 for how the payload was verified.
 *
 * Part of EcoMQ, a fork of weewx-ecowitt_console_emulator (Copyright (c) Ian Millard
 * 2026, GPL-3.0). This file is a new addition written for EcoMQ.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 *
 * `dateTime` -> `written`: matches console.js's own normaliseLive(), which builds
 * `{ written: raw.dateTime || now(), data }` for a flat packet (console.js:1383-1389)
 * and liveFresh()/renderHeader() read `S.live.written` (console.js:227-230, 465-470).
 *
 * Verified field-name remaps below (kept in DEFAULT_FIELD_MAP because each one is
 * backed by an actual live read in console.js, not just a guess):
 *   pm2_55      -> pm2_5              PMChannels default ('pm2_5','WH45','wh45'),
 *                                     ecowitt_console_emulator.py:318-319; read live via
 *                                     availList(a.aq.pm) -> pick(e.field,...), which is
 *                                     lv(field) while fresh: console.js:238, 698.
 *   wh65_batt   -> outTempBatteryStatus
 *   wh45_batt   -> co2_Batt
 *   wh57_batt   -> lightning_Batt
 *   wh51_chN_batt -> soilMoistBattN   all four from the sensor battery-field tuples in
 *                                     _default_sensors(), ecowitt_console_emulator.py:
 *                                     144-163; read live via lv(s.batt) in lowSensors()/
 *                                     sigFor(), console.js:406-413.
 *
 * Deliberately NOT remapped, pass through under their own (suffix-stripped) name:
 *   lightning_last_det_time  Python's fm['lightning_time'] -> 'lightning_disturber_count'
 *                            (ecowitt_console_emulator.py:117) is read live at
 *                            console.js:581 via pick(fm.lightning_time, ...), but that is
 *                            only confirmed for the archive-fed case (cur_raw/agg queries,
 *                            ecowitt_console_emulator.py:553-568); whether the MQTT loop
 *                            payload's instantaneous value lands under that same key when
 *                            a strike actually happens is unverified (PLAN.md Phase 1 open
 *                            point). Dashboard lightning fields actually read: lightning_dist
 *                            (distance), lightningcount / lightning_strike_count (counts),
 *                            lightning_time (last-detection time, via the field above).
 *   co2_24h_avg, pm2_55_24h_avg, pm10_0, pm10_0_24h_avg, altimeter, relbarometer,
 *   cloudbase, daySunshine_time, heap_free, maxSolarRad, uvradiation, luminosity,
 *   rain24, stormRain, daymaxwind                 no console.js read found for any of
 *                                                  these; not consumed live today.
 * extraTemp17 / extraHumid17 are intentionally NOT remapped either: the skin's default
 * channel list only goes up to CH8 (_default_channels(), ecowitt_console_emulator.py:
 * 132-133), so channel 17 isn't representable without a custom [[Channels]] entry.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ECCE_MQTT_ADAPTER = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Unit suffix -> conversion to METRICWX. Longest suffix wins when more than one
  // could match the end of a key (e.g. "_mm" vs "_mm_per_hour"). Suffixes already
  // in METRICWX (mbar==hPa, mm, m/s-via-kph target, etc.) convert as identity.
  var SUFFIX_CONVERT = {
    '_C': function (v) { return v; },
    '_F': function (v) { return (v - 32) * 5 / 9; },
    '_kph': function (v) { return v / 3.6; },
    '_mph': function (v) { return v * 0.44704; },
    '_mile_per_hour': function (v) { return v * 0.44704; },
    '_mm': function (v) { return v; },
    '_mm_per_hour': function (v) { return v; },
    '_inch': function (v) { return v * 25.4; },
    '_inch_per_hour': function (v) { return v * 25.4; },
    '_hPa': function (v) { return v; },
    '_mbar': function (v) { return v; },
    '_inHg': function (v) { return v * 33.8639; },
    '_percent': function (v) { return v; },
    '_degree_compass': function (v) { return v; },
    '_count': function (v) { return v; },
    '_centibar': function (v) { return v; },
    '_meter': function (v) { return v; },
    '_ppm': function (v) { return v; },
    '_minute': function (v) { return v; },
    '_Wpm2': function (v) { return v; },
    '_lux': function (v) { return v; },
    '_volt': function (v) { return v; },
    '_byte': function (v) { return v; },
    '_microgram_per_cubicmeter': function (v) { return v; },
    '_microgram_per_meter_cubed': function (v) { return v; }
  };
  var SUFFIXES_BY_LENGTH_DESC = Object.keys(SUFFIX_CONVERT).sort(function (a, b) { return b.length - a.length; });

  function findSuffix(key) {
    for (var i = 0; i < SUFFIXES_BY_LENGTH_DESC.length; i++) {
      var s = SUFFIXES_BY_LENGTH_DESC[i];
      if (key.length > s.length && key.slice(key.length - s.length) === s) return s;
    }
    return null;
  }

  // Keys the uploader sends with no unit suffix at all; not a mapping gap, so these
  // are never added to getUnmapped().
  var KNOWN_UNSUFFIXED = ['inHumidity', 'outHumidity', 'UV', 'pm10_0_24h_avg', 'lightning_last_det_time'];
  function isKnownUnsuffixed(base) {
    return KNOWN_UNSUFFIXED.indexOf(base) !== -1 || /^extraHumid\d+$/.test(base);
  }

  // See the file header for the citation behind each of these.
  var DEFAULT_FIELD_MAP = {
    'pm2_55': 'pm2_5',
    'wh65_batt': 'outTempBatteryStatus',
    'wh45_batt': 'co2_Batt',
    'wh57_batt': 'lightning_Batt'
  };
  for (var _i = 1; _i <= 17; _i++) { DEFAULT_FIELD_MAP['wh51_ch' + _i + '_batt'] = 'soilMoistBatt' + _i; }

  function parseNumber(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isNaN(n) ? null : n;
  }

  function createAdapter(options) {
    options = options || {};
    var fieldMap = {};
    Object.keys(DEFAULT_FIELD_MAP).forEach(function (k) { fieldMap[k] = DEFAULT_FIELD_MAP[k]; });
    Object.keys(options.fieldMap || {}).forEach(function (k) { fieldMap[k] = options.fieldMap[k]; });

    var model = {};
    var unmapped = [];

    function applyField(key, rawVal) {
      // usUnits must never drive a conversion decision (DESIGN.md section 2: the
      // uploader overrides some fields, e.g. rain, regardless of its nominal value).
      if (key === 'usUnits') return;
      if (key === 'dateTime') {
        var ts = parseNumber(rawVal);
        if (ts !== null) model.written = Math.round(ts);
        return;
      }
      var suffix = findSuffix(key);
      var base = suffix ? key.slice(0, key.length - suffix.length) : key;
      var num = parseNumber(rawVal);
      if (num === null) return; // skip NaN / empty values; keep whatever we already have
      if (!suffix && !isKnownUnsuffixed(base) && unmapped.indexOf(key) === -1) unmapped.push(key);
      var value = suffix ? SUFFIX_CONVERT[suffix](num) : num;
      model[fieldMap[base] || base] = value;
    }

    function ingest(input) {
      var raw = typeof input === 'string' ? JSON.parse(input) : input;
      if (!raw || typeof raw !== 'object') return model;
      Object.keys(raw).forEach(function (key) { applyField(key, raw[key]); });
      return model;
    }

    function reset() { model = {}; unmapped = []; }
    function getUnmapped() { return unmapped.slice(); }

    return { ingest: ingest, reset: reset, getUnmapped: getUnmapped };
  }

  return { createAdapter: createAdapter };
}));
