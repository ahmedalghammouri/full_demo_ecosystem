import { Injectable } from '@nestjs/common';
import { MINUTE_FACTS, FINAL_STEP } from './kpi.service';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';
import { toPieces } from '../../common/units.util';

/**
 * ScheduleKpiService — the two production KPIs the pilot site asked for, using the formulas
 * they supplied verbatim:
 *
 *   MSA = Σ min(Actual Qty, Scheduled Qty) ÷ Total Scheduled Qty × 100
 *   Capacity Utilization (Volume) = Actual Units Produced ÷ Maximum Designed Unit Capacity × 100
 *
 * Both return the raw numerator and denominator alongside the percentage, so the
 * figure can be reconciled against the source rows without re-deriving anything.
 */

export interface MsaLine {
  productionOrderId: string;
  orderNumber: string;
  sku: string | null;
  scheduledQty: number;
  actualQty: number;
  /** min(actual, scheduled) — the credited quantity for this line. */
  creditedQty: number;
  attainmentPct: number;
  status: string;
}

export interface MsaResult {
  msaPct: number;
  totalScheduledQty: number;
  totalCreditedQty: number;
  totalActualQty: number;
  orderCount: number;
  window: { from: string; to: string };
  lines: MsaLine[];
  method: {
    formula: string;
    note: string;
  };
}

export interface CapacityUtilizationResult {
  utilizationPct: number;
  actualUnits: number;
  maxDesignedUnits: number;
  windowHours: number;
  machineCount: number;
  /** Machines in scope with no routing step carrying a cycle time — no denominator. */
  machinesMissingCapacity: { id: string; name: string; code: string | null; reason: string }[];
  byMachine: {
    machineId: string; name: string; code: string | null;
    /** Rated throughput in PIECES per hour, derived from the routing step. */
    ratedUnitsPerHour: number | null;
    /** The routing step the rate came from — so the figure is traceable to master data. */
    ratedFrom: {
      processId: string; processName: string; stepNumber: number; operationName: string;
      cycleTimeSec: number; outUnit: string | null; machineOverride: boolean;
    } | null;
    maxDesignedUnits: number;
    actualUnits: number;
    utilizationPct: number | null;
  }[];
  window: { from: string; to: string };
  method: {
    formula: string;
    capacityBasis: string;
    note: string;
  };
}

