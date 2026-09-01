import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { KpiService, MINUTE_FACTS } from './kpi.service';
import { OeeStandardService } from '../oee-standard/oee-standard.service';
import { StateTimelineService } from '../oee-standard/state-timeline.service';
import { resolveLocalRange } from '../../common/plant-time.util';
import { currentShiftStart } from '../../common/shift-window.util';

/**
 * Machine status analytics — the timeline, and the three OEE factors behind it.
 *
 * Reads two sources and keeps them distinct on purpose:
 *
 *   machine_state_records   what the machine WAS DOING, minute by minute
 *   production_snapshots    what it PRODUCED, per minute
 *
 * The first is the only place STARVED and BLOCKED minutes live, and until the
 * gateway was fixed on 15 Aug 2026 nothing wrote to it at all — the timeline
 * drew one solid bar for days and the OEE engine's external loss was always
 * zero. Anything read here is therefore only as deep as that fix; there is no
 * history before it, and no amount of querying will invent one.
 *
 * Every method takes the same scope (area / line / machine) and the same local
 * date range, so the three tabs of the screen can never disagree about which
 * machines or which window they are describing.
 */

/** States that mean the machine was producing. */
const PRODUCING = new Set(['RUNNING']);

/** Stops caused outside the machine — excluded from its own availability loss. */
const EXTERNAL = new Set(['STARVED', 'BLOCKED']);

/** Stops somebody planned. */
const PLANNED = new Set(['PLANNED_STOP', 'MAINTENANCE', 'SETUP', 'CHANGEOVER']);

export interface StatusScope {
  areaId?: string;
  lineId?: string;
  machineId?: string;
}

@Injectable()
export class MachineStatusService {
  private readonly logger = new Logger(MachineStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
    /**
     * The scope-level factors come from the engine, not from a rollup of
     * this file's own — see the `totals` blocks below.
     */
    private readonly oeeStandard: OeeStandardService,
    /**
     * The SCHEDULE for the same window, for the timeline's second track. Taken
     * from the service that already builds it for the OEE pages rather than
     * re-derived here: two readings of the same booked stops would eventually
     * disagree, and this screen and that one draw the same machines.
     */
    private readonly timeline: StateTimelineService,
  ) {}

