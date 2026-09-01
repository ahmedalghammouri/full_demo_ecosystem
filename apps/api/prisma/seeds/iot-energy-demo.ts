/**
 * IoT / Energy demo seed (idempotent).
 *
 * For the NPDF factory it creates:
 *  - a "Plant Edge Gateway" row,
 *  - per machine: a Modbus PLC device + GOOD/TOTAL counter tags,
 *  - per machine: an energy/power meter (Schneider PM5110) + its full ENERGY tag set,
 *  - for the packaging line: a line-level energy meter + full PM5110 tag set.
 *
 * Importable from seed.ts (`seedIotEnergyDemo(prisma)`) and runnable standalone:
 *   cd apps/api && DATABASE_URL=... npx tsx prisma/seeds/iot-energy-demo.ts
 *
 * Each device points at its OWN simulator port (127.0.0.1:1502, 1503, …) with
 * unitId=1 — the simulators (modbus-sim-farm.mjs) each emulate one slave at
 * unit 1, so a per-port + unit-1 mapping is what actually responds. Start the
 * farm with as many instances as devices:  node scripts/modbus-sim-farm.mjs 1502 <count>
 * Everything keys on unique fields so re-runs are safe (and heal port/unit).
 */
import { PrismaClient } from '@prisma/client';

const FACTORY_CODE = 'NPDF';
const SIM_HOST = '127.0.0.1';
const SIM_BASE_PORT = 1502; // each device gets its own port: SIM_BASE_PORT, +1, +2, …
const SIM_UNIT_ID = 1;      // simulators emulate a single slave at unit 1

// Schneider PowerLogic PM5110 register map (mirrors packages/industrial-drivers/meter-templates.ts).
// Float32 (wordCount 2) for instantaneous values; Int64 (wordCount 4) for energy counters.
type TagSpec = { key: string; name: string; role: string; address: number; unit: string; dataType: 'FLOAT' | 'INT'; wordCount: number; scaleFactor?: number };
const PM5110_TAGS: TagSpec[] = [
  { key: 'I_A', name: 'Current L1', role: 'CURRENT_L1', address: 3000, unit: 'A', dataType: 'FLOAT', wordCount: 2 },
  { key: 'I_B', name: 'Current L2', role: 'CURRENT_L2', address: 3002, unit: 'A', dataType: 'FLOAT', wordCount: 2 },
  { key: 'I_C', name: 'Current L3', role: 'CURRENT_L3', address: 3004, unit: 'A', dataType: 'FLOAT', wordCount: 2 },
  { key: 'I_AVG', name: 'Current Avg', role: 'CURRENT_AVG', address: 3010, unit: 'A', dataType: 'FLOAT', wordCount: 2 },
  { key: 'V_AN', name: 'Voltage L1-N', role: 'VOLTAGE_L1', address: 3028, unit: 'V', dataType: 'FLOAT', wordCount: 2 },
  { key: 'V_BN', name: 'Voltage L2-N', role: 'VOLTAGE_L2', address: 3030, unit: 'V', dataType: 'FLOAT', wordCount: 2 },
  { key: 'V_CN', name: 'Voltage L3-N', role: 'VOLTAGE_L3', address: 3032, unit: 'V', dataType: 'FLOAT', wordCount: 2 },
  { key: 'V_LN_AVG', name: 'Voltage L-N Avg', role: 'VOLTAGE_AVG', address: 3036, unit: 'V', dataType: 'FLOAT', wordCount: 2 },
  { key: 'P_TOTAL', name: 'Active Power Total', role: 'ACTIVE_POWER_TOTAL', address: 3060, unit: 'kW', dataType: 'FLOAT', wordCount: 2 },
  { key: 'Q_TOTAL', name: 'Reactive Power Total', role: 'REACTIVE_POWER_TOTAL', address: 3068, unit: 'kVAR', dataType: 'FLOAT', wordCount: 2 },
  { key: 'S_TOTAL', name: 'Apparent Power Total', role: 'APPARENT_POWER_TOTAL', address: 3076, unit: 'kVA', dataType: 'FLOAT', wordCount: 2 },
  { key: 'PF_TOTAL', name: 'Power Factor Total', role: 'PF_TOTAL', address: 3084, unit: '', dataType: 'FLOAT', wordCount: 2 },
  { key: 'FREQ', name: 'Frequency', role: 'FREQUENCY', address: 3110, unit: 'Hz', dataType: 'FLOAT', wordCount: 2 },
  { key: 'E_IMP', name: 'Active Energy Import', role: 'ENERGY_IMPORT_TOTAL', address: 3204, unit: 'kWh', dataType: 'INT', wordCount: 4, scaleFactor: 0.001 },
  { key: 'E_EXP', name: 'Active Energy Export', role: 'ENERGY_EXPORT_TOTAL', address: 3208, unit: 'kWh', dataType: 'INT', wordCount: 4, scaleFactor: 0.001 },
];

