import { layStops, shiftStartsBetween, projectBreaks } from './planned-stop-plan';
import type { StopPlanItem, ShiftShape, BreakItem } from './planned-stop-plan';
import { merge, spanMinutes } from '../oee-standard/minute-classification';

/**
 * The stops an ORDER carries, in its finish estimate.
 *
 * ── The second half of the same defect ──────────────────────────────────────
 * Shift breaks were missing from the estimate because they become downtime
 * events only when their shift starts. An order's own stop plan — the 45-minute
 * "WO Change Over" configured on the production order — has exactly the same
 * shape: it is booked from the order's ACTUAL start, so an order that has not
 * begun has none of it on the calendar and the estimate reads zero.
 *
 * Fixing one and not the other left the plant looking at "+1h 0m" that covered
 * the shift and silently dropped the changeover.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * The order's stops lay back to back from the start of the estimate window,
 * because that window IS the order's start: the preview asks "if it began here,
 * when would it finish". They go into the same merge as everything else, so a
 * stop already booked as an event counts once.
 */
const stop = (
  id: string, label: string, durationMin: number, sequence: number,
  recurrence: StopPlanItem['recurrence'] = 'ONCE',
): StopPlanItem => ({
  id, label, kind: 'CHANGEOVER', durationMin, sequence, recurrence, affectsOEE: true,
} as StopPlanItem);

const at = (iso: string) => new Date(iso).getTime();
const mins = (spans: Array<[number, number]>) => Math.round(spanMinutes(merge(spans as never)));

/** Line 1's shifts, as configured. */
const SHIFTS: ShiftShape[] = [
  {
    startTime: '07:30',
    shiftDurationHours: 12,
    breaks: [
      { id: 'b1', label: 'SHIFT Cleaning', startTime: '07:30', durationMin: 30, sequence: 1, affectsOEE: false } as BreakItem,
      { id: 'b2', label: 'SHIFT Startup', startTime: '08:00', durationMin: 30, sequence: 2, affectsOEE: false } as BreakItem,
    ],
  },
  { startTime: '19:30', shiftDurationHours: 12, breaks: [] },
];

/** What the service does: lay the order's stops from the window start. */
function orderSpans(plan: StopPlanItem[], fromMs: number, toMs: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const st of layStops(plan, new Date(fromMs), 'FIRST_START')) {
    const a = Math.max(+st.from, fromMs);
    const b = Math.min(+st.to, toMs);
    if (b > a) out.push([a, b]);
  }
  for (const [shiftStart] of shiftStartsBetween(SHIFTS, fromMs, toMs)) {
    if (shiftStart <= fromMs) continue;
    for (const st of layStops(plan, new Date(shiftStart), 'SHIFT_CHANGE')) {
      const a = Math.max(+st.from, fromMs);
      const b = Math.min(+st.to, toMs);
      if (b > a) out.push([a, b]);
    }
  }
  return out;
}

describe("an order's own stops reach the estimate", () => {
  const from = at('2026-08-27T11:30:00');
  const to = at('2026-08-27T15:30:00');

  it('finds the 45-minute changeover the plant configured', () => {
    expect(mins(orderSpans([stop('s1', 'WO Change Over', 45, 1)], from, to))).toBe(45);
  });

  it('lays several stops BACK TO BACK, the way a line does them', () => {
    // Clean, bring to speed, change over: 30 + 15 + 45 with no gaps invented.
    const plan = [stop('a', 'Cleaning', 30, 1), stop('b', 'Startup', 15, 2), stop('c', 'Change Over', 45, 3)];
    const spans = orderSpans(plan, from, to).sort((x, y) => x[0] - y[0]);
    expect(mins(spans)).toBe(90);
    // Contiguous, so the merge leaves exactly one block from the order's start.
    expect(merge(spans as never)).toHaveLength(1);
    expect(spans[0][0]).toBe(from);
  });

  it('repeats a per-shift stop at the next handover, and a ONCE stop not at all', () => {
    const once = [stop('o', 'Change Over', 45, 1, 'ONCE')];
    const each = [stop('e', 'Change Over', 45, 1, 'PER_SHIFT')];
    // A window crossing 19:30 sees the evening handover.
    const long = [at('2026-08-27T11:30:00'), at('2026-08-27T23:00:00')] as const;
    expect(mins(orderSpans(once, long[0], long[1]))).toBe(45);
    expect(mins(orderSpans(each, long[0], long[1]))).toBe(90);
  });

  it('counts only the part of a stop inside the window', () => {
    // A three-hour cleaning on a two-hour window is two hours of this estimate.
    const short = at('2026-08-27T13:30:00');
    expect(mins(orderSpans([stop('s', 'Long clean', 180, 1)], from, short))).toBe(120);
  });

  it('adds nothing when the order has no stop plan', () => {
    expect(orderSpans([], from, to)).toEqual([]);
  });
});

