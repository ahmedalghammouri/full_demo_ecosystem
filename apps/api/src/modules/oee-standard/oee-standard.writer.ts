import { Injectable, Logger } from '@nestjs/common';

/**
 * A minute holding more parts than the machine could have made.
 *
 * ── Why this needs no judgement ─────────────────────────────────────────────
 * A machine cannot beat its own mechanical cycle. A minute over that ceiling is
 * not a fast minute — it is PROOF the count is wrong, and the design speed is
 * already in the row, so nothing has to be inferred.
 *
 * The ceiling is scaled to the time the machine was ACTUALLY operating, not to
 * a whole minute: half a minute of running can only make half a minute's worth,
 * and holding it to the full figure would miss the clearest cases of all.
 *
 * A tenth over is arithmetic at the minute boundary — a pulse landing either
 * side of the second. Half again over is not, and on 25 Aug 2026 sixty such
 * minutes were written for M1 alone at an average of 68.8 against a ceiling of
 * 45, with nothing anywhere saying a word.
 *
 * Returns null when there is nothing to report, including when the machine was
 * not operating or has no design speed — a ceiling needs a number the plant
 * stated, and inventing one would produce alarms out of silence.
 */
export function impossibleMinute(
  counted: number, operatingMin: number, designSpeedPph: number | null,
): { counted: number; ceiling: number } | null {
  if (!designSpeedPph || designSpeedPph <= 0 || operatingMin <= 0) return null;
  const ceiling = (designSpeedPph / 60) * operatingMin;
  if (counted <= ceiling * 1.1) return null;
  return { counted, ceiling };
}
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { toPieces, type SkuPackaging } from '../../common/units.util';
import { committedSlot } from '../oee-schedule/oee-schedule.calc';
import { resolveShiftAt, type ShiftTemplateWindow, type ResolvedShift } from '../../common/shift-window.util';
import { designSpeedPph } from './oee-standard.calc';
import {
  classifyMinute, merge, FALLBACK_VERDICTS, UNKNOWN_VERDICT,
  type Span, type Verdict,
} from './minute-classification';
import {
  stopWindowsForShift, plannedStopMinutes,
  type StopDefinition, type MachinePlace,
} from './planned-stop-window.util';

const MIN = 60_000;

/**
 * Writes `oee_minutes` — one row per machine-minute, against the Insights Hub
 * time model.
 *
 * ── Why a second writer rather than a change to the first ───────────────────
 * The two answer to different references. This one implements a published model
 * a plant can look up; the other grew from this plant's own history of defects.
 * Running them side by side is the only way to tell a disagreement between
 * engines from a disagreement with reality — and the ability to check is the
 * whole reason the plant asked for it.
 *
 * ── The classification, in strict precedence ────────────────────────────────
 *   1. SCHEDULED PLANNED STOP  a break somebody put on the calendar. Wins over
 *                              everything, including a machine that kept running
 *                              through it: the time was not ours to produce in.
 *   2. STATE RULE              whatever the plant configured this state to mean.
 *   3. UNOBSERVED              no state record at all → unmeasured, out of both
 *                              sides. Silence is not evidence of a stop.
 *
 * Because each layer is SUBTRACTED from what the layer above did not claim, the
 * five buckets sum to total time by construction. `auditTotals` checks it anyway
 * — the failure it catches is silent, and a silent loss of minutes inflates
 * availability rather than raising an error.
 */
@Injectable()
export class OeeStandardWriter {
  private readonly logger = new Logger(OeeStandardWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    try {
      await this.captureMinute(new Date());
    } catch (err) {
      this.logger.error('OEE minute capture failed', err as Error);
    }
  }

  /** Rules resolved per machine+state, cached briefly so a poll is not a query storm. */
  private ruleCache = new Map<string, { at: number; v: Verdict }>();
  private static readonly RULE_TTL_MS = 30_000;

