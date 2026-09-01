import type { ResolvedShift } from '../../common/shift-window.util';

/**
 * Turning a planned-stop DEFINITION into a concrete window on the clock.
 *
 * A planned stop is the only thing that legitimately removes time from the
 * availability denominator, so it must be a decision somebody made — not a
 * duration the system distributes wherever it likes. That is why a definition
 * carries a shift, an offset from that shift's start, and a duration: those
 * three fix an interval, and the end is arithmetic rather than a guess.
 *
 *   window = [shiftStart + startOffsetMin, shiftStart + startOffsetMin + durationMinutes)
 *
 * A definition with no shift and no offset cannot be placed on the clock at all.
 * It is skipped rather than assumed into the middle of the shift, which is what
 * the previous generator did — and every minute it invented came straight off
 * Availability with nobody having chosen it.
 */

export const PLANNED_STOP_SCOPE = ['FACTORY', 'LINE', 'MACHINE'] as const;
export type PlannedStopScope = (typeof PLANNED_STOP_SCOPE)[number];

/** A planned-stop template as this engine needs to read it. */
export interface StopDefinition {
  id: string;
  code: string;
  name: string;
  durationMinutes: number;
  scope: PlannedStopScope;
  shiftTemplateId: string | null;
  startOffsetMin: number | null;
  /** Plant wall-clock "HH:MM" for a stop on its own schedule. */
  startTimeLocal?: string | null;
  isActive: boolean;
  /** Machines and lines this stop applies to. Empty for FACTORY scope. */
  targets: Array<{ machineId: string | null; lineId: string | null }>;
}

/** Where the machine sits, for scope matching. */
export interface MachinePlace {
  machineId: string;
  lineId: string | null;
}

export interface StopWindow {
  code: string;
  name: string;
  start: Date;
  end: Date;
}

const MIN = 60_000;

/**
 * Does this stop apply to this machine?
 *
 * FACTORY stops everything. A LINE stop reaches every machine on the named
 * line; a MACHINE stop reaches only the machines named. Recording a cleaning
 * stop against equipment nobody touched invents downtime, so an unmatched
 * scope means the stop simply does not apply here.
 */
export function appliesTo(def: StopDefinition, place: MachinePlace): boolean {
  if (!def.isActive) return false;
  if (def.scope === 'FACTORY') return true;
  if (def.scope === 'MACHINE') return def.targets.some((t) => t.machineId === place.machineId);
  if (def.scope === 'LINE') {
    return def.targets.some(
      (t) => (t.lineId != null && t.lineId === place.lineId) || t.machineId === place.machineId,
    );
  }
  return false;
}

/**
 * Every planned-stop window that touches this machine during this shift.
 *
 * Anchored on the shift OCCURRENCE, not on a template — so "the 10:00 break"
 * lands at 10:00 on Tuesday and again at 10:00 on Wednesday, and an overnight
 * shift's break sits where the shift put it rather than where the calendar day
 * would have.
 */
export function stopWindowsForShift(
  defs: StopDefinition[],
  shift: ResolvedShift,
  place: MachinePlace,
): StopWindow[] {
  const out: StopWindow[] = [];
  for (const def of defs) {
    if (!(def.durationMinutes > 0)) continue;
    if (!appliesTo(def, place)) continue;

    for (const start of placementsIn(def, shift)) {
      out.push({
        code: def.code,
        name: def.name,
        start,
        end: new Date(start.getTime() + def.durationMinutes * MIN),
      });
    }
  }
  return out;
}

/**
 * Every clock position this definition can occupy around this shift.
 *
 * ── Why a standalone stop is here at all ────────────────────────────────────
 * Availability only ever excludes time somebody set aside, so a planned stop
 * OEE cannot see is not a small omission — it is a break the plant takes daily
 * and is charged for. Only shift-bound stops used to be placed: a standalone
 * one had no `shiftTemplateId`, never matched, and was absent from every
 * availability figure while still appearing as downtime in the Downtime
 * module. One definition, two answers, and the quieter one was wrong.
 *
 * ── Why two candidates ──────────────────────────────────────────────────────
 * A standalone stop recurs at a wall-clock time each day and a shift can cross
 * midnight, so the occurrence on the shift's own day AND the one on the next
 * are both offered. Neither is filtered here: a window outside the bucket being
 * measured contributes nothing when it is intersected, so the arithmetic
 * already decides which one applies and a containment test here would only be
 * a second, less reliable copy of that decision.
 *
 * Which DAYS it runs on belongs to the schedule rule and is enforced where the
 * events are materialised. The question here is only where on the clock it sits.
 */
function placementsIn(def: StopDefinition, shift: ResolvedShift): Date[] {
  if (def.shiftTemplateId) {
    // Inside a shift, and only inside THAT shift.
    if (def.shiftTemplateId !== shift.templateId) return [];
    if (def.startOffsetMin == null) return []; // unplaceable — never guessed at
    return [new Date(shift.shiftStart.getTime() + def.startOffsetMin * MIN)];
  }

  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(def.startTimeLocal ?? '');
  if (!m) return []; // no shift and no clock time — nowhere to put it
  const intoDay = (Number(m[1]) * 60 + Number(m[2])) * MIN;

  // `shiftDate` is midnight of the day the occurrence began, in plant terms —
  // the same base every other placement in this file counts from.
  const day0 = shift.shiftDate.getTime();
  return [new Date(day0 + intoDay), new Date(day0 + 24 * 60 * MIN + intoDay)];
}

/**
 * How many minutes of [from, to) fall inside any of these windows.
 *
 * Merged, not summed. Two definitions that overlap — a factory-wide break and a
 * line cleaning that runs into it — describe the same stopped minutes, and
 * adding their durations removes more time from the denominator than the clock
 * contains. The same defect that made stopped time exceed the window in the
 * first engine, avoided here by construction.
 */
export function plannedStopMinutes(windows: StopWindow[], from: number, to: number): number {
  if (!(to > from) || windows.length === 0) return 0;

  const clipped: Array<[number, number]> = [];
  for (const w of windows) {
    const s = Math.max(w.start.getTime(), from);
    const e = Math.min(w.end.getTime(), to);
    if (e > s) clipped.push([s, e]);
  }
  if (clipped.length === 0) return 0;

  // Copied, not aliased: the merged result must not reach back and rewrite the
  // clipped spans it was built from.
  clipped.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [[clipped[0][0], clipped[0][1]]];
  for (let i = 1; i < clipped.length; i++) {
    const last = merged[merged.length - 1];
    if (clipped[i][0] <= last[1]) last[1] = Math.max(last[1], clipped[i][1]);
    else merged.push([clipped[i][0], clipped[i][1]]);
  }
  return merged.reduce((sum, [s, e]) => sum + (e - s), 0) / MIN;
}
