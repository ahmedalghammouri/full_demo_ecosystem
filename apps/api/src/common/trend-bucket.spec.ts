import { Prisma } from '@prisma/client';

import { TREND_BUCKETS, isTrendBucket, truncPlant, truncPlantExpr, defaultTrendBucket } from './trend-bucket.util';

/**
 * Which units a trend may be read at, and whose midnight a bucket starts on.
 *
 * ── The bug the timezone half exists to stop ────────────────────────────────
 * `bucketStart` is stored UTC, and `date_trunc('day', ts)` cuts on UTC
 * midnight. In Riyadh that is 03:00 local, so a "day" bucket really ran
 * 03:00 → 03:00 and the first three hours of every plant day were filed under
 * the day before.
 *
 * Nobody noticed, because the default granularity was HOURS — and an hour is an
 * hour in every zone. The fault only surfaces once the unit is a day or larger,
 * which is exactly what adding week and month does. Measured against the live
 * database: the earliest minute, 2026-08-23 08:26 UTC, truncated to
 * 2026-08-23 00:00 UTC under the old expression — 03:00 in the plant — and to
 * 2026-08-22 21:00 UTC under the new one, which IS plant midnight.
 */
describe('trend buckets', () => {
  const sqlOf = (s: Prisma.Sql) => s.strings.join('?');

  it('offers exactly the four units the engines can group by', () => {
    // Not an open string. The value reaches date_trunc, and anything
    // unrecognised either errors at the database or is silently accepted as a
    // unit nobody meant.
    expect([...TREND_BUCKETS]).toEqual(['hour', 'day', 'week', 'month']);
  });

  it('accepts only those four', () => {
    for (const b of TREND_BUCKETS) expect(isTrendBucket(b)).toBe(true);
    for (const bad of ['minute', 'year', 'quarter', 'DAY', '', null, undefined, 7]) {
      expect(isTrendBucket(bad)).toBe(false);
    }
  });

  it('truncates in PLANT time, not UTC', () => {
    // The pair reads the stored value as UTC and re-expresses it as plant
    // wall-clock before cutting, then converts back to an instant. Without both
    // halves the boundary lands three hours out.
    const sql = sqlOf(truncPlant('day'));
    expect(sql).toContain('date_trunc');
    expect(sql).toContain("AT TIME ZONE 'UTC' AT TIME ZONE");
    // Converted back, so callers still receive an instant rather than a naive
    // local timestamp that the driver would then read in ITS zone.
    expect(sql.trimEnd().endsWith(')')).toBe(true);
  });

  it('binds the unit as a parameter rather than splicing it', () => {
    // The unit comes from a request. Interpolating it into the SQL text would
    // be an injection point; binding it means a value off the list above or an
    // error, never arbitrary SQL.
    const s = truncPlant('week');
    expect(s.values).toContain('week');
    expect(sqlOf(s)).not.toContain('week');
  });

  it('applies the same rule to an expression as to a column', () => {
    // The schedule engine buckets a generated series rather than a column, so
    // it needs the rule as a function of an expression. One definition in two
    // shapes — not two definitions that can drift apart.
    const a = sqlOf(truncPlant('month'));
    const b = sqlOf(truncPlantExpr('month', Prisma.sql`gs.t`));
    expect(a.replace(/o\."bucketStart"/, 'X')).toBe(b.replace(/gs\.t/, 'X'));
  });

  it('names the column it truncates, and only from this module', () => {
    // The column is a compile-time literal supplied by the engines; the unit
    // and zone are bound. That split is what keeps `Prisma.raw` safe here.
    expect(sqlOf(truncPlant('hour'))).toContain('o."bucketStart"');
    expect(sqlOf(truncPlant('day', 'x."at"'))).toContain('x."at"');
  });

  describe('defaultTrendBucket', () => {
    const days = (n: number) => n * 86_400_000;

    // A shift or a couple of days still wants an hour — anything coarser
    // flattens the one shape a short window has.
    it('picks hour for a window of two days or less', () => {
      expect(defaultTrendBucket(days(0))).toBe('hour');
      expect(defaultTrendBucket(days(1))).toBe('hour');
      expect(defaultTrendBucket(days(2))).toBe('hour');
    });

    // A week through a couple of months — the "Month" preset's own window —
    // wants a day per point: a shift-run plant's ~700 hourly points collapse
    // to ~30, and the reading is a day's average rather than a shift's noise.
    it('picks day for a window from just over two days through two months', () => {
      expect(defaultTrendBucket(days(2) + 1)).toBe('day');
      expect(defaultTrendBucket(days(14))).toBe('day');
      expect(defaultTrendBucket(days(62))).toBe('day');
    });

    it('picks week beyond two months, where a day is still too fine a grain', () => {
      expect(defaultTrendBucket(days(62) + 1)).toBe('week');
      expect(defaultTrendBucket(days(365))).toBe('week');
    });
  });
});
