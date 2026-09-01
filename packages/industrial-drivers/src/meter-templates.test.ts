import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METER_TEMPLATES, getMeterTemplate, instantiateMeterTags } from './meter-templates';

test('catalog ships the standard meters', () => {
  const keys = METER_TEMPLATES.map((t) => t.key);
  for (const k of ['SCHNEIDER_PM5110', 'SIEMENS_PAC3200', 'SIEMENS_PAC2200', 'GENERIC_PM']) {
    assert.ok(keys.includes(k), `missing template ${k}`);
  }
});

test('PM5110 template has the key roles', () => {
  const t = getMeterTemplate('SCHNEIDER_PM5110')!;
  const roles = new Set(t.tags.map((x) => x.energyRole));
  assert.ok(roles.has('ACTIVE_POWER_TOTAL'));
  assert.ok(roles.has('ENERGY_IMPORT_TOTAL'));
  assert.ok(roles.has('VOLTAGE_L1'));
  // PM5110 energy uses the Float32 kWh registers (2700/2702), not the Int64 Wh counters
  const e = t.tags.find((x) => x.energyRole === 'ENERGY_IMPORT_TOTAL')!;
  assert.equal(e.dataType, 'FLOAT');
  assert.equal(e.wordCount, 2);
  assert.equal(e.address, 2699);
  // instantaneous are float32
  const p = t.tags.find((x) => x.energyRole === 'ACTIVE_POWER_TOTAL')!;
  assert.equal(p.dataType, 'FLOAT');
  assert.equal(p.wordCount, 2);
});

test('instantiateMeterTags prefixes codes with the meter number + sets ENERGY type', () => {
  const tags = instantiateMeterTags('SCHNEIDER_PM5110', 'EM-PM-01');
  assert.ok(tags.length > 5);
  assert.ok(tags.every((t) => t.code.startsWith('EM-PM-01_')));
  assert.ok(tags.every((t) => t.tagType === 'ENERGY'));
  assert.ok(tags.every((t) => !!t.energyRole));
  const p = tags.find((t) => t.energyRole === 'ACTIVE_POWER_TOTAL')!;
  assert.equal(p.code, 'EM-PM-01_P_TOTAL');
  assert.equal(p.unit, 'kW');
});

test('unknown template → empty', () => {
  assert.deepEqual(instantiateMeterTags('NOPE', 'X'), []);
});
