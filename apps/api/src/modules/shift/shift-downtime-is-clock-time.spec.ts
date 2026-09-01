import { merge, spanMinutes, type Span } from '../oee-standard/minute-classification';

/**
 * A shift's downtime is clock time, not machine-hours.
 *
 * ── What the plant saw ──────────────────────────────────────────────────────
 * The Command Center reported 46h 28m of downtime in a shift 11h 38m old. Four
 * machines times the elapsed time, to the minute:
 *
 *     4 x 11h 37m = 46h 28m
 *
 * `totalDownMins += mins` added every event on every machine. Downtime is
 * recorded PER MACHINE, so one line-wide stop is four rows at identical times,
 * and the sum multiplies a stop by however many machines the line has -- the
 * figure gets worse the bigger the line, which is precisely backwards.
 *
 * A duration longer than the shift that contains it is not a duration. That is
 * the whole test, and everything below is a way of saying it.
 */

const at = (h: number, m = 0) => Date.UTC(2026, 7, 28, h, m) as number;
const mins = (spans: Span[]) => Math.round(spanMinutes(merge(spans)));
const summed = (spans: Span[]) => Math.round(spans.reduce((n, [a, b]) => n + (b - a) / 60_000, 0));

describe('one line-wide stop is one stop', () => {
  it('counts a stop booked against four machines ONCE', () => {
    // The plant's own case: an hour's stop, recorded per machine.
    const line: Span[] = [
      [at(10), at(11)], [at(10), at(11)], [at(10), at(11)], [at(10), at(11)],
    ];
    expect(summed(line)).toBe(240);   // what it used to report
    expect(mins(line)).toBe(60);      // what the line actually lost
  });

  it('reproduces the 46h 28m exactly, and removes it', () => {
    // Four machines down for the whole 11h 37m elapsed.
    const elapsed: Span[] = Array.from({ length: 4 }, () => [at(0), at(11, 37)] as Span);
    expect(summed(elapsed)).toBe(11 * 60 + 37 + 3 * (11 * 60 + 37)); // 2788 = 46h28m
    expect(mins(elapsed)).toBe(11 * 60 + 37);                        // 697 = 11h37m
  });

  it('gets WORSE with more machines under the old rule, and not under the new one', () => {
    // The tell: a figure that grows with the size of the line is not measuring
    // the line. Eight machines, same single stop.
    const eight: Span[] = Array.from({ length: 8 }, () => [at(10), at(11)] as Span);
    expect(summed(eight)).toBe(480);
    expect(mins(eight)).toBe(60);
  });
});

describe('stops that do NOT overlap still both count', () => {
  it('adds two separate stops in full', () => {
    // Union must not become "ignore the second one". M1 down 10-10:30 and M2
    // down 11-11:30 is an hour the line lost.
    expect(mins([[at(10), at(10, 30)], [at(11), at(11, 30)]])).toBe(60);
  });

  it('merges a partial overlap without losing the tails', () => {
    // 10:00-11:00 and 10:30-12:00 is two hours of clock, not two and a half.
    expect(mins([[at(10), at(11)], [at(10, 30), at(12)]])).toBe(120);
  });

  it('is never longer than the window it describes', () => {
    // The invariant the whole defect broke. Whatever the events say, the line
    // cannot lose more time than has passed.
    const shiftStart = at(0);
    const now = at(11, 37);
    const chaos: Span[] = [];
    for (let i = 0; i < 40; i++) {
      const a = shiftStart + i * 7 * 60_000;
      chaos.push([a, Math.min(a + 90 * 60_000, now)]);
    }
    expect(mins(chaos)).toBeLessThanOrEqual((now - shiftStart) / 60_000);
  });
});

describe('planned and unplanned are each their own union', () => {
  /**
   * `unplanned = total - planned` looks obvious and is wrong once the totals
   * are unions: a minute can be a planned stop on one machine and a breakdown
   * on another, so the two overlap and their sum can exceed the total.
   */
  it('does not lose an unplanned stop hidden under a planned one', () => {
    const planned: Span[] = [[at(10), at(11)]];             // cleaning, whole line
    const unplanned: Span[] = [[at(10, 15), at(10, 45)]];   // M1 broke down inside it

    const total = mins([...planned, ...unplanned]);
    expect(total).toBe(60);
    expect(mins(planned)).toBe(60);
    expect(mins(unplanned)).toBe(30);

    // The subtraction would have reported zero unplanned downtime during a
    // breakdown -- the one thing a maintenance team needs to see.
    expect(total - mins(planned)).toBe(0);
    expect(mins(unplanned)).toBe(30);
  });
});
