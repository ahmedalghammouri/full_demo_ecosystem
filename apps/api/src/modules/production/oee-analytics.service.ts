import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { KpiService, MINUTE_FACTS, FINAL_STEP } from './kpi.service';
import { resolveLocalRange } from '../../common/plant-time.util';
import { currentShiftStart } from '../../common/shift-window.util';
import { oeeIdentityOf } from '../../common/oee-identity.util';

/**
 * OEE analytics — the loss tree behind the headline number.
 *
 * OEE Analytics answers "what is the number". These four surfaces answer "where
 * did the rest of the time go", which is the only question that leads to an
 * action. Availability, Performance and Quality each get the detail for their
 * own factor; the combined view shows the whole waterfall and TEEP.
 *
 * ── One computation, four pages ─────────────────────────────────────────────
 * Everything comes from ONE method reading the same `production_snapshots` fact
 * store the OEE engine reads. The pages slice the result; none of them derives
 * anything of its own. That is deliberate and it is the whole point: the first
 * complaint on this project was that the same filter produced different numbers
 * on different screens, and every case traced back to a surface computing its
 * own version of a shared quantity.
 *
 * ── The waterfall ───────────────────────────────────────────────────────────
 *   Calendar time            every minute in the window × machines in scope
 *    − schedule loss         time the plant chose not to run
 *   = Loading time
 *    − planned stops         breaks, cleaning, planned maintenance
 *   = Planned production time (PPT)   ← the OEE availability denominator
 *    − availability loss     breakdowns, and starvation/blockage
 *   = Run time
 *    − performance loss      running slower than the ideal cycle
 *   = Net operating time
 *    − quality loss          time spent making units that were rejected
 *   = Fully productive time
 *
 *   OEE  = fully productive / planned production
 *   TEEP = fully productive / CALENDAR — what the asset could have delivered if
 *          it ran perfectly around the clock. TEEP is always the smaller number,
 *          and the gap between the two is the capacity a plant already owns.
 */
@Injectable()
export class OeeAnalyticsService {
  private readonly logger = new Logger(OeeAnalyticsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
  ) {}

