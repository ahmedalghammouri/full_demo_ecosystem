-- Make the rest of the line IDLE wherever M1 was IDLE.
--
-- ── What this repairs ───────────────────────────────────────────────────────
-- On 25 Aug 2026 every job order on Line 1 was PAUSED. M1's Run Mode bit
-- happened to drop, so it took StatusService.stoppedState — which counted only
-- EXECUTING orders — and correctly read IDLE. M2, M3 and M4 kept their bits
-- high, took StateInference.hasWorkScheduled, which counted PAUSED as work too,
-- and went on inferring STARVED and BLOCKED for an order nobody was running.
--
-- The code no longer does that (one definition of work, EXECUTING only). This
-- backfills the history that was written before the fix.
--
-- ── Why it is not keyed on "no job order" ───────────────────────────────────
-- That would be the honest criterion, and the data cannot supply it: job_orders
-- keeps actualStart and actualEnd, and NOTHING records when an order was
-- paused. Measured on this plant, only ~17 minutes across all four machines
-- fall outside any order's span, because a paused order's span still covers the
-- pause. So M1's own IDLE is used as the proxy — it is the one machine whose
-- signal caught the truth.
--
-- ── The guard, which is the important part ──────────────────────────────────
-- A blanket rewrite would be wrong. Measured over 23–26 Aug, M3 shows 1641
-- minutes of RUNNING and M2 shows 1200 inside M1's idle windows. M1 being idle
-- does NOT prove the line was: M1 can be stopped while the others work, and
-- those minutes are real production with real counts behind them.
--
-- So only states that could have been INFERRED are touched — STARVED, BLOCKED
-- and BREAKDOWN, which is exactly what the old rule produced from a run bit and
-- a line context. RUNNING is never rewritten: a machine that was running was
-- demonstrably producing, and no amount of reasoning about M1 outweighs that.
--
-- ── Usage ────────────────────────────────────────────────────────────
--   PREVIEW  (changes nothing)
--     docker exec -i <pg> psql -U i360_user -d industry360 < idle-follows-m1.sql
--
--   APPLY    (you have to say COMMIT out loud)
--     { cat idle-follows-m1.sql; echo "COMMIT;"; } | docker exec -i <pg> psql -U i360_user -d industry360 -v apply=1
--
-- THIS FILE CANNOT COMMIT ON ITS OWN, and that is deliberate. It opens a
-- transaction and never closes it, so a plain run — piped or with -f — hits
-- end-of-input with the transaction open and psql rolls the whole thing back.
-- Verified in both directions: piped without the COMMIT, even the CREATE TABLE
-- vanished; piped with it, the change persisted.
--
-- The consequence worth stating: running it with -v apply=1 and reading
-- "UPDATE 62" does NOT mean anything was saved. Only the appended COMMIT does.
--
-- Edit the window in the `params` CTE first. Take a backup: this rewrites
-- recorded measurements, and the originals are not kept anywhere else.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

-- The window, in PLANT LOCAL TIME, overridable without touching this file:
--   -v win_from='2026-08-25 00:00:00' -v win_to='2026-08-27 00:00:00'
-- Editing a script on a server to change a date is how the wrong date gets
-- repaired, so the date is an argument and the file stays as reviewed.
\if :{?win_from}
\else
  \set win_from '2026-08-25 00:00:00'
\endif
\if :{?win_to}
\else
  \set win_to '2026-08-26 00:00:00'
\endif

BEGIN;

CREATE TEMP TABLE _repair_params ON COMMIT DROP AS
SELECT
  -- The window to repair, in PLANT LOCAL TIME (Asia/Riyadh). Pass -v win_from
  -- and -v win_to to narrow it to the shift you are actually fixing -- a wide
  -- window rewrites more history than anyone reviewed.
  --
  -- The conversion is not decoration. These columns are `timestamp WITHOUT time
  -- zone` holding UTC, so a bare TIMESTAMP '2026-08-25 00:00:00' means UTC
  -- midnight = 03:00 in the plant. Written that way the script would repair
  -- three hours of the wrong day at each end and miss three of the right one.
  (:'win_from'::timestamp AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS win_from,
  (:'win_to'::timestamp   AT TIME ZONE 'Asia/Riyadh') AT TIME ZONE 'utc' AS win_to,
  'M1'::text                      AS leader_code,
  -- Only these are ever rewritten. RUNNING is deliberately absent.
  ARRAY['STARVED', 'BLOCKED', 'BREAKDOWN']::text[] AS rewritable;

-- M1's idle windows inside the repair window, clipped to it.
CREATE TEMP TABLE _idle ON COMMIT DROP AS
SELECT
  GREATEST(r."startTime", p.win_from) AS s,
  LEAST(COALESCE(r."endTime", now() AT TIME ZONE 'utc'), p.win_to) AS e
FROM _repair_params p
JOIN machines m ON m.code = p.leader_code
JOIN machine_state_records r ON r."machineId" = m.id
WHERE r.state = 'IDLE'
  AND r."startTime" < p.win_to
  AND COALESCE(r."endTime", now() AT TIME ZONE 'utc') > p.win_from
  AND GREATEST(r."startTime", p.win_from)
      < LEAST(COALESCE(r."endTime", now() AT TIME ZONE 'utc'), p.win_to);

-- Every record on another machine that overlaps one of those windows, with the
-- overlap itself worked out. A record may span a window edge, so the three
-- pieces are computed here rather than assumed away.
CREATE TEMP TABLE _hits ON COMMIT DROP AS
SELECT
  r.id,
  r."machineId",
  m.code                       AS machine,
  r.state::text                AS state,
  r."factoryId",
  r."startTime"                AS rec_from,
  COALESCE(r."endTime", now() AT TIME ZONE 'utc') AS rec_to,
  r."endTime"                  AS rec_end_raw,
  GREATEST(r."startTime", i.s) AS ov_from,
  LEAST(COALESCE(r."endTime", now() AT TIME ZONE 'utc'), i.e) AS ov_to,
  r."workOrderId", r."skuId", r."shiftInstanceId", r.source, r.notes
FROM _idle i
JOIN machine_state_records r
  ON r."startTime" < i.e
 AND COALESCE(r."endTime", now() AT TIME ZONE 'utc') > i.s
JOIN machines m ON m.id = r."machineId"
CROSS JOIN _repair_params p
WHERE m.code <> p.leader_code
  AND r.state::text = ANY (p.rewritable);

-- ── Preview ─────────────────────────────────────────────────────────────────
\echo ''
\echo 'WHAT WOULD CHANGE — by machine and state'
SELECT machine, state,
       count(*) AS records,
       round(sum(EXTRACT(EPOCH FROM (ov_to - ov_from)) / 60)::numeric, 0) AS minutes
FROM _hits GROUP BY 1, 2 ORDER BY 1, 4 DESC;

\echo ''
\echo 'WHAT IS PROTECTED — running minutes inside the same windows, left alone'
SELECT m.code AS machine, r.state::text AS state,
       count(*) AS records,
       round(sum(EXTRACT(EPOCH FROM (
         LEAST(COALESCE(r."endTime", now() AT TIME ZONE 'utc'), i.e)
       - GREATEST(r."startTime", i.s))) / 60)::numeric, 0) AS minutes
FROM _idle i
JOIN machine_state_records r
  ON r."startTime" < i.e AND COALESCE(r."endTime", now() AT TIME ZONE 'utc') > i.s
JOIN machines m ON m.id = r."machineId"
CROSS JOIN _repair_params p
WHERE m.code <> p.leader_code
  AND NOT (r.state::text = ANY (p.rewritable))
GROUP BY 1, 2 ORDER BY 1, 4 DESC;

\if :apply

  -- ── 1. The tail that survives AFTER the idle window ───────────────────────
  -- Inserted before the original is trimmed, so its bounds are still readable.
  INSERT INTO machine_state_records
    (id, "factoryId", "machineId", "shiftInstanceId", "workOrderId", "skuId",
     state, "startTime", "endTime", "durationMinutes", "isPlannedStop", notes, source)
  SELECT gen_random_uuid()::text, h."factoryId", h."machineId", h."shiftInstanceId",
         h."workOrderId", h."skuId", h.state::"MachineState",
         h.ov_to, h.rec_end_raw,
         EXTRACT(EPOCH FROM (h.rec_to - h.ov_to)) / 60,
         false,
         concat_ws(' ', h.notes, '[idle-repair tail of ', h.id, ']'),
         h.source
  FROM _hits h
  WHERE h.rec_to > h.ov_to;

  -- ── 2. The head that survives BEFORE it ───────────────────────────────────
  INSERT INTO machine_state_records
    (id, "factoryId", "machineId", "shiftInstanceId", "workOrderId", "skuId",
     state, "startTime", "endTime", "durationMinutes", "isPlannedStop", notes, source)
  SELECT gen_random_uuid()::text, h."factoryId", h."machineId", h."shiftInstanceId",
         h."workOrderId", h."skuId", h.state::"MachineState",
         h.rec_from, h.ov_from,
         EXTRACT(EPOCH FROM (h.ov_from - h.rec_from)) / 60,
         false,
         concat_ws(' ', h.notes, '[idle-repair head of ', h.id, ']'),
         h.source
  FROM _hits h
  WHERE h.rec_from < h.ov_from;

  -- ── 3. The original becomes the IDLE overlap ──────────────────────────────
  -- Rewritten rather than deleted and replaced, so anything referencing this
  -- row by id still resolves. The note says what it was, so the change is
  -- reversible by hand and visible to anyone who reads the row later.
  UPDATE machine_state_records r
  SET state = 'IDLE',
      "startTime" = h.ov_from,
      "endTime" = h.ov_to,
      "durationMinutes" = EXTRACT(EPOCH FROM (h.ov_to - h.ov_from)) / 60,
      "downtimeCauseId" = NULL,
      "isPlannedStop" = false,
      notes = concat_ws(' ', r.notes,
        '[idle-repair: was ' || h.state || ', no order was executing]')
  FROM _hits h
  WHERE r.id = h.id;

  \echo ''
  \echo 'APPLIED. Review the counts above, then COMMIT or ROLLBACK.'
  \echo 'This transaction is still OPEN — nothing is permanent until you commit.'

\else
  \echo ''
  \echo 'PREVIEW ONLY — nothing was changed.'
  \echo 'Re-run with  -v apply=1  to apply inside an open transaction.'
\endif

-- Left open on purpose when applying: read the numbers, then decide.
-- psql will roll back automatically if you disconnect without committing.
