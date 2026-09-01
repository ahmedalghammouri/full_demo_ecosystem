import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { truncPlantExpr, type TrendBucket } from '../../common/trend-bucket.util';

import { PrismaService } from '../../database/prisma.service';
import {
  computeSchedule, auditSchedule, EMPTY_SCHEDULE_TOTALS,
  type ScheduleTotals, type ScheduleResult,
} from './oee-schedule.calc';

export interface ScheduleScope {
  areaId?: string;
  machineId?: string;
  /**
   * A SET of machines — the line's outfeed points, or its bottleneck.
   *
   * Separate from `machineId` rather than replacing it: the two mean different
   * things to a reader of a call site, and collapsing "the machine I am looking
   * at" into "the machines that count for quality" is how a line-level rule
   * would silently start filtering the page.
   */
  machineIds?: string[];
  lineId?: string;
  jobOrderId?: string;
  workOrderId?: string;
  shiftTemplateId?: string;
  /**
   * The shift by its CODE, as the minute rows carry it.
   *
   * Separate from `shiftTemplateId`: nothing creates ShiftInstance rows on this
   * plant, so the writer derives a shift code per minute and that — not a
   * template id — is what the grouped views key on. Scoping by template would
   * silently match nothing for them.
   */
  shiftCode?: string;
  /** The product. Reached through the work order, which is where the SKU lives. */
  skuId?: string;
  /** The production order the work orders belong to. */
  productionOrderId?: string;
  /**
   * The production order by its NUMBER.
   *
   * The panel's PO picker has always carried the order number rather than its
   * id, and several pages read that store. Accepting both is cheaper and safer
   * than migrating every reader — and the number is unique, so it selects
   * exactly the same rows the id would.
   */
  productionOrderNumber?: string;
}

export interface ScheduleSlice extends ScheduleResult {
  key: string;
  label: string;
  sublabel?: string | null;
}

/**
 * Reads `oee_minutes` — the one store — and nothing else. The basis is a
 * DENOMINATOR over those minutes, not a second copy of them.
 *
 * ── Why every query goes through a per-job-order stage ───────────────────────
 * The committed slot is a property of a JOB ORDER, and it is stamped on every
 * one of that order's minutes. Summing it across rows would multiply an
 * eight-hour slot by however many minutes happen to be stored — so the slot is
 * collapsed per job order first (MIN of the start, MAX of the end), clipped to
 * the query window, and only then summed.
 *
 * The elapsed buckets sum normally, because those genuinely are per minute.
 * Mixing the two in one GROUP BY is the mistake this shape exists to prevent.
 *
 * ── Why the slot has its own upper bound ────────────────────────────────────
 * Minute rows only exist for time that has gone by, so clipping them at "now"
 * costs nothing. The slot is the opposite: its whole point is the part that has
 * NOT gone by, and clipping that at "now" deletes the term this engine exists to
 * report. A run whose slot ran an hour past the replay came back with 5.6
 * not-yet-reached minutes instead of 60 for exactly that reason.
 *
 * So `slotTo` is the end of the range the user ASKED for — end of the selected
 * day — while `to` stays capped at now for the rows. Ask for today and a slot
 * closing this evening is counted in full; ask for a narrow window and the slot
 * is still clipped to it.
 */
/**
 * How a trend divides time: how to snap an instant to the grid, and how wide one
 * step is.
 *
 * ── Why the size is emitted as SQL text, never bound ────────────────────────
 * Postgres cannot prove that two PARAMETERISED `date_trunc` calls are the same
 * expression, so grouping by one and reusing the other fails with 42803 — a
 * lesson this file already paid for. The same applies to an interval built from
 * a parameter. Every value below comes from a closed set validated in code, so
 * emitting it as text is not an injection surface; `bucketOf` is the only door
 * in, and it rejects anything not on the list.
 */
interface Bucket {
  trunc: (expr: Prisma.Sql) => Prisma.Sql;
  step: Prisma.Sql;
}

/** Minute sizes that divide an hour exactly, so buckets tile without a ragged one. */
const MINUTE_BUCKETS = [1, 2, 5, 10, 15, 20, 30] as const;

