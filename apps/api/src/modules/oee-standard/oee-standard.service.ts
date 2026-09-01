import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { truncPlant, type TrendBucket } from '../../common/trend-bucket.util';

import { PrismaService } from '../../database/prisma.service';
import { computeOee, auditTotals, EMPTY_TOTALS, type OeeTotals, type OeeResult } from './oee-standard.calc';

export interface OeeScope {
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

/** A row of the machine table, and the shape a trend point takes. */
export interface OeeSlice extends OeeResult {
  key: string;
  label: string;
  sublabel?: string | null;
}

/**
 * Every query in this file reads `oee_minutes` under the alias `o`, and every
 * column it names is qualified with it.
 *
 * Not a style choice. Three of these queries join `machines`, `job_orders` and
 * `work_orders`, and all of those carry a `factoryId` of their own — so an
 * unqualified predicate is ambiguous and Postgres refuses the statement outright
 * (42702). It shipped because the account that tested it was a SUPER_ADMIN with
 * no factory, which meant the factory predicate was never added to the SQL at
 * all: the one path that breaks was the one path the test could not reach.
 */
/**
 * Time sums. Every machine's minutes count, wherever it sits in the routing.
 */
const TIME_SUMS = Prisma.sql`
  COALESCE(SUM(o."totalMin"), 0)::float8            AS "totalMin",
  COALESCE(SUM(o."plannedStopMin"), 0)::float8      AS "plannedStopMin",
  COALESCE(SUM(o."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
  COALESCE(SUM(o."externalLossMin"), 0)::float8     AS "externalLossMin",
  COALESCE(SUM(o."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
  COALESCE(SUM(o."operatingMin"), 0)::float8        AS "operatingMin",
  COALESCE(SUM(o."microStopMin"), 0)::float8        AS "microStopMin"
`;

const SUMS = Prisma.sql`
  COALESCE(SUM(o."totalMin"), 0)::float8            AS "totalMin",
  COALESCE(SUM(o."plannedStopMin"), 0)::float8      AS "plannedStopMin",
  COALESCE(SUM(o."availabilityLossMin"), 0)::float8 AS "availabilityLossMin",
  COALESCE(SUM(o."externalLossMin"), 0)::float8     AS "externalLossMin",
  COALESCE(SUM(o."unmeasuredMin"), 0)::float8       AS "unmeasuredMin",
  COALESCE(SUM(o."operatingMin"), 0)::float8        AS "operatingMin",
  COALESCE(SUM(o."microStopMin"), 0)::float8        AS "microStopMin",
  COALESCE(SUM(o."goodParts"), 0)::float8           AS "goodParts",
  COALESCE(SUM(o."rejectedParts"), 0)::float8       AS "rejectedParts",
  COALESCE(SUM(o."theoreticalParts"), 0)::float8    AS "theoreticalParts",
  -- Parts the line booked in minutes the engine credited no runtime for —
  -- output during a scheduled stop, almost always. They raise Performance
  -- without raising its denominator, so the audit names the amount instead of
  -- the reading drifting up unexplained. See OeeTotals.outputWithoutRuntimeParts.
  COALESCE(SUM(o."goodParts" + o."rejectedParts")
           FILTER (WHERE o."operatingMin" = 0), 0)::float8 AS "outputWithoutRuntimeParts"
`;

/**
 * Reads `oee_minutes` and nothing else.
 *
 * The single aggregate in this engine. Every figure any surface shows — a
 * machine row, a shift comparison, a trend point, the plant total — is this one
 * query with a different GROUP BY, passed through the one calculator. There is
 * no second path to the same number, which is the property that makes two
 * screens agree.
 */
@Injectable()
export class OeeStandardService {
  constructor(private readonly prisma: PrismaService) {}

  private where(factoryId: string | null, from: Date, to: Date, scope: OeeScope): Prisma.Sql {
    const parts: Prisma.Sql[] = [Prisma.sql`o."bucketStart" >= ${from} AND o."bucketStart" < ${to}`];
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

  /** One set of totals for the whole scope. */
  /**
   * A roll-up over more than one machine — the plant, a line, an area.
   *
   * ── The rule the per-machine rows cannot apply for you ──────────────────────
   * TIME belongs to every machine: a minute the filler spent broken is a real
   * minute wherever it sat in the routing. QUANTITY does not. One physical unit
   * passes four stations on this line, and summing every step counts it four
   * times — which inflates output and DILUTES the scrap rate, because the scrap
   * stays where it happened while the good count is multiplied.
   *
   * Measured on this window: 34,037 good pieces summed across steps against
   * 19,757 from the final step, and quality reading 82.9% instead of 73.7%. Nine
   * points of scrap hidden by arithmetic.
   *
   * So good and theoretical come from the LAST step of each work order, and
   * scrap comes from ALL of them: a unit thrown away at the filler is a real
   * loss even though it never reached the wrapper.
   *
   * The per-machine and per-job-order rows below do NOT apply this — each of
   * those is one station's own output in its own right, and it would be wrong to
   * blank a filler's count because it is not the end of the line. That means the
   * roll-up is deliberately not the sum of the rows, which is why the page says
   * so rather than leaving somebody to add the column up and find a third number.
   */
  async totals(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}): Promise<OeeTotals> {
    const rows = await this.prisma.$queryRaw<OeeTotals[]>(Prisma.sql`
      WITH scoped AS (
        SELECT o.*, j."sequenceOrder"
        FROM oee_minutes o
        JOIN job_orders j ON j.id = o."jobOrderId"
        WHERE ${this.where(factoryId, from, to, scope)}
      ),
      fin AS (
        SELECT s2."workOrderId", MAX(s2."sequenceOrder") AS ms FROM scoped s2 GROUP BY s2."workOrderId"
      ),
      t AS (SELECT ${TIME_SUMS} FROM scoped o),
      q AS (
        SELECT COALESCE(SUM(o."goodParts"), 0)::float8        AS "goodParts",
               COALESCE(SUM(o."theoreticalParts"), 0)::float8 AS "theoreticalParts",
               -- Good parts booked in minutes with no measured runtime. Same
               -- final-step rule as the figure above, so the two are comparable.
               COALESCE(SUM(o."goodParts") FILTER (WHERE o."operatingMin" = 0), 0)::float8
                 AS "orphanGood"
        FROM scoped o
        JOIN fin f ON f."workOrderId" IS NOT DISTINCT FROM o."workOrderId" AND f.ms = o."sequenceOrder"
      ),
      -- Scrap from every step. A unit rejected at the filler is gone whether or
      -- not anything downstream ever saw it.
      sc AS (
        SELECT COALESCE(SUM(o."rejectedParts"), 0)::float8 AS "rejectedParts",
               COALESCE(SUM(o."rejectedParts") FILTER (WHERE o."operatingMin" = 0), 0)::float8
                 AS "orphanRejected"
        FROM scoped o
      )
      SELECT t.*, q."goodParts", q."theoreticalParts", sc."rejectedParts",
             -- Surfaced, not swallowed: these parts move Performance's numerator
             -- while contributing nothing to its denominator, because the minute
             -- they were made in was credited no runtime (a scheduled stop the
             -- line ran through, almost always).
             (q."orphanGood" + sc."orphanRejected") AS "outputWithoutRuntimeParts"
      FROM t, q, sc
    `);
    return rows[0] ?? EMPTY_TOTALS;
  }

  /**
   * The plant-level answer, with the engine's own audit attached.
   *
   * The audit travels WITH the numbers rather than sitting behind a debug flag.
   * A page that shows a figure and cannot show whether its minutes reconcile is
   * asking to be believed; one that shows both is asking to be checked.
   */
  async overview(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}) {
    const t = await this.totals(factoryId, from, to, scope);
    return { window: { from, to }, ...computeOee(t), audit: auditTotals(t) };
  }

