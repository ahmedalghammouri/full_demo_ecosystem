import { Injectable, Logger } from '@nestjs/common';
import { isTrendBucket, type TrendBucket } from '../../common/trend-bucket.util';
import { plantBound } from '../../common/plant-time.util';

/**
 * The end of the plant day a moment falls in — the schedule basis's slot end.
 *
 * Deliberately the same shape as `endOfLocalDay` in the schedule controller: the
 * two must agree or the dashboards and the analysis page clip the committed slot
 * differently and disagree about the same machine.
 */
function endOfPlantDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { Prisma, MachineState } from '@prisma/client';
import { OEEService, RollupChild, OEEBreakdown } from './oee.service';
import { toPieces } from '../../common/units.util';
import { splitStoppedTime, type StopInterval } from '../../common/stopped-time.util';
import { ScheduleKpiService } from './schedule-kpi.service';
import { oeeIdentityOf } from '../../common/oee-identity.util';
import { OeeStandardService, type OeeScope } from '../oee-standard/oee-standard.service';
import { OeeScheduleService } from '../oee-schedule/oee-schedule.service';

/**
 * KpiService — OEE orchestration & roll-up (Phase 2 of the OEE/KPI engine).
 * See docs/DESIGN-oee-kpi-engine.md.
 *
 * The Job Order is the source of truth: each JO contributes a {@link RollupChild}
 * (planned/run minutes + earned ideal minutes + final good/total counts). Those
 * roll up via the pure {@link OEEService.rollup} primitive to the WO, then to the
 * PO. Status is propagated forward JO→WO→PO and a `production.kpi.updated` event
 * is emitted for real-time clients.
 */

type SkuPkg = { baseUnit?: string | null; unitsPerInner?: number | null; innersPerCarton?: number | null; cartonsPerPallet?: number | null };
type JoLite = {
  id: string; machineId: string | null; status: string;
  idealCycleTimeSec: number | null;
  actualQtyGood: number; actualQtyRejected: number;
  plannedStart: Date | null; plannedEnd: Date | null;
  actualStart: Date | null; actualEnd: Date | null;
  sequenceOrder: number;
  /// Set when this step is out of service — see JobOrder.bypassedAt. Optional
  /// because a caller that does not select it must behave as it always did.
  bypassedAt?: Date | null;
  // optional — only the analytics queries enrich these for base-unit-correct output
  outputUnit?: string | null;
  workOrderId?: string | null; // groups a routed WO's steps so output = its FINAL step
  workOrder?: { sku?: SkuPkg | null } | null;
};
type DtLite = {
  machineId: string; startTime: Date; endTime: Date | null;
  durationMinutes: number | null; isPlanned: boolean; affectsOEE: boolean;
};
/** MachineStateRecord slice — the source of STARVED/BLOCKED external-loss minutes. */
type StateLite = {
  machineId: string; state: string; startTime: Date; endTime: Date | null;
};
type WoLite = {
  status: string; plannedCycleTime: number | null;
  actualQty: number; goodQty: number; scrapQty: number;
  actualStart: Date | null; actualEnd: Date | null;
};

const JO_SELECT = {
  id: true, machineId: true, status: true, idealCycleTimeSec: true,
  actualQtyGood: true, actualQtyRejected: true,
  plannedStart: true, plannedEnd: true, actualStart: true, actualEnd: true, sequenceOrder: true,
  // Without this the bypass would be invisible to every caller of JO_SELECT,
  // and `finalStepCounts` would quietly go on using the broken machine.
  bypassedAt: true,
} as const;
const DT_SELECT = {
  machineId: true, startTime: true, endTime: true, durationMinutes: true, isPlanned: true, affectsOEE: true,
} as const;
const STATE_SELECT = {
  machineId: true, state: true, startTime: true, endTime: true,
} as const;
/**
 * Job orders that OVERLAP [from, to] — the only correct selection for a window.
 *
 * The previous form asked for job orders that STARTED or ENDED inside the window:
 *
 *   OR: [{ actualStart: { gte: from, lte: to } }, { actualEnd: { gte: from, lte: to } }]
 *
 * which silently drops the most important case there is: a job order that began
 * before the window and is still running. On a line running a multi-day order,
 * "today" matched nothing and every KPI built from it read 0 — Overall Line OEE,
 * the machine OEE leaderboard, the reliability figures. It looked like missing
 * data; it was a missing predicate.
 *
 * Overlap is: it started at or before the window ends, AND it had not already
 * ended when the window began (an open job order has not ended at all).
 *
 * `actualStart: null` (never started) does not satisfy a comparison filter in
 * Prisma, so unstarted job orders stay excluded, as they should.
 *
 * The duration each job order contributes is still clipped to the window by
 * `overlapMin`; this decides membership only.
 *
 * ── Known limit, stated rather than hidden ──────────────────────────────────
 * `actualQtyGood`/`actualQtyRejected` are CUMULATIVE counters on the job order,
 * not per-window figures. So for a window shorter than a still-running job order,
 * the TIME is clipped but the COUNTS are not, and output is overstated by the
 * part produced before the window. That is a bounded error on a visible number;
 * the previous behaviour was a zero, which is neither. The exact fix is to source
 * these paths from `production_snapshots`, which stores per-minute deltas — the
 * same store `/oee/calculate` already reads. Until the two engines are unified,
 * prefer the snapshot-backed endpoints for windowed output figures.
 */
function joOverlapsWindow(from: Date, to: Date) {
  return {
    AND: [
      { actualStart: { lte: to } },
      { OR: [{ actualEnd: null }, { actualEnd: { gte: from } }] },
    ],
  };
}

/**
 * How one machine spent a window, and what it produced in it — the shape every
 * surface reports from. Minutes are the fact store's own columns; quantities are
 * already normalised to pieces and filtered to the final routing step.
 */
export interface DailyFactTotals {
  day: Date;
  plannedMin: number; runMin: number; idealRunMin: number;
  /** Needed for the time-based basis: run ÷ (run + down). */
  downMin: number;
  totalBase: number; goodBase: number;
}

/**
 * `oee_minutes`, wearing the column names the old fact store used.
 *
 * ── Why a projection and not eighteen rewritten queries ─────────────────────
 * Seven queries in this service, plus Machine Status and OEE Analytics, read
 * `production_snapshots` through a shared WHERE builder and a shared column
 * list. Rewriting each one is eighteen chances to get a rename wrong, and the
 * point of the consolidation is to REDUCE the number of places that decide what
 * a minute means — not to touch all of them at once.
 *
 * So the store changes and the vocabulary does not. Every caller keeps its
 * query, its aliases and its tests; only the rows underneath are now the ones
 * the OEE Analysis pages read.
 *
 * ── The one mapping that is a change, not a rename ──────────────────────────
 *   plannedMin  ->  totalMin - plannedStop - external - unmeasured
 *
 * `plannedMin` was the Availability denominator, written from whichever source
 * had most recently touched the plan. Its replacement is the time that actually
 * elapsed less the stops nobody is charged for — the published definition, and
 * the one the OEE Analysis pages have been showing all along. Availability, and
 * therefore OEE, moves on the pages fed by this. That is the intent of the
 * migration and is reported endpoint by endpoint, not discovered later.
 *
 * Everything else is the same quantity under its old name:
 *   runMin -> operatingMin        downMin -> availabilityLossMin
 *   plannedDownMin -> plannedStopMin   externalMin -> externalLossMin
 *   goodBase/scrapBase -> goodParts/rejectedParts (already in PIECES)
 *   idealRunMin -> parts / designSpeed, which is what the old column held
 *   microStopMin -> 0, because no threshold defines one yet
 */
/**
 * `oee_minutes` projected onto the column names the old fact store used.
 *
 * It was called SNAPSHOT_COMPAT while `production_snapshots` still existed,
 * and the name outlived the table by long enough to be misleading: nothing
 * here has ever read that table — this is a view over the minute store that
 * lets callers written against the old columns keep working unchanged.
 *
 * Renamed now that the store is gone, so the last thing implying otherwise
 * goes with it.
 */
export const MINUTE_FACTS = Prisma.sql`(
  SELECT
    o.id, o."bucketStart", o."factoryId", o."machineId",
    o."jobOrderId", o."workOrderId", o."shiftTemplateId", o."shiftCode",
    o."machineState", o."isFinalized",
    j."sequenceOrder", j."operationName",
    (j."bypassedAt" IS NOT NULL)                  AS bypassed,
    w."productionOrderId", w."skuId",
    m."areaId", m."lineId",
    'MINUTE' AS granularity,
    GREATEST(0, o."totalMin" - o."plannedStopMin" - o."externalLossMin"
                - o."unmeasuredMin")::float8      AS "plannedMin",
    o."operatingMin"::float8                      AS "runMin",
    o."availabilityLossMin"::float8               AS "downMin",
    o."plannedStopMin"::float8                    AS "plannedDownMin",
    o."externalLossMin"::float8                   AS "externalMin",
    o."unmeasuredMin"::float8                     AS "unmeasuredMin",
    o."microStopMin"::float8                      AS "microStopMin",
    CASE WHEN COALESCE(o."designSpeedPph", 0) > 0
         THEN ((o."goodParts" + o."rejectedParts") / o."designSpeedPph") * 60
         ELSE 0 END::float8                       AS "idealRunMin",
    o."goodParts"::float8                         AS "goodBase",
    o."rejectedParts"::float8                     AS "scrapBase",
    -- Rework is not recorded per minute by either engine. Zero rather than
    -- absent, so a caller that sums it still gets a number.
    0::float8                                     AS "reworkBase",
    (o."goodParts" + o."rejectedParts")::float8   AS "totalBase",
    o."totalMin"::float8                          AS "totalMin"
  FROM oee_minutes o
  JOIN job_orders j ON j.id = o."jobOrderId"
  LEFT JOIN work_orders w ON w.id = o."workOrderId"
  LEFT JOIN machines m ON m.id = o."machineId"
)`;

/**
 * The final routing step of a work order — the ONE definition.
 *
 * A unit passing four stations is one unit, not four, so the line's good output
 * is the good output of the last step it goes through. That rule was written
 * out separately in five places; this is the only copy now, because five copies
 * of a rule is five chances for one of them to be the odd one out.
 *
 * ── The bypass ─────────────────────────────────────────────────────
 * A bypassed step is out of service: product leaves the line one station
 * earlier, so the step before it becomes final. Bypassed steps are excluded
 * here, which is what makes the tablet's switch reach every engine at once.
 *
 * ── Why the COALESCE ───────────────────────────────────────────────
 * If EVERY step were bypassed the FILTER would yield NULL, nothing would join,
 * and the line would report zero output — a silent, total loss of production
 * figures. The API refuses to bypass the last un-bypassed step, so this should
 * be unreachable; it is here because "should be unreachable" is not a guarantee
 * anyone should bet a shift's numbers on.
 */
export const FINAL_STEP = Prisma.sql`COALESCE(
  MAX("sequenceOrder") FILTER (WHERE NOT bypassed),
  MAX("sequenceOrder")
)`;

export interface MachineFactTotals {
  plannedMin: number; runMin: number; downMin: number; plannedDownMin: number;
  externalMin: number; microStopMin: number; idealRunMin: number;
  /** Minutes the machine reported nothing at all — not run, not down, unmeasured. */
  unmeasuredMin: number;
  totalBase: number; goodBase: number; scrapBase: number;
}

/**
 * States where the machine is healthy but the LINE cannot feed or drain it.
 *
 * This is only the FALLBACK. The real answer lives in MachineStateRule: any state a
 * plant marks as a stop that does not affect OEE (`isDowntime && !isPlanned &&
 * !affectsOEE`) is external, whatever it is called. These two are used when a factory
 * has configured no rules at all, so a fresh install still behaves sensibly.
 */
const DEFAULT_EXTERNAL_STATES: MachineState[] = [MachineState.STARVED, MachineState.BLOCKED];
// Analytics select — adds the step output unit + product packaging so production
// counts can be normalised to the SKU base unit before aggregating across steps.
const JO_SELECT_ANALYTICS = {
  ...JO_SELECT,
  outputUnit: true,
  plannedQtyOut: true,
  workOrderId: true,
  workOrder: { select: { sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } } } },
} as const;

@Injectable()
export class KpiService {
  private readonly logger = new Logger(KpiService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oee: OEEService,
    private readonly eventEmitter: EventEmitter2,
    // Rated capacity comes from routing master data — see ratedCapacityByMachine.
    private readonly scheduleKpi: ScheduleKpiService,
    // The two bases, for the records list. It used to derive its own — see
    // oeeRecordsFromJobOrders.
    private readonly oeeStandard: OeeStandardService,
    private readonly oeeSchedule: OeeScheduleService,
  ) {}

  // ── time helpers ───────────────────────────────────────────────────────────
  private spanMin(start: Date | null, end: Date | null): number {
    if (!start) return 0;
    const e = end ? end.getTime() : Date.now();
    return Math.max(0, (e - start.getTime()) / 60_000);
  }
  private overlapMin(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
    const s = Math.max(aStart.getTime(), bStart.getTime());
    const e = Math.min(aEnd.getTime(), bEnd.getTime());
    return Math.max(0, (e - s) / 60_000);
  }

