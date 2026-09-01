#!/usr/bin/env bash
# Delete a work order on the server, with the diagnosis built in.
#
#   ./scripts/wipe-wo.sh WO-2026-0005                 # preview only
#   ./scripts/wipe-wo.sh WO-2026-0005 --apply         # do it
#   ./scripts/wipe-wo.sh WO-2026-0005 --apply --stop-api
#
# ── Why this exists ─────────────────────────────────────────────────────────
# The SQL file is written for pgAdmin, where a human runs each block. Piped
# through psql on a server it hung after two statements with no message, was
# Ctrl-C'd, and every Ctrl-C left another session holding locks for the next
# attempt to block on. Three tries, no progress, nothing to read.
#
# Nothing about the delete is slow -- it plans in 0.6 ms on the same data, there
# are no triggers on downtime_events and nothing references it. It waits on a
# LOCK, held by the api or the gateway writing downtime events, or by an
# abandoned psql from an earlier attempt.
#
# So this looks first, says what it found, and only then acts.
set -uo pipefail

WO="${1:-}"
shift || true
APPLY=0; STOP_API=0; FORCE=0
for a in "$@"; do
  case "$a" in
    --apply)        APPLY=1 ;;
    --stop-api)     STOP_API=1 ;;
    --force-unlock) FORCE=1 ;;
    *) echo "unknown option: $a"; exit 2 ;;
  esac
done

if [ -z "$WO" ]; then
  echo "usage: $0 <WORK-ORDER-NUMBER> [--apply] [--stop-api] [--force-unlock]"
  exit 2
fi

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
PGC="${PGC:-i360-postgres-prod}"
COMPOSE="${COMPOSE:-docker-compose.hostinger.yml}"
PG="docker exec -i $PGC psql -U i360_user -d industry360"

# ── The env file the compose stack is actually run with ─────────────────────
# This plant runs `docker compose -f docker-compose.hostinger.yml --env-file
# .env.hostinger`. Without the same --env-file, compose resolves ${POSTGRES_
# PASSWORD} and the rest to empty and either refuses or -- worse -- acts on a
# differently-configured stack. Picked up automatically, overridable with
# ENV_FILE=..., and simply omitted when there is no such file.
ENV_FILE="${ENV_FILE:-$ROOT/.env.hostinger}"
COMPOSE_ARGS=(-f "$ROOT/$COMPOSE")
[ -f "$ENV_FILE" ] && COMPOSE_ARGS+=(--env-file "$ENV_FILE")
dc() { docker compose "${COMPOSE_ARGS[@]}" "$@"; }

# Printed before anything happens, so acting on the wrong stack is visible
# rather than discovered afterwards.
echo "postgres : $PGC"
if [ -f "$ENV_FILE" ]; then
  echo "compose  : $COMPOSE  --env-file $(basename "$ENV_FILE")"
else
  echo "compose  : $COMPOSE  (no env file at $ENV_FILE)"
fi
echo

hr() { printf '%s\n' "-------------------------------------------------------------------"; }

# ── 1. Who is actually BLOCKING? ────────────────────────────────────────────
# `pg_blocking_pids` answers this exactly, rather than leaving a human to guess
# from a list of long-running queries. The first run of this script listed
# twenty sessions and the plant reasonably read the api's writes as the
# problem -- they were victims, all queued behind one abandoned pgAdmin
# transaction.
hr; echo "WHAT IS BLOCKING WHAT"; hr
$PG -c "
SELECT w.pid AS waiting, w.state,
       age(now(), w.xact_start) AS waiting_for,
       pg_blocking_pids(w.pid) AS blocked_by,
       left(regexp_replace(w.query, '\s+', ' ', 'g'), 45) AS query
  FROM pg_stat_activity w
 WHERE w.datname = current_database()
   AND cardinality(pg_blocking_pids(w.pid)) > 0
 ORDER BY w.xact_start;"

