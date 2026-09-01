import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

/**
 * EnergyWoMachineService — the energy-ratio KPI, resolved to WORK ORDER × MACHINE.
 *
 * `EnergyWOSummary` (see EnergyContextService) answers "what did this work order
 * cost in kWh". It is keyed on the work order alone, so it cannot say which
 * machine spent the energy. This service adds the machine dimension, which is what
 * makes the number actionable: specific energy consumption becomes comparable
 * machine-to-machine on one order, and order-to-order on one machine.
 *
 * Source data is `EnergyReading`, which already carries `workOrderId`, `machineId`
 * and a `machineState` snapshot — stamped at ingestion by
 * `EnergyContextService.enrichEnergyReading()`. Nothing here writes readings; it
 * only aggregates them.
 *
 * The existing per-WO summary and its algorithm are left untouched.
 */

/** Meter `value` is a cumulative total, so consumption is the sum of forward deltas. */
interface ReadingLite {
  machineId: string | null;
  meterId: string;
  timestamp: Date;
  value: number;
  powerKw: number | null;
  machineState: string | null;
}

export interface EnergyRatioRow {
  machineId: string;
  machineCode: string;
  machineName: string;
  meterCount: number;
  totalKwh: number;
  runningKwh: number;
  idleKwh: number;
  downtimeKwh: number;
  /** The headline energy ratio — kWh per unit of good output. */
  kwhPerUnit: number | null;
  kwhPerKg: number | null;
  kwhPerRunHour: number | null;
  /** kWh per unit counting only energy spent while actually producing. */
  productiveKwhPerUnit: number | null;
  /** Share of energy that produced nothing: (idle + downtime) / total × 100. */
  wastePct: number | null;
  /** Best kwhPerUnit previously demonstrated on this machine for this SKU. */
  baselineKwhPerUnit: number | null;
  /** (ratio − baseline) / baseline × 100. Positive = worse than best. */
  variancePct: number | null;
  peakPowerKw: number | null;
  avgPowerKw: number | null;
  goodQty: number | null;
  outputUnit: string | null;
  runMinutes: number;
}

