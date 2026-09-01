import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { plantDayKey, plantHourKey, plantWeekKey } from '../../common/plant-time.util';
import { smallestLadderUnit } from '../../common/units.util';
import { FINAL_STEP } from '../production/kpi.service';

/**
 * EnergyAnalyticsService — multi-dimensional energy analysis.
 *
 * Answers "how many kWh per <dimension>, and how many kWh per unit produced",
 * where <dimension> is any of product, work order, production order, machine,
 * line, area, shift, or a time bucket.
 *
 * ── Where the numbers come from ─────────────────────────────────────────
 * Numerator (kWh): `EnergyReading`. `value` is a cumulative meter total, so
 * consumption is the sum of forward deltas **per meter**; a negative delta means
 * a meter reset and is ignored rather than subtracted. Each interval is
 * attributed to the machine state at its START (zero-order hold) — the same
 * convention as EnergyContextService and EnergyWoMachineService.
 *
 * Denominator (units produced): `ProductionSnapshot` where available — it is the
 * dimension-complete fact store (skuId, shiftInstanceId, machineId, workOrderId,
 * base-unit-normalised counts per bucket) and the only source that can give a
 * correct denominator for *every* grouping. Where no snapshots exist it falls
 * back to `WorkOrder.goodQty`, and each row reports which source was used so a
 * coarser number is never mistaken for a precise one.
 *
 * ── Dimensions that must be derived ─────────────────────────────────────
 * `EnergyReading.lineId` and `.shiftInstanceId` are nullable and in practice
 * unpopulated, so line/area come from the reading's machine, and shift is
 * resolved by matching the reading timestamp against ShiftInstance windows.
 * Grouping never trusts a column that the ingestion path does not fill.
 */

export type EnergyGroupBy =
  | 'sku'
  | 'workOrder'
  | 'productionOrder'
  | 'machine'
  | 'line'
  | 'area'
  | 'shift'
  | 'hour'
  | 'day'
  | 'week';

export interface EnergyAnalyticsFilters {
  from: Date;
  to: Date;
  areaId?: string;
  lineId?: string;
  machineId?: string;
  skuId?: string;
  workOrderId?: string;
}

export interface EnergyAnalyticsRow {
  key: string;
  label: string;
  subLabel: string | null;
  totalKwh: number;
  runningKwh: number;
  idleKwh: number;
  downtimeKwh: number;
  /** (idle + downtime) / total × 100 — energy that produced nothing. */
  wastePct: number | null;
  goodQty: number | null;
  outputUnit: string | null;
  /** The headline ratio. */
  kwhPerUnit: number | null;
  kwhPerKg: number | null;
  /** Ratio counting only energy spent while actually running. */
  productiveKwhPerUnit: number | null;
  cost: number | null;
  costPerUnit: number | null;
  avgPowerKw: number | null;
  peakPowerKw: number | null;
  runMinutes: number;
  /** Share of the window's total kWh, %. */
  sharePct: number;
  /** Where goodQty came from, so a fallback number is never read as precise. */
  qtySource: 'SNAPSHOT' | 'WORK_ORDER' | 'NONE';
}

