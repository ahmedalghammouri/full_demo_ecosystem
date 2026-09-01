import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { toPieces, type SkuPackaging } from '../../common/units.util';
import { resolveShiftAt, type ShiftTemplateWindow, type ResolvedShift } from '../../common/shift-window.util';
import { designSpeedPph } from '../oee-standard/oee-standard.calc';
import { committedSlot } from './oee-schedule.calc';
import {
  classifyMinute, merge, FALLBACK_VERDICTS, UNKNOWN_VERDICT,
  type Span, type Verdict,
} from '../oee-standard/minute-classification';
import {
  stopWindowsForShift,
  type StopDefinition, type MachinePlace,
} from '../oee-standard/planned-stop-window.util';

const MIN = 60_000;

/**
 * Writes `oee_schedule_minutes` — the same measured minute, stamped with the
 * slot the job order was committed to.
 *
 * The classification is not repeated here; it is imported. The two engines
 * differ in one definition and share the other twenty, and a second copy of the
 * shared part would drift from the first the moment either was fixed.
 *
 * What IS this writer's own job is the slot:
 *
 *   committedFrom = min(plannedStart, actualStart)
 *   committedTo   = actualEnd == null ? max(now, plannedEnd)
 *                                     : max(actualEnd, plannedEnd)
 *
 * Stamped on every row rather than looked up at read time. It is identical on
 * every row of a job order, so a reader takes MIN/MAX per job order and clips to
 * the window — no second query, and no way for the slot to disagree with the
 * minutes sitting inside it.
 *
 * `committedTo` moves for an order that has overrun, which is why the read takes
 * the MAX: the latest row carries the latest answer.
 */
