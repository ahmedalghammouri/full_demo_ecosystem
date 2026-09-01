import { Prisma } from '@prisma/client';

import { DEFAULT_PLANT_TZ } from './plant-time.util';

/**
 * Bucket sizes a trend can be read at.
 *
 * Not an open string: the value reaches `date_trunc` and anything unrecognised
 * would either error at the database or, worse, be accepted as a unit nobody
 * meant. The list is the contract.
 */
export const TREND_BUCKETS = ['hour', 'day', 'week', 'month'] as const;
export type TrendBucket = (typeof TREND_BUCKETS)[number];

export function isTrendBucket(v: unknown): v is TrendBucket {
  return typeof v === 'string' && (TREND_BUCKETS as readonly string[]).includes(v);
}

/**
 * The bucket size to use when the caller has not asked for one.
 *
 * Mirrors the thresholds the web app's own bucket-size menu narrows to per
 * period (`allowedBuckets` in `oee-analysis-view.tsx`) — the same reasoning
 * applied as a DEFAULT rather than a menu of choices: a month read hourly is
 * ~700 points with no shape a reader can hold, the same month read daily is
 * thirty.
 */
export function defaultTrendBucket(spanMs: number): TrendBucket {
  const days = spanMs / 86_400_000;
  if (days <= 2) return 'hour';
  if (days <= 62) return 'day';
  return 'week';
}

/**
 * Truncate a stored instant to a bucket, IN PLANT TIME.
 *
 * ── Why the timezone matters here and not obviously ─────────────────────────
 * `bucketStart` is UTC, and `date_trunc('day', ts)` cuts on UTC midnight. In
 * Riyadh that is 03:00 local, so a "day" was really 03:00 → 03:00 and the first
 * three hours of every plant day were filed under the day before. Nobody notices
 * on an hourly chart, because an hour is an hour in any zone — which is exactly
 * why it survived: the default granularity hid it.
 *
 * It becomes impossible to miss at week and month, where the boundary moves a
 * whole shift's output into the wrong period. So the conversion is done here,
 * once, rather than being added to each new unit as it is discovered.
 *
 * The `AT TIME ZONE 'UTC' AT TIME ZONE <plant>` pair is the same form
 * `kpi.service` already uses for its daily roll-up — it reads the stored value
 * as UTC and re-expresses it as plant wall-clock. The result is converted back
 * so callers still receive an instant.
 */
export function truncPlant(bucket: TrendBucket, column = 'o."bucketStart"'): Prisma.Sql {
  const tz = DEFAULT_PLANT_TZ;
  // The column name is a compile-time literal from this module's callers, never
  // user input; the unit and zone are bound as parameters.
  const col = Prisma.raw(column);
  return Prisma.sql`((date_trunc(${bucket}, ${col} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})) AT TIME ZONE ${tz})`;
}

/**
 * The same truncation, applied to an arbitrary SQL expression.
 *
 * The schedule engine builds its buckets from a generated series rather than
 * from a column, so it needs the rule as a function of an expression. One
 * definition, two shapes — not two definitions.
 */
export function truncPlantExpr(bucket: TrendBucket, expr: Prisma.Sql): Prisma.Sql {
  const tz = DEFAULT_PLANT_TZ;
  return Prisma.sql`((date_trunc(${bucket}, ${expr} AT TIME ZONE 'UTC' AT TIME ZONE ${tz})) AT TIME ZONE ${tz})`;
}
