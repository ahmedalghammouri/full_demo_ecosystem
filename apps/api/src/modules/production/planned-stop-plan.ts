/**
 * Laying a plan's stops onto a clock.
 *
 * ── Why this is a pure function ─────────────────────────────────────────────
 * Deciding WHEN a plan's stops fall, and WHETHER this occurrence has already
 * had them, is the whole of both features. Everything else — reading the plan,
 * writing the events — is plumbing. Keeping the decision here means it can be
 * tested against a clock the test controls, rather than by starting an order and
 * waiting.
 *
 * The plant typed these in by hand on 25 August. Getting the recurrence wrong in
 * either direction is worse than that: too eager and a shift's cleaning is
 * booked four times, too shy and the OEE denominator silently loses an hour.
 */

export type StopRecurrence = 'ONCE' | 'PER_SHIFT' | 'PER_RESTART';

export interface StopPlanItem {
  id: string;
  label: string;
  kind: string;
  durationMin: number;
  sequence: number;
  recurrence: StopRecurrence;
  affectsOEE: boolean;
}

export interface LaidStop {
  planId: string;
  label: string;
  kind: string;
  affectsOEE: boolean;
  from: Date;
  to: Date;
}

/**
 * Why an occurrence is starting — which decides which stops belong to it.
 *
 *   FIRST_START   the order's very first actual start
 *   SHIFT_CHANGE  a new shift began while the order was running
 *   RESTART       the order was resumed after a pause
 */
export type Trigger = 'FIRST_START' | 'SHIFT_CHANGE' | 'RESTART';

/** Which recurrences a given trigger brings with it. */
export function appliesTo(recurrence: StopRecurrence, trigger: Trigger): boolean {
  switch (recurrence) {
    // ONCE means once for the ORDER, so only its first start — a resumed order
    // does not clean the line again, and neither does a shift handover.
    case 'ONCE': return trigger === 'FIRST_START';
    // A per-shift stop happens on the first start too: that start IS the first
    // shift the order runs in. Leaving it out would book the shift-two cleaning
    // and skip the shift-one cleaning, which is nobody's intention.
    case 'PER_SHIFT': return trigger === 'FIRST_START' || trigger === 'SHIFT_CHANGE';
    // Likewise a per-restart stop: starting is a restart from nothing.
    case 'PER_RESTART': return trigger === 'FIRST_START' || trigger === 'RESTART';
    default: return false;
  }
}

/**
 * Lay a plan's stops end to end from a starting instant.
 *
 * Back to back, in sequence order, because that is how a line actually does
 * them: you clean, then you bring it to speed, then you change over. Gaps
 * between them would be minutes the plan claims for nothing.
 *
 * From the ACTUAL start, never the planned one. The order that ran late on
 * 25 August is the case that matters: its cleaning belongs where the cleaning
 * happened, not where somebody hoped it would.
 */
export function layStops(
  plan: StopPlanItem[], startAt: Date, trigger: Trigger,
): LaidStop[] {
  const due = plan
    .filter((p) => p.durationMin > 0 && appliesTo(p.recurrence, trigger))
    .sort((a, b) => a.sequence - b.sequence);

  const out: LaidStop[] = [];
  let cursor = startAt.getTime();
  for (const p of due) {
    const from = new Date(cursor);
    cursor += p.durationMin * 60_000;
    out.push({
      planId: p.id,
      label: p.label,
      kind: p.kind,
      affectsOEE: p.affectsOEE,
      from,
      to: new Date(cursor),
    });
  }
  return out;
}

/**
 * The marker that makes creation idempotent.
 *
 * Written into the event's notes, because `downtime_events` has no column for
 * "which plan, which occurrence" and inventing one would need a migration for a
 * string. It carries the plan id and the occurrence key, so a second attempt at
 * the same occurrence finds the event already there and does nothing.
 *
 * Without this, every tick of the scheduler books another cleaning window. The
 * plant already spent a day undoing 150 units entered once by mistake; a stop
 * booked every minute would be far worse and far harder to see.
 */
export function stopMarker(planId: string, occurrenceKey: string): string {
  return `[auto-stop ${planId} @ ${occurrenceKey}]`;
}

/**
 * The key that identifies ONE occurrence of a recurring stop.
 *
 * A per-shift stop recurs once per shift occurrence, so the shift's own start
 * instant names it. A per-restart stop recurs once per resume, so the resume
 * instant names it. ONCE needs no discriminator beyond the order itself.
 *
 * Minute precision deliberately: two ticks a few seconds apart are the same
 * occurrence, and a key to the millisecond would let a retry book a duplicate.
 */
export function occurrenceKey(trigger: Trigger, at: Date): string {
  if (trigger === 'FIRST_START') return 'first';
  const iso = new Date(Math.floor(at.getTime() / 60_000) * 60_000).toISOString();
  return `${trigger === 'SHIFT_CHANGE' ? 'shift' : 'restart'}:${iso.slice(0, 16)}`;
}

// ── Shift breaks ────────────────────────────────────────────────────────────

export interface BreakItem {
  id: string;
  label: string;
  /** HH:mm, plant-local. */
  startTime: string;
  durationMin: number;
  sequence: number;
  affectsOEE: boolean;
}

/**
 * Place a shift's breaks on one occurrence of that shift.
 *
 * The break's time is a clock time inside the shift, so it is resolved against
 * the occurrence's own start rather than against midnight — otherwise a break at
 * 02:00 on a night shift that began at 19:30 would land seventeen hours early,
 * on the wrong side of the shift entirely.
 *
 * A break whose time falls outside the shift is REPORTED, not clamped: it is a
 * configuration mistake, and silently moving it to the nearest legal minute
 * would hide the mistake and produce a stop nobody asked for.
 */
export function layBreaks(
  breaks: BreakItem[], shiftStart: Date, shiftLengthMin: number,
): { laid: LaidStop[]; outside: BreakItem[] } {
  const laid: LaidStop[] = [];
  const outside: BreakItem[] = [];

  const startMin = shiftStart.getHours() * 60 + shiftStart.getMinutes();

  for (const b of [...breaks].sort((a, c) => a.sequence - c.sequence)) {
    if (b.durationMin <= 0) continue;
    const [h, m] = b.startTime.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) { outside.push(b); continue; }

    // Minutes from the shift's own start, wrapping past midnight so an overnight
    // shift's small-hours break lands in the right occurrence.
    let offset = (h * 60 + (m || 0)) - startMin;
    if (offset < 0) offset += 24 * 60;

    if (offset + b.durationMin > shiftLengthMin) { outside.push(b); continue; }

    const from = new Date(shiftStart.getTime() + offset * 60_000);
    laid.push({
      planId: b.id,
      label: b.label,
      kind: 'BREAK',
      affectsOEE: b.affectsOEE,
      from,
      to: new Date(from.getTime() + b.durationMin * 60_000),
    });
  }
  return { laid, outside };
}

// ── Projecting a shift's breaks into the future ─────────────────────────────

/** A shift template, reduced to what break placement needs. */
export interface ShiftShape {
  /** HH:mm, plant-local. */
  startTime: string;
  shiftDurationHours: number;
  breaks: BreakItem[];
}

/** Half-open interval in epoch milliseconds. */
export type BreakSpan = [number, number];

/**
 * Every occurrence of every shift break that falls inside [fromMs, toMs].
 *
 * ── Why this has to exist ───────────────────────────────────────────────────
 * Shift breaks become real `downtimeEvent` rows only when their shift STARTS.
 * A work order being scheduled for tomorrow therefore looks out on a calendar
 * with no breaks in it at all, and its finish estimate reads "+0m planned
 * stoppage" for a plant that stops for an hour every morning. The plant sees
 * a finish time it cannot hit and no explanation on the screen.
 *
 * ── The double count this is NOT ────────────────────────────────────────────
 * An earlier version of the estimate averaged break minutes across templates,
 * multiplied by a guessed number of shifts, and ADDED the result to the real
 * events. Wherever a break had already been materialised, the same minutes were
 * counted twice, and the estimate got worse the better the plant had configured
 * itself. It was removed for that.
 *
 * This returns SPANS with real clock times, not a total. The caller merges them
 * with the event spans, so a break that has already become an event overlaps its
 * own projection and counts once. Union, not sum — which is the same reason the
 * events themselves are merged across machines.
 */
export function projectBreaks(
  templates: ShiftShape[], fromMs: number, toMs: number,
): BreakSpan[] {
  if (toMs <= fromMs || templates.length === 0) return [];

  const out: BreakSpan[] = [];
  const DAY = 86_400_000;

  // Start a day early: a shift that began yesterday evening can still be
  // running now, and its breaks belong to this window.
  const first = new Date(fromMs - DAY);
  first.setHours(0, 0, 0, 0);

  for (let day = first.getTime(); day <= toMs; day += DAY) {
    for (const tpl of templates) {
      const [h, m] = String(tpl.startTime ?? '').split(':').map(Number);
      if (!Number.isFinite(h)) continue;

      // Built from a local date rather than by adding milliseconds, so a day
      // that is not 24 hours long still starts the shift at the stated clock.
      const d = new Date(day);
      const shiftStart = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0, 0, 0);

      const lengthMin = Math.round((tpl.shiftDurationHours || 0) * 60);
      if (lengthMin <= 0) continue;

      const { laid } = layBreaks(tpl.breaks ?? [], shiftStart, lengthMin);
      for (const b of laid) {
        const s = Math.max(+b.from, fromMs);
        const e = Math.min(+b.to, toMs);
        if (e > s) out.push([s, e]);
      }
    }
  }
  return out;
}

/**
 * Every shift start strictly inside (fromMs, toMs], with the template it began.
 *
 * A per-shift stop recurs at each handover the order lives through, so an
 * estimate spanning two shifts has to know where the second one begins. Shares
 * the day-walk with `projectBreaks` deliberately: two ways of working out when a
 * shift starts is two answers waiting to disagree.
 */
export function shiftStartsBetween(
  templates: ShiftShape[], fromMs: number, toMs: number,
): Array<[number, ShiftShape]> {
  if (toMs <= fromMs || templates.length === 0) return [];

  const out: Array<[number, ShiftShape]> = [];
  const DAY = 86_400_000;
  const first = new Date(fromMs - DAY);
  first.setHours(0, 0, 0, 0);

  for (let day = first.getTime(); day <= toMs; day += DAY) {
    for (const tpl of templates) {
      const [h, m] = String(tpl.startTime ?? '').split(':').map(Number);
      if (!Number.isFinite(h)) continue;
      const d = new Date(day);
      const t = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m || 0, 0, 0).getTime();
      if (t > fromMs && t <= toMs) out.push([t, tpl]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}
