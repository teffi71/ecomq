// mqtt-live.test.js — EcoMQ addition. Tests only createSourceTracker(), the pure part of
// mqtt-live.js; the rest of that file is browser-only (mqtt.js, window, console.js hooks)
// and is guarded so requiring it here never opens a connection or touches the DOM.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createSourceTracker } = require('../skins/EcowittConsoleEmulator/js/mqtt-live.js');

function clock(startSeconds) {
  let t = startSeconds;
  return { now: () => t, advance: (s) => { t += s; } };
}

test('fresh immediately after touch()', () => {
  const c = clock(1000);
  const tracker = createSourceTracker({ staleSeconds: 30, now: c.now });
  tracker.touch();
  assert.strictEqual(tracker.isFresh(), true);
  assert.strictEqual(tracker.ageSeconds(), 0);
});

test('never touched: not fresh, infinite age', () => {
  const tracker = createSourceTracker({ staleSeconds: 30, now: () => 1000 });
  assert.strictEqual(tracker.isFresh(), false);
  assert.strictEqual(tracker.ageSeconds(), Infinity);
});

test('goes stale exactly at the staleSeconds boundary', () => {
  const c = clock(1000);
  const tracker = createSourceTracker({ staleSeconds: 30, now: c.now });
  tracker.touch();
  c.advance(29);
  assert.strictEqual(tracker.isFresh(), true, 'still fresh one second before the boundary');
  c.advance(1); // age is now exactly 30
  assert.strictEqual(tracker.isFresh(), false, 'age === staleSeconds counts as stale');
  assert.strictEqual(tracker.ageSeconds(), 30);
});

test('touch() resets the age even after going stale', () => {
  const c = clock(1000);
  const tracker = createSourceTracker({ staleSeconds: 10, now: c.now });
  tracker.touch();
  c.advance(20);
  assert.strictEqual(tracker.isFresh(), false);
  tracker.touch();
  assert.strictEqual(tracker.isFresh(), true);
  assert.strictEqual(tracker.ageSeconds(), 0);
});

test('default staleSeconds is 30 when not given', () => {
  const c = clock(1000);
  const tracker = createSourceTracker({ now: c.now });
  tracker.touch();
  c.advance(29);
  assert.strictEqual(tracker.isFresh(), true);
  c.advance(2);
  assert.strictEqual(tracker.isFresh(), false);
});
