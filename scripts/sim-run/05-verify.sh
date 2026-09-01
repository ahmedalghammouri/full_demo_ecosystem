#!/usr/bin/env bash
# Did the gateway count what the simulator emitted?
#
# Run it whenever you like while everything is up; it changes nothing.
#
# The simulator's tally is the reference, because it is the only number produced
# by the thing that made the pulses. Everything else -- the job order totals, the
# minute store, the gateway's accumulators -- is measured against it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
WO="${WO:-WO-2026-0005}"
TALLY="${TALLY:-$HERE/sim-tally.json}"
SNAP="$HERE/tally-at-order-start.json"
GAPFILE="$HERE/.last-gap"
PG="docker exec -i i360-postgres-plocal psql -U i360_user -d industry360"

hr() { printf '%s\n' "--------------------------------------------------------------------------"; }

# ── Paths for node, not for bash ────────────────────────────────────────────
# Git Bash hands out POSIX paths (/d/NEW WORKS/...) and node here is the WINDOWS
# build, which cannot resolve them. bash's own `-f` accepts them happily, so the
# mismatch surfaces as MODULE_NOT_FOUND on a file that demonstrably exists --
# which reads like a missing file and is not one. cygpath knows the rules that
# guessing at drive letters gets wrong.
win() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

echo
hr; echo "1. WHAT THE SIMULATOR EMITTED"; hr
if [ ! -f "$TALLY" ]; then
  echo "  no tally at $TALLY -- is 03-simulator.sh running?"
  exit 1
fi
node -e "
  const t = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
  console.log('  work order ' + (t.workOrder ?? '(all)') + '   ring=' + t.ring + '   speed=' + t.speed + 'x');
  console.log('  emitted between ' + t.startedAt + ' and ' + t.writtenAt);
  console.log();
  for (const r of t.rows.sort((a,b)=>a.machine.localeCompare(b.machine))) {
    console.log('    ' + r.machine.padEnd(6) + r.role.padEnd(7) + String(r.pulses).padStart(8) + ' pulses');
  }
" "$(win "$TALLY")"

echo
hr; echo "2. WHAT THE JOB ORDERS RECORDED"; hr
$PG -c "
SELECT m.code AS machine, j.\"operationName\" AS operation, j.status,
       j.\"actualQtyGood\" AS good, j.\"actualQtyRejected\" AS rejected, j.\"outputUnit\" AS unit
FROM job_orders j JOIN machines m ON m.id = j.\"machineId\"
JOIN work_orders w ON w.id = j.\"workOrderId\"
WHERE w.\"orderNumber\" = '$WO' ORDER BY j.\"sequenceOrder\";"