const round = (n: number | null | undefined, dp: number): number | null => {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** States in which the machine is producing. Anything else is non-productive. */
const RUNNING_STATES = new Set(['RUNNING']);
const IDLE_STATES = new Set(['IDLE', 'STARVED', 'BLOCKED']);

@Injectable()
export class EnergyWoMachineService {
  private readonly logger = new Logger(EnergyWoMachineService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── identity ─────────────────────────────────────────────────────────

  /**
   * Accept either a work order's UUID or its human order number ("WO-2026-0007").
   * Operators read and type the order number — requiring the internal id would
   * make every one of these routes unusable by hand.
   */
  async resolveWorkOrderId(idOrOrderNumber: string): Promise<string | null> {
    const wo = await this.prisma.workOrder.findFirst({
      where: { OR: [{ id: idOrOrderNumber }, { orderNumber: idOrOrderNumber }] },
      select: { id: true },
    });
    return wo?.id ?? null;
  }

  // ── computation ──────────────────────────────────────────────────────

  /**
   * Recompute and persist the per-machine energy ratios for one work order.
   * Accepts a UUID or an order number. Returns the rows it wrote (empty when the
   * WO has no usable readings).
   */
  async recomputeForWorkOrder(idOrOrderNumber: string): Promise<EnergyRatioRow[]> {
    const wo = await this.prisma.workOrder.findFirst({
      where: { OR: [{ id: idOrOrderNumber }, { orderNumber: idOrOrderNumber }] },
      select: {
        id: true,
        factoryId: true,
        goodQty: true,
        actualStart: true,
        actualEnd: true,
        sku: { select: { id: true, baseUnit: true, weight: true, innersPerCarton: true } },
      },
    });
    if (!wo) return [];
    const workOrderId = wo.id;

    const readings = (await this.prisma.energyReading.findMany({
      where: { workOrderId, machineId: { not: null } },
      select: {
        machineId: true,
        meterId: true,
        timestamp: true,
        value: true,
        powerKw: true,
        machineState: true,
      },
      orderBy: { timestamp: 'asc' },
    })) as ReadingLite[];

    if (readings.length < 2) {
      this.logger.debug(`WO ${workOrderId}: fewer than 2 contextualised energy readings — nothing to compute`);
      return [];
    }

    // A cumulative counter only means anything within one meter, so deltas are
    // taken per meter and then attributed to the machine that meter serves.
    const byMachine = new Map<
      string,
      {
        meters: Set<string>;
        total: number;
        running: number;
        idle: number;
        downtime: number;
        peakKw: number;
        powerSum: number;
        powerN: number;
        runMs: number;
      }
    >();

    const byMeter = new Map<string, ReadingLite[]>();
    for (const r of readings) {
      if (!r.machineId) continue;
      const list = byMeter.get(r.meterId);
      if (list) list.push(r);
      else byMeter.set(r.meterId, [r]);
    }

    for (const list of byMeter.values()) {
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const curr = list[i];
        const machineId = curr.machineId ?? prev.machineId;
        if (!machineId) continue;

        // Negative deltas mean a meter reset or rollover — ignore rather than
        // subtract, which would silently understate consumption.
        const deltaKwh = Math.max(0, curr.value - prev.value);
        // Zero-order hold: a state sample describes the machine FROM its timestamp
        // until the next sample says otherwise, so an interval is attributed to the
        // state read at its START. Same convention as EnergyContextService, which
        // keeps this table consistent with EnergyWOSummary.
        const state = prev.machineState ?? 'UNKNOWN';
        const spanMs = Math.max(0, curr.timestamp.getTime() - prev.timestamp.getTime());

        let acc = byMachine.get(machineId);
        if (!acc) {
          acc = { meters: new Set(), total: 0, running: 0, idle: 0, downtime: 0, peakKw: 0, powerSum: 0, powerN: 0, runMs: 0 };
          byMachine.set(machineId, acc);
        }
        acc.meters.add(curr.meterId);
        acc.total += deltaKwh;
        if (RUNNING_STATES.has(state)) {
          acc.running += deltaKwh;
          acc.runMs += spanMs;
        } else if (IDLE_STATES.has(state)) {
          acc.idle += deltaKwh;
        } else if (state !== 'UNKNOWN') {
          acc.downtime += deltaKwh;
        }

        const kw = curr.powerKw ?? 0;
        if (kw > acc.peakKw) acc.peakKw = kw;
        if (kw > 0) {
          acc.powerSum += kw;
          acc.powerN += 1;
        }
      }
    }

    if (byMachine.size === 0) return [];

    const machines = await this.prisma.machine.findMany({
      where: { id: { in: [...byMachine.keys()] } },
      select: { id: true, code: true, name: true },
    });
    const machineById = new Map(machines.map((m) => [m.id, m]));

    // Denominator for the ratio. goodQty is in the SKU base unit (CARTON for the
    // powder lines), and kg comes from the pack weight × packs per carton.
    const goodQty = wo.goodQty > 0 ? wo.goodQty : null;
    const outputUnit = wo.sku?.baseUnit ?? null;
    const kgPerUnit =
      wo.sku?.weight && wo.sku?.innersPerCarton ? wo.sku.weight * wo.sku.innersPerCarton : null;
    const totalKg = goodQty && kgPerUnit ? goodQty * kgPerUnit : null;

    const rows: EnergyRatioRow[] = [];

    for (const [machineId, acc] of byMachine) {
      const m = machineById.get(machineId);
      if (!m) continue;

      const runHours = acc.runMs / 3_600_000;
      const wasteKwh = acc.idle + acc.downtime;

      const kwhPerUnit = goodQty ? acc.total / goodQty : null;
      const productiveKwhPerUnit = goodQty ? acc.running / goodQty : null;

      const baseline = wo.sku?.id
        ? await this.baselineFor(machineId, wo.sku.id, workOrderId)
        : null;

      rows.push({
        machineId,
        machineCode: m.code,
        machineName: m.name,
        meterCount: acc.meters.size,
        totalKwh: round(acc.total, 3)!,
        runningKwh: round(acc.running, 3)!,
        idleKwh: round(acc.idle, 3)!,
        downtimeKwh: round(acc.downtime, 3)!,
        kwhPerUnit: round(kwhPerUnit, 4),
        kwhPerKg: totalKg ? round(acc.total / totalKg, 5) : null,
        kwhPerRunHour: runHours > 0 ? round(acc.total / runHours, 3) : null,
        productiveKwhPerUnit: round(productiveKwhPerUnit, 4),
        wastePct: acc.total > 0 ? round((wasteKwh / acc.total) * 100, 1) : null,
        baselineKwhPerUnit: round(baseline, 4),
        variancePct:
          baseline && baseline > 0 && kwhPerUnit != null
            ? round(((kwhPerUnit - baseline) / baseline) * 100, 1)
            : null,
        peakPowerKw: acc.peakKw > 0 ? round(acc.peakKw, 2) : null,
        avgPowerKw: acc.powerN > 0 ? round(acc.powerSum / acc.powerN, 2) : null,
        goodQty,
        outputUnit,
        runMinutes: round(acc.runMs / 60_000, 1)!,
      });
    }

    await this.persist(wo.factoryId, workOrderId, rows);
    this.logger.log(
      `WO ${workOrderId}: energy ratio computed for ${rows.length} machine(s) — ` +
        rows.map((r) => `${r.machineCode} ${r.kwhPerUnit ?? '—'} kWh/${r.outputUnit ?? 'unit'}`).join(', '),
    );
    return rows;
  }

  /**
   * Best (lowest) kWh-per-unit this machine has previously achieved on this SKU,
   * excluding the order being computed. Used as the comparison baseline so drift is
   * measured against demonstrated best rather than an arbitrary target.
   */
  private async baselineFor(machineId: string, skuId: string, excludeWorkOrderId: string): Promise<number | null> {
    const prior = await this.prisma.energyWOMachineKpi.findFirst({
      where: {
        machineId,
        workOrderId: { not: excludeWorkOrderId },
        kwhPerUnit: { gt: 0 },
        workOrder: { skuId },
      },
      orderBy: { kwhPerUnit: 'asc' },
      select: { kwhPerUnit: true },
    });
    return prior?.kwhPerUnit ?? null;
  }

  private async persist(factoryId: string, workOrderId: string, rows: EnergyRatioRow[]): Promise<void> {
    for (const r of rows) {
      const data = {
        factoryId,
        meterCount: r.meterCount,
        totalKwh: r.totalKwh,
        runningKwh: r.runningKwh,
        idleKwh: r.idleKwh,
        downtimeKwh: r.downtimeKwh,
        kwhPerUnit: r.kwhPerUnit,
        kwhPerKg: r.kwhPerKg,
        kwhPerRunHour: r.kwhPerRunHour,
        productiveKwhPerUnit: r.productiveKwhPerUnit,
        wastePct: r.wastePct,
        baselineKwhPerUnit: r.baselineKwhPerUnit,
        variancePct: r.variancePct,
        peakPowerKw: r.peakPowerKw,
        avgPowerKw: r.avgPowerKw,
        goodQty: r.goodQty,
        outputUnit: r.outputUnit,
        runMinutes: r.runMinutes,
        computedAt: new Date(),
      };
      await this.prisma.energyWOMachineKpi.upsert({
        where: { workOrderId_machineId: { workOrderId, machineId: r.machineId } },
        update: data,
        create: { workOrderId, machineId: r.machineId, ...data },
      });
    }
  }

  /**
   * Recompute automatically when a work order closes.
   *
   * The event name must match what `production.service.completeWorkOrder()` emits:
   * `production.work-order.completed`, carrying `{ workOrder, factoryId }`.
   * (Note that `EnergyContextService` listens for `workorder.completed`, which
   * nothing emits — so its per-WO summary never fires automatically. Worth fixing
   * separately; it is outside this change.)
   */
  @OnEvent('production.work-order.completed')
  async onWorkOrderCompleted(payload: { workOrder?: { id?: string }; factoryId?: string }): Promise<void> {
    const workOrderId = payload?.workOrder?.id;
    if (!workOrderId) return;
    try {
      await this.recomputeForWorkOrder(workOrderId);
    } catch (err) {
      this.logger.error(`Energy ratio recompute failed for WO ${workOrderId}`, err as Error);
    }
  }

  // ── queries ──────────────────────────────────────────────────────────

  /**
   * Stored per-machine energy ratios for a work order. Recomputes on the fly when
   * nothing has been persisted yet, so a freshly loaded order is never blank.
   */
  async getForWorkOrder(idOrOrderNumber: string): Promise<{
    workOrderId: string | null;
    orderNumber: string | null;
    machines: EnergyRatioRow[];
    lineTotalKwh: number;
    lineKwhPerUnit: number | null;
    /** Why `machines` is empty — lets the UI explain itself instead of going blank. */
    status: 'OK' | 'WORK_ORDER_NOT_FOUND' | 'NO_METER_DATA';
  }> {
    const wo = await this.prisma.workOrder.findFirst({
      where: { OR: [{ id: idOrOrderNumber }, { orderNumber: idOrOrderNumber }] },
      select: { id: true, orderNumber: true, goodQty: true },
    });
    if (!wo) {
      return {
        workOrderId: null,
        orderNumber: null,
        machines: [],
        lineTotalKwh: 0,
        lineKwhPerUnit: null,
        status: 'WORK_ORDER_NOT_FOUND',
      };
    }
    const workOrderId = wo.id;

    let stored = await this.prisma.energyWOMachineKpi.findMany({
      where: { workOrderId },
      include: { machine: { select: { code: true, name: true } } },
      orderBy: { totalKwh: 'desc' },
    });

    if (stored.length === 0) {
      await this.recomputeForWorkOrder(workOrderId);
      stored = await this.prisma.energyWOMachineKpi.findMany({
        where: { workOrderId },
        include: { machine: { select: { code: true, name: true } } },
        orderBy: { totalKwh: 'desc' },
      });
    }

    const machines: EnergyRatioRow[] = stored.map((s) => ({
      machineId: s.machineId,
      machineCode: s.machine.code,
      machineName: s.machine.name,
      meterCount: s.meterCount,
      totalKwh: s.totalKwh,
      runningKwh: s.runningKwh,
      idleKwh: s.idleKwh,
      downtimeKwh: s.downtimeKwh,
      kwhPerUnit: s.kwhPerUnit,
      kwhPerKg: s.kwhPerKg,
      kwhPerRunHour: s.kwhPerRunHour,
      productiveKwhPerUnit: s.productiveKwhPerUnit,
      wastePct: s.wastePct,
      baselineKwhPerUnit: s.baselineKwhPerUnit,
      variancePct: s.variancePct,
      peakPowerKw: s.peakPowerKw,
      avgPowerKw: s.avgPowerKw,
      goodQty: s.goodQty,
      outputUnit: s.outputUnit,
      runMinutes: s.runMinutes,
    }));

    // The line total is the sum across machines; the line ratio divides it by the
    // WO's good output once — not by summing per-machine ratios, which would be
    // dimensionally wrong.
    const lineTotalKwh = round(
      machines.reduce((sum, m) => sum + m.totalKwh, 0),
      3,
    )!;
    const good = wo.goodQty ?? 0;

    return {
      workOrderId,
      orderNumber: wo.orderNumber,
      machines,
      lineTotalKwh,
      // null, not 0, when there is nothing to divide — "0 kWh/unit" would read as
      // a real measurement rather than an absence of data.
      lineKwhPerUnit: machines.length > 0 && good > 0 ? round(lineTotalKwh / good, 4) : null,
      status: machines.length > 0 ? 'OK' : 'NO_METER_DATA',
    };
  }

  /**
   * Energy-ratio trend for one machine across its recent work orders — the view
   * that shows whether specific consumption is drifting.
   */
  async getMachineTrend(
    machineId: string,
    factoryId: string | null,
    limit = 20,
  ): Promise<
    Array<{
      workOrderId: string;
      orderNumber: string;
      skuCode: string | null;
      computedAt: Date;
      kwhPerUnit: number | null;
      productiveKwhPerUnit: number | null;
      wastePct: number | null;
      totalKwh: number;
      goodQty: number | null;
      outputUnit: string | null;
    }>
  > {
    const rows = await this.prisma.energyWOMachineKpi.findMany({
      where: { machineId, ...(factoryId ? { factoryId } : {}) },
      orderBy: { computedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: {
        workOrder: { select: { orderNumber: true, sku: { select: { code: true } } } },
      },
    });

    return rows.map((r) => ({
      workOrderId: r.workOrderId,
      orderNumber: r.workOrder.orderNumber,
      skuCode: r.workOrder.sku?.code ?? null,
      computedAt: r.computedAt,
      kwhPerUnit: r.kwhPerUnit,
      productiveKwhPerUnit: r.productiveKwhPerUnit,
      wastePct: r.wastePct,
      totalKwh: r.totalKwh,
      goodQty: r.goodQty,
      outputUnit: r.outputUnit,
    }));
  }

  /**
   * Factory-wide leaderboard for the energy overview: the worst specific-energy
   * offenders in the window, so the page opens on what is worth acting on.
   */
  async getLeaderboard(
    factoryId: string | null,
    from: Date,
    to: Date,
    limit = 10,
  ): Promise<
    Array<{
      machineId: string;
      machineCode: string;
      machineName: string;
      orders: number;
      totalKwh: number;
      avgKwhPerUnit: number | null;
      avgWastePct: number | null;
      wasteKwh: number;
    }>
  > {
    const rows = await this.prisma.energyWOMachineKpi.findMany({
      where: { ...(factoryId ? { factoryId } : {}), computedAt: { gte: from, lte: to } },
      include: { machine: { select: { code: true, name: true } } },
    });

    const agg = new Map<
      string,
      { code: string; name: string; orders: number; total: number; ratioSum: number; ratioN: number; waste: number }
    >();
    for (const r of rows) {
      let a = agg.get(r.machineId);
      if (!a) {
        a = { code: r.machine.code, name: r.machine.name, orders: 0, total: 0, ratioSum: 0, ratioN: 0, waste: 0 };
        agg.set(r.machineId, a);
      }
      a.orders += 1;
      a.total += r.totalKwh;
      a.waste += r.idleKwh + r.downtimeKwh;
      if (r.kwhPerUnit != null) {
        a.ratioSum += r.kwhPerUnit;
        a.ratioN += 1;
      }
    }

    return [...agg.entries()]
      .map(([machineId, a]) => ({
        machineId,
        machineCode: a.code,
        machineName: a.name,
        orders: a.orders,
        totalKwh: round(a.total, 2)!,
        avgKwhPerUnit: a.ratioN > 0 ? round(a.ratioSum / a.ratioN, 4) : null,
        avgWastePct: a.total > 0 ? round((a.waste / a.total) * 100, 1) : null,
        wasteKwh: round(a.waste, 2)!,
      }))
      .sort((x, y) => (y.avgKwhPerUnit ?? -1) - (x.avgKwhPerUnit ?? -1))
      .slice(0, Math.min(Math.max(limit, 1), 50));
  }
}
