-- Delete the tag definitions nothing can ever read.
--
-- ── Run the SELECT first, and read it ───────────────────────────────────────
-- This is written for pgAdmin, where each statement is run on its own. Run
-- section 1, look at the rows, then run section 2 only if you agree with them.
--
-- ── What deleting a tag takes with it ───────────────────────────────────────
-- Three tables point at tag_definitions. Checked on this database, not assumed:
--
--   alarm_definitions.tagId       NO ACTION -- a referenced tag CANNOT be
--                                             deleted; the statement errors out
--                                             rather than removing an alarm
--   gateway_counter_states.tagId  CASCADE   -- the gateway's last-seen level and
--                                             raw total for that tag go with it
--   tag_current_values.tagId      CASCADE   -- the live value goes with it
--
-- The cascades are the reason to be sure a tag is dead. `gateway_counter_states`
-- is where a counter's running total lives; deleting the row of a tag that is
-- still being polled would reset that counter to zero mid-shift.
--
-- Measured here: none of the candidates below is referenced by any alarm.
--
-- ── Why these three groups, and no others ───────────────────────────────────
-- (a) NO DEVICE. A tag with no device has nothing to poll it. It cannot
--     produce a reading under any configuration.
-- (b) A DELETED MACHINE. Machines removed from the line are prefixed 'X-'.
--     Their tags describe equipment that is not on the floor.
-- (c) INACTIVE AND SUPERSEDED ON THE SAME ADDRESS. Deactivated tags on a live
--     device, where an ACTIVE tag already covers the same device and address.
-- (d) INACTIVE AND THE ROLE IS COVERED. Deactivated, and the same machine
--     already has an ACTIVE tag in the same counter role -- so the job that tag
--     used to do is being done, just from a different address.
--
--     (d) exists because (c) alone missed one. `EDGE_COUNTER_M02_DI1` is M2's
--     old GOOD counter on address 0; the live one sits on address 1. Nothing
--     supersedes it on ITS address, so it slipped through a criterion written
--     around addresses -- while being just as unreachable as the rest, since
--     the poller filters `isActive` before it ever looks at an address.
--
-- Both (c) and (d) require the work to be covered by something ACTIVE. That is
-- what keeps a tag someone parked deliberately -- one whose role NOTHING else
-- fills -- out of the list. Nothing active is ever a candidate, whatever else
-- is true of it.

-- ═══ 1. PREVIEW ═════════════════════════════════════════════════════════════
SELECT t.id, t.name, m.code AS machine, d.name AS device, t.address,
       t."counterRole", t."isActive",
       CASE
         WHEN t."deviceId" IS NULL       THEN 'a) no device - can never be polled'
         WHEN m.code LIKE 'X-%'          THEN 'b) machine was removed from the line'
         WHEN EXISTS (
                SELECT 1 FROM tag_definitions o
                WHERE o.id <> t.id AND o."isActive"
                  AND o."deviceId" = t."deviceId" AND o.address = t.address
              )                          THEN 'c) inactive, superseded on same address'
         ELSE                                 'd) inactive, role covered elsewhere'
       END AS why,
       (SELECT count(*) FROM alarm_definitions a WHERE a."tagId" = t.id)      AS alarms_blocking,
       (SELECT count(*) FROM gateway_counter_states g WHERE g."tagId" = t.id) AS counter_rows_lost,
       (SELECT count(*) FROM tag_current_values v WHERE v."tagId" = t.id)     AS value_rows_lost
FROM tag_definitions t
LEFT JOIN machines m ON m.id = t."machineId"
LEFT JOIN devices  d ON d.id = t."deviceId"
WHERE t."isActive" = false
  AND (
        t."deviceId" IS NULL
     OR m.code LIKE 'X-%'
     OR EXISTS (
          SELECT 1 FROM tag_definitions o
          WHERE o.id <> t.id AND o."isActive"
            AND o."deviceId" = t."deviceId" AND o.address = t.address
        )
     OR (t."counterRole" IS NOT NULL AND EXISTS (
          SELECT 1 FROM tag_definitions o
          WHERE o.id <> t.id AND o."isActive"
            AND o."machineId" = t."machineId"
            AND o."counterRole" = t."counterRole"
        ))
  )
ORDER BY why, d.name NULLS FIRST, t.name;

-- ═══ 2. DELETE ══════════════════════════════════════════════════════════════
-- Identical WHERE clause. Deliberately not a list of ids: ids differ between
-- your restored copy and production, and pasting yesterday's list into today's
-- database is how the wrong row gets deleted.
BEGIN;

DELETE FROM tag_definitions
WHERE id IN (
  SELECT t.id
  FROM tag_definitions t
  LEFT JOIN machines m ON m.id = t."machineId"
  WHERE t."isActive" = false
    AND (
          t."deviceId" IS NULL
       OR m.code LIKE 'X-%'
       OR EXISTS (
            SELECT 1 FROM tag_definitions o
            WHERE o.id <> t.id AND o."isActive"
              AND o."deviceId" = t."deviceId" AND o.address = t.address
          )
       OR (t."counterRole" IS NOT NULL AND EXISTS (
            SELECT 1 FROM tag_definitions o
            WHERE o.id <> t.id AND o."isActive"
              AND o."machineId" = t."machineId"
              AND o."counterRole" = t."counterRole"
          ))
    )
);

-- Read the row count. It must match the preview. Then, and only then:
--   COMMIT;
-- Anything else -- a different count, an error -- means ROLLBACK.
