import { balanceMinute } from './counter.service';

/**
 * The counting governor, measured against what this line actually did.
 *
 * ── The two failures, which look nothing alike ──────────────────────────────
 * Taken from `oee_minutes` on 30 Aug 2026, across every order in the database:
 *
 *   machine  ceiling/min   avg counting min   peak minute   minutes impossible
 *   M1          46.3           38.8               2,986          23%
 *   M2          43.1           38.3               9,424          21%
 *   M3          39.6          176.7  (4.5x)       2,720          99%
 *   M4          78.2          326.0  (4.2x)       3,200         100%
 *
 * M1 and M2 run BELOW their ceiling on an average minute and then produce a
 * single minute holding 9,424 pieces -- three and a half hours of production
 * booked into sixty seconds. That is a backlog paid out in the wrong place.
 *
 * M3 and M4 never burst like that. They simply run at four times design speed,
 * all day, in essentially every counting minute.
 *
 * ── Why one cap could not catch both ────────────────────────────────────────
 * The per-minute cap is floored at one whole unit, and that floor has to be
 * there: a palletiser rated 0.28/min really does put one whole pallet into one
 * minute, and trimming that to 0.28 of a pallet would shave real output off
 * every slow machine in the plant.
 *
 * But a machine that can honestly make 1 in a minute cannot honestly make 1 in
 * EVERY minute, and that is exactly the hole M3 and M4 went through -- each of
 * their impossible minutes held about one unit and passed the per-minute cap
 * unchallenged.
 *
 * So there are two caps and the tighter wins. These tests hold both, and hold
 * the floor that makes the slow-machine case safe.
 */

/** The governor's arithmetic, extracted so it can be exercised without a DB. */
const DEFAULT_TOLERANCE_FRACTION = 0.25;
const WINDOW_MINUTES = 15;

function roomLeft(
  designPerMin: number | null,
  emittedThisMinute: number,
  emittedInWindow: number,
  tol?: number | null,
): number {
  if (designPerMin === null) return -1;
  if (tol === null) return -1;
  const tolerance = typeof tol === 'number' ? tol : designPerMin * DEFAULT_TOLERANCE_FRACTION;
  const cap = Math.max(1, designPerMin + tolerance);
  const roomThisMinute = Math.max(0, cap - emittedThisMinute);
  const windowCap = Math.max(1, (designPerMin + tolerance) * WINDOW_MINUTES);
  const roomInWindow = Math.max(0, windowCap - emittedInWindow);
  return Math.min(roomThisMinute, roomInWindow);
}

describe('the cap is ON without anyone configuring it', () => {
  /**
   * The whole reason the plant was unprotected. `machineLimits` has never
   * existed in gateway-config.json, so `tolerancePerMin` was always undefined,
   * and the gate read that as "no cap stated" and stood down -- on every
   * machine, on every deployment, for the life of the system.
   */
  it('caps a machine with NO configuration at all', () => {
    // M1: design 46.3/min. Nothing configured.
    expect(roomLeft(46.3, 0, 0)).toBeCloseTo(57.9, 1); // 46.3 x 1.25
  });

  it('still lets the plant switch it off deliberately', () => {
    // An explicit null is a decision, and is obeyed. -1 means "no cap".
    expect(roomLeft(46.3, 0, 0, null)).toBe(-1);
  });

  it('still obeys a tolerance the plant states', () => {
    expect(roomLeft(46.3, 0, 0, 2)).toBeCloseTo(48.3, 1);
  });

  it('cannot cap what it cannot measure', () => {
    // No ideal cycle time on the job order means no ceiling. A limit invented
    // here would be a guess, and a guess that trims production is worse than
    // no limit at all.
    expect(roomLeft(null, 0, 0)).toBe(-1);
  });
});

