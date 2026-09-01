-- Switch the line balancer ON as a DETECTOR, without letting it write.
--
-- ══ WHAT THIS IS FOR ═══════════════════════════════════════════════════════
-- The counters on this line disagree with each other by a factor of six, and
-- nobody finds out until after the shift. The mechanism that would say so
-- while the shift is still running already exists, is already configured, and
-- has been switched off since 24 Aug 2026:
--
--   machine  enabled  isAnchor  buffer  maxCorrectionPct  applyAdjustment
--   M1         f         f        12 INNER      10%             f
--   M2         f         f        40 CARTON     10%             f
--   M3         f         t         1 PALLET     10%             f
--   M4         f         f         0 PALLET     10%             f
--
-- LineBalanceService compares each step against the one before it. Material is
-- conserved: what left one machine either entered the next, is still on the
-- conveyor between them, or was taken off by hand. Once the conveyor capacity
-- is known, the gap physics allows is a NUMBER, and anything past it is a
-- counting error rather than a mystery.
--
-- ══ WHY DETECT-ONLY, AND NOT CORRECT ═══════════════════════════════════════
-- The write path is guarded by BOTH flags:
--
--     if (!step.applyAdjustment || !step.enabled) continue;
--
-- so `enabled = true` with `applyAdjustment = false` reports and touches
-- nothing. That is deliberately as far as this script goes.
--
-- Correcting requires an anchor that can be trusted, and on this line there
-- isn't one. Measured against the plant's own figure for WO-2026-0005:
--
--   M1 counted 1.8x the truth        M2 1.8x        M3 1.9x        M4 6.5x
--
-- A balancer told to correct toward a bad anchor would move every other
-- machine's figure to agree with a wrong one, and it would do it silently and
-- at speed. Detecting is the honest use of it until a counter is trusted.
--
-- ══ ⚠ THE CONFIGURED ANCHOR IS THE WORST CHOICE ON THIS LINE ═══════════════
-- `isAnchor` is set on M3. M3 and M4 both read address 2 on EDGE_COUNTER_M03 --
-- one physical input, counted on opposite edges -- so the anchor and the final
-- step are the same signal. Anchoring to M3 asks the line to agree with the one
-- reading that has no independent confirmation anywhere.
--
-- This script does NOT move the anchor, because every candidate is also
-- over-counting and moving it would only change which wrong number the others
-- are compared against. It is flagged here because the moment one counter is
-- trusted, that is the first thing to change.
--
-- ══ WHAT YOU WILL SEE ══════════════════════════════════════════════════════
-- `maxCorrectionPct` is 10 and the real gaps are several hundred per cent, so
-- every step will come back CLAMPED with an alarm beside it. That is the
-- designed behaviour and it is the useful one: the worse a counter gets, the
-- louder it becomes. CLAMPED here means "the disagreement is far past anything
-- the conveyor can explain", which is exactly the finding.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -f line-balance-detect-only.sql
--   APPLY:    { cat line-balance-detect-only.sql; echo "COMMIT;"; } | psql ... -v apply=1
--   REVERT:   ... -v apply=1 -v off=1
--
-- Opens a transaction and never closes it, so a plain run cannot save anything.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif
\if :{?off}
\else
  \set off 0
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';

\echo ''
\echo 'BEFORE'
SELECT m.code, c.enabled, c."isAnchor", c."bufferToNextQty", c."bufferUnit",
       c."transitSec", c."maxCorrectionPct", c."applyAdjustment"
  FROM line_balance_config c JOIN machines m ON m.id = c."machineId"
 ORDER BY m.code;

\echo ''
\echo 'LINKS WITH NO MEASURED BUFFER (these stay unbalanced, by design)'
\echo 'An unmeasured conveyor is left alone rather than assumed empty.'
SELECT m.code, c."bufferToNextQty", c."bufferUnit"
  FROM line_balance_config c JOIN machines m ON m.id = c."machineId"
 WHERE c."bufferToNextQty" IS NULL OR c."bufferToNextQty" = 0
 ORDER BY m.code;

\if :apply

  \if :off
    UPDATE line_balance_config SET enabled = false, "applyAdjustment" = false;
    \echo ''
    \echo 'REVERTED -- the balancer is off again.'
  \else
    -- enabled ON, applyAdjustment deliberately left OFF.
    --
    -- Written as two explicit assignments rather than one. Setting only
    -- `enabled` and trusting `applyAdjustment` to already be false would make
    -- this script's safety depend on the state it found, and a row someone had
    -- previously armed would start writing the moment it was enabled.
    UPDATE line_balance_config
       SET enabled = true,
           "applyAdjustment" = false;
    \echo ''
    \echo 'ENABLED IN DETECT-ONLY MODE.'
  \endif

  \echo ''
  \echo 'AFTER'
  SELECT m.code, c.enabled, c."isAnchor", c."applyAdjustment"
    FROM line_balance_config c JOIN machines m ON m.id = c."machineId"
   ORDER BY m.code;

  \echo ''
  \echo 'VERIFY -- nothing may write (want 0 rows, in either mode)'
  -- No `:off` in this predicate. psql variables interpolate as raw text, so a
  -- numeric flag lands inside SQL as `NOT 0`, which is not a boolean and
  -- aborts the transaction. The check does not need the flag anyway: neither
  -- mode may leave a row able to write, so the condition is the same for both.
  SELECT m.code FROM line_balance_config c JOIN machines m ON m.id = c."machineId"
   WHERE c."applyAdjustment";

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
  \echo 'Takes effect on the balancer next tick -- no gateway restart.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif
