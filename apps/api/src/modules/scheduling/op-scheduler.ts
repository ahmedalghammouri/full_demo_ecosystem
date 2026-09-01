import { DependencyType } from '@prisma/client';

/**
 * Pure finite-capacity, dependency-aware forward scheduler.
 *
 * Shared by APS "Recalculate Plan" and the production Auto-Generate preview so
 * both compute identical, overlap-aware schedules (the "largest common
 * intersection" the routing relationships allow) without persisting anything.
 *
 * Honours typed precedence with lag (FS / SS / FF / SF). START_TO_START ops form
 * one synchronised line (parallel start, end at the bottleneck).
 *
 * Two refinements:
 *  • a WorkCalendar skips non-working days (e.g. the weekly rest day / holidays) —
 *    starts snap forward to the next working day and durations stretch across
 *    rest days instead of scheduling work on them;
 *  • `pinnedStart` fixes an operation that is already running/started so a
 *    recalculation never moves its start — only not-yet-started ops are replanned.
 */

const DAY_MS = 86_400_000;

export interface WorkCalendar {
  isWorkingDay(ms: number): boolean;
  /** If `ms` lands on a non-working day, jump to 00:00 of the next working day; else `ms`. */
  nextWorkingInstant(ms: number): number;
  /** End instant after consuming `durMs` of work, counting working days only. */
  addWorkingMs(startMs: number, durMs: number): number;
}

/** A 24/7 calendar — no day is excluded (the default when none is supplied). */
export const ALWAYS_ON: WorkCalendar = {
  isWorkingDay: () => true,
  nextWorkingInstant: (ms) => ms,
  addWorkingMs: (startMs, durMs) => startMs + durMs,
};

/**
 * Build a calendar from working weekdays (0=Sun … 6=Sat — the same convention
 * shift templates store) and optional `YYYY-MM-DD` holidays. Working days are
 * treated as fully available; intra-day breaks/cleaning are accounted for
 * separately as planned stoppage.
 */
export function makeWorkCalendar(workingDays: number[], holidays: string[] = []): WorkCalendar {
  const wd = new Set(workingDays.length ? workingDays : [0, 1, 2, 3, 4, 5, 6]);
  const hol = new Set(holidays);
  const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const dateStr = (ms: number) => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const isWorking = (ms: number) => wd.has(new Date(ms).getDay()) && !hol.has(dateStr(ms));

  const cal: WorkCalendar = {
    isWorkingDay: isWorking,
    nextWorkingInstant(ms) {
      let c = ms;
      for (let g = 0; g < 400 && !isWorking(c); g++) c = startOfDay(c) + DAY_MS;
      return c;
    },
    addWorkingMs(startMs, durMs) {
      let cur = cal.nextWorkingInstant(startMs);
      let rem = Math.max(0, durMs);
      for (let g = 0; rem > 0 && g < 4000; g++) {
        const endOfDay = startOfDay(cur) + DAY_MS;
        const avail = endOfDay - cur;
        if (rem <= avail) { cur += rem; rem = 0; }
        else { rem -= avail; cur = cal.nextWorkingInstant(endOfDay); }
      }
      return cur;
    },
  };
  return cal;
}

export interface SchedOp {
  id: string;
  machineId: string | null;
  durationMs: number;
  predecessorId: string | null;
  predecessorType: DependencyType;
  predecessorLagMins: number;
  sequenceOrder: number;
  /** When set, the op is already started — keep this start fixed (never replanned). */
  pinnedStart?: number;
}

export interface SchedResult {
  start: Map<string, number>;
  end: Map<string, number>;
  /** Latest op end across the set (the makespan finish instant). */
  finish: number;
}

/**
 * Schedule one set of operations (e.g. all job orders of a single work order)
 * forward from `horizon`. `machineFree` is consulted AND mutated so callers can
 * chain multiple work orders onto the same finite machine pool.
 */
