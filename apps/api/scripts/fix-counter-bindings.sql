-- ── Counter bindings that cannot be right ───────────────────────────────────
-- A GOOD counter and a TOTAL counter cannot share one discrete input: they would
-- see the same pulse train, so Bad = Total - Good is structurally zero. Two of
-- the three modules were wired that way in the config.

BEGIN;

-- M1 Powder Filler — both counters sat on DI0, so the filler could never report a
-- single reject. Its own tag name says DI1; the address did not.
UPDATE tag_definitions t SET address = '1'
FROM devices d
WHERE d.id = t."deviceId" AND d.name = 'EDGECOUNTER01'
  AND t.name = 'EDGECOUNTER01_DI1' AND t."counterRole" = 'GOOD';

-- M3 Carton Packer — TOTAL and GOOD were swapped against the module's own numbering
-- (the tags are literally named after the inputs they are not on). Total then
-- read lower than Good, so Bad clamped to zero and the cartoner could never
-- report a reject either.
UPDATE tag_definitions t SET address = '0'
FROM devices d
WHERE d.id = t."deviceId" AND d.name = 'EDGE_COUNTER_M03'
  AND t.name = 'Discrete Input 0' AND t."counterRole" = 'TOTAL';
UPDATE tag_definitions t SET address = '1'
FROM devices d
WHERE d.id = t."deviceId" AND d.name = 'EDGE_COUNTER_M03'
  AND t.name = 'Discrete Input 1' AND t."counterRole" = 'GOOD';

-- M4 Euro-Pack Robot — a GOOD counter on DI2, which is M5's TOTAL. The
-- palletiser was counting the wrapper's pallets as its own output. It has no
-- counter on the plant module at all (I360's mapping gives it a run-mode bit and
-- nothing else), so the tag is retired rather than moved: there is no free input
-- for it to be right on.
UPDATE tag_definitions t SET "isActive" = FALSE
FROM devices d
WHERE d.id = t."deviceId" AND d.name = 'EDGE_COUNTER_M03'
  AND t.name = 'EDGE_COUNTER_M04_DI3';

COMMIT;

SELECT d.name AS device, t.address, t."counterRole", m.code, t.name
FROM tag_definitions t
JOIN devices d ON d.id = t."deviceId"
LEFT JOIN machines m ON m.id = t."machineId"
WHERE t."isActive" AND t."tagType" = 'COUNTER'
ORDER BY d.name, t.address::int;