  /** Machines in scope, in material-flow order so every view lists them alike. */
  private async machinesInScope(factoryId: string | null, scope: StatusScope) {
    const ids = await this.kpi.resolveScopeMachineIds(factoryId, scope);
    return this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(ids ? { id: { in: ids } } : {}),
        isActive: true,
        archivedAt: null,
      },
      select: {
        id: true, code: true, name: true, sortOrder: true,
        line: { select: { id: true, code: true, name: true, area: { select: { id: true, name: true } } } },
      },
      orderBy: [{ line: { code: 'asc' } }, { sortOrder: 'asc' }],
    });
  }

  /**
   * The window, as plant-local calendar days clamped to now.
   *
   * Shared with the rest of the API so a chart and a KPI card asked for "today"
   * cover the same seconds — the mismatch that used to make two screens disagree.
   *
   * `timeframe` is honoured for the SAME reason. These endpoints used to accept only
   * dateFrom/dateTo, so picking "Shift" in the sidebar measured the whole calendar
   * day here while /production/oee/calculate — which does resolve the shift from the
   * templates — measured the sixteen minutes since the shift began. Two pages, one
   * button, two windows, and every figure on them disagreed for a reason that had
   * nothing to do with the arithmetic underneath.
   */
  private async window(
    factoryId: string | null,
    dateFrom?: string,
    dateTo?: string,
    timeframe?: string,
  ) {
    const range = resolveLocalRange(dateFrom, dateTo, 7);
    if (String(timeframe ?? '').toLowerCase() !== 'shift') return range;
    // The REAL current shift start, not "since midnight". Falls back to the calendar
    // range when no shift template covers now — a guess would be worse than the day.
    //
    // factoryId is a PARAMETER, never an instance field: this service is a singleton
    // and two concurrent requests for different factories would otherwise resolve
    // each other's shift.
    const shiftStart = await currentShiftStart(this.prisma, factoryId);
    return shiftStart ? { from: shiftStart, to: range.to } : range;
  }

  // ────────────────────────────────────────────────────────────
  // AVAILABILITY — the timeline and what it adds up to
  // ────────────────────────────────────────────────────────────

  async availability(factoryId: string | null, scope: StatusScope, dateFrom?: string, dateTo?: string, timeframe?: string) {
    const { from, to } = await this.window(factoryId, dateFrom, dateTo, timeframe);
    const machines = await this.machinesInScope(factoryId, scope);
    if (machines.length === 0) {
      return { from, to, machines: [], totals: this.emptyTotals(), reasons: [] };
    }
    const machineIds = machines.map((m) => m.id);

    const records = await this.prisma.machineStateRecord.findMany({
      where: {
        machineId: { in: machineIds },
        startTime: { lte: to },
        OR: [{ endTime: null }, { endTime: { gte: from } }],
      },
      select: {
        id: true, machineId: true, state: true, startTime: true, endTime: true,
        downtimeCause: { select: { code: true, name: true } },
      },
      orderBy: { startTime: 'asc' },
      // Generous, but bounded: a chatty month must not stream unbounded rows
      // into a browser that can only draw a few hundred bands anyway.
      take: 5000,
    });

    const byMachine = new Map<string, typeof records>();
    for (const r of records) {
      byMachine.set(r.machineId, [...(byMachine.get(r.machineId) ?? []), r]);
    }

    // The KPI numbers come from the ONE engine, not from a second computation over
    // a second table. This page used to derive availability from the state records
    // above and report 0% for a machine that Availability Analytics — reading the
    // fact store — reported at 91.8%, at the same moment. The state records remain
    // the right source for the TIMELINE, which is a picture of what the machine was
    // doing; they are not a second opinion on the KPI.
    const facts = await this.kpi.machineFactTotals(machineIds, from, to);

    // What the plant BOOKED over the same window, grouped per machine. Drawn
    // above each machine's own band so the two accounts of a minute sit over
    // one another instead of being reconciled into one by this file's opinion.
    const planned = await this.timeline.plannedSegments(factoryId, from, to, scope);
    const planByMachine = new Map<string, Array<{ state: string; label: string; startTime: Date; endTime: Date; minutes: number }>>();
    for (const p of planned) {
      const list = planByMachine.get(p.machineId) ?? [];
      list.push({ state: p.state, label: p.label ?? p.state, startTime: p.from, endTime: p.to, minutes: p.minutes });
      planByMachine.set(p.machineId, list);
    }

    const rows = machines.map((m) => {
      const segments = (byMachine.get(m.id) ?? []).map((r) => {
        // Clip to the window: a record that started before it or is still open
        // must contribute only the minutes that fall inside.
        const s = Math.max(from.getTime(), r.startTime.getTime());
        const e = Math.min(to.getTime(), r.endTime ? r.endTime.getTime() : to.getTime());
        return {
          id: r.id,
          state: String(r.state),
          startTime: new Date(s),
          endTime: new Date(e),
          minutes: Math.max(0, (e - s) / 60_000),
          cause: r.downtimeCause?.name ?? null,
        };
      }).filter((s) => s.minutes > 0);

      // Clock time from the timeline: how long the window was, and how the bands
      // divide it. A description of the picture, not a KPI.
      const clock = this.bucketMinutes(segments);
      const f = facts.get(m.id);
      // A machine with no fact rows had no planned production in the window, so it
      // has no availability — null, not 0%, which reads as "it failed" rather than
      // "it was never asked to run".
      const runMin = f?.runMin ?? 0;
      const unplannedMin = f?.downMin ?? 0;
      const plannedMin = f?.plannedMin ?? 0;
      const externalMin = f?.externalMin ?? 0;
      return {
        machineId: m.id,
        code: m.code,
        name: m.name,
        line: m.line?.code ?? null,
        area: m.line?.area?.name ?? null,
        segments,
        // Empty when nothing was booked for this machine — the chart reads that
        // as "no schedule" and draws one band, rather than an empty second one
        // implying the plant intended nothing.
        planSegments: planByMachine.get(m.id) ?? [],
        // The window's shape, from the timeline.
        totalMin: clock.totalMin,
        idleMin: clock.idleMin,
        // The KPI minutes, from the fact store — literally the same query every
        // other page reports from.
        runMin, unplannedMin, plannedMin, externalMin,
        plannedStopMin: f?.plannedDownMin ?? 0,
        // Time the machine reported nothing. Shown so an unwired machine is visibly
        // unmeasured rather than quietly flattering.
        unmeasuredMin: f?.unmeasuredMin ?? 0,
        availabilityPct: plannedMin > 0 ? this.pct(runMin, plannedMin) : null,
        // Uptime share is deliberately clock-based and labelled as such: the raw
        // proportion of the window spent producing, nothing excluded. Showing both
        // is how the difference stops being an argument — but only one of them is
        // Availability.
        uptimePct: this.pct(clock.runMin, clock.totalMin),
        stops: segments.filter((s) => !PRODUCING.has(s.state)).length,
      };
    });

    const totals = rows.reduce((acc, r) => ({
      totalMin: acc.totalMin + r.totalMin,
      runMin: acc.runMin + r.runMin,
      unplannedMin: acc.unplannedMin + r.unplannedMin,
      plannedMin: acc.plannedMin + r.plannedMin,
      externalMin: acc.externalMin + r.externalMin,
      unmeasuredMin: acc.unmeasuredMin + r.unmeasuredMin,
      idleMin: acc.idleMin + r.idleMin,
      stops: acc.stops + r.stops,
    }), this.emptyTotals());

    return {
      from, to,
      machines: rows,
      totals: {
        ...totals,
        // Summed minutes, then ONE division — never an average of percentages,
        // which would weight a machine that ran ten minutes like one that ran all
        // week. The same rule as every other rollup in the system.
        availabilityPct: totals.plannedMin > 0 ? this.pct(totals.runMin, totals.plannedMin) : null,
        uptimePct: this.pct(totals.runMin, totals.totalMin),
      },
      reasons: await this.stopReasons(factoryId, machineIds, from, to),
    };
  }

  /** Minutes split by what the state MEANS, which is what the KPIs care about. */
  private bucketMinutes(segments: Array<{ state: string; minutes: number }>) {
    let totalMin = 0, runMin = 0, unplannedMin = 0, plannedMin = 0, externalMin = 0, idleMin = 0;
    for (const s of segments) {
      totalMin += s.minutes;
      if (PRODUCING.has(s.state)) { runMin += s.minutes; continue; }
      if (EXTERNAL.has(s.state)) { externalMin += s.minutes; continue; }
      if (PLANNED.has(s.state)) { plannedMin += s.minutes; continue; }
      if (s.state === 'IDLE' || s.state === 'OFFLINE') { idleMin += s.minutes; continue; }
      unplannedMin += s.minutes; // BREAKDOWN and anything unrecognised
    }
    return {
      totalMin: this.r(totalMin), runMin: this.r(runMin), unplannedMin: this.r(unplannedMin),
      plannedMin: this.r(plannedMin), externalMin: this.r(externalMin), idleMin: this.r(idleMin),
    };
  }

  /** Downtime Pareto over the same window — what actually cost the time. */
  private async stopReasons(factoryId: string | null, machineIds: string[], from: Date, to: Date) {
    const events = await this.prisma.downtimeEvent.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        machineId: { in: machineIds },
        startTime: { lte: to },
        OR: [{ endTime: null }, { endTime: { gte: from } }],
      },
      select: {
        category: true, reasonCode: true, isPlanned: true, affectsOEE: true,
        startTime: true, endTime: true,
        cause: { select: { name: true } },
      },
      take: 5000,
    });

    const agg = new Map<string, { label: string; category: string; minutes: number; count: number; isPlanned: boolean; affectsOEE: boolean }>();
    for (const e of events) {
      const s = Math.max(from.getTime(), e.startTime.getTime());
      const end = Math.min(to.getTime(), e.endTime ? e.endTime.getTime() : to.getTime());
      const minutes = Math.max(0, (end - s) / 60_000);
      if (minutes <= 0) continue;
      const label = e.cause?.name ?? String(e.reasonCode ?? e.category);
      const key = `${label}|${e.category}`;
      const prev = agg.get(key);
      agg.set(key, {
        label,
        category: String(e.category),
        minutes: (prev?.minutes ?? 0) + minutes,
        count: (prev?.count ?? 0) + 1,
        isPlanned: e.isPlanned,
        affectsOEE: e.affectsOEE,
      });
    }
    return [...agg.values()]
      .map((r) => ({ ...r, minutes: this.r(r.minutes) }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 20);
  }

  // ────────────────────────────────────────────────────────────
  // PERFORMANCE — pace, from the fact store
  // ────────────────────────────────────────────────────────────

  async performance(factoryId: string | null, scope: StatusScope, dateFrom?: string, dateTo?: string, timeframe?: string) {
    const { from, to } = await this.window(factoryId, dateFrom, dateTo, timeframe);
    const machines = await this.machinesInScope(factoryId, scope);
    if (machines.length === 0) return { from, to, machines: [], series: [], totals: null };
    const machineIds = machines.map((m) => m.id);

    // The same per-machine aggregate the availability tab and the analytics pages
    // read. This carried its own copy of the query — and, unlike the canonical one,
    // no `granularity = 'MINUTE'` filter, so any rollup row ever written would have
    // been summed on top of the minutes it was rolled up from.
    /**
     * The scope-level factors, from the engine.
     *
     * The per-machine rows below stay as they are — each one is a single
     * machine, where every rollup rule agrees. It is the TOTALS that need the
     * engine: summing several machines is where the rules diverge, and a
     * header card that disagrees with the analysis page over the same window
     * is the whole complaint.
     */
    const scopeFactors = await this.oeeStandard.overview(factoryId, from, to, { machineIds });
    const byId = await this.kpi.machineFactTotals(machineIds, from, to);

    const rows = machines.map((m) => {
      const r = byId.get(m.id);
      const runMin = r?.runMin ?? 0;
      const idealRunMin = r?.idealRunMin ?? 0;
      return {
        machineId: m.id, code: m.code, name: m.name, line: m.line?.code ?? null,
        runMin: this.r(runMin),
        idealRunMin: this.r(idealRunMin),
        // Performance is ideal time over actual running time. Capped at 100
        // because producing "faster than ideal" means the ideal is wrong, not
        // that the machine exceeded physics — see tracker item 27.
        performancePct: Math.min(100, this.pct(idealRunMin, runMin)),
        output: this.r(r?.totalBase ?? 0),
        goodOutput: this.r(r?.goodBase ?? 0),
        actualRatePerHour: runMin > 0 ? this.r((r?.totalBase ?? 0) / (runMin / 60)) : 0,
      };
    });

    const series = await this.dailySeries(machineIds, from, to);

    // Summed from the shared aggregate, then divided once — the same rule as
    // every rollup here: totals come from minutes, never from averaging percentages.
    const sum = [...byId.values()].reduce((a, r) => ({
      runMin: a.runMin + r.runMin, idealRunMin: a.idealRunMin + r.idealRunMin,
      totalBase: a.totalBase + r.totalBase,
    }), { runMin: 0, idealRunMin: 0, totalBase: 0 });

    return {
      from, to, machines: rows, series,
      totals: {
        runMin: this.r(sum.runMin),
        idealRunMin: this.r(sum.idealRunMin),
        // From the engine. Rolling up as SUM(idealRunMin)/SUM(runMin) is not the
        // same figure as the engine's SUM(parts)/SUM(theoretical): the two weight
        // machines differently, and only coincide when every machine runs at the
        // same design speed. On this line they read 42.2% and 40.5% for one
        // window, on one page, under one caption.
        performancePct: scopeFactors.performance ?? Math.min(100, this.pct(sum.idealRunMin, sum.runMin)),
        output: this.r(sum.totalBase),
      },
    };
  }

  // ────────────────────────────────────────────────────────────
  // QUALITY
  // ────────────────────────────────────────────────────────────

  async quality(factoryId: string | null, scope: StatusScope, dateFrom?: string, dateTo?: string, timeframe?: string) {
    const { from, to } = await this.window(factoryId, dateFrom, dateTo, timeframe);
    const machines = await this.machinesInScope(factoryId, scope);
    if (machines.length === 0) return { from, to, machines: [], series: [], totals: null };
    const machineIds = machines.map((m) => m.id);

    const perMachine = await this.prisma.$queryRaw<Array<{
      machineId: string; goodBase: number; scrapBase: number; reworkBase: number; totalBase: number;
    }>>(Prisma.sql`
      SELECT "machineId",
             COALESCE(SUM("goodBase"), 0)::float   AS "goodBase",
             COALESCE(SUM("scrapBase"), 0)::float  AS "scrapBase",
             COALESCE(SUM("reworkBase"), 0)::float AS "reworkBase",
             COALESCE(SUM("totalBase"), 0)::float  AS "totalBase"
      FROM ${MINUTE_FACTS} snap
      WHERE "machineId" IN (${Prisma.join(machineIds)})
        AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
      GROUP BY "machineId"
    `);
    const byId = new Map(perMachine.map((r) => [r.machineId, r]));

    const rows = machines.map((m) => {
      const r = byId.get(m.id);
      const total = r?.totalBase ?? 0;
      const good = r?.goodBase ?? 0;
      return {
        machineId: m.id, code: m.code, name: m.name, line: m.line?.code ?? null,
        good: this.r(good),
        scrap: this.r(r?.scrapBase ?? 0),
        rework: this.r(r?.reworkBase ?? 0),
        total: this.r(total),
        qualityPct: this.pct(good, total),
        scrapPct: this.pct(r?.scrapBase ?? 0, total),
      };
    });

    /**
     * The scope-level quality, from the engine.
     *
     * Summing `good` across every machine counts one physical unit once per
     * station it passed, so the numerator inflates while the scrap — which
     * stays where it happened — does not. The engine credits good from the
     * FINAL step of each work order. Over one window on this line that is the
     * difference between 98.4% and 93.5%.
     *
     * The per-machine rows keep their own figure: for a single machine the
     * question really is "of what this machine made, how much was good".
     */
    const scopeFactors = await this.oeeStandard.overview(factoryId, from, to, { machineIds });

    const series = await this.dailySeries(machineIds, from, to);

    const sum = perMachine.reduce((a, r) => ({
      good: a.good + r.goodBase, scrap: a.scrap + r.scrapBase,
      rework: a.rework + r.reworkBase, total: a.total + r.totalBase,
    }), { good: 0, scrap: 0, rework: 0, total: 0 });

    return {
      from, to, machines: rows, series,
      totals: {
        good: this.r(sum.good), scrap: this.r(sum.scrap), rework: this.r(sum.rework),
        total: this.r(sum.total),
        qualityPct: scopeFactors.quality ?? this.pct(sum.good, sum.total),
        // Scrap stays a plain ratio of what every machine threw away against
        // what every machine handled — that IS a per-station question.
        scrapPct: this.pct(sum.scrap, sum.total),
      },
    };
  }

  /**
   * One row per plant-local day, shared by the performance and quality tabs.
   *
   * Bucketed in SQL at the plant's timezone rather than UTC: a night shift that
   * runs past midnight UTC belongs to the day the plant says it does, and
   * grouping on the raw timestamp would split it across two bars.
   */
  /**
   * Daily series for the trend charts — from the shared aggregate.
   *
   * This used to be a second copy of the query that lives in kpi.dailyFactTotals,
   * and it was missing the granularity filter the canonical one has. Scrap is
   * derived here as total − good rather than summed separately, because the shared
   * aggregate reports the two the final-step way and a third SUM would be a third
   * chance to disagree.
   */
  private async dailySeries(machineIds: string[], from: Date, to: Date) {
    const rows = await this.kpi.dailyFactTotals(machineIds, from, to);
    return rows.map((r) => ({
      date: r.day,
      runMin: this.r(r.runMin),
      output: this.r(r.totalBase),
      good: this.r(r.goodBase),
      scrap: this.r(Math.max(0, r.totalBase - r.goodBase)),
      performancePct: Math.min(100, this.pct(r.idealRunMin, r.runMin)),
      qualityPct: this.pct(r.goodBase, r.totalBase),
    }));
  }

  private emptyTotals() {
    return { totalMin: 0, runMin: 0, unplannedMin: 0, plannedMin: 0, externalMin: 0, unmeasuredMin: 0, idleMin: 0, stops: 0 };
  }

  private pct(num: number, den: number): number {
    if (!den || den <= 0) return 0;
    return Math.round((num / den) * 1000) / 10;
  }

  private r(n: number): number {
    return Math.round(n * 100) / 100;
  }
}