function bucketOf(spec: TrendBucket | number): Bucket {
  // Calendar units are truncated in PLANT time. `date_trunc` cuts on UTC
  // boundaries, and in Riyadh that puts a "day" at 03:00 local — invisible on an
  // hourly chart, and a whole shift in the wrong period once the unit is a week
  // or a month. See `truncPlant`.
  if (spec === 'day' || spec === 'week' || spec === 'month') {
    return {
      trunc: (e) => truncPlantExpr(spec, e),
      step: spec === 'day'
        ? Prisma.sql`interval '1 day'`
        : spec === 'week'
          ? Prisma.sql`interval '1 week'`
          : Prisma.sql`interval '1 month'`,
    };
  }
  if (spec === 'hour' || typeof spec !== 'number') {
    // An hour is an hour in every zone, so this one needs no conversion.
    return {
      trunc: (e) => Prisma.sql`date_trunc('hour', ${e})`,
      step: Prisma.sql`interval '1 hour'`,
    };
  }
  const n = Math.round(spec);
  if (n >= 60 || !MINUTE_BUCKETS.includes(n as (typeof MINUTE_BUCKETS)[number])) {
    return bucketOf('hour');
  }
  const raw = Prisma.raw(String(n)); // validated against the list above
  return {
    trunc: (e) => Prisma.sql`(date_trunc('hour', ${e})
      + ((EXTRACT(MINUTE FROM ${e})::int / ${raw}) * ${raw}) * INTERVAL '1 minute')`,
    // `${raw} * INTERVAL '1 minute'` rather than `interval '${raw} minutes'`:
    // interpolating into a quoted literal depends on how the builder splices
    // raw text, and a multiplication does not.
    step: Prisma.sql`(${raw} * INTERVAL '1 minute')`,
  };
}

@Injectable()
export class OeeScheduleService {
  constructor(private readonly prisma: PrismaService) {}

  private where(factoryId: string | null, from: Date, to: Date, scope: ScheduleScope): Prisma.Sql {
    const parts: Prisma.Sql[] = [
      Prisma.sql`o."bucketStart" >= ${from} AND o."bucketStart" < ${to}`,
      // ── Reads the unified store ──────────────────────────────────────────
      // This engine used to have a table of its own that was a copy of every
      // measured column plus the two slot columns. Both writers ran a cron a
      // minute apart over the same job orders, so the two stores could disagree
      // about a minute for no reason a reader could ever see.
      //
      // The slot lives on `oee_minutes` now, and the only thing this predicate
      // has to reproduce is the retired writer's one behavioural difference: it
      // returned early for a job order with no slot, so those minutes never
      // existed on this basis. They exist in the shared store, so they are
      // excluded here instead — same rows, same answer.
      Prisma.sql`o."committedFrom" IS NOT NULL AND o."committedTo" IS NOT NULL`,
    ];
    if (factoryId) parts.push(Prisma.sql`o."factoryId" = ${factoryId}`);
    if (scope.machineId) parts.push(Prisma.sql`o."machineId" = ${scope.machineId}`);
    // An EMPTY list is a real answer — "no machine qualifies" — and must select
    // nothing. `IN ()` is a syntax error, so it is written out as a false.
    if (scope.machineIds) {
      parts.push(scope.machineIds.length === 0
        ? Prisma.sql`FALSE`
        : Prisma.sql`o."machineId" IN (${Prisma.join(scope.machineIds)})`);
    }
    if (scope.jobOrderId) parts.push(Prisma.sql`o."jobOrderId" = ${scope.jobOrderId}`);
    if (scope.workOrderId) parts.push(Prisma.sql`o."workOrderId" = ${scope.workOrderId}`);
    if (scope.shiftTemplateId) parts.push(Prisma.sql`o."shiftTemplateId" = ${scope.shiftTemplateId}`);
    if (scope.shiftCode) parts.push(Prisma.sql`o."shiftCode" = ${scope.shiftCode}`);
    // Product and production order are not columns here — they are properties of
    // the work order, and duplicating them into every minute would be a second
    // copy to keep true. A minute with no work order cannot match either, and
    // `IN` already excludes NULL, so no row is silently swept in.
    if (scope.skuId) {
      parts.push(Prisma.sql`o."workOrderId" IN (
        SELECT w2.id FROM work_orders w2 WHERE w2."skuId" = ${scope.skuId})`);
    }
    if (scope.productionOrderId) {
      parts.push(Prisma.sql`o."workOrderId" IN (
        SELECT w2.id FROM work_orders w2 WHERE w2."productionOrderId" = ${scope.productionOrderId})`);
    }
    if (scope.productionOrderNumber) {
      parts.push(Prisma.sql`o."workOrderId" IN (
        SELECT w2.id FROM work_orders w2
        JOIN production_orders p2 ON p2.id = w2."productionOrderId"
        WHERE p2."orderNumber" = ${scope.productionOrderNumber})`);
    }
    if (scope.areaId) {
      // A machine belongs to an area either directly or through its line, and
      // the hierarchy allows both — asking for only one silently drops half a
      // plant from an area-scoped reading.
      parts.push(Prisma.sql`o."machineId" IN (
        SELECT m2.id FROM machines m2
        WHERE m2."areaId" = ${scope.areaId}
           OR m2."lineId" IN (SELECT l2.id FROM production_lines l2 WHERE l2."areaId" = ${scope.areaId})
      )`);
    }
    if (scope.lineId) {
      parts.push(Prisma.sql`o."machineId" IN (SELECT m2.id FROM machines m2 WHERE m2."lineId" = ${scope.lineId})`);
    }
    return Prisma.join(parts, ' AND ');
  }

