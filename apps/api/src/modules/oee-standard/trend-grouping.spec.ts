import { isTrendBucket, defaultTrendBucket, type TrendBucket } from '../../common/trend-bucket.util';

/**
 * What the trend endpoint groups by, and what it TELLS the page it grouped by.
 *
 * ── The bug this exists to stop ─────────────────────────────────────────────
 * The page used to label its axis from the bucket it had REQUESTED. That is a
 * different value from the one the server grouped by, in three ways at once:
 * "auto" is not a bucket at all, `granularity` only ever accepted hour|day so
 * a request for week or month was silently downgraded, and neither fact was
 * reported back. The visible result was a chart of two DAY buckets with
 * "23 Aug 06:00" on the axis — a clock time under a point covering a whole
 * day, which reads as a sample taken at 06:00 rather than as that day's
 * average.
 *
 * So the contract is: the server resolves the grouping, and the response
 * carries the resolved value. The page renders what it is told.
 */

/** The controllers' resolution rule, kept here as the one executable statement of it. */
function resolveGrouping(
  requested: string | undefined,
  windowMs: number,
): TrendBucket {
  return isTrendBucket(requested) ? requested : defaultTrendBucket(windowMs);
}

const DAY = 86_400_000;

describe('trend grouping is resolved by the server and reported back', () => {
  it('honours every bucket the engines can group by, not just hour and day', () => {
    // `granularity` accepted hour|day and coerced everything else to hour, so
    // asking a month-wide window for month buckets returned ~700 hourly points.
    for (const b of ['hour', 'day', 'week', 'month'] as const) {
      expect(resolveGrouping(b, 30 * DAY)).toBe(b);
    }
  });

  it('resolves an absent or non-bucket request from the window width', () => {
    // "auto" is the page's word for "you decide" — it must never reach
    // date_trunc, and must not silently mean "hour".
    expect(resolveGrouping(undefined, 1 * DAY)).toBe('hour');
    expect(resolveGrouping('auto', 30 * DAY)).toBe('day');
    expect(resolveGrouping('', 200 * DAY)).toBe('week');
    expect(resolveGrouping('fortnight', 30 * DAY)).toBe('day');
  });

  it('never resolves a month-wide window to hourly points', () => {
    // The complaint that started this: a month rendered as ~720 hourly points
    // has no shape a reader can hold, and most of those hours are unmeasured.
    const g = resolveGrouping(undefined, 30 * DAY);
    expect(g).not.toBe('hour');
    expect(['day', 'week']).toContain(g);
  });

  it('always resolves to something a page can label — never undefined', () => {
    // The page labels its axis from this value. An absent one sent it back to
    // guessing, which is the whole defect.
    for (const ms of [0, 1, DAY, 7 * DAY, 62 * DAY, 400 * DAY]) {
      expect(isTrendBucket(resolveGrouping(undefined, ms))).toBe(true);
    }
  });
});
