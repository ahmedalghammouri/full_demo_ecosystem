import { StateTimelineService } from './state-timeline.service';

/**
 * The plan track draws what an ORDER was planned for — nothing else.
 *
 * ── Two wrong answers before this one ───────────────────────────────────────
 * First it filled every gap in the requested WINDOW with scheduled production.
 * That was right on this plant by accident — SDPF runs two twelve-hour
 * templates that tile the day — and would have shown a single-shift plant
 * sixteen hours of green it never scheduled.
 *
 * So it was bounded by the shift calendar instead. Better, and still wrong: on
 * a 24-hour plant that paints the whole week green and claims the line was
 * expected to produce continuously. Measured on 19–26 Aug 2026, that basis drew
 * 10,440 minutes of "planned production" per machine. The work orders account
 * for 1,244 — the plant scheduled about twenty hours of production that week,
 * and the band was asserting seven days of it.
 *
 * Production is scheduled by an ORDER. Where one is planned, the plant intended
 * to produce; where none is, it intended nothing, and the band stays blank so
 * "we had no plan for this time" and "we planned to run and did not" stop
 * looking identical.
 *
 * The shift calendar has not gone away — it still bounds the OEE denominator.
 * It simply is not a production schedule, and the difference is the whole
 * subject of this file.
 */

type Stop = {
  machineId: string; reason: string; category: string; affectsOEE: boolean;
  startTime: Date; endTime: Date | null; machine: { code: string };
};
type Jo = {
  machineId: string | null; plannedStart: Date | null; plannedEnd: Date | null;
  actualStart: Date | null; actualEnd: Date | null;
};

const at = (h: number, m = 0) => new Date(2026, 7, 25, h, m);

const stop = (fromH: number, toH: number, reason = 'Cleaning', charged = false): Stop => ({
  machineId: 'M', reason, category: 'PLANNED', affectsOEE: charged,
  startTime: at(fromH), endTime: at(toH), machine: { code: 'M1' },
});

const order = (fromH: number, toH: number, machineId = 'M'): Jo => ({
  machineId, plannedStart: at(fromH), plannedEnd: at(toH), actualStart: null, actualEnd: null,
});

const svc = (events: Stop[], jos: Jo[]) => new StateTimelineService({
  downtimeEvent: { findMany: jest.fn().mockResolvedValue(events) },
  jobOrder: { findMany: jest.fn().mockResolvedValue(jos) },
  shiftTemplate: { findMany: jest.fn().mockResolvedValue([]) },
} as any);

const DAY_FROM = new Date(2026, 7, 25, 0, 0);
const DAY_TO = new Date(2026, 7, 26, 0, 0);

const run = (events: Stop[], jos: Jo[]) =>
  svc(events, jos).plannedSegments('F', DAY_FROM, DAY_TO, {});

const minutesOf = (segs: Array<{ state: string; minutes: number }>, state: string) =>
  segs.filter((s) => s.state === state).reduce((a, s) => a + s.minutes, 0);

describe('the plan track follows the work orders', () => {
  it('draws production only where an order was planned', async () => {
    // One eight-hour order in a twenty-four hour window.
    const segs = await run([], [order(8, 16)]);
    expect(minutesOf(segs, 'PRODUCTION')).toBe(8 * 60);
  });

  it('leaves the rest of the day blank rather than green', async () => {
    // The correction. The other sixteen hours were not scheduled for anything,
    // and saying so is the point — a gap is an absence of intention, not an
    // absence of data.
    const segs = await run([], [order(8, 16)]);
    expect(minutesOf(segs, 'PRODUCTION') + minutesOf(segs, 'PLANNED_STOP')).toBe(8 * 60);
  });

  it('takes a booked stop out of the planned window', async () => {
    const segs = await run([stop(12, 13, 'Lunch Break')], [order(8, 16)]);
    expect(minutesOf(segs, 'PRODUCTION')).toBe(7 * 60);
    expect(minutesOf(segs, 'PLANNED_STOP')).toBe(60);
  });

  it('draws nothing at all for a machine with no order', async () => {
    // Not an empty track with a "no data" caption — genuinely nothing, because
    // the plant scheduled nothing.
    expect(await run([], [])).toEqual([]);
  });

  it('still draws a stop booked on a machine with no order', async () => {
    // Somebody entered it. Hiding it here would make this chart disagree with
    // the screen it was typed into.
    const segs = await run([stop(2, 3, 'Maintenance')], []);
    expect(minutesOf(segs, 'PLANNED_STOP')).toBe(60);
    expect(minutesOf(segs, 'PRODUCTION')).toBe(0);
  });

  it('keeps each machine to its OWN order window', async () => {
    // Two machines on one line can carry different steps of different orders —
    // the palletiser's window is not the filler's.
    const segs = await svc([], [order(8, 16, 'M'), order(10, 12, 'M2')])
      .plannedSegments('F', DAY_FROM, DAY_TO, {});
    const byMachine = new Map<string, number>();
    for (const s of segs.filter((x) => x.state === 'PRODUCTION')) {
      byMachine.set(s.machineId, (byMachine.get(s.machineId) ?? 0) + s.minutes);
    }
    expect(byMachine.get('M')).toBe(8 * 60);
    expect(byMachine.get('M2')).toBe(2 * 60);
  });

  it('counts overlapping orders on one machine once', async () => {
    // Two orders booked over the same hours must not draw two hours of intent
    // for one hour of clock — the same union rule the rest of the system uses.
    const segs = await run([], [order(8, 16), order(12, 20)]);
    expect(minutesOf(segs, 'PRODUCTION')).toBe(12 * 60);
  });

  it('clips an order that starts before the window', async () => {
    const segs = await svc([], [{
      machineId: 'M', plannedStart: new Date(2026, 7, 24, 20), plannedEnd: at(4),
      actualStart: null, actualEnd: null,
    }]).plannedSegments('F', DAY_FROM, DAY_TO, {});
    expect(minutesOf(segs, 'PRODUCTION')).toBe(4 * 60);
  });

  it('ignores a step with no planned window rather than guessing one', async () => {
    // Reading its ACTUAL times instead would turn what happened into what was
    // planned — the exact conflation the two bands exist to keep apart.
    const segs = await run([], [{
      machineId: 'M', plannedStart: null, plannedEnd: null,
      actualStart: at(8), actualEnd: at(16),
    }]);
    expect(minutesOf(segs, 'PRODUCTION')).toBe(0);
  });

  it('does not extend the plan to cover an overrun', async () => {
    // An order planned 08:00–16:00 that actually ran to 20:00 was still only
    // PLANNED for eight hours. The overrun belongs to the state track below.
    const segs = await run([], [{
      machineId: 'M', plannedStart: at(8), plannedEnd: at(16),
      actualStart: at(8), actualEnd: at(20),
    }]);
    expect(minutesOf(segs, 'PRODUCTION')).toBe(8 * 60);
  });

  it('names each booked block and marks the charged ones', async () => {
    const segs = await run(
      [stop(8, 9, 'Startup', true), stop(12, 13, 'Lunch Break', false)],
      [order(8, 16)],
    );
    expect(segs.find((s) => s.label === 'Startup')?.kind).toBe('downtime');
    expect(segs.find((s) => s.label === 'Lunch Break')?.kind).toBe('planned');
  });
});