  private joPpt(jo: JoLite): number {
    if (jo.actualStart) return this.spanMin(jo.actualStart, jo.actualEnd);
    if (jo.plannedStart && jo.plannedEnd) return this.spanMin(jo.plannedStart, jo.plannedEnd);
    return 0;
  }

  /**
   * External-loss minutes attributed to a JO — STARVED/BLOCKED machine-state segments
   * on this JO's machine overlapping its active window.
   *
   * These are removed from Planned Production Time before Availability and Performance
   * are derived (see OEEService.EXTERNAL_LOSS_STATES): a palletizer waiting on the
   * bottleneck is available and running at rate, and must not be charged for the wait.
   */
  private joExternalLoss(jo: JoLite, states: StateLite[], win?: { from: number; to: number }): number {
    if (!jo.actualStart || states.length === 0) return 0;
    // Clamp the JO's active period to the analysis window, so external-loss minutes
    // cover the same period as the run time they are subtracted from.
    const js = win ? new Date(Math.max(jo.actualStart.getTime(), win.from)) : jo.actualStart;
    const jeRaw = jo.actualEnd ?? new Date();
    const je = win ? new Date(Math.min(jeRaw.getTime(), win.to)) : jeRaw;
    if (je <= js) return 0;
    let mins = 0;
    for (const s of states) {
      // `states` always arrives from loadExternalStates, which already filtered on the
      // rule-derived state list — re-checking here against a hardcoded name set would
      // silently drop any state the plant configured itself.
      if (jo.machineId && s.machineId !== jo.machineId) continue;
      mins += this.overlapMin(js, je, s.startTime, s.endTime ?? new Date());
    }
    return mins;
  }

  /** Unplanned downtime minutes attributed to a JO (its machine, overlapping its active window). */
  /**
   * Unplanned, OEE-affecting downtime minutes on this JO's machine during the JO —
   * clamped to the analysis window when one is given.
   *
   * The clamp matters now that a JO which began before the window is (correctly)
   * included: without it, a job order running for three days would contribute all
   * three days of downtime to a one-shift window, and OEE-TB would disagree with
   * every other figure on the same screen.
   */
  private joUnplanned(jo: JoLite, downtime: DtLite[], win?: { from: number; to: number }): number {
    if (!jo.actualStart) return 0;
    const js = win ? new Date(Math.max(jo.actualStart.getTime(), win.from)) : jo.actualStart;
    const jeRaw = jo.actualEnd ?? new Date();
    const je = win ? new Date(Math.min(jeRaw.getTime(), win.to)) : jeRaw;
    if (je <= js) return 0;
    let mins = 0;
    for (const d of downtime) {
      if (d.isPlanned || !d.affectsOEE) continue;
      if (jo.machineId && d.machineId !== jo.machineId) continue;
      const de = d.endTime ?? new Date();
      mins += this.overlapMin(js, je, d.startTime, de);
    }
    return mins;
  }

  /**
   * PLANNED stop minutes on this JO's machine during the JO — changeovers, scheduled
   * cleaning, anything a MachineStateRule (or the operator) marked planned.
   *
   * These leave BOTH sides of Availability: a stop that was scheduled is not a loss of
   * availability, it is time the line was never expected to produce in. Counting it as
   * run time (which is what happened before run time became operating time) credited
   * the machine with producing nothing at full speed.
   */
  private joPlannedStop(jo: JoLite, downtime: DtLite[], win?: { from: number; to: number }): number {
    if (!jo.actualStart) return 0;
    const js = win ? new Date(Math.max(jo.actualStart.getTime(), win.from)) : jo.actualStart;
    const jeRaw = jo.actualEnd ?? new Date();
    const je = win ? new Date(Math.min(jeRaw.getTime(), win.to)) : jeRaw;
    if (je <= js) return 0;
    let mins = 0;
    for (const d of downtime) {
      if (!d.isPlanned) continue;
      if (jo.machineId && d.machineId !== jo.machineId) continue;
      mins += this.overlapMin(js, je, d.startTime, d.endTime ?? new Date());
    }
    return mins;
  }

  /** Summed RollupChild for a WO — from its JOs (routed) or the WO header (non-routed). */
  private woChild(wo: WoLite, jos: JoLite[], downtime: DtLite[], states: StateLite[] = []): RollupChild {
    if (jos.length === 0) {
      const span = this.spanMin(wo.actualStart, wo.actualEnd);
      const mins = (d: DtLite) => d.durationMinutes ?? this.spanMin(d.startTime, d.endTime);
      const unplanned = downtime.filter(d => !d.isPlanned && d.affectsOEE).reduce((s, d) => s + mins(d), 0);
      // Planned stops leave both sides; rule-excluded (external) stops leave both too.
      const excluded = downtime.filter(d => d.isPlanned || !d.affectsOEE).reduce((s, d) => s + mins(d), 0);
      const ppt = Math.max(0, span - excluded);
      const total = wo.actualQty || (wo.goodQty + wo.scrapQty);
      const idealMin = wo.plannedCycleTime ? wo.plannedCycleTime / 60 : 0;
      return { ppt, runTime: Math.max(0, ppt - unplanned), idealRunTime: idealMin * total, externalLoss: 0, totalCount: total, goodCount: wo.goodQty };
    }

    const ordered = [...jos].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
    let ppt = 0, runTime = 0, idealRunTime = 0, externalLoss = 0;
    for (const jo of ordered) {
      // Planned stops leave PPT entirely — same rule as joRollupChild and the writer.
      const p = Math.max(0, this.joPpt(jo) - this.joPlannedStop(jo, downtime));
      const unplanned = this.joUnplanned(jo, downtime);
      // Starved/blocked is an external constraint — capped at the step's PPT.
      const ext = Math.min(p, this.joExternalLoss(jo, states));
      const joTotal = (jo.actualQtyGood ?? 0) + (jo.actualQtyRejected ?? 0);
      const idealMin = jo.idealCycleTimeSec ? jo.idealCycleTimeSec / 60 : 0;
      ppt += p;
      externalLoss += ext;
      runTime += Math.max(0, p - ext - unplanned);
      idealRunTime += idealMin * joTotal; // earned minutes per step (unit-correct per step)
    }
    // Quality is unit-based → use the FINAL step's output (units are consistent there).
    const last = ordered[ordered.length - 1];
    const totalCount = (last.actualQtyGood ?? 0) + (last.actualQtyRejected ?? 0);
    const goodCount = last.actualQtyGood ?? 0;
    return { ppt, runTime, idealRunTime, externalLoss, totalCount, goodCount };
  }