@Injectable()
export class OeeScheduleWriter {
  private readonly logger = new Logger(OeeScheduleWriter.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retired. The standard writer records the slot on `oee_minutes`, so this
   * table is no longer written and the schedule basis reads the unified store.
   *
   * Kept as a file rather than deleted: `committedSlot` lives beside it and is
   * now imported by the standard writer, and the table itself stays for archive
   * until the parallel-run window closes. Re-enabling the cron would start a
   * second copy of every minute diverging from the first again.
   */
  // @Cron(CronExpression.EVERY_MINUTE)
  async tick(): Promise<void> {
    try {
      await this.captureMinute(new Date());
    } catch (err) {
      this.logger.error('OEE schedule minute capture failed', err as Error);
    }
  }

  private ruleCache = new Map<string, { at: number; v: Verdict }>();
  private static readonly RULE_TTL_MS = 30_000;

  private async verdictFor(factoryId: string, machineId: string, state: string): Promise<Verdict> {
    const key = `${machineId}:${state}`;
    const hit = this.ruleCache.get(key);
    if (hit && Date.now() - hit.at < OeeScheduleWriter.RULE_TTL_MS) return hit.v;

    let v = FALLBACK_VERDICTS[state] ?? UNKNOWN_VERDICT;
    try {
      const rows = await this.prisma.machineStateRule.findMany({
        where: { factoryId, state, isActive: true, OR: [{ machineId }, { machineId: null }] },
        select: { machineId: true, isDowntime: true, isPlanned: true, affectsOEE: true },
      });
      const chosen = rows.find((r) => r.machineId === machineId) ?? rows.find((r) => r.machineId === null);
      if (chosen) {
        v = { isDowntime: chosen.isDowntime, isPlanned: chosen.isPlanned, affectsOEE: chosen.affectsOEE };
      }
    } catch (err) {
      this.logger.warn(`state-rule lookup failed for ${state}: ${(err as Error).message}`);
    }
    this.ruleCache.set(key, { at: Date.now(), v });
    return v;
  }

  /** Capture the minute that has just CLOSED. */
  async captureMinute(at = new Date()): Promise<number> {
    const bucketStart = new Date(Math.floor(at.getTime() / MIN) * MIN - MIN);
    const bucketEnd = new Date(bucketStart.getTime() + MIN);

    await this.prisma.oeeScheduleMinute.updateMany({
      where: { isFinalized: false, bucketStart: { lt: bucketStart } },
      data: { isFinalized: true },
    });

    const jos = await this.prisma.jobOrder.findMany({
      where: {
        status: { in: ['EXECUTING', 'PAUSED'] },
        machineId: { not: null },
        actualStart: { not: null, lte: bucketEnd },
      },
      select: {
        id: true, factoryId: true, machineId: true, workOrderId: true, status: true,
        idealCycleTimeSec: true, outputUnit: true,
        plannedStart: true, plannedEnd: true, actualStart: true, actualEnd: true,
        actualQtyGood: true, actualQtyRejected: true,
        machine: { select: { lineId: true } },
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

    const states = await this.prisma.machineStateRecord.findMany({
      where: {
        machineId: { in: machineIds },
        startTime: { lt: bucketEnd },
        OR: [{ endTime: null }, { endTime: { gt: bucketStart } }],
      },
      select: { machineId: true, state: true, startTime: true, endTime: true },
    });

    const priorRows = await this.prisma.oeeScheduleMinute.groupBy({
      by: ['jobOrderId'],
      where: { jobOrderId: { in: joIds }, isFinalized: true },
      _sum: { goodParts: true, rejectedParts: true },
    });
    const prior = new Map(
      priorRows.map((r) => [r.jobOrderId, { good: r._sum.goodParts ?? 0, rejected: r._sum.rejectedParts ?? 0 }]),
    );

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
        await this.prisma.oeeScheduleMinute.upsert({
          where: { ux_oee_sched_jo_bucket: { jobOrderId: jo.id, bucketStart } },
          create: row,
          update: row,
        });
        written++;
      } catch (e) {
        this.logger.warn(`schedule minute upsert failed for JO ${jo.id}: ${(e as Error).message}`);
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
    // The slot. Written from the job order exactly as the plant defined it —
    // and a job order with no slot at all is not measurable on this basis, so it
    // is skipped rather than given one.
    const slot = committedSlot(
      {
        plannedStart: jo.plannedStart ?? null,
        plannedEnd: jo.plannedEnd ?? null,
        actualStart: jo.actualStart ?? null,
        actualEnd: jo.actualEnd ?? null,
      },
      at,
    );
    if (!slot) return null;

    // The ELAPSED part of the minute, identical to the standard engine. The slot
    // above is the denominator; this is what actually happened inside it.
    const joStart = new Date(jo.actualStart).getTime();
    const joEnd = jo.actualEnd ? new Date(jo.actualEnd).getTime() : at.getTime();
    const winFrom = Math.max(bucketStart.getTime(), joStart);
    const winTo = Math.min(bucketEnd.getTime(), joEnd, at.getTime());
    const totalMin = Math.max(0, (winTo - winFrom) / MIN);
    if (totalMin <= 0) return null;

    const place: MachinePlace = { machineId: jo.machineId, lineId: jo.machine?.lineId ?? null };
    const windows = shift ? stopWindowsForShift(stopDefs, shift, place) : [];
    const scheduledSpans: Span[] = merge(
      windows
        .map((w) => [Math.max(w.start.getTime(), winFrom), Math.min(w.end.getTime(), winTo)] as Span)
        .filter(([s, e]) => e > s),
    );

    const {
      plannedStopMin, operatingMin, externalLossMin, availabilityLossMin, unmeasuredMin,
      dominantState,
    } = await classifyMinute({
      winFrom, winTo, openEnd: at.getTime(),
      states: states.filter((st) => st.machineId === jo.machineId),
      scheduledStops: scheduledSpans,
      paused: jo.status === 'PAUSED',
      verdictFor: (state) => this.verdictFor(jo.factoryId, jo.machineId, state),
    });

    const sku: SkuPackaging | null = jo.workOrder?.sku ?? null;
    const unit: string | undefined = jo.outputUnit ?? undefined;
    const toBase = (q: number) => (sku && unit ? toPieces(q, unit, sku) : q);

    const p = prior.get(jo.id) ?? { good: 0, rejected: 0 };
    const goodParts = Math.max(0, toBase(jo.actualQtyGood ?? 0) - p.good);
    const rejectedParts = Math.max(0, toBase(jo.actualQtyRejected ?? 0) - p.rejected);

    const perOutputUnit = toBase(1) || 1;
    const speedOut = designSpeedPph(jo.idealCycleTimeSec);
    const designSpeed = speedOut != null ? speedOut * perOutputUnit : null;
    const theoreticalParts = designSpeed != null ? (operatingMin / 60) * designSpeed : 0;

    return {
      bucketStart,
      isFinalized: false,
      factoryId: jo.factoryId,
      machineId: jo.machineId,
      jobOrderId: jo.id,
      workOrderId: jo.workOrderId ?? null,
      shiftTemplateId: shift?.templateId ?? null,
      shiftCode: shift?.code ?? null,
      machineState: dominantState,
      jobOrderStatus: jo.status,
      committedFrom: slot.from,
      committedTo: slot.to,
      totalMin, plannedStopMin, availabilityLossMin, externalLossMin, unmeasuredMin, operatingMin,
      goodParts, rejectedParts, theoreticalParts,
      designSpeedPph: designSpeed,
    };
  }
}
