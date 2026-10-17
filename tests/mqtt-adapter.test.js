// mqtt-adapter.test.js — EcoMQ addition. Node built-in test runner, no npm deps.
// Run with: node --test tests/
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { createAdapter } = require('../skins/EcowittConsoleEmulator/js/mqtt-adapter.js');

const fixture = fs.readFileSync(path.join(__dirname, 'fixtures', 'loop-sample.json'), 'utf8');

function close(a, b, eps) {
  return Math.abs(a - b) < (eps || 0.001);
}

test('fixture: converts units, keeps mbar and mm, numbers not strings', () => {
  const adapter = createAdapter();
  const model = adapter.ingest(fixture);

  assert.strictEqual(typeof model.daymaxwind, 'number');
  assert.ok(close(model.daymaxwind, 5.1, 0.01), `daymaxwind should be ~5.1 m/s, got ${model.daymaxwind}`);

  assert.strictEqual(typeof model.rain, 'number');
  assert.strictEqual(model.rain, 0);
  assert.strictEqual(model.dayRain, 0);
  assert.ok(close(model.yearRain, 576.8));

  // _mbar is numerically identical to hPa: no conversion applied.
  assert.ok(close(model.barometer, 1031.8293386846349));
  assert.ok(close(model.pressure, 1022.1));

  assert.strictEqual(typeof model.outTemp, 'number');
  assert.ok(close(model.outTemp, 11.599999999999998));

  assert.strictEqual(model.written, 1791998152);
});

test('fixture: pm2_55 typo and sensor battery fields are remapped', () => {
  const adapter = createAdapter();
  const model = adapter.ingest(fixture);

  assert.ok(close(model.pm2_5, 2.0));
  assert.strictEqual(model.pm2_55, undefined);

  assert.ok(close(model.co2_Batt, 6.0));       // wh45_batt -> co2_Batt
  assert.ok(close(model.lightning_Batt, 4.0)); // wh57_batt -> lightning_Batt
  assert.ok(close(model.outTempBatteryStatus, 0.0)); // wh65_batt -> outTempBatteryStatus
  assert.ok(close(model.soilMoistBatt1, 1.2));       // wh51_ch1_batt -> soilMoistBatt1
  assert.ok(close(model.soilMoistBatt4, 1.2));       // wh51_ch4_batt -> soilMoistBatt4
});

test('fixture: lightning timestamp passes through unchanged (not remapped)', () => {
  const adapter = createAdapter();
  const model = adapter.ingest(fixture);

  assert.ok(close(model.lightning_last_det_time, 1789573032.0));
  assert.strictEqual(model.lightning_disturber_count, undefined);
});

test('fixture: getUnmapped() is empty (every key is a known suffix or known bare name)', () => {
  const adapter = createAdapter();
  adapter.ingest(fixture);
  assert.deepStrictEqual(adapter.getUnmapped(), []);
});

test('partial packets merge into last-known state, never replace', () => {
  const adapter = createAdapter();
  adapter.ingest({ dateTime: '1000', outTemp_C: '10', outHumidity: '50' });
  let model = adapter.ingest({ dateTime: '1005', outHumidity: '52' }); // no outTemp this time
  assert.strictEqual(model.outTemp, 10);     // kept from the first packet
  assert.strictEqual(model.outHumidity, 52); // updated
  assert.strictEqual(model.written, 1005);
});

test('NaN and empty-string values are skipped, not written as NaN', () => {
  const adapter = createAdapter();
  adapter.ingest({ outTemp_C: '10' });
  const model = adapter.ingest({ outTemp_C: 'NaN', windSpeed_kph: '' });
  assert.strictEqual(model.outTemp, 10); // unchanged, NaN ignored
  assert.strictEqual('windSpeed' in model, false);
});

test('usUnits is ignored for conversion: _mm stays mm even when usUnits claims US', () => {
  const adapter = createAdapter();
  const model = adapter.ingest({ usUnits: '1', rain_mm: '5' });
  assert.strictEqual(model.rain, 5); // not converted, as if usUnits were absent
  assert.strictEqual('usUnits' in model, false);
});

test('legacy-unit suffixes convert correctly for non-metric setups', () => {
  const adapter = createAdapter();
  const model = adapter.ingest({
    outTemp_F: '32', windSpeed_mph: '10', rain_inch: '1', pressure_inHg: '29.92'
  });
  assert.ok(close(model.outTemp, 0));                 // 32F -> 0C
  assert.ok(close(model.windSpeed, 4.4704));           // 10 mph -> m/s
  assert.ok(close(model.rain, 25.4));                  // 1 inch -> mm
  assert.ok(close(model.pressure, 29.92 * 33.8639, 0.01)); // inHg -> hPa
});

test('an unknown suffix is passed through unchanged and reported via getUnmapped()', () => {
  const adapter = createAdapter();
  const model = adapter.ingest({ someNewField_banana: '42' });
  assert.strictEqual(model.someNewField_banana, 42);
  assert.deepStrictEqual(adapter.getUnmapped(), ['someNewField_banana']);
});

test('reset() clears both the model and the unmapped list', () => {
  const adapter = createAdapter();
  adapter.ingest({ outTemp_C: '10', weirdOne_zz: '1' });
  adapter.reset();
  const model = adapter.ingest({ outHumidity: '50' });
  assert.strictEqual(model.outTemp, undefined);
  assert.deepStrictEqual(adapter.getUnmapped(), []);
});

test('options.fieldMap lets callers override or extend the default name mapping', () => {
  const adapter = createAdapter({ fieldMap: { extraTemp17: 'extraTemp1' } });
  const model = adapter.ingest({ extraTemp17_C: '24.2' });
  assert.ok(close(model.extraTemp1, 24.2));
  assert.strictEqual(model.extraTemp17, undefined);
});
