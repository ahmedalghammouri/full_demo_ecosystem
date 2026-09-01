/**
 * i360 Ecosystem Demo — master data seeder.
 *
 * Reads the plant model and writes it. It holds no plant knowledge of its own:
 * every code, rate, limit and tag address comes from `prisma/plant/`, so the
 * estate can be reviewed by reading the model rather than by reading this file.
 *
 * The seeder is idempotent. Everything is upserted on its natural key, so
 * running it twice converges rather than duplicating — which matters because a
 * demo gets re-seeded far more often than a production system does.
 *
 *   pnpm prisma:seed          write master data
 *   pnpm plant:check          validate the model without touching the database
 *
 * Transactional history (orders, counts, downtime, quality results) is written
 * by `seed-history.ts`, which runs after this and depends on it.
 */

import { PrismaClient, Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  ENTERPRISE, FACTORIES, DEMO_USERS, DEMO_PASSWORD,
  validatePlantModel, plantSummary, capabilitiesOf, CAPABILITY_ROUTES,
} from './plant/plant-model';
import { FACTORY_TYPE_META } from './plant/types';
import type { FactoryDef, TagDef, DeviceDef } from './plant/types';

const prisma = new PrismaClient();

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const log = (msg: string) => console.log(msg);
const round2 = (v: number) => Math.round(v * 100) / 100;
const step = (msg: string) => console.log(`  · ${msg}`);

/** Map a model tag role onto the schema's tagType + counterRole pair. */
function tagKind(role: TagDef['role']): { tagType: 'STATUS' | 'COUNTER' | 'MEASUREMENT' | 'ENERGY'; counterRole: 'TOTAL' | 'GOOD' | 'BAD' | 'NONE'; isMachineStatus: boolean } {
  switch (role) {
    case 'STATUS': return { tagType: 'STATUS', counterRole: 'NONE', isMachineStatus: true };
    case 'COUNTER_TOTAL': return { tagType: 'COUNTER', counterRole: 'TOTAL', isMachineStatus: false };
    case 'COUNTER_GOOD': return { tagType: 'COUNTER', counterRole: 'GOOD', isMachineStatus: false };
    case 'COUNTER_REJECT': return { tagType: 'COUNTER', counterRole: 'BAD', isMachineStatus: false };
    case 'ENERGY': return { tagType: 'ENERGY', counterRole: 'NONE', isMachineStatus: false };
    default: return { tagType: 'MEASUREMENT', counterRole: 'NONE', isMachineStatus: false };
  }
}

function tagDataType(dt: TagDef['dataType']): 'BOOL' | 'INT' | 'FLOAT' {
  if (dt === 'BOOL') return 'BOOL';
  if (dt === 'FLOAT32') return 'FLOAT';
  return 'INT';
}

function protocolOf(d: DeviceDef): string {
  return d.protocol;
}

function uomCategory(unit: string): 'WEIGHT' | 'VOLUME' | 'COUNT' | 'PACKAGING' | 'LENGTH' | 'AREA' | 'TIME' {
  if (['KG', 'G', 'TON'].includes(unit)) return 'WEIGHT';
  if (['L', 'ML', 'M3'].includes(unit)) return 'VOLUME';
  if (['M2'].includes(unit)) return 'AREA';
  if (['M', 'MM'].includes(unit)) return 'LENGTH';
  if (['PCS', 'PIECE', 'EA'].includes(unit)) return 'COUNT';
  return 'PACKAGING';
}

/** The zone a material belongs in, so stock lands somewhere sensible. */
function zoneFor(type: string): 'RAW_MATERIAL' | 'FINISHED_GOODS' | 'SPARE_PARTS' | 'QUARANTINE' | 'PRODUCTION' | 'DISPATCH' {
  return type === 'PACKAGING' ? 'PRODUCTION' : 'RAW_MATERIAL';
}


/**
 * What travels on the factory row besides its columns.
 *
 * The classification and the resolved capability list live here so the API and
 * the navigation read one source of truth instead of each re-deriving which
 * modules a site has — the fastest way to end up with a sidebar that offers a
 * screen the backend refuses.
 */
function factoryMetadata(f: FactoryDef): Prisma.InputJsonValue {
  const caps = capabilitiesOf(f);
  return {
    paradigm: f.paradigm,
    type: f.type,
    typeName: FACTORY_TYPE_META[f.type].name,
    typeNameAr: FACTORY_TYPE_META[f.type].nameAr,
    typeSummary: FACTORY_TYPE_META[f.type].summary,
    typeSummaryAr: FACTORY_TYPE_META[f.type].summaryAr,
    capabilities: caps,
    routes: caps.map((c) => ({ capability: c, ...CAPABILITY_ROUTES[c] })),
    district: f.district,
    districtAr: f.districtAr,
    cityAr: f.cityAr,
    tagline: f.tagline,
    taglineAr: f.taglineAr,
    showcases: f.showcases,
    unitFactors: f.unitFactors,
  } as Prisma.InputJsonValue;
}

// ────────────────────────────────────────────────────────────────────────────
// Seed one factory
// ────────────────────────────────────────────────────────────────────────────

