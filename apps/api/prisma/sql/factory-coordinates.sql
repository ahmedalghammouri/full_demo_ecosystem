-- Facility coordinates, without Node.
--
-- ══ WHY THIS EXISTS BESIDE THE SEED ════════════════════════════════════════
-- `prisma/seed-factory-coordinates.ts` does the same five updates, and on the
-- Hostinger box it dies:
--
--     FATAL ERROR: Reached heap limit Allocation failed
--     - JavaScript heap out of memory        (at ~384 MB)
--
-- That is `ts-node` type-checking the whole api project before it runs a line,
-- not the update. The work itself is five UPDATE statements against five rows;
-- it needs no compiler, no Prisma client and no heap. This file is the same
-- change with none of that, so it runs on a box that cannot afford ts-node.
--
-- The seed stays for local use, where the type check is useful. Both write the
-- same numbers -- if one is ever edited, edit the other.
--
-- ══ WHERE THE NUMBERS COME FROM ════════════════════════════════════════════
-- The five Google Maps links the client supplied, each resolved by following
-- the redirect and reading the `!8m2!3d<lat>!4d<lng>` pair out of the expanded
-- URL -- that pair is the place's own coordinate, not the viewport centre in
-- the `@lat,lng,zoom` segment, which is a different number and is the one it is
-- easy to take by mistake.
--
--   NPDF  https://maps.app.goo.gl/eQPmPB48CgjsSj34A
--          -> "Saudi Industrial Detergents Company"     26.2539087, 49.9876848
--   SDPF   https://maps.app.goo.gl/PYQT8hM7hsVLnuV18
--          -> "Saudi detergent powder factory (sdpf)"   25.9267784, 49.9469883
--   SAF    https://maps.app.goo.gl/m8po6Ysbv1AoAiqS7
--          -> "NPDF Aerosol Factory"                   25.9265816, 49.9448726
--   RMTC  https://maps.app.goo.gl/N9GvhpLf3tyyhM4JA
--          -> EIDA3448, Dammam 34326                    26.2524912, 49.9857344
--   AFCC   https://maps.app.goo.gl/bSRxZDGSTE29uzND9
--          -> "المصنع الوطني لصابون البودره", Jeddah        21.4112773, 39.2425602
--
-- ══ ⚠ TWO FACILITIES CHANGE REGION ═════════════════════════════════════════
-- The seeded data had RMTC in Jeddah and AFCC in Dammam. These links put them
-- the other way round, about 1,220 km each. The Jeddah pin resolves to
-- "المصنع الوطني لصابون البودره" -- National Powder Soap Factory -- which reads as
-- AFCC's own name, so the original pair looks transposed and these links
-- correct it. The preview prints the distance so the swap cannot pass
-- unnoticed; confirm it verbally before the review.
--
-- ══ USAGE ══════════════════════════════════════════════════════════════════
--   PREVIEW:  psql ... -f factory-coordinates.sql
--   APPLY:    { cat factory-coordinates.sql; echo "COMMIT;"; } | psql ... -v apply=1
--
-- Idempotent: a plain UPDATE keyed on factory code, so a repeat run is a no-op
-- and reports 0 m moved. Opens a transaction and never closes it, so a plain
-- run cannot save anything -- only an appended COMMIT; keeps the work.

\set ON_ERROR_STOP on
\if :{?apply}
\else
  \set apply 0
\endif

BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TEMP TABLE _site ON COMMIT DROP AS
SELECT * FROM (VALUES
  ('SDPF',  25.9267784, 49.9469883, 'Dammam', '3rd Industrial City, Dammam, Eastern Province',
            'Saudi detergent powder factory (sdpf)'),
  ('NPDF', 26.2539087, 49.9876848, 'Dammam', '2nd Industrial City, Dammam 34326, Eastern Province',
            'Saudi Industrial Detergents Company'),
  ('SAF',   25.9265816, 49.9448726, 'Dammam', '3rd Industrial City, Dammam, Eastern Province',
            'NPDF Aerosol Factory'),
  ('RMTC', 26.2524912, 49.9857344, 'Dammam', '2nd Industrial City, Dammam 34326, Eastern Province',
            'EIDA3448, Dammam 34326 - moved from Jeddah, please confirm'),
  ('AFCC',  21.4112773, 39.2425602, 'Jeddah', 'Jeddah, Makkah Province',
            'National Powder Soap Factory, Jeddah - moved from Dammam, please confirm')
) AS v(code, lat, lng, city, address, resolved_as);

-- How far each pin travels. Reported rather than assumed: a hundred metres is a
-- corrected pin, a thousand kilometres is a different city and wants a second
-- pair of eyes before it reaches a customer's screen.
CREATE TEMP TABLE _move ON COMMIT DROP AS
SELECT s.code, f.name, f.lat AS old_lat, f.lng AS old_lng, f.city AS old_city,
       s.lat AS new_lat, s.lng AS new_lng, s.city AS new_city, s.resolved_as,
       CASE WHEN f.lat IS NULL OR f.lng IS NULL THEN NULL ELSE
         2 * 6371000 * asin(sqrt(
           power(sin(radians(s.lat - f.lat) / 2), 2)
           + cos(radians(f.lat)) * cos(radians(s.lat))
             * power(sin(radians(s.lng - f.lng) / 2), 2)))
       END AS moved_m
  FROM _site s LEFT JOIN factories f ON f.code = s.code;

\echo ''
\echo 'BEFORE AND AFTER'
SELECT code, name,
       old_lat, old_lng, new_lat, new_lng,
       CASE WHEN moved_m IS NULL THEN 'was NULL'
            WHEN moved_m > 1000 THEN round((moved_m / 1000)::numeric, 1) || ' km'
            ELSE round(moved_m::numeric, 0) || ' m' END AS moved,
       CASE WHEN old_city IS DISTINCT FROM new_city
            THEN old_city || ' -> ' || new_city ELSE '' END AS city_change
  FROM _move ORDER BY code;

\echo ''
\echo 'ANY CODE IN THE LIST THAT THIS DATABASE DOES NOT HAVE (want 0 rows)'
SELECT code FROM _move WHERE name IS NULL;

\if :apply

  UPDATE factories f
     SET lat = s.lat, lng = s.lng, city = s.city, address = s.address
    FROM _site s
   WHERE f.code = s.code;

  \echo ''
  \echo 'RESULT'
  SELECT code, name, lat, lng, city, address FROM factories ORDER BY code;

  -- A NULL coordinate does not merely drop the pin: the facility disappears
  -- from the network list beside the map as well. Checked across EVERY factory
  -- row, not just the five touched here, because a sixth site added later
  -- would fail the same way and this is the only place that would catch it.
  \echo ''
  \echo 'VERIFY -- factories that will not render (want 0 rows)'
  SELECT code, name FROM factories WHERE lat IS NULL OR lng IS NULL;

  \echo ''
  \echo 'APPLIED, NOT SAVED. Append COMMIT; to keep it.'
  \echo 'The dashboard reads these live from GET /auth/factories/overview,'
  \echo 'so a browser refresh is enough -- no rebuild, no api restart.'
\else
  \echo ''
  \echo 'PREVIEW ONLY -- nothing changed.'
  \echo 'Apply with:  -v apply=1   and an appended COMMIT;'
\endif
