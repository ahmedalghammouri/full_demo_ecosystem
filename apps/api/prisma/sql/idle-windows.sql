-- Force the line to IDLE across stated windows, and take those minutes out of
-- every calculation.
--
-- ══ THE SITUATION ══════════════════════════════════════════════════════════
-- The plant supplied a table of periods in which nothing was produced. The
-- system recorded something else in them -- BREAKDOWN and STARVED bands, and
-- counts on all four machines -- so availability, OEE, downtime and the output
-- totals are all wrong across those hours.
--
-- This is the same disease as `close-forgotten-job-orders.sql` and a different
-- shape of it: there the order had ended, here the order continues on both
-- sides of a gap. So nothing is closed. The windows are CUT OUT.
--
-- ══ TIME ZONES -- READ THIS BEFORE CHANGING A WINDOW ═══════════════════════
-- The table below is written in PLANT LOCAL time (Asia/Riyadh, UTC+3), exactly
-- as the plant stated it. These columns are `timestamp WITHOUT time zone`
-- holding UTC, so each bound is converted here. A window typed as bare UTC
-- would land three hours early -- silently, and often across a shift boundary.
--
-- ══ THE WINDOWS OVERLAP, AND THAT IS HANDLED ═══════════════════════════════
-- Rows 4 and 5 as supplied overlap by 4h45m:
--     4:  25 Aug 13:50 -> 25 Aug 19:30
--     5:  25 Aug 14:45 -> 26 Aug 09:00
-- They are merged before anything is touched, so no minute is processed twice
-- and no state record is split at a boundary that does not exist. The preview
-- prints the merged set -- check it against your table before applying.
--
-- ══ WHAT IT DOES ═══════════════════════════════════════════════════════════
--   1. machine_state_records  SPLIT at the window edges; the part inside
--                             becomes IDLE, the parts outside keep their state
--                             and their cause. A breakdown that began before a
--                             window keeps the minutes it really had.
--   2. downtime_events        split the same way, and the inside fragment is
--                             dropped -- there is no downtime in an hour that
--                             was not scheduled.
--   3. oee_minutes            deleted inside the windows.
--   4. oee_schedule_minutes   deleted inside the windows.
--   5. job_orders             good and rejected are reduced by exactly what
--                             step 3 removed, converted through the SKU ladder
--                             into each step's own unit.
--
-- Step 5 is the difference between "the OEE pages stop counting it" and "the
-- number stops counting it". `actualQtyGood` is a cumulative counter on the job
-- order and is what the line's headline output reads through the final-step
-- rule -- delete the minutes alone and the headline still carries the phantom
-- production. Skip it with -v keep_orders=1 if you want the states repaired and
-- the totals left for a separate decision.
--
-- ══ ⚠ THERE IS PRODUCTION INSIDE EVERY WINDOW ══════════════════════════════
-- Measured before writing this: 328, 616, 428, 4135, 3650 and 2889 pieces sit
-- inside the six windows. The plant says these hours produced nothing, so that
-- is what is being removed. Section 3 of the preview prints it per work order
-- so the size of the correction is visible before it is made, not after.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -f idle-windows.sql
--   APPLY:    { cat idle-windows.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
-- Opens a transaction and never closes it, so a plain run cannot save anything.
-- Only an appended COMMIT; keeps the work -- a piped script with an unclosed
-- transaction rolls back at EOF.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?keep_orders}
\else
  \set keep_orders 0
\endif
-- Which machines the windows apply to. The plant's table named all four.
\if :{?machines}
\else
  \set machines 'M1,M2,M3,M4'
\endif

BEGIN;

-- oee_minutes is written every minute by the api; without this the deletes sit
-- on a lock with nothing to read.
SET LOCAL lock_timeout = '10s';

-- ── The windows, in PLANT LOCAL time ────────────────────────────────────────
-- Edit HERE and nowhere else. Everything below derives from this table.
CREATE TEMP TABLE _win_raw ON COMMIT DROP AS
SELECT n, from_local, to_local,
       (from_local::timestamp AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS f,
       (to_local::timestamp   AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS t
FROM (VALUES
  (1, '2026-08-23 18:48', '2026-08-23 19:55'),
  (2, '2026-08-24 03:11', '2026-08-24 08:28'),
  (3, '2026-08-24 10:20', '2026-08-24 16:20'),
  (4, '2026-08-25 13:50', '2026-08-25 19:30'),
  (5, '2026-08-25 14:45', '2026-08-26 09:00'),
  (6, '2026-08-26 17:00', '2026-08-27 13:00')
) AS v(n, from_local, to_local);

-- ── Merged, so overlapping windows are one window ───────────────────────────
-- Gaps and islands. Without this, rows 4 and 5 would each split the same state
-- record and the second pass would fragment what the first pass produced.
CREATE TEMP TABLE _win ON COMMIT DROP AS
WITH marked AS (
  SELECT f, t,
         CASE WHEN f <= MAX(t) OVER (ORDER BY f, t ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)
              THEN 0 ELSE 1 END AS is_start
  FROM _win_raw
), grouped AS (
  SELECT f, t, SUM(is_start) OVER (ORDER BY f, t) AS grp FROM marked
)
SELECT MIN(f) AS f, MAX(t) AS t FROM grouped GROUP BY grp;

CREATE TEMP TABLE _mach ON COMMIT DROP AS
SELECT id, code FROM machines WHERE code = ANY (string_to_array(:'machines', ','));

\echo ''
\echo '1. THE WINDOWS AS SUPPLIED, AND AS MERGED'
SELECT n, from_local AS riyadh_from, to_local AS riyadh_to, f AS utc_from, t AS utc_to
  FROM _win_raw ORDER BY n;
SELECT f + interval '3 hours' AS merged_riyadh_from,
       t + interval '3 hours' AS merged_riyadh_to,
       round((EXTRACT(EPOCH FROM (t - f)) / 60)::numeric, 0) AS minutes
  FROM _win ORDER BY f;
SELECT count(*) AS machines_in_scope, string_agg(code, ',' ORDER BY code) AS codes FROM _mach;

-- ════════════════════════════════════════════════════════════════════════════
-- FRAGMENTS
-- ════════════════════════════════════════════════════════════════════════════
-- A record that straddles a window edge must not be flipped whole: a breakdown
-- that began an hour before a window really did break down for that hour. So
-- every overlapping record is cut at each window edge that falls strictly
-- inside it, and each resulting piece is then wholly inside a window or wholly
-- outside one -- never both, which is what makes the classification below a
-- lookup rather than an estimate.
--
-- An open record (endTime NULL) is cut against a sentinel far future and the
-- final piece is written back open, so "still running" survives the split.

CREATE TEMP TABLE _rec ON COMMIT DROP AS
SELECT r.*, COALESCE(r."endTime", timestamp '9999-12-31 00:00:00') AS e_eff
  FROM machine_state_records r
  JOIN _mach m ON m.id = r."machineId"
 WHERE r.state <> 'IDLE'
   AND EXISTS (SELECT 1 FROM _win w
                WHERE r."startTime" < w.t
                  AND COALESCE(r."endTime", timestamp '9999-12-31 00:00:00') > w.f);

CREATE TEMP TABLE _rec_frag ON COMMIT DROP AS
WITH pts AS (
  SELECT r.id, p FROM _rec r
  CROSS JOIN LATERAL (
    SELECT r."startTime" AS p
    UNION SELECT r.e_eff
    UNION SELECT w.f FROM _win w WHERE w.f > r."startTime" AND w.f < r.e_eff
    UNION SELECT w.t FROM _win w WHERE w.t > r."startTime" AND w.t < r.e_eff
  ) q(p)
), frag AS (
  SELECT id, p AS a, lead(p) OVER (PARTITION BY id ORDER BY p) AS b FROM pts
)
SELECT f.id, f.a, f.b,
       EXISTS (SELECT 1 FROM _win w WHERE w.f <= f.a AND w.t >= f.b) AS inside
  FROM frag f WHERE f.b IS NOT NULL AND f.b > f.a;

CREATE TEMP TABLE _dt ON COMMIT DROP AS
SELECT d.*, COALESCE(d."endTime", timestamp '9999-12-31 00:00:00') AS e_eff
  FROM downtime_events d
  JOIN _mach m ON m.id = d."machineId"
 WHERE EXISTS (SELECT 1 FROM _win w
                WHERE d."startTime" < w.t
                  AND COALESCE(d."endTime", timestamp '9999-12-31 00:00:00') > w.f);

CREATE TEMP TABLE _dt_frag ON COMMIT DROP AS
WITH pts AS (
  SELECT d.id, p FROM _dt d
  CROSS JOIN LATERAL (
    SELECT d."startTime" AS p
    UNION SELECT d.e_eff
    UNION SELECT w.f FROM _win w WHERE w.f > d."startTime" AND w.f < d.e_eff
    UNION SELECT w.t FROM _win w WHERE w.t > d."startTime" AND w.t < d.e_eff
  ) q(p)
), frag AS (
  SELECT id, p AS a, lead(p) OVER (PARTITION BY id ORDER BY p) AS b FROM pts
)
SELECT f.id, f.a, f.b,
       EXISTS (SELECT 1 FROM _win w WHERE w.f <= f.a AND w.t >= f.b) AS inside
  FROM frag f WHERE f.b IS NOT NULL AND f.b > f.a;

\echo ''
\echo '2. STATE RECORDS THAT WILL CHANGE'
\echo '   whole = wholly inside a window (becomes IDLE outright)'
\echo '   split = straddles an edge (the outside part keeps its state and cause)'
SELECT m.code, r.state,
       count(*) AS records,
       count(*) FILTER (WHERE (SELECT count(*) FROM _rec_frag g WHERE g.id = r.id) = 1) AS whole,
       count(*) FILTER (WHERE (SELECT count(*) FROM _rec_frag g WHERE g.id = r.id) > 1) AS split,
       round(COALESCE(SUM((SELECT SUM(EXTRACT(EPOCH FROM (g.b - g.a)) / 60)
                             FROM _rec_frag g WHERE g.id = r.id AND g.inside)), 0)::numeric, 0)
         AS minutes_becoming_idle
  FROM _rec r JOIN machines m ON m.id = r."machineId"
 GROUP BY 1, 2 ORDER BY 1, 2;

\echo ''
\echo '3. *** PRODUCTION INSIDE THE WINDOWS -- READ THIS BEFORE APPLYING ***'
\echo '    These counts are being removed. If any window is wrong, fix it now.'
SELECT wo."orderNumber" AS work_order, m.code AS machine, j."outputUnit" AS unit,
       j."actualQtyGood" AS good_now,
       round(SUM(o."goodParts")::numeric, 0) AS pieces_removed,
       count(*) AS minutes_removed
  FROM oee_minutes o
  JOIN _win w ON o."bucketStart" >= w.f AND o."bucketStart" < w.t
  JOIN _mach mm ON mm.id = o."machineId"
  JOIN machines m ON m.id = o."machineId"
  JOIN job_orders j ON j.id = o."jobOrderId"
  JOIN work_orders wo ON wo.id = j."workOrderId"
 GROUP BY 1, 2, 3, 4, j."sequenceOrder" ORDER BY 1, j."sequenceOrder";

-- ── What the job orders lose, in their own units ────────────────────────────
-- oee_minutes counts PIECES; a job order counts INNER, CARTON or PALLET. The
-- ladder converts, exactly as `rescale-double-counted-order.sql` does, so the
-- two stores still agree after the correction.
CREATE TEMP TABLE _jo_cut ON COMMIT DROP AS
SELECT j.id AS jo_id, m.code AS machine, j."outputUnit" AS unit,
       (CASE upper(COALESCE(j."outputUnit", ''))
          WHEN 'PALLET' THEN COALESCE(s."cartonsPerPallet",1) * COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
          WHEN 'CARTON' THEN COALESCE(s."innersPerCarton",1) * COALESCE(s."unitsPerInner",1)
          WHEN 'INNER'  THEN COALESCE(s."unitsPerInner",1)
          ELSE 1
        END)::float8 AS per_unit,
       SUM(o."goodParts")     AS good_pieces,
       SUM(o."rejectedParts") AS rej_pieces
  FROM oee_minutes o
  JOIN _win w ON o."bucketStart" >= w.f AND o."bucketStart" < w.t
  JOIN _mach mm ON mm.id = o."machineId"
  JOIN job_orders j ON j.id = o."jobOrderId"
  JOIN machines m ON m.id = j."machineId"
  JOIN work_orders wo ON wo.id = j."workOrderId"
  LEFT JOIN skus s ON s.id = wo."skuId"
 GROUP BY 1, 2, 3, 4;

-- ── The drift as it stands BEFORE anything is written ───────────────────────
-- `job_orders.actualQtyGood` and the sum of `oee_minutes` already disagree on
-- several of these orders -- WO-2026-0005 is the only one that has ever been
-- reconciled. Captured here so the verification at the end can show that this
-- script did not widen a gap it inherited. Without this the final table looks
-- like damage the script caused.
CREATE TEMP TABLE _drift_before ON COMMIT DROP AS
SELECT c.jo_id, j."actualQtyGood" AS jo_good,
       COALESCE(SUM(o."goodParts"), 0) / c.per_unit AS store_good
  FROM _jo_cut c
  JOIN job_orders j ON j.id = c.jo_id
  LEFT JOIN oee_minutes o ON o."jobOrderId" = c.jo_id
 GROUP BY c.jo_id, j."actualQtyGood", c.per_unit;

\echo ''
\echo '4. WHAT EACH JOB ORDER LOSES (skipped entirely with -v keep_orders=1)'
SELECT c.machine, c.unit,
       j."actualQtyGood" AS good_now,
       ROUND((c.good_pieces / c.per_unit)::numeric, 0) AS good_subtracted,
       GREATEST(0, j."actualQtyGood" - ROUND((c.good_pieces / c.per_unit)::numeric, 0)) AS good_after,
       ROUND((c.rej_pieces / c.per_unit)::numeric, 0) AS rejected_subtracted
  FROM _jo_cut c JOIN job_orders j ON j.id = c.jo_id
 ORDER BY c.machine;

\if :apply

  -- ── 1. State records: split, and the inside becomes IDLE ──────────────────
  -- IDLE, not deleted: the machine really did stand there. What was wrong is
  -- the REASON -- it was not broken and not starved, it simply had no work.
  -- The original state is written into the notes so this stays visible and
  -- reversible by hand.
  INSERT INTO machine_state_records
    (id, "factoryId", "machineId", "shiftInstanceId", "workOrderId", "skuId",
     state, "startTime", "endTime", "durationMinutes", "isPlannedStop",
     "downtimeCauseId", notes, source)
  SELECT gen_random_uuid()::text, r."factoryId", r."machineId", r."shiftInstanceId",
         CASE WHEN g.inside THEN NULL ELSE r."workOrderId" END,
         r."skuId",
         CASE WHEN g.inside THEN 'IDLE'::"MachineState" ELSE r.state END,
         g.a,
         CASE WHEN g.b = timestamp '9999-12-31 00:00:00' THEN NULL ELSE g.b END,
         CASE WHEN g.b = timestamp '9999-12-31 00:00:00' THEN NULL
              ELSE EXTRACT(EPOCH FROM (g.b - g.a)) / 60 END,
         CASE WHEN g.inside THEN false ELSE r."isPlannedStop" END,
         CASE WHEN g.inside THEN NULL ELSE r."downtimeCauseId" END,
         CASE WHEN g.inside
              THEN concat_ws(' ', r.notes,
                     '[was ' || r.state::text || ' - plant states no production in this window]')
              ELSE r.notes END,
         r.source
    FROM _rec r JOIN _rec_frag g ON g.id = r.id;

  DELETE FROM machine_state_records WHERE id IN (SELECT id FROM _rec);

  -- ── 2. Downtime events: only the outside fragments survive ────────────────
  -- No IDLE equivalent here. A downtime event describes time charged against
  -- production, and an hour the plant says was not producing has none to
  -- charge. An event wholly inside a window disappears entirely.
  INSERT INTO downtime_events
    (id, "factoryId", "machineId", "workCenterId", "workOrderId", "shiftInstanceId",
     "causeId", "operatorId", reason, category, "reasonCode",
     "startTime", "endTime", "durationMinutes", "affectsOEE", "isPlanned",
     "reportedById", acknowledged, "acknowledgedById", "acknowledgedAt", "maintenanceWOId",
     -- NOT NULL with no default on this table, unlike machine_state_records.
     -- A fragment is a new row, so it is stamped now rather than inheriting.
     "updatedAt")
  SELECT gen_random_uuid()::text, d."factoryId", d."machineId", d."workCenterId",
         d."workOrderId", d."shiftInstanceId", d."causeId", d."operatorId",
         concat_ws(' ', d.reason, '[split: no-production window removed]'),
         d.category, d."reasonCode", g.a,
         CASE WHEN g.b = timestamp '9999-12-31 00:00:00' THEN NULL ELSE g.b END,
         CASE WHEN g.b = timestamp '9999-12-31 00:00:00' THEN NULL
              ELSE EXTRACT(EPOCH FROM (g.b - g.a)) / 60 END,
         d."affectsOEE", d."isPlanned", d."reportedById", d.acknowledged,
         d."acknowledgedById", d."acknowledgedAt", d."maintenanceWOId",
         now()
    FROM _dt d JOIN _dt_frag g ON g.id = d.id
   WHERE NOT g.inside;

  DELETE FROM downtime_events WHERE id IN (SELECT id FROM _dt);

  -- ── 3. The minute stores ──────────────────────────────────────────────────
  -- Deleted rather than zeroed. A row of zeros is a measurement saying "this
  -- minute was scheduled and produced nothing", which is a different claim
  -- from "this minute was not scheduled" -- and it is the first that drags
  -- availability down. Absence is the honest record here.
  DELETE FROM oee_minutes o
   USING _win w, _mach m
   WHERE o."bucketStart" >= w.f AND o."bucketStart" < w.t AND o."machineId" = m.id;

  DELETE FROM oee_schedule_minutes o
   USING _win w, _mach m
   WHERE o."bucketStart" >= w.f AND o."bucketStart" < w.t AND o."machineId" = m.id;

  -- ── 4. The job order totals follow the minutes ────────────────────────────
  \if :keep_orders
    \echo ''
    \echo 'keep_orders=1 -- job order totals left untouched.'
    \echo 'The OEE pages stop counting these minutes; the headline output does not.'
  \else
  UPDATE job_orders j
     SET "actualQtyGood"     = GREATEST(0, j."actualQtyGood"
                                           - ROUND((c.good_pieces / c.per_unit)::numeric, 0)),
         "actualQtyRejected" = GREATEST(0, j."actualQtyRejected"
                                           - ROUND((c.rej_pieces / c.per_unit)::numeric, 0)),
         notes = concat_ws(' ', j.notes,
           '[-' || ROUND((c.good_pieces / c.per_unit)::numeric, 0) || ' '
                || COALESCE(j."outputUnit", 'unit')
                || ' counted in a window the plant states had no production]')
    FROM _jo_cut c
   WHERE j.id = c.jo_id AND ROUND((c.good_pieces / c.per_unit)::numeric, 0) > 0;
  \endif

  -- ── VERIFY ────────────────────────────────────────────────────────────────
  -- Not a summary of what was intended: a re-measurement of what is now there.
  \echo ''
  \echo 'VERIFY -- anything still not IDLE inside a window (want 0 rows)'
  SELECT m.code, r.state, count(*) AS still_not_idle
    FROM machine_state_records r
    JOIN _mach mm ON mm.id = r."machineId"
    JOIN machines m ON m.id = r."machineId"
   WHERE r.state <> 'IDLE'
     AND EXISTS (SELECT 1 FROM _win w
                  WHERE r."startTime" < w.t
                    AND COALESCE(r."endTime", timestamp '9999-12-31') > w.f)
   GROUP BY 1, 2;

  \echo ''
  \echo 'VERIFY -- minutes and downtime left inside the windows (want 0 and 0)'
  SELECT (SELECT count(*) FROM oee_minutes o
            JOIN _win w ON o."bucketStart" >= w.f AND o."bucketStart" < w.t
            JOIN _mach m ON m.id = o."machineId") AS oee_minutes_left,
         (SELECT count(*) FROM downtime_events d JOIN _mach m ON m.id = d."machineId"
           WHERE EXISTS (SELECT 1 FROM _win w
                          WHERE d."startTime" < w.t
                            AND COALESCE(d."endTime", timestamp '9999-12-31') > w.f)) AS downtime_left;

  \echo ''
  \echo 'VERIFY -- did this script widen the job-order / minute-store gap?'
  \echo '   drift_before is what it inherited; drift_after is what it leaves.'
  \echo '   Only |after| > |before| is this script''s doing.'
  SELECT m.code, wo."orderNumber" AS work_order,
         round((b.jo_good - b.store_good)::numeric, 0) AS drift_before,
         round((j."actualQtyGood"
                - COALESCE(SUM(o."goodParts"), 0) / c.per_unit)::numeric, 0) AS drift_after,
         CASE WHEN abs(j."actualQtyGood" - COALESCE(SUM(o."goodParts"), 0) / c.per_unit)
                   > abs(b.jo_good - b.store_good) + 1
              THEN 'WIDENED' ELSE 'ok' END AS verdict
    FROM _jo_cut c
    JOIN _drift_before b ON b.jo_id = c.jo_id
    JOIN job_orders j ON j.id = c.jo_id
    JOIN work_orders wo ON wo.id = j."workOrderId"
    JOIN machines m ON m.id = j."machineId"
    LEFT JOIN oee_minutes o ON o."jobOrderId" = c.jo_id
   GROUP BY 1, 2, b.jo_good, b.store_good, j."actualQtyGood", c.per_unit
   ORDER BY 2, 1;

  \echo ''
  \echo 'VERIFY -- IDLE bands created, per machine'
  SELECT m.code, count(*) AS idle_bands,
         round(SUM(r."durationMinutes")::numeric, 0) AS idle_minutes
    FROM machine_state_records r JOIN machines m ON m.id = r."machineId"
   WHERE r.notes LIKE '%no production in this window%'
   GROUP BY 1 ORDER BY 1;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Read section 3 before applying: that production is what gets removed.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif
