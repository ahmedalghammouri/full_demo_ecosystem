// Energy/power-meter register-map templates — VENDORED COPY.
//
// The canonical source is packages/industrial-drivers/src/meter-templates.ts, which the
// edge gateway uses to provision + poll meter tags. The API keeps this standalone copy
// because the containerized API build (apps/api/Dockerfile) has a per-app build context
// and can't reach the workspace package. Keep the two in sync when register maps change;
// provisioning is idempotent (factoryId+code) so the gateway won't duplicate what the API
// creates here.

type RegisterType = 'HOLDING' | 'INPUT' | 'COIL' | 'DISCRETE';
type ModbusDataType = 'BOOL' | 'INT' | 'FLOAT' | 'STRING' | 'TIMESTAMP';
type WordOrder = 'BIG' | 'LITTLE';

export type EnergyRole =
  | 'ACTIVE_POWER_TOTAL' | 'REACTIVE_POWER_TOTAL' | 'APPARENT_POWER_TOTAL'
  | 'ENERGY_IMPORT_TOTAL' | 'ENERGY_EXPORT_TOTAL'
  | 'VOLTAGE_L1' | 'VOLTAGE_L2' | 'VOLTAGE_L3' | 'VOLTAGE_AVG' | 'VOLTAGE_LL_AVG'
  | 'CURRENT_L1' | 'CURRENT_L2' | 'CURRENT_L3' | 'CURRENT_AVG'
  | 'ACTIVE_POWER_L1' | 'ACTIVE_POWER_L2' | 'ACTIVE_POWER_L3'
  | 'PF_TOTAL' | 'PF_L1' | 'PF_L2' | 'PF_L3'
  | 'FREQUENCY' | 'THD_V' | 'THD_I';

interface MeterTagSpec {
  key: string;
  name: string;
  energyRole: EnergyRole;
  registerType: RegisterType;
  address: number;
  wordCount: 1 | 2 | 4;
  wordOrder: WordOrder;
  dataType: ModbusDataType;
  unit: string;
  scaleFactor?: number;
}

interface MeterTemplate {
  key: string;
  label: string;
  manufacturer: string;
  models: string[];
  tags: MeterTagSpec[];
}

const F = (key: string, name: string, energyRole: EnergyRole, address: number, unit: string, scaleFactor?: number): MeterTagSpec =>
  ({ key, name, energyRole, registerType: 'HOLDING', address, wordCount: 2, wordOrder: 'BIG', dataType: 'FLOAT', unit, ...(scaleFactor ? { scaleFactor } : {}) });
const I64 = (key: string, name: string, energyRole: EnergyRole, address: number, unit: string, scaleFactor?: number): MeterTagSpec =>
  ({ key, name, energyRole, registerType: 'HOLDING', address, wordCount: 4, wordOrder: 'BIG', dataType: 'INT', unit, ...(scaleFactor ? { scaleFactor } : {}) });

// Schneider PowerLogic PM5110 — all FLOAT32; PF from the simple-float register (not the
// 4-quadrant-encoded 3078–3092) and energy from the Float32 kWh energy registers.
// Addresses are the vendor's documented register numbers − 1 (map is 1-based; modbus-serial
// uses 0-based PDU addresses, so wire address = number − 1). Verified over RS-485 against real
// METSEPM5110 hardware. Keep in sync with packages/industrial-drivers/src/meter-templates.ts.
const SCHNEIDER_PM5110: MeterTemplate = {
  key: 'SCHNEIDER_PM5110',
  label: 'Schneider PowerLogic PM5110',
  manufacturer: 'Schneider Electric',
  models: ['METSEPM5110', 'PM5100'],
  tags: [
    F('I_A', 'Current L1', 'CURRENT_L1', 2999, 'A'),
    F('I_B', 'Current L2', 'CURRENT_L2', 3001, 'A'),
    F('I_C', 'Current L3', 'CURRENT_L3', 3003, 'A'),
    F('I_AVG', 'Current Avg', 'CURRENT_AVG', 3009, 'A'),
    F('V_LL_AVG', 'Voltage L-L Avg', 'VOLTAGE_LL_AVG', 3025, 'V'),
    F('V_AN', 'Voltage L1-N', 'VOLTAGE_L1', 3027, 'V'),
    F('V_BN', 'Voltage L2-N', 'VOLTAGE_L2', 3029, 'V'),
    F('V_CN', 'Voltage L3-N', 'VOLTAGE_L3', 3031, 'V'),
    F('V_LN_AVG', 'Voltage L-N Avg', 'VOLTAGE_AVG', 3035, 'V'),
    F('P_TOTAL', 'Active Power Total', 'ACTIVE_POWER_TOTAL', 3059, 'kW'),
    F('Q_TOTAL', 'Reactive Power Total', 'REACTIVE_POWER_TOTAL', 3067, 'kVAR'),
    F('S_TOTAL', 'Apparent Power Total', 'APPARENT_POWER_TOTAL', 3075, 'kVA'),
    F('PF_TOTAL', 'Power Factor Total', 'PF_TOTAL', 3191, ''),
    F('FREQ', 'Frequency', 'FREQUENCY', 3109, 'Hz'),
    F('E_IMP', 'Active Energy Import', 'ENERGY_IMPORT_TOTAL', 2699, 'kWh'),
    F('E_EXP', 'Active Energy Export', 'ENERGY_EXPORT_TOTAL', 2701, 'kWh'),
  ],
};