describe('order stops and shift breaks are one union, not two sums', () => {
  it('adds both when they do not overlap', () => {
    // Order starts 11:30, changeover 11:30-12:15. Shift breaks are 07:30-08:30,
    // outside this window entirely, so a window from 07:30 sees all of it.
    const from = at('2026-08-27T07:30:00');
    const to = at('2026-08-27T15:30:00');
    const breaks = projectBreaks(SHIFTS, from, to) as Array<[number, number]>;
    const order = orderSpans([stop('s', 'Change Over', 45, 1)], from, to);
    // The changeover lays from 07:30 and so sits INSIDE the 07:30-08:30 breaks.
    expect(mins([...breaks, ...order])).toBe(60);
  });

  it('does not double count a changeover that lands on a break', () => {
    // Both start at 07:30. Union keeps the hour; a sum would report 105 minutes
    // of stoppage for 60 minutes of stopped line.
    const from = at('2026-08-27T07:30:00');
    const to = at('2026-08-27T15:30:00');
    const breaks = projectBreaks(SHIFTS, from, to) as Array<[number, number]>;
    const order = orderSpans([stop('s', 'Change Over', 45, 1)], from, to);
    const summed = [...breaks, ...order].reduce((n, [a, b]) => n + (b - a) / 60_000, 0);
    expect(summed).toBe(105);              // what a sum would have said
    expect(mins([...breaks, ...order])).toBe(60); // what the line actually loses
  });

  it('adds an order stop that falls clear of every break', () => {
    // Union must not become "ignore the order". Starting at 11:30 the shift
    // breaks are long gone, and the changeover is 45 real minutes.
    const from = at('2026-08-27T11:30:00');
    const to = at('2026-08-27T15:30:00');
    const breaks = projectBreaks(SHIFTS, from, to) as Array<[number, number]>;
    expect(breaks).toEqual([]);
    expect(mins([...breaks, ...orderSpans([stop('s', 'Change Over', 45, 1)], from, to)])).toBe(45);
  });
});

describe('shiftStartsBetween', () => {
  it('finds handovers strictly after the window opens', () => {
    const found = shiftStartsBetween(SHIFTS, at('2026-08-27T11:30:00'), at('2026-08-28T09:00:00'))
      .map(([t]) => new Date(t).toTimeString().slice(0, 5));
    expect(found).toEqual(['19:30', '07:30']);
  });

  it('does not report the shift the window opens inside', () => {
    // Otherwise a per-shift stop would be booked twice at the order's start.
    expect(shiftStartsBetween(SHIFTS, at('2026-08-27T07:30:00'), at('2026-08-27T12:00:00'))).toEqual([]);
  });

  it('returns nothing for an inverted window or no templates', () => {
    expect(shiftStartsBetween(SHIFTS, at('2026-08-28T00:00:00'), at('2026-08-27T00:00:00'))).toEqual([]);
    expect(shiftStartsBetween([], at('2026-08-27T00:00:00'), at('2026-08-28T00:00:00'))).toEqual([]);
  });
});