  /**
   * Per job order: the slot collapsed once, the buckets summed, and the late
   * start measured against the clipped slot.
   *
   * `notStartedMin` is the gap between the slot opening and the machine actually
   * starting — both clipped to the window, so a window that begins after the
   * order started reports no late start rather than a negative one.
   */
  private perJobOrder(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope,
  ): Prisma.Sql {
    return Prisma.sql`
      SELECT o."jobOrderId",
             MIN(o."machineId")       AS "machineId",
             MIN(o."workOrderId")     AS "workOrderId",
             MIN(o."shiftCode")       AS "shiftCode",
             GREATEST(MIN(o."committedFrom"), ${from}) AS "slotFrom",
             LEAST(MAX(o."committedTo"), ${slotTo})    AS "slotTo",
             MIN(j."actualStart")     AS "actualStart",
             MAX(j."sequenceOrder")   AS "sequenceOrder",
             COALESCE(SUM(o."totalMin"), 0)::float8            AS "elapsedMin",
             COALESCE(SUM(o."plannedStopMin"), 0)::float8      AS "plannedStopMin",
             COALESCE(SUM(o."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
             COALESCE(SUM(o."externalLossMin"), 0)::float8     AS "externalLossMin",
             COALESCE(SUM(o."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
             COALESCE(SUM(o."operatingMin"), 0)::float8        AS "operatingMin",
             COALESCE(SUM(o."goodParts"), 0)::float8           AS "goodParts",
             COALESCE(SUM(o."rejectedParts"), 0)::float8       AS "rejectedParts",
             COALESCE(SUM(o."theoreticalParts"), 0)::float8    AS "theoreticalParts"
      FROM oee_minutes o
      JOIN job_orders j ON j.id = o."jobOrderId"
      WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."jobOrderId"
    `;
  }

  /**
   * The per-job-order stage rolled into one set of totals.
   *
   * ── Quantity does not roll up the way time does ─────────────────────────────
   * A minute belongs to the machine that spent it, so time sums plainly. One
   * physical unit, though, passes four stations on this line — summing every
   * step counts it four times, inflating output and diluting the scrap rate,
   * because the scrap stays where it happened while the good count multiplies.
   *
   * Good and theoretical therefore come from the LAST step of each work order.
   * Scrap comes from all of them: a unit thrown away at the filler is a real
   * loss even though nothing downstream ever saw it.
   */
  private rollup(inner: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`
      WITH p AS (${inner}),
      fin AS (SELECT p2."workOrderId", MAX(p2."sequenceOrder") AS ms FROM p p2 GROUP BY p2."workOrderId"),
      q AS (
        SELECT COALESCE(SUM(p."goodParts"), 0)::float8        AS "goodParts",
               COALESCE(SUM(p."theoreticalParts"), 0)::float8 AS "theoreticalParts"
        FROM p JOIN fin f ON f."workOrderId" IS NOT DISTINCT FROM p."workOrderId"
                         AND f.ms = p."sequenceOrder"
      )
      SELECT
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (p."slotTo" - p."slotFrom")) / 60)), 0)::float8 AS "committedMin",
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(COALESCE(p."actualStart", p."slotFrom"), p."slotTo") - p."slotFrom"
        )) / 60)), 0)::float8 AS "notStartedMin",
        COALESCE(SUM(p."elapsedMin"), 0)::float8            AS "elapsedMin",
        COALESCE(SUM(p."plannedStopMin"), 0)::float8        AS "plannedStopMin",
        COALESCE(SUM(p."availabilityLossMin"), 0)::float8   AS "availabilityLossMin",
        COALESCE(SUM(p."externalLossMin"), 0)::float8       AS "externalLossMin",
        COALESCE(SUM(p."unmeasuredMin"), 0)::float8         AS "unmeasuredMin",
        COALESCE(SUM(p."operatingMin"), 0)::float8          AS "operatingMin",
        (SELECT q."goodParts" FROM q)                       AS "goodParts",
        COALESCE(SUM(p."rejectedParts"), 0)::float8         AS "rejectedParts",
        (SELECT q."theoreticalParts" FROM q)                AS "theoreticalParts"
      FROM p
    `;
  }