  private async verdictFor(factoryId: string, machineId: string, state: string): Promise<Verdict> {
    const key = `${machineId}:${state}`;
    const hit = this.ruleCache.get(key);
    if (hit && Date.now() - hit.at < OeeStandardWriter.RULE_TTL_MS) return hit.v;

    let v = FALLBACK_VERDICTS[state] ?? UNKNOWN_VERDICT;
    try {
      const rows = await this.prisma.machineStateRule.findMany({
        where: { factoryId, state, isActive: true, OR: [{ machineId }, { machineId: null }] },
        select: { machineId: true, isDowntime: true, isPlanned: true, affectsOEE: true },
      });
      // Most specific first: a rule for THIS machine beats the factory rule.
      const chosen = rows.find((r) => r.machineId === machineId) ?? rows.find((r) => r.machineId === null);
      if (chosen) {
        v = { isDowntime: chosen.isDowntime, isPlanned: chosen.isPlanned, affectsOEE: chosen.affectsOEE };
      }
    } catch (err) {
      // A configuration read must never stop a minute being recorded.
      this.logger.warn(`state-rule lookup failed for ${state}: ${(err as Error).message}`);
    }
    this.ruleCache.set(key, { at: Date.now(), v });
    return v;
  }

  /**
   * Capture the minute that has just CLOSED.
   *
   * The cron fires at second :00, when the current minute has barely begun.
   * Capturing it would record a full minute of total time against a couple of
   * milliseconds of operating time and collapse availability to nothing — the
   * same trap the first engine fell into, avoided here by never looking at a
   * minute that is still running.
   */
  async captureMinute(at = new Date()): Promise<number> {
    const bucketStart = new Date(Math.floor(at.getTime() / MIN) * MIN - MIN);
    const bucketEnd = new Date(bucketStart.getTime() + MIN);

    await this.prisma.oeeMinute.updateMany({
      where: { isFinalized: false, bucketStart: { lt: bucketStart } },
      data: { isFinalized: true },
    });

    // ── Scenario handling starts here ───────────────────────────────────────
    // EXECUTING and PAUSED both occupy the clock; a paused order still holds the
    // machine, and pretending otherwise would make the pause vanish from the
    // denominator instead of being charged as the deliberate stop it is.
    // COMPLETED orders stop accruing at actualEnd, which the clip below enforces
    // without needing a separate branch.
    const jos = await this.prisma.jobOrder.findMany({
      where: {
        status: { in: ['EXECUTING', 'PAUSED'] },
        machineId: { not: null },
        actualStart: { not: null, lte: bucketEnd },
      },
      select: {
        id: true, factoryId: true, machineId: true, workOrderId: true, status: true,
        idealCycleTimeSec: true, outputUnit: true,
        actualStart: true, actualEnd: true, plannedEnd: true,
        actualQtyGood: true, actualQtyRejected: true,
        // `downtimeThreshold` is the plant's own microstop boundary, set on the
        // hierarchy screen and, until now, read by nothing.
        machine: { select: { lineId: true, downtimeThreshold: true } },
        workOrder: {
          select: {
            sku: { select: { baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } },
          },
        },
      },
    });
    if (jos.length === 0) return 0;

    const machineIds = [...new Set(jos.map((j) => j.machineId!))];
    const joIds = jos.map((j) => j.id);
    const factoryIds = [...new Set(jos.map((j) => j.factoryId))];

    // What each machine reported it was doing, overlapping this bucket.
    const states = await this.prisma.machineStateRecord.findMany({
      where: {
        machineId: { in: machineIds },
        startTime: { lt: bucketEnd },
        OR: [{ endTime: null }, { endTime: { gt: bucketStart } }],
      },
      select: { machineId: true, state: true, startTime: true, endTime: true },
    });

    // Counts already booked in closed minutes → this minute's delta.
    const priorRows = await this.prisma.oeeMinute.groupBy({
      by: ['jobOrderId'],
      where: { jobOrderId: { in: joIds }, isFinalized: true },
      _sum: { goodParts: true, rejectedParts: true },
    });
    const prior = new Map(
      priorRows.map((r) => [r.jobOrderId, { good: r._sum.goodParts ?? 0, rejected: r._sum.rejectedParts ?? 0 }]),
    );

    // Shift and planned-stop definitions, per factory.
    const shiftByFactory = new Map<string, ResolvedShift | null>();
    const stopsByFactory = new Map<string, StopDefinition[]>();
    for (const fid of factoryIds) {
      const templates = (await this.prisma.shiftTemplate.findMany({
        where: { factoryId: fid, isActive: true },
        orderBy: { startTime: 'asc' },
        select: { id: true, code: true, name: true, startTime: true, endTime: true, crossesMidnight: true },
      })) as ShiftTemplateWindow[];
      shiftByFactory.set(fid, resolveShiftAt(bucketStart, templates));

      const defs = await this.prisma.plannedStopTemplate.findMany({
        where: { factoryId: fid, isActive: true },
        select: {
          id: true, code: true, name: true, durationMinutes: true, scope: true,
          shiftTemplateId: true, startOffsetMin: true, startTimeLocal: true, isActive: true,
          targets: { select: { machineId: true, lineId: true } },
        },
      });
      stopsByFactory.set(fid, defs as unknown as StopDefinition[]);
    }

    let written = 0;
    for (const jo of jos) {
      const row = await this.buildRow(
        jo, bucketStart, bucketEnd, at, states, prior,
        shiftByFactory.get(jo.factoryId) ?? null,
        stopsByFactory.get(jo.factoryId) ?? [],
      );
      if (!row) continue;
      try {
        await this.prisma.oeeMinute.upsert({
          where: { ux_oee_minute_jo_bucket: { jobOrderId: jo.id, bucketStart } },
          create: row,
          update: row,
        });
        written++;
      } catch (e) {
        this.logger.warn(`oee minute upsert failed for JO ${jo.id}: ${(e as Error).message}`);
      }
    }
    return written;
  }

