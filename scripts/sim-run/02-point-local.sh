#!/usr/bin/env bash
# Point the Modbus devices at this machine so the simulator can serve them.
#
# The real field IP of each device is stashed in its own `config` JSON first, so
# `99-stop.sh` can put it back exactly. Nothing is typed in twice and nothing is
# remembered by a human.
set -euo pipefail

cd "$(dirname "$0")/../../apps/edgegateway"
export DATABASE_URL="${DATABASE_URL:-postgresql://i360_user:i360_pass_2026@localhost:5433/industry360?schema=public}"

echo "==> devices BEFORE"
docker exec -i i360-postgres-plocal psql -U i360_user -d industry360 -c \
  'SELECT name, "ipAddress", port, "pollIntervalMs" FROM devices WHERE protocol = '"'"'MODBUS'"'"' AND "isActive" ORDER BY name;'

node scripts/modbus-sim-line.mjs --point-local --restore-ips >/dev/null 2>&1 || true
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const ds = await p.device.findMany({ where: { protocol: 'MODBUS', isActive: true } });
  for (const d of ds) {
    if (d.ipAddress === '127.0.0.1') continue;
    const cfg = (d.config && typeof d.config === 'object') ? { ...d.config } : {};
    cfg.simFieldIp = d.ipAddress;
    await p.device.update({ where: { id: d.id }, data: { ipAddress: '127.0.0.1', config: cfg } });
    console.log('  ' + d.name + ': ' + d.ipAddress + ' -> 127.0.0.1  (field IP stashed)');
  }
  await p.\$disconnect();
})();
"

echo
echo "==> devices AFTER"
docker exec -i i360-postgres-plocal psql -U i360_user -d industry360 -c \
  'SELECT name, "ipAddress", port, "pollIntervalMs" FROM devices WHERE protocol = '"'"'MODBUS'"'"' AND "isActive" ORDER BY name;'

echo
echo "The gateway re-reads devices every 10s, so it will follow without a restart."
