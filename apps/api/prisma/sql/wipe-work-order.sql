-- Remove a work order and everything recorded against it.
--
-- Written for pgAdmin: run section 1, read it, then run section 2 only if you
-- agree with what it says. Change the order number in ONE place, at the top.
--
-- ══ WHAT THIS DELETES, AND WHY IT IS NOT ONE STATEMENT ══════════════════════
--
-- Twenty foreign keys point at work_orders and job_orders, and they do three
-- different things. Deleting the work order alone would fail on some, silently
-- orphan others, and cascade the rest -- so each group is handled on purpose:
--
--   CASCADE   job_orders, oee_minutes, oee_schedule_minutes,
--             job_order_materials, energy_wo_machine_kpis
--             -> these go on their own once the parent goes.
--
--   RESTRICT  scrap_logs, energy_wo_summaries
--             -> these BLOCK the delete. They must go first or nothing goes.
--
--   SET NULL  downtime_events, production_events, material_consumptions,
--             batch_records, finished_goods_lots, inspection_results,
--             material_requests, reschedule_requests, maintenance_wos
--             -> these SURVIVE, pointing at nothing. Some of them should:
--                a finished-goods lot is a record of real product and must not
--                vanish because a work order was cleared. Others are only this
--                run's traces and are removed explicitly below.
--
-- ══ AND ONE THAT IS NOT A FOREIGN KEY AT ALL ════════════════════════════════
-- `gateway_counter_states.jobOrderId` is a plain column with no constraint, so
-- nothing tells it the job order is gone. Left behind, the edge gateway still
-- believes it is counting for a job order that no longer exists -- and the next
-- order it sees is then NOT a handover, so the counters are not reset. It is
-- cleared here, which is exactly what a handover would have done.

-- ── The order to remove ─────────────────────────────────────────────────────
-- pgAdmin has no psql variables, so this is a CTE the rest of the script joins
-- to. Change it here and nowhere else.
--
--   WO-2026-0005

-- ═══════════════════════════════════════════════════════════════════════════
-- 0. IF IT HANGS  -- who is holding the lock?
--
-- Run this in a SECOND connection while the delete is stuck. It names the
-- session that is blocking and what it is waiting on.
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT a.pid, a.state, a.wait_event_type, a.wait_event,
--        age(now(), a.xact_start) AS in_transaction_for,
--        left(a.query, 90) AS query
--   FROM pg_stat_activity a
--  WHERE a.datname = current_database()
--    AND a.pid <> pg_backend_pid()
--    AND (a.state <> 'idle' OR a.xact_start IS NOT NULL)
--  ORDER BY a.xact_start NULLS LAST;
--
-- The usual culprit is a row with state = 'idle in transaction' and a long
-- `in_transaction_for` -- a psql that was Ctrl-C'd on an earlier attempt still
-- holding its locks. Ending it releases them:
--
-- SELECT pg_terminate_backend(<pid>);
--
-- Do NOT terminate the api or edge gateway connections to force this through.
-- They are writing production data; wait for them or stop the service properly.

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. PREVIEW  -- run this on its own first. It changes nothing.
-- ═══════════════════════════════════════════════════════════════════════════
WITH wo AS (SELECT id FROM work_orders WHERE "orderNumber" = 'WO-2026-0005'),
     jo AS (SELECT id FROM job_orders WHERE "workOrderId" IN (SELECT id FROM wo))
SELECT 'work_orders'                      AS table_name, count(*) AS rows, 'deleted'      AS fate FROM wo
UNION ALL SELECT 'job_orders',            count(*), 'cascade'  FROM jo
UNION ALL SELECT 'oee_minutes',           count(*), 'cascade'  FROM oee_minutes           WHERE "jobOrderId" IN (SELECT id FROM jo)
UNION ALL SELECT 'oee_schedule_minutes',  count(*), 'cascade'  FROM oee_schedule_minutes  WHERE "jobOrderId" IN (SELECT id FROM jo)
UNION ALL SELECT 'job_order_materials',   count(*), 'cascade'  FROM job_order_materials   WHERE "jobOrderId" IN (SELECT id FROM jo)
UNION ALL SELECT 'energy_wo_machine_kpis',count(*), 'cascade'  FROM energy_wo_machine_kpis WHERE "workOrderId" IN (SELECT id FROM wo)
UNION ALL SELECT 'scrap_logs',            count(*), 'BLOCKS - deleted first'  FROM scrap_logs          WHERE "workOrderId" IN (SELECT id FROM wo) OR "jobOrderId" IN (SELECT id FROM jo)
UNION ALL SELECT 'energy_wo_summaries',   count(*), 'BLOCKS - deleted first'  FROM energy_wo_summaries WHERE "workOrderId" IN (SELECT id FROM wo)
UNION ALL SELECT 'downtime_events',       count(*), 'deleted explicitly'      FROM downtime_events     WHERE "workOrderId" IN (SELECT id FROM wo) OR "jobOrderId" IN (SELECT id FROM jo)
UNION ALL SELECT 'production_events',     count(*), 'deleted explicitly'      FROM production_events   WHERE "workOrderId" IN (SELECT id FROM wo)
UNION ALL SELECT 'material_consumptions', count(*), 'deleted explicitly'      FROM material_consumptions WHERE "workOrderId" IN (SELECT id FROM wo)
UNION ALL SELECT 'machine_state_records', count(*), 'work order cleared, row KEPT' FROM machine_state_records WHERE "workOrderId" IN (SELECT id FROM wo)
UNION ALL SELECT 'gateway_counter_states',count(*), 'job order cleared, row KEPT'  FROM gateway_counter_states WHERE "jobOrderId" IN (SELECT id FROM jo)
UNION ALL SELECT 'finished_goods_lots',   count(*), 'KEPT - real product'     FROM finished_goods_lots WHERE "workOrderId" IN (SELECT id FROM wo)
UNION ALL SELECT 'batch_records',         count(*), 'KEPT - real record'      FROM batch_records       WHERE "workOrderId" IN (SELECT id FROM wo)
UNION ALL SELECT 'inspection_results',    count(*), 'KEPT - real measurement' FROM inspection_results  WHERE "workOrderId" IN (SELECT id FROM wo)
ORDER BY 1;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. DELETE  -- select and run this whole block together.
--
-- It opens a transaction and does NOT commit. Read the row counts pgAdmin
-- reports, then run COMMIT; yourself if they match the preview. Anything
-- unexpected -- run ROLLBACK; instead.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;