/** A machine's rated throughput, resolved from routing master data. */
export interface RatedCapacity {
  machineId: string;
  /** PIECES per hour — the canonical unit for all internal quantity arithmetic. */
  unitsPerHour: number;
  processId: string;
  processName: string;
  stepNumber: number;
  operationName: string;
  cycleTimeSec: number;
  outUnit: string | null;
  /** True when the rate came from a machine-specific override on the step. */
  machineOverride: boolean;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

@Injectable()
export class ScheduleKpiService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Rated throughput per machine, derived from the ROUTING STEPS — the same master
   * data that generates job orders and drives scheduling.
   *
   * There is deliberately no separate "design capacity" field to keep in sync: a
   * machine's rate is a property of the operation it performs on a given product,
   * and that already lives on `RoutingStep.cycleTimeSec` ("seconds per one out-unit"),
   * optionally overridden per machine on `RoutingStepMachineOption`. Reading it here
   * means capacity analytics can never drift from what the scheduler actually plans.
   *
   * Cycle times are normalised to PIECES before comparison, because a step producing
   * PALLETs and one producing INNERs are not otherwise comparable — and because the
   * actual output this rate is divided into is also totalled in pieces.
   *
   * When several routings cover the same machine (different products), the SLOWEST
   * rate is kept — capacity utilization must not be flattered by a rate the machine
   * only achieves on its easiest product.
   */
  async ratedCapacityByMachine(
    factoryId: string | null,
    machineIds: string[],
    opts: { skuId?: string } = {},
  ): Promise<Map<string, RatedCapacity>> {
    if (machineIds.length === 0) return new Map();

    const steps = await this.prisma.routingStep.findMany({
      where: {
        process: {
          ...(factoryId ? { factoryId } : {}),
          isActive: true,
          ...(opts.skuId ? { skuId: opts.skuId } : {}),
        },
        OR: [
          { machineId: { in: machineIds } },
          { machineOptions: { some: { machineId: { in: machineIds }, isActive: true } } },
        ],
      },
      select: {
        id: true, stepNumber: true, operationName: true, cycleTimeSec: true,
        outUnit: true, machineId: true,
        process: {
          select: {
            id: true, name: true,
            sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } },
          },
        },
        machineOptions: {
          where: { isActive: true, machineId: { in: machineIds } },
          select: { machineId: true, cycleTimeSec: true },
        },
      },
    });

    const wanted = new Set(machineIds);
    const out = new Map<string, RatedCapacity>();

    /** Record a candidate, keeping the slowest rate seen for the machine. */
    const consider = (
      machineId: string,
      cycleTimeSec: number | null | undefined,
      step: (typeof steps)[number],
      machineOverride: boolean,
    ) => {
      if (!wanted.has(machineId)) return;
      if (!cycleTimeSec || cycleTimeSec <= 0) return;

      // Out-units per hour, converted to PIECES so steps producing different pack
      // levels are comparable AND the rate shares a unit with the actual output it
      // is divided into. Base units would NOT work: baseUnit varies per SKU, so a
      // cross-product denominator built from it is not a consistent quantity.
      const outUnitsPerHour = 3600 / cycleTimeSec;
      const pkg = step.process.sku ?? null;
      const unitsPerHour = step.outUnit && pkg
        ? toPieces(outUnitsPerHour, step.outUnit, pkg)
        : outUnitsPerHour;
      if (!(unitsPerHour > 0)) return;

      const prev = out.get(machineId);
      if (prev && prev.unitsPerHour <= unitsPerHour) return; // keep the slowest

      out.set(machineId, {
        machineId,
        unitsPerHour,
        processId: step.process.id,
        processName: step.process.name,
        stepNumber: step.stepNumber,
        operationName: step.operationName,
        cycleTimeSec,
        outUnit: step.outUnit,
        machineOverride,
      });
    };

    for (const step of steps) {
      if (step.machineId) consider(step.machineId, step.cycleTimeSec, step, false);
      for (const opt of step.machineOptions) {
        // A machine-specific cycle time wins for that machine; otherwise it runs at
        // the step's default rate.
        consider(opt.machineId, opt.cycleTimeSec ?? step.cycleTimeSec, step, opt.cycleTimeSec != null);
      }
    }

    return out;
  }

  /**
   * Master Schedule Attainment.
   *
   * The `min()` is the point of the formula: over-producing one order must not
   * mask a shortfall on another, so each schedule line is credited at most its
   * scheduled quantity. A 100% MSA therefore means "every order met its plan",
   * not "total output matched total plan".
   *
   * Scope: production orders whose PLANNED window overlaps the reporting window —
   * attainment is measured against what was scheduled to be delivered in the
   * period, regardless of when work actually happened.
   */
  async masterScheduleAttainment(
    factoryId: string | null,
    from: Date,
    to: Date,
    opts: { lineId?: string; skuId?: string } = {},
  ): Promise<MsaResult> {
    const orders = await this.prisma.productionOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(opts.skuId ? { skuId: opts.skuId } : {}),
        ...(opts.lineId ? { workOrders: { some: { lineId: opts.lineId } } } : {}),
        // Cancelled orders were never a commitment — excluded from both sides.
        status: { not: 'CANCELLED' },
        plannedStart: { lte: to },
        plannedEnd: { gte: from },
      },
      select: {
        id: true, orderNumber: true, targetQty: true, completedQty: true, status: true,
        sku: { select: { name: true, code: true } },
      },
      orderBy: { plannedStart: 'asc' },
    });

    const lines: MsaLine[] = orders.map((o) => {
      const scheduledQty = o.targetQty ?? 0;
      const actualQty = o.completedQty ?? 0;
      const creditedQty = Math.min(actualQty, scheduledQty);
      return {
        productionOrderId: o.id,
        orderNumber: o.orderNumber,
        sku: o.sku?.name ?? o.sku?.code ?? null,
        scheduledQty,
        actualQty,
        creditedQty,
        attainmentPct: scheduledQty > 0 ? r1((creditedQty / scheduledQty) * 100) : 0,
        status: o.status,
      };
    });

    const totalScheduledQty = lines.reduce((s, l) => s + l.scheduledQty, 0);
    const totalCreditedQty = lines.reduce((s, l) => s + l.creditedQty, 0);
    const totalActualQty = lines.reduce((s, l) => s + l.actualQty, 0);

    return {
      msaPct: totalScheduledQty > 0 ? r1((totalCreditedQty / totalScheduledQty) * 100) : 0,
      totalScheduledQty,
      totalCreditedQty,
      totalActualQty,
      orderCount: lines.length,
      window: { from: from.toISOString(), to: to.toISOString() },
      lines,
      method: {
        formula: 'MSA = Σ min(Actual Qty, Scheduled Qty) ÷ Total Scheduled Qty × 100',
        note:
          'Each order is credited at most its scheduled quantity, so over-producing one ' +
          'order cannot mask a shortfall on another. Scope: orders whose planned window ' +
          'overlaps the period. Cancelled orders are excluded from both numerator and denominator.',
      },
    };
  }

  /**
   * Volume-based capacity utilization.
   *
   * Denominator is the DESIGNED rate over the calendar hours of the window, where
   * the rate comes from the routing step's cycle time — not from a separate capacity
   * field. That is the strictest of the four possible bases (design, demonstrated,
   * available, scheduled) and the one the supplied formula names, so the result reads
   * low whenever the line is not scheduled to run. It answers "how much of the
   * designed volume did we use", not "how well did we run when we ran" — that second
   * question is OEE Performance.
   */
  async volumeCapacityUtilization(
    factoryId: string | null,
    from: Date,
    to: Date,
    opts: { areaId?: string; lineId?: string; machineId?: string; skuId?: string } = {},
  ): Promise<CapacityUtilizationResult> {
    const machines = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        isActive: true,
        archivedAt: null,
        ...(opts.machineId ? { id: opts.machineId } : {}),
        ...(opts.lineId ? { lineId: opts.lineId } : {}),
        ...(opts.areaId ? { OR: [{ areaId: opts.areaId }, { line: { areaId: opts.areaId } }] } : {}),
      },
      select: { id: true, name: true, code: true },
    });

    const machineIds = machines.map((m) => m.id);
    const rated = await this.ratedCapacityByMachine(factoryId, machineIds, { skuId: opts.skuId });

    // Actual good output per machine, CLAMPED TO THE WINDOW.
    //
    // This read `JobOrder.actualQtyGood` — a CUMULATIVE lifetime counter — and
    // compared it with a denominator built from the window's hours. On this plant the
    // job orders had been open for 230 hours, so asking for "today" put 230 hours of
    // production over a few hours of designed capacity and the card read 760%.
    // A ratio whose two sides cover different periods is not a high utilisation, it is
    // a meaningless number, and it is the same defect already fixed for PPT vs run time.
    //
    // The fact store is the fix and the right source anyway: its MINUTE rows are
    // per-bucket DELTAS already normalised to PIECES, which is the unit the rated
    // capacity below is expressed in. Summing them over the window gives exactly the
    // output produced IN the window, on the same basis every other analytics surface
    // uses — so this card can no longer disagree with the pages beside it.
    const producedRows = machineIds.length
      ? await this.prisma.$queryRaw<Array<{ machineId: string; pieces: number }>>(Prisma.sql`
          SELECT "machineId", COALESCE(SUM("goodBase"), 0)::float8 AS pieces
          FROM ${MINUTE_FACTS} snap
          WHERE granularity = 'MINUTE'
            AND "machineId" IN (${Prisma.join(machineIds)})
            AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
          GROUP BY "machineId"
        `)
      : [];
    const actualByMachine = new Map<string, number>();
    for (const row of producedRows) {
      if (!row.machineId) continue;
      actualByMachine.set(row.machineId, row.pieces);
    }

    const windowHours = Math.max(0, (to.getTime() - from.getTime()) / 3_600_000);

    const byMachine = machines.map((m) => {
      const rate = rated.get(m.id) ?? null;
      const maxDesignedUnits = rate ? rate.unitsPerHour * windowHours : 0;
      const actualUnits = actualByMachine.get(m.id) ?? 0;
      return {
        machineId: m.id,
        name: m.name,
        code: m.code,
        ratedUnitsPerHour: rate ? r1(rate.unitsPerHour) : null,
        ratedFrom: rate
          ? {
              processId: rate.processId,
              processName: rate.processName,
              stepNumber: rate.stepNumber,
              operationName: rate.operationName,
              cycleTimeSec: rate.cycleTimeSec,
              outUnit: rate.outUnit,
              machineOverride: rate.machineOverride,
            }
          : null,
        maxDesignedUnits: Math.round(maxDesignedUnits),
        actualUnits,
        utilizationPct: maxDesignedUnits > 0 ? r1((actualUnits / maxDesignedUnits) * 100) : null,
      };
    });

    const machinesMissingCapacity = machines
      .filter((m) => !rated.has(m.id))
      .map((m) => ({
        id: m.id,
        name: m.name,
        code: m.code,
        reason: 'No active routing step with a cycle time assigns this machine.',
      }));

    const maxDesignedUnits = byMachine.reduce((s, m) => s + m.maxDesignedUnits, 0);
    const actualUnits = byMachine.reduce((s, m) => s + m.actualUnits, 0);

    return {
      utilizationPct: maxDesignedUnits > 0 ? r1((actualUnits / maxDesignedUnits) * 100) : 0,
      actualUnits,
      maxDesignedUnits,
      windowHours: r1(windowHours),
      machineCount: machines.length,
      machinesMissingCapacity,
      byMachine: byMachine.sort((a, b) => (b.utilizationPct ?? -1) - (a.utilizationPct ?? -1)),
      window: { from: from.toISOString(), to: to.toISOString() },
      method: {
        formula: 'Capacity Utilization (Volume) = Actual Units Produced ÷ Maximum Designed Unit Capacity × 100',
        capacityBasis:
          'Rated throughput from the routing step cycle time (3600 ÷ cycleTimeSec, converted to ' +
          'PIECES) × calendar hours in the window. A machine-specific cycle time on the step ' +
          'overrides the step default. Where several routings cover a machine, the slowest rate is used. ' +
          'This is the same master data that generates job orders, so capacity can never drift from the plan. ' +
          'Actual output is summed from the per-minute fact store, so both sides of the ratio cover exactly ' +
          'the selected window.',
        note:
          machinesMissingCapacity.length > 0
            ? `${machinesMissingCapacity.length} machine(s) in scope are not assigned to any active ` +
              'routing step with a cycle time, so they contribute nothing to the denominator — add ' +
              'them to the process routing for a complete figure.'
            : 'Every machine in scope resolves a rated capacity from its routing step.',
      },
    };
  }

  // ── Historical trends, derived rather than stored ─────────────────────────
  /**
   * Attainment as it stood at the end of each day in the window.
   *
   * ── Why this is derived and not a new table ─────────────────────────────
   * The obvious move was to snapshot MSA nightly into its own store. It is the
   * wrong move: `production_snapshots` already carries productionOrderId and the
   * good output that produced it, so the attainment of any past day is a query,
   * not a record. Writing a second store for a fact already recorded is exactly
   * how one number came to have several sources in this system.
   *
   * `ProductionOrder.completedQty` cannot answer this — it is a CUMULATIVE
   * counter with no history, so it only ever knows today. The fact store knows
   * every day, because it was written a minute at a time.
   *
   * Credited is capped at the target per order, as in the headline figure:
   * over-producing one order must not mask a shortfall on another.
   */
  async attainmentTrend(
    factoryId: string | null,
    from: Date,
    to: Date,
    opts: { lineId?: string; skuId?: string } = {},
  ): Promise<Array<{ date: Date; msaPct: number; credited: number; scheduled: number; orders: number }>> {
    const orders = await this.prisma.productionOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(opts.skuId ? { skuId: opts.skuId } : {}),
        ...(opts.lineId ? { workOrders: { some: { lineId: opts.lineId } } } : {}),
        status: { not: 'CANCELLED' },
        plannedStart: { lte: to },
        plannedEnd: { gte: from },
      },
      select: {
        id: true, targetQty: true, unit: true,
        sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } },
      },
    });
    if (orders.length === 0) return [];

    // Targets in PIECES, so they can be compared with the fact store's output.
    const targetPieces = new Map(
      orders.map((o) => [o.id, toPieces(o.targetQty ?? 0, o.unit, o.sku)]),
    );
    const ids = orders.map((o) => o.id);

    // Cumulative good per order per plant-calendar day. The final-step filter is
    // the same rule the headline uses: a unit that crossed five stations is one
    // unit, not five.
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; productionOrderId: string; cumGood: number }>>(Prisma.sql`
      WITH scoped AS (
        SELECT *, date_trunc('day', "bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Riyadh') AS d
        FROM ${MINUTE_FACTS} snap
        WHERE granularity = 'MINUTE'
          AND "productionOrderId" IN (${Prisma.join(ids)})
          AND "bucketStart" < ${to}
      ),
      fin AS (
        SELECT "workOrderId", ${FINAL_STEP} ms FROM scoped GROUP BY "workOrderId"
      ),
      daily AS (
        SELECT s.d, s."productionOrderId",
               SUM(s."goodBase") FILTER (WHERE s."sequenceOrder" = f.ms)::float8 AS good
        FROM scoped s JOIN fin f ON f."workOrderId" = s."workOrderId"
        GROUP BY s.d, s."productionOrderId"
      )
      SELECT d AS day, "productionOrderId",
             SUM(COALESCE(good, 0)) OVER (
               PARTITION BY "productionOrderId" ORDER BY d
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             )::float8 AS "cumGood"
      FROM daily ORDER BY d
    `);

    // Fold into one point per day: every order's credited total as of that day.
    const byDay = new Map<number, Map<string, number>>();
    for (const r of rows) {
      const key = new Date(r.day).getTime();
      if (!byDay.has(key)) byDay.set(key, new Map());
      byDay.get(key)!.set(r.productionOrderId, r.cumGood);
    }

    const scheduled = [...targetPieces.values()].reduce((a, b) => a + b, 0);
    const carried = new Map<string, number>();
    const out: Array<{ date: Date; msaPct: number; credited: number; scheduled: number; orders: number }> = [];

    for (const key of [...byDay.keys()].sort((a, b) => a - b)) {
      if (new Date(key) < new Date(new Date(from).setHours(0, 0, 0, 0))) {
        // Before the window, but still needed: an order's cumulative total on day
        // one includes everything it made earlier. Carry it without emitting.
        for (const [id, v] of byDay.get(key)!) carried.set(id, v);
        continue;
      }
      for (const [id, v] of byDay.get(key)!) carried.set(id, v);
      let credited = 0;
      for (const id of ids) credited += Math.min(carried.get(id) ?? 0, targetPieces.get(id) ?? 0);
      out.push({
        date: new Date(key),
        msaPct: scheduled > 0 ? r1((credited / scheduled) * 100) : 0,
        credited: r1(credited),
        scheduled: r1(scheduled),
        orders: ids.length,
      });
    }
    return out;
  }

  /**
   * Capacity utilisation per plant-calendar day.
   *
   * Also derived: the numerator is the fact store's good output for that day, and
   * the denominator is the routing's rated throughput over that day's hours. The
   * rate comes from master data that changes a few times a year, so recomputing
   * it is honest — a stored figure would silently keep quoting a cycle time that
   * has since been corrected.
   */
  async capacityTrend(
    factoryId: string | null,
    from: Date,
    to: Date,
    opts: { areaId?: string; lineId?: string; machineId?: string; skuId?: string } = {},
  ): Promise<Array<{ date: Date; utilizationPct: number; actualUnits: number; designedUnits: number }>> {
    const machines = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        isActive: true, archivedAt: null,
        ...(opts.machineId ? { id: opts.machineId } : {}),
        ...(opts.lineId ? { lineId: opts.lineId } : {}),
        ...(opts.areaId ? { OR: [{ areaId: opts.areaId }, { line: { areaId: opts.areaId } }] } : {}),
      },
      select: { id: true },
    });
    if (machines.length === 0) return [];

    const rated = await this.ratedCapacityByMachine(factoryId, machines.map((m) => m.id), { skuId: opts.skuId });
    // Designed pieces for a full day, summed across the machines that have a rate.
    const designedPerDay = [...rated.values()].reduce((sum, r) => sum + r.unitsPerHour * 24, 0);
    if (designedPerDay <= 0) return [];

    const rows = await this.prisma.$queryRaw<Array<{ day: Date; actual: number }>>(Prisma.sql`
      WITH scoped AS (
        SELECT *, date_trunc('day', "bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Riyadh') AS d
        FROM ${MINUTE_FACTS} snap
        WHERE granularity = 'MINUTE'
          AND "machineId" IN (${Prisma.join(machines.map((m) => m.id))})
          AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
      )
      SELECT d AS day, COALESCE(SUM("goodBase"), 0)::float8 AS actual
      FROM scoped GROUP BY d ORDER BY d
    `);

    return rows.map((r) => ({
      date: r.day,
      actualUnits: r1(r.actual),
      designedUnits: r1(designedPerDay),
      utilizationPct: r1((r.actual / designedPerDay) * 100),
    }));
  }
}
