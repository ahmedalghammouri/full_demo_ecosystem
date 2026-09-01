#!/usr/bin/env bash
# Put WO-2026-0005 and all four of its job orders into EXECUTING.
#
# Through the API, not straight into Postgres. Writing the status column by hand
# would skip everything the transition does -- stamping actualStart, booking the
# order's planned stops, waking the state engine -- and then the run would be
# testing a state the system never actually produces.
#
# Run this AFTER the simulator and the gateway are up. The pulses emitted while
# nothing was executing must be dropped, and starting in this order is what
# exercises that rather than avoiding it.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
API="${API:-http://localhost:8080/api/v1}"
WO="${WO:-WO-2026-0005}"
EMAIL="${EMAIL:-admin@industry360.sa}"
PASSWORD="${PASSWORD:-admin@industry360.sa@admin@industry360.sa}"

echo "==> signing in as $EMAIL"
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | node -e "
    let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
      const find=(o)=>{ if(o&&typeof o==='object'){ for(const[k,v]of Object.entries(o)){
        if(k.toLowerCase().includes('token')&&typeof v==='string')return v; const r=find(v); if(r)return r; } } return null; };
      process.stdout.write(find(JSON.parse(s))||'');
    });")

if [ -z "$TOKEN" ]; then
  echo "Login failed. Is the api container up? Try:  docker logs i360-api-plocal --tail 20"
  exit 1
fi

WO_ID=$(docker exec -i i360-postgres-plocal psql -U i360_user -d industry360 -At \
  -c "SELECT id FROM work_orders WHERE \"orderNumber\" = '$WO';")

if [ -z "$WO_ID" ]; then
  echo "No work order called $WO in this database."
  exit 1
fi

echo "==> BEFORE"
docker exec -i i360-postgres-plocal psql -U i360_user -d industry360 -c \
  "SELECT m.code, j.\"operationName\", j.status, j.\"actualQtyGood\" good, j.\"actualStart\"
     FROM job_orders j JOIN machines m ON m.id = j.\"machineId\"
    WHERE j.\"workOrderId\" = '$WO_ID' ORDER BY j.\"sequenceOrder\";"

echo "==> starting every step of $WO together"
curl -s -X PATCH "$API/production/work-orders/$WO_ID/job-orders/status" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"EXECUTING"}' | node -e "
    let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
      const d=JSON.parse(s); const r=d.data??d;
      console.log('    moved:  ' + (r.moved?.length ?? 0));
      for (const k of (r.skipped ?? [])) console.log('    held:   ' + k.step + ' (' + k.reason + ')');
    });"

echo
echo "==> AFTER"
docker exec -i i360-postgres-plocal psql -U i360_user -d industry360 -c \
  "SELECT m.code, j.\"operationName\", j.status, j.\"actualQtyGood\" good, j.\"actualStart\"
     FROM job_orders j JOIN machines m ON m.id = j.\"machineId\"
    WHERE j.\"workOrderId\" = '$WO_ID' ORDER BY j.\"sequenceOrder\";"

# The verify step needs to know when counting legitimately began, so that pulses
# emitted before this instant are reported separately instead of read as losses.
date -u +%Y-%m-%dT%H:%M:%S > "$HERE/order-started-at.txt"

# The simulator's tally is cumulative from ITS start, which is deliberately
# earlier than this. Snapshotting it here lets 05-verify.sh subtract the pulses
# emitted while nothing was executing -- those were correctly DROPPED, and
# counting them as missing would report the fix working as a fault.
if [ -f "$HERE/sim-tally.json" ]; then
  cp "$HERE/sim-tally.json" "$HERE/tally-at-order-start.json"
  echo "    tally snapshotted: pulses before this instant are excluded from the comparison"
else
  echo "    no simulator tally yet - is 03-simulator.sh running? The comparison will"
  echo "    treat every pulse as post-start, which understates what was counted."
fi

echo
echo "Started at $(cat "$HERE/order-started-at.txt")Z  (recorded for 05-verify.sh)"
