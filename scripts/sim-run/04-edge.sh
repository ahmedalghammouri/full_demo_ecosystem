#!/usr/bin/env bash
# The real edge gateway, against the local database. KEEP THIS TERMINAL OPEN.
#
# This runs the SAME edgegateway.exe that goes on the plant PC -- not a dev
# build, not `npm start`. A test that exercises a different binary from the one
# being shipped answers a question nobody asked.
#
# Its buffer directory is the copy taken from the production edge, so the
# gateway starts from the plant's real counter baselines.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/../../apps/edgegateway/build"

export DATABASE_URL="${DATABASE_URL:-postgresql://i360_user:i360_pass_2026@localhost:5433/industry360?schema=public}"

if [ ! -f edgegateway.exe ]; then
  echo "edgegateway.exe not found in $(pwd)"
  echo "Build it with:  cd apps/edgegateway && pnpm package:win"
  exit 1
fi

echo "==> exe"
ls -l edgegateway.exe | awk '{print "    built " $6, $7, $8 "   " $5 " bytes"}'
echo "    carries the backlog fix: $(grep -c orphanedCounts edgegateway.exe) (must be 1)"

echo
echo "==> buffer state BEFORE the run"
if [ -f buffer/counter-state.json ]; then
  node -e "
    const d = require('./buffer/counter-state.json');
    let gap = 0;
    for (const [k, v] of Object.entries(d)) {
      const g = (v.accumulated ?? 0) - (v.synced ?? 0);
      if (g) { console.log('    BACKLOG ' + g + '  tag ' + k.slice(0, 8)); gap++; }
    }
    console.log('    ' + Object.keys(d).length + ' tags, ' + gap + ' with a pending backlog');
    if (gap) console.log('    ^ a backlog here will flush as ONE delta when an order starts');
  "
else
  echo "    no counter-state.json - the gateway will start every counter from a baseline"
fi

echo
echo "Starting. Ctrl-C to stop."
echo
exec ./edgegateway.exe
