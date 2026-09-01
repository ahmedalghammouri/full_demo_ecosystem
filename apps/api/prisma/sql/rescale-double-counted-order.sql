-- Bring an over-counted work order back to what the line actually made.
--
-- ══ TWO WAYS TO SAY THE CORRECTION ═════════════════════════════════════════
--
--   -v divide=2          every figure is halved. Use this when the counter was
--                        plainly seeing each product twice and you want the
--                        arithmetic to be exactly that, with nothing inferred.
--
--   -v true_final=31     the true output of the FINAL step, in its own unit.
--                        Every other step is derived through the SKU's ladder,
--                        because these are serial steps on one batch.
--
-- They answer different questions. `divide` says "the counter double-counted";
-- `true_final` says "this is what we shipped". On WO-2026-0005 they land close
-- but not equal -- halving gives 8,743 inners, the stated truth gives 9,672 --
-- because the doubling was not perfectly clean. Neither is more correct in the
-- abstract; pick the one you can defend to whoever reads the number.
--
-- ══ WHAT IT TOUCHES ════════════════════════════════════════════════════════
-- Good AND rejected, in `job_orders`, `oee_minutes`, `oee_schedule_minutes`,
-- and the gateway's own accumulators. Rejects take the same factor: contact
-- ring does not distinguish good from bad, it counts a transition twice.
--
-- ══ WHY PROPORTIONAL SCALING IS RIGHT HERE, AND WAS WRONG BEFORE ═══════════
-- `match-minutes-to-shopfloor.sql` deliberately does NOT scale: there the
-- surplus sat in three specific minutes -- a held backlog flushed as one delta
-- -- and shaving every honest minute to pay for one impossible one would have
-- corrupted the shift's shape to hide its cause.
--
-- This is the opposite shape, and the measurement says so. M1 counted across
-- 597 minutes with a largest minute of 52 against a ceiling of 50; only two
-- minutes exceed it at all. The inflation is spread evenly over every minute,
-- because a false count sits beside every true one -- so a uniform ratio is
-- not an approximation here, it is the model.
--
-- The preview prints that shape. If the surplus turns out to be concentrated
-- in a few impossible minutes, this is the wrong tool.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -v wo=WO-2026-0005 -v divide=2 < rescale-double-counted-order.sql
--   APPLY:    { cat rescale-double-counted-order.sql; echo "COMMIT;"; } | psql ... -v wo=WO-2026-0005 -v divide=2 -v apply=1
--
-- ⚠ THIS DOES NOT FIX THE CAUSE. `gateway-config.json` has no `machineLimits`,
-- so the debounce gate is off and every bounce is still counted as a product.
-- Updating the exe does not enable it -- the gate is off by default on purpose,
-- because one set too tight eats real production silently. Repairing the
-- figures without setting it means doing this again after the next order.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?wo}
\else
  \set wo 'WO-2026-0005'
\endif
-- Exactly one of the two must be given, and `divide` wins if both are.
--
-- Note the shape: psql's \if takes a BOOLEAN, so it can test whether a
-- variable was PASSED (`:{?name}`) but not whether a number is non-zero.
-- Writing `\if :divide` fails with "Boolean expected" -- and, worse, psql
-- treats the failed test as false and carries on, so the guard silently
-- becomes "no options given" no matter what was passed.
\if :{?divide}
  \set true_final 0
\elif :{?true_final}
  \set divide 0
\else
  \echo 'ERROR: pass -v divide=2   (halve everything)'
  \echo '   or  -v true_final=31   (the final step is truly this many)'
  \quit
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';

-- ── The true figure for every step, from one number ─────────────────────────
CREATE TEMP TABLE _scale ON COMMIT DROP AS
WITH steps AS (
  SELECT j.id AS jo_id, m.code AS machine, j."sequenceOrder" AS seq,
         j."operationName" AS op, j."outputUnit" AS unit,
         j."actualQtyGood" AS good, j."actualQtyRejected" AS rej,
         -- Pieces per one unit of this step's own output unit.
         (CASE upper(COALESCE(j."outputUnit", ''))
            WHEN 'PALLET' THEN COALESCE(s."cartonsPerPallet",1) * COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
            WHEN 'CARTON' THEN COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
            WHEN 'INNER'  THEN COALESCE(s."unitsPerInner",1)
            ELSE 1
          END)::float8 AS per_unit
  FROM job_orders j
  JOIN machines m ON m.id = j."machineId"
  JOIN work_orders w ON w.id = j."workOrderId"
  LEFT JOIN skus s ON s.id = w."skuId"
  WHERE w."orderNumber" = :'wo'
),
final AS (SELECT * FROM steps ORDER BY seq DESC LIMIT 1)
SELECT st.*,
       -- The truth in pieces, stated once by the plant on the final step.
       (SELECT :true_final * f.per_unit FROM final f) AS true_pieces,
       -- ...and converted into THIS step's unit.
       (SELECT :true_final * f.per_unit FROM final f) / st.per_unit AS true_qty
FROM steps st;

CREATE TEMP TABLE _ratio ON COMMIT DROP AS
SELECT *,
       CASE
         -- A stated divisor is applied literally, the same to every step. No
         -- ladder, no derivation: the plant said the counter saw everything
         -- twice, and that is the whole of it.
         WHEN :divide > 0 THEN 1.0 / :divide
         WHEN good > 0     THEN true_qty / good
         ELSE 1
       END AS factor
FROM _scale;

\echo ''
\echo 'BEFORE AND AFTER, STEP BY STEP'
SELECT machine, op, unit,
       round(good::numeric, 0) AS good_now,
       round((good * factor)::numeric, 0) AS good_after,
       round(rej::numeric, 0)  AS rejected_now,
       round((rej * factor)::numeric, 0)  AS rejected_after,
       round(factor::numeric, 3) AS multiply_by
FROM _ratio ORDER BY seq;

\echo ''
\echo 'IS THE SURPLUS SPREAD, OR IN A FEW IMPOSSIBLE MINUTES?'
\echo 'Spread -> scaling is right. Concentrated -> use match-minutes-to-shopfloor.sql.'
SELECT m.code,
       count(*) FILTER (WHERE o."goodParts" > 0) AS counting_minutes,
       round(MAX(o."goodParts")::numeric, 0)     AS biggest_minute,
       round((MAX(o."designSpeedPph") / 60)::numeric, 0) AS ceiling_per_min,
       count(*) FILTER (WHERE o."designSpeedPph" > 0 AND o."goodParts" > o."designSpeedPph" / 60) AS over_ceiling
FROM oee_minutes o
JOIN machines m ON m.id = o."machineId"
JOIN _ratio r ON r.jo_id = o."jobOrderId"
GROUP BY 1 ORDER BY 1;

\if :apply

  -- ── The job order totals ──────────────────────────────────────────────────
  -- Rounded, because a job order cannot hold 30.6 pallets. Rejects take the
  -- same factor: contact ring does not distinguish good from bad, it simply
  -- counts a transition twice.
  UPDATE job_orders j
     SET "actualQtyGood"     = ROUND((j."actualQtyGood" * r.factor)::numeric, 0),
         "actualQtyRejected" = ROUND((j."actualQtyRejected" * r.factor)::numeric, 0),
         notes = concat_ws(' ', j.notes,
           '[rescaled x' || round(r.factor::numeric, 3) || ' - counted without a debounce gate]')
    FROM _ratio r
   WHERE j.id = r.jo_id AND r.factor <> 1;

  -- ── The minute store, by the same factor ──────────────────────────────────
  -- Not rounded per minute: rounding 0.6 of a piece to 1 across six hundred
  -- minutes would put the total back where it started. The minutes carry
  -- fractions and only their SUM has to match, which is what every reader of
  -- this table actually uses.
  UPDATE oee_minutes o
     SET "goodParts"     = o."goodParts" * r.factor,
         "rejectedParts" = o."rejectedParts" * r.factor
    FROM _ratio r
   WHERE o."jobOrderId" = r.jo_id AND r.factor <> 1;

  UPDATE oee_schedule_minutes o
     SET "goodParts"     = o."goodParts" * r.factor,
         "rejectedParts" = o."rejectedParts" * r.factor
    FROM _ratio r
   WHERE o."jobOrderId" = r.jo_id AND r.factor <> 1;

  -- ── The gateway's own accumulators ────────────────────────────────────────
  -- Otherwise the edge believes it has already reported more than the job
  -- order now holds, and books nothing until real production climbs past the
  -- old inflated figure -- the same debt `match-minutes-to-shopfloor.sql`
  -- exists to clear. Scaled by the machine's own factor.
  UPDATE gateway_counter_states g
     SET accumulated = ROUND((g.accumulated * r.factor)::numeric, 0)
    FROM _ratio r, tag_definitions t
   WHERE t.id = g."tagId"
     AND g."jobOrderId" = r.jo_id
     AND r.factor <> 1;

  \echo ''
  \echo 'RESULT -- job orders'
  SELECT m.code, j."operationName", j."outputUnit" AS unit, j."actualQtyGood" AS good
    FROM job_orders j JOIN machines m ON m.id = j."machineId"
   WHERE j.id IN (SELECT jo_id FROM _ratio) ORDER BY j."sequenceOrder";

  \echo ''
  \echo 'RESULT -- the minute store must agree with the job order'
  SELECT m.code AS machine, j."actualQtyGood" AS job_order,
         round((SUM(o."goodParts") / r.per_unit)::numeric, 1) AS minute_store
    FROM oee_minutes o
    JOIN _ratio r ON r.jo_id = o."jobOrderId"
    JOIN job_orders j ON j.id = r.jo_id
    JOIN machines m ON m.id = j."machineId"
   GROUP BY m.code, j."actualQtyGood", r.per_unit, r.seq ORDER BY r.seq;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
  \echo 'AND SET THE DEBOUNCE, or the next order arrives inflated too.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Apply with  -v apply=1  and an appended COMMIT;'
\endif
