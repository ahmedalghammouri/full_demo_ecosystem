import { splitStoppedTime, type StopInterval } from './stopped-time.util';

/**
 * Splitting stopped time — the arithmetic that has to survive a real downtime log.
 *
 * Written after the rebuilt fact store failed its own identity: M1 reported
 * PPT − run = 1,500 minutes against downMin = 1,625. The cause was in the data,
 * not the formula — duplicated events and minutes carrying a planned and an
 * unplanned stop at once — but a formula that only works on clean data is not
 * finished, and the discrepancy is exactly the kind of unreconcilable number this
 * whole project has been chasing out of the system.
 */
describe('splitStoppedTime', () => {
  const T0 = new Date('2026-08-01T00:00:00Z').getTime();
  const at = (min: number) => new Date(T0 + min * 60_000);
  const window = { from: T0, to: T0 + 60 * 60_000 }; // 60 minutes

  const ev = (
    startMin: number, endMin: number | null,
    kind: 'planned' | 'external' | 'unplanned',
  ): StopInterval => ({
    startTime: at(startMin),
    endTime: endMin === null ? null : at(endMin),
    isPlanned: kind === 'planned',
    affectsOEE: kind === 'unplanned',
  });

  const split = (events: StopInterval[]) =>
    splitStoppedTime(events, window.from, window.to, window.to);

  it('splits the three kinds when they do not touch', () => {
    const r = split([ev(0, 10, 'planned'), ev(20, 25, 'external'), ev(40, 55, 'unplanned')]);
    expect(r.plannedMin).toBe(10);
    expect(r.externalMin).toBe(5);
    expect(r.downMin).toBe(15);
  });

  it('counts a duplicated event ONCE', () => {
    // Exactly what the seeded log contains: same machine, same start, same end,
    // two rows. Summing durations reported twice the real stop.
    const r = split([ev(0, 30, 'unplanned'), ev(0, 30, 'unplanned')]);
    expect(r.downMin).toBe(30);
  });

  it('merges partially overlapping stops of the same kind', () => {
    const r = split([ev(0, 20, 'unplanned'), ev(10, 30, 'unplanned')]);
    expect(r.downMin).toBe(30);
  });

  it('merges stops that touch end-to-start without inventing a gap', () => {
    const r = split([ev(0, 10, 'unplanned'), ev(10, 20, 'unplanned')]);
    expect(r.downMin).toBe(20);
  });

  it('gives a minute claimed by both planned and unplanned to PLANNED', () => {
    // A deliberate human decision about that time outranks an auto-opened stop.
    const r = split([ev(0, 30, 'planned'), ev(0, 30, 'unplanned')]);
    expect(r.plannedMin).toBe(30);
    expect(r.downMin).toBe(0);
  });

  it('gives a minute claimed by both external and unplanned to EXTERNAL', () => {
    // A machine that cannot be fed is not breaking down.
    const r = split([ev(0, 30, 'external'), ev(0, 30, 'unplanned')]);
    expect(r.externalMin).toBe(30);
    expect(r.downMin).toBe(0);
  });

  it('charges only the part of an unplanned stop that no other kind claimed', () => {
    const r = split([ev(0, 20, 'planned'), ev(10, 40, 'unplanned')]);
    expect(r.plannedMin).toBe(20);
    expect(r.downMin).toBe(20); // 20→40 only
  });

  it('never lets the three kinds exceed the window — the identity that broke', () => {
    // Four overlapping stops of every kind across a 60-minute window.
    const r = split([
      ev(0, 60, 'planned'), ev(0, 60, 'planned'),
      ev(0, 60, 'external'),
      ev(0, 60, 'unplanned'), ev(30, 90, 'unplanned'),
    ]);
    expect(r.plannedMin + r.externalMin + r.downMin).toBeLessThanOrEqual(60);
    expect(r.plannedMin).toBe(60);
  });

  it('clips to the window on both sides', () => {
    const r = split([ev(-30, 10, 'unplanned'), ev(50, 120, 'unplanned')]);
    expect(r.downMin).toBe(20); // 0→10 and 50→60
  });

  it('treats an open event as running to the supplied end', () => {
    const r = splitStoppedTime([ev(45, null, 'unplanned')], window.from, window.to, T0 + 50 * 60_000);
    expect(r.downMin).toBe(5);
  });

  it('returns zeroes for an empty or inverted window rather than a negative', () => {
    expect(split([])).toEqual({ plannedMin: 0, externalMin: 0, downMin: 0 });
    expect(splitStoppedTime([ev(0, 10, 'unplanned')], window.to, window.from, window.to))
      .toEqual({ plannedMin: 0, externalMin: 0, downMin: 0 });
  });
});
