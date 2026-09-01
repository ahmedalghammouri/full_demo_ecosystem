#!/usr/bin/env bash
# Put everything back: pause the order, restore the field IPs.
#
# The IPs come from the `simFieldIp` each device stashed in its own config when
# 02-point-local.sh ran, so nothing depends on anyone remembering them.
#
# Stop the simulator and the gateway with Ctrl-C in their own terminals first --
# this script does not kill them, because killing a gateway mid-flush is exactly
# the situation its buffer exists to survive and there is no reason to test it
# by accident.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
API="${API:-http://localhost:8080/api/v1}"
WO="${WO:-WO-2026-0005}"
EMAIL="${EMAIL:-admin@industry360.sa}"
PASSWORD="${PASSWORD:-admin@industry360.sa@admin@industry360.sa}"

echo "==> pausing $WO"
TOKEN=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" \
  | node -e "
    let s=''; process.stdin.on('data',d=>s+=d).on('end',()=>{
      const find=(o)=>{ if(o&&typeof o==='object'){ for(const[k,v]of Object.entries(o)){
        if(k.toLowerCase().includes('token')&&typeof v==='string')return v; const r=find(v); if(r)return r; } } return null; };
      process.stdout.write(find(JSON.parse(s))||'');
    });" || true)

WO_ID=$(docker exec -i i360-postgres-plocal psql -U i360_user -d industry360 -At \
  -c "SELECT id FROM work_orders WHERE \"orderNumber\" = '$WO';" || true)

if [ -n "${TOKEN:-}" ] && [ -n "${WO_ID:-}" ]; then
  curl -s -X PATCH "$API/production/work-orders/$WO_ID/job-orders/status" \
    -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d '{"status":"PAUSED"}' >/dev/null && echo "    paused"
else
  echo "    could not reach the API -- pause it from the tablet instead"
fi

echo
echo "==> restoring the field IPs"
cd "$HERE/../../apps/edgegateway"
export DATABASE_URL="${DATABASE_URL:-postgresql://i360_user:i360_pass_2026@localhost:5433/industry360?schema=public}"
node scripts/modbus-sim-line.mjs --restore-ips

echo
docker exec -i i360-postgres-plocal psql -U i360_user -d industry360 -c \
  'SELECT name, "ipAddress", port FROM devices WHERE protocol = '"'"'MODBUS'"'"' AND "isActive" ORDER BY name;'