  /** Per machine, worst OEE first — the list somebody acts on. */
  async byMachine(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}): Promise<OeeSlice[]> {
    const rows = await this.prisma.$queryRaw<Array<OeeTotals & { machineId: string; code: string; name: string; line: string | null }>>(Prisma.sql`
      SELECT o."machineId", m.code, m.name, l.code AS line, ${SUMS}
      FROM oee_minutes o
      JOIN machines m ON m.id = o."machineId"
      LEFT JOIN production_lines l ON l.id = m."lineId"
      WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."machineId", m.code, m.name, l.code
    `);
    return rows
      .map((r) => ({ key: r.machineId, label: r.code, sublabel: r.name, ...computeOee(r) }))
      .sort((a, b) => (a.oee ?? 101) - (b.oee ?? 101));
  }

  /** Per job order — the level this engine actually measures at. */
  async byJobOrder(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}): Promise<OeeSlice[]> {
    const rows = await this.prisma.$queryRaw<Array<OeeTotals & {
      jobOrderId: string; operationName: string | null; status: string;
      orderNumber: string | null; machineCode: string | null;
    }>>(Prisma.sql`
      SELECT o."jobOrderId", j."operationName", j.status,
             w."orderNumber", m.code AS "machineCode", ${SUMS}
      FROM oee_minutes o
      JOIN job_orders j ON j.id = o."jobOrderId"
      LEFT JOIN work_orders w ON w.id = o."workOrderId"
      LEFT JOIN machines m ON m.id = o."machineId"
      WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."jobOrderId", j."operationName", j.status, w."orderNumber", m.code
    `);
    return rows.map((r) => ({
      key: r.jobOrderId,
      label: `${r.orderNumber ?? '—'} · ${r.operationName ?? '—'}`,
      sublabel: `${r.machineCode ?? '—'} · ${r.status}`,
      ...computeOee(r),
    }));
  }

  /** Per shift — the second dimension this store keeps. */
  async byShift(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}): Promise<OeeSlice[]> {
    const rows = await this.prisma.$queryRaw<Array<OeeTotals & { shiftCode: string | null }>>(Prisma.sql`
      SELECT o."shiftCode", ${SUMS}
      FROM oee_minutes o WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."shiftCode"
    `);
    return rows
      .map((r) => ({ key: r.shiftCode ?? 'unassigned', label: r.shiftCode ?? 'Unassigned', ...computeOee(r) }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * A trend, bucketed by hour or day.
   *
   * `date_trunc` on the stored bucket rather than a separate rollup table: at a
   * minute a machine, a year of this line is under three million rows, and a
   * second store of the same fact is the thing that lets two numbers drift.
   */
  async trend(
    factoryId: string | null, from: Date, to: Date,
    granularity: TrendBucket = 'hour',
    scope: OeeScope = {},
  ): Promise<Array<OeeSlice & { at: Date }>> {
    const rows = await this.prisma.$queryRaw<Array<OeeTotals & { at: Date }>>(Prisma.sql`
      WITH scoped AS (
        SELECT o.*, j."sequenceOrder", ${truncPlant(granularity)} AS at
        FROM oee_minutes o
        JOIN job_orders j ON j.id = o."jobOrderId"
        WHERE ${this.where(factoryId, from, to, scope)}
      ),
      -- The final step is resolved PER BUCKET, so a work order whose last station
      -- had not started early in the window is not credited with output it had
      -- not made yet.
      fin AS (SELECT s2.at, s2."workOrderId", MAX(s2."sequenceOrder") AS ms
              FROM scoped s2 GROUP BY s2.at, s2."workOrderId"),
      t AS (SELECT o.at, ${TIME_SUMS},
                   COALESCE(SUM(o."rejectedParts"), 0)::float8 AS "rejectedParts"
            FROM scoped o GROUP BY o.at),
      q AS (SELECT o.at,
                   COALESCE(SUM(o."goodParts"), 0)::float8        AS "goodParts",
                   COALESCE(SUM(o."theoreticalParts"), 0)::float8 AS "theoreticalParts"
            FROM scoped o
            JOIN fin f ON f.at = o.at
                      AND f."workOrderId" IS NOT DISTINCT FROM o."workOrderId"
                      AND f.ms = o."sequenceOrder"
            GROUP BY o.at)
      SELECT t.at, t."totalMin", t."plannedStopMin", t."availabilityLossMin", t."externalLossMin",
             t."unmeasuredMin", t."operatingMin", t."rejectedParts",
             COALESCE(q."goodParts", 0) AS "goodParts",
             COALESCE(q."theoreticalParts", 0) AS "theoreticalParts"
      FROM t LEFT JOIN q ON q.at = t.at
      ORDER BY t.at
    `);
    return rows.map((r) => ({
      at: r.at, key: r.at.toISOString(), label: r.at.toISOString(), ...computeOee(r),
    }));
  }

  /**
   * The same trend, bucketed by an arbitrary number of MINUTES.
   *
   * `trend()` buckets by hour or day, which is right for a page that looks at a
   * week and useless for a live screen looking at the last fifteen minutes — one
   * bar is not a trend. This is the same query with a finer bucket, deliberately
   * sharing `where()` and the final-step rule rather than being written afresh:
   * the last thing this system needs is a fourth place that decides which parts
   * count.
   *
   * The bucket expression carries a bind parameter, so it is computed once in
   * `scoped` and grouped by the resulting column. Repeating the expression in
   * GROUP BY is the 42803 that has already been fixed once on this page.
   */
  async trendByMinutes(
    factoryId: string | null, from: Date, to: Date, bucketMin: number, scope: OeeScope = {},
  ): Promise<Array<OeeSlice & { at: Date }>> {
    // Clamped to a whole number of minutes that divides an hour, so buckets tile
    // the window instead of leaving a ragged one at each hour boundary.
    const allowed = [1, 2, 5, 10, 15, 20, 30, 60];
    const n = allowed.includes(Math.round(bucketMin)) ? Math.round(bucketMin) : 5;

    const rows = await this.prisma.$queryRaw<Array<OeeTotals & { at: Date }>>(Prisma.sql`
      WITH scoped AS (
        SELECT o.*, j."sequenceOrder",
               date_trunc('hour', o."bucketStart")
                 + ((EXTRACT(MINUTE FROM o."bucketStart")::int / ${n}::int) * ${n}::int)
                   * INTERVAL '1 minute' AS at
        FROM oee_minutes o
        JOIN job_orders j ON j.id = o."jobOrderId"
        WHERE ${this.where(factoryId, from, to, scope)}
      ),
      fin AS (SELECT s2.at, s2."workOrderId", MAX(s2."sequenceOrder") AS ms
              FROM scoped s2 GROUP BY s2.at, s2."workOrderId"),
      t AS (SELECT o.at, ${TIME_SUMS},
                   COALESCE(SUM(o."rejectedParts"), 0)::float8 AS "rejectedParts"
            FROM scoped o GROUP BY o.at),
      q AS (SELECT o.at,
                   COALESCE(SUM(o."goodParts"), 0)::float8        AS "goodParts",
                   COALESCE(SUM(o."theoreticalParts"), 0)::float8 AS "theoreticalParts"
            FROM scoped o
            JOIN fin f ON f.at = o.at
                      AND f."workOrderId" IS NOT DISTINCT FROM o."workOrderId"
                      AND f.ms = o."sequenceOrder"
            GROUP BY o.at)
      SELECT t.at, t."totalMin", t."plannedStopMin", t."availabilityLossMin", t."externalLossMin",
             t."unmeasuredMin", t."operatingMin", t."rejectedParts",
             COALESCE(q."goodParts", 0) AS "goodParts",
             COALESCE(q."theoreticalParts", 0) AS "theoreticalParts"
      FROM t LEFT JOIN q ON q.at = t.at
      ORDER BY t.at
    `);
    return rows.map((r) => ({
      at: r.at, key: r.at.toISOString(), label: r.at.toISOString(), ...computeOee(r),
    }));
  }

  /**
   * Why a machine's minutes went where they did, in the window.
   *
   * The time model says how much was lost; this says under which state. Without
   * it "availability loss 3 h" is a number nobody can act on.
   */
  async stateBreakdown(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}) {
    return this.prisma.$queryRaw<Array<{ state: string | null; minutes: number; rows: number }>>(Prisma.sql`
      SELECT o."machineState" AS state,
             COALESCE(SUM(o."totalMin"), 0)::float8 AS minutes,
             COUNT(*)::int AS rows
      FROM oee_minutes o WHERE ${this.where(factoryId, from, to, scope)}
      GROUP BY o."machineState" ORDER BY 2 DESC
    `);
  }

  /**
   * The products, production orders and shifts that actually have minutes in the
   * window — the choices the filter is allowed to offer.
   *
   * A filter populated from the master data lists every product the plant has
   * ever defined, so most of its options select nothing and the reader cannot
   * tell "no production" from "wrong choice". Built from the same rows the page
   * is about, every option returns something, and a missing option is itself the
   * answer.
   *
   * Each list is built with its OWN dimension stripped from the scope, so the
   * lists stay cross-navigable: picking a product must not shrink the shift list
   * to that product's shifts and strand the reader with no way back.
   */
  async dimensions(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}) {
    const strip = (drop: keyof OeeScope): OeeScope => {
      const s2 = { ...scope };
      delete s2[drop];
      return s2;
    };
    type Dim = Array<{ id: string; code: string; name: string; minutes: number }>;

    const [skus, orders, shifts, workOrders] = await Promise.all([
      this.prisma.$queryRaw<Dim>(Prisma.sql`
        SELECT k.id, k.code, k.name, COALESCE(SUM(o."totalMin"), 0)::float8 AS minutes
        FROM oee_minutes o
        JOIN work_orders w ON w.id = o."workOrderId"
        JOIN skus k ON k.id = w."skuId"
        WHERE ${this.where(factoryId, from, to, strip('skuId'))}
        GROUP BY k.id, k.code, k.name ORDER BY 4 DESC`),

      this.prisma.$queryRaw<Dim>(Prisma.sql`
        SELECT p.id, p."orderNumber" AS code, p."orderNumber" AS name,
               COALESCE(SUM(o."totalMin"), 0)::float8 AS minutes
        FROM oee_minutes o
        JOIN work_orders w ON w.id = o."workOrderId"
        JOIN production_orders p ON p.id = w."productionOrderId"
        WHERE ${this.where(factoryId, from, to, strip('productionOrderId'))}
        GROUP BY p.id, p."orderNumber" ORDER BY 4 DESC`),

      this.prisma.$queryRaw<Dim>(Prisma.sql`
        SELECT t.id, t.code, t.name, COALESCE(SUM(o."totalMin"), 0)::float8 AS minutes
        FROM oee_minutes o
        JOIN shift_templates t ON t.id = o."shiftTemplateId"
        WHERE ${this.where(factoryId, from, to, strip('shiftTemplateId'))}
        GROUP BY t.id, t.code, t.name ORDER BY t.code`),

      this.prisma.$queryRaw<Dim>(Prisma.sql`
        SELECT w.id, w."orderNumber" AS code, w."orderNumber" AS name,
               COALESCE(SUM(o."totalMin"), 0)::float8 AS minutes
        FROM oee_minutes o
        JOIN work_orders w ON w.id = o."workOrderId"
        WHERE ${this.where(factoryId, from, to, strip('workOrderId'))}
        GROUP BY w.id, w."orderNumber" ORDER BY 4 DESC`),
    ]);

    return { skus, productionOrders: orders, shifts, workOrders };
  }
}
