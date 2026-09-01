import {
  appliesTo, layStops, layBreaks, occurrenceKey, stopMarker,
  type StopPlanItem, type BreakItem,
} from './planned-stop-plan';

/**
 * Laying a plan's stops onto a clock.
 *
 * ── What is at stake in each direction ──────────────────────────────────────
 * The plant typed these stops in by hand on 25 August, four machines at a time.
 * Automating that is worth doing — and getting the recurrence wrong is worse
 * than the typing: too eager and one shift's cleaning is booked four times, too
 * shy and the OEE denominator quietly loses an hour nobody can find.
 *
 * So both directions are pinned here, and so is the idempotency marker: without
 * it every tick of the scheduler books another cleaning window, which is a
 * far larger version of the 150 units that cost a day to undo.
 */

const at = (h: number, m = 0) => new Date(2026, 7, 26, h, m);

const item = (over: Partial<StopPlanItem> = {}): StopPlanItem => ({
  id: 'p1', label: 'Cleaning', kind: 'CLEANING', durationMin: 30,
  sequence: 0, recurrence: 'ONCE', affectsOEE: false, ...over,
});

describe('which stops belong to which trigger', () => {
  it('books a ONCE stop only at the order’s first start', () => {
    expect(appliesTo('ONCE', 'FIRST_START')).toBe(true);
    // A resumed order does not clean the line again, and neither does a
    // handover. This is the difference between one cleaning and four.
    expect(appliesTo('ONCE', 'RESTART')).toBe(false);
    expect(appliesTo('ONCE', 'SHIFT_CHANGE')).toBe(false);
  });

  it('books a PER_SHIFT stop at the first start AND at each handover', () => {
    // The first start IS the first shift the order runs in. Leaving it out
    // would book shift two's cleaning and skip shift one's.
    expect(appliesTo('PER_SHIFT', 'FIRST_START')).toBe(true);
    expect(appliesTo('PER_SHIFT', 'SHIFT_CHANGE')).toBe(true);
    expect(appliesTo('PER_SHIFT', 'RESTART')).toBe(false);
  });

  it('books a PER_RESTART stop at the first start AND at each resume', () => {
    // Starting is a restart from nothing.
    expect(appliesTo('PER_RESTART', 'FIRST_START')).toBe(true);
    expect(appliesTo('PER_RESTART', 'RESTART')).toBe(true);
    expect(appliesTo('PER_RESTART', 'SHIFT_CHANGE')).toBe(false);
  });

  it('covers the 25 August scenario end to end', () => {
    // Started late, stopped, resumed tomorrow on a new shift. Cleaning is
    // per-shift, startup per-restart, changeover once.
    const plan = [
      item({ id: 'c', label: 'Cleaning', recurrence: 'PER_SHIFT' }),
      item({ id: 's', label: 'Startup', recurrence: 'PER_RESTART' }),
      item({ id: 'x', label: 'Change Over', recurrence: 'ONCE' }),
    ];
    const labels = (t: Parameters<typeof layStops>[2]) =>
      layStops(plan, at(8), t).map((s) => s.label);

    expect(labels('FIRST_START')).toEqual(['Cleaning', 'Startup', 'Change Over']);
    expect(labels('SHIFT_CHANGE')).toEqual(['Cleaning']);
    expect(labels('RESTART')).toEqual(['Startup']);
  });
});

describe('laying the stops on the clock', () => {
  it('runs them back to back in sequence order', () => {
    // A gap between them would be minutes the plan claims for nothing.
    const laid = layStops([
      item({ id: 'b', label: 'Startup', durationMin: 20, sequence: 2 }),
      item({ id: 'a', label: 'Cleaning', durationMin: 30, sequence: 1 }),
    ], at(8), 'FIRST_START');

    expect(laid.map((s) => s.label)).toEqual(['Cleaning', 'Startup']);
    expect(laid[0].from).toEqual(at(8));
    expect(laid[0].to).toEqual(at(8, 30));
    expect(laid[1].from).toEqual(at(8, 30));
    expect(laid[1].to).toEqual(at(8, 50));
  });

  it('starts from the ACTUAL start, not the planned one', () => {
    // The order that ran two hours late on 25 August. Its cleaning belongs
    // where the cleaning happened, not where somebody hoped it would.
    const laid = layStops([item()], at(10, 15), 'FIRST_START');
    expect(laid[0].from).toEqual(at(10, 15));
  });

  it('skips a stop with no duration rather than booking a zero-length event', () => {
    expect(layStops([item({ durationMin: 0 })], at(8), 'FIRST_START')).toEqual([]);
  });

  it('carries whether each stop costs the reading', () => {
    // A changeover charges the denominator; a meal break leaves it. Losing this
    // on the way through would move a real loss out of OEE.
    const laid = layStops([
      item({ id: 'c', label: 'Cleaning', affectsOEE: false }),
      item({ id: 'x', label: 'Change Over', affectsOEE: true, sequence: 1 }),
    ], at(8), 'FIRST_START');
    expect(laid.find((s) => s.label === 'Cleaning')!.affectsOEE).toBe(false);
    expect(laid.find((s) => s.label === 'Change Over')!.affectsOEE).toBe(true);
  });

  it('returns nothing for an empty plan', () => {
    expect(layStops([], at(8), 'FIRST_START')).toEqual([]);
  });
});

describe('the idempotency marker', () => {
  it('names the plan and the occurrence together', () => {
    const m = stopMarker('p1', 'first');
    expect(m).toContain('p1');
    expect(m).toContain('first');
  });

  it('gives one key per occurrence, not per attempt', () => {
    // Two ticks seconds apart are the same occurrence. A key to the millisecond
    // would let a retry book a duplicate cleaning window.
    const a = occurrenceKey('SHIFT_CHANGE', new Date(2026, 7, 26, 7, 30, 5));
    const b = occurrenceKey('SHIFT_CHANGE', new Date(2026, 7, 26, 7, 30, 55));
    expect(a).toBe(b);
  });

  it('separates two different shift occurrences', () => {
    const a = occurrenceKey('SHIFT_CHANGE', new Date(2026, 7, 26, 7, 30));
    const b = occurrenceKey('SHIFT_CHANGE', new Date(2026, 7, 26, 19, 30));
    expect(a).not.toBe(b);
  });

  it('separates a restart from a shift change at the same instant', () => {
    const when = new Date(2026, 7, 26, 7, 30);
    expect(occurrenceKey('RESTART', when)).not.toBe(occurrenceKey('SHIFT_CHANGE', when));
  });

  it('gives a first start one key however often it is asked', () => {
    expect(occurrenceKey('FIRST_START', at(8))).toBe(occurrenceKey('FIRST_START', at(20)));
  });
});

// ── Shift breaks ────────────────────────────────────────────────────────────

const brk = (over: Partial<BreakItem> = {}): BreakItem => ({
  id: 'b1', label: 'Tea', startTime: '10:00', durationMin: 20,
  sequence: 0, affectsOEE: false, ...over,
});

describe('placing a shift’s breaks', () => {
  const DAY_START = new Date(2026, 7, 26, 7, 30);   // Shift 1 — Day
  const NIGHT_START = new Date(2026, 7, 26, 19, 30); // Shift 2 — Night
  const TWELVE_H = 12 * 60;

  it('places a break at its clock time inside the shift', () => {
    const { laid, outside } = layBreaks([brk()], DAY_START, TWELVE_H);
    expect(outside).toEqual([]);
    expect(laid[0].from).toEqual(new Date(2026, 7, 26, 10, 0));
    expect(laid[0].to).toEqual(new Date(2026, 7, 26, 10, 20));
  });

  it('handles more than one break, which is the whole point', () => {
    // The template carried a single `breakMinutes` with no start time and could
    // not express "twenty minutes at ten and forty at one".
    const { laid } = layBreaks([
      brk({ id: 'a', label: 'Tea', startTime: '10:00', durationMin: 20, sequence: 0 }),
      brk({ id: 'b', label: 'Lunch', startTime: '13:00', durationMin: 40, sequence: 1 }),
    ], DAY_START, TWELVE_H);
    expect(laid.map((s) => s.label)).toEqual(['Tea', 'Lunch']);
    expect(laid[1].from).toEqual(new Date(2026, 7, 26, 13, 0));
  });

  it('carries a night shift’s small-hours break into the right occurrence', () => {
    // 02:00 on a shift that began at 19:30 is six and a half hours IN, not
    // seventeen and a half hours earlier on the wrong side of the shift.
    const { laid, outside } = layBreaks([brk({ startTime: '02:00' })], NIGHT_START, TWELVE_H);
    expect(outside).toEqual([]);
    expect(laid[0].from).toEqual(new Date(2026, 7, 27, 2, 0));
  });

  it('reports a break that falls outside its shift instead of moving it', () => {
    // A configuration mistake. Clamping it to the nearest legal minute would
    // hide the mistake and book a stop nobody asked for.
    const { laid, outside } = layBreaks([brk({ startTime: '21:00' })], DAY_START, TWELVE_H);
    expect(laid).toEqual([]);
    expect(outside.map((b) => b.startTime)).toEqual(['21:00']);
  });

  it('reports a break that would run past the end of the shift', () => {
    // Starts inside, finishes outside. Still wrong, and still worth saying.
    const { laid, outside } = layBreaks(
      [brk({ startTime: '19:00', durationMin: 60 })], DAY_START, TWELVE_H,
    );
    expect(laid).toEqual([]);
    expect(outside).toHaveLength(1);
  });

  it('reports a malformed time rather than guessing at it', () => {
    const { outside } = layBreaks([brk({ startTime: 'noon' })], DAY_START, TWELVE_H);
    expect(outside).toHaveLength(1);
  });

  it('skips a zero-length break silently — it books nothing either way', () => {
    const { laid, outside } = layBreaks([brk({ durationMin: 0 })], DAY_START, TWELVE_H);
    expect(laid).toEqual([]);
    expect(outside).toEqual([]);
  });

  it('accepts a break that ends exactly on the shift boundary', () => {
    const { laid, outside } = layBreaks(
      [brk({ startTime: '19:00', durationMin: 30 })], DAY_START, TWELVE_H,
    );
    expect(outside).toEqual([]);
    expect(laid).toHaveLength(1);
  });
});
