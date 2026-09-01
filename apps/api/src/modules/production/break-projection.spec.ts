import { projectBreaks, type ShiftShape, type BreakItem } from './planned-stop-plan';
import { merge, spanMinutes } from '../oee-standard/minute-classification';

/**
 * The planned stoppage a work order will meet before it has met it.
 *
 * ── The report from the floor ───────────────────────────────────────────────
 * Shift 1 is configured with two 30-minute stops — cleaning at 07:30 and
 * startup at 08:00 — and the Auto-Generate Work Order dialog offered a finish
 * time built on "Planned stoppage +0m". The reason is structural: a break
 * becomes a `downtimeEvent` when its shift STARTS, so an order scheduled for
 * tomorrow looks out on a calendar with no breaks in it at all.
 *
 * ── The trap this file exists to guard ──────────────────────────────────────
 * An earlier estimate averaged break minutes across templates and ADDED the
 * guess to the real events. Where a break had already been booked, the same
 * minutes were counted twice and the finish time drifted later the better the
 * plant had configured itself. It was deleted for that.
 *
 * So the last block here is the important one: it puts a projection and its own
 * materialised event through the same merge the service uses, and pins that the
 * hour is counted ONCE. Without it this fix is the old bug wearing a new name.
 */

const brk = (
  id: string, label: string, startTime: string, durationMin: number, sequence: number,
): BreakItem => ({ id, label, startTime, durationMin, sequence, affectsOEE: false });

/** Line 1's real configuration, as the screenshot shows it. */
const SHIFT1: ShiftShape = {
  startTime: '07:30',
  shiftDurationHours: 12,
  breaks: [
    brk('b1', 'SHIFT Cleaning', '07:30', 30, 1),
    brk('b2', 'SHIFT Startup', '08:00', 30, 2),
  ],
};

const at = (iso: string) => new Date(iso).getTime();
const minutes = (spans: Array<[number, number]>) => Math.round(spanMinutes(merge(spans as never)));

describe('breaks are projected before they are booked', () => {
  it('finds the hour Shift 1 stops for, on a day nothing has booked yet', () => {
    // The plant's exact case: a work order starting 07:30 tomorrow.
    const from = at('2026-08-27T07:30:00');
    const to = at('2026-08-27T16:15:00');
    expect(minutes(projectBreaks([SHIFT1], from, to))).toBe(60);
  });

  it('places them at the right clock times, not just the right total', () => {
    const from = at('2026-08-27T00:00:00');
    const to = at('2026-08-27T23:59:00');
    const spans = projectBreaks([SHIFT1], from, to)
      .sort((a, b) => a[0] - b[0])
      .map(([s, e]) => [new Date(s).getHours() * 60 + new Date(s).getMinutes(),
                        Math.round((e - s) / 60_000)]);
    expect(spans).toEqual([[7 * 60 + 30, 30], [8 * 60, 30]]);
  });

  it('counts a break only for the part inside the window', () => {
    // A window opening at 07:45 meets half of the cleaning stop, not all of it.
    const from = at('2026-08-27T07:45:00');
    const to = at('2026-08-27T12:00:00');
    expect(minutes(projectBreaks([SHIFT1], from, to))).toBe(45);
  });

  it('repeats them for every day the window spans', () => {
    const from = at('2026-08-27T00:00:00');
    const to = at('2026-08-30T00:00:00');
    expect(minutes(projectBreaks([SHIFT1], from, to))).toBe(180); // three days
  });

  it('finds a shift that started YESTERDAY and is still running', () => {
    // A night shift's small-hours break belongs to a window opening at 02:00.
    const night: ShiftShape = {
      startTime: '19:30', shiftDurationHours: 12,
      breaks: [brk('n1', 'Night Break', '01:00', 45, 1)],
    };
    const from = at('2026-08-27T00:30:00');
    const to = at('2026-08-27T06:00:00');
    expect(minutes(projectBreaks([night], from, to))).toBe(45);
  });

  it('ignores a break configured outside its own shift', () => {
    // layBreaks refuses to move it, and a stop nobody asked for must not appear
    // in an estimate either.
    const bad: ShiftShape = {
      startTime: '07:30', shiftDurationHours: 12,
      breaks: [brk('x', 'Misconfigured', '23:00', 30, 1)],
    };
    expect(projectBreaks([bad], at('2026-08-27T00:00:00'), at('2026-08-28T00:00:00'))).toEqual([]);
  });

  it('returns nothing rather than guessing when there is nothing to go on', () => {
    expect(projectBreaks([], at('2026-08-27T00:00:00'), at('2026-08-28T00:00:00'))).toEqual([]);
    expect(projectBreaks([{ ...SHIFT1, breaks: [] }], at('2026-08-27T00:00:00'), at('2026-08-28T00:00:00'))).toEqual([]);
    expect(projectBreaks([{ ...SHIFT1, shiftDurationHours: 0 }], at('2026-08-27T00:00:00'), at('2026-08-28T00:00:00'))).toEqual([]);
  });

  it('returns nothing for an inverted or empty window', () => {
    expect(projectBreaks([SHIFT1], at('2026-08-28T00:00:00'), at('2026-08-27T00:00:00'))).toEqual([]);
  });
});

describe('a booked break and its projection are the same hour, counted once', () => {
  /**
   * This is the regression that deleted the previous implementation. The
   * service merges projected spans and event spans together; these drive that
   * same merge directly.
   */
  const from = at('2026-08-27T07:30:00');
  const to = at('2026-08-27T16:15:00');

  it('does not double count when the break has already become an event', () => {
    const projected = projectBreaks([SHIFT1], from, to);
    // The materialiser has booked both stops for real, at the same clock times.
    const booked: Array<[number, number]> = [
      [at('2026-08-27T07:30:00'), at('2026-08-27T08:00:00')],
      [at('2026-08-27T08:00:00'), at('2026-08-27T08:30:00')],
    ];
    expect(minutes([...projected, ...booked])).toBe(60);   // not 120
  });

  it('does not multiply a line-wide stop by the machines it was booked against', () => {
    // The routing's four steps run together, so one line stop is four rows at
    // identical times. The merge is what keeps that one hour.
    const projected = projectBreaks([SHIFT1], from, to);
    const perMachine: Array<[number, number]> = [];
    for (let i = 0; i < 4; i++) {
      perMachine.push([at('2026-08-27T07:30:00'), at('2026-08-27T08:30:00')]);
    }
    expect(minutes([...projected, ...perMachine])).toBe(60); // not 240, not 300
  });

  it('still adds a real stop that does NOT overlap any break', () => {
    // Union must not become "ignore the events". An unplanned-but-planned stop
    // at 10:00 is an hour the order really loses.
    const projected = projectBreaks([SHIFT1], from, to);
    const changeover: Array<[number, number]> = [
      [at('2026-08-27T10:00:00'), at('2026-08-27T11:00:00')],
    ];
    expect(minutes([...projected, ...changeover])).toBe(120);
  });
});