const round = (n: number | null | undefined, dp: number): number | null => {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

const RUNNING_STATES = new Set(['RUNNING']);
const IDLE_STATES = new Set(['IDLE', 'STARVED', 'BLOCKED']);

interface Bucket {
  key: string;
  label: string;
  subLabel: string | null;
  total: number;
  running: number;
  idle: number;
  downtime: number;
  powerSum: number;
  powerN: number;
  peak: number;
  runMs: number;
  meters: Set<string>;
}

@Injectable()
export class EnergyAnalyticsService {
  private readonly logger = new Logger(EnergyAnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async analyse(
    factoryId: string | null,
    groupBy: EnergyGroupBy,
    filters: EnergyAnalyticsFilters,
  ): Promise<{
    groupBy: EnergyGroupBy;
    from: string;
    to: string;
    rows: EnergyAnalyticsRow[];
    totals: {
      totalKwh: number;
      runningKwh: number;
      idleKwh: number;
      downtimeKwh: number;
      wastePct: number | null;
      goodQty: number | null;
      outputUnit: string | null;
      kwhPerUnit: number | null;
      cost: number | null;
      groups: number;
      readingCount: number;
    };
    currency: string;
    qtySource: 'SNAPSHOT' | 'WORK_ORDER' | 'NONE';
    /** Energy that exists but could not be placed in the chosen dimension. */
    unattributed: { intervals: number; kwh: number };
  }> {
    const { from, to } = filters;

    // ── 1. Resolve the machine scope once; every grouping filters through it ──
    const machineWhere: Record<string, unknown> = { ...(factoryId ? { factoryId } : {}) };
    if (filters.machineId) machineWhere.id = filters.machineId;
    else if (filters.lineId) machineWhere.lineId = filters.lineId;
    else if (filters.areaId) machineWhere.areaId = filters.areaId;

    const machines = await this.prisma.machine.findMany({
      where: machineWhere,
      select: {
        id: true,
        code: true,
        name: true,
        lineId: true,
        areaId: true,
        line: { select: { id: true, code: true, name: true } },
        area: { select: { id: true, code: true, name: true } },
      },
    });
    if (machines.length === 0) return this.empty(groupBy, from, to);
    const machineById = new Map(machines.map((m) => [m.id, m]));

    // ── 2. Readings in window + scope ────────────────────────────────────
    const readings = await this.prisma.energyReading.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        machineId: { in: machines.map((m) => m.id) },
        timestamp: { gte: from, lte: to },
        ...(filters.workOrderId ? { workOrderId: filters.workOrderId } : {}),
      },
      select: {
        meterId: true,
        machineId: true,
        workOrderId: true,
        timestamp: true,
        value: true,
        powerKw: true,
        machineState: true,
      },
      orderBy: { timestamp: 'asc' },
    });
    if (readings.length < 2) return this.empty(groupBy, from, to);

    // ── 3. Context needed to label and group ─────────────────────────────
    const woIds = [...new Set(readings.map((r) => r.workOrderId).filter(Boolean))] as string[];
    const workOrders = woIds.length
      ? await this.prisma.workOrder.findMany({
          where: { id: { in: woIds } },
          select: {
            id: true,
            orderNumber: true,
            skuId: true,
            productionOrderId: true,
            goodQty: true,
            shiftInstanceId: true,
            productionOrder: { select: { id: true, orderNumber: true } },
            sku: {
              select: {
                id: true,
                code: true,
                itemNumber: true,
                name: true,
                baseUnit: true,
                weight: true,
                innersPerCarton: true,
              },
            },
          },
        })
      : [];
    const woById = new Map(workOrders.map((w) => [w.id, w]));

    // Shift attribution is by time window — readings never carry shiftInstanceId.
    const shifts =
      groupBy === 'shift'
        ? await this.prisma.shiftInstance.findMany({
            where: {
              ...(factoryId ? { factoryId } : {}),
              startTime: { lte: to },
              OR: [{ endTime: null }, { endTime: { gte: from } }],
            },
            select: {
              id: true,
              startTime: true,
              endTime: true,
              shiftDate: true,
              shiftTemplate: { select: { code: true, name: true } },
            },
            orderBy: { startTime: 'asc' },
          })
        : [];

    if (filters.skuId) {
      // Keep only readings whose WO makes the requested product.
      const allowed = new Set(workOrders.filter((w) => w.skuId === filters.skuId).map((w) => w.id));
      for (let i = readings.length - 1; i >= 0; i--) {
        if (!readings[i].workOrderId || !allowed.has(readings[i].workOrderId!)) readings.splice(i, 1);
      }
      if (readings.length < 2) return this.empty(groupBy, from, to);
    }

    // ── 4. Integrate per meter, attribute each interval to its group ─────
    const buckets = new Map<string, Bucket>();
    // Intervals that carry energy but cannot be placed in this dimension — e.g.
    // grouping by product when the reading's work order was deleted. Counting them
    // separately is what lets the UI distinguish "no data" from "data that cannot
    // be attributed", which are very different problems.
    let unattributedIntervals = 0;
    let unattributedKwh = 0;
    const byMeter = new Map<string, typeof readings>();
    for (const r of readings) {
      const l = byMeter.get(r.meterId);
      if (l) l.push(r);
      else byMeter.set(r.meterId, [r]);
    }

    const touch = (key: string, label: string, subLabel: string | null): Bucket => {
      let b = buckets.get(key);
      if (!b) {
        b = { key, label, subLabel, total: 0, running: 0, idle: 0, downtime: 0, powerSum: 0, powerN: 0, peak: 0, runMs: 0, meters: new Set() };
        buckets.set(key, b);
      }
      return b;
    };

    for (const list of byMeter.values()) {
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const curr = list[i];
        const deltaKwh = Math.max(0, curr.value - prev.value); // negative = meter reset
        const spanMs = Math.max(0, curr.timestamp.getTime() - prev.timestamp.getTime());
        const state = prev.machineState ?? 'UNKNOWN'; // zero-order hold

        const g = this.groupOf(groupBy, prev, machineById, woById, shifts);
        if (!g) {
          unattributedIntervals++;
          unattributedKwh += deltaKwh;
          continue;
        }

        const b = touch(g.key, g.label, g.subLabel);
        b.meters.add(curr.meterId);
        b.total += deltaKwh;
        if (RUNNING_STATES.has(state)) {
          b.running += deltaKwh;
          b.runMs += spanMs;
        } else if (IDLE_STATES.has(state)) b.idle += deltaKwh;
        else if (state !== 'UNKNOWN') b.downtime += deltaKwh;

        const kw = curr.powerKw ?? 0;
        if (kw > b.peak) b.peak = kw;
        if (kw > 0) {
          b.powerSum += kw;
          b.powerN += 1;
        }
      }
    }
    if (buckets.size === 0) {
      return {
        ...this.empty(groupBy, from, to),
        totals: { ...this.empty(groupBy, from, to).totals, readingCount: readings.length },
        unattributed: { intervals: unattributedIntervals, kwh: round(unattributedKwh, 3)! },
      };
    }

    // ── 5. Denominators ──────────────────────────────────────────────────
    const { qtyByKey, source } = await this.denominators(
      factoryId,
      groupBy,
      filters,
      machines.map((m) => m.id),
      woById,
      shifts,
    );

    // ── 6. Cost — one factory-default electrical tariff is enough here;
    //      per-machine tariffs are resolved in EnergyService.getOverview. ──
    const tariff = await this.prisma.energyTariff.findFirst({
      where: { ...(factoryId ? { factoryId } : {}), energyType: 'ELECTRICAL', isActive: true },
      orderBy: [{ machineId: 'desc' }, { lineId: 'desc' }, { areaId: 'desc' }],
      select: { ratePerUnit: true, currency: true },
    });
    const rate = tariff?.ratePerUnit ?? null;

    // Unit metadata — taken from the SKUs actually seen, so labels stay honest.
    const anySku = workOrders.find((w) => w.sku)?.sku ?? null;
    // The denominator is `goodBase`, which holds PIECES. Labelling it with the SKU
    // INVENTORY base unit (CARTON) reported kWh-per-piece under a heading that said
    // per-carton — wrong by the whole packaging ladder. The unit name is derived
    // from the packaging, exactly like every other quantity label in the system.
    const outputUnit = anySku ? smallestLadderUnit(anySku) : null;
    // kg per PIECE. This used to multiply by innersPerCarton to get kg-per-CARTON,
    // which only lined up while the denominator was itself a carton count.
    const kgPerUnit = anySku?.weight ?? null;

    const grandTotal = [...buckets.values()].reduce((s, b) => s + b.total, 0);

    const rows: EnergyAnalyticsRow[] = [...buckets.values()]
      .map((b) => {
        const q = qtyByKey.get(b.key) ?? null;
        const good = q && q.qty > 0 ? q.qty : null;
        const waste = b.idle + b.downtime;
        const runHours = b.runMs / 3_600_000;
        return {
          key: b.key,
          label: b.label,
          subLabel: b.subLabel,
          totalKwh: round(b.total, 3)!,
          runningKwh: round(b.running, 3)!,
          idleKwh: round(b.idle, 3)!,
          downtimeKwh: round(b.downtime, 3)!,
          wastePct: b.total > 0 ? round((waste / b.total) * 100, 1) : null,
          goodQty: good,
          outputUnit,
          kwhPerUnit: good ? round(b.total / good, 4) : null,
          kwhPerKg: good && kgPerUnit ? round(b.total / (good * kgPerUnit), 5) : null,
          productiveKwhPerUnit: good ? round(b.running / good, 4) : null,
          cost: rate != null ? round(b.total * rate, 2) : null,
          costPerUnit: rate != null && good ? round((b.total * rate) / good, 4) : null,
          avgPowerKw: b.powerN > 0 ? round(b.powerSum / b.powerN, 2) : null,
          peakPowerKw: b.peak > 0 ? round(b.peak, 2) : null,
          runMinutes: round(b.runMs / 60_000, 1)!,
          sharePct: grandTotal > 0 ? round((b.total / grandTotal) * 100, 1)! : 0,
          qtySource: (q?.source ?? 'NONE') as EnergyAnalyticsRow['qtySource'],
        };
      })
      // Time groupings read chronologically; everything else ranks by consumption.
      .sort((a, z) =>
        ['hour', 'day', 'week'].includes(groupBy) ? a.key.localeCompare(z.key) : z.totalKwh - a.totalKwh,
      );

    const tRunning = rows.reduce((s, r) => s + r.runningKwh, 0);
    const tIdle = rows.reduce((s, r) => s + r.idleKwh, 0);
    const tDown = rows.reduce((s, r) => s + r.downtimeKwh, 0);
    const tGood = rows.reduce((s, r) => s + (r.goodQty ?? 0), 0);

    return {
      groupBy,
      from: from.toISOString(),
      to: to.toISOString(),
      rows,
      totals: {
        totalKwh: round(grandTotal, 3)!,
        runningKwh: round(tRunning, 3)!,
        idleKwh: round(tIdle, 3)!,
        downtimeKwh: round(tDown, 3)!,
        wastePct: grandTotal > 0 ? round(((tIdle + tDown) / grandTotal) * 100, 1) : null,
        goodQty: tGood > 0 ? round(tGood, 2) : null,
        outputUnit,
        kwhPerUnit: tGood > 0 ? round(grandTotal / tGood, 4) : null,
        cost: rate != null ? round(grandTotal * rate, 2) : null,
        groups: rows.length,
        readingCount: readings.length,
      },
      currency: tariff?.currency ?? 'SAR',
      qtySource: source,
      unattributed: { intervals: unattributedIntervals, kwh: round(unattributedKwh, 3)! },
    };
  }

  // ── grouping ───────────────────────────────────────────────────────────

  private groupOf(
    groupBy: EnergyGroupBy,
    r: { machineId: string | null; workOrderId: string | null; timestamp: Date },
    machineById: Map<string, any>,
    woById: Map<string, any>,
    shifts: Array<{ id: string; startTime: Date; endTime: Date | null; shiftDate: Date; shiftTemplate: { code: string; name: string } | null }>,
  ): { key: string; label: string; subLabel: string | null } | null {
    const m = r.machineId ? machineById.get(r.machineId) : null;
    const wo = r.workOrderId ? woById.get(r.workOrderId) : null;

    switch (groupBy) {
      case 'machine':
        return m ? { key: m.id, label: m.name, subLabel: m.code } : null;
      case 'line':
        // Derived from the machine — EnergyReading.lineId is not populated.
        return m?.line ? { key: m.line.id, label: m.line.name, subLabel: m.line.code } : null;
      case 'area':
        return m?.area ? { key: m.area.id, label: m.area.name, subLabel: m.area.code } : null;
      case 'workOrder':
        return wo ? { key: wo.id, label: wo.orderNumber, subLabel: wo.sku?.name ?? null } : null;
      case 'productionOrder':
        return wo?.productionOrder
          ? { key: wo.productionOrder.id, label: wo.productionOrder.orderNumber, subLabel: wo.sku?.name ?? null }
          : null;
      case 'sku':
        return wo?.sku
          ? { key: wo.sku.id, label: wo.sku.name, subLabel: wo.sku.itemNumber ?? wo.sku.code }
          : null;
      case 'shift': {
        const t = r.timestamp.getTime();
        const s = shifts.find(
          (x) => x.startTime.getTime() <= t && (x.endTime ? x.endTime.getTime() >= t : true),
        );
        if (!s) return null;
        // Label from startTime, not shiftDate: shiftDate is stored as local
        // midnight expressed in UTC (e.g. 2026-07-27T21:00Z for the 28th in
        // Riyadh), so slicing it directly shows the previous day.
        const day = plantDayKey(s.startTime);
        return {
          key: s.id,
          label: `${s.shiftTemplate?.name ?? 'Shift'} · ${day}`,
          subLabel: s.shiftTemplate?.code ?? null,
        };
      }
      case 'hour': {
        const k = plantHourKey(r.timestamp);
        return { key: k, label: `${k.replace('T', ' ')}:00`, subLabel: null };
      }
      case 'day': {
        const k = plantDayKey(r.timestamp);
        return { key: k, label: k, subLabel: null };
      }
      case 'week': {
        const k = plantWeekKey(r.timestamp);
        return { key: k, label: `Week of ${k}`, subLabel: null };
      }
      default:
        return null;
    }
  }

  // ── denominators ───────────────────────────────────────────────────────

  /**
   * Units produced per group key — the denominator of kWh per unit.
   *
   * ── The read this replaced, and why it never fired ──────────────────────────
   * This queried `production_snapshots` with `granularity: 'HOUR'`. Nothing has
   * ever written a row at that grain: the writer emits MINUTE and only MINUTE,
   * and the hourly and daily rollups were deferred and never built. So the
   * filter matched zero rows on every request, since the day it was written, and
   * the method fell silently through to the work-order fallback below.
   *
   * The fallback is honest about itself — it reports `WORK_ORDER` and refuses
   * the groupings it cannot answer — which is why this went unnoticed: nothing
   * ever showed a wrong number, it just never showed the precise one. Energy
   * intensity has been a work-order average for its whole life while the code
   * around it described a minute-grain fact store.
   *
   * It now reads `oee_minutes`, the one store, at the grain that store actually
   * keeps. `isFinalStep` is not a column there; the final step is
   * `MAX(sequenceOrder)` per work order, which is the same rule every engine
   * applies — a unit passing four stations is one unit, not four.
   */
  private async denominators(
    factoryId: string | null,
    groupBy: EnergyGroupBy,
    filters: EnergyAnalyticsFilters,
    machineIds: string[],
    woById: Map<string, any>,
    shifts: Array<{ id: string; startTime: Date; endTime: Date | null }>,
  ): Promise<{ qtyByKey: Map<string, { qty: number; source: 'SNAPSHOT' | 'WORK_ORDER' }>; source: 'SNAPSHOT' | 'WORK_ORDER' | 'NONE' }> {
    const qtyByKey = new Map<string, { qty: number; source: 'SNAPSHOT' | 'WORK_ORDER' }>();

    // Only the final routing step's output counts, or a routed work order's
    // units are counted once per step. The dimensions the old store carried as
    // columns are joined here instead — `oee_minutes` keeps the measurement and
    // leaves the hierarchy where it is defined.
    const rows = await this.prisma.$queryRaw<Array<{
      goodBase: number; machineId: string | null; lineId: string | null;
      areaId: string | null; skuId: string | null; workOrderId: string | null;
      productionOrderId: string | null; shiftCode: string | null; bucketStart: Date;
    }>>(Prisma.sql`
      WITH scoped AS (
        SELECT o."machineId", o."workOrderId", o."bucketStart", o."shiftCode",
               o."goodParts", j."sequenceOrder",
               (j."bypassedAt" IS NOT NULL) AS bypassed
        FROM oee_minutes o
        JOIN job_orders j ON j.id = o."jobOrderId"
        WHERE o."machineId" IN (${Prisma.join(machineIds)})
          AND o."bucketStart" >= ${filters.from} AND o."bucketStart" <= ${filters.to}
          ${factoryId ? Prisma.sql`AND o."factoryId" = ${factoryId}` : Prisma.empty}
      ),
      -- The last step of each work order. Its good count IS the work order's
      -- output; the earlier steps made the same units. This query builds its own
      -- scoped set rather than reading MINUTE_FACTS, so the shared FINAL_STEP
      -- fragment is applied here over the same two columns it needs.
      fin AS (
        SELECT s2."workOrderId", ${FINAL_STEP} AS ms
        FROM scoped s2 GROUP BY s2."workOrderId"
      )
      SELECT s."goodParts"::float8 AS "goodBase",
             s."machineId", m."lineId", l."areaId",
             w."skuId", s."workOrderId", w."productionOrderId",
             s."shiftCode", s."bucketStart"
      FROM scoped s
      JOIN fin f ON f."workOrderId" IS NOT DISTINCT FROM s."workOrderId"
                AND f.ms = s."sequenceOrder"
      LEFT JOIN machines m ON m.id = s."machineId"
      LEFT JOIN production_lines l ON l.id = m."lineId"
      LEFT JOIN work_orders w ON w.id = s."workOrderId"
    `);

    if (rows.length > 0) {
      for (const r of rows) {
        const key = this.snapshotKey(groupBy, r);
        if (!key) continue;
        const cur = qtyByKey.get(key);
        if (cur) cur.qty += r.goodBase;
        else qtyByKey.set(key, { qty: r.goodBase, source: 'SNAPSHOT' });
      }
      if (qtyByKey.size > 0) return { qtyByKey, source: 'SNAPSHOT' };
    }

    // ── Fallback: WorkOrder.goodQty ──────────────────────────────────────
    // A work order's output is a single figure for its whole run, so it cannot be
    // split across time buckets or machines. Only the groupings it can answer
    // honestly get a denominator; the rest are left null rather than guessed at.
    const canFallback = ['workOrder', 'productionOrder', 'sku', 'shift'].includes(groupBy);
    if (!canFallback) return { qtyByKey, source: 'NONE' };

    for (const wo of woById.values()) {
      const qty = wo.goodQty ?? 0;
      if (qty <= 0) continue;
      let key: string | null = null;
      if (groupBy === 'workOrder') key = wo.id;
      else if (groupBy === 'productionOrder') key = wo.productionOrder?.id ?? null;
      else if (groupBy === 'sku') key = wo.skuId ?? null;
      else if (groupBy === 'shift') key = wo.shiftInstanceId ?? null;
      if (!key) continue;
      const cur = qtyByKey.get(key);
      if (cur) cur.qty += qty;
      else qtyByKey.set(key, { qty, source: 'WORK_ORDER' });
    }

    return { qtyByKey, source: qtyByKey.size > 0 ? 'WORK_ORDER' : 'NONE' };
  }

  private snapshotKey(groupBy: EnergyGroupBy, s: Record<string, any>): string | null {
    switch (groupBy) {
      case 'machine': return s.machineId ?? null;
      case 'line': return s.lineId ?? null;
      case 'area': return s.areaId ?? null;
      case 'sku': return s.skuId ?? null;
      case 'workOrder': return s.workOrderId ?? null;
      case 'productionOrder': return s.productionOrderId ?? null;
      // Derived shift code first — ShiftInstance rows are not created, so keying on
      // them alone put every bucket into one nameless group.
      case 'shift': return s.shiftCode ?? s.shiftInstanceId ?? null;
      case 'hour': return plantHourKey(s.bucketStart as Date);
      case 'day': return plantDayKey(s.bucketStart as Date);
      case 'week': return plantWeekKey(s.bucketStart as Date);
      default: return null;
    }
  }

  private empty(groupBy: EnergyGroupBy, from: Date, to: Date) {
    return {
      groupBy,
      from: from.toISOString(),
      to: to.toISOString(),
      rows: [] as EnergyAnalyticsRow[],
      totals: {
        totalKwh: 0, runningKwh: 0, idleKwh: 0, downtimeKwh: 0,
        wastePct: null, goodQty: null, outputUnit: null, kwhPerUnit: null,
        cost: null, groups: 0, readingCount: 0,
      },
      currency: 'SAR',
      qtySource: 'NONE' as const,
      unattributed: { intervals: 0, kwh: 0 },
    };
  }

  /** Distinct products and work orders seen in the window — feeds the filter tree. */
  async getFilterOptions(factoryId: string | null, from: Date, to: Date) {
    const readings = await this.prisma.energyReading.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        timestamp: { gte: from, lte: to },
        workOrderId: { not: null },
      },
      select: { workOrderId: true },
      distinct: ['workOrderId'],
    });
    const woIds = readings.map((r) => r.workOrderId!).filter(Boolean);

    const workOrders = woIds.length
      ? await this.prisma.workOrder.findMany({
          where: { id: { in: woIds } },
          select: {
            id: true,
            orderNumber: true,
            sku: { select: { id: true, name: true, itemNumber: true } },
          },
          orderBy: { orderNumber: 'asc' },
        })
      : [];

    const skus = new Map<string, { id: string; label: string; sub: string | null }>();
    for (const w of workOrders) {
      if (w.sku) skus.set(w.sku.id, { id: w.sku.id, label: w.sku.name, sub: w.sku.itemNumber });
    }

    return {
      workOrders: workOrders.map((w) => ({ id: w.id, label: w.orderNumber, sub: w.sku?.name ?? null })),
      skus: [...skus.values()],
    };
  }
}
