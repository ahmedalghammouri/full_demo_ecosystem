import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { resolveShiftAt, type ShiftTemplateWindow } from '../../common/shift-window.util';
import {
  stopWindowsForShift, type StopDefinition, type MachinePlace, type PlannedStopScope,
} from './planned-stop-window.util';

/**
 * Writing the SCHEDULE into the machine's own state history.
 *
 * ── The split brain this closes ─────────────────────────────────────────────
 * A planned stop used to exist in exactly one place: a template, read at
 * calculation time and handed to the classifier as a span. That gave the two
 * halves of the system different answers for the same minute.
 *
 *   the maths   `planned = merge([...scheduledStops, ...])` and then
 *               `operating = subtract(operating, planned)` — the schedule WINS
 *   the screen  the Gantt reads `machine_state_records` and nothing else, so it
 *               showed whatever the sensor said — the schedule was INVISIBLE
 *
 * Inside every scheduled window the timeline said IDLE (or RUNNING, if the line
 * worked through its own break) while OEE had already excluded those minutes.
 * No error, no warning, and nobody comparing the two could reconcile them.
 *
 * So the window becomes a record. One source of truth, written once, read by
 * the timeline and the classifier alike.
 *
 * ── Why this cannot simply INSERT ───────────────────────────────────────────
 * `machine_state_records` carries the sensor's account of the machine, and that
 * account is continuous — one record after another with no gaps. Dropping a
 * planned record on top would leave two records claiming the same minute, and
 * the Gantt would draw both.
 *
 * The sensor's record is never edited or deleted. It is the measurement, and a
 * measurement is not ours to rewrite. Instead the planned record is marked
 * `source: 'SCHEDULE'`, and every reader applies the SAME precedence the
 * classifier already applies: where a scheduled window overlaps a sensor
 * record, the schedule wins. Both accounts survive; the rule for resolving them
 * lives in one place.
 *
 * ── Idempotent by construction ──────────────────────────────────────────────
 * A run deletes its own previous output for the window (`source: 'SCHEDULE'`)
 * and writes it again. Re-running after a template is corrected produces the
 * corrected history, and re-running after nothing changed produces the same
 * rows. Sensor records are untouched either way — the delete is scoped to this
 * writer's own source.
 */

/** What a template's category means for the machine's state. */
const STATE_FOR_CATEGORY: Record<string, string> = {
  PLANNED_BREAK: 'PLANNED_STOP',
  PLANNED_CLEANING: 'PLANNED_STOP',
  PLANNED_MAINTENANCE: 'MAINTENANCE',
  CHANGEOVER: 'CHANGEOVER',
  STARTUP: 'STARTUP',
};

export interface MaterializeResult {
  from: Date;
  to: Date;
  written: number;
  removed: number;
  machines: number;
  /** Windows that could not be placed on the clock — see stopWindowsForShift. */
  unplaced: number;
}

