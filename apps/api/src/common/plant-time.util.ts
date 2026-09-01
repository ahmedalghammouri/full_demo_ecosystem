/**
 * Plant-local time helpers for server-side bucketing and labelling.
 *
 * Instants are stored and compared in UTC — that never changes. What these
 * helpers fix is the *labelling* step: deciding which calendar day, hour or week
 * an instant belongs to. That question only has a meaningful answer in the
 * plant's own timezone.
 *
 * `toISOString().slice(0, 10)` answers it in UTC, which for a +03 plant pushes
 * everything after 21:00 local into the next day and pulls a 00:00 shift into
 * the previous one — so a night shift's output lands on two different dates and
 * a "today" query silently spans the wrong 24 hours.
 *
 * The API container sets TZ=Asia/Riyadh (see docker-compose + the tzdata package
 * in the Dockerfile), so `PLANT_TZ` defaults to the process zone; pass an
 * explicit IANA zone when a request is scoped to a factory in another one.
 *
 * Frontend counterpart: apps/web/src/lib/datetime.ts
 */

export const DEFAULT_PLANT_TZ =
  process.env.TZ && process.env.TZ !== 'UTC' ? process.env.TZ : 'Asia/Riyadh';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of `date` as seen in `timeZone`. */
export function plantParts(date: Date, timeZone: string = DEFAULT_PLANT_TZ) {
  const p = partsFormatter(timeZone).formatToParts(date);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return {
    year: get('year'), month: get('month'), day: get('day'),
    hour: get('hour') % 24, minute: get('minute'),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-08-01` — the plant-local calendar day an instant falls in. */
export function plantDayKey(date: Date, timeZone?: string): string {
  const p = plantParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** `2026-08-01T14` — the plant-local hour bucket. */
export function plantHourKey(date: Date, timeZone?: string): string {
  const p = plantParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}`;
}

/**
 * `2026-07-27` — the Monday of the plant-local ISO week.
 *
 * Derived from the plant-local date rather than the UTC one, so a Sunday-evening
 * reading is not filed under the previous week.
 */
export function plantWeekKey(date: Date, timeZone?: string): string {
  const p = plantParts(date, timeZone);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // ISO week starts Monday
  return d.toISOString().slice(0, 10);
}

/**
 * A plant-local wall clock → the absolute instant it denotes.
 *
 * `ShiftTemplate.startTime` is a bare `"07:30"` meaning 07:30 **at the plant**.
 * Building it with `Date.UTC(y, m, d, 7, 30)` stores 07:30 UTC — which for a +03
 * plant is 10:30 local, so every shift boundary, and every break/cleaning event
 * generated from it, lands 3 hours late.
 *
 * The second pass re-resolves the offset at the candidate instant so the result
 * stays correct across a DST transition (Riyadh has none; other plants may).
 *
 * @param day       calendar day — its plant-local Y/M/D are used
 * @param hhmm      `"HH:mm"` in plant-local time
 * @param dayOffset days to add (for shifts that cross midnight)
 */
export function plantWallClockToUtc(
  day: Date,
  hhmm: string,
  dayOffset = 0,
  timeZone: string = DEFAULT_PLANT_TZ,
): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const p = plantParts(day, timeZone);
  const wall = Date.UTC(p.year, p.month - 1, p.day + dayOffset, h || 0, m || 0, 0, 0);
  const offsetAt = (t: number) => {
    const q = plantParts(new Date(t), timeZone);
    return Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, 0) - Math.floor(t / 60_000) * 60_000;
  };
  let ts = wall - offsetAt(wall);
  ts = wall - offsetAt(ts);
  return new Date(ts);
}

/**
 * Resolve a `YYYY-MM-DD` filter pair into an analysis window.
 *
 * ── The bug this exists to stop repeating ───────────────────────────────────
 * `new Date('2026-08-09')` parses as midnight **UTC**. The web builds these
 * strings from LOCAL calendar components on purpose — its own comment warns that
 * `toISOString` shifts local midnight into the previous day. At a +03 plant the
 * two conventions are three hours apart, so between local midnight and 03:00 a
 * "Today" window began in the FUTURE and every KPI on the page read 0.0% while
 * "Shift" and "Week" looked perfectly healthy.
 *
 * It was fixed one call site at a time and reappeared in the next one. This is
 * the single definition; call it instead of parsing dates by hand.
 *
 *  • `dateFrom` → local start of that day
 *  • `dateTo`   → local END of that day, so a single-day range is not zero-width
 *  • the upper bound never runs past NOW — a KPI cannot cover hours that have
 *    not happened, and charging planned time for them collapses Availability
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A bound the caller wrote, as an instant — or null when it wrote nothing usable.
 *
 * A bare `YYYY-MM-DD` keeps its day-edge meaning. Anything longer is read as a
 * plant-local wall clock, which is what a caller asking for 14:00–15:00 means;
 * appending the day-edge suffix to it produced `...T14:00:00T23:59:59.999`, an
 * Invalid Date that reached Postgres and returned a 500 rather than a complaint.
 */
export function plantBound(raw: string | undefined, edge: 'start' | 'end'): Date | null {
  if (!raw) return null;
  const text = DATE_ONLY.test(raw)
    ? `${raw}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`
    : raw;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The same idea, but anchored to UTC.
 *
 * ── Why both exist ──────────────────────────────────────────────────────────
 * Most date filters mean a PLANT-LOCAL day and use `plantBound`. A few — shift
 * instance generation, the scheduling horizon — were written against UTC on
 * purpose, with an explicit `Z`. Re-pointing those at plant time would silently
 * move every one of their windows by the plant's offset, which for Riyadh is
 * three hours: a shift generated for "the 21st" would start on the 20th.
 *
 * So this preserves their meaning exactly and fixes only the defect they share
 * with every other copy — appending a day edge to a string that already carries
 * a time, which yields `...T19:00:00T23:59:59.999Z`, an Invalid Date, and a 500
 * from whatever it reaches.
 */
export function utcBound(raw: string | undefined | null, edge: 'start' | 'end'): Date | null {
  if (!raw) return null;
  const text = DATE_ONLY.test(raw)
    ? `${raw}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}Z`
    : raw;
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveLocalRange(
  dateFrom?: string,
  dateTo?: string,
  defaultDays = 7,
  now: Date = new Date(),
): { from: Date; to: Date; slotTo: Date } {
  const rawTo = plantBound(dateTo, 'end') ?? now;
  const to = rawTo > now ? now : rawTo;
  const from = plantBound(dateFrom, 'start')
    ?? new Date(to.getTime() - defaultDays * 86_400_000);
  /**
   * The end of the requested PERIOD, before the clamp.
   *
   * `to` never runs past now, because planned production time must not accrue
   * for hours that have not happened. The schedule basis needs the opposite
   * bound: the part of a committed slot an order has not reached yet is what
   * makes that reading climb from low to true as the period runs.
   *
   * It was already computed here and thrown away, so every caller that needed
   * it re-derived it — and the re-derivations disagreed. Guessing it as "the
   * end of the plant day containing `to`" is right for a whole-day window and
   * wrong for a SHIFT: a request for 19:30 → 02:00 got a slot ending at 23:59
   * the following night, and the dashboards read OEE 6.0% / A 17.1% where
   * /oee-schedule read 28.3% / 80.9% for the same request.
   */
  return { from, to, slotTo: rawTo };
}