-- ── Fail fast instead of hanging ────────────────────────────────────────────
-- On the live plant this hung with no message at all. Not a slow query -- the
-- same delete plans in 0.6 ms -- but a LOCK: the API and the edge gateway write
-- downtime events continuously, and a session that stopped mid-transaction (a
-- Ctrl-C on an earlier attempt is enough) holds its locks until it is closed.
--
-- Without this, psql simply sits there and the operator cannot tell a lock from
-- a crash from a slow disk. Five seconds, then an error naming the table.
-- If it fires, see section 0 below.
SET LOCAL lock_timeout = '5s';

-- The two that would otherwise refuse the delete.
DELETE FROM scrap_logs
 WHERE "workOrderId" IN (SELECT id FROM work_orders WHERE "orderNumber" = 'WO-2026-0005')
    OR "jobOrderId"  IN (SELECT j.id FROM job_orders j JOIN work_orders w ON w.id = j."workOrderId"
                          WHERE w."orderNumber" = 'WO-2026-0005');

DELETE FROM energy_wo_summaries
 WHERE "workOrderId" IN (SELECT id FROM work_orders WHERE "orderNumber" = 'WO-2026-0005');

-- This run's own traces. They would survive with a null work order otherwise,
-- which leaves a stop and a thousand events belonging to nothing.
DELETE FROM downtime_events
 WHERE "workOrderId" IN (SELECT id FROM work_orders WHERE "orderNumber" = 'WO-2026-0005')
    OR "jobOrderId"  IN (SELECT j.id FROM job_orders j JOIN work_orders w ON w.id = j."workOrderId"
                          WHERE w."orderNumber" = 'WO-2026-0005');

DELETE FROM production_events
 WHERE "workOrderId" IN (SELECT id FROM work_orders WHERE "orderNumber" = 'WO-2026-0005');

DELETE FROM material_consumptions
 WHERE "workOrderId" IN (SELECT id FROM work_orders WHERE "orderNumber" = 'WO-2026-0005');

-- The gateway's link to job orders that are about to stop existing. No foreign
-- key does this, and leaving it means the edge does not treat the next order as
-- a handover -- so its counters are never reset.
UPDATE gateway_counter_states
   SET "jobOrderId" = NULL
 WHERE "jobOrderId" IN (SELECT j.id FROM job_orders j JOIN work_orders w ON w.id = j."workOrderId"
                         WHERE w."orderNumber" = 'WO-2026-0005');

-- State records are kept: they describe what the MACHINE did, which happened
-- whether or not this order still exists. Only the pointer is cleared.
UPDATE machine_state_records
   SET "workOrderId" = NULL
 WHERE "workOrderId" IN (SELECT id FROM work_orders WHERE "orderNumber" = 'WO-2026-0005');

-- Finally the order itself. job_orders, oee_minutes, oee_schedule_minutes,
-- job_order_materials and energy_wo_machine_kpis go with it by cascade.
DELETE FROM work_orders WHERE "orderNumber" = 'WO-2026-0005';

-- Read the counts above. Then, and only then:
--   COMMIT;
-- Anything unexpected:
--   ROLLBACK;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. AFTER COMMITTING -- confirm nothing was left behind.
-- ═══════════════════════════════════════════════════════════════════════════
-- SELECT 'work_orders (must be 0)' AS check_, count(*) AS n
--   FROM work_orders WHERE "orderNumber" = 'WO-2026-0005'
-- UNION ALL
-- SELECT 'orphaned oee_minutes (must be 0)', count(*) FROM oee_minutes o
--   LEFT JOIN job_orders j ON j.id = o."jobOrderId" WHERE j.id IS NULL;
--
-- ── One number that is NOT a failure ────────────────────────────────────────
-- Do not check the total count of gateway_counter_states pointing at missing
-- job orders. Measured on this plant it is already 9 -- rows from orders
-- deleted back in mid-August, mostly on tags that are themselves deactivated
-- (see delete-dead-tags.sql). They have nothing to do with this script, and a
-- check that reported them would look exactly like this script having failed.
--
-- What matters is that THIS order left none behind, and the UPDATE above is
-- what guarantees it. To see the pre-existing ones for their own sake:
--
-- SELECT t.name, m.code, g."jobOrderId", g."lastEdgeAt"
--   FROM gateway_counter_states g
--   JOIN tag_definitions t ON t.id = g."tagId"
--   LEFT JOIN machines m ON m.id = t."machineId"
--   LEFT JOIN job_orders j ON j.id = g."jobOrderId"
--  WHERE g."jobOrderId" IS NOT NULL AND j.id IS NULL
--  ORDER BY g."lastEdgeAt" DESC NULLS LAST;