  async analytics(
    factoryId: string | null,
    scope: { areaId?: string; lineId?: string; machineId?: string },
    dateFrom?: string,
    dateTo?: string,
    timeframe?: string,
  ) {
    // "Shift" has to mean the same window here as it does on every other page. This
    // read dateFrom/dateTo only, so the sidebar's Shift button measured the whole
    // calendar day on the four analytics pages while the OEE page measured the
    // minutes since the shift actually began — and the two disagreed on every figure
    // for a reason that had nothing to do with the arithmetic.
    const range = resolveLocalRange(dateFrom, dateTo, 7);
    const shiftStart = String(timeframe ?? '').toLowerCase() === 'shift'
      ? await currentShiftStart(this.prisma, factoryId)
      : null;
    const { from, to } = shiftStart ? { from: shiftStart, to: range.to } : range;

    const ids = await this.kpi.resolveScopeMachineIds(factoryId, scope);
    const machines = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(ids ? { id: { in: ids } } : {}),
        isActive: true, archivedAt: null,
      },
      select: { id: true, code: true, name: true, sortOrder: true, line: { select: { code: true } } },
      orderBy: [{ line: { code: 'asc' } }, { sortOrder: 'asc' }],
    });

    if (machines.length === 0) {
      return { from, to, machines: [], totals: this.emptyTotals(), waterfall: [], trend: [], losses: [] };
    }
    const machineIds = machines.map((m) => m.id);

    // ONE implementation, in kpi.service. This page used to carry its own copy of
    // this query; Machine Status carried a different computation over a different
    // table, and on 18 Aug 2026 the two disagreed on screen — 0% against 91.8% for
    // the same machine at the same moment. Whatever the underlying defect, a
    // second implementation is what let one surface be wrong while its neighbour
    // stayed right.
    const byId = await this.kpi.machineFactTotals(machineIds, from, to);

    // External loss now comes from the fact store like every other minute. It used to
    // be re-derived here from machine_state_records filtered on a hardcoded
    // ['STARVED','BLOCKED'] — two sources for one quantity, and blind to any state a
    // plant configures as OEE-excluded in its MachineStateRules. The writer classifies
    // each stopped minute from the rule that opened it, so this column already answers
    // "which states does THIS plant exclude" without naming any of them.

    // Calendar time is per machine, so the window is multiplied by how many
    // machines are in scope. Using the bare window would make TEEP for a line
    // five times too high.
    const windowMin = Math.max(0, (to.getTime() - from.getTime()) / 60_000);

    const perMachine = machines.map((m) => {
      const r = byId.get(m.id);
      const ext = r?.externalMin ?? 0;
      return {
        machineId: m.id, code: m.code, name: m.name, line: m.line?.code ?? null,
        ...this.derive({
          calendarMin: windowMin,
          plannedMin: r?.plannedMin ?? 0,
          plannedDownMin: r?.plannedDownMin ?? 0,
          runMin: r?.runMin ?? 0,
          downMin: r?.downMin ?? 0,
          microStopMin: r?.microStopMin ?? 0,
          idealRunMin: r?.idealRunMin ?? 0,
          externalMin: ext,
          total: r?.totalBase ?? 0,
          good: r?.goodBase ?? 0,
          scrap: r?.scrapBase ?? 0,
        }),
      };
    });

    // Scope totals are summed from the raw minutes and then derived ONCE — never
    // averaged from the per-machine percentages. Averaging ratios weights a
    // machine that ran for ten minutes the same as one that ran all week.
    const sum = perMachine.reduce((a, m) => ({
      calendarMin: a.calendarMin + m.calendarMin,
      plannedMin: a.plannedMin + m.plannedProductionMin,
      plannedDownMin: a.plannedDownMin + m.plannedStopMin,
      runMin: a.runMin + m.runMin,
      downMin: a.downMin + m.unplannedStopMin,
      microStopMin: a.microStopMin + m.microStopMin,
      idealRunMin: a.idealRunMin + m.idealRunMin,
      externalMin: a.externalMin + m.externalMin,
      total: a.total + m.output,
      good: a.good + m.goodOutput,
      scrap: a.scrap + m.scrap,
    }), {
      calendarMin: 0, plannedMin: 0, plannedDownMin: 0, runMin: 0, downMin: 0,
      microStopMin: 0, idealRunMin: 0, externalMin: 0, total: 0, good: 0, scrap: 0,
    });

    // ── Scope quantities come from the FINAL step of the whole scope ─────────
    // Per-machine totals use each machine's own final step, which is right for a
    // per-machine row. Summing those across a serial line would still count one
    // physical unit once per stage, so the SCOPE headline takes the last step of
    // the routing only — the same rule the OEE engine's headline uses, which is
    // why these pages and OEE Analytics agree on quality rather than differing
    // by the number of stages the product passes through.
    // Ask the OEE ENGINE for the scope's quantities and factors rather than
    // re-deriving them. Matching its formula by hand is how two surfaces drift
    // apart the moment one of them is edited — and the engine's definition is
    // not obvious: good counts only the FINAL routing step, while scrap counts
    // EVERY step, because a unit rejected at any stage is a rejection. Calling
    // it means these pages cannot disagree with OEE Analytics by construction.
    const engine = await this.kpi.snapshotScope(factoryId, from, to, machineIds);
    const totals = {
      ...this.derive(sum),
      availability: engine.availability,
      performance: engine.performance,
      quality: engine.quality,
      oee: engine.oee,
      output: this.r(engine.totalCount ?? 0),
      goodOutput: this.r(engine.goodCount ?? 0),
      scrap: this.r(Math.max(0, (engine.totalCount ?? 0) - (engine.goodCount ?? 0))),
    };
    // TEEP and utilisation depend on the engine's OEE, so recompute them here
    // rather than leaving the values derive() produced from the raw sums.
    totals.utilization = this.pct(totals.plannedProductionMin, totals.calendarMin);
    totals.teep = this.r(totals.oee * (totals.utilization / 100));

    return {
      from, to,
      totals,
      machines: perMachine,
      waterfall: this.waterfall(totals),
      losses: this.lossBreakdown(totals),
      trend: await this.dailyTrend(machineIds, from, to, machines.length),
    };
  }

  /**
   * Turn raw minutes into the waterfall and the three factors.
   *
   * Every figure below is floored at zero. Snapshot minutes are accumulated from
   * live telemetry and can overshoot by a second or two at a bucket boundary; a
   * negative "loss" is meaningless to a reader and would flip a chart upside
   * down, so the arithmetic clamps rather than exposing the artefact.
   */
  private derive(x: {
    calendarMin: number; plannedMin: number; plannedDownMin: number; runMin: number;
    downMin: number; microStopMin: number; idealRunMin: number; externalMin: number;
    total: number; good: number; scrap: number;
  }) {
    const calendarMin = this.r(x.calendarMin);
    const plannedProductionMin = this.r(x.plannedMin);
    const plannedStopMin = this.r(x.plannedDownMin);

    const externalMin = this.r(x.externalMin);
    // Loading time = what was scheduled. Planned Production Time is what is left of it
    // after the two carve-outs that OEE does not judge: planned stops (never expected
    // to produce) and external stops (the line could not feed or drain a healthy
    // machine). Both are already out of plannedMin and runMin in the fact store, so
    // loading has to add them back to stay the top of the same waterfall.
    const loadingMin = this.r(plannedProductionMin + plannedStopMin + externalMin);
    const scheduleLossMin = Math.max(0, this.r(calendarMin - loadingMin));

    const runMin = this.r(x.runMin);
    const unplannedStopMin = Math.max(0, this.r(x.downMin));

    // Availability compares run time with the time it was supposed to run.
    const availability = this.pct(runMin, plannedProductionMin);
    // The time-based basis: run against the time the machine was up and
    // accountable, blind to whether that time was scheduled. Planned and external
    // minutes are already out of both terms, so run + down IS that time. A plant
    // that runs to demand rather than to a fixed schedule reads this one.
    const availabilityTb = this.pct(runMin, runMin + unplannedStopMin);

    // Performance is ideal time over actual run time. Capped at 100: beating the
    // ideal means the ideal is wrong (tracker item 27), not that the machine
    // outran physics — and an uncapped figure would push OEE above 100 too.
    const idealRunMin = this.r(x.idealRunMin);
    const performance = Math.min(100, this.pct(idealRunMin, runMin));
    const netOperatingMin = this.r(runMin * (performance / 100));
    const performanceLossMin = Math.max(0, this.r(runMin - netOperatingMin));

    const total = this.r(x.total);
    const good = this.r(x.good);
    const quality = this.pct(good, total);
    const fullyProductiveMin = this.r(netOperatingMin * (quality / 100));
    const qualityLossMin = Math.max(0, this.r(netOperatingMin - fullyProductiveMin));

    const oee = this.r(oeeIdentityOf(availability, performance, quality));
    // Same P and Q; only the availability basis differs.
    const oeeTb = this.r(oeeIdentityOf(availabilityTb, performance, quality));
    // Utilisation is how much of the clock the plant even planned to use.
    const utilization = this.pct(plannedProductionMin, calendarMin);
    const teep = this.r(oee * (utilization / 100));
    const teepTb = this.r(oeeTb * (utilization / 100));

    return {
      calendarMin, loadingMin, scheduleLossMin,
      plannedProductionMin, plannedStopMin,
      runMin, unplannedStopMin, externalMin,
      netOperatingMin, performanceLossMin, microStopMin: this.r(x.microStopMin), idealRunMin,
      fullyProductiveMin, qualityLossMin,
      output: total, goodOutput: good, scrap: this.r(x.scrap),
      availability, performance, quality, oee, utilization, teep,
      // Both bases travel together, so a chart can plot either without a second
      // request and the toggle reaches every figure rather than half of them.
      availabilityTb, oeeTb, teepTb,
    };
  }

  /** The waterfall as ordered steps, ready to plot without further arithmetic. */
  private waterfall(t: ReturnType<OeeAnalyticsService['derive']>) {
    return [
      { key: 'calendar', minutes: t.calendarMin, kind: 'base' as const },
      { key: 'scheduleLoss', minutes: t.scheduleLossMin, kind: 'loss' as const },
      { key: 'loading', minutes: t.loadingMin, kind: 'base' as const },
      { key: 'plannedStops', minutes: t.plannedStopMin, kind: 'loss' as const },
      // External sits ABOVE Planned Production Time, beside planned stops — it is
      // carved out of OEE, not charged to Availability. Adding it to the availability
      // loss (as this did) double-subtracted it and the bars stopped reconciling.
      { key: 'external', minutes: t.externalMin, kind: 'loss' as const },
      { key: 'plannedProduction', minutes: t.plannedProductionMin, kind: 'base' as const },
      { key: 'availabilityLoss', minutes: t.unplannedStopMin, kind: 'loss' as const },
      { key: 'runTime', minutes: t.runMin, kind: 'base' as const },
      { key: 'performanceLoss', minutes: t.performanceLossMin, kind: 'loss' as const },
      { key: 'netOperating', minutes: t.netOperatingMin, kind: 'base' as const },
      { key: 'qualityLoss', minutes: t.qualityLossMin, kind: 'loss' as const },
      { key: 'fullyProductive', minutes: t.fullyProductiveMin, kind: 'result' as const },
    ];
  }

  /** Losses only, largest first — the list somebody acts on. */
  private lossBreakdown(t: ReturnType<OeeAnalyticsService['derive']>) {
    return [
      { key: 'scheduleLoss', minutes: t.scheduleLossMin, factor: 'utilization' },
      { key: 'plannedStops', minutes: t.plannedStopMin, factor: 'utilization' },
      { key: 'breakdowns', minutes: t.unplannedStopMin, factor: 'availability' },
      { key: 'external', minutes: t.externalMin, factor: 'utilization' },
      { key: 'speedLoss', minutes: t.performanceLossMin, factor: 'performance' },
      { key: 'qualityLoss', minutes: t.qualityLossMin, factor: 'quality' },
    ].filter((l) => l.minutes > 0).sort((a, b) => b.minutes - a.minutes);
  }

  /** Daily factor trend, bucketed on the plant's calendar rather than UTC. */
  private async dailyTrend(machineIds: string[], from: Date, to: Date, machineCount: number) {
    const rows = await this.kpi.dailyFactTotals(machineIds, from, to);

    const dayMin = 24 * 60 * machineCount;
    return rows.map((r) => {
      const availability = this.pct(r.runMin, r.plannedMin);
      const performance = Math.min(100, this.pct(r.idealRunMin, r.runMin));
      const quality = this.pct(r.goodBase, r.totalBase);
      const oee = this.r(oeeIdentityOf(availability, performance, quality));
      // The trend must offer both bases or the toggle cannot reach the charts.
      const availabilityTb = this.pct(r.runMin, r.runMin + (r.downMin ?? 0));
      const oeeTb = this.r(oeeIdentityOf(availabilityTb, performance, quality));
      const utilization = this.pct(r.plannedMin, dayMin);
      return {
        date: r.day,
        availability, performance, quality, oee,
        availabilityTb, oeeTb,
        utilization,
        teep: this.r(oee * (utilization / 100)),
        output: this.r(r.totalBase),
        good: this.r(r.goodBase),
      };
    });
  }

  /**
   * Output for the scope as a whole: the final routing step per work order,
   * across every machine in scope.
   *
   * On a five-stage line the same pallet appears in five snapshots. Counting all
   * of them inflates output fivefold and dilutes the scrap rate — quality reads
   * 99.9% when it is really 98.9%, which is precisely the class of defect this
   * project started with.
   */
  private async scopeQuantities(machineIds: string[], from: Date, to: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ total: number; good: number; scrap: number }>>(Prisma.sql`
      WITH scoped AS (
        SELECT * FROM ${MINUTE_FACTS} snap
        WHERE granularity = 'MINUTE'
          AND "machineId" IN (${Prisma.join(machineIds)})
          AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
      ),
      fin AS (SELECT "workOrderId", ${FINAL_STEP} ms FROM scoped GROUP BY "workOrderId")
      SELECT COALESCE(SUM(s."totalBase"), 0)::float AS total,
             COALESCE(SUM(s."goodBase"), 0)::float  AS good,
             COALESCE(SUM(s."scrapBase"), 0)::float AS scrap
      FROM scoped s
      JOIN fin f ON f."workOrderId" = s."workOrderId" AND f.ms = s."sequenceOrder"
    `);
    return rows[0] ?? { total: 0, good: 0, scrap: 0 };
  }

  private emptyTotals() {
    return this.derive({
      calendarMin: 0, plannedMin: 0, plannedDownMin: 0, runMin: 0, downMin: 0,
      microStopMin: 0, idealRunMin: 0, externalMin: 0, total: 0, good: 0, scrap: 0,
    });
  }

  private pct(num: number, den: number): number {
    if (!den || den <= 0) return 0;
    return Math.round((num / den) * 1000) / 10;
  }

  private r(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