describe('the burst: M1 and M2', () => {
  it("trims M2's 9,424-piece minute to something a machine can make", () => {
    // The real minute, against the real ceiling.
    const room = roomLeft(43.1, 0, 0);
    const bal = balanceMinute(9424, 0, room);

    expect(bal.good).toBeCloseTo(53.9, 1);     // 43.1 x 1.25
    expect(bal.trimmedGood).toBeCloseTo(9370.1, 1);
    // 219x the ceiling is not a fast minute. It is three and a half hours of
    // production arriving at once.
    expect(9424 / 43.1).toBeGreaterThan(200);
  });

  it("trims M1's 2,986-piece minute the same way", () => {
    const bal = balanceMinute(2986, 0, roomLeft(46.3, 0, 0));
    expect(bal.good).toBeCloseTo(57.9, 1);
  });

  it('leaves an ordinary M1 minute completely alone', () => {
    // 38.8 was M1's AVERAGE counting minute. The cap must be invisible there,
    // or it is trimming production rather than catching a fault.
    const bal = balanceMinute(38.8, 0, roomLeft(46.3, 0, 0));
    expect(bal.trimmedGood).toBe(0);
    expect(bal.good).toBe(38.8);
  });

  it('takes rejects before good, when it has to take anything', () => {
    // A trim is a statement that the count is wrong. Scrap is the safer thing
    // to doubt: under-reporting good output is a smaller lie than inventing it.
    const bal = balanceMinute(40, 30, roomLeft(46.3, 0, 0));
    expect(bal.trimmedBad).toBeGreaterThan(0);
    expect(bal.trimmedGood).toBe(0);
    expect(bal.good).toBe(40);
  });
});

describe('the slow machine: the floor that must not move', () => {
  it('lets a palletiser put one whole pallet into one minute', () => {
    // M4 is rated 0.28 pallets a minute -- one every three and a half. The
    // minute a pallet actually lands reads 1, and 1 > 0.28. Without the floor
    // the cap would trim it to 0.28 OF A PALLET, a number describing nothing.
    const bal = balanceMinute(1, 0, roomLeft(0.28, 0, 0));
    expect(bal.trimmedGood).toBe(0);
    expect(bal.good).toBe(1);
  });

  it('does not let it put one pallet into EVERY minute', () => {
    // The hole the floor leaves, and the reason the window cap exists.
    // Fourteen minutes at one pallet each, then a fifteenth offered.
    const windowCap = Math.max(1, 0.28 * 1.25 * WINDOW_MINUTES); // 5.25
    const bal = balanceMinute(1, 0, roomLeft(0.28, 0, 14));

    expect(windowCap).toBeCloseTo(5.25, 2);
    // Fourteen already booked is far past 5.25, so there is no room left.
    expect(bal.good).toBe(0);
    expect(bal.trimmedGood).toBe(1);
  });

  it("holds M4's real sustained rate to something possible", () => {
    // M4 ran at 1.04 pallets a minute for hours. Over a 15-minute window that
    // is 15.6 pallets where 5.25 is the generous ceiling.
    const offered = 15.6;
    const room = roomLeft(0.28, 0, 0);
    // The window is empty, so the first minute is capped by the MINUTE rule
    // (floored at 1), not the window -- the window bites from the second
    // minute on. Both together is what holds the hour.
    expect(room).toBe(1);
    expect(balanceMinute(offered, 0, room).good).toBe(1);
  });

  it('lets a slow machine catch up honestly after a stop', () => {
    // Fifteen empty minutes, then a pallet. The window is clear, so nothing
    // is trimmed -- a cap that punished restarting would be worse than none.
    expect(balanceMinute(1, 0, roomLeft(0.28, 0, 0)).trimmedGood).toBe(0);
  });
});

describe('the tighter of the two always wins', () => {
  it('uses the minute cap when the window is clear', () => {
    expect(roomLeft(40, 0, 0)).toBe(50);           // 40 x 1.25
  });

  it('uses the window cap when the window is nearly spent', () => {
    // 15 x 50 = 750 window cap; 740 already booked leaves 10, which is
    // tighter than the 50 the minute alone would have allowed.
    expect(roomLeft(40, 0, 740)).toBe(10);
  });

  it('gives no room at all once the window is exhausted', () => {
    expect(roomLeft(40, 0, 750)).toBe(0);
    expect(balanceMinute(500, 0, 0).good).toBe(0);
  });

  it('never returns a negative room, which would read as "no cap"', () => {
    // -1 is the sentinel for "uncapped". An arithmetic underflow that produced
    // -1 here would silently disable the governor at the worst moment.
    expect(roomLeft(40, 999, 999)).toBe(0);
    expect(roomLeft(40, 999, 999)).not.toBe(-1);
  });
});