export function scheduleOps(
  ops: SchedOp[],
  horizon: number,
  machineFree: Map<string, number> = new Map(),
  calendar: WorkCalendar = ALWAYS_ON,
): SchedResult {
  const jobStart = new Map<string, number>();
  const jobEnd = new Map<string, number>();
  if (ops.length === 0) return { start: jobStart, end: jobEnd, finish: horizon };

  const sorted = [...ops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const opById = new Map(sorted.map((o) => [o.id, o]));

  // ── Pinned (already-started) ops are fixed in place first, so movable
  // successors see their real start/end and machines are pre-occupied. ──
  for (const o of sorted) {
    if (o.pinnedStart == null) continue;
    const s = o.pinnedStart;
    const e = calendar.addWorkingMs(s, o.durationMs);
    jobStart.set(o.id, s);
    jobEnd.set(o.id, e);
    if (o.machineId) machineFree.set(o.machineId, Math.max(machineFree.get(o.machineId) ?? horizon, e));
  }
  const movable = sorted.filter((o) => o.pinnedStart == null);

  // ── Union-find: group movable ops chained by START_TO_START into one component ──
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (parent.get(c) !== c) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };
  for (const o of movable) parent.set(o.id, o.id);
  for (const o of movable) {
    if (o.predecessorId && o.predecessorType === DependencyType.START_TO_START && parent.has(o.predecessorId)) {
      parent.set(find(o.id), find(o.predecessorId));
    }
  }
  const comps = new Map<string, SchedOp[]>();
  for (const o of movable) {
    const r = find(o.id);
    if (!comps.has(r)) comps.set(r, []);
    comps.get(r)!.push(o);
  }
  const compList = [...comps.values()].sort(
    (a, b) => Math.min(...a.map((o) => o.sequenceOrder)) - Math.min(...b.map((o) => o.sequenceOrder)),
  );

  for (const comp of compList) {
    // SS-lag offset of each member relative to the component anchor
    const offset = new Map<string, number>();
    for (const m of comp) {
      if (!(m.predecessorId && m.predecessorType === DependencyType.START_TO_START && opById.has(m.predecessorId))) {
        offset.set(m.id, 0); // anchor
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of comp) {
        if (offset.has(m.id)) continue;
        const po = offset.get(m.predecessorId!);
        if (po !== undefined) {
          offset.set(m.id, po + (m.predecessorLagMins ?? 0) * 60_000);
          changed = true;
        }
      }
    }
    for (const m of comp) if (!offset.has(m.id)) offset.set(m.id, 0);

    // Group start: every member's external constraints must hold at
    // (groupStart + its offset), including cross-WO machine windows.
    // SS members chained WITHIN this component are handled by their offset; an SS
    // link whose predecessor sits OUTSIDE the component (e.g. it was pinned by a
    // drag) is enforced here too, so SS stays parallel instead of degrading to FS.
    let groupStart = horizon;
    for (const m of comp) {
      const off = offset.get(m.id)!;
      const dur = m.durationMs;
      let extEarliest = horizon;
      const sameComp = !!m.predecessorId && parent.has(m.predecessorId) && find(m.id) === find(m.predecessorId);
      if (m.predecessorId && !sameComp) {
        const lag = (m.predecessorLagMins ?? 0) * 60_000;
        const pStart = jobStart.get(m.predecessorId) ?? horizon;
        const pEnd = jobEnd.get(m.predecessorId) ?? horizon;
        switch (m.predecessorType) {
          case DependencyType.START_TO_START:   extEarliest = pStart + lag; break;
          case DependencyType.FINISH_TO_FINISH: extEarliest = pEnd + lag - dur; break;
          case DependencyType.START_TO_FINISH:  extEarliest = pStart + lag - dur; break;
          case DependencyType.FINISH_TO_START:
          default:                              extEarliest = pEnd + lag; break;
        }
      }
      const mFree = m.machineId ? (machineFree.get(m.machineId) ?? horizon) : horizon;
      groupStart = Math.max(groupStart, extEarliest - off, mFree - off);
    }
    // Anchor lands on a working day (skip the weekly rest day / holidays)
    groupStart = calendar.nextWorkingInstant(groupStart);

    // Bottleneck end: the longest member stretches the synchronised line.
    // Durations consume working time only (rest days extend the end).
    let groupEnd = groupStart;
    for (const m of comp) {
      groupEnd = Math.max(groupEnd, calendar.addWorkingMs(groupStart + offset.get(m.id)!, m.durationMs));
    }

    for (const m of comp) {
      const s = groupStart + offset.get(m.id)!;
      const e = comp.length > 1 ? groupEnd : calendar.addWorkingMs(s, m.durationMs);
      jobStart.set(m.id, s);
      jobEnd.set(m.id, e);
      if (m.machineId) machineFree.set(m.machineId, e);
    }
  }

  const finish = Math.max(...[...jobEnd.values()], horizon);
  return { start: jobStart, end: jobEnd, finish };
}
