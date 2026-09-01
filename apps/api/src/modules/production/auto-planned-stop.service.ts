import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { currentShiftWindow } from '../../common/shift-window.util';
import {
  layStops, layBreaks, stopMarker, occurrenceKey,
  type Trigger, type StopPlanItem, type BreakItem, type LaidStop,
} from './planned-stop-plan';

/**
 * Books the stops the plant already knows it will take.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * On 25 August somebody entered cleaning, startup, changeover and a lunch break
 * by hand, four machines at a time, for two days. Those stops were never a
 * surprise: they belong to the order and to the shift, and the plant had
 * already said so. This writes them from what was said.
 *
 * ── Two rules it will not bend ──────────────────────────────────────────────
 * FROM THE ACTUAL START, NEVER THE PLANNED ONE. The order that ran two hours
 * late is the case that matters — its cleaning belongs where the cleaning
 * happened. Booking against the plan is what put 108 machine-minutes of
 * changeover on a changeover that never occurred.
 *
 * EDITING A PLAN NEVER REWRITES A PAST OCCURRENCE. The plan says what will
 * happen next time; events already written are a record of what was decided
 * then. A plan changed tomorrow that silently moved yesterday's booked cleaning
 * would make every historical report unreproducible.
 *
 * ── Idempotency is the whole risk ───────────────────────────────────────────
 * Every path here can run again — a cron tick, a retry, two operators pressing
 * resume. Each event carries a marker naming its plan and its occurrence, and
 * nothing is written twice. Without that, a cleaning window is booked every
 * minute, which is the 150-unit mistake multiplied by the length of a shift.
 */