  private async buildRow(
    jo: any,
    bucketStart: Date,
    bucketEnd: Date,
    at: Date,
    states: Array<{ machineId: string; state: string; startTime: Date; endTime: Date | null }>,
    prior: Map<string, { good: number; rejected: number }>,
    shift: ResolvedShift | null,
    stopDefs: StopDefinition[],
  ) {
    // ── Total time: the job order's occupancy of this minute ─────────────────
    // Clipped at BOTH ends. actualEnd closes a finished order; `at` stops an open
    // one from claiming a future it has not lived yet.
    //
    // Note what is deliberately NOT here: plannedEnd. An order that overruns its
    // schedule keeps accruing total time, because the schedule was a plan and OEE
    // measures what happened. Capping total time at plannedEnd would make the
    // overrun free — the machine would run past its slot and the loss would
    // simply not appear anywhere.
    const joStart = new Date(jo.actualStart).getTime();
    const joEnd = jo.actualEnd ? new Date(jo.actualEnd).getTime() : at.getTime();
    const winFrom = Math.max(bucketStart.getTime(), joStart);
    const winTo = Math.min(bucketEnd.getTime(), joEnd, at.getTime());
    const totalMin = Math.max(0, (winTo - winFrom) / MIN);
    if (totalMin <= 0) return null;

    // ── Layer 1: scheduled planned stops ────────────────────────────────────
    const place: MachinePlace = { machineId: jo.machineId, lineId: jo.machine?.lineId ?? null };
    const windows = shift ? stopWindowsForShift(stopDefs, shift, place) : [];
    const scheduledSpans: Span[] = merge(
      windows
        .map((w) => [Math.max(w.start.getTime(), winFrom), Math.min(w.end.getTime(), winTo)] as Span)
        .filter(([s, e]) => e > s),
    );

    // ── Layer 2: what the machine said, classified by State Rules ───────────
    // Shared with the schedule engine. The two differ in where Total time
    // begins and ends and in nothing else, so this runs once for both.
    const mine = states.filter((st) => st.machineId === jo.machineId);
    const {
      plannedStopMin, operatingMin, externalLossMin, availabilityLossMin, unmeasuredMin,
      microStopMin,
      dominantState: dominant,
    } = await classifyMinute({
      winFrom, winTo, openEnd: at.getTime(),
      states: mine,
      scheduledStops: scheduledSpans,
      paused: jo.status === 'PAUSED',
      verdictFor: (state) => this.verdictFor(jo.factoryId, jo.machineId, state),
      microStopSec: jo.machine?.downtimeThreshold ?? undefined,
    });

    // ── Counts: the delta this minute, in pieces ────────────────────────────
    const sku: SkuPackaging | null = jo.workOrder?.sku ?? null;
    const unit: string | undefined = jo.outputUnit ?? undefined;
    const toBase = (q: number) => (sku && unit ? toPieces(q, unit, sku) : q);

    const p = prior.get(jo.id) ?? { good: 0, rejected: 0 };
    const goodParts = Math.max(0, toBase(jo.actualQtyGood ?? 0) - p.good);
    const rejectedParts = Math.max(0, toBase(jo.actualQtyRejected ?? 0) - p.rejected);

    // Design speed in PIECES per hour, so a theoretical output and an actual count
    // are the same kind of thing. The cycle time is per OUTPUT unit, so it is
    // converted on the same ladder the counts are.
    const perOutputUnit = toBase(1) || 1;
    const speedOut = designSpeedPph(jo.idealCycleTimeSec);
    const designSpeed = speedOut != null ? speedOut * perOutputUnit : null;
    const theoreticalParts = designSpeed != null ? (operatingMin / 60) * designSpeed : 0;

    // ── The committed slot ────────────────────────────────────────────────
    // Carried on the same row rather than in a table of its own. It is not a
    // measurement — it is read straight off the job order's dates — so a second
    // store holding it alongside a duplicate of every measured column was two
    // copies of one minute, and the pair could only ever drift apart.
    //
    // NULL when the order has no slot to speak of. The schedule read excludes
    // those rows, which is exactly what the separate writer did by returning
    // early on them.
    const slot = committedSlot(
      {
        plannedStart: jo.plannedStart ?? null,
        plannedEnd: jo.plannedEnd ?? null,
        actualStart: jo.actualStart ?? null,
        actualEnd: jo.actualEnd ?? null,
      },
      at,
    );

    const row = {
      bucketStart,
      isFinalized: false,
      factoryId: jo.factoryId,
      machineId: jo.machineId,
      jobOrderId: jo.id,
      workOrderId: jo.workOrderId ?? null,
      shiftTemplateId: shift?.templateId ?? null,
      shiftCode: shift?.code ?? null,
      machineState: dominant,
      jobOrderStatus: jo.status,
      committedFrom: slot?.from ?? null,
      committedTo: slot?.to ?? null,
      totalMin, plannedStopMin, availabilityLossMin, externalLossMin, unmeasuredMin, operatingMin,
      microStopMin,
      goodParts, rejectedParts, theoreticalParts,
      designSpeedPph: designSpeed,
    };

    // ── The impossible minute ───────────────────────────────────────────────
    // A machine cannot beat its own mechanical cycle. A minute holding more
    // parts than the cycle allows is not a fast minute — it is PROOF that the
    // count is wrong, and it needs no judgement to detect: the design speed is
    // already in this row.
    //
    // On 25 Aug 2026 sixty such minutes were written for M1 alone — an average
    // of 68.8 against a ceiling of 45 — and nothing anywhere said a word. The
    // plant found it by eye, days later.
    //
    // A warning, not a rejection: the measurement is kept exactly as taken. The
    // engine's job is to say that it cannot be true, not to decide what was.
    this.flagImpossibleMinute(row, jo.machineId);
    return row;
  }

  /**
   * Say so when a minute holds more than the machine could have made.
   *
   * Throttled per machine, because a miscounting sensor produces one of these
   * every minute and an unthrottled log would bury the fault it is reporting.
   */
  private readonly impossibleAt = new Map<string, number>();

  private flagImpossibleMinute(
    row: { goodParts: number; rejectedParts: number; operatingMin: number; designSpeedPph: number | null },
    machineId: string,
  ): void {
    const verdict = impossibleMinute(
      row.goodParts + row.rejectedParts, row.operatingMin, row.designSpeedPph,
    );
    if (!verdict) return;

    // Throttled per machine: a miscounting sensor produces one of these every
    // minute, and an unthrottled log buries the fault it is reporting.
    const now = Date.now();
    if (now - (this.impossibleAt.get(machineId) ?? 0) < 10 * 60_000) return;
    this.impossibleAt.set(machineId, now);
    this.logger.warn(
      `machine ${machineId}: minute counted ${verdict.counted} parts against a ceiling of `
      + `${verdict.ceiling.toFixed(1)} (design ${row.designSpeedPph}/h over `
      + `${row.operatingMin.toFixed(2)} operating min) `
      + '— the machine cannot beat its own cycle, so this count is wrong. '
      + 'Check the counter for contact ring before reading any OEE figure from it.',
    );
  }

}