  async totals(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ): Promise<ScheduleTotals> {
    const rows = await this.prisma.$queryRaw<ScheduleTotals[]>(
      this.rollup(this.perJobOrder(factoryId, from, to, slotTo, scope)),
    );
    return rows[0] ?? EMPTY_SCHEDULE_TOTALS;
  }

  async overview(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ) {
    const t = await this.totals(factoryId, from, to, slotTo, scope);
    return { window: { from, to, slotTo }, ...computeSchedule(t), audit: auditSchedule(t) };
  }

  /** Grouped by any column the per-job-order stage carries. */
  private async grouped(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope,
    column: 'machineId' | 'shiftCode',
  ): Promise<Array<ScheduleTotals & { key: string | null }>> {
    const inner = this.perJobOrder(factoryId, from, to, slotTo, scope);
    const col = column === 'machineId' ? Prisma.sql`p."machineId"` : Prisma.sql`p."shiftCode"`;
    return this.prisma.$queryRaw(Prisma.sql`
      SELECT ${col} AS key,
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (p."slotTo" - p."slotFrom")) / 60)), 0)::float8 AS "committedMin",
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(COALESCE(p."actualStart", p."slotFrom"), p."slotTo") - p."slotFrom"
        )) / 60)), 0)::float8 AS "notStartedMin",
        COALESCE(SUM(p."elapsedMin"), 0)::float8          AS "elapsedMin",
        COALESCE(SUM(p."plannedStopMin"), 0)::float8      AS "plannedStopMin",
        COALESCE(SUM(p."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
        COALESCE(SUM(p."externalLossMin"), 0)::float8     AS "externalLossMin",
        COALESCE(SUM(p."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
        COALESCE(SUM(p."operatingMin"), 0)::float8        AS "operatingMin",
        COALESCE(SUM(p."goodParts"), 0)::float8           AS "goodParts",
        COALESCE(SUM(p."rejectedParts"), 0)::float8       AS "rejectedParts",
        COALESCE(SUM(p."theoreticalParts"), 0)::float8    AS "theoreticalParts"
      FROM (${inner}) p
      GROUP BY ${col}
    `);
  }

  async byMachine(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ): Promise<ScheduleSlice[]> {
    const rows = await this.grouped(factoryId, from, to, slotTo, scope, 'machineId');
    const ids = rows.map((r) => r.key).filter((k): k is string => !!k);
    const machines = ids.length
      ? await this.prisma.machine.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true } })
      : [];
    const byId = new Map(machines.map((m) => [m.id, m]));
    return rows
      .map((r) => ({
        key: r.key ?? 'unknown',
        label: byId.get(r.key ?? '')?.code ?? '—',
        sublabel: byId.get(r.key ?? '')?.name ?? null,
        ...computeSchedule(r),
      }))
      .sort((a, b) => (a.oee ?? 101) - (b.oee ?? 101));
  }

  async byShift(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ): Promise<ScheduleSlice[]> {
    const rows = await this.grouped(factoryId, from, to, slotTo, scope, 'shiftCode');
    return rows
      .map((r) => ({ key: r.key ?? 'unassigned', label: r.key ?? 'Unassigned', ...computeSchedule(r) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Per job order — the level this basis is actually defined at.
   *
   * No rollup stage: the per-job-order query already IS one row per order, so
   * the slot is used directly rather than summed.
   */
  async byJobOrder(
    factoryId: string | null, from: Date, to: Date, slotTo: Date, scope: ScheduleScope = {},
  ): Promise<ScheduleSlice[]> {
    const inner = this.perJobOrder(factoryId, from, to, slotTo, scope);
    const rows = await this.prisma.$queryRaw<Array<ScheduleTotals & {
      jobOrderId: string; operationName: string | null; status: string;
      orderNumber: string | null; machineCode: string | null;
      slotFrom: Date; slotTo: Date;
    }>>(Prisma.sql`
      SELECT p."jobOrderId", j."operationName", j.status, w."orderNumber", m.code AS "machineCode",
             p."slotFrom", p."slotTo",
             GREATEST(0, EXTRACT(EPOCH FROM (p."slotTo" - p."slotFrom")) / 60)::float8 AS "committedMin",
             GREATEST(0, EXTRACT(EPOCH FROM (
               LEAST(COALESCE(p."actualStart", p."slotFrom"), p."slotTo") - p."slotFrom"
             )) / 60)::float8 AS "notStartedMin",
             p."elapsedMin", p."plannedStopMin", p."availabilityLossMin", p."externalLossMin",
             p."unmeasuredMin", p."operatingMin", p."goodParts", p."rejectedParts", p."theoreticalParts"
      FROM (${inner}) p
      JOIN job_orders j ON j.id = p."jobOrderId"
      LEFT JOIN work_orders w ON w.id = p."workOrderId"
      LEFT JOIN machines m ON m.id = p."machineId"
    `);
    return rows.map((r) => ({
      key: r.jobOrderId,
      label: `${r.orderNumber ?? '—'} · ${r.operationName ?? '—'}`,
      sublabel: `${r.machineCode ?? '—'} · ${r.status}`,
      ...computeSchedule(r),
    }));
  }

  /**
   * A trend, bucketed by hour or day.
   *
   * The slot is collapsed per job order INSIDE each bucket, not across the
   * window: an order spanning six hours belongs to six buckets, and its slot has
   * to be clipped into each of them or one bucket claims the whole thing.
   */
  async trend(
    factoryId: string | null, from: Date, to: Date, slotTo: Date,
    granularity: TrendBucket = 'hour',
    scope: ScheduleScope = {},
  ): Promise<Array<ScheduleSlice & { at: Date }>> {
    return this.trendOn(factoryId, from, to, slotTo, scope, bucketOf(granularity));
  }

  /**
   * The same trend, bucketed by an arbitrary number of MINUTES.
   *
   * The live screen looks at the last fifteen minutes, and an hourly bucket
   * renders that as a single bar. Deliberately the same query as `trend()`
   * rather than a second one — this engine has already been corrected twice in
   * places that turned out to exist in duplicate.
   */
  async trendByMinutes(
    factoryId: string | null, from: Date, to: Date, slotTo: Date,
    bucketMin: number, scope: ScheduleScope = {},
  ): Promise<Array<ScheduleSlice & { at: Date }>> {
    return this.trendOn(factoryId, from, to, slotTo, scope, bucketOf(bucketMin));
  }

  /**
   * One trend query, two bucket sizes.
   *
   * `bucket` supplies the two fragments that differ: how to snap an instant to
   * the grid, and how wide one step is. Everything else — the slot clipping, the
   * generated bucket series, the left join onto what was recorded — is identical
   * and must stay identical, because a fix applied to one copy and not the other
   * is how the 244-minute gap survived as long as it did.
   */
  private async trendOn(
    factoryId: string | null, from: Date, to: Date, slotTo: Date,
    scope: ScheduleScope, bucket: Bucket,
  ): Promise<Array<ScheduleSlice & { at: Date }>> {
    const { trunc, step: oneBucket } = bucket;

    const rows = await this.prisma.$queryRaw<Array<ScheduleTotals & { at: Date }>>(Prisma.sql`
      -- Each job order's slot, clipped to the window exactly as the headline
      -- clips it. Taken ONCE per order rather than per bucket, so the buckets
      -- below divide the same span the headline charges.
      WITH jo AS (
        SELECT o."jobOrderId",
               GREATEST(MIN(o."committedFrom"), ${from}) AS "slotFrom",
               LEAST(MAX(o."committedTo"), ${slotTo})    AS "slotTo",
               MIN(j."actualStart")                      AS "actualStart"
        FROM oee_minutes o
        JOIN job_orders j ON j.id = o."jobOrderId"
        WHERE ${this.where(factoryId, from, to, scope)}
        GROUP BY o."jobOrderId"
      ),
      -- What was actually RECORDED, per bucket. Absent for a bucket in which
      -- nothing was written, which is the whole point of the left join below.
      metrics AS (
        SELECT ${trunc(Prisma.sql`o."bucketStart"`)} AS at, o."jobOrderId",
               COALESCE(SUM(o."totalMin"), 0)::float8            AS "elapsedMin",
               COALESCE(SUM(o."plannedStopMin"), 0)::float8      AS "plannedStopMin",
               COALESCE(SUM(o."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
               COALESCE(SUM(o."externalLossMin"), 0)::float8     AS "externalLossMin",
               COALESCE(SUM(o."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
               COALESCE(SUM(o."operatingMin"), 0)::float8        AS "operatingMin",
               COALESCE(SUM(o."goodParts"), 0)::float8           AS "goodParts",
               COALESCE(SUM(o."rejectedParts"), 0)::float8       AS "rejectedParts",
               COALESCE(SUM(o."theoreticalParts"), 0)::float8    AS "theoreticalParts"
        FROM oee_minutes o
        JOIN job_orders j ON j.id = o."jobOrderId"
        WHERE ${this.where(factoryId, from, to, scope)}
        GROUP BY 1, 2
      ),
      -- ── Why the buckets are GENERATED rather than taken from the rows ──────
      -- They used to come from the minute rows themselves, so an hour inside a
      -- promised slot in which nothing was recorded produced no bucket at all.
      -- Its committed minutes were charged in the headline and appeared in no
      -- bar, and the trend under-reported the commitment by that much — 244 of
      -- 2661 minutes on the day this was found. That silent hour is the one a
      -- reader most needs to see: a slot was promised and nothing happened in it.
      bounds AS (SELECT MIN("slotFrom") AS lo, MAX("slotTo") AS hi FROM jo),
      buckets AS (
        SELECT generate_series(
          ${trunc(Prisma.sql`b.lo`)},
          ${trunc(Prisma.sql`b.hi`)},
          ${oneBucket}
        ) AS at
        FROM bounds b WHERE b.lo IS NOT NULL AND b.hi IS NOT NULL
      ),
      -- The slot clipped INTO each bucket it overlaps. Half-open on both sides so
      -- an order ending exactly on an hour does not claim the next bucket.
      slot AS (
        SELECT b.at, jo."jobOrderId", jo."actualStart",
               GREATEST(jo."slotFrom", b.at)              AS "slotFrom",
               LEAST(jo."slotTo", b.at + ${oneBucket})    AS "slotTo"
        FROM buckets b
        JOIN jo ON jo."slotFrom" < b.at + ${oneBucket} AND jo."slotTo" > b.at
      )
      SELECT s.at,
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (s."slotTo" - s."slotFrom")) / 60)), 0)::float8 AS "committedMin",
        COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM (
          LEAST(COALESCE(s."actualStart", s."slotFrom"), s."slotTo") - s."slotFrom"
        )) / 60)), 0)::float8 AS "notStartedMin",
        COALESCE(SUM(m."elapsedMin"), 0)::float8          AS "elapsedMin",
        COALESCE(SUM(m."plannedStopMin"), 0)::float8      AS "plannedStopMin",
        COALESCE(SUM(m."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
        COALESCE(SUM(m."externalLossMin"), 0)::float8     AS "externalLossMin",
        COALESCE(SUM(m."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
        COALESCE(SUM(m."operatingMin"), 0)::float8        AS "operatingMin",
        COALESCE(SUM(m."goodParts"), 0)::float8           AS "goodParts",
        COALESCE(SUM(m."rejectedParts"), 0)::float8       AS "rejectedParts",
        COALESCE(SUM(m."theoreticalParts"), 0)::float8    AS "theoreticalParts"
      FROM slot s
      LEFT JOIN metrics m ON m.at = s.at AND m."jobOrderId" = s."jobOrderId"
      GROUP BY s.at ORDER BY s.at
    `);
    return rows.map((r) => ({
      at: r.at, key: r.at.toISOString(), label: r.at.toISOString(), ...computeSchedule(r),
    }));
  }

  /** Why the minutes went where they did. */
  async stateBreakdown(factoryId: string | null, from: Date, to: Date, scope: ScheduleScope = {}) {
    return this.prisma.$queryRaw<Array<{ state: string | null; minutes: number; rows: number }>>(Prisma.sql`
      SELECT o."machineState" AS state,
             COALESCE(SUM(o."totalMin"), 0)::float8 AS minutes,
             COUNT(*)::int AS rows
      FROM oee_minutes o WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."machineState" ORDER BY 2 DESC
    `);
  }
}