@Injectable()
export class AutoPlannedStopService {
  private readonly logger = new Logger(AutoPlannedStopService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ── Order stops ───────────────────────────────────────────────────────────

  /**
   * Book an order's stops against ONE job order — that is, one machine.
   *
   * Per machine rather than per line, because the events land where the
   * timeline, the OEE denominator and the counter all already look. A single
   * line-wide event would have to be apportioned back to four machines by some
   * rule, and that rule would be a second definition of the same minutes.
   */
  async onJobOrderStart(jobOrderId: string, trigger: Trigger, at: Date): Promise<number> {
    const jo = await this.prisma.jobOrder.findUnique({
      where: { id: jobOrderId },
      select: {
        id: true, factoryId: true, machineId: true, workOrderId: true,
        workOrder: { select: { productionOrderId: true } },
      },
    });
    if (!jo?.machineId || !jo.workOrder?.productionOrderId) return 0;

    const plan = await this.prisma.productionOrderStop.findMany({
      where: { productionOrderId: jo.workOrder.productionOrderId, isActive: true },
      orderBy: { sequence: 'asc' },
    });
    if (plan.length === 0) return 0;

    const laid = layStops(plan as unknown as StopPlanItem[], at, trigger);
    if (laid.length === 0) return 0;

    return this.write(laid, {
      factoryId: jo.factoryId,
      machineId: jo.machineId,
      workOrderId: jo.workOrderId,
      jobOrderId: jo.id,
      key: occurrenceKey(trigger, at),
    });
  }

  /** Every executing step of a work order, when the order itself starts. */
  async onWorkOrderStart(workOrderId: string, trigger: Trigger, at: Date): Promise<number> {
    const jos = await this.prisma.jobOrder.findMany({
      where: { workOrderId, machineId: { not: null } },
      select: { id: true },
    });
    let n = 0;
    for (const jo of jos) n += await this.onJobOrderStart(jo.id, trigger, at);
    return n;
  }

  // ── Shift breaks ──────────────────────────────────────────────────────────

  /**
   * Book this shift's breaks, once per occurrence.
   *
   * Runs every ten minutes rather than on a shift-start event, because nothing
   * in this system emits one: shifts are DERIVED from templates by
   * `currentShiftWindow`, and no row is created when one begins. Polling for the
   * occurrence and keying on its start instant reaches the same place — the
   * marker makes the repetition harmless, and a break booked up to ten minutes
   * into its shift is still booked before it happens.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async tickShiftBreaks(): Promise<void> {
    try {
      const factories = await this.prisma.factory.findMany({
        where: { isActive: true }, select: { id: true },
      });
      for (const f of factories) await this.bookBreaksFor(f.id).catch(() => undefined);
    } catch (e) {
      this.logger.debug(`shift-break tick skipped: ${(e as Error).message}`);
    }
  }

  async bookBreaksFor(factoryId: string): Promise<number> {
    const win = await currentShiftWindow(this.prisma, factoryId);
    if (!win) return 0;

    // Which template is running. `currentShiftWindow` resolves the window but
    // not the row, and the breaks hang off the row.
    const templates = await this.prisma.shiftTemplate.findMany({
      where: { factoryId, isActive: true },
      select: {
        id: true, code: true, startTime: true, shiftDurationHours: true,
        breaks: { where: { isActive: true }, orderBy: { sequence: 'asc' } },
      },
    });
    const hhmm = `${String(win.start.getHours()).padStart(2, '0')}:${String(win.start.getMinutes()).padStart(2, '0')}`;
    const tpl = templates.find((t) => t.startTime === hhmm);
    if (!tpl || tpl.breaks.length === 0) return 0;

    const lengthMin = Math.round((win.end.getTime() - win.start.getTime()) / 60_000);
    const { laid, outside } = layBreaks(tpl.breaks as unknown as BreakItem[], win.start, lengthMin);

    if (outside.length > 0) {
      // Named, not clamped. A break outside its own shift is a configuration
      // mistake, and moving it quietly would produce a stop nobody asked for.
      this.logger.warn(
        `shift ${tpl.code}: ${outside.length} break(s) fall outside the shift and were NOT booked — `
        + outside.map((b) => `${b.label} at ${b.startTime} for ${b.durationMin}m`).join(', '),
      );
    }
    if (laid.length === 0) return 0;

    // A break stops the LINE, so it is booked against every machine that has a
    // step to run in this shift — the same per-machine shape as an order's
    // stops, for the same reason.
    const machines = await this.prisma.machine.findMany({
      where: { factoryId, isActive: true },
      select: { id: true },
    });

    const key = occurrenceKey('SHIFT_CHANGE', win.start);
    let n = 0;
    for (const m of machines) {
      n += await this.write(laid, {
        factoryId, machineId: m.id, workOrderId: null, jobOrderId: null, key,
      });
    }
    return n;
  }

  // ── Writing ───────────────────────────────────────────────────────────────

  /**
   * Write the laid stops, skipping any this occurrence already has.
   *
   * The marker is checked per event rather than per batch: a partial write —
   * the process restarting midway, a transaction failing on the fourth machine
   * — must be completable on the next attempt, not blocked by the three that
   * did land.
   */
  private async write(
    laid: LaidStop[],
    ctx: {
      factoryId: string; machineId: string;
      workOrderId: string | null; jobOrderId: string | null; key: string;
    },
  ): Promise<number> {
    let written = 0;
    for (const s of laid) {
      const marker = stopMarker(s.planId, ctx.key);
      const exists = await this.prisma.downtimeEvent.findFirst({
        where: { machineId: ctx.machineId, notes: { contains: marker } },
        select: { id: true },
      });
      if (exists) continue;

      await this.prisma.downtimeEvent.create({
        data: {
          factoryId: ctx.factoryId,
          machineId: ctx.machineId,
          // The link the plant asked for and the schema always had room for.
          // With it, a planned stop belongs to the order that caused it — which
          // is what lets a changeover move when its order moves.
          workOrderId: ctx.workOrderId,
          jobOrderId: ctx.jobOrderId,
          reason: s.label,
          category: this.categoryOf(s.kind),
          reasonCode: s.affectsOEE ? 'CHANGEOVER' : 'PLANNED_MAINTENANCE',
          startTime: s.from,
          endTime: s.to,
          durationMinutes: (s.to.getTime() - s.from.getTime()) / 60_000,
          isPlanned: true,
          affectsOEE: s.affectsOEE,
          acknowledged: true,
          notes: `${s.label} ${marker}`,
        },
      });
      written++;
    }
    return written;
  }

  /** The plant's own category for a stop kind. Unknown kinds stay OTHER. */
  private categoryOf(kind: string): any {
    switch (kind) {
      case 'CLEANING': return 'PLANNED_MAINTENANCE';
      case 'STARTUP': return 'STARTUP';
      case 'CHANGEOVER': return 'CHANGEOVER';
      case 'BREAK': return 'PLANNED_BREAK';
      default: return 'OTHER';
    }
  }
}
