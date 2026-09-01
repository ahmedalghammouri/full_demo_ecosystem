import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectEdge, EdgeCounter } from './rising-edge-counter';

test('rising edge: numeric 0->1 counts once', () => {
  assert.equal(detectEdge(0, 1, 'RISING'), 1);
});

test('rising edge: boolean false->true counts once', () => {
  assert.equal(detectEdge(false, true, 'RISING'), 1);
});

test('rising edge: no change does not count', () => {
  assert.equal(detectEdge(1, 1, 'RISING'), 0);
  assert.equal(detectEdge(0, 0, 'RISING'), 0);
});

test('rising edge: high->low does not count', () => {
  assert.equal(detectEdge(1, 0, 'RISING'), 0);
});

test('first observation (null baseline) never counts — restart safe', () => {
  assert.equal(detectEdge(null, 1, 'RISING'), 0);
  assert.equal(detectEdge(undefined, 1, 'RISING'), 0);
});

test('falling and change edge types', () => {
  assert.equal(detectEdge(1, 0, 'FALLING'), 1);
  assert.equal(detectEdge(0, 1, 'FALLING'), 0);
  assert.equal(detectEdge(0, 1, 'CHANGE'), 1);
  assert.equal(detectEdge(1, 0, 'CHANGE'), 1);
  assert.equal(detectEdge(1, 1, 'CHANGE'), 0);
});

test('EdgeCounter accumulates pulses, ignores baseline', () => {
  const c = new EdgeCounter('RISING'); // seed null
  let total = 0;
  for (const v of [0, 1, 0, 1, 1, 0, 1]) total += c.update(v);
  // pulses: 0->1, 0->1, 0->1 = 3 (baseline 0 doesn't count)
  assert.equal(total, 3);
});

test('EdgeCounter seeded from persisted value does not double-count after restart', () => {
  // Before restart last raw was 1 (high). After restart we see 1 again → no edge.
  const c = new EdgeCounter('RISING', 0, 1);
  assert.equal(c.update(1), 0);
  assert.equal(c.update(0), 0);
  assert.equal(c.update(1), 1); // genuine new pulse
});

test('EdgeCounter debounce suppresses fast bounce', () => {
  const c = new EdgeCounter('RISING', 100, 0);
  assert.equal(c.update(1, 1000), 1);
  assert.equal(c.update(0, 1010), 0);
  assert.equal(c.update(1, 1050), 0); // within 100ms debounce → suppressed
  assert.equal(c.update(0, 1060), 0);
  assert.equal(c.update(1, 1200), 1); // 150ms later → counts
});
