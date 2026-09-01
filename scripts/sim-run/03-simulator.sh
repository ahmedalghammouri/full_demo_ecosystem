#!/usr/bin/env bash
# The field hardware, stood up on this machine. KEEP THIS TERMINAL OPEN.
#
# Serves the same Modbus devices the gateway polls, driving the same discrete
# inputs at WO-2026-0005's own cycle times. Every configuration value comes from
# the database -- addresses, edge polarity, ports -- so this cannot drift from
# what the gateway expects.
#
# Writes sim-tally.json every 15 seconds and again on Ctrl-C. That file is what
# 05-verify.sh compares against, so the comparison reads a number this process
# produced rather than one read off a screen.
set -euo pipefail

# Resolved BEFORE the cd below: `$0` may be a relative path, and it stops
# meaning anything once the working directory moves.
HERE="$(cd "$(dirname "$0")" && pwd)"
TALLY="${TALLY:-$HERE/sim-tally.json}"

cd "$HERE/../../apps/edgegateway"
export DATABASE_URL="${DATABASE_URL:-postgresql://i360_user:i360_pass_2026@localhost:5433/industry360?schema=public}"

WO="${WO:-WO-2026-0005}"
SPEED="${SPEED:-1}"

echo "work order : $WO"
echo "speed      : ${SPEED}x   (SPEED=20 ./03-simulator.sh to finish an order quickly)"
echo "tally      : $TALLY"
echo "ring mode  : ${RING:-off}   (RING=1 ./03-simulator.sh to reproduce the 25 Aug contact bounce)"
echo

exec node scripts/modbus-sim-line.mjs \
  --wo "$WO" \
  --speed "$SPEED" \
  --tally "$TALLY" \
  ${RING:+--ring}