@Injectable()
export class PlannedStopMaterializerService {
  private readonly log = new Logger(PlannedStopMaterializerService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Keep the rolling window written, for every factory, without being asked.
   *
   * ── Why a cron at all ───────────────────────────────────────────────────
   * Materialising once from a seed covers the days the seed was run for and
   * nothing after. Tomorrow's shifts would get no planned stops, the timeline
   * would go back to showing IDLE through every break, and the single source of
   * truth would quietly expire — the same split brain this service exists to
   * close, just deferred by a few days.
   *
   * ── Why hourly and not per minute ───────────────────────────────────────
   * A planned stop is known in advance; there is nothing to sample. Hourly is
   * fast enough that correcting a template shows up while the person who
   * corrected it is still looking, and slow enough that a rewrite of a few
   * hundred rows is nothing.
   *
   * ── Why a MONTH back, not a day ─────────────────────────────────────────
   * Because this job is the only thing that can un-write what it wrote.
   *
   * `materialize` replaces its own rows inside the window it is given, and
   * nothing else ever deletes them. With a one-day window, deleting a template
   * left every record it had ever produced sitting on the timeline: the plant
   * cleared its planned stops, saw zero templates on the screen, and the Gantt
   * still drew PLANNED_STOP across the past ten days. Derived rows outliving
   * the definition they derive from is not a stale cache, it is a lie with a
   * timestamp.
   *
   * So the horizon is wide enough to cover what anyone is looking at — a month
   * back, a week forward — and every tick rewrites all of it from the current
   * templates. No templates means no rows, which is the correct answer to
   * "I deleted them". The cost is a few thousand rows an hour, which is
   * nothing, and the alternative is a reconciliation nobody remembers to run.
   *
   * Beyond the horizon, records stay. Deleting a template should stop future
   * materialisation, not rewrite a quarter's published OEE.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    const now = new Date();
    const from = startOfDay(new Date(now.getTime() - 30 * 24 * 3_600_000));
    const to = new Date(startOfDay(new Date(now.getTime() + 7 * 24 * 3_600_000)).getTime());

    try {
      // Opt-in, per factory. Materialising the schedule is right for a plant
      // whose breaks repeat on a rule and wrong for one that plans day by day,
      // and that is not something the code can decide — so it is a setting,
      // and it is OFF until somebody turns it on.
      //
      // A factory that switches it off keeps whatever was already written; the
      // rows are removed by the same screen that made them, not silently on
      // the next tick. Turning a feature off should stop it acting, not delete
      // what it did while it was on.
      const factories = await this.prisma.factory.findMany({
        where: { plannedStopMaterialisation: true },
        select: { id: true },
      });
      if (factories.length === 0) return;
      for (const f of factories) {
        await this.materialize(f.id, from, to);
      }
    } catch (err) {
      // Logged, never thrown: a failed materialisation leaves the previous
      // rows in place, which is stale rather than wrong. Taking the scheduler
      // down would also stop every later attempt from repairing it.
      this.log.error('Planned-stop materialisation failed', err as Error);
    }
  }