export async function seedIotEnergyDemo(prisma: PrismaClient): Promise<void> {
  const factory = await prisma.factory.findUnique({ where: { code: FACTORY_CODE } });
  if (!factory) { console.warn(`[iot-energy-demo] factory ${FACTORY_CODE} not found — skipped`); return; }
  const factoryId = factory.id;

  // Idempotent tag upsert (TagDefinition is unique on factoryId+code).
  const upsertTag = (data: any) =>
    prisma.tagDefinition.upsert({ where: { factoryId_code: { factoryId, code: data.code } }, create: { factoryId, ...data }, update: data });

  // 1) Gateway
  let gateway = await prisma.gateway.findFirst({ where: { factoryId, name: 'Plant Edge Gateway' } });
  if (!gateway) gateway = await prisma.gateway.create({ data: { factoryId, name: 'Plant Edge Gateway', status: 'OFFLINE', isActive: true } });

  const machines = await prisma.machine.findMany({ where: { factoryId, isActive: true }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } });

  let nextPort = SIM_BASE_PORT; // each device gets its own simulator port
  for (const m of machines) {
    // 2) Modbus PLC + GOOD/TOTAL counter tags
    const plcCode = `PLC-${m.code}`;
    const plcPort = nextPort++;
    const plc = await prisma.device.upsert({
      where: { deviceCode: plcCode },
      create: { factoryId, gatewayId: gateway.id, machineId: m.id, name: `PLC ${m.name}`, deviceCode: plcCode, type: 'PLC', protocol: 'MODBUS', ipAddress: SIM_HOST, port: plcPort, unitId: SIM_UNIT_ID, status: 'DISCONNECTED' },
      update: { gatewayId: gateway.id, machineId: m.id, ipAddress: SIM_HOST, port: plcPort, unitId: SIM_UNIT_ID },
    });
    await upsertTag({ code: `${m.code}_CNT_GOOD`, name: `${m.name} Good Count`, dataType: 'BOOL', tagType: 'COUNTER', deviceId: plc.id, machineId: m.id, address: '0', registerType: 'COIL', counterRole: 'GOOD', edgeType: 'RISING' });
    await upsertTag({ code: `${m.code}_CNT_TOTAL`, name: `${m.name} Total Count`, dataType: 'BOOL', tagType: 'COUNTER', deviceId: plc.id, machineId: m.id, address: '0', registerType: 'COIL', counterRole: 'TOTAL', edgeType: 'RISING' });

    // 3) Per-machine energy meter (PM5110) + full tag set
    await seedMeter(prisma, factoryId, gateway.id, {
      meterNumber: `EM-${m.code}`, name: `${m.name} Power Meter`, machineId: m.id, port: nextPort++,
    });
  }

  // 4) Packaging-line energy meter (line-level) + full tag set
  const line = await prisma.productionLine.findFirst({ where: { factoryId, type: 'PACKING' as any }, select: { id: true, code: true, name: true } });
  if (line) {
    await seedMeter(prisma, factoryId, gateway.id, {
      meterNumber: `EM-LINE-${line.code}`, name: `${line.name} Power Meter`, lineId: line.id, port: nextPort++,
    });
  }

  console.log(`[iot-energy-demo] NPDF: ${machines.length} PLCs + counters, ${machines.length} machine meters${line ? ' + 1 line meter' : ''} (gateway "Plant Edge Gateway").`);
}

async function seedMeter(
  prisma: PrismaClient, factoryId: string, gatewayId: string,
  opts: { meterNumber: string; name: string; machineId?: string; lineId?: string; port: number },
) {
  const devCode = `${opts.meterNumber}-DEV`;
  const device = await prisma.device.upsert({
    where: { deviceCode: devCode },
    create: { factoryId, gatewayId, machineId: opts.machineId ?? null, name: `${opts.name} (meter)`, deviceCode: devCode, type: 'METER', protocol: 'MODBUS_RTU_TCP', ipAddress: SIM_HOST, port: opts.port, unitId: SIM_UNIT_ID, status: 'DISCONNECTED' },
    update: { gatewayId, protocol: 'MODBUS_RTU_TCP', ipAddress: SIM_HOST, port: opts.port, unitId: SIM_UNIT_ID },
  });
  const meter = await prisma.energyMeter.upsert({
    where: { factoryId_meterNumber: { factoryId, meterNumber: opts.meterNumber } },
    create: { factoryId, deviceId: device.id, machineId: opts.machineId ?? null, lineId: opts.lineId ?? null, meterNumber: opts.meterNumber, name: opts.name, type: 'ELECTRICAL', unit: 'kWh', manufacturer: 'Schneider Electric', model: 'METSEPM5110', templateKey: 'SCHNEIDER_PM5110' },
    update: { deviceId: device.id, templateKey: 'SCHNEIDER_PM5110' },
  });
  for (const t of PM5110_TAGS) {
    const code = `${opts.meterNumber}_${t.key}`;
    await prisma.tagDefinition.upsert({
      where: { factoryId_code: { factoryId, code } },
      create: { factoryId, meterId: meter.id, deviceId: device.id, machineId: opts.machineId ?? null, code, name: t.name, dataType: t.dataType as any, tagType: 'ENERGY', unit: t.unit, address: String(t.address), registerType: 'HOLDING', wordCount: t.wordCount, wordOrder: 'BIG', scaleFactor: t.scaleFactor ?? null, energyRole: t.role },
      update: { meterId: meter.id, deviceId: device.id, energyRole: t.role, address: String(t.address) },
    });
  }
}

// Standalone runner
if (require.main === module) {
  const prisma = new PrismaClient();
  seedIotEnergyDemo(prisma)
    .then(() => console.log('[iot-energy-demo] done'))
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