  /**
   * Load STARVED/BLOCKED machine-state segments overlapping a window, for the given
   * machines. Returns [] when nothing is in scope so callers stay allocation-free
   * on lines that do not yet report external states.
   */
  private async loadExternalStates(
    factoryId: string | null,
    machineIds: string[],
    from: Date,
    to: Date,
  ): Promise<StateLite[]> {
    if (machineIds.length === 0) return [];
    const external = await this.externalStateNames(factoryId);
    return (await this.prisma.machineStateRecord.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        machineId: { in: machineIds },
        state: { in: external as MachineState[] },
        startTime: { lte: to },
        OR: [{ endTime: null }, { endTime: { gte: from } }],
      },
      select: STATE_SELECT,
    })) as unknown as StateLite[];
  }

  /**
   * Which machine states this factory treats as EXTERNAL — recorded as a stop, but
   * carved out of OEE rather than charged to it.
   *
   * Read from MachineStateRule so the plant decides. A rule that is a downtime, is not
   * planned, and does not affect OEE is by definition "the machine is fine, the line is
   * not" — starved and blocked today, whatever a plant configures tomorrow. Nothing here
   * knows the names.
   *
   * Cached for a minute: every KPI call would otherwise re-read a table that changes a
   * few times a year, and a stale minute after an admin edits a rule is harmless.
   */
  private readonly externalStateCache = new Map<string, { at: number; names: string[] }>();

  private async externalStateNames(factoryId: string | null): Promise<string[]> {
    const key = factoryId ?? '*';
    const hit = this.externalStateCache.get(key);
    if (hit && Date.now() - hit.at < 60_000) return hit.names;

    let names = DEFAULT_EXTERNAL_STATES as string[];
    try {
      const rules = await this.prisma.machineStateRule.findMany({
        where: {
          ...(factoryId ? { factoryId } : {}),
          isActive: true, isDowntime: true, isPlanned: false, affectsOEE: false,
        },
        select: { state: true },
        distinct: ['state'],
      });
      // No rules configured at all → fall back. An empty result must not silently mean
      // "nothing is external", or a plant that never opened the Signal Rules page would
      // start charging starvation to its machines.
      if (rules.length > 0) names = [...new Set(rules.map((r) => r.state))];
    } catch {
      // Rules table unavailable → defaults. OEE must never fail to compute over config.
    }
    this.externalStateCache.set(key, { at: Date.now(), names });
    return names;
  }

  // ── status derivation (forward-only; never overrides hold/cancel) ───────────
  private deriveWoStatus(current: string, jos: { status: string }[]): string | null {
    if (['ON_HOLD', 'CANCELLED', 'COMPLETED'].includes(current) || jos.length === 0) return null;
    if (jos.every(j => ['COMPLETE', 'CANCELLED'].includes(j.status)) && jos.some(j => j.status === 'COMPLETE')) return 'COMPLETED';
    if (jos.some(j => ['EXECUTING', 'PAUSED'].includes(j.status))) return 'IN_PROGRESS';
    return null;
  }
  private derivePoStatus(current: string, woStatuses: string[]): string | null {
    if (['ON_HOLD', 'CANCELLED', 'COMPLETED'].includes(current) || woStatuses.length === 0) return null;
    if (woStatuses.every(s => ['COMPLETED', 'CANCELLED'].includes(s)) && woStatuses.some(s => s === 'COMPLETED')) return 'COMPLETED';
    if (woStatuses.some(s => s === 'IN_PROGRESS')) return 'IN_PROGRESS';
    return null;
  }

  // ── public API ──────────────────────────────────────────────────────────────

  /** Recompute a WO's OEE (rolled up from its JOs), propagate status & PO, emit live event. */
  async recomputeWorkOrderAndPO(workOrderId: string): Promise<void> {
    try {
      const wo = await this.prisma.workOrder.findUnique({
        where: { id: workOrderId },
        include: { jobOrders: { select: JO_SELECT }, downtimeEvents: { select: DT_SELECT } },
      });
      if (!wo) return;

      const jos = wo.jobOrders as JoLite[];
      const states = await this.loadExternalStates(
        wo.factoryId,
        [...new Set(jos.map((j) => j.machineId).filter(Boolean))] as string[],
        wo.actualStart ?? wo.plannedStart ?? new Date(0),
        wo.actualEnd ?? new Date(),
      );
      const child = this.woChild(wo as unknown as WoLite, jos, wo.downtimeEvents as DtLite[], states);
      const b = this.oee.rollup([child]);
      const woStatus = this.deriveWoStatus(wo.status, wo.jobOrders as JoLite[]);

      await this.prisma.workOrder.update({
        where: { id: workOrderId },
        data: {
          oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
          downtimeMinutes: Math.max(0, Math.round((child.ppt - child.runTime) * 10) / 10),
          ...(woStatus && woStatus !== wo.status
            ? { status: woStatus as never, ...(woStatus === 'IN_PROGRESS' && !wo.actualStart ? { actualStart: new Date() } : {}) }
            : {}),
        },
      });

      const po = wo.productionOrderId ? await this.recomputeProductionOrder(wo.productionOrderId) : null;

      this.eventEmitter.emit('production.kpi.updated', {
        factoryId: wo.factoryId,
        workOrderId,
        productionOrderId: wo.productionOrderId,
        wo: { id: workOrderId, oee: b.oee, status: woStatus ?? wo.status },
        po,
      });
    } catch (e) {
      this.logger.error(`recomputeWorkOrderAndPO(${workOrderId}) failed`, e as Error);
    }
  }

  /** Recompute a PO's OEE (rolled up from its WOs) + completedQty + forward status. */
  async recomputeProductionOrder(productionOrderId: string): Promise<{ id: string; oee: number; status: string } | null> {
    const po = await this.prisma.productionOrder.findUnique({
      where: { id: productionOrderId },
      include: {
        workOrders: {
          where: { deletedAt: null, status: { not: 'CANCELLED' } },
          include: { jobOrders: { select: JO_SELECT }, downtimeEvents: { select: DT_SELECT } },
        },
      },
    });
    if (!po) return null;

    const poJos = po.workOrders.flatMap((wo) => wo.jobOrders as JoLite[]);
    const poStates = await this.loadExternalStates(
      po.factoryId,
      [...new Set(poJos.map((j) => j.machineId).filter(Boolean))] as string[],
      po.actualStart ?? po.plannedStart ?? new Date(0),
      po.actualEnd ?? new Date(),
    );
    const children = po.workOrders.map(wo =>
      this.woChild(wo as unknown as WoLite, wo.jobOrders as JoLite[], wo.downtimeEvents as DtLite[], poStates),
    );
    const b = this.oee.rollup(children);
    const poStatus = this.derivePoStatus(po.status, po.workOrders.map(w => w.status));
    const completedQty = po.workOrders.reduce((s, w) => s + (w.goodQty || 0), 0);

    await this.prisma.productionOrder.update({
      where: { id: productionOrderId },
      data: {
        oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
        completedQty,
        ...(poStatus && poStatus !== po.status
          ? {
              status: poStatus as never,
              ...(poStatus === 'IN_PROGRESS' && !po.actualStart ? { actualStart: new Date() } : {}),
              ...(poStatus === 'COMPLETED' ? { actualEnd: new Date() } : {}),
            }
          : {}),
      },
    });
    return { id: productionOrderId, oee: b.oee, status: poStatus ?? po.status };
  }

  // ── Asset-hierarchy OEE (Factory → Area → Line → Machine) ───────────────────

  /** Map a stored OEERecord to a RollupChild (idealRunTime reconstructed from stored performance). */
  private recordToChild(r: { plannedProductionMin: number; uptimeMin: number; performance: number; totalOutput: number; goodOutput: number }): RollupChild {
    return {
      ppt: r.plannedProductionMin || 0,
      runTime: r.uptimeMin || 0,
      idealRunTime: ((r.performance ?? 0) / 100) * (r.uptimeMin || 0),
      totalCount: r.totalOutput || 0,
      goodCount: r.goodOutput || 0,
    };
  }

  /**
   * Per-JO RollupChild for asset-hierarchy OEE (availability = run/planned span).
   *
   * PPT (planned production time) is CLAMPED to the analysis window when one is
   * given: a job order planned over weeks (e.g. a WO rescheduled months out for a
   * material delivery) must NOT contribute its whole multi-week planned span to a
   * one-week OEE — that single JO would otherwise collapse the aggregate
   * availability (the classic "plant OEE 1.4% while every machine is 99%" bug).
   * PPT is floored at the in-window actual run so availability never exceeds 100%.
   */
  private joRollupChild(
    jo: JoLite,
    win?: { from: number; to: number },
    states: StateLite[] = [],
    downtime: DtLite[] = [],
  ): RollupChild {
    const ps = jo.plannedStart ? new Date(jo.plannedStart).getTime() : null;
    const pe = jo.plannedEnd ? new Date(jo.plannedEnd).getTime() : null;
    // The window's upper bound must never run past NOW. "Today" ends at 23:59, so an
    // in-progress order was charged Planned Production Time for hours that have not
    // happened yet: 205 elapsed minutes against a 1,440-minute day read as 14.2%
    // Availability, while the fact store — which only accrues minutes as buckets
    // close — reported 100% for the same machine on the same screen. Equipment is
    // accountable for time that has passed, not for the rest of the calendar.
    //
    // For a window that already ended this is a no-op, so history is untouched.
    const winTo = win ? Math.min(win.to, Date.now()) : undefined;

    let plannedSpan = ps != null && pe != null ? (pe - ps) / 60_000 : 0;
    if (win && winTo != null && ps != null && pe != null) {
      // Only the planned time that falls inside the analysis window — and has
      // actually elapsed — counts.
      plannedSpan = Math.max(0, Math.min(pe, winTo) - Math.max(ps, win.from)) / 60_000;
    }
    // Run time MUST be clamped to the same window as PPT. Leaving it unclamped let a
    // job order that ran for days drag its whole span into a one-day view: PPT was
    // trimmed to the window, then the `actualSpan > ppt` guard below pushed PPT back
    // out to the full span, so "Today" silently reported days of run time and a
    // meaningless Performance. Both sides of the ratio now cover the same period.
    const actualSpan = jo.actualStart
      ? (win && winTo != null
          ? this.overlapMin(
              jo.actualStart, jo.actualEnd ?? new Date(),
              new Date(win.from), new Date(winTo),
            )
          : this.spanMin(jo.actualStart, jo.actualEnd))
      : 0;
    let ppt = plannedSpan > 0 ? plannedSpan : actualSpan;
    if (actualSpan > ppt) ppt = actualSpan; // ran longer than planned-in-window → PPT ≥ run
    const good = jo.actualQtyGood ?? 0;
    const total = good + (jo.actualQtyRejected ?? 0);
    // A job order that produced NOTHING (e.g. a PAUSED step whose actualEnd is null,
    // so spanMin counts now−start as "run") has no production to measure OEE on.
    // Counting its open-ended run with zero earned time drags the aggregate
    // Performance down — so exclude no-output operations from the rollup entirely.
    if (total <= 0) return { ppt: 0, runTime: 0, idealRunTime: 0, externalLoss: 0, totalCount: 0, goodCount: 0 };
    // idealRunTime (earned minutes) stays in the step's OWN unit → time is unit-safe,
    // and the rollup re-derives idealCycleTime = idealRunTime/totalCount so A/P are
    // unaffected by the unit of totalCount.
    const idealRunTime = (jo.idealCycleTimeSec ? jo.idealCycleTimeSec / 60 : 0) * total;
    // Counts are normalised to PIECES — the SMALLEST rung of the packaging ladder,
    // where every conversion is exact.  was used here and converts to the
    // SKU inventory base unit (CARTON for this product), so a filler counting 1,005
    // INNER was recorded as 251 and then rendered on the KPI cards labelled "pcs".
    // Inventory keeps its own base unit; analytics must not borrow it.
    const sku = jo.workOrder?.sku ?? null;
    const totalCount = sku && jo.outputUnit ? toPieces(total, jo.outputUnit, sku) : total;
    const goodCount = sku && jo.outputUnit ? toPieces(good, jo.outputUnit, sku) : good;
    // Run time is OPERATING time — the span minus every minute the machine was stopped.
    // The three kinds of stop leave the equation differently, and this must match the
    // fact-store writer (production-snapshot.service) minute for minute or the same
    // machine reports two availabilities depending on which read path answered:
    //   • planned stops    → out of run AND out of PPT (never expected to produce)
    //   • external stops   → out of run, and out of PPT via netPpt in aggregateJos
    //   • unplanned stops  → out of run, KEPT in PPT   → this is the availability loss
    //
    // The split goes through the SAME helper the writer uses, over both sources at
    // once: downtime events carry the planned/unplanned classification, machine state
    // records carry starved/blocked. Feeding them together is what makes overlaps
    // between the two — a starved state and the event it opened describing the same
    // minutes — collapse instead of being subtracted twice.
    const jsWin = win ? Math.max(jo.actualStart!.getTime(), win.from) : jo.actualStart!.getTime();
    const jeWin = win && winTo != null
      ? Math.min((jo.actualEnd ?? new Date()).getTime(), winTo)
      : (jo.actualEnd ?? new Date()).getTime();
    const stops: StopInterval[] = [
      ...downtime
        .filter((d) => !jo.machineId || d.machineId === jo.machineId)
        .map((d) => ({ startTime: d.startTime, endTime: d.endTime, isPlanned: d.isPlanned, affectsOEE: d.affectsOEE })),
      ...states
        .filter((st) => !jo.machineId || st.machineId === jo.machineId)
        .map((st) => ({ startTime: st.startTime, endTime: st.endTime, isPlanned: false, affectsOEE: false })),
    ];
    const split = splitStoppedTime(stops, jsWin, jeWin, Date.now());
    const externalLoss = Math.min(actualSpan, split.externalMin);

    return {
      ppt: Math.max(0, ppt - split.plannedMin),
      runTime: Math.max(0, actualSpan - split.plannedMin - externalLoss - split.downMin),
      idealRunTime, externalLoss, totalCount, goodCount,
    };
  }

  private nodeFromChildren(id: string, name: string, code: string | null, type: string, children: RollupChild[], childNodes?: unknown[]) {
    const b = this.oee.rollup(children);
    return {
      id, name, code, type,
      oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
      output: b.totalCount, good: b.goodCount,
      losses: b.losses,
      children: childNodes ?? [],
    };
  }

  /**
   * Output / good / scrap for ANY multi-step scope (line, area, factory, plant).
   *
   * A routed work order flows the SAME physical batch through serial steps
   * (Filling → Cartoning → Palletising → Wrapping), each recording its own qty in
   * its own unit. Summing every step's count multiplies one batch by the number of
   * steps (the "10 pallets reported as 2 500" bug). The truthful line output is the
   * GOOD output of the FINAL step; scrap is the sum of rejects at EVERY step (units
   * lost anywhere on the line). Everything is normalised to the SKU base unit so
   * inners + cartons + pallets are comparable. Grouped per work order, then summed.
   */
  private finalStepCounts(jos: JoLite[]): { total: number; good: number; scrap: number } {
    const groups = new Map<string, JoLite[]>();
    for (const jo of jos) {
      const k = jo.workOrderId ?? `__jo_${jo.id}`; // un-routed JOs stand alone
      const arr = groups.get(k) ?? [];
      arr.push(jo);
      groups.set(k, arr);
    }
    let good = 0;
    let scrap = 0;
    for (const arr of groups.values()) {
      const ordered = [...arr].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
      const sku = ordered[0]?.workOrder?.sku ?? null;
      const toBase = (qty: number, unit?: string | null) =>
        sku && unit ? toPieces(qty, unit, sku) : qty;
      // Good = FINAL step's good output (what actually left the line).
      //
      // A BYPASSED step is out of service, so product leaves the line one
      // station earlier and the step before it becomes final. This is the TS
      // half of `FINAL_STEP`; the SQL half is the same rule, and the pair is
      // held together by final-step-bypass.spec.ts.
      //
      // The `?? last` is the same guard as the SQL COALESCE: if somebody
      // bypassed every step, report the true last step rather than silently
      // reporting that the line produced nothing.
      const live = ordered.filter((j) => !j.bypassedAt);
      const final = live[live.length - 1] ?? ordered[ordered.length - 1];
      good += toBase(final.actualQtyGood ?? 0, final.outputUnit);
      // Scrap = rejects at every step (a unit can be lost at any stage).
      for (const jo of ordered) scrap += toBase(jo.actualQtyRejected ?? 0, jo.outputUnit);
    }
    return { good, scrap, total: good + scrap };
  }

  /**
   * Weighted OEE for a set of job orders. Availability/Performance are time-weighted
   * across every JO (each machine's run vs planned + earned minutes), while the
   * count-based metrics (output, good, scrap → Quality) use {@link finalStepCounts}
   * so a routed WO is never multi-counted. This is the single aggregation primitive
   * for any scope above a single step.
   */
  private aggregateJos(
    jos: JoLite[],
    win?: { from: number; to: number },
    states: StateLite[] = [],
    downtime: DtLite[] = [],
  ): OEEBreakdown {
    let ppt = 0, runTime = 0, idealRunTime = 0, externalLoss = 0;
    for (const jo of jos) {
      const c = this.joRollupChild(jo, win, states, downtime);
      ppt += c.ppt; runTime += c.runTime; idealRunTime += c.idealRunTime;
      externalLoss += c.externalLoss ?? 0;
    }
    const counts = this.finalStepCounts(jos);
    const netPpt = Math.max(0, ppt - externalLoss);
    return this.oee.calculateDetailed({
      plannedProductionTime: ppt,
      // Starved/blocked time is carved out of PPT, not charged as downtime.
      externalLoss,
      unplannedDowntime: Math.max(0, netPpt - runTime),
      // Re-derive cycle so calculateDetailed reproduces the summed earned minutes
      // exactly → Performance is unchanged; only counts/Quality are corrected.
      idealCycleTime: counts.total > 0 ? idealRunTime / counts.total : 0,
      totalCount: counts.total,
      goodCount: counts.good,
    });
  }


  // ── The ONE per-machine time aggregate ────────────────────────────────────
  /**
   * Per-machine time and quantity for a window, straight from the fact store.
   *
   * ── Why this exists ─────────────────────────────────────────────────────
   * Availability was being computed in four places from three different data
   * sources, and on 18 Aug 2026 they disagreed on screen: Machine Status showed
   * 0% for a machine that Availability Analytics showed at 91.8%, at the same
   * moment. The underlying cause was a data bug, but the reason it could reach a
   * user's eyes at all is that nothing forced the two to agree — each surface
   * had its own arithmetic, so a defect in one was invisible to the other.
   *
   * This is now the single implementation. Every page that reports how a machine
   * spent its time reads THIS, so two screens can be wrong together but can no
   * longer be wrong differently.
   *
   * Time belongs to the machine; QUANTITY is filtered to the final routing step
   * per work order, because a unit that passes five stations is one unit, not
   * five. Both rules live here rather than in each caller.
   */
  async machineFactTotals(
    machineIds: string[],
    from: Date,
    to: Date,
  ): Promise<Map<string, MachineFactTotals>> {
    if (machineIds.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<Array<MachineFactTotals & { machineId: string }>>(Prisma.sql`
      -- ── Reads the unified store ────────────────────────────────────────────
      -- This used to read "production_snapshots". The plant now keeps ONE store
      -- of measured minutes, so the shape below is a projection of "oee_minutes"
      -- onto the field names this aggregate has always returned — every caller
      -- is unchanged, and there is one fewer place that decides what a minute
      -- means.
      --
      -- One mapping is a real change and not a rename: the Availability
      -- denominator. "plannedMin" came from whatever had most recently written
      -- the plan, from several sources; "operationalMin" is the time that
      -- actually elapsed less the stops nobody is charged for. It is the
      -- published definition, it is what the OEE Analysis pages already show,
      -- and it is the one figure this migration deliberately moves.
      WITH scoped AS (
        SELECT o.*, j."sequenceOrder"
        FROM oee_minutes o
        JOIN job_orders j ON j.id = o."jobOrderId"
        WHERE o."machineId" IN (${Prisma.join(machineIds)})
          AND o."bucketStart" >= ${from} AND o."bucketStart" < ${to}
      ),
      -- TIME belongs to every machine: a minute the filler spent broken is a
      -- real minute regardless of where it sat in the routing.
      t AS (
        SELECT s."machineId",
               SUM(GREATEST(0, s."totalMin" - s."plannedStopMin"
                   - s."externalLossMin" - s."unmeasuredMin"))::float8 AS "plannedMin",
               SUM(s."operatingMin")::float8          AS "runMin",
               SUM(s."availabilityLossMin")::float8   AS "downMin",
               SUM(s."plannedStopMin")::float8        AS "plannedDownMin",
               SUM(s."externalLossMin")::float8       AS "externalMin",
               SUM(s."unmeasuredMin")::float8         AS "unmeasuredMin",
               SUM(s."microStopMin")::float8          AS "microStopMin",
               -- Earned minutes. The old store kept this as a column
               -- (idealCycleSec/60 x totalBase); here it is the same quantity
               -- from the same inputs — the parts made, at the design speed that
               -- made them. Algebraically identical, so Performance is unmoved.
               SUM(CASE WHEN COALESCE(s."designSpeedPph", 0) > 0
                        THEN ((s."goodParts" + s."rejectedParts") / s."designSpeedPph") * 60
                        ELSE 0 END)::float8           AS "idealRunMin"
        FROM scoped s GROUP BY s."machineId"
      ),
      -- QUANTITIES come from the FINAL routing step per work order on that
      -- machine, exactly as before: a unit that passes five stations is one
      -- unit, not five.
      fin AS (
        SELECT s2."machineId", s2."workOrderId", MAX(s2."sequenceOrder") ms
        FROM scoped s2 GROUP BY s2."machineId", s2."workOrderId"
      ),
      q AS (
        SELECT s."machineId",
               SUM(s."goodParts" + s."rejectedParts")::float8 AS "totalBase",
               SUM(s."goodParts")::float8                     AS "goodBase",
               SUM(s."rejectedParts")::float8                 AS "scrapBase"
        FROM scoped s
        JOIN fin f ON f."machineId" = s."machineId"
                  AND f."workOrderId" IS NOT DISTINCT FROM s."workOrderId"
                  AND f.ms = s."sequenceOrder"
        GROUP BY s."machineId"
      )
      SELECT t."machineId",
             COALESCE(t."plannedMin", 0)     AS "plannedMin",
             COALESCE(t."runMin", 0)         AS "runMin",
             COALESCE(t."downMin", 0)        AS "downMin",
             COALESCE(t."plannedDownMin", 0) AS "plannedDownMin",
             COALESCE(t."externalMin", 0)    AS "externalMin",
             COALESCE(t."unmeasuredMin", 0)  AS "unmeasuredMin",
             COALESCE(t."microStopMin", 0)   AS "microStopMin",
             COALESCE(t."idealRunMin", 0)    AS "idealRunMin",
             COALESCE(q."totalBase", 0)      AS "totalBase",
             COALESCE(q."goodBase", 0)       AS "goodBase",
             COALESCE(q."scrapBase", 0)      AS "scrapBase"
      FROM t LEFT JOIN q ON q."machineId" = t."machineId"
    `);
    return new Map(rows.map((r) => [r.machineId, r]));
  }


  /**
   * The same aggregate, keyed by JOB ORDER — for anything that reports on a step.
   *
   * The shop-floor live page and the per-step badges used to compute their own
   * A/P/Q from the job-order row: availability as elapsed-since-start over planned
   * duration, with no downtime subtracted at all. That is the original fail-open
   * assumption, still running in its own corner of the code, and it could not fall
   * below 100% for a machine that simply kept reporting.
   *
   * The fact store already keys on jobOrderId, so a step's real minutes are one
   * query away and there was never a reason to estimate them.
   */
  async jobOrderFactTotals(
    jobOrderIds: string[],
    win?: { from: Date; to: Date },
  ): Promise<Map<string, MachineFactTotals>> {
    if (jobOrderIds.length === 0) return new Map();
    const window = win
      ? Prisma.sql`AND "bucketStart" >= ${win.from} AND "bucketStart" < ${win.to}`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<Array<MachineFactTotals & { jobOrderId: string }>>(Prisma.sql`
      SELECT "jobOrderId",
             COALESCE(SUM("plannedMin"), 0)::float8     AS "plannedMin",
             COALESCE(SUM("runMin"), 0)::float8         AS "runMin",
             COALESCE(SUM("downMin"), 0)::float8        AS "downMin",
             COALESCE(SUM("plannedDownMin"), 0)::float8 AS "plannedDownMin",
             COALESCE(SUM("externalMin"), 0)::float8    AS "externalMin",
             COALESCE(SUM("unmeasuredMin"), 0)::float8  AS "unmeasuredMin",
             COALESCE(SUM("microStopMin"), 0)::float8   AS "microStopMin",
             COALESCE(SUM("idealRunMin"), 0)::float8    AS "idealRunMin",
             COALESCE(SUM("totalBase"), 0)::float8      AS "totalBase",
             COALESCE(SUM("goodBase"), 0)::float8       AS "goodBase",
             COALESCE(SUM("scrapBase"), 0)::float8      AS "scrapBase"
      FROM ${MINUTE_FACTS} snap
      WHERE granularity = 'MINUTE'
        AND "jobOrderId" IN (${Prisma.join(jobOrderIds)})
        ${window}
      GROUP BY "jobOrderId"
    `);
    return new Map(rows.map((r) => [r.jobOrderId, r]));
  }

  /**
   * A/P/Q/OEE from a fact-store total — on BOTH bases. One place, so a step badge,
   * a live page and an analytics chart cannot grade the same job order
   * differently.
   *
   * ── Two availabilities, deliberately ────────────────────────────────────
   * They answer different questions and a plant needs both:
   *
   *   schedule-based  run ÷ planned production time
   *                   "of the time we intended to produce, how much did we?"
   *                   Time scheduled but never started counts against it.
   *
   *   time-based      run ÷ (run + unplanned downtime)          — OEE-TB
   *                   "while the line was up and running, how much of that was
   *                   productive?" Blind to whether it was scheduled at all.
   *
   * Unifying the engine dropped the time-based pair, which was a real loss: a
   * plant that runs to demand rather than to a fixed schedule reads OEE-TB, and
   * the system is expected to support both. Both now travel together from here,
   * so no surface can carry one and not the other.
   *
   * Null rather than zero wherever the denominator is absent: a step with nothing
   * planned has no availability, and 0% would read as failure instead of "never
   * asked to run".
   */
  factorsFromFacts(f: MachineFactTotals | undefined) {
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const runMin = f?.runMin ?? 0;
    const plannedMin = f?.plannedMin ?? 0;
    const downMin = f?.downMin ?? 0;
    const total = f?.totalBase ?? 0;

    const availability = plannedMin > 0 ? r1((runMin / plannedMin) * 100) : null;
    // Planned and external minutes are already out of both terms by the writer,
    // so run + down IS the time the machine was up and accountable.
    const uptime = runMin + downMin;
    const availabilityTb = uptime > 0 ? r1((runMin / uptime) * 100) : null;

    const performance = runMin > 0 ? Math.min(100, r1(((f?.idealRunMin ?? 0) / runMin) * 100)) : null;
    const quality = total > 0 ? r1(((f?.goodBase ?? 0) / total) * 100) : null;

    const compose = (a: number | null) =>
      a != null && performance != null && quality != null
        ? r1(oeeIdentityOf(a, performance, quality))
        : null;

    return {
      availability, performance, quality,
      oee: compose(availability),
      // Same P and Q; only the availability basis differs.
      availabilityTb, oeeTb: compose(availabilityTb),
    };
  }

  /**
   * The same aggregate, bucketed per plant-calendar day — for trend lines.
   *
   * Kept beside {@link machineFactTotals} rather than in the pages that draw
   * charts, for the same reason: this existed twice, once here and once in
   * machine-status, and two copies of a query are two chances to drift.
   */
  async dailyFactTotals(
    machineIds: string[],
    from: Date,
    to: Date,
  ): Promise<Array<DailyFactTotals>> {
    if (machineIds.length === 0) return [];
    return this.prisma.$queryRaw<Array<DailyFactTotals>>(Prisma.sql`
      WITH scoped AS (
        SELECT *, date_trunc('day', "bucketStart" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Riyadh') AS d
        FROM ${MINUTE_FACTS} snap
        WHERE granularity = 'MINUTE'
          AND "machineId" IN (${Prisma.join(machineIds)})
          AND "bucketStart" >= ${from} AND "bucketStart" < ${to}
      ),
      t AS (
        SELECT d, SUM("plannedMin")::float AS "plannedMin", SUM("runMin")::float AS "runMin",
               SUM("downMin")::float AS "downMin",
               SUM("idealRunMin")::float AS "idealRunMin"
        FROM scoped GROUP BY d
      ),
      -- Final step per work order per day, for the same reason as above.
      fin AS (SELECT d, "workOrderId", ${FINAL_STEP} ms FROM scoped GROUP BY d, "workOrderId"),
      q AS (
        SELECT s.d, SUM(s."totalBase")::float AS "totalBase", SUM(s."goodBase")::float AS "goodBase"
        FROM scoped s JOIN fin f ON f.d = s.d AND f."workOrderId" = s."workOrderId" AND f.ms = s."sequenceOrder"
        GROUP BY s.d
      )
      SELECT t.d AS day, t."plannedMin", t."runMin", t."downMin", t."idealRunMin",
             COALESCE(q."totalBase", 0) AS "totalBase", COALESCE(q."goodBase", 0) AS "goodBase"
      FROM t LEFT JOIN q ON q.d = t.d ORDER BY t.d
    `);
  }

  // ── Fact-store reads (ProductionSnapshot) ──────────────────────────────────
  /** True when dashboards should aggregate the persisted fact store, not live JOs. */
  snapshotsEnabled(): boolean {
    return process.env.SNAPSHOTS_READ === 'on';
  }

  /** SUM columns for a fact-store rollup. `good` filters to the group's final step
   *  (last sequenceOrder), referenced via the joined `fin` CTE alias. */
  private snapMetricCols(finAlias: string): Prisma.Sql {
    return Prisma.sql`
      COALESCE(SUM(s."scrapBase"),0)::float8 AS scrap,
      COALESCE(SUM(s."goodBase") FILTER (WHERE s."sequenceOrder" = ${Prisma.raw(finAlias)}.ms),0)::float8 AS good,
      COALESCE(SUM(s."plannedMin"),0)::float8 AS ppt,
      COALESCE(SUM(s."runMin"),0)::float8 AS run,
      COALESCE(SUM(s."downMin"),0)::float8 AS down,
      COALESCE(SUM(s."externalMin"),0)::float8 AS external,
      COALESCE(SUM(s."idealRunMin"),0)::float8 AS earned`;
  }

  /**
   * One node of the hierarchy tree — projected from the two engines.
   *
   * Every node in `hierarchyOEE` calls this, so it is the one place the tree's
   * numbers are decided. It used to return `snapMetrics`, which published
   * `availability` and `availabilityTb` as two bases when they are the same
   * quantity — see snapshotAggregate for the proof. With the cards fixed and
   * this left alone, the tree read OEE 34.3% beside cards reading 2.2% for the
   * same machine and window: the disagreement moved rather than ended.
   *
   *     availability / oee        the SCHEDULE engine — the committed slot
   *     availabilityTb / oeeTb    the STANDARD engine — elapsed less excused stops
   *
   * The loss minutes come from the standard engine's time model, which names the
   * same four buckets this shape has always carried.
   */
  async snapshotScope(
    factoryId: string | null, from: Date, to: Date, machineIds: string[] | undefined,
    /** End of the requested period. See snapshotAggregate — `to` is clamped. */
    slotTo?: Date,
  ) {
    const n = (v: number | null | undefined) => v ?? 0;
    const r1 = (v: number) => Math.round(v * 10) / 10;
    // A node covering no machines — an empty area, or one whose only machine was
    // archived. Zero, rather than a query that would cover the whole factory.
    if (machineIds && machineIds.length === 0) {
      return {
        oee: 0, availability: 0, performance: 0, quality: 0, oeeTb: 0, availabilityTb: 0,
        totalCount: 0, goodCount: 0,
        losses: { availabilityLossMin: 0, performanceLossMin: 0, qualityLossMin: 0, externalLossMin: 0 },
      };
    }

    const scope: OeeScope = machineIds ? { machineIds } : {};
    const [std, sch] = await Promise.all([
      this.oeeStandard.overview(factoryId, from, to, scope),
      this.oeeSchedule.overview(factoryId, from, to, slotTo ?? endOfPlantDay(to), scope),
    ]);

    return {
      oee: n(sch.oee), availability: n(sch.availability),
      performance: n(std.performance), quality: n(std.quality),
      oeeTb: n(std.oee), availabilityTb: n(std.availability),
      totalCount: std.counts.total,
      goodCount: std.counts.good,
      losses: {
        availabilityLossMin: r1(std.time.availabilityLossMin),
        performanceLossMin: r1(std.time.performanceLossMin),
        qualityLossMin: r1(std.time.qualityLossMin),
        externalLossMin: r1(std.time.externalLossMin),
      },
    };
  }

  private snapWhere(factoryId: string | null, from: Date, to: Date, machineIds?: string[]): Prisma.Sql {
    const c: Prisma.Sql[] = [
      Prisma.sql`granularity = 'MINUTE'`,
      Prisma.sql`"bucketStart" >= ${from}`,
      Prisma.sql`"bucketStart" < ${to}`,
    ];
    if (factoryId) c.push(Prisma.sql`"factoryId" = ${factoryId}`);
    if (machineIds) c.push(Prisma.sql`"machineId" = ANY(${machineIds})`);
    return Prisma.join(c, ' AND ');
  }

  /**
   * The OEE headline, per-machine list and trend — projected from the TWO ENGINES.
   *
   * ── The bug this replaced ───────────────────────────────────────────────────
   * This built its own pair of availability bases:
   *
   *     availability   = runMin / plannedMin      plannedMin = total - planned
   *                                                          - external - unmeasured
   *     availabilityTb = runMin / (runMin + downMin)
   *
   * and published them as the two sides of the OEE / OEE-TB toggle on every
   * dashboard. But the six minute buckets are defined to sum to totalMin, so
   *
   *     total - planned - external - unmeasured  ===  operating + availabilityLoss
   *
   * identically. The two denominators were the SAME QUANTITY, and the toggle
   * switched between a number and that number rounded a second time. Measured on
   * this plant, to six decimals on every machine: M1 1222.7760 vs 1222.7760,
   * M3 1208.1418 vs 1208.1418, M4 1142.9058 vs 1142.9058, M5 864.9178 vs
   * 864.9178 — difference 0.000000 throughout.
   *
   * So the Command Center showed 34.6% and 34.5% for its two "bases" while the
   * OEE Analysis page, which calls the engines directly, showed 34.6% and 1.6%.
   * `plannedMin` here was never the planned time: it is elapsed time less the
   * stops nobody is charged for, which IS the standard basis. The committed slot
   * exists only in the schedule engine, and this path had never reached it.
   *
   * ── What it is now ──────────────────────────────────────────────────────────
   * A projection. No factor is derived here:
   *
   *     availability / oee        the SCHEDULE engine — the committed slot
   *     availabilityTb / oeeTb    the STANDARD engine — elapsed less excused stops
   *     performance / quality     shared; neither depends on the time basis
   *
   * which is the vocabulary the OEE Analysis page and Live Shift already use, so
   * the toggle means one thing everywhere.
   *
   * Nulls are coerced to 0 here, as the old code did. The engines keep "not
   * measured" distinct from "measured at zero" and the twenty-odd pages
   * downstream do not yet; widening them is its own change, and doing it here
   * silently would put undefined into a .toFixed() on screens nobody asked to
   * touch.
   */
  async snapshotAggregate(
    factoryId: string | null, from: Date, to: Date, machineIds: string[] | undefined,
    bucket: TrendBucket = 'hour',
    opts: { workOrderId?: string; productionOrderId?: string; slotTo?: Date } = {},
  ) {
    const scope: OeeScope = {
      ...(machineIds ? { machineIds } : {}),
      ...(opts.workOrderId ? { workOrderId: opts.workOrderId } : {}),
      ...(opts.productionOrderId ? { productionOrderId: opts.productionOrderId } : {}),
    };
    const n = (v: number | null | undefined) => v ?? 0;
    const r1 = (v: number) => Math.round(v * 10) / 10;

    /**
     * How far the committed slot reaches.
     *
     * NOT `to`. Callers clamp `to` to now, because planned production time must
     * not accrue for hours that have not happened. The schedule basis needs the
     * opposite: the unreached remainder of the slot is the term that makes the
     * reading climb from low to true as the period runs, and dropping it turns
     * this basis into the standard one wearing a different name.
     *
     * Passing `to` gave 34.0% / A 98.4% where the analysis page — which clips
     * to the END of the selected period — gave 2.1% / A 6.0% for the same
     * machine and window.
     *
     * The period end is something only the CALLER knows: `to` has already been
     * clamped, so it cannot be recovered here. Callers holding the raw `dateTo`
     * pass `opts.slotTo`, computed exactly as the schedule controller computes
     * it — plantBound(dateTo, 'end') — or the same request answered by two
     * routes clips the slot differently.
     *
     * The fallback below is the end of the plant day containing `to`: right for
     * the whole-day windows most callers build, WRONG for a sub-day one. A
     * SHIFT window is exactly that case — asking for 19:30 → 02:00 gave a slot
     * ending at 23:59 the following night, and the dashboards read OEE 6.0% /
     * A 17.1% where /oee-schedule read 28.3% / 80.9% for the same request.
     */
    const slotTo = opts.slotTo ?? endOfPlantDay(to);

    const [std, sch, stdM, schM, stdT, schT] = await Promise.all([
      this.oeeStandard.overview(factoryId, from, to, scope),
      this.oeeSchedule.overview(factoryId, from, to, slotTo, scope),
      this.oeeStandard.byMachine(factoryId, from, to, scope),
      this.oeeSchedule.byMachine(factoryId, from, to, slotTo, scope),
      this.oeeStandard.trend(factoryId, from, to, bucket, scope),
      this.oeeSchedule.trend(factoryId, from, to, slotTo, bucket, scope),
    ]);

    const current = {
      oee: n(sch.oee), availability: n(sch.availability),
      performance: n(std.performance), quality: n(std.quality),
      oeeTb: n(std.oee), availabilityTb: n(std.availability),
    };

    const schByMachine = new Map(schM.map((r) => [r.key, r]));
    const byEquipment = stdM.map((r) => {
      const sc = schByMachine.get(r.key);
      return {
        machineId: r.key, name: r.sublabel ?? r.label, code: r.label,
        oee: n(sc?.oee), availability: n(sc?.availability),
        performance: n(r.performance), quality: n(r.quality),
        availabilityTb: n(r.availability), oeeTb: n(r.oee),
        output: Math.round(r.counts.total),
        good: Math.round(r.counts.good),
        scrap: Math.round(r.counts.rejected),
      };
    }).sort((a, b) => b.oee - a.oee);

    // The label the dashboards have always drawn: the hour, or month/day.
    const label = (at: Date) => (bucket === 'hour'
      ? `${String(at.getHours()).padStart(2, '0')}:00`
      : `${at.getMonth() + 1}/${at.getDate()}`);
    const schByAt = new Map(schT.map((r) => [new Date(r.at).getTime(), r]));
    const trend = stdT.map((r) => {
      const sc = schByAt.get(new Date(r.at).getTime());
      return {
        period: label(new Date(r.at)),
        oee: n(sc?.oee), availability: n(sc?.availability),
        oeeTb: n(r.oee), availabilityTb: n(r.availability),
        performance: n(r.performance), quality: n(r.quality),
        output: Math.round(r.counts.total),
        good: Math.round(r.counts.good),
        scrap: Math.round(r.counts.rejected),
        down: r1(r.time.availabilityLossMin),
      };
    });

    return {
      current,
      // Rounded at the API boundary. Bags and cartons are discrete: a card
      // reading "178,870.511 units" is a conversion artefact, not a measurement.
      totalOutput: Math.round(std.counts.total),
      goodOutput: Math.round(std.counts.good),
      downtimeMin: r1(std.time.availabilityLossMin),
      // Time the scope was ready but the line could not feed or drain it.
      // Reported separately so it is visibly excluded rather than absorbed.
      externalLossMin: r1(std.time.externalLossMin),
      byEquipment,
      trend,
    };
  }


  /**
   * Per-day OEE for ONE machine — the canonical machine trend.
   *
   * Projected from the two engines for the same reason `snapshotAggregate` is:
   * it used to call `snapMetrics`, so it published the same pair of identical
   * denominators under the names of two different bases, and the machine trend
   * disagreed with the analysis page's trend for the same machine and window.
   */
  async snapshotMachineTrend(factoryId: string | null, machineId: string, from: Date, to: Date) {
    const scope: OeeScope = { machineId };
    const n = (v: number | null | undefined) => v ?? 0;
    const [std, sch] = await Promise.all([
      this.oeeStandard.trend(factoryId, from, to, 'day', scope),
      this.oeeSchedule.trend(factoryId, from, to, endOfPlantDay(to), 'day', scope),
    ]);
    const schByAt = new Map(sch.map((r) => [new Date(r.at).getTime(), r]));
    return std.map((r) => {
      const sc = schByAt.get(new Date(r.at).getTime());
      return {
        date: r.at,
        availability: n(sc?.availability), availabilityTb: n(r.availability),
        performance: n(r.performance), quality: n(r.quality),
        oee: n(sc?.oee), oeeTb: n(r.oee),
      };
    });
  }

  /** Hierarchy node built from JOs (final-step counts) instead of pre-summed children. */
  private nodeFromJos(id: string, name: string, code: string | null, type: string, jos: JoLite[], win: { from: number; to: number }, childNodes?: unknown[], states: StateLite[] = [], downtime: DtLite[] = []) {
    const b = this.aggregateJos(jos, win, states, downtime);
    // Time-based twin so the schedule-vs-time-based toggle reaches every node of the
    // tree, not only the cards above it. With no downtime rows supplied this reduces
    // to "all operating time was up", which is what an empty downtime log means.
    const tb = this.timeBasedOee(jos, downtime, b.performance, b.quality, win);
    return {
      id, name, code, type,
      oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
      oeeTb: tb.oeeTb, availabilityTb: tb.availabilityTb,
      output: b.totalCount, good: b.goodCount,
      // externalLossMin lets the UI show "waiting on the line" separately from
      // "this machine was down" — the distinction the pilot site asked for.
      externalLossMin: b.losses.externalLossMin,
      losses: b.losses,
      children: childNodes ?? [],
    };
  }

  /** Resolve an analysis scope to the covered machine ids (undefined = whole factory). */
  async resolveScopeMachineIds(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ): Promise<string[] | undefined> {
    if (!scope || (!scope.areaId && !scope.lineId && !scope.machineId)) return undefined;
    if (scope.machineId) return [scope.machineId];
    const ms = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        // An archived or deactivated machine is not part of the plant any more, and
        // every other surface already excludes it — machine-status, the line KPI and
        // the loss tree all filter here. This one did not, so a machine the user had
        // deleted kept contributing (zeros) to every scope total derived from it.
        isActive: true,
        archivedAt: null,
        ...(scope.lineId ? { lineId: scope.lineId } : {}),
        ...(scope.areaId ? { line: { areaId: scope.areaId } } : {}),
      },
      select: { id: true },
    });
    return ms.map((m) => m.id);
  }

  /**
   * The OEE read every dashboard goes through.
   *
   * One path. It used to branch: the fact store normally, and a live job-order
   * scan whenever a WO or PO filter was applied or SNAPSHOTS_READ was off. That
   * second branch derived its own A/P/Q, so applying a drill-down filter
   * silently changed which arithmetic answered the question — and the reader saw
   * only that the number moved.
   *
   * Both engines take `workOrderId` and `productionOrderId` in their scope, so a
   * drill-down is the same query with one more predicate.
   */
  async oeeAnalytics(
    factoryId: string | null,
    from: Date,
    to: Date,
    machineIds: string[] | undefined,
    bucket: TrendBucket = 'hour',
    opts: { workOrderId?: string; productionOrderId?: string; slotTo?: Date } = {},
  ) {
    return this.snapshotAggregate(factoryId, from, to, machineIds, bucket, opts);
  }


  /**
   * THE single place a production line's headline OEE is decided.
   *
   * Every surface that shows a line-level figure — the Factory→Area→Line→Machine
   * tree, the OEE analytics cards, the line endpoint — must call this, otherwise
   * the same line reads differently on different screens depending on which code
   * path rendered it. That divergence is exactly what the pilot site reported twice.
   *
   * Returns the metrics plus a `basis` block naming the method and how each input
   * was resolved, so a number is never shown without an explanation available.
   *
   * BOTTLENECK degrades to ROLLUP rather than failing: a tree node that cannot
   * resolve a constraint must still show a real figure, labelled with the method
   * that actually produced it.
   */
  private lineOeeFromJos(
    cfg: {
      oeeMethod?: string | null;
      bottleneckMachineId?: string | null;
      outfeedMachineIds?: string[] | null;
    },
    lineMachines: { id: string; name: string }[],
    jos: JoLite[],
    win: { from: number; to: number },
    states: StateLite[],
    rated?: Map<string, { machineId: string; unitsPerHour: number }>,
    downtime: DtLite[] = [],
  ) {
    const rollup = () => {
      const agg = this.aggregateJos(jos, win, states, downtime);
      return {
        oee: agg.oee,
        availability: agg.availability,
        performance: agg.performance,
        quality: agg.quality,
        output: agg.totalCount,
        good: agg.goodCount,
        losses: agg.losses,
        method: 'ROLLUP' as const,
        // Present on every branch so callers never need to narrow the union.
        bottleneckId: null as string | null,
        outfeedIds: new Set<string>(),
        basis: {
          method: 'ROLLUP' as const,
          formula:
            'Line OEE = A × P × Q, re-derived from the summed planned / run / earned minutes '
            + 'and counts of every machine (NOT an average of machine percentages)',
          machineCount: lineMachines.length,
          externalLossMin: agg.losses.externalLossMin,
        },
      };
    };

    if (cfg.oeeMethod !== 'BOTTLENECK') return rollup();

    // Constraint: explicit nomination, else the slowest ROUTING cycle time.
    const slowest = rated
      ? [...rated.values()].sort((a, b) => a.unitsPerHour - b.unitsPerHour)[0] ?? null
      : null;
    const bottleneck =
      lineMachines.find((m) => m.id === cfg.bottleneckMachineId) ??
      (slowest ? lineMachines.find((m) => m.id === slowest.machineId) ?? null : null);

    // Nothing to measure the line by — fall back rather than hide the node.
    if (!bottleneck) {
      const r = rollup();
      return {
        ...r,
        basis: {
          ...r.basis,
          fallbackFrom: 'BOTTLENECK' as const,
          fallbackReason: 'No bottleneck configured and no routing cycle time to infer one.',
        },
      };
    }

    const configuredOutfeeds = lineMachines.filter((m) => (cfg.outfeedMachineIds ?? []).includes(m.id));
    const outfeeds = configuredOutfeeds.length > 0 ? configuredOutfeeds : lineMachines;
    const outfeedIds = new Set(outfeeds.map((m) => m.id));

    const bn = this.aggregateJos(jos.filter((j) => j.machineId === bottleneck.id), win, states, downtime);
    const outCounts = this.finalStepCounts(jos.filter((j) => j.machineId && outfeedIds.has(j.machineId)));

    const result = this.oee.lineOee({
      bottleneck: {
        availability: bn.availability,
        performance: bn.performance,
        machineId: bottleneck.id,
        machineName: bottleneck.name,
      },
      finalOutfeed: {
        totalCount: outCounts.total,
        goodCount: outCounts.good,
        pointName: outfeeds.map((m) => m.name).join(' + '),
      },
    });

    return {
      oee: result.oee,
      availability: result.availability,
      performance: result.performance,
      quality: result.quality,
      output: outCounts.total,
      good: outCounts.good,
      losses: bn.losses,
      method: 'BOTTLENECK' as const,
      bottleneckId: bottleneck.id as string | null,
      outfeedIds,
      basis: {
        ...result.basis,
        bottleneckResolvedBy: (cfg.bottleneckMachineId
          ? 'CONFIGURED'
          : 'SLOWEST_ROUTING_CYCLE_TIME') as 'CONFIGURED' | 'SLOWEST_ROUTING_CYCLE_TIME',
        outfeedResolvedBy: (configuredOutfeeds.length > 0
          ? 'CONFIGURED'
          : 'ALL_MACHINES_ON_LINE') as 'CONFIGURED' | 'ALL_MACHINES_ON_LINE',
        outfeedMachineNames: outfeeds.map((m) => m.name),
        bottleneckExternalLossMin: bn.losses.externalLossMin,
        formula: 'Line OEE = Bottleneck Availability × Bottleneck Performance × Final Outfeed Quality',
      },
    };
  }

  /**
   * Overall Line OEE by the bottleneck method (the pilot site PoC items 8 & 9).
   *
   *   Line OEE = Bottleneck Availability × Bottleneck Performance × Final Outfeed Quality
   *
   * The constraint and the outfeed point are nominated per line
   * (`ProductionLine.bottleneckMachineId` / `outfeedMachineId`). When either is
   * unset the method falls back to a defensible default — lowest design capacity
   * for the constraint, last machine in line order for the outfeed — and reports
   * which rule it used in `basis.resolvedBy`, so the number is never unexplained.
   */
  async lineOeeAnalytics(
    factoryId: string | null,
    lineId: string,
    from: Date,
    to: Date,
  ) {
    const line = await this.prisma.productionLine.findFirst({
      where: { id: lineId, ...(factoryId ? { factoryId } : {}) },
      select: {
        id: true, name: true, code: true,
        oeeMethod: true, bottleneckMachineId: true, outfeedMachineIds: true,
        machines: {
          where: { isActive: true, archivedAt: null },
          select: { id: true, name: true, code: true, sortOrder: true },
        },
      },
    });
    if (!line || line.machines.length === 0) return null;

    const machineIds = line.machines.map((m) => m.id);

    const jos = (await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        machineId: { in: machineIds },
        ...joOverlapsWindow(from, to),
      },
      select: JO_SELECT_ANALYTICS,
    })) as unknown as JoLite[];

    const states = await this.loadExternalStates(factoryId, machineIds, from, to);
    const win = { from: from.getTime(), to: to.getTime() };

    // Unplanned downtime overlapping the window — required for the TIME-BASED
    // availability (OEE-TB). Without it this endpoint could not honour the
    // schedule-vs-time-based toggle and the Overall Line OEE card silently stayed
    // on the schedule basis while every card beside it switched.
    const downtime = (await this.prisma.downtimeEvent.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        machineId: { in: machineIds },
        startTime: { lte: to },
        OR: [{ endTime: null }, { endTime: { gte: from } }],
      },
      select: DT_SELECT,
    })) as unknown as DtLite[];

    // Per-machine diagnostics are returned by BOTH methods — they are useful either
    // way, and labelling them as machine-level stops them being read as the line KPI.
    const machineRows = (bottleneckId: string | null, outfeedIds: Set<string>) =>
      line.machines.map((m) => {
        const mjos = jos.filter((j) => j.machineId === m.id);
        const b = this.aggregateJos(mjos, win, states, downtime);
        const tb = this.timeBasedOee(mjos, downtime, b.performance, b.quality, win);
        return {
          machineId: m.id, name: m.name, code: m.code,
          isBottleneck: m.id === bottleneckId,
          isOutfeed: outfeedIds.has(m.id),
          oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
          availabilityTb: tb.availabilityTb, oeeTb: tb.oeeTb,
          externalLossMin: b.losses.externalLossMin,
          output: b.totalCount,
        };
      });

    // The basis decision itself lives in ONE place (lineOeeFromJos) so this endpoint,
    // the hierarchy tree and every KPI card resolve a line identically.
    const rated = line.oeeMethod === 'BOTTLENECK'
      ? await this.scheduleKpi.ratedCapacityByMachine(factoryId, machineIds)
      : undefined;
    const b = this.lineOeeFromJos(line, line.machines, jos, win, states, rated, downtime);

    // Time-based twin of the line KPI, on the SAME basis as the schedule-based one:
    // under BOTTLENECK the availability comes from the constraint machine alone, so
    // its time-based availability must too — taking it from the whole line would
    // quietly answer a different question than the number beside it.
    const tbJos = b.method === 'BOTTLENECK' && b.bottleneckId
      ? jos.filter((j) => j.machineId === b.bottleneckId)
      : jos;
    const lineTb = this.timeBasedOee(tbJos, downtime, b.performance, b.quality, win);

    return {
      lineId: line.id,
      lineName: line.name,
      lineCode: line.code,
      // Top-level discriminant so callers can narrow without reaching into `basis` —
      // TypeScript will not discriminate on a nested property.
      method: b.method,
      oee: b.oee,
      availability: b.availability,
      performance: b.performance,
      quality: b.quality,
      // OEE-TB: same P and Q, availability measured against uptime + downtime.
      oeeTb: lineTb.oeeTb,
      availabilityTb: lineTb.availabilityTb,
      basis: { ...b.basis, window: { from: from.toISOString(), to: to.toISOString() } },
      machines: machineRows(b.bottleneckId ?? null, b.outfeedIds ?? new Set<string>()),
    };
  }

  /**
   * OEE grouped by a business dimension instead of time buckets — so a chart can
   * show OEE per Production Order / Work Order / Shift / Machine over the window,
   * not just a sparse time line. Each group is a proper time-weighted rollup
   * (same engine + window-clamped PPT as the headline OEE).
   */
  /** Fact-store rollup grouped by a business dimension (twin of oeeGroupedTrend). */
  async snapshotGrouped(
    factoryId: string | null, from: Date, to: Date, machineIds: string[] | undefined,
    groupBy: 'machine' | 'workOrder' | 'productionOrder' | 'shift',
  ) {
    if (machineIds && machineIds.length === 0) return [];
    const colSql: Record<string, string> = {
      machine: '"machineId"',
      workOrder: '"workOrderId"',
      productionOrder: `COALESCE("productionOrderId",'__direct')`,
      // Group by the DERIVED shift (template + the day the occurrence started),
      // not by shiftInstanceId. Nothing creates ShiftInstance rows, so grouping on
      // that column put every bucket in one group called "Unassigned".
      shift: `COALESCE("shiftCode", '__noshift')`,
    };
    const col = Prisma.raw(colSql[groupBy] ?? '"machineId"');
    const where = this.snapWhere(factoryId, from, to, machineIds);
    const rows = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      WITH scoped AS (SELECT * FROM ${MINUTE_FACTS} snap WHERE ${where}),
           fin AS (SELECT ${col} AS gk, "workOrderId" AS wo, ${FINAL_STEP} ms FROM scoped GROUP BY ${col}, "workOrderId")
      SELECT ${col} AS key, ${this.snapMetricCols('f')}
      FROM scoped s JOIN fin f ON f.gk = ${col} AND f.wo = s."workOrderId"
      GROUP BY ${col}`);

    // Resolve human labels for the keys (one lightweight lookup per dimension).
    const keys = rows.map((r) => r.key).filter((k) => k && !String(k).startsWith('__'));
    const labels = new Map<string, string>();
    if (groupBy === 'machine' && keys.length) {
      (await this.prisma.machine.findMany({ where: { id: { in: keys } }, select: { id: true, name: true, code: true } }))
        .forEach((m) => labels.set(m.id, m.name ?? m.code ?? '—'));
    } else if (groupBy === 'workOrder' && keys.length) {
      (await this.prisma.workOrder.findMany({ where: { id: { in: keys } }, select: { id: true, orderNumber: true } }))
        .forEach((w) => labels.set(w.id, w.orderNumber));
    } else if (groupBy === 'productionOrder' && keys.length) {
      (await this.prisma.productionOrder.findMany({ where: { id: { in: keys } }, select: { id: true, orderNumber: true } }))
        .forEach((p) => labels.set(p.id, p.orderNumber));
    } else if (groupBy === 'shift' && keys.length) {
      // Keys are shift CODES now, resolved against the templates. Looking them up in
      // shift_instances found nothing — the table holds one row in the whole system —
      // which is why every group fell through to the "Unassigned" fallback.
      (await this.prisma.shiftTemplate.findMany({
        where: { code: { in: keys } },
        select: { code: true, name: true, startTime: true, endTime: true },
      })).forEach((t) => labels.set(t.code, `${t.name} · ${t.startTime}–${t.endTime}`));
    }
    const fallback = groupBy === 'productionOrder' ? 'Direct WOs' : groupBy === 'shift' ? 'Unassigned' : '—';

    /**
     * The two bases per group, from the engines.
     *
     * `machineIds` still bounds the scope — a group is a slice of the same set
     * of machines the caller asked about, not a way around the filter.
     */
    const scopeFor = (key: string): OeeScope => ({
      ...(machineIds ? { machineIds } : {}),
      ...(groupBy === 'machine' ? { machineIds: [key] } : {}),
      ...(groupBy === 'workOrder' ? { workOrderId: key } : {}),
      ...(groupBy === 'productionOrder' && !key.startsWith('__') ? { productionOrderId: key } : {}),
      ...(groupBy === 'shift' && !key.startsWith('__') ? { shiftCode: key } : {}),
    });
    const slotTo = endOfPlantDay(to);
    const factors = new Map(await Promise.all(rows.map(async (r) => {
      const sc = scopeFor(String(r.key));
      const [std, sch] = await Promise.all([
        this.oeeStandard.overview(factoryId, from, to, sc),
        this.oeeSchedule.overview(factoryId, from, to, slotTo, sc),
      ]);
      return [String(r.key), {
        oee: sch.oee ?? 0, availability: sch.availability ?? 0,
        performance: std.performance ?? 0, quality: std.quality ?? 0,
        oeeTb: std.oee ?? 0, availabilityTb: std.availability ?? 0,
      }] as const;
    })));


    return rows
      .map((r) => {
        // The factor pair comes from the ENGINES, keyed to this group.
        //
        // It used to come from `snapMetrics`, which published `availability` and
        // `availabilityTb` as two bases when they are the same quantity — so the
        // breakdown rows moved with the toggle only by a rounding step while the
        // cards above them moved by thirty points. One query per group rather
        // than one for all of them: every grouping this method offers maps to a
        // scope field the engines already filter on, and a window holds a
        // handful of groups, not thousands.
        const f = factors.get(String(r.key)) ?? null;
        return {
          key: r.key, label: labels.get(r.key) ?? fallback,
          oee: f?.oee ?? 0, availability: f?.availability ?? 0,
          performance: f?.performance ?? 0, quality: f?.quality ?? 0,
          oeeTb: f?.oeeTb ?? 0, availabilityTb: f?.availabilityTb ?? 0,
          output: Math.round(r.good + r.scrap), good: Math.round(r.good),
        };
      })
      .filter((r) => r.output > 0)
      .sort((a, b) => b.output - a.output);
  }

  async oeeGroupedTrend(
    factoryId: string | null,
    from: Date,
    to: Date,
    machineIds: string[] | undefined,
    groupBy: 'machine' | 'workOrder' | 'productionOrder' | 'shift',
    opts: { workOrderId?: string; productionOrderId?: string } = {},
  ) {
    if (this.snapshotsEnabled() && !opts.workOrderId && !opts.productionOrderId) {
      return this.snapshotGrouped(factoryId, from, to, machineIds, groupBy);
    }

    const jos = await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(machineIds ? { machineId: { in: machineIds } } : {}),
        ...(opts.workOrderId ? { workOrderId: opts.workOrderId } : {}),
        ...(opts.productionOrderId ? { workOrder: { productionOrderId: opts.productionOrderId } } : {}),
        ...joOverlapsWindow(from, to),
      },
      select: {
        ...JO_SELECT,
        outputUnit: true,
        plannedQtyOut: true,
        workOrderId: true,
        machine: { select: { name: true, code: true } },
        workOrder: {
          select: {
            orderNumber: true,
            productionOrderId: true,
            sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } },
            productionOrder: { select: { orderNumber: true } },
            shiftInstance: { select: { id: true, shiftDate: true, shiftTemplate: { select: { name: true } } } },
          },
        },
      },
    });

    // This endpoint used to aggregate with neither downtime nor external states, so a
    // grouped view reported a different availability from every other surface for the
    // same machines. Both are loaded here for the same reason PPT is clamped: the rows
    // must be comparable with the cards above them.
    const dtMachineIds = [...new Set((jos as any[]).map((j) => j.machineId).filter(Boolean))] as string[];
    const downtime = dtMachineIds.length
      ? ((await this.prisma.downtimeEvent.findMany({
          where: {
            ...(factoryId ? { factoryId } : {}),
            machineId: { in: dtMachineIds },
            startTime: { lte: to },
            OR: [{ endTime: null }, { endTime: { gte: from } }],
          },
          select: DT_SELECT,
        })) as unknown as DtLite[])
      : [];
    const states = await this.loadExternalStates(factoryId, dtMachineIds, from, to);

    const win = { from: from.getTime(), to: to.getTime() };
    const groups = new Map<string, { label: string; jos: JoLite[] }>();
    for (const jo of jos as any[]) {
      let key: string | null = null;
      let label = '';
      if (groupBy === 'machine') { key = jo.machineId; label = jo.machine?.name ?? jo.machine?.code ?? '—'; }
      else if (groupBy === 'workOrder') { key = jo.workOrderId; label = jo.workOrder?.orderNumber ?? '—'; }
      else if (groupBy === 'productionOrder') { key = jo.workOrder?.productionOrderId ?? '__direct'; label = jo.workOrder?.productionOrder?.orderNumber ?? 'Direct WOs'; }
      else { // shift
        const si = jo.workOrder?.shiftInstance;
        key = si?.id ?? '__noshift';
        label = si ? `${si.shiftTemplate?.name ?? 'Shift'} · ${new Date(si.shiftDate).toISOString().slice(0, 10)}` : 'Unassigned';
      }
      if (!key) continue;
      const g = groups.get(key) ?? { label, jos: [] as JoLite[] };
      g.jos.push(jo as unknown as JoLite);
      groups.set(key, g);
    }

    return [...groups.entries()]
      .map(([key, g]) => {
        const b = this.aggregateJos(g.jos, win, states, downtime);
        // Same shape as the fact-store twin above — a caller must never have to know
        // which read path answered it.
        const tb = this.timeBasedOee(g.jos, downtime, b.performance, b.quality, win);
        return {
          key, label: g.label,
          oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
          oeeTb: tb.oeeTb, availabilityTb: tb.availabilityTb,
          output: Math.round(b.totalCount), good: Math.round(b.goodCount),
        };
      })
      .filter((r) => r.output > 0)
      .sort((a, b) => b.output - a.output);
  }

  /**
   * Time-based availability (OEE-TB): runMin / (runMin + downMin), where runMin is operating
   * time net of unplanned downtime. Reuses the schedule-based Performance & Quality — only
   * Availability differs — exactly as the JO-live dashboard and historian define it.
   */
  /**
   * Time-based OEE (OEE-TB): Availability measured against the clock the equipment
   * actually faced (uptime + downtime) rather than the PLANNED production time.
   *
   * `win` clamps both the operating minutes and the downtime minutes to the analysis
   * window. It is optional only for callers that genuinely mean the JO's whole life;
   * every windowed KPI must pass it, or OEE-TB silently reports a different period
   * than the schedule-based OEE sitting next to it.
   */
  private timeBasedOee(
    jos: JoLite[], downtime: DtLite[], performance: number, quality: number,
    win?: { from: number; to: number },
  ) {
    let operating = 0;
    let down = 0;
    for (const jo of jos) {
      operating += jo.actualStart
        ? (win
            ? this.overlapMin(jo.actualStart, jo.actualEnd ?? new Date(), new Date(win.from), new Date(win.to))
            : this.spanMin(jo.actualStart, jo.actualEnd))
        : 0;
      down += this.joUnplanned(jo, downtime, win);
    }
    const net = Math.max(0, operating - down);
    const availabilityTb = operating > 0 ? Math.min(100, (net / operating) * 100) : 0;
    const oeeTb = oeeIdentityOf(availabilityTb, performance, quality);
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return { availabilityTb: r1(availabilityTb), oeeTb: r1(oeeTb), downtimeMin: r1(down) };
  }

  /**
   * The OEE records list — one row per job order, from the one store.
   *
   * ── What this used to be, and what it cost ──────────────────────────────────
   * This built each row by re-deriving OEE from `job_orders` plus
   * `downtime_events`, while the cards ABOVE the same table read the unified
   * minute store. Two sources for one screen, and they did not agree:
   *
   *     machine              store   this list
   *     Euro-Pack Robot      35.3    22.0 / 41.1
   *     Carton Packer             45.6    39.5 / 44.3
   *     Powder Filler            30.4    27.1 / 29.0
   *     Uni-tech Wrapping    27.3    23.3 / 25.8
   *
   * The list was not wrong by a rounding step; it was answering a different
   * question with the same caption. Availability from stop events reads the
   * events somebody logged, availability from minutes reads the time that
   * actually elapsed, and on a line with unlogged stops those diverge by ten
   * points and more.
   *
   * ── What it is now ──────────────────────────────────────────────────────────
   * A projection of the two engines' own `byJobOrder`, which is the same grain
   * this list has always shown. No SQL of its own: a fourth copy of the
   * aggregation is how the disagreement above happened in the first place.
   *
   *   availability / oee      the SCHEDULE basis (the committed slot)
   *   availabilityTb / oeeTb  the STANDARD basis (elapsed less excused stops)
   *
   * which is the same pairing the analysis pages and the live screen use, so
   * the toggle means one thing everywhere.
   */
  async oeeRecordsFromJobOrders(
    factoryId: string | null,
    from: Date,
    to: Date,
    machineIds: string[] | undefined,
    limit = 200,
  ) {
    // Metadata the engines do not carry: which machine, when it ran, and what it
    // was supposed to make. Also the machine filter — the engines take a single
    // machineId, and callers here pass a resolved SET.
    const jos = await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(machineIds ? { machineId: { in: machineIds } } : {}),
        ...joOverlapsWindow(from, to),
      },
      select: {
        id: true, machineId: true, actualStart: true, actualEnd: true,
        plannedQtyOut: true, outputUnit: true,
        machine: { select: { name: true, code: true } },
        workOrder: { select: { sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } } } },
      },
      orderBy: { actualStart: 'desc' },
      take: limit,
    });
    if (jos.length === 0) return [];

    // The committed slot may run past the window for an order still in flight;
    // the engine clips it, and `to` is the right clip for a closed window.
    const [std, sched] = await Promise.all([
      this.oeeStandard.byJobOrder(factoryId, from, to, {}),
      this.oeeSchedule.byJobOrder(factoryId, from, to, to, {}),
    ]);
    const stdBy = new Map(std.map((r) => [r.key, r]));
    const schedBy = new Map(sched.map((r) => [r.key, r]));

    const r1 = (n: number | null | undefined) => (n == null ? null : Math.round(n * 10) / 10);

    return jos.map((jo) => {
      const a = stdBy.get(jo.id);
      const b = schedBy.get(jo.id);
      // Counts are a property of the job order, not of the basis, so either
      // engine answers — the standard one is present whenever minutes were
      // written at all.
      const c = a?.counts ?? b?.counts ?? { good: 0, rejected: 0, total: 0, theoretical: 0 };

      const sku = jo.workOrder?.sku ?? null;
      const plannedRaw = jo.plannedQtyOut ?? 0;
      const plannedOutput = sku && jo.outputUnit ? toPieces(plannedRaw, jo.outputUnit, sku as never) : plannedRaw;

      return {
        id: jo.id,
        machineId: jo.machineId,
        machine: jo.machine ?? null,
        recordDate: jo.actualStart ?? jo.actualEnd ?? new Date(),
        // The committed slot — what the plan asked for.
        oee: r1(b?.oee), availability: r1(b?.availability),
        // Shared between the bases: neither the parts made nor the minutes spent
        // running depend on which denominator the time is measured against.
        performance: r1(a?.performance ?? b?.performance),
        quality: r1(a?.quality ?? b?.quality),
        // Elapsed time less the stops nobody is charged for.
        oeeTb: r1(a?.oee), availabilityTb: r1(a?.availability),
        plannedOutput,
        totalOutput: c.total,
        goodOutput: c.good,
        scrapOutput: c.rejected,
      };
    });
  }

  /**
   * Weighted OEE rolled up the asset hierarchy + six-loss + Pareto by reason code,
   * over [dateFrom, dateTo] (defaults to the last 7 days). Powers the OEE Analytics tree.
   */
  async hierarchyOEE(
    factoryId: string | null,
    dateFrom?: string,
    dateTo?: string,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ) {
    // Local calendar dates (no `Z`) and an upper bound clamped to NOW — the same
    // terms as every other endpoint. Parsing as UTC put a three-hour offset between
    // this tree and the cards above it in Riyadh, and an end-of-day bound charged
    // planned time for hours that had not happened.
    const now = new Date();
      // Parsed by the shared helper: a bare date keeps its day edge, anything
      // longer is the instant it names. Appending the suffix unconditionally
      // made any sub-day window an Invalid Date and a 500.
    const rawTo = plantBound(dateTo, 'end') ?? now;
    const to = rawTo > now ? now : rawTo;
    // The unclamped end is the committed slot's end. It was computed here and
    // discarded, so the tree's schedule figure was built on a guessed slot and
    // read 6.0% / A 17.1% beside cards reading 28.3% / 80.9%.
    const hierSlotTo = rawTo;
    const from = plantBound(dateFrom, 'start') ?? new Date(to.getTime() - 7 * 86_400_000);
    const factoryFilter = factoryId ? { factoryId } : {};

    // Resolve the scope (area/line/machine) to the set of machines it covers.
    const machines = await this.prisma.machine.findMany({
      where: {
        ...factoryFilter,
        // Same filter as everywhere else. Without it a deleted machine stayed in the
        // OEE-by-hierarchy tree — reporting 0% A/P/Q forever — while disappearing
        // from every other page, which is what made the tree look wrong rather than
        // the machine look deleted.
        isActive: true,
        archivedAt: null,
        ...(scope?.machineId ? { id: scope.machineId } : {}),
        ...(scope?.lineId ? { lineId: scope.lineId } : {}),
        ...(scope?.areaId ? { line: { areaId: scope.areaId } } : {}),
      },
      select: {
        id: true, name: true, code: true, lineId: true,
        line: {
          select: {
            id: true, name: true, code: true, areaId: true,
            // The line's configured OEE basis travels with it, so the tree renders
            // each line by the method that line is actually measured on.
            oeeMethod: true, bottleneckMachineId: true, outfeedMachineIds: true,
            area: { select: { id: true, name: true, code: true } },
          },
        },
      },
    });
    const machineIds = machines.map((m) => m.id);

    // Per-machine OEE is sourced from JOB ORDERS (a WO spans many machines via its
    // routed steps), so every machine that ran a step gets real OEE — not just the
    // WO's header machine. Matches the per-JO OEE shown on the job-orders page.
    const [jobOrders, downtime] = await Promise.all([
      this.prisma.jobOrder.findMany({
        where: {
          ...factoryFilter,
          machineId: { in: machineIds },
          ...joOverlapsWindow(from, to),
        },
        select: JO_SELECT_ANALYTICS,
      }),
      this.prisma.downtimeEvent.findMany({
        // Overlap, not containment — an outage that began before the window is still
        // an outage during it. Selects the full shape because these rows now feed
        // BOTH the reason-code Pareto and the time-based availability (OEE-TB).
        where: {
          ...factoryFilter, isPlanned: false, affectsOEE: true,
          machineId: { in: machineIds },
          startTime: { lte: to },
          OR: [{ endTime: null }, { endTime: { gte: from } }],
        },
        select: { ...DT_SELECT, reasonCode: true },
      }),
    ]);

    // Bucket JOs by machine. Output/good/scrap roll up via final-step counts
    // (finalStepCounts) so a routed WO is never multi-counted up the hierarchy;
    // per-machine nodes still reflect each machine's own throughput.
    const hierWin = { from: from.getTime(), to: to.getTime() };
    const byMachine = new Map<string, JoLite[]>();
    for (const jo of jobOrders as JoLite[]) {
      if (!jo.machineId) continue;
      const arr = byMachine.get(jo.machineId) ?? [];
      arr.push(jo);
      byMachine.set(jo.machineId, arr);
    }
    const allJos: JoLite[] = [...byMachine.values()].flat();
    // STARVED/BLOCKED segments for every machine in the tree — so a downstream asset
    // waiting on the bottleneck is not shown with a false low OEE.
    const hierStates = await this.loadExternalStates(factoryId, [...byMachine.keys()], from, to);

    // Build Area → Line → Machine tree (only branches that have machines with data or exist)
    type LineBucket = {
      id: string; name: string; code: string | null; machines: typeof machines;
      cfg: { oeeMethod: string; bottleneckMachineId: string | null; outfeedMachineIds: string[] };
    };
    type Bucket = { id: string; name: string; code: string | null; lines: Map<string, LineBucket> };
    const areas = new Map<string, Bucket>();
    const UNASSIGNED = { id: '__unassigned__', name: 'Unassigned', code: null as string | null };

    for (const m of machines) {
      const area = m.line?.area ?? UNASSIGNED;
      const lineId = m.line?.id ?? '__noline__';
      const lineName = m.line?.name ?? 'Unassigned line';
      const lineCode = m.line?.code ?? null;
      if (!areas.has(area.id)) areas.set(area.id, { id: area.id, name: area.name, code: (area as any).code ?? null, lines: new Map() });
      const ab = areas.get(area.id)!;
      if (!ab.lines.has(lineId)) {
        ab.lines.set(lineId, {
          id: lineId, name: lineName, code: lineCode, machines: [],
          cfg: {
            oeeMethod: m.line?.oeeMethod ?? 'ROLLUP',
            bottleneckMachineId: m.line?.bottleneckMachineId ?? null,
            outfeedMachineIds: m.line?.outfeedMachineIds ?? [],
          },
        });
      }
      ab.lines.get(lineId)!.machines.push(m);
    }

    // Routing rates for every machine in the tree — the fallback source for a line
    // set to BOTTLENECK with no constraint nominated. Fetched once, not per line.
    const anyBottleneck = [...areas.values()].some((a) =>
      [...a.lines.values()].some((l) => l.cfg.oeeMethod === 'BOTTLENECK'));
    // Needed by BOTH read paths (live JO rollup and fact store) to infer a constraint
    // when none is nominated. Fetched once for the whole tree.
    const hierRated = anyBottleneck
      ? await this.scheduleKpi.ratedCapacityByMachine(factoryId, machineIds)
      : undefined;

    const josOf = (ms: typeof machines): JoLite[] => ms.flatMap(m => byMachine.get(m.id) ?? []);
    const useSnap = this.snapshotsEnabled();

    // A node's metrics come from the fact store (snapshotScope, scope = its machine ids)
    // when SNAPSHOTS_READ is on, else from the live JO rollup. Shape is identical.
    const snapNode = async (id: string, name: string, code: string | null, type: string, ms: typeof machines, childNodes?: unknown[]) => {
      const b = await this.snapshotScope(factoryId, from, to, ms.map((x) => x.id), hierSlotTo);
      return { id, name, code, type, oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality, oeeTb: b.oeeTb, availabilityTb: b.availabilityTb, output: b.totalCount, good: b.goodCount, losses: b.losses, children: childNodes ?? [] };
    };

    /**
     * A LINE node read from the fact store. The configured basis must apply here
     * too — otherwise turning SNAPSHOTS_READ on would silently change every line's
     * OEE, which is precisely the "same KPI, different value" failure this work
     * exists to remove.
     *
     * For BOTTLENECK the fact store is queried twice with different scopes: A and P
     * from the constraint machine alone, Q from the outfeed machines alone.
     */
    const snapLineNode = async (ln: LineBucket, machineNodes: unknown[]) => {
      const all = ln.machines.map((m) => m.id);

      if (ln.cfg.oeeMethod !== 'BOTTLENECK') {
        const b = await this.snapshotScope(factoryId, from, to, all, hierSlotTo);
        return {
          id: ln.id, name: ln.name, code: ln.code, type: 'LINE',
          oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
          // Time-based twin so the schedule-vs-time-based toggle reaches the tree.
          oeeTb: b.oeeTb, availabilityTb: b.availabilityTb,
          output: b.totalCount, good: b.goodCount,
          externalLossMin: b.losses.externalLossMin, losses: b.losses,
          oeeMethod: 'ROLLUP' as const,
          oeeBasis: {
            method: 'ROLLUP' as const,
            formula: 'Line OEE = A × P × Q re-derived from the summed minutes and counts of every machine',
            machineCount: ln.machines.length,
            source: 'FACT_STORE' as const,
          },
          children: machineNodes,
        };
      }

      const slowest = hierRated
        ? [...hierRated.values()].filter((r) => all.includes(r.machineId))
            .sort((a, b) => a.unitsPerHour - b.unitsPerHour)[0] ?? null
        : null;
      const bottleneck =
        ln.machines.find((m) => m.id === ln.cfg.bottleneckMachineId) ??
        (slowest ? ln.machines.find((m) => m.id === slowest.machineId) ?? null : null);

      if (!bottleneck) {
        const b = await this.snapshotScope(factoryId, from, to, all, hierSlotTo);
        return {
          id: ln.id, name: ln.name, code: ln.code, type: 'LINE',
          oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
          // Time-based twin so the schedule-vs-time-based toggle reaches the tree.
          oeeTb: b.oeeTb, availabilityTb: b.availabilityTb,
          output: b.totalCount, good: b.goodCount,
          externalLossMin: b.losses.externalLossMin, losses: b.losses,
          oeeMethod: 'ROLLUP' as const,
          oeeBasis: {
            method: 'ROLLUP' as const,
            formula: 'Line OEE = A × P × Q re-derived from the summed minutes and counts of every machine',
            machineCount: ln.machines.length,
            source: 'FACT_STORE' as const,
            fallbackFrom: 'BOTTLENECK' as const,
            fallbackReason: 'No bottleneck configured and no routing cycle time to infer one.',
          },
          children: machineNodes,
        };
      }

      const configured = ln.machines.filter((m) => ln.cfg.outfeedMachineIds.includes(m.id));
      const outfeeds = configured.length > 0 ? configured : ln.machines;

      const [bn, out] = await Promise.all([
        this.snapshotScope(factoryId, from, to, [bottleneck.id], hierSlotTo),
        this.snapshotScope(factoryId, from, to, outfeeds.map((m) => m.id), hierSlotTo),
      ]);

      const r = this.oee.lineOee({
        bottleneck: {
          availability: bn.availability, performance: bn.performance,
          machineId: bottleneck.id, machineName: bottleneck.name,
        },
        finalOutfeed: {
          totalCount: out.totalCount, goodCount: out.goodCount,
          pointName: outfeeds.map((m) => m.name).join(' + '),
        },
      });

      // Time-based twin, composed on the SAME basis: availability from the
      // constraint machine alone (its time-based figure), performance from the
      // constraint, quality from the outfeed. Taking A-TB from the whole line
      // would answer a different question than the number beside it.
      const lineAvailabilityTb = bn.availabilityTb;
      const lineOeeTb =
        oeeIdentityOf(lineAvailabilityTb, r.performance, r.quality);

      return {
        id: ln.id, name: ln.name, code: ln.code, type: 'LINE',
        oee: r.oee, availability: r.availability, performance: r.performance, quality: r.quality,
        oeeTb: Math.round(lineOeeTb * 10) / 10, availabilityTb: lineAvailabilityTb,
        output: out.totalCount, good: out.goodCount,
        externalLossMin: bn.losses.externalLossMin, losses: bn.losses,
        oeeMethod: 'BOTTLENECK' as const,
        oeeBasis: {
          ...r.basis,
          bottleneckResolvedBy: ln.cfg.bottleneckMachineId
            ? ('CONFIGURED' as const)
            : ('SLOWEST_ROUTING_CYCLE_TIME' as const),
          outfeedResolvedBy: configured.length > 0
            ? ('CONFIGURED' as const)
            : ('ALL_MACHINES_ON_LINE' as const),
          outfeedMachineNames: outfeeds.map((m) => m.name),
          source: 'FACT_STORE' as const,
          formula: 'Line OEE = Bottleneck Availability × Bottleneck Performance × Final Outfeed Quality',
        },
        children: machineNodes,
      };
    };

    const tree = await Promise.all([...areas.values()].map(async ab => {
      const lineNodes = await Promise.all([...ab.lines.values()].map(async ln => {
        const machineNodes = useSnap
          ? await Promise.all(ln.machines.map(m => snapNode(m.id, m.name, m.code, 'MACHINE', [m])))
          : ln.machines.map(m => this.nodeFromJos(m.id, m.name, m.code, 'MACHINE', byMachine.get(m.id) ?? [], hierWin, undefined, hierStates, downtime as unknown as DtLite[]));
        if (useSnap) return snapLineNode(ln, machineNodes);

        // The LINE node is measured by the basis configured ON that line, so the
        // tree, the OEE cards and the line endpoint can never disagree.
        const b = this.lineOeeFromJos(
          ln.cfg, ln.machines, josOf(ln.machines), hierWin, hierStates, hierRated,
          downtime as unknown as DtLite[],
        );
        // Same basis for the time-based twin: under BOTTLENECK the availability is
        // the constraint machine's, so its time-based availability must be too.
        const lineTbJos = b.method === 'BOTTLENECK' && b.bottleneckId
          ? (byMachine.get(b.bottleneckId) ?? [])
          : josOf(ln.machines);
        const lineTb = this.timeBasedOee(
          lineTbJos, downtime as unknown as DtLite[], b.performance, b.quality, hierWin,
        );
        return {
          id: ln.id, name: ln.name, code: ln.code, type: 'LINE',
          oee: b.oee, availability: b.availability, performance: b.performance, quality: b.quality,
          oeeTb: lineTb.oeeTb, availabilityTb: lineTb.availabilityTb,
          output: b.output, good: b.good,
          externalLossMin: b.losses.externalLossMin,
          losses: b.losses,
          // Carried so the UI can label which basis produced this number.
          oeeMethod: b.method,
          oeeBasis: b.basis,
          children: machineNodes,
        };
      }));
      const areaMachines = [...ab.lines.values()].flatMap(l => l.machines);
      return useSnap
        ? snapNode(ab.id, ab.name, ab.code, 'AREA', areaMachines, lineNodes)
        : this.nodeFromJos(ab.id, ab.name, ab.code, 'AREA', josOf(areaMachines), hierWin, lineNodes, hierStates, downtime as unknown as DtLite[]);
    }));
    tree.sort((a, b) => b.oee - a.oee);

    // Kept as a separate binding so the fact-store branch stays TYPED as carrying the
    // time-based pair. Collapsing both branches into one variable erases that and
    // forces a cast, which is how a missing field becomes a silent zero.
    const plantSnap = useSnap ? await this.snapshotScope(factoryId, from, to, machineIds, hierSlotTo) : null;
    const plant = plantSnap ?? this.aggregateJos(allJos, hierWin, hierStates, downtime as unknown as DtLite[]);
    // The fact store already carries the time-based pair; the live rollup derives it.
    // Either way the plant headline honours the toggle exactly like the tree does.
    const plantTb = plantSnap
      ? { oeeTb: plantSnap.oeeTb, availabilityTb: plantSnap.availabilityTb }
      : this.timeBasedOee(allJos, downtime as unknown as DtLite[], plant.performance, plant.quality, hierWin);

    // Pareto by reason code
    const paretoMap = new Map<string, { reasonCode: string; minutes: number; events: number }>();
    for (const d of downtime) {
      const k = d.reasonCode;
      const e = paretoMap.get(k) ?? { reasonCode: k, minutes: 0, events: 0 };
      e.minutes += d.durationMinutes ?? 0;
      e.events += 1;
      paretoMap.set(k, e);
    }
    const pareto = [...paretoMap.values()].sort((a, b) => b.minutes - a.minutes)
      .map(p => ({ ...p, minutes: Math.round(p.minutes * 10) / 10 }));

    return {
      range: { from: from.toISOString(), to: to.toISOString() },
      plant: {
        oee: plant.oee, availability: plant.availability, performance: plant.performance, quality: plant.quality,
        oeeTb: plantTb.oeeTb, availabilityTb: plantTb.availabilityTb,
        output: plant.totalCount, good: plant.goodCount, losses: plant.losses,
      },
      pareto,
      tree,
    };
  }

  /** Entry point from JO mutations — recompute the parent WO (and PO) and broadcast. */
  async propagateFromJobOrder(jobOrderId: string): Promise<void> {
    try {
      const jo = await this.prisma.jobOrder.findUnique({ where: { id: jobOrderId }, select: { workOrderId: true } });
      if (jo?.workOrderId) await this.recomputeWorkOrderAndPO(jo.workOrderId);
    } catch (e) {
      this.logger.error(`propagateFromJobOrder(${jobOrderId}) failed`, e as Error);
    }
  }
}