const SIEMENS_PAC3200: MeterTemplate = {
  key: 'SIEMENS_PAC3200',
  label: 'Siemens SENTRON PAC3200',
  manufacturer: 'Siemens',
  models: ['7KM2111', 'PAC3200'],
  tags: [
    F('V_AN', 'Voltage L1-N', 'VOLTAGE_L1', 1, 'V'),
    F('V_BN', 'Voltage L2-N', 'VOLTAGE_L2', 3, 'V'),
    F('V_CN', 'Voltage L3-N', 'VOLTAGE_L3', 5, 'V'),
    F('I_A', 'Current L1', 'CURRENT_L1', 13, 'A'),
    F('I_B', 'Current L2', 'CURRENT_L2', 15, 'A'),
    F('I_C', 'Current L3', 'CURRENT_L3', 17, 'A'),
    F('P_A', 'Active Power L1', 'ACTIVE_POWER_L1', 25, 'kW', 0.001),
    F('P_B', 'Active Power L2', 'ACTIVE_POWER_L2', 27, 'kW', 0.001),
    F('P_C', 'Active Power L3', 'ACTIVE_POWER_L3', 29, 'kW', 0.001),
    F('FREQ', 'Frequency', 'FREQUENCY', 55, 'Hz'),
    F('P_TOTAL', 'Active Power Total', 'ACTIVE_POWER_TOTAL', 65, 'kW', 0.001),
    F('Q_TOTAL', 'Reactive Power Total', 'REACTIVE_POWER_TOTAL', 67, 'kVAR', 0.001),
    F('S_TOTAL', 'Apparent Power Total', 'APPARENT_POWER_TOTAL', 63, 'kVA', 0.001),
    F('PF_TOTAL', 'Power Factor Total', 'PF_TOTAL', 69, ''),
    I64('E_IMP', 'Active Energy Import', 'ENERGY_IMPORT_TOTAL', 801, 'kWh'),
  ],
};

const SIEMENS_PAC2200: MeterTemplate = {
  key: 'SIEMENS_PAC2200',
  label: 'Siemens SENTRON PAC2200',
  manufacturer: 'Siemens',
  models: ['7KM2200', 'PAC2200'],
  tags: [
    F('V_AN', 'Voltage L1-N', 'VOLTAGE_L1', 1, 'V'),
    F('V_BN', 'Voltage L2-N', 'VOLTAGE_L2', 3, 'V'),
    F('V_CN', 'Voltage L3-N', 'VOLTAGE_L3', 5, 'V'),
    F('I_A', 'Current L1', 'CURRENT_L1', 13, 'A'),
    F('I_B', 'Current L2', 'CURRENT_L2', 15, 'A'),
    F('I_C', 'Current L3', 'CURRENT_L3', 17, 'A'),
    F('FREQ', 'Frequency', 'FREQUENCY', 55, 'Hz'),
    F('P_TOTAL', 'Active Power Total', 'ACTIVE_POWER_TOTAL', 65, 'kW', 0.001),
    F('PF_TOTAL', 'Power Factor Total', 'PF_TOTAL', 69, ''),
    I64('E_IMP', 'Active Energy Import', 'ENERGY_IMPORT_TOTAL', 801, 'kWh'),
  ],
};

const GENERIC_PM: MeterTemplate = {
  key: 'GENERIC_PM',
  label: 'Generic 3-phase Power Meter',
  manufacturer: 'Generic',
  models: ['custom'],
  tags: [
    F('V_AVG', 'Voltage Avg', 'VOLTAGE_AVG', 0, 'V'),
    F('I_AVG', 'Current Avg', 'CURRENT_AVG', 2, 'A'),
    F('P_TOTAL', 'Active Power Total', 'ACTIVE_POWER_TOTAL', 4, 'kW'),
    F('PF_TOTAL', 'Power Factor Total', 'PF_TOTAL', 6, ''),
    F('FREQ', 'Frequency', 'FREQUENCY', 8, 'Hz'),
    I64('E_IMP', 'Active Energy Import', 'ENERGY_IMPORT_TOTAL', 10, 'kWh'),
  ],
};

const METER_TEMPLATES: MeterTemplate[] = [SCHNEIDER_PM5110, SIEMENS_PAC3200, SIEMENS_PAC2200, GENERIC_PM];

function getMeterTemplate(key: string): MeterTemplate | undefined {
  return METER_TEMPLATES.find((t) => t.key === key);
}

export interface MeterTagCreate {
  code: string;
  name: string;
  dataType: ModbusDataType;
  tagType: 'ENERGY';
  unit: string;
  address: string;
  registerType: RegisterType;
  wordCount: number;
  wordOrder: WordOrder;
  scaleFactor: number | null;
  energyRole: EnergyRole;
}

/** Build tag-create payloads for a meter from a template (codes prefixed with the meter number). */
export function instantiateMeterTags(templateKey: string, meterNumber: string): MeterTagCreate[] {
  const tpl = getMeterTemplate(templateKey);
  if (!tpl) return [];
  return tpl.tags.map((t) => ({
    code: `${meterNumber}_${t.key}`,
    name: t.name,
    dataType: t.dataType,
    tagType: 'ENERGY',
    unit: t.unit,
    address: String(t.address),
    registerType: t.registerType,
    wordCount: t.wordCount,
    wordOrder: t.wordOrder,
    scaleFactor: t.scaleFactor ?? null,
    energyRole: t.energyRole,
  }));
}
