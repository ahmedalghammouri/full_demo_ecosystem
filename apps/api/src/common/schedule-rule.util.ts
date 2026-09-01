/**
 * When does a schedule apply?
 *
 * One function, used by shifts and by standalone planned stops alike, because
 * the moment the two have separate answers they drift and a plant gets a break
 * scheduled on a day it does not work.
 *
 * ── The model ───────────────────────────────────────────────────────────────
 * A rule is EITHER a single dated occurrence (Friday overtime) OR a weekly
 * recurrence bounded by a date range:
 *
 *   oneOffDate set        → that date only. daysOfWeek is ignored entirely.
 *   daysOfWeek + range    → those weekdays, between startDate and endDate.
 *   daysOfWeek + perpetual→ those weekdays, from startDate onwards, no end.
 *
 * ── Holidays ────────────────────────────────────────────────────────────────
 * A day that is not in `daysOfWeek` is simply not a working day. There is no
 * separate holiday list to keep in step: leaving Friday out of the array IS
 * saying Friday is off. One representation, so it cannot contradict itself.
 *
 * ── Dates are plant-local calendar days ─────────────────────────────────────
 * A schedule is a statement about the plant's calendar, not about UTC. Comparing
 * a stored timestamp to `new Date()` directly would move a shift across a day
 * boundary for a plant east of Greenwich, so every comparison here is made on
 * the local Y-M-D triple with time discarded.
 */

export interface ScheduleRuleLike {
  daysOfWeek: unknown;
  startDate: Date | string | null;
  endDate: Date | string | null;
  isPerpetual: boolean;
  oneOffDate: Date | string | null;
  isActive?: boolean;
}

/** Calendar day as a sortable number, e.g. 2026-08-15 → 20260815. */
function dayNumber(d: Date): number {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * Parse a stored date into a LOCAL calendar day.
 *
 * Dates arrive as midnight UTC from Prisma. Reading them with local getters in a
 * positive-offset zone would land on the previous day, which is exactly the
 * off-by-one that makes a schedule look correct in testing and wrong in Riyadh.
 */
function toLocalDay(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** Weekdays the rule runs on, normalised to 0–6. Anything else is ignored. */
export function weekdaysOf(rule: Pick<ScheduleRuleLike, 'daysOfWeek'>): number[] {
  const raw = rule.daysOfWeek;
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? safeParse(raw) : [];
  return [...new Set(
    list
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  )].sort((a, b) => a - b);
}

function safeParse(s: string): unknown[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * Does this rule apply on the given calendar day?
 *
 * `date` is read as a plant-local date — the caller passes a real Date whose
 * local Y-M-D is the day being asked about.
 */
export function appliesOn(rule: ScheduleRuleLike, date: Date): boolean {
  if (rule.isActive === false) return false;

  const day = dayNumber(date);

  // A one-off ignores the weekly pattern completely: it is a single dated
  // occurrence, and asking "which weekday" of it would let an unrelated
  // daysOfWeek array silently suppress it.
  const oneOff = toLocalDay(rule.oneOffDate);
  if (oneOff !== null) return oneOff === day;

  const days = weekdaysOf(rule);
  // No weekday selected means the rule never runs. Treating an empty array as
  // "every day" would turn a half-filled form into seven days of production.
  if (days.length === 0) return false;
  if (!days.includes(date.getDay())) return false;

  const start = toLocalDay(rule.startDate);
  if (start !== null && day < start) return false;

  // Perpetual outranks any end date: an explicit "no end" is a decision, and
  // honouring a stale endDate underneath it would stop production silently.
  if (rule.isPerpetual) return true;

  const end = toLocalDay(rule.endDate);
  if (end !== null && day > end) return false;

  // Bounded neither way and not perpetual: a weekly pattern with no horizon.
  // Runs, because the weekdays were chosen deliberately.
  return true;
}

/**
 * Every day in [from, to] on which the rule applies.
 *
 * Bounded so a perpetual rule cannot be asked to enumerate for ever — the caller
 * always has a window in mind, and a range with no end is a caller bug.
 */
export function occurrencesBetween(rule: ScheduleRuleLike, from: Date, to: Date): Date[] {
  const out: Date[] = [];
  if (to < from) return out;

  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  // A guard rather than a limit anyone should reach: two years of daily steps.
  let guard = 0;
  while (cursor <= last && guard++ < 800) {
    if (appliesOn(rule, cursor)) out.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Human summary for the UI and for audit trails. */
export function describeRule(rule: ScheduleRuleLike): string {
  const oneOff = toLocalDay(rule.oneOffDate);
  if (oneOff !== null) {
    const s = String(oneOff);
    return `Once on ${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  }

  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = weekdaysOf(rule);
  if (days.length === 0) return 'No days selected — never runs';

  const which = days.length === 7 ? 'Every day' : days.map((d) => names[d]).join(', ');
  if (rule.isPerpetual) return `${which}, indefinitely`;

  const fmt = (v: Date | string | null) => {
    const n = toLocalDay(v);
    if (n === null) return null;
    const s = String(n);
    return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  };
  const from = fmt(rule.startDate);
  const to = fmt(rule.endDate);
  if (from && to) return `${which}, ${from} → ${to}`;
  if (from) return `${which}, from ${from}`;
  if (to) return `${which}, until ${to}`;
  return which;
}