# The roots: sessions blocking somebody while waiting for nobody.
ROOTS=$($PG -At -c "
SELECT string_agg(DISTINCT b::text, ' ')
  FROM pg_stat_activity a, unnest(pg_blocking_pids(a.pid)) b
 WHERE a.datname = current_database()
   AND cardinality(pg_blocking_pids(b)) = 0;")

echo
hr; echo "THE ROOT OF IT"; hr
if [ -z "${ROOTS:-}" ]; then
  echo "  Nothing is blocking anything. The database is clear."
else
  echo "  These sessions are blocking others and waiting for nobody: $ROOTS"
  echo
  $PG -c "
  SELECT pid, state, age(now(), xact_start) AS in_txn, usename, application_name,
         left(regexp_replace(query, '\s+', ' ', 'g'), 50) AS query
    FROM pg_stat_activity
   WHERE pid IN (SELECT unnest(string_to_array('$ROOTS', ' ')::int[]));"
  echo "  Nothing will move until these end. --force-unlock terminates them."
fi

# ── 2. What would go ────────────────────────────────────────────────────────
echo
hr; echo "WHAT WOULD BE DELETED FROM $WO"; hr
sed "s/WO-2026-0005/$WO/g" "$ROOT/apps/api/prisma/sql/wipe-work-order.sql" \
  | sed -n '/^WITH wo AS/,/^ORDER BY 1;$/p' | $PG

if [ "$APPLY" -ne 1 ]; then
  echo
  hr
  echo "PREVIEW ONLY. Nothing changed."
  echo "To do it:  $0 $WO --apply"
  hr
  exit 0
fi

# ── 3. Refuse to add another blocked query to the queue ─────────────────────
# Ctrl-C on `docker exec psql` kills the CLIENT. The backend keeps running the
# DELETE and keeps its locks -- which is how four abandoned attempts came to be
# queued behind one another, each one making the next one worse. So a blocked
# database is a reason to stop, not to try again harder.
if [ -n "${ROOTS:-}" ]; then
  if [ "$FORCE" -ne 1 ]; then
    echo
    hr
    echo "REFUSING TO RUN. Sessions $ROOTS are blocking the database."
    echo "Another attempt would simply queue behind them and hold locks of its own."
    echo
    echo "  Clear them and retry:   $0 $WO --apply --force-unlock"
    hr
    exit 1
  fi

  echo
  hr; echo "TERMINATING THE BLOCKERS: $ROOTS"; hr
  $PG -c "SELECT pid, pg_terminate_backend(pid) AS terminated
            FROM pg_stat_activity
           WHERE pid IN (SELECT unnest(string_to_array('$ROOTS', ' ')::int[]));"

  # Backends still running a DELETE from an earlier attempt whose client is
  # long gone. They hold locks nobody is waiting on the result of.
  echo
  echo "  Abandoned deletes from earlier runs of this script:"
  $PG -c "SELECT pid, age(now(), xact_start) AS running_for, pg_terminate_backend(pid) AS terminated
            FROM pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid()
             AND query LIKE 'DELETE FROM downtime_events%'
             AND age(now(), xact_start) > interval '30 seconds';"
  sleep 2
fi

# ── 4. Optionally take the writers out of the way ───────────────────────────
if [ "$STOP_API" -eq 1 ]; then
  echo
  hr; echo "STOPPING THE API so it cannot hold a lock"; hr
  dc stop api
  # The gateway writes too, but it lives on the plant PC and is not ours to
  # stop from here. Its writes are short; the api's are the ones that overlap.
fi

# ── 5. Do it ────────────────────────────────────────────────────────────────
echo
hr; echo "DELETING"; hr
OUT=$( { sed "s/WO-2026-0005/$WO/g" "$ROOT/apps/api/prisma/sql/wipe-work-order.sql"; echo "COMMIT;"; } \
       | $PG -v ON_ERROR_STOP=1 2>&1 )
RC=$?
echo "$OUT" | grep -E '^(BEGIN|SET|DELETE|UPDATE|COMMIT|ROLLBACK|ERROR|psql)' || true

if [ "$STOP_API" -eq 1 ]; then
  echo
  hr; echo "STARTING THE API AGAIN"; hr
  dc start api
fi

# ── 6. Say plainly whether it worked ────────────────────────────────────────
echo
hr; echo "RESULT"; hr
LEFT=$($PG -At -c "SELECT count(*) FROM work_orders WHERE \"orderNumber\" = '$WO';")

if echo "$OUT" | grep -q 'lock timeout'; then
  echo "  LOCKED. Something else holds the rows and would not let go in 5s."
  echo "  Re-run with --force-unlock to clear the blocking sessions first."
elif [ "$RC" -ne 0 ] || echo "$OUT" | grep -q '^ERROR'; then
  echo "  FAILED. Nothing was saved -- the transaction never committed."
  echo "$OUT" | grep '^ERROR' | head -3
elif [ "${LEFT:-1}" -eq 0 ]; then
  echo "  DONE. $WO is gone, and so is everything recorded against it."
else
  echo "  NOT SAVED. The statements ran but $WO is still there, which means the"
  echo "  transaction rolled back. That is what happens when the appended COMMIT"
  echo "  does not reach psql -- check for a stray backslash in the command."
fi
hr
