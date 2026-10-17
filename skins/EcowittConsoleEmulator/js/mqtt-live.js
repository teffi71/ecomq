/*
 * mqtt-live.js — EcoMQ addition to EcowittConsoleEmulator.
 *
 * Connects to the WeeWX MQTT uploader's websocket listener, feeds each message through
 * mqtt-adapter.js, and hands the result to console.js's window.ECCE_HOOKS.applyLiveModel().
 * Does nothing at all -- no connection, no console output -- unless mqtt.enabled is true
 * in the page config (see DESIGN.md sections 3-5). Requires skins/EcowittConsoleEmulator/
 * js/vendor/mqtt.min.js (see js/vendor/README) and mqtt-adapter.js to be loaded first.
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
 * createSourceTracker() is kept pure (no DOM, no mqtt.js, an injectable clock) so it can be
 * unit-tested from Node (tests/mqtt-live.test.js) independently of the browser-only code
 * below it, which only runs when `window`/`document` actually exist.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ECCE_MQTT_LIVE = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createSourceTracker(options) {
    options = options || {};
    var staleSeconds = options.staleSeconds || 30;
    var nowFn = options.now || function () { return Date.now() / 1000; };
    var lastSeen = 0;

    function touch() { lastSeen = nowFn(); }
    function ageSeconds() { return lastSeen ? nowFn() - lastSeen : Infinity; }
    function isFresh() { return lastSeen > 0 && ageSeconds() < staleSeconds; }

    return { touch: touch, isFresh: isFresh, ageSeconds: ageSeconds };
  }

  function randomClientId() {
    var hex = '';
    for (var i = 0; i < 8; i++) hex += Math.floor(Math.random() * 16).toString(16);
    return 'ecomq-' + hex;
  }

  function buildUrl(cfg) {
    var proto = cfg.websockets_ssl === false ? 'ws' : 'wss';
    var path = cfg.websockets_path || '/';
    if (path.charAt(0) !== '/') path = '/' + path;
    return proto + '://' + cfg.websockets_host + ':' + (cfg.websockets_port || 9001) + path;
  }

  // console.js sets window.ECCE_HOOKS as soon as its own script runs, but S.cfg (hence
  // isReady()/getConfig()) only exists once init() has processed window.ECCE_INITIAL -- so
  // poll briefly rather than reading the config immediately. Gives up quietly after ~2 min
  // (e.g. console.js failed to load at all): no connection is ever attempted in that case.
  function waitForReady(hooks, onReady, deadline) {
    deadline = deadline || (Date.now() + 120000);
    if (hooks.isReady()) { onReady(); return; }
    if (Date.now() > deadline) { console.debug('EcoMQ: console.js never became ready; not starting mqtt-live'); return; }
    setTimeout(function () { waitForReady(hooks, onReady, deadline); }, 500);
  }

  // Everything below touches window/document/mqtt.js/the adapter, so it never runs under
  // Node (the test file only imports createSourceTracker above).
  function runInBrowser() {
    var hooks = window.ECCE_HOOKS;
    if (!hooks || typeof hooks.getConfig !== 'function' || typeof hooks.isReady !== 'function') return;
    waitForReady(hooks, function () { start(hooks); });
  }

  function start(hooks) {
    var cfg = hooks.getConfig();
    if (!cfg || !cfg.enabled) return; // disabled: no connection attempt, no console output

    if (!cfg.websockets_host) {
      console.warn('EcoMQ: mqtt_enabled is true but mqtt_websockets_host is empty; not connecting.');
      return;
    }
    if (typeof window.mqtt === 'undefined') {
      console.warn('EcoMQ: vendor/mqtt.min.js not found; MQTT live source disabled.');
      return;
    }
    if (typeof window.ECCE_MQTT_ADAPTER === 'undefined') {
      console.warn('EcoMQ: mqtt-adapter.js not loaded; MQTT live source disabled.');
      return;
    }

    var adapter = window.ECCE_MQTT_ADAPTER.createAdapter();
    var tracker = createSourceTracker({ staleSeconds: cfg.stale_seconds || 30 });
    var wasFresh = false;
    // Only holds a model that arrived but hasn't been successfully applied yet (because
    // console.js wasn't ready, or applyLiveModel threw). Cleared on success, so the 5 s
    // watchdog below does NOT keep re-applying the same message forever -- that would make
    // S.mqttLastSeen advance on every tick and a dead feed would look fresh indefinitely.
    var pendingModel = null, pendingAt = 0;

    function flush() {
      if (!pendingModel || !hooks.isReady()) return;
      try {
        hooks.applyLiveModel(pendingModel, 'mqtt', pendingAt);
        pendingModel = null;
      } catch (e) {
        console.warn('EcoMQ: applyLiveModel failed:', e && e.message);
      }
    }

    var options = { clientId: randomClientId(), clean: true, connectTimeout: 10000, reconnectPeriod: 0 };
    if (cfg.username) options.username = cfg.username;
    if (cfg.password) options.password = cfg.password;

    var client;
    try {
      client = window.mqtt.connect(buildUrl(cfg), options);
    } catch (e) {
      console.warn('EcoMQ: could not create the mqtt client:', e && e.message);
      return;
    }

    // Exponential backoff (1s..30s) for reconnects: mqtt.js's own reconnectPeriod is a fixed
    // delay, so it is disabled above (reconnectPeriod: 0) and driven manually here instead.
    var reconnectDelay = 1000;
    var reconnectTimer = null;
    function scheduleReconnect() {
      if (reconnectTimer) return;
      reconnectTimer = setTimeout(function () {
        reconnectTimer = null;
        try { client.reconnect(); } catch (e) { /* will retry again on the next 'close' */ }
      }, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, 30000);
    }

    client.on('connect', function () {
      reconnectDelay = 1000;
      console.debug('EcoMQ: mqtt connected');
      try { client.subscribe(cfg.topic || 'weather/loop', { qos: 0 }); }
      catch (e) { console.warn('EcoMQ: mqtt subscribe failed:', e && e.message); }
    });
    client.on('message', function (topic, payload) {
      try {
        pendingModel = adapter.ingest(payload.toString());
        pendingAt = Date.now() / 1000;
        tracker.touch();
        flush();
      } catch (e) {
        console.warn('EcoMQ: failed to process an mqtt message:', e && e.message);
      }
    });
    client.on('error', function (err) { console.warn('EcoMQ: mqtt error:', err && err.message); });
    client.on('close', function () { console.debug('EcoMQ: mqtt connection closed'); scheduleReconnect(); });
    client.on('offline', function () { console.debug('EcoMQ: mqtt offline'); });
    client.on('reconnect', function () { console.debug('EcoMQ: mqtt reconnecting'); });

    // Replays a model that arrived before console.js was ready (flush() is a no-op once
    // applied) and logs freshness transitions; does NOT drive console.js's own staleness
    // check -- that comes from S.mqttLastSeen, set from pendingAt at the time of apply.
    setInterval(function () {
      flush();
      var fresh = tracker.isFresh();
      if (fresh !== wasFresh) console.debug('EcoMQ: mqtt ' + (fresh ? 'fresh' : 'stale'));
      wasFresh = fresh;
    }, 5000);
  }

  if (typeof window !== 'undefined' && window.document) {
    try { runInBrowser(); } catch (e) { if (window.console) console.warn('EcoMQ: mqtt-live.js failed to start:', e && e.message); }
  }

  return { createSourceTracker: createSourceTracker };
}));