echo
hr; echo "3. THE TEST THAT MATTERS -- IS ANY MINUTE IMPOSSIBLE?"; hr
echo "   A minute above the machine's design rate is the 25 August jump returning."
echo "   Expect: (0 rows)"
$PG -c "
SELECT m.code AS machine, o.\"bucketStart\", o.\"goodParts\" AS counted,
       round((o.\"designSpeedPph\" / 60)::numeric, 1) AS ceiling_per_min,
       o.\"machineState\"
FROM oee_minutes o
JOIN machines m ON m.id = o.\"machineId\"
JOIN job_orders j ON j.id = o.\"jobOrderId\"
JOIN work_orders w ON w.id = j.\"workOrderId\"
WHERE w.\"orderNumber\" = '$WO'
  AND o.\"designSpeedPph\" > 0
  AND o.\"goodParts\" > (o.\"designSpeedPph\" / 60) * 1.5
ORDER BY o.\"goodParts\" DESC LIMIT 20;"

echo
hr; echo "4. THE MINUTE STORE AGAINST THE JOB ORDER"; hr
echo "   The job order counts in its OWN unit; the minute store counts in the SKU"
echo "   base unit. The job order is converted here -- comparing 21 CARTON against"
echo "   126 pieces and calling it a mismatch would be a bug in the check itself."
echo "   Compare job_order_base with minute_store."
$PG -c "
SELECT m.code AS machine, j.\"outputUnit\" AS unit,
       j.\"actualQtyGood\" AS job_order,
       round((j.\"actualQtyGood\" * (CASE upper(COALESCE(j.\"outputUnit\", ''))
         WHEN 'PALLET' THEN COALESCE(s.\"cartonsPerPallet\",1) * COALESCE(s.\"innersPerCarton\",1) * COALESCE(s.\"unitsPerInner\",1)
         WHEN 'CARTON' THEN COALESCE(s.\"innersPerCarton\",1) * COALESCE(s.\"unitsPerInner\",1)
         WHEN 'INNER'  THEN COALESCE(s.\"unitsPerInner\",1)
         ELSE 1 END))::numeric, 0) AS job_order_base,
       round(SUM(o.\"goodParts\")::numeric, 0) AS minute_store,
       count(o.id) AS minutes,
       round(MAX(o.\"goodParts\")::numeric, 0) AS biggest_minute
FROM job_orders j
JOIN machines m ON m.id = j.\"machineId\"
JOIN work_orders w ON w.id = j.\"workOrderId\"
LEFT JOIN skus s ON s.id = w.\"skuId\"
LEFT JOIN oee_minutes o ON o.\"jobOrderId\" = j.id
WHERE w.\"orderNumber\" = '$WO'
GROUP BY m.code, j.\"outputUnit\", j.\"actualQtyGood\", j.\"sequenceOrder\",
         s.\"cartonsPerPallet\", s.\"innersPerCarton\", s.\"unitsPerInner\"
ORDER BY j.\"sequenceOrder\";"

echo
hr; echo "5. THE GATEWAY'S OWN ACCUMULATORS"; hr
echo "   accumulated is what the edge counted since the current order took over."
$PG -c "
SELECT m.code AS machine, t.name AS tag, t.\"counterRole\" AS role,
       g.accumulated, g.\"lastEdgeAt\"
FROM gateway_counter_states g
JOIN tag_definitions t ON t.id = g.\"tagId\"
LEFT JOIN machines m ON m.id = t.\"machineId\"
WHERE t.\"isActive\" AND t.\"counterRole\" <> 'NONE'
ORDER BY m.code, t.\"counterRole\";"

echo
hr; echo "6. IS ANYTHING HELD BACK RIGHT NOW?"; hr
echo "   accumulated must equal synced. A gap is a backlog waiting to flush as"
echo "   one delta -- exactly what produced the 25-26 August jump."
BUF="$HERE/../../apps/edgegateway/build/buffer/counter-state.json"
if [ -f "$BUF" ]; then
  node -e "
    const d = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
    let gap = 0;
    for (const [k, v] of Object.entries(d)) {
      const g = (v.accumulated ?? 0) - (v.synced ?? 0);
      if (g) { console.log('    BACKLOG ' + String(g).padStart(8) + '   tag ' + k.slice(0, 8)); gap++; }
    }
    console.log('    ' + Object.keys(d).length + ' tags, ' + gap + ' with a pending backlog');
    if (gap) console.log('    ^ this will flush as ONE delta when an order starts');
  " "$(win "$BUF")"
else
  echo "    no buffer file yet"
fi

echo
hr; echo "7. THE SIDE-BY-SIDE"; hr
$PG -At -F'|' -c "
SELECT m.code, t.\"counterRole\", g.accumulated
FROM gateway_counter_states g
JOIN tag_definitions t ON t.id = g.\"tagId\"
JOIN machines m ON m.id = t.\"machineId\"
WHERE t.\"isActive\" AND t.\"counterRole\" IN ('GOOD','TOTAL');" > "$HERE/.counted.tmp"

node -e "
  const fs = require('fs');
  const t = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));

  const counted = new Map();
  for (const line of fs.readFileSync(process.argv[2], 'utf8').trim().split('\n')) {
    if (!line) continue;
    const [machine, role, acc] = line.split('|');
    counted.set(machine + '/' + role, Number(acc));
  }

  const emitted = new Map();
  for (const r of t.rows) emitted.set(r.machine + '/' + r.role, r.pulses);

  // ── Why this compares CHANGES, not totals ────────────────────────────────
  // Neither total is an absolute. The simulator's tally restarts at zero every
  // time the simulator restarts; the gateway's accumulator resets to zero at
  // every order handover, and it never counted the pulses emitted before an
  // order was executing -- correctly, since those belonged to no order.
  //
  // So a total-vs-total reading is dominated by whichever of those happened
  // last, and says nothing about whether counting works. What does say it is
  // whether the two move TOGETHER: 40 more pulses out, 40 more counted.
  const state = { at: new Date().toISOString(), emitted: [...emitted], counted: [...counted],
                  simStartedAt: t.startedAt };
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(process.argv[3], 'utf8')); } catch (e) {}
  fs.writeFileSync(process.argv[3], JSON.stringify(state));

  console.log('    ' + 'machine'.padEnd(9) + 'role'.padEnd(7)
    + 'emitted'.padStart(9) + 'counted'.padStart(9)
    + '  |' + '+emitted'.padStart(9) + '+counted'.padStart(9) + '   drift');

  const restarted = prev && prev.simStartedAt !== t.startedAt;
  let worst = null;
  const pe = prev ? new Map(prev.emitted) : null;
  const pc = prev ? new Map(prev.counted) : null;

  for (const k of [...emitted.keys()].sort()) {
    const [m, role] = k.split('/');
    const e = emitted.get(k);
    const c = counted.has(k) ? counted.get(k) : null;
    let de = '-', dc = '-', drift = '-';
    if (prev && !restarted && pe.has(k) && pc.has(k) && c !== null) {
      de = e - pe.get(k);
      dc = c - pc.get(k);
      drift = dc - de;
      worst = Math.max(worst === null ? 0 : worst, Math.abs(drift));
    }
    console.log('    ' + m.padEnd(9) + role.padEnd(7)
      + String(e).padStart(9) + String(c === null ? '-' : c).padStart(9)
      + '  |' + String(de).padStart(9) + String(dc).padStart(9) + '   ' + drift);
  }

  console.log();
  if (restarted) {
    console.log('    The simulator restarted since the last check, so its tally began again');
    console.log('    at zero. Run this once more -- the next reading will have a baseline.');
  } else if (worst === null) {
    console.log('    First reading. Run this again in a minute to get the comparison:');
    console.log('    what matters is whether emitted and counted move by the SAME amount.');
  } else if (worst <= 3) {
    console.log('    VERDICT: between these two checks, counted tracked emitted to within');
    console.log('    ' + worst + '. The counting path is sound.');
  } else {
    console.log('    VERDICT: counted drifted from emitted by ' + worst + ' between checks.');
    console.log('    That is a leak, not a boundary offset. Investigate before trusting these.');
  }
" "$(win "$TALLY")" "$(win "$HERE/.counted.tmp")" "$(win "$GAPFILE")" || true
rm -f "$HERE/.counted.tmp"

echo
hr
echo "The gateway's accumulators reset to zero at every order handover, so"
echo "section 7 is only meaningful while ONE order has been running throughout."
hr
