import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instantiateEdgeCounterTags } from './edge-counter';
import { planBlocks } from './block-planner';
import type { TagBinding } from './types';

test('EdgeCounter: 8 discrete inputs → 8 BOOL COUNTER tags', () => {
  const tags = instantiateEdgeCounterTags('IO1', { discrete: { start: 0, quantity: 8 } });
  assert.equal(tags.length, 8);
  assert.equal(tags[0].code, 'IO1_DI0');
  assert.equal(tags[7].code, 'IO1_DI7');
  assert.ok(tags.every((t) => t.dataType === 'BOOL'));
  assert.ok(tags.every((t) => t.tagType === 'COUNTER'));
  assert.ok(tags.every((t) => t.counterRole === 'NONE' && t.edgeType === 'RISING'));
  assert.ok(tags.every((t) => t.registerType === 'DISCRETE'));
  assert.equal(tags[3].address, '3');
});

test('EdgeCounter: mixed blocks with a non-zero start; registers are MEASUREMENT', () => {
  const tags = instantiateEdgeCounterTags('IO2', {
    discrete: { start: 0, quantity: 4 },
    coil: { start: 0, quantity: 2 },
    holding: { start: 10, quantity: 3 },
    input: { start: 0, quantity: 0 }, // qty 0 → no tags
  });
  assert.equal(tags.filter((t) => t.registerType === 'DISCRETE').length, 4);
  assert.equal(tags.filter((t) => t.registerType === 'COIL').length, 2);
  const hr = tags.filter((t) => t.registerType === 'HOLDING');
  assert.equal(hr.length, 3);
  assert.equal(hr[0].address, '10');
  assert.ok(hr.every((t) => t.tagType === 'MEASUREMENT' && t.dataType === 'INT' && t.counterRole === null));
  assert.equal(tags.filter((t) => t.registerType === 'INPUT').length, 0);
});

test('EdgeCounter: empty/absent blocks → no tags', () => {
  assert.deepEqual(instantiateEdgeCounterTags('X', {}), []);
  assert.deepEqual(instantiateEdgeCounterTags('X', { discrete: { start: 0, quantity: 0 } }), []);
});

const bit = (id: string, address: number): TagBinding =>
  ({ id, code: id, address, registerType: 'DISCRETE', dataType: 'BOOL' });
const reg = (id: string, address: number, wordCount = 2): TagBinding =>
  ({ id, code: id, address, registerType: 'HOLDING', dataType: 'FLOAT', wordCount });

test('planBlocks: contiguous discrete inputs coalesce into one read', () => {
  const blocks = planBlocks([bit('a', 0), bit('b', 1), bit('c', 2), bit('d', 3)]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].registerType, 'DISCRETE');
  assert.equal(blocks[0].start, 0);
  assert.equal(blocks[0].count, 4);
  assert.deepEqual(blocks[0].members.map((m) => m.offset), [0, 1, 2, 3]);
});

test('planBlocks: a large gap splits into two reads', () => {
  const blocks = planBlocks([bit('a', 0), bit('b', 1), bit('z', 500)]);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[1].start, 500);
});

test('planBlocks: register offsets/spans account for 2-word floats', () => {
  // Two float32s at 2999 and 3001 are contiguous (each spans 2 registers).
  const blocks = planBlocks([reg('i_a', 2999), reg('i_b', 3001)]);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].start, 2999);
  assert.equal(blocks[0].count, 4);
  const m = blocks[0].members;
  assert.equal(m[0].offset, 0); assert.equal(m[0].span, 2);
  assert.equal(m[1].offset, 2); assert.equal(m[1].span, 2);
});

test('planBlocks: different register types never share a block', () => {
  const blocks = planBlocks([bit('a', 0), reg('r', 0)]);
  assert.equal(blocks.length, 2);
});