  /**
   * Write every planned-stop window that falls in [from, to) as state records.
   *
   * Walks the window shift-occurrence by shift-occurrence rather than day by
   * day, because a planned stop is anchored to its SHIFT: "thirty minutes after
   * the shift starts" lands where the shift put it, and an overnight shift's
   * break belongs to the occurrence that began yesterday.
   */
  async materialize(factoryId: string, from: Date, to: Date): Promise<MaterializeResult> {
    const [templates, stopRows, machines] = await Promise.all([
      this.prisma.shiftTemplate.findMany({
        where: { factoryId, isActive: true },
        select: { id: true, code: true, name: true, startTime: true, endTime: true },
      }),
      this.prisma.plannedStopTemplate.findMany({
        where: { factoryId, isActive: true },
        select: {
          id: true, code: true, name: true, durationMinutes: true, scope: true,
          shiftTemplateId: true, startOffsetMin: true, startTimeLocal: true,
          isActive: true, category: true, causeId: true,
        },
      }),
      this.prisma.machine.findMany({
        where: { factoryId, isActive: true },
        select: { id: true, lineId: true },
      }),
    ]);

    const shiftWindows: ShiftTemplateWindow[] = templates.map((t) => ({
      id: t.id, code: t.code, name: t.name,
      startTime: t.startTime, endTime: t.endTime,
      crossesMidnight: t.endTime <= t.startTime,
    }));

    // Scope targets. A LINE or MACHINE stop names what it applies to; a FACTORY
    // stop names nothing and reaches everything.
    const targets = await this.prisma.plannedStopTarget.findMany({
      where: { templateId: { in: stopRows.map((s) => s.id) } },
      select: { templateId: true, machineId: true, lineId: true },
    }).catch(() => [] as Array<{ templateId: string; machineId: string | null; lineId: string | null }>);

    const targetsBy = new Map<string, Array<{ machineId: string | null; lineId: string | null }>>();
    for (const t of targets) {
      const list = targetsBy.get(t.templateId) ?? [];
      list.push({ machineId: t.machineId, lineId: t.lineId });
      targetsBy.set(t.templateId, list);
    }

    const defs: StopDefinition[] = stopRows.map((s) => ({
      id: s.id, code: s.code, name: s.name,
      durationMinutes: s.durationMinutes,
      scope: s.scope as PlannedStopScope,
      shiftTemplateId: s.shiftTemplateId,
      startOffsetMin: s.startOffsetMin,
      startTimeLocal: s.startTimeLocal,
      isActive: s.isActive,
      targets: targetsBy.get(s.id) ?? [],
    }));
    const categoryOf = new Map(stopRows.map((s) => [s.code, s.category as string]));
    const causeOf = new Map(stopRows.map((s) => [s.code, s.causeId]));

    // Every shift occurrence touching the window. Stepping by 30 minutes finds
    // each one without assuming shift lengths; the set dedupes the repeats.
    const occurrences = new Map<string, { templateId: string; shiftStart: Date; code: string; name: string }>();
    const STEP = 30 * 60_000;
    for (let t = from.getTime(); t < to.getTime(); t += STEP) {
      const s = resolveShiftAt(new Date(t), shiftWindows);
      if (s) occurrences.set(`${s.templateId}|${s.shiftStart.toISOString()}`, s);
    }

    // Clear this writer's own previous output for the window. Scoped to
    // source='SCHEDULE', so the sensor's records are never in range.
    const removed = await this.prisma.machineStateRecord.deleteMany({
      where: {
        factoryId, source: SCHEDULE_SOURCE,
        startTime: { gte: from, lt: to },
      },
    });

    const rows: Array<{
      factoryId: string; machineId: string; state: string;
      startTime: Date; endTime: Date; durationMinutes: number;
      isPlannedStop: boolean; downtimeCauseId: string | null;
      source: string; notes: string;
    }> = [];
    let unplaced = 0;

    for (const machine of machines) {
      const place: MachinePlace = { machineId: machine.id, lineId: machine.lineId };
      for (const occ of occurrences.values()) {
        const windows = stopWindowsForShift(
          defs,
          { templateId: occ.templateId, code: occ.code, name: occ.name, shiftStart: occ.shiftStart, shiftDate: startOfDay(occ.shiftStart) },
          place,
        );
        for (const w of windows) {
          // Clip to the requested window — a stop straddling the edge is written
          // only for the part that belongs here, so two adjacent runs cannot
          // both claim the same minutes.
          const s = new Date(Math.max(w.start.getTime(), from.getTime()));
          const e = new Date(Math.min(w.end.getTime(), to.getTime()));
          if (e <= s) { unplaced++; continue; }

          rows.push({
            factoryId,
            machineId: machine.id,
            state: STATE_FOR_CATEGORY[categoryOf.get(w.code) ?? ''] ?? 'PLANNED_STOP',
            startTime: s,
            endTime: e,
            durationMinutes: (e.getTime() - s.getTime()) / 60_000,
            isPlannedStop: true,
            downtimeCauseId: causeOf.get(w.code) ?? null,
            source: SCHEDULE_SOURCE,
            notes: `${w.name} (${w.code}) — from the shift schedule`,
          });
        }
      }
    }

    if (rows.length > 0) {
      await this.prisma.machineStateRecord.createMany({ data: rows as never });
    }

    this.log.log(
      `Planned stops materialised: ${rows.length} written, ${removed.count} replaced, `
      + `${machines.length} machines, ${occurrences.size} shift occurrences`,
    );

    return {
      from, to,
      written: rows.length,
      removed: removed.count,
      machines: machines.length,
      unplaced,
    };
  }
}

/**
 * The marker that separates what the SCHEDULE says from what the SENSOR said.
 *
 * Exported because two readers need it: this writer, to replace only its own
 * rows, and the timeline, to give these records precedence over the sensor's —
 * the same precedence the classifier already applies to the minutes.
 */
export const SCHEDULE_SOURCE = 'SCHEDULE';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
