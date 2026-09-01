# Deploying i360 on the Hostinger VPS

Target: **`i360.industry360.cloud`** on `109.176.199.133`, beside the stacks that
already run there.

The governing rule: **this deployment takes no public port at all.** Traefik
already owns `:80` and `:443` on that box and reaches the web container directly,
so there is nothing for i360 to collide with. Everything it publishes is bound to
loopback and reachable only over an SSH tunnel.

---

## 0. Before you start

Two things must be true, and both are quick to check.

```bash
# DNS points at the server
dig +short i360.industry360.cloud        # expect 109.176.199.133
```

If that returns nothing, add the A record and wait for it to propagate **before**
the first boot. Let's Encrypt validates over HTTP; with the record missing the
challenge fails and Traefik serves its own self-signed certificate instead. That
failure looks like a browser warning, not like a DNS problem, which is why it is
worth ruling out first.

```bash
ssh root@109.176.199.133
docker compose version                   # must be v2 — the plugin, not the old script
df -h /                                  # the build needs a few GB free
free -m                                  # 4 GB+ available, or build the images one at a time
```

---

## 1. Confirm what owns port 80

Everything below assumes Traefik in **host network mode**, which is what the box
was running when LPG was deployed. Verify rather than assume — it changes which
section applies.

```bash
# Authoritative: which PROCESS holds :80 and :443
ss -tlnp | grep -E ':(80|443)\s'
```

Trust `ss` over `docker ps`. A proxy in host network mode publishes no ports, so
its `PORTS` column is blank and a `docker ps` grep finds nothing at all — while
`ss` names the process outright:

```
LISTEN 0 4096 *:80  *:* users:(("traefik",pid=3234931,fd=4))
```

If `ss` names something other than `traefik`, stop and read
`referance/LPG/DEPLOYMENT.md` section 11.4 — it covers Nginx Proxy Manager,
nginx-proxy and Caddy. The rest of this file is the Traefik path.

```bash
# The Traefik container's own name, needed later for its logs
docker ps --format '{{.Names}}\t{{.Image}}' | grep -i traefik
```

On this host it is `traefik-traefik-1`.

---

## 2. Clone

```bash
sudo mkdir -p /opt/i360 && sudo chown "$USER" /opt/i360
cd /opt/i360

git clone https://github.com/ahmedalghammouri/full_demo_ecosystem.git .
git checkout feat/i360-ecosystem-platform     # until it is merged to main
```

---

## 3. Configure

```bash
cp .env.prod.example .env
nano .env
```

### Change every one of these

The compose defaults are published in a git repository. Treat any value you did
not type yourself as already compromised.

| Variable | Why |
|---|---|
| `POSTGRES_PASSWORD` | database superuser for this stack |
| `JWT_SECRET` | signs every access token; 32 characters minimum |
| `JWT_REFRESH_SECRET` | must differ from the above |
| `INFLUX_TOKEN`, `INFLUX_PASSWORD` | historian admin |
| `MINIO_ROOT_PASSWORD` | object store admin |
| `GRAFANA_ADMIN_PASSWORD` | dashboards admin |

Generate them on the server rather than inventing them:

```bash
openssl rand -base64 36
```

### Leave these exactly as they are

```ini
BIND_ADDR=127.0.0.1
PUBLIC_DOMAIN=i360.industry360.cloud
```

`BIND_ADDR` is the single most important line in the file. At `0.0.0.0` every
published port — the database, the cache, the MQTT broker and the object store
included — is reachable from the internet. At `127.0.0.1` they are reachable
through an SSH tunnel and from nowhere else, while Traefik still serves the app
on 443, because it dials the container directly over the Docker network rather
than through a published port.

### The demo accounts

`DEMO_PASSWORD` is seeded onto 36 accounts so a reviewer can sign in without
being handed credentials. That is correct for a demonstration and wrong for
anything else. If this deployment ever carries real data, delete them.

---

## 4. Start

```bash
cd /opt/i360

docker compose -f docker-compose.yml -f docker-compose.traefik.yml \
  -p i360 up -d --build
```

**Note what is *not* in that command.** There is no `docker-compose.override.yml`
— naming the files explicitly with `-f` suppresses the automatic override, which
is what keeps this a production build rather than the development one. And the
base file is already production, so there is no `-f docker-compose.prod.yml` to
add.

First build is **8–15 minutes**: two multi-stage TypeScript builds, then
migrations and two seeds. Watch it:

```bash
docker compose -p i360 logs -f api
```

You are waiting for these four lines in order:

```
All migrations have been successfully applied.
║  Seed complete                                               ║
║  History complete                                            ║
[NestApplication] Nest application successfully started
```

The history seed writes roughly **409,000 measured minutes** and takes two to
three minutes on its own. The API reports `unhealthy` throughout — its health
check has a 300-second start period for exactly this reason. Both seeds are
idempotent, so a restart converges rather than duplicating.

---

## 5. Verify, in this order

Each step isolates one thing. Do not skip ahead: a failure at step 2 diagnosed as
a proxy problem wastes an afternoon.

### 5.1 Nothing is exposed

```bash
docker compose -p i360 ps --format '{{.Name}}\t{{.Ports}}'
```

**Every published line must read `127.0.0.1:…`.** If any shows `0.0.0.0:`,
`BIND_ADDR` did not apply — almost always because compose was run from a
directory other than the one holding `.env`. Fix that before going further; such
a binding is reachable from the internet right now.

### 5.2 The app is up locally

```bash
curl -s localhost:4100/health
curl -s -o /dev/null -w '%{http_code}\n' localhost:8100        # 200
curl -s localhost:8100/api/v1/auth/factories/overview | head -c 200
```

The last one should name three factories. If it returns an empty list, seeding
has not finished — go back to the logs.

### 5.3 Traefik picked up the labels

```bash
docker inspect i360-web -f '{{json .Config.Labels}}' | tr ',' '\n' | grep traefik
```

`traefik.enable=true` must be there. Confirm the network name matches reality —
this compose declares a **named** network, so with `-p i360` it is
`i360_i360-network`, not `i360_default`:

```bash
docker inspect i360-web -f '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{println}}{{end}}'
```

Getting that label wrong produces a 404 from Traefik with nothing in the app's
own logs to explain it.

### 5.4 The certificate and the domain

```bash
curl -sI https://i360.industry360.cloud/ | head -1        # HTTP/2 200
docker logs traefik-traefik-1 --tail 40 | grep -iE 'i360|acme|error'
```

First issuance takes 10–30 seconds. A 404 here means Traefik never saw the
container — go back to 5.3.

### 5.5 Nothing else was disturbed

Traefik matches on `Host()`, so the other stacks should be untouched. Confirm it
rather than assuming:

```bash
curl -sI https://lpg.industry360.cloud/ | head -1
```

---

## 6. What is reachable, and how

| Service | URL |
|---|---|
| **The application** | **https://i360.industry360.cloud** |

Everything else stays on loopback deliberately: Grafana, Prometheus, MinIO and
Swagger are operator tools, not part of the demonstration, and publishing them
would put four more login pages on the internet. Reach them over a tunnel:

```bash
ssh -L 4100:127.0.0.1:4100 \
    -L 3103:127.0.0.1:3103 \
    -L 9011:127.0.0.1:9011 \
    root@109.176.199.133
```

Then locally: `localhost:4100/api/v1/docs` (Swagger), `localhost:3103` (Grafana),
`localhost:9011` (MinIO).

### Signing in

Every seeded account uses the password in `DEMO_PASSWORD`.

| Account | Scope |
|---|---|
| `admin@industry360.sa` | SUPER_ADMIN, every factory |
| `executive@industry360.sa` | Group operations view |
| `plant.npdf@industry360.sa` | Plant manager, NPDF |
| `plant.afcc@industry360.sa` | Plant manager, AFCC |
| `plant.rmtc@industry360.sa` | Plant manager, RMTC |

Eleven roles are seeded per factory on the pattern
`<role>.<factory>@industry360.sa`.

---

## 7. Updating

```bash
cd /opt/i360
git pull

docker compose -f docker-compose.yml -f docker-compose.traefik.yml \
  -p i360 up -d --build
```

`.env` and every named volume survive. Migrations apply automatically on boot;
the seeds notice the estate already exists and do nothing.

### When the plant model changes

Changing a machine, a rate or a tag makes the existing history disagree with the
model it was generated from. Rebuild it for one boot:

```bash
# in .env
SEED_RESET=true
docker compose -f docker-compose.yml -f docker-compose.traefik.yml -p i360 up -d
docker compose -p i360 logs -f api          # wait for "History complete"

# then put it back, or every restart regenerates
SEED_RESET=false
```

