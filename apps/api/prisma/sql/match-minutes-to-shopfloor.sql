-- Bring oee_minutes back in line with the totals the operator corrected.
--
-- ── The situation ───────────────────────────────────────────────────────────
-- The tablet's "Correct total" writes the JOB ORDER's total. It does not touch
-- oee_minutes, and it cannot: those minutes are sealed measurements. So after a
-- downward correction, every analytics screen (Output and time, OEE, trends)
-- keeps reporting the old inflated figure while the shop floor shows the
-- corrected one. That is the mismatch this repairs.
--
-- ── The SECOND consequence, which is worse ──────────────────────────────────
-- The writer books each minute as
--     goodParts = MAX(0, jo.actualQtyGood - SUM(minutes already booked))
-- After a correction downward that difference is NEGATIVE, so it clamps to 0 --
-- and stays 0 until real production climbs back past the OLD inflated number.
-- On M1 that is ~498 pieces of genuine output that would be recorded as nothing
-- at all. Running this repair clears that debt too.
--
-- ── How the surplus is removed: the biggest minutes first ───────────────────
-- NOT spread proportionally. The surplus is an artefact of SPECIFIC minutes --
-- one minute on M1 booked 1260 pieces against a ceiling of 45 -- and shaving a
-- little off every honest minute to pay for one impossible one would corrupt
-- the shift's shape in order to hide its cause.
--
-- So a ceiling T is found such that SUM(MIN(goodParts, T)) equals the corrected
-- total exactly, and every minute is capped at it. The tall minutes pay; the
-- ordinary ones are untouched. Idempotent: a second run finds nothing to do.
--
-- It never invents production. If the minutes already sum to LESS than the
-- corrected total, that job order is reported and left alone -- inflating a
-- minute to reach a target would be a worse defect than the one being fixed.
--
-- ── Usage ───────────────────────────────────────────────────────────────────
--   PREVIEW:  psql ... < match-minutes-to-shopfloor.sql
--   APPLY:    { cat match-minutes-to-shopfloor.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
-- Like every script here it opens a transaction and never closes it, so a plain
-- run cannot save anything. Only the appended COMMIT does.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
-- Which job orders to reconcile. Default: everything still executing.
\if :{?status}
\else
  \set status 'EXECUTING'
\endif

BEGIN;

-- ── Fail fast instead of hanging ──────────────────────────────────
-- `oee_minutes` is the busiest table on the plant: the writer updates
-- isFinalized on it every minute, per machine. A bulk UPDATE here contends with
-- that directly, and on 27 Aug 2026 a delete on a much quieter table sat locked
-- for twenty minutes with no message while every attempt to retry queued behind
-- the last one.
--
-- Five seconds, then an error naming the table. If it fires, look for a session
-- idle in a transaction:
--
--   SELECT pid, state, age(now(), xact_start), pg_blocking_pids(pid)
--     FROM pg_stat_activity WHERE datname = current_database();
SET LOCAL lock_timeout = '5s';

-- ── 1. The target, in the same base units oee_minutes counts in ─────────────
CREATE TEMP TABLE _target ON COMMIT DROP AS
SELECT
  j.id AS jo_id,
  m.code AS machine,
  j."operationName" AS op,
  j."outputUnit" AS unit,
  j."actualQtyGood"     AS jo_good_unit,
  j."actualQtyRejected" AS jo_rej_unit,
  -- The SKU's own ladder, read from the SKU rather than hard-coded, so a
  -- packaging change moves this number with it.
  (CASE upper(COALESCE(j."outputUnit", ''))
     WHEN 'PALLET' THEN COALESCE(s."cartonsPerPallet",1) * COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
     WHEN 'CARTON' THEN COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
     WHEN 'INNER'  THEN COALESCE(s."unitsPerInner",1)
     ELSE 1
   END)::float8 AS per_unit
FROM job_orders j
JOIN machines m ON m.id = j."machineId"
LEFT JOIN work_orders w ON w.id = j."workOrderId"
LEFT JOIN skus s ON s.id = w."skuId"
WHERE j.status = :'status';

CREATE TEMP TABLE _recon ON COMMIT DROP AS
SELECT t.*,
       t.jo_good_unit * t.per_unit AS target_good,
       t.jo_rej_unit  * t.per_unit AS target_rej,
       COALESCE(g.cur_good, 0) AS cur_good,
       COALESCE(g.cur_rej , 0) AS cur_rej,
       COALESCE(g.rows_n  , 0) AS rows_n
FROM _target t
LEFT JOIN (
  SELECT "jobOrderId",
         SUM("goodParts")::float8 cur_good,
         SUM("rejectedParts")::float8 cur_rej,
         count(*) rows_n
  FROM oee_minutes GROUP BY "jobOrderId"
) g ON g."jobOrderId" = t.jo_id;

\echo ''
\echo 'SHOP FLOOR vs THE MINUTE STORE  (base units)'
SELECT machine, op, unit,
       jo_good_unit AS "shop floor",
       round(target_good::numeric,0) AS "target base",
       round(cur_good::numeric,0)    AS "minutes now",
       round((cur_good - target_good)::numeric,0) AS surplus,
       rows_n AS "minute rows"
FROM _recon ORDER BY machine;

-- ── 2. The ceiling T, per job order ─────────────────────────────────────────
-- With minutes sorted DESCENDING, capping at the k-th value leaves
--     SUM(everything below k) + k * T
-- so T = (target - suffix_sum(k)) / k. The right k is the one whose T actually
-- lands between the k-th and (k+1)-th values; otherwise the cap would sit above
-- a minute it was supposed to trim.
CREATE TEMP TABLE _cap ON COMMIT DROP AS
WITH mins AS (
  SELECT o.id, o."jobOrderId" jo, o."goodParts"::float8 g,
         ROW_NUMBER() OVER (PARTITION BY o."jobOrderId" ORDER BY o."goodParts" DESC, o.id) rn,
         SUM(o."goodParts"::float8) OVER (
           PARTITION BY o."jobOrderId" ORDER BY o."goodParts" DESC, o.id
           ROWS BETWEEN 1 FOLLOWING AND UNBOUNDED FOLLOWING
         ) suffix,
         LEAD(o."goodParts"::float8) OVER (
           PARTITION BY o."jobOrderId" ORDER BY o."goodParts" DESC, o.id
         ) next_g
  FROM oee_minutes o
  JOIN _recon r ON r.jo_id = o."jobOrderId"
  WHERE r.cur_good > r.target_good
),
solved AS (
  SELECT m.jo, m.rn,
         (r.target_good - COALESCE(m.suffix, 0)) / m.rn AS t
  FROM mins m JOIN _recon r ON r.jo_id = m.jo
  WHERE (r.target_good - COALESCE(m.suffix, 0)) / m.rn <= m.g
    AND (r.target_good - COALESCE(m.suffix, 0)) / m.rn >= COALESCE(m.next_g, 0)
)
SELECT jo, MIN(t) AS cap FROM solved GROUP BY jo;

\echo ''
\echo 'THE CEILING each minute is capped at, and what it costs the tall ones'
SELECT r.machine, round(c.cap::numeric,1) AS "cap per min",
       (SELECT count(*) FROM oee_minutes o
         WHERE o."jobOrderId" = c.jo AND o."goodParts" > c.cap) AS "minutes trimmed",
       round((SELECT COALESCE(SUM(o."goodParts" - c.cap),0) FROM oee_minutes o
               WHERE o."jobOrderId" = c.jo AND o."goodParts" > c.cap)::numeric,0) AS removed
FROM _cap c JOIN _recon r ON r.jo_id = c.jo ORDER BY r.machine;

\echo ''
\echo 'LEFT ALONE -- minutes already summing BELOW the corrected total'
\echo '(nothing is ever inflated to reach a target)'
SELECT machine, op, jo_good_unit AS "shop floor",
       round(cur_good::numeric,0) AS "minutes now",
       round((target_good - cur_good)::numeric,0) AS "short by"
FROM _recon WHERE cur_good < target_good ORDER BY machine;

\if :apply

  UPDATE oee_minutes o
  SET "goodParts" = LEAST(o."goodParts", c.cap)
  FROM _cap c
  WHERE o."jobOrderId" = c.jo AND o."goodParts" > c.cap;

  -- Rejects are far smaller and have no jump pattern, so they scale.
  UPDATE oee_minutes o
  SET "rejectedParts" = GREATEST(0, o."rejectedParts" * (r.target_rej / NULLIF(r.cur_rej, 0)))
  FROM _recon r
  WHERE o."jobOrderId" = r.jo_id AND r.cur_rej > r.target_rej AND r.cur_rej > 0;

  \echo ''
  \echo 'RESULT -- these two columns must now match'
  SELECT r.machine, r.jo_good_unit AS "shop floor",
         round((SUM(o."goodParts") / r.per_unit)::numeric, 2) AS "minutes now same unit"
  FROM oee_minutes o JOIN _recon r ON r.jo_id = o."jobOrderId"
  GROUP BY r.machine, r.jo_good_unit, r.per_unit ORDER BY r.machine;

  \echo ''
  \echo 'APPLIED, but NOT saved. Append COMMIT; to keep it.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed. Re-run with -v apply=1'
\endif
