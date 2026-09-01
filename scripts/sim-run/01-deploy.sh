#!/usr/bin/env bash
# Rebuild api + web and put them on the floor, then PROVE it.
#
# The build saying "Built" is not the same as the container running it. That gap
# has cost real time three times this week -- a web container from the previous
# day, an api container 28 minutes older than the fix it was supposed to carry,
# and a --force-recreate that lost a race with a container still being removed.
# So this ends by comparing the running container's image id against the tag.
set -euo pipefail

cd "$(dirname "$0")/../.."
COMPOSE=docker-compose.prod-local.yml

echo "==> building api and web"
docker compose -f "$COMPOSE" build api web

echo
echo "==> recreating"
# Retried: a recreate can collide with a container still being torn down from a
# previous attempt, and docker reports that as an error rather than waiting.
for attempt in 1 2 3; do
  if docker compose -f "$COMPOSE" up -d --force-recreate api web; then break; fi
  echo "    recreate attempt $attempt failed, waiting for the old container to go"
  sleep 8
done

echo
echo "==> waiting for health"
for name in i360-api-plocal i360-web-plocal; do
  printf '    %s ' "$name"
  for _ in $(seq 1 60); do
    status=$(docker inspect "$name" --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' 2>/dev/null || echo missing)
    case "$status" in
      healthy|running) echo "$status"; break ;;
      *) printf '.'; sleep 3 ;;
    esac
  done
done

echo
echo "==> IS THE RUNNING CONTAINER THE IMAGE WE JUST BUILT?"
fail=0
check() {  # container  image-tag
  running=$(docker inspect "$1" --format '{{.Image}}' 2>/dev/null || echo none)
  tagged=$(docker image inspect "$2" --format '{{.Id}}' 2>/dev/null || echo none)
  if [ "$running" = "$tagged" ] && [ "$running" != none ]; then
    echo "    OK    $1  ${running:0:19}"
  else
    echo "    STALE $1"
    echo "          running ${running:0:19}"
    echo "          image   ${tagged:0:19}"
    fail=1
  fi
}
check i360-api-plocal industry360-api:prodlocal
check i360-web-plocal industry360-web:prodlocal

if [ "$fail" -ne 0 ]; then
  echo
  echo "STOP. The old container is still serving. Re-run this script."
  exit 1
fi

echo
echo "Deployed. Open http://localhost:8080"
