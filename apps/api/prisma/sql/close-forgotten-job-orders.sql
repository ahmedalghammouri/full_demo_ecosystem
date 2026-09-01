-- Close job orders the operator forgot to close, and repair what followed.
--
-- ══ THE SITUATION ══════════════════════════════════════════════════════════
-- The work finished, nobody pressed Complete, and the line sat recording states
-- for another day. On the timeline that is one enormous BREAKDOWN band on M1
-- and three STARVED bands beside it, and every figure that touches those hours
-- is wrong: availability, OEE, downtime, the lot.
--
-- Measured on this plant, the four stuck records are
--
--   M1  BREAKDOWN  28 Aug 06:46:25 Riyadh   1471 min
--   M2  STARVED    28 Aug 06:53:19 Riyadh   1464 min
--   M3  STARVED    28 Aug 06:53:58 Riyadh   1464 min
--   M4  STARVED    28 Aug 06:54:02 Riyadh   1451 min
--
-- ══ TIME ZONES -- READ THIS BEFORE CHANGING THE CUT ════════════════════════
-- The screen shows PLANT LOCAL time (Asia/Riyadh, UTC+3). These columns are
-- `timestamp WITHOUT time zone` holding UTC. So the 06:46 on the timeline is
-- 03:46 in the table, and a cut typed as a bare UTC timestamp would land three
-- hours early -- silently, on the wrong side of a shift boundary.
--
-- The cut below is therefore written in RIYADH time and converted here. It was
-- verified against the data: M1's BREAKDOWN begins at 03:46:25.58 UTC, which is
-- exactly 06:46:25 Riyadh -- the instant the plant named.
--
-- ══ ⚠ WHAT THE PREVIEW WILL TELL YOU, AND WHY IT MATTERS ═══════════════════
-- The line did NOT stop at 06:46. Measured after that instant:
--
--   M2   12 pieces, last at 08:07 Riyadh
--   M3  312 pieces, last at 09:16 Riyadh
--   M4  312 pieces, last at 09:16 Riyadh
--
-- Cutting at 06:46 discards that as production belonging to no order. Section 1
-- prints it before anything is touched. If those counts are real, move the cut
-- to the last producing minute; if they are the shared-sensor artefact on M3/M4
-- (both machines report identical figures because one input feeds both), then
-- 06:46 is right and the loss is only M2's twelve.
--
-- That is a plant decision, not a database one. This script will not make it.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... < close-forgotten-job-orders.sql
--   APPLY:    { cat close-forgotten-job-orders.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
-- Opens a transaction and never closes it, so a plain run cannot save anything.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
-- The cut, in PLANT LOCAL time. Override with:  -v cut='2026-08-28 09:16:00'
\if :{?cut}
\else
  \set cut '2026-08-28 06:46:25'
\endif

BEGIN;

-- oee_minutes is the busiest table here and the api writes it every minute.
-- Without this the delete below sits on a lock with nothing to read.
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE _cut ON COMMIT DROP AS
SELECT (:'cut'::timestamp AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS t;

-- The orders that were still open at the cut.
CREATE TEMP TABLE _jo ON COMMIT DROP AS
SELECT j.id, m.code AS machine, j."operationName" AS op, j."outputUnit" AS unit,
       j."actualQtyGood" AS good, j.status, j."actualEnd", w."orderNumber" AS wo
FROM job_orders j
JOIN machines m ON m.id = j."machineId"
JOIN work_orders w ON w.id = j."workOrderId"
CROSS JOIN _cut c
WHERE j."actualStart" < c.t
  AND (j."actualEnd" IS NULL OR j."actualEnd" > c.t);

\echo ''
\echo 'THE CUT'
SELECT :'cut' AS riyadh, t AS stored_utc FROM _cut;

\echo ''
\echo 'ORDERS OPEN AT THE CUT -- these will be closed there'
SELECT machine, op, wo, status, good, unit, "actualEnd" AS ends_now FROM _jo ORDER BY machine;

\echo ''
\echo 'STUCK STATE RECORDS -- these become IDLE'
SELECT m.code, r.state, r."startTime" + interval '3 hours' AS riyadh_start,
       round(r."durationMinutes"::numeric, 0) AS minutes
FROM machine_state_records r
JOIN machines m ON m.id = r."machineId"
CROSS JOIN _cut c
WHERE r.state IN ('BREAKDOWN', 'STARVED', 'BLOCKED')
  AND r."startTime" >= c.t - interval '15 minutes'
  AND r."durationMinutes" > 200
ORDER BY m.code;

\echo ''
\echo '*** PRODUCTION AFTER THE CUT -- READ THIS ***'
\echo 'If these are real, the order did not end at the cut. Move it later.'
SELECT m.code,
       round(SUM(o."goodParts")::numeric, 0) AS good_pieces,
       (MAX(o."bucketStart") + interval '3 hours') AS last_producing_riyadh
FROM oee_minutes o
JOIN machines m ON m.id = o."machineId"
JOIN _jo ON _jo.id = o."jobOrderId"
CROSS JOIN _cut c
WHERE o."bucketStart" >= c.t AND o."goodParts" > 0
GROUP BY 1 ORDER BY 1;

\echo ''
\echo 'MINUTES THAT WOULD BE DELETED (the order no longer exists in them)'
SELECT m.code, count(*) AS minutes,
       round(SUM(o."availabilityLossMin")::numeric, 0) AS breakdown_min,
       round(SUM(o."externalLossMin")::numeric, 0) AS starved_min,
       round(SUM(o."goodParts")::numeric, 0) AS good_lost
FROM oee_minutes o
JOIN machines m ON m.id = o."machineId"
JOIN _jo ON _jo.id = o."jobOrderId"
CROSS JOIN _cut c
WHERE o."bucketStart" >= c.t
GROUP BY 1 ORDER BY 1;

\if :apply

  -- ── 1. The orders end where the work ended ────────────────────────────────
  UPDATE job_orders j
     SET "actualEnd" = c.t,
         status = 'COMPLETE',
         notes = concat_ws(' ', j.notes,
           '[closed at ' || :'cut' || ' plant time - operator did not close it]')
    FROM _cut c
   WHERE j.id IN (SELECT id FROM _jo);

  -- ── 2. The stuck states become IDLE ───────────────────────────────────────
  -- IDLE, not deleted: the machine really did stand there, and the hours are
  -- real. What was wrong is the REASON -- it was not broken and not starved,
  -- it simply had no order. The original state is recorded so this is visible
  -- and reversible by hand.
  UPDATE machine_state_records r
     SET state = 'IDLE',
         "downtimeCauseId" = NULL,
         "isPlannedStop" = false,
         "workOrderId" = NULL,
         notes = concat_ws(' ', r.notes,
           '[was ' || r.state::text || ' - job order had ended, nobody closed it]')
    FROM _cut c
   WHERE r.state IN ('BREAKDOWN', 'STARVED', 'BLOCKED')
     AND r."startTime" >= c.t - interval '15 minutes'
     AND r."durationMinutes" > 200;

  -- ── 3. The minutes after the cut belong to no order ───────────────────────
  -- Deleted rather than reclassified. `oee_minutes` rows are keyed by job
  -- order, and a minute after that order ended is not a measurement of it --
  -- there is no honest value for `plannedMin` or `availabilityLossMin` on a
  -- minute when nothing was scheduled. This is what would have been recorded
  -- had the operator pressed Complete on time: nothing.
  DELETE FROM oee_minutes o
   USING _cut c
   WHERE o."jobOrderId" IN (SELECT id FROM _jo)
     AND o."bucketStart" >= c.t;

  DELETE FROM oee_schedule_minutes o
   USING _cut c
   WHERE o."jobOrderId" IN (SELECT id FROM _jo)
     AND o."bucketStart" >= c.t;

  -- ── 4. Downtime events that were never real ───────────────────────────────
  UPDATE downtime_events d
     SET "endTime" = LEAST(COALESCE(d."endTime", c.t), c.t),
         "durationMinutes" = EXTRACT(EPOCH FROM (LEAST(COALESCE(d."endTime", c.t), c.t) - d."startTime")) / 60,
         reason = concat_ws(' ', d.reason, '[trimmed: job order had ended]')
    FROM _cut c
   WHERE d."jobOrderId" IN (SELECT id FROM _jo)
     AND COALESCE(d."endTime", c.t) > c.t;

  \echo ''
  \echo 'RESULT -- the orders now end at the cut'
  SELECT m.code, j.status, j."actualEnd" + interval '3 hours' AS ends_riyadh
    FROM job_orders j JOIN machines m ON m.id = j."machineId"
   WHERE j.id IN (SELECT id FROM _jo) ORDER BY m.code;

  \echo ''
  \echo 'STATES AT THE CUT'
  SELECT m.code, r.state, r."startTime" + interval '3 hours' AS riyadh_start,
         round(r."durationMinutes"::numeric, 0) AS minutes
    FROM machine_state_records r JOIN machines m ON m.id = r."machineId"
   WHERE r.notes LIKE '%job order had ended%' ORDER BY m.code;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Read the production-after-the-cut table above before applying.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif
