import type { ModbusDataType, RegisterType } from './types';

/** One register-type range on an EdgeCounter device (start address + how many). */
export interface EdgeCounterRange {
  start: number;
  quantity: number;
}

/** Block layout for an EdgeCounter device — a range per Modbus register type. */
export interface EdgeCounterBlocks {
  discrete?: EdgeCounterRange | null;
  coil?: EdgeCounterRange | null;
  holding?: EdgeCounterRange | null;
  input?: EdgeCounterRange | null;
}

/** Payload for creating one auto-generated EdgeCounter tag (subset of TagDefinition). */
export interface EdgeCounterTagCreate {
  code: string;
  name: string;
  dataType: ModbusDataType;
  tagType: 'COUNTER' | 'MEASUREMENT';
  registerType: RegisterType;
  address: string;
  wordCount: number;
  wordOrder: 'BIG';
  counterRole: 'NONE' | null;
  edgeType: 'RISING' | null;
  mqttPublishMode: 'CHANGE';
  historizationMode: 'CHANGE';
}

interface RangeSpec {
  key: keyof EdgeCounterBlocks;
  registerType: RegisterType;
  /** Short code token, e.g. DI / DO / HR / IR. */
  token: string;
  label: string;
  dataType: ModbusDataType;
  /** Bits become COUNTER tags (the reason EdgeCounter exists); registers are plain measurements. */
  tagType: 'COUNTER' | 'MEASUREMENT';
}

const RANGE_SPECS: RangeSpec[] = [
  { key: 'discrete', registerType: 'DISCRETE', token: 'DI', label: 'Discrete Input', dataType: 'BOOL', tagType: 'COUNTER' },
  { key: 'coil',     registerType: 'COIL',     token: 'DO', label: 'Coil',           dataType: 'BOOL', tagType: 'COUNTER' },
  { key: 'holding',  registerType: 'HOLDING',  token: 'HR', label: 'Holding Reg',    dataType: 'INT',  tagType: 'MEASUREMENT' },
  { key: 'input',    registerType: 'INPUT',    token: 'IR', label: 'Input Reg',      dataType: 'INT',  tagType: 'MEASUREMENT' },
];

/**
 * Expand an EdgeCounter device's block ranges into one tag per address. Digital
 * points (DISCRETE/COIL) become `COUNTER` tags (role `NONE`, rising-edge) ready
 * for the user to assign Total/Good/Bad + a machine; register points become
 * plain `MEASUREMENT` tags. Codes are prefixed with the device code so they're
 * unique (e.g. `IO1_DI0`). A range with quantity ≤ 0 yields no tags.
 */
export function instantiateEdgeCounterTags(deviceCode: string, blocks: EdgeCounterBlocks): EdgeCounterTagCreate[] {
  const out: EdgeCounterTagCreate[] = [];
  for (const spec of RANGE_SPECS) {
    const range = blocks[spec.key];
    if (!range) continue;
    const start = Math.max(0, Math.trunc(Number(range.start) || 0));
    const qty = Math.max(0, Math.trunc(Number(range.quantity) || 0));
    const isBit = spec.dataType === 'BOOL';
    for (let i = 0; i < qty; i++) {
      const address = start + i;
      out.push({
        code: `${deviceCode}_${spec.token}${address}`,
        name: `${spec.label} ${address}`,
        dataType: spec.dataType,
        tagType: spec.tagType,
        registerType: spec.registerType,
        address: String(address),
        wordCount: 1,
        wordOrder: 'BIG',
        counterRole: isBit ? 'NONE' : null,
        edgeType: isBit ? 'RISING' : null,
        mqttPublishMode: 'CHANGE',
        historizationMode: 'CHANGE',
      });
    }
  }
  return out;
}