### Full reset — destroys the database

```bash
docker compose -p i360 down -v
docker compose -f docker-compose.yml -f docker-compose.traefik.yml -p i360 up -d --build
```

---

## 8. Day-to-day

```bash
docker compose -p i360 ps                      # what is running
docker compose -p i360 logs -f api             # follow the API
docker compose -p i360 restart api             # restart one service
docker compose -p i360 down                    # stop, keep the data
```

### Database access

Never published. Reach it from the server itself:

```bash
docker exec -it i360-postgres psql -U i360_user -d industry360
```

Or through the tunnel from your own machine:

```bash
ssh -L 5434:127.0.0.1:5434 root@109.176.199.133
psql "postgresql://i360_user:<password>@localhost:5434/industry360"
```

### Backup

```bash
docker exec i360-postgres pg_dump -U i360_user -Fc industry360 \
  > i360-$(date +%F).dump

# restore
docker exec -i i360-postgres pg_restore -U i360_user -d industry360 --clean \
  < i360-2026-09-01.dump
```

---

## 9. Running beside the other stacks

Nothing here needs coordinating with them, by design:

| | i360 | LPG | Toray |
|---|---|---|---|
| Project | `i360` | `lpg_demo` | `toray_ems_demo` |
| Public port | none | none | none |
| Loopback ports | 3100, 4100, 8100, 5434, 6380, 8087, 1884, 9010-9011, 9091, 3103 | 3200, 4200, 4300 | 3000, 4000 |
| Domain | `i360.industry360.cloud` | `lpg.industry360.cloud` | — |

Every i360 host port is a variable in `.env`. If one ever collides, change it
there — nothing else follows, because the container-internal ports never move.

**One i360 instance per host.** The services use fixed `container_name` values,
so a second project name does not give you a second stack — it fails with
`container name "/i360-redis" is already in use`. That is deliberate: fixed names
are what let the troubleshooting commands above name a container directly instead
of guessing at a compose-generated prefix. To run a second copy for testing, stop
the first (`docker compose -p i360 down`) or strip the `container_name` lines.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| A port shows `0.0.0.0:` | `BIND_ADDR` unset, or compose was run from a directory without the `.env`. Run it from `/opt/i360`. |
| `404` from Traefik, app fine locally | Traefik never saw the container. Check `traefik.enable=true` and that `traefik.docker.network` matches `docker inspect i360-web`. See 5.3. |
| Browser certificate warning | DNS was not resolving when the challenge ran. Fix the A record, then `docker compose -p i360 restart web` to retrigger. |
| Every KPI reads `—` | The history seed has not finished. `docker compose -p i360 logs api` — wait for "History complete". |
| API reports `unhealthy` for two minutes | Expected on first boot: it is migrating and seeding. The health check allows 300 s. |
| `Application error: a client-side exception` | A stale build. `docker compose -p i360 up -d --build --force-recreate web`. |
| Screens render but the map is blank | The tile server is unreachable. Point `NEXT_PUBLIC_MAP_TILE_URL` at an internal one and rebuild web. |
| Live values never change | Expected today. Machine state is computed at seed time; the Virtual Plant that keeps it live is not built yet. |
| Out of memory during build | Build one at a time: `docker compose -f docker-compose.yml build api`, then `web`. |
| The subdomain serves a different project | Traefik matched another host rule first, or DNS has not propagated. `dig +short i360.industry360.cloud`. |
| `network … declared as external` | You included `-f docker-compose.prod.yml`. There is no such file in this repo; use only the two named in step 4. |

---

## What this deployment does not do

Stated plainly so nobody discovers it during a demonstration:

- **No live data feed.** Machine states and counters are generated at seed time
  from a deterministic engine. They are internally consistent and they do not
  advance while the demo runs. The Virtual Plant — a Modbus server the real edge
  gateway polls — is what makes them live, and it is not built.
- **Nine capability screens are not built:** `/vision`, `/materials`,
  `/harmonics`, `/power-factor`, `/sld`, `/cost`, `/sustainability`,
  `/predictive`, `/environment`. Their data and API exist; the pages do not, and
  they are deliberately absent from the navigation rather than left to 404.
- **The demo accounts have published passwords.** They must not survive into
  anything carrying real data.
