import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyScaling, coerce } from './scaling';

test('applyScaling: identity when no factors', () => {
  assert.equal(applyScaling(123, {}), 123);
});

test('applyScaling: factor + offset', () => {
  assert.equal(applyScaling(100, { scaleFactor: 0.1, offset: 5 }), 15);
});

test('applyScaling: booleans and null pass through', () => {
  assert.equal(applyScaling(true, { scaleFactor: 2 }), true);
  assert.equal(applyScaling(null, { scaleFactor: 2 }), null);
});

test('coerce: BOOL from number/string', () => {
  assert.equal(coerce(0, 'BOOL'), false);
  assert.equal(coerce(1, 'BOOL'), true);
  assert.equal(coerce('1', 'BOOL'), true);
  assert.equal(coerce('false', 'BOOL'), false);
});

test('coerce: INT truncates, FLOAT keeps decimals', () => {
  assert.equal(coerce(3.9, 'INT'), 3);
  assert.equal(coerce(3.5, 'FLOAT'), 3.5);
});

test('coerce: STRING stringifies, null stays null', () => {
  assert.equal(coerce(42, 'STRING'), '42');
  assert.equal(coerce(null, 'FLOAT'), null);
});