async function seedFactory(enterpriseId: string, f: FactoryDef) {
  log(`\n▸ ${f.code} — ${f.name}`);

  const factory = await prisma.factory.upsert({
    where: { code: f.code },
    update: {
      name: f.name, nameAr: f.nameAr, city: f.city, lat: f.lat, lng: f.lng,
      color: f.color, glowColor: f.glowColor, timezone: f.timezone,
      displayUnit: f.displayUnit, isActive: true,
      metadata: factoryMetadata(f),
    },
    create: {
      enterpriseId, code: f.code, name: f.name, nameAr: f.nameAr,
      city: f.city, country: 'SA', lat: f.lat, lng: f.lng,
      color: f.color, glowColor: f.glowColor, timezone: f.timezone,
      displayUnit: f.displayUnit,
      metadata: factoryMetadata(f),
    },
  });
  const fid = factory.id;

  // ── Areas ───────────────────────────────────────────────────────────────
  const areaId = new Map<string, string>();
  for (const a of f.areas) {
    const row = await prisma.area.upsert({
      where: { factoryId_code: { factoryId: fid, code: a.code } },
      update: { name: a.name, nameAr: a.nameAr, type: a.type as any, description: a.description },
      create: { factoryId: fid, code: a.code, name: a.name, nameAr: a.nameAr, type: a.type as any, description: a.description },
    });
    areaId.set(a.code, row.id);
  }
  step(`${f.areas.length} areas`);

  // ── Lines ───────────────────────────────────────────────────────────────
  const lineId = new Map<string, string>();
  for (const l of f.lines) {
    const row = await prisma.productionLine.upsert({
      where: { factoryId_code: { factoryId: fid, code: l.code } },
      update: { name: l.name, nameAr: l.nameAr, type: l.type as any, areaId: areaId.get(l.areaCode)!, sortOrder: l.sortOrder, oeeMethod: l.oeeMethod as any },
      create: { factoryId: fid, areaId: areaId.get(l.areaCode)!, code: l.code, name: l.name, nameAr: l.nameAr, type: l.type as any, sortOrder: l.sortOrder, oeeMethod: l.oeeMethod as any },
    });
    lineId.set(l.code, row.id);
  }
  step(`${f.lines.length} production lines`);

  // ── Machines ────────────────────────────────────────────────────────────
  const machineId = new Map<string, string>();
  for (const m of f.machines) {
    const row = await prisma.machine.upsert({
      where: { factoryId_code: { factoryId: fid, code: m.code } },
      update: {
        name: m.name, nameAr: m.nameAr, machineType: m.type as any,
        areaId: areaId.get(m.areaCode), lineId: m.lineCode ? lineId.get(m.lineCode) : null,
        sortOrder: m.sortOrder, manufacturer: m.manufacturer, model: m.model,
        criticality: m.criticality as any, designCapacity: m.designCapacity,
        downtimeThreshold: m.downtimeThreshold ?? 60,
        installDate: m.installDate ? new Date(m.installDate) : null,
        isActive: true,
        metadata: { ...(m.metadata ?? {}), countUnit: m.countUnit, idealCycleSeconds: m.idealCycleSeconds, grid: m.grid } as Prisma.InputJsonValue,
      },
      create: {
        factoryId: fid, areaId: areaId.get(m.areaCode), lineId: m.lineCode ? lineId.get(m.lineCode) : null,
        code: m.code, name: m.name, nameAr: m.nameAr, machineType: m.type as any,
        sortOrder: m.sortOrder, manufacturer: m.manufacturer, model: m.model,
        serialNumber: `${f.code}-${m.code}-${String(1000 + m.sortOrder)}`,
        criticality: m.criticality as any, designCapacity: m.designCapacity,
        downtimeThreshold: m.downtimeThreshold ?? 60,
        installDate: m.installDate ? new Date(m.installDate) : null,
        metadata: { ...(m.metadata ?? {}), countUnit: m.countUnit, idealCycleSeconds: m.idealCycleSeconds, grid: m.grid } as Prisma.InputJsonValue,
      },
    });
    machineId.set(m.code, row.id);

    await prisma.machineCurrentStatus.upsert({
      where: { machineId: row.id },
      update: {},
      create: { machineId: row.id, state: 'OFFLINE' },
    });
  }
  step(`${f.machines.length} machines`);

  // Bottleneck and outfeed wiring needs the machine ids, so it runs second.
  for (const l of f.lines) {
    await prisma.productionLine.update({
      where: { id: lineId.get(l.code)! },
      data: {
        bottleneckMachineId: l.bottleneckMachine ? machineId.get(l.bottleneckMachine) : null,
        outfeedMachineIds: (l.outfeedMachines ?? []).map((c) => machineId.get(c)!).filter(Boolean),
      },
    });
  }

  // ── Work centres — one per line, so routing has somewhere to sit ────────
  const workCenterId = new Map<string, string>();
  for (const l of f.lines) {
    const existing = await prisma.workCenter.findFirst({ where: { factoryId: fid, code: l.code } });
    const row = existing
      ? await prisma.workCenter.update({ where: { id: existing.id }, data: { name: l.name, level: 'LINE' } })
      : await prisma.workCenter.create({ data: { factoryId: fid, code: l.code, name: l.name, level: 'LINE' } });
    workCenterId.set(l.code, row.id);
  }

  // ── Shifts ──────────────────────────────────────────────────────────────
  for (const s of f.shifts) {
    const existing = await prisma.shiftTemplate.findFirst({ where: { factoryId: fid, code: s.code } });
    const data = {
      name: s.name, nameAr: s.nameAr, startTime: s.startTime, endTime: s.endTime,
      crossesMidnight: s.crossesMidnight, plannedProductionHours: s.plannedProductionHours,
      shiftDurationHours: s.shiftDurationHours, breakMinutes: s.breakMinutes,
      cleaningMinutes: s.cleaningMinutes, days: s.days as Prisma.InputJsonValue,
      targetQtyPerShift: s.targetQtyPerShift, targetUnit: s.targetUnit ?? f.displayUnit,
      isActive: true,
    };
    if (existing) await prisma.shiftTemplate.update({ where: { id: existing.id }, data });
    else await prisma.shiftTemplate.create({ data: { factoryId: fid, code: s.code, ...data } });
  }
  step(`${f.shifts.length} shift templates`);

  // ── Downtime cause tree — parents before children ───────────────────────
  const causeId = new Map<string, string>();
  for (const level of [1, 2, 3] as const) {
    for (const c of f.downtimeCauses.filter((x) => x.level === level)) {
      const existing = await prisma.downtimeCause.findFirst({ where: { factoryId: fid, code: c.code } });
      const data = {
        name: c.name, nameAr: c.nameAr, category: c.category as any,
        isPlanned: c.isPlanned, level: c.level,
        parentId: c.parent ? causeId.get(c.parent) ?? null : null,
        isActive: true,
      };
      const row = existing
        ? await prisma.downtimeCause.update({ where: { id: existing.id }, data })
        : await prisma.downtimeCause.create({ data: { factoryId: fid, code: c.code, ...data } });
      causeId.set(c.code, row.id);
    }
  }
  step(`${f.downtimeCauses.length} downtime causes (${f.downtimeCauses.filter((c) => c.level === 3).length} selectable)`);

  // ── Storage locations ───────────────────────────────────────────────────
  const zones: { code: string; name: string; zone: any }[] = [
    { code: 'WH-RAW', name: 'Raw Material Store', zone: 'RAW_MATERIAL' },
    { code: 'WH-PKG', name: 'Packaging Store', zone: 'PRODUCTION' },
    { code: 'WH-FG', name: 'Finished Goods Store', zone: 'FINISHED_GOODS' },
    { code: 'WH-QAR', name: 'Quarantine Hold', zone: 'QUARANTINE' },
    { code: 'WH-SPR', name: 'Spare Parts Store', zone: 'SPARE_PARTS' },
    { code: 'WH-DSP', name: 'Dispatch Bay', zone: 'DISPATCH' },
  ];
  const locationId = new Map<string, string>();
  for (const z of zones) {
    const existing = await prisma.storageLocation.findFirst({ where: { factoryId: fid, code: z.code } });
    const row = existing
      ? await prisma.storageLocation.update({ where: { id: existing.id }, data: { name: z.name, zone: z.zone } })
      : await prisma.storageLocation.create({ data: { factoryId: fid, code: z.code, name: z.name, zone: z.zone } });
    locationId.set(z.code, row.id);
  }

  // ── Units of measure, drawn from what the model actually uses ───────────
  const usedUnits = new Set<string>([
    ...Object.keys(f.unitFactors),
    ...f.materials.map((m) => m.unit),
    ...f.energyMeters.map((m) => m.unit),
  ]);
  const uomId = new Map<string, string>();
  let uomOrder = 0;
  for (const u of usedUnits) {
    const existing = await prisma.unitOfMeasure.findFirst({ where: { factoryId: fid, code: u } });
    const data = {
      name: u, category: uomCategory(u) as any,
      conversionFactor: f.unitFactors[u] ?? 1, sortOrder: uomOrder++, isActive: true,
    };
    const row = existing
      ? await prisma.unitOfMeasure.update({ where: { id: existing.id }, data })
      : await prisma.unitOfMeasure.create({ data: { factoryId: fid, code: u, ...data } });
    uomId.set(u, row.id);
  }
  step(`${usedUnits.size} units of measure`);

  // ── Product taxonomy ────────────────────────────────────────────────────
  const categoryId = new Map<string, string>();
  const brandId = new Map<string, string>();
  const baseUnitId = new Map<string, string>();
  const packagingTypeId = new Map<string, string>();

  for (const [i, name] of [...new Set(f.products.map((p) => p.category))].entries()) {
    const existing = await prisma.productCategory.findFirst({ where: { factoryId: fid, name } });
    const row = existing ?? await prisma.productCategory.create({ data: { factoryId: fid, name, sortOrder: i } });
    categoryId.set(name, row.id);
  }
  for (const [i, name] of [...new Set(f.products.map((p) => p.brand))].entries()) {
    const existing = await prisma.productBrand.findFirst({ where: { factoryId: fid, name } });
    const row = existing ?? await prisma.productBrand.create({ data: { factoryId: fid, name, sortOrder: i } });
    brandId.set(name, row.id);
  }
  for (const [i, code] of [...new Set(f.products.map((p) => p.baseUnit))].entries()) {
    const existing = await prisma.baseUnit.findFirst({ where: { factoryId: fid, code } });
    const row = existing ?? await prisma.baseUnit.create({ data: { factoryId: fid, code, name: code, sortOrder: i } });
    baseUnitId.set(code, row.id);
  }
  for (const [i, name] of [...new Set(f.products.map((p) => p.packagingLadder.at(-1)!.unit))].entries()) {
    const existing = await prisma.packagingType.findFirst({ where: { factoryId: fid, name } });
    const row = existing ?? await prisma.packagingType.create({ data: { factoryId: fid, name, sortOrder: i } });
    packagingTypeId.set(name, row.id);
  }

  // ── SKUs ────────────────────────────────────────────────────────────────
  const skuId = new Map<string, string>();
  for (const p of f.products) {
    // The ladder is smallest-first; rung 1 is the inner multiple, rung 2 the
    // carton multiple. A two-rung ladder (piece → pallet) leaves the middle at 1.
    const rungs = p.packagingLadder;
    const innersPerCarton = rungs.length > 1 ? rungs[1].perParent : 1;
    const cartonsPerPallet = rungs.length > 2 ? rungs[2].perParent : 1;

    const existing = await prisma.sKU.findFirst({ where: { factoryId: fid, code: p.code } });
    const data = {
      name: p.name, nameAr: p.nameAr, brand: p.brand, category: p.category,
      categoryId: categoryId.get(p.category), brandId: brandId.get(p.brand),
      baseUnitId: baseUnitId.get(p.baseUnit), packagingTypeId: packagingTypeId.get(rungs.at(-1)!.unit),
      baseUnit: p.baseUnit, unitsPerInner: 1, innersPerCarton, cartonsPerPallet,
      weight: p.netWeightGrams ? p.netWeightGrams / 1000 : null, weightUnit: 'kg',
      storageLocationId: locationId.get('WH-FG'),
      isActive: p.isActive,
      metadata: { packagingLadder: rungs } as Prisma.InputJsonValue,
    };
    const row = existing
      ? await prisma.sKU.update({ where: { id: existing.id }, data })
      : await prisma.sKU.create({ data: { factoryId: fid, itemNumber: p.code, code: p.code, ...data } });
    skuId.set(p.code, row.id);
  }
  step(`${f.products.length} SKUs`);

  // ── Raw materials ───────────────────────────────────────────────────────
  for (const m of f.materials) {
    const existing = await prisma.rawMaterial.findFirst({ where: { factoryId: fid, code: m.code } });
    const data = {
      name: m.name, nameAr: m.nameAr, category: m.type, unit: m.unit,
      unitId: uomId.get(m.unit), minStock: m.criticalStock ?? 0,
      reorderPoint: m.criticalStock ? m.criticalStock * 1.25 : null,
      storageLocationId: locationId.get(m.type === 'PACKAGING' ? 'WH-PKG' : 'WH-RAW'),
      isActive: true,
    };
    if (existing) await prisma.rawMaterial.update({ where: { id: existing.id }, data });
    else await prisma.rawMaterial.create({ data: { factoryId: fid, code: m.code, ...data } });
  }
  step(`${f.materials.length} raw materials`);

  // ── Manufacturing process and routing ───────────────────────────────────
  // One process per factory, scoped to the site rather than to a single SKU:
  // all three estates run one routing across their product range.
  const processName = `${f.code} Standard Routing`;
  const existingProcess = await prisma.manufacturingProcess.findFirst({ where: { factoryId: fid, name: processName } });
  const process = existingProcess
    ? await prisma.manufacturingProcess.update({
        where: { id: existingProcess.id },
        data: { totalCycleTimeMins: f.routing.reduce((n, r) => n + r.idealCycleSeconds, 0) / 60, isActive: true },
      })
    : await prisma.manufacturingProcess.create({
        data: {
          factoryId: fid, name: processName, scopeType: 'CATEGORY', version: '1.0',
          description: `Routing for ${f.name}, ${f.routing.length} steps`,
          totalCycleTimeMins: f.routing.reduce((n, r) => n + r.idealCycleSeconds, 0) / 60,
        },
      });

  for (const r of f.routing) {
    const primary = r.machines[0];
    const lineOf = f.machines.find((m) => m.code === primary)?.lineCode;
    const existing = await prisma.routingStep.findFirst({ where: { processId: process.id, stepNumber: r.sequence } });
    const data = {
      operationName: r.name, machineId: machineId.get(primary),
      workCenterId: lineOf ? workCenterId.get(lineOf) : null,
      cycleTimeSec: r.idealCycleSeconds, cycleTimeMins: r.idealCycleSeconds / 60,
      description: r.nameAr,
      parameters: { code: r.code, nameAr: r.nameAr, tests: r.tests ?? [], consumes: r.consumes ?? [] } as Prisma.InputJsonValue,
    };
    const stepRow = existing
      ? await prisma.routingStep.update({ where: { id: existing.id }, data })
      : await prisma.routingStep.create({ data: { processId: process.id, stepNumber: r.sequence, ...data } });

    // Alternative machines — parallel moulding cells are options on one step,
    // not four separate steps, or the step's output would be counted four times.
    for (const [i, code] of r.machines.entries()) {
      const mid = machineId.get(code);
      if (!mid) continue;
      const opt = await prisma.routingStepMachineOption.findFirst({ where: { stepId: stepRow.id, machineId: mid } });
      if (!opt) {
        await prisma.routingStepMachineOption.create({
          data: { stepId: stepRow.id, machineId: mid, priority: i, isDefault: i === 0 },
        });
      }
    }
  }
  step(`${f.routing.length} routing steps`);

  // ── Machine cycle times, per SKU per machine ────────────────────────────
  let cycleRows = 0;
  for (const p of f.products) {
    const sid = skuId.get(p.code)!;
    for (const m of f.machines) {
      if (!m.idealCycleSeconds || !m.lineCode) continue;
      const mid = machineId.get(m.code)!;
      const existing = await prisma.machineCycleTime.findFirst({ where: { machineId: mid, skuId: sid } });
      const data = {
        cycleTimeSeconds: m.idealCycleSeconds, unitType: m.countUnit ?? 'UNIT',
        maxSpeed: m.designCapacity, source: 'PLANT_DATA', isActive: true,
      };
      if (existing) await prisma.machineCycleTime.update({ where: { id: existing.id }, data });
      else await prisma.machineCycleTime.create({ data: { machineId: mid, skuId: sid, ...data } });
      cycleRows++;
    }
  }
  step(`${cycleRows} machine cycle times`);

  // ── Quality plans ───────────────────────────────────────────────────────
  for (const q of f.qualitySpecs) {
    const stepMachine = q.stepCode ? f.routing.find((r) => r.code === q.stepCode)?.machines[0] : undefined;
    const existing = await prisma.qualityPlan.findFirst({ where: { factoryId: fid, code: q.code } });
    const data = {
      name: q.name, type: 'IN_PROCESS',
      machineId: stepMachine ? machineId.get(stepMachine) : null,
      samplingFrequency: q.sampleRate >= 1 ? 'EVERY_UNIT' : `${Math.round(q.sampleRate * 100)}_PERCENT`,
      samplingQty: 1, isActive: true,
    };
    const plan = existing
      ? await prisma.qualityPlan.update({ where: { id: existing.id }, data })
      : await prisma.qualityPlan.create({ data: { factoryId: fid, code: q.code, ...data } });

    const param = await prisma.qualityParameter.findFirst({ where: { planId: plan.id, name: q.name } });
    const paramData = {
      unit: q.unit, nominalValue: q.target ?? null,
      lsl: q.lsl ?? null, usl: q.usl ?? null,
      // Control limits sit inside the specification limits: a process centred
      // on target should signal before it makes something out of spec.
      lcl: q.lsl !== undefined && q.target !== undefined ? q.target - (q.target - q.lsl) * 0.66 : null,
      ucl: q.usl !== undefined && q.target !== undefined ? q.target + (q.usl - q.target) * 0.66 : null,
      isKPI: true, sortOrder: 0,
    };
    if (param) await prisma.qualityParameter.update({ where: { id: param.id }, data: paramData });
    else await prisma.qualityParameter.create({ data: { planId: plan.id, name: q.name, ...paramData } });
  }
  step(`${f.qualitySpecs.length} quality plans`);

  // ── Energy meters ───────────────────────────────────────────────────────
  const meterId = new Map<string, string>();
  for (const m of f.energyMeters) {
    const existing = await prisma.energyMeter.findFirst({ where: { factoryId: fid, meterNumber: m.meterNumber } });
    const data = {
      name: m.name, nameAr: m.nameAr, type: m.type as any, unit: m.unit,
      machineId: m.machineCode ? machineId.get(m.machineCode) : null,
      lineId: m.lineCode ? lineId.get(m.lineCode) : null,
      areaId: m.areaCode ? areaId.get(m.areaCode) : null,
      manufacturer: m.manufacturer, model: m.model, isActive: true,
    };
    const row = existing
      ? await prisma.energyMeter.update({ where: { id: existing.id }, data })
      : await prisma.energyMeter.create({ data: { factoryId: fid, meterNumber: m.meterNumber, ...data } });
    meterId.set(m.code, row.id);
  }
  step(`${f.energyMeters.length} energy meters`);

  // ── Gateways, devices and tags ──────────────────────────────────────────
  const gatewayOfDevice = new Map<string, string>();
  for (const g of f.gateways) {
    const existing = await prisma.gateway.findFirst({ where: { factoryId: fid, name: g.name } });
    const data = { hostname: g.code.toLowerCase(), status: 'OFFLINE', isActive: true,
      config: { location: g.location, code: g.code } as Prisma.InputJsonValue };
    const row = existing
      ? await prisma.gateway.update({ where: { id: existing.id }, data })
      : await prisma.gateway.create({ data: { factoryId: fid, name: g.name, ...data } });
    for (const dc of g.devices) gatewayOfDevice.set(dc, row.id);
  }

  let tagCount = 0;
  for (const d of f.devices) {
    const device = await prisma.device.upsert({
      where: { deviceCode: `${f.code}-${d.code}` },
      update: {
        name: d.name, protocol: protocolOf(d), port: d.port, unitId: d.unitId,
        pollIntervalMs: d.pollMs, gatewayId: gatewayOfDevice.get(d.code) ?? null,
        areaId: d.areaCode ? areaId.get(d.areaCode) : null,
        lineId: d.lineCode ? lineId.get(d.lineCode) : null,
        isActive: true,
      },
      create: {
        factoryId: fid, deviceCode: `${f.code}-${d.code}`, name: d.name,
        type: d.protocol.startsWith('MODBUS') ? 'PLC' : 'GATEWAY',
        protocol: protocolOf(d),
        // The Virtual Plant serves every device on the loopback interface; on a
        // real site this is the field IP and nothing else about the row changes.
        ipAddress: '127.0.0.1', port: d.port, unitId: d.unitId,
        pollIntervalMs: d.pollMs, gatewayId: gatewayOfDevice.get(d.code) ?? null,
        areaId: d.areaCode ? areaId.get(d.areaCode) : null,
        lineId: d.lineCode ? lineId.get(d.lineCode) : null,
      },
    });

    for (const t of d.tags) {
      const kind = tagKind(t.role);
      const owningMachine = machineId.get(t.ownerCode);
      const owningMeter = meterId.get(t.ownerCode);
      const existing = await prisma.tagDefinition.findFirst({ where: { factoryId: fid, code: t.code } });
      const data = {
        name: t.name, deviceId: device.id,
        machineId: owningMachine ?? null,
        meterId: owningMeter ?? null,
        lineId: d.lineCode ? lineId.get(d.lineCode) : null,
        areaId: d.areaCode ? areaId.get(d.areaCode) : null,
        dataType: tagDataType(t.dataType) as any,
        unit: t.unit ?? null,
        minValue: t.range?.[0] ?? null, maxValue: t.range?.[1] ?? null,
        scaleFactor: t.scale ?? 1,
        tagType: kind.tagType as any,
        counterRole: kind.counterRole as any,
        isMachineStatus: kind.isMachineStatus,
        energyRole: kind.tagType === 'ENERGY' ? t.code.split('.').pop() : null,
        address: String(t.address),
        registerType: t.dataType === 'BOOL' ? 'DISCRETE_INPUT' : 'HOLDING',
        wordCount: t.dataType === 'FLOAT32' ? 2 : 1,
        pollIntervalMs: t.pollMs,
        historizationEnabled: kind.tagType !== 'COUNTER',
        historizationRateSec: Math.max(10, Math.round(t.pollMs / 1000) * 10),
        isActive: true,
      };
      if (existing) await prisma.tagDefinition.update({ where: { id: existing.id }, data });
      else await prisma.tagDefinition.create({ data: { factoryId: fid, code: t.code, ...data } });
      tagCount++;
    }
  }
  step(`${f.gateways.length} gateways · ${f.devices.length} devices · ${tagCount} tags`);

  // ── Machine state rules ─────────────────────────────────────────────────
  // Which states are downtime, which are planned, and which the OEE engine
  // charges. These are plant decisions, not engineering ones, which is why
  // they are rows an administrator can change rather than constants.
  const stateRules: { state: string; isDowntime: boolean; isPlanned: boolean; affectsOEE: boolean; category: string; debounce: number }[] = [
    { state: 'RUNNING', isDowntime: false, isPlanned: false, affectsOEE: false, category: 'OTHER', debounce: 0 },
    { state: 'IDLE', isDowntime: true, isPlanned: false, affectsOEE: true, category: 'OPERATOR', debounce: 60 },
    { state: 'STARVED', isDowntime: true, isPlanned: false, affectsOEE: true, category: 'MATERIAL', debounce: 30 },
    { state: 'BLOCKED', isDowntime: true, isPlanned: false, affectsOEE: true, category: 'PROCESS', debounce: 30 },
    { state: 'BREAKDOWN', isDowntime: true, isPlanned: false, affectsOEE: true, category: 'MECHANICAL', debounce: 0 },
    { state: 'SETUP', isDowntime: true, isPlanned: true, affectsOEE: true, category: 'CHANGEOVER', debounce: 0 },
    { state: 'CHANGEOVER', isDowntime: true, isPlanned: true, affectsOEE: true, category: 'CHANGEOVER', debounce: 0 },
    { state: 'STARTUP', isDowntime: true, isPlanned: true, affectsOEE: true, category: 'STARTUP', debounce: 0 },
    { state: 'MAINTENANCE', isDowntime: true, isPlanned: true, affectsOEE: false, category: 'PLANNED_MAINTENANCE', debounce: 0 },
    // Planned stops and offline time are excluded from OEE: charging a break or
    // an unscheduled hour to availability is the fastest way to make the number
    // meaningless.
    { state: 'PLANNED_STOP', isDowntime: true, isPlanned: true, affectsOEE: false, category: 'PLANNED_BREAK', debounce: 0 },
    { state: 'OFFLINE', isDowntime: true, isPlanned: true, affectsOEE: false, category: 'EXTERNAL', debounce: 0 },
  ];
  for (const r of stateRules) {
    await prisma.machineStateRule.upsert({
      where: { factoryId_machineId_state: { factoryId: fid, machineId: null as any, state: r.state } },
      update: { isDowntime: r.isDowntime, isPlanned: r.isPlanned, affectsOEE: r.affectsOEE, category: r.category as any, debounceSeconds: r.debounce },
      create: { factoryId: fid, state: r.state, isDowntime: r.isDowntime, isPlanned: r.isPlanned, affectsOEE: r.affectsOEE, category: r.category as any, debounceSeconds: r.debounce },
    }).catch(async () => {
      // A null machineId does not participate in the composite unique on every
      // Postgres version; fall back to find-then-write.
      const existing = await prisma.machineStateRule.findFirst({ where: { factoryId: fid, machineId: null, state: r.state } });
      if (existing) {
        await prisma.machineStateRule.update({ where: { id: existing.id }, data: { isDowntime: r.isDowntime, isPlanned: r.isPlanned, affectsOEE: r.affectsOEE, category: r.category as any, debounceSeconds: r.debounce } });
      } else {
        await prisma.machineStateRule.create({ data: { factoryId: fid, state: r.state, isDowntime: r.isDowntime, isPlanned: r.isPlanned, affectsOEE: r.affectsOEE, category: r.category as any, debounceSeconds: r.debounce } });
      }
    });
  }
  step(`${stateRules.length} machine state rules`);

  // ── Alarm definitions ───────────────────────────────────────────────────
  for (const a of f.alarmRules) {
    const tag = await prisma.tagDefinition.findFirst({ where: { factoryId: fid, code: a.tagCode } });
    const existing = await prisma.alarmDefinition.findFirst({ where: { factoryId: fid, code: a.code } });
    const data = {
      name: a.name, tagId: tag?.id ?? null,
      severity: (a.severity === 'CRITICAL' ? 'CRITICAL' : a.severity === 'WARNING' ? 'MEDIUM' : 'INFO') as any,
      category: 'PROCESS', condition: a.condition, threshold: a.threshold,
      deadband: a.hysteresis ?? null, delaySeconds: a.delaySeconds, isActive: true,
    };
    if (existing) await prisma.alarmDefinition.update({ where: { id: existing.id }, data });
    else await prisma.alarmDefinition.create({ data: { factoryId: fid, code: a.code, ...data } });
  }
  step(`${f.alarmRules.length} alarm definitions`);


  // ── Capacitor banks ─────────────────────────────────────────────────────
  //
  // A bank is modelled as a machine so it sits on the asset register and carries
  // maintenance history like anything else; this adds the electrical detail that
  // only a capacitor bank has.
  //
  // The measured figures are derived from the nameplate and the bank's stated
  // condition rather than typed in twice. A bank with no detuning reactor lets
  // harmonic current amplify through the capacitors, so its measured current
  // runs ABOVE nameplate — that relationship is the whole finding, and hard-
  // coding both numbers would let them drift apart.
  let bankCount = 0;
  for (const m of f.machines) {
    const meta = (m.metadata ?? {}) as Record<string, unknown>;
    const ratedKvar = meta.ratedKvar as number | undefined;
    if (!ratedKvar) continue;

    const machineIdVal = machineId.get(m.code);
    if (!machineIdVal) continue;

    const stepCount = (meta.steps as number | undefined) ?? 6;
    const stepKvar = round2(ratedKvar / stepCount);
    const detuned = (meta.detunedReactor as boolean | undefined) ?? false;
    const condition = String(meta.condition ?? '');
    const failed = /failed/i.test(condition);
    const overloaded = /overload/i.test(condition);

    // Nameplate current for one step at 400 V, three phase: I = kVAr / (√3 · V).
    const ratedStepCurrent = round2((stepKvar * 1000) / (Math.sqrt(3) * 400));
    // Without a detuning reactor the harmonic current adds on top; a failed bank
    // draws nothing at all.
    const measuredStepCurrent = failed ? 0 : round2(ratedStepCurrent * (detuned ? 1.02 : overloaded ? 1.25 : 1.06));
    // C = kVAr / (2π f V²), per phase in µF.
    const ratedCapacitanceUf = round2((stepKvar * 1000) / (2 * Math.PI * 50 * 400 * 400) * 1e6);
    const measuredCapacitanceUf = failed ? 0 : round2(ratedCapacitanceUf * (overloaded ? 1.01 : 0.98));

    // 0-100, from how far measured current and capacitance sit from nameplate.
    const healthIndex = failed
      ? 0
      : Math.max(0, Math.round(100 - Math.abs(measuredStepCurrent / ratedStepCurrent - 1) * 220));

    const existing = await prisma.capacitorBank.findUnique({ where: { machineId: machineIdVal } });
    const data = {
      totalKvar: ratedKvar,
      stepCount,
      stepKvar,
      ratedVoltage: 400,
      controller: (meta.controller as string) ?? 'Automatic PF controller',
      pfSetpoint: 0.96,
      detunedFilter: detuned,
      detuningPct: detuned ? 7 : null,
      ratedStepCurrent,
      measuredStepCurrent,
      ratedCapacitanceUf,
      measuredCapacitanceUf,
      healthIndex,
    };
    const bank = existing
      ? await prisma.capacitorBank.update({ where: { id: existing.id }, data })
      : await prisma.capacitorBank.create({ data: { factoryId: fid, machineId: machineIdVal, ...data } });

    for (let n = 1; n <= stepCount; n++) {
      // A failed bank has every step out; a healthy one runs most of them.
      const state = failed ? 'FAULT' : n <= Math.ceil(stepCount * 0.7) ? 'ON' : 'OFF';
      const stepData = {
        kvar: stepKvar,
        state,
        // Contactors are life-limited, so switching count is a maintenance
        // signal rather than a curiosity. Earlier steps switch most.
        switchingOps: failed ? 0 : Math.round(48_000 / n),
        runHours: failed ? 0 : Math.round(9_500 / n),
        capacitanceUf: failed ? 0 : round2(measuredCapacitanceUf * (1 - n * 0.004)),
        currentA: failed ? 0 : round2(measuredStepCurrent * (1 - n * 0.003)),
        healthPct: failed ? 0 : Math.max(0, Math.round(healthIndex - n * 1.5)),
      };
      await prisma.capacitorStep.upsert({
        where: { bankId_stepNo: { bankId: bank.id, stepNo: n } },
        update: stepData,
        create: { bankId: bank.id, stepNo: n, ...stepData },
      });
    }
    bankCount++;
  }
  if (bankCount) step(`${bankCount} capacitor banks with their steps`);

  return { fid, machineId, lineId, skuId };
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  log('\n╔══════════════════════════════════════════════════════════════╗');
  log('║  i360 Ecosystem Demo — master data seed              ║');
  log('╚══════════════════════════════════════════════════════════════╝');

  // Validate before writing. A mistyped reference caught here costs seconds;
  // caught on a screen during a demo it costs the demo.
  const issues = validatePlantModel();
  const errors = issues.filter((i) => i.severity === 'ERROR');
  if (errors.length) {
    console.error(`\n✖ Plant model has ${errors.length} error(s); nothing was written.\n`);
    for (const e of errors) console.error(`   ${e.factory}: ${e.message}`);
    process.exit(1);
  }
  const warns = issues.filter((i) => i.severity === 'WARN');
  if (warns.length) {
    console.warn(`\n⚠ ${warns.length} model warning(s):`);
    for (const w of warns) console.warn(`   ${w.factory}: ${w.message}`);
  }

  const enterprise = await prisma.enterprise.upsert({
    where: { code: ENTERPRISE.code },
    update: { name: ENTERPRISE.name, nameAr: ENTERPRISE.nameAr, industry: ENTERPRISE.industry },
    create: {
      code: ENTERPRISE.code, name: ENTERPRISE.name, nameAr: ENTERPRISE.nameAr,
      industry: ENTERPRISE.industry, country: ENTERPRISE.country,
      timezone: ENTERPRISE.timezone, currency: ENTERPRISE.currency,
    },
  });
  log(`\n▸ Enterprise ${ENTERPRISE.code} — ${ENTERPRISE.name}`);

  const factoryIds = new Map<string, string>();
  for (const f of FACTORIES) {
    const { fid } = await seedFactory(enterprise.id, f);
    factoryIds.set(f.code, fid);
  }

  // ── Users ───────────────────────────────────────────────────────────────
  log('\n▸ Users');
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  for (const u of DEMO_USERS) {
    await prisma.user.upsert({
      where: { email: u.email },
      update: {
        name: u.name, nameAr: u.nameAr, role: u.role as any, jobTitle: u.jobTitle,
        factoryId: u.factoryCode ? factoryIds.get(u.factoryCode) : null,
        isActive: true, passwordHash,
      },
      create: {
        enterpriseId: enterprise.id,
        factoryId: u.factoryCode ? factoryIds.get(u.factoryCode) : null,
        email: u.email, name: u.name, nameAr: u.nameAr, passwordHash,
        role: u.role as any, jobTitle: u.jobTitle, language: 'en',
      },
    });
  }
  step(`${DEMO_USERS.length} users (password: ${DEMO_PASSWORD})`);

  // ── Summary ─────────────────────────────────────────────────────────────
  log('\n╔══════════════════════════════════════════════════════════════╗');
  log('║  Seed complete                                               ║');
  log('╚══════════════════════════════════════════════════════════════╝\n');
  console.table(plantSummary());

  log('\nSign in with any of these — all use the same password:\n');
  log(`   admin@industry360.sa                 SUPER_ADMIN, every factory`);
  log(`   executive@industry360.sa             group operations view`);
  for (const f of FACTORIES) {
    log(`   plant.${f.code.toLowerCase()}@industry360.sa${' '.repeat(Math.max(0, 24 - f.code.length))}plant manager, ${f.code}`);
  }
  log(`\n   password: ${DEMO_PASSWORD}`);
  log('\nThese accounts have published passwords. They are demonstration');
  log('accounts and must not survive into anything real.\n');
}

main()
  .catch((e) => {
    console.error('\n✖ Seed failed:\n', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
