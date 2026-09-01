# Industry360° Edge Gateway

On-prem service that polls **Modbus** devices (TCP, RTU and RTU-over-TCP), turns
what it reads into production data for the MES, and pushes every value to the
*same* Dockerised backends as the platform (**Postgres + MQTT + InfluxDB**). It
runs unattended on a plant PC and has its own local dashboard at
`http://localhost:4900`.

From each polled tag it can:

- **Count production** — a rising edge on a `COUNTER` tag increments the bound
  machine's *in-progress* Job Order (**Total / Good / Bad**, Bad = Total − Good).
  Counters are **restart-safe** (state persisted in `GatewayCounterState`, no
  double-counting on restart) and only accumulate while the machine is
  **RUNNING**.
- **Drive machine state & downtime** — a designated machine-status tag (BOOL or
  mapped INT) sets the machine's live state, opens/closes `DowntimeEvent`s, and
  feeds the downtime + OEE engine.
- **Meter energy** — an energy meter's tags (e.g. a Schneider **PM5110** via a
  template) become throttled `EnergyReading` rows plus rich per-phase history.
- **Historise everything** — every reading is written to InfluxDB (per-tag
  opt-out), upserted as the tag's current value in Postgres, and published to
  MQTT.

It's resilient by design: a DB/MQTT/InfluxDB outage never stops acquisition —
readings are **buffered to disk** and replayed when the sink returns.

There are two ways to use it:

- **A — Run it directly** (no packaging): for development or a quick run on a PC that already has Node 20+. ← start here
- **B — Deploy it as a Windows service** (`.exe` + NSSM): for a plant PC that must auto-start on boot and run unattended.

---

## Prerequisites (both modes)

- The platform stack must be running (Postgres, MQTT, InfluxDB). Locally that's:
  ```bash
  docker compose -f docker-compose.prod-local.yml up -d
  ```
  Host ports used by the gateway: Postgres `5433`, MQTT `1883`, InfluxDB `8086`.
- A platform user account (any account that can log into the web app) — used to view gateways/data in the cloud app. The **gateway dashboard itself** logs in with two fixed edge accounts (see below).
- The gateway's `JWT_SECRET` **must match** the API's (`docker-compose.prod-local.yml` → `JWT_SECRET`).

> The gateway uses its **own** Prisma client, generated from the API's schema via
> `pnpm prisma:sync` (`scripts/sync-schema.mjs`) into `src/generated/prisma`, so
> the two schemas never collide. `build` / `package:win` run this automatically.

---

## A — Run directly (no deploy)

From the **monorepo root** (`Industry360° PLATFORM/`):

```bash
# 1. Install workspace deps (once, or after dependency changes)
pnpm install

# 2. Build the shared driver lib + sync/generate the Prisma client + compile the gateway
pnpm --filter @i360/edgegateway build
```

(`build` runs `prebuild`, which builds `@i360/industrial-drivers`, syncs the
schema from the API and runs `prisma generate`.)

Then configure and run from the gateway folder:

```bash
cd apps/edgegateway

# 3. Create the .env (copy the template and edit)
cp .env.example .env        # Git Bash;  on PowerShell: Copy-Item .env.example .env

# 4. Run it
node dist/main.js
```

Or, for auto-reload while developing (rebuilds on save):

```bash
pnpm --filter @i360/edgegateway start:dev
```

A successful start logs:

```
[PrismaService] Connected to shared Postgres
[InfluxService] InfluxDB connected → http://localhost:8086 (bucket=i360_timeseries)
[MqttService]   MQTT broker connected → mqtt://localhost:1883
[GatewayContextService] Gateway identity ready: <name> (<id>) @ factory <CODE>
[EdgeGateway]   Industry360° Edge Gateway listening on http://0.0.0.0:4900
```

Open **http://localhost:4900** and log in with an edge account (see *Dashboard access* below).

> Stop it with `Ctrl-C`. This mode does **not** survive a reboot or terminal
> close — use mode **B** for that.

### Minimal `.env` for a local run

```ini
GATEWAY_NAME=Local Dev Gateway
GATEWAY_FACTORY_CODE=NPDF          # ← the factory you log into (see note below)
GATEWAY_PORT=4900

DATABASE_URL=postgresql://i360_user:i360_pass_2026@localhost:5433/industry360?schema=public
MQTT_BROKER_URL=mqtt://localhost:1883
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=i360-influx-super-secret-token
INFLUX_ORG=industry360
INFLUX_BUCKET=i360_timeseries

JWT_SECRET=industry360-jwt-secret-key-change-in-production-32charss
```

Optional tuning (all have sane defaults):

```ini
DEFAULT_POLL_INTERVAL_MS=1000       # per-device poll rate when a device sets none
HEARTBEAT_INTERVAL_MS=15000         # how often ONLINE is stamped for the cloud app
BUFFER_DIR=./buffer                 # where offline records are queued
MES_PLATFORM_URL=http://localhost:8080   # enables the dashboard's MES reachability check
GATEWAY_ID=                         # pin a fixed gateway row id (else matched by name+factory)
```

> **⚠ Factory binding matters.** `GATEWAY_FACTORY_CODE` decides which factory the
> gateway registers under. The web app's **IIoT → Edge Gateways** page only shows
> gateways in *your* factory, so this must match the factory you're logged into,
> or the gateway won't appear (it's still running — just scoped elsewhere). Leave
> it blank and the gateway falls back to the first active factory. Valid codes in
> this DB: `NPDF`, `SDPF`, `AFCC`, `SAF`, `RMTC`.

---

## B — Deploy as a Windows service (step by step)

Run these on the **plant PC** (or a Windows build machine), Node 20+ + pnpm installed.

### 1. Build the standalone executable

From the monorepo root:

```powershell
pnpm install
pnpm --filter @i360/edgegateway package:win
```

This compiles, packages with `pkg` (node22-win-x64) and copies the Prisma engine
next to the exe, producing a self-contained **`apps/edgegateway/build/`** folder:

```
build/
  edgegateway.exe            # the service binary
  query_engine-windows.dll.node   # Prisma engine (shipped beside the exe)
  schema.prisma
  public/                    # local dashboard
  .env                       # sample config — EDIT THIS
  install-service.bat
  uninstall-service.bat
  README.md
```

> If you only have Node (no build toolchain) on the plant PC, build `build/` on a
> dev machine and copy the whole folder over.

### 2. Add NSSM

Download **nssm.exe** from <https://nssm.cc/download> and drop it into the
`build/` folder (next to `edgegateway.exe`), or put it on the system `PATH`.

### 3. Configure `build/.env`

Point it at the server that runs the Docker stack and set the factory:

```ini
GATEWAY_NAME=Plant Edge Gateway 1
GATEWAY_FACTORY_CODE=NPDF
GATEWAY_PORT=4900

DATABASE_URL=postgresql://i360_user:i360_pass_2026@SERVER_HOST:5433/industry360?schema=public
MQTT_BROKER_URL=mqtt://SERVER_HOST:1883
INFLUX_URL=http://SERVER_HOST:8086
INFLUX_TOKEN=<same token as the API>
INFLUX_ORG=industry360
INFLUX_BUCKET=i360_timeseries
JWT_SECRET=<same secret as the API>
```

Replace `SERVER_HOST` with the IP/hostname of the Docker host (use `localhost`
only if the stack runs on the same PC).

### 4. Install & start the service

Open a terminal **as Administrator** in `build/` and run:

```powershell
.\install-service.bat
```

This registers the service **Industry360EdgeGateway** with NSSM, sets it to
auto-start on boot, auto-restart on crash, and writes logs to `build\logs\`.
It then starts the service.

### 5. Verify

- Dashboard: **http://localhost:4900** (log in with an edge account).
- Web app: **IIoT → Edge Gateways** shows the gateway **Online** (log into the
  factory matching `GATEWAY_FACTORY_CODE`).
- Reboot the PC → confirm the service comes back automatically.

### Manage the service

```powershell
nssm restart Industry360EdgeGateway     # after editing .env
nssm stop    Industry360EdgeGateway
nssm status  Industry360EdgeGateway
.\uninstall-service.bat             # remove it (run as Administrator)
```

Logs: `build\logs\out.log` and `build\logs\err.log`.

---

## Dashboard access — two fixed users

The dashboard and **all** configuration (devices, tags, service settings) are
restricted to **exactly two hard-coded users**. They are NOT in the platform
database — they're defined in [`src/local-api/config-users.ts`](src/local-api/config-users.ts)
so the edge admin can always log in even when the database/MES is offline.

| Role | Email | Password |
|---|---|---|
| Edge Administrator | `admin@industry360.sa` | `Password@123` |
| Edge Engineer | `engineer@industry360.sa` | `Password@123` |

> Change the passwords for production via env (`EDGE_ADMIN_PASSWORD`,
> `EDGE_ENGINEER_PASSWORD`) or by editing `config-users.ts`. No other account —
> not even a valid platform user — can access the gateway dashboard.

## The local dashboard (`http://localhost:4900`)

Styled to match the Industry360° web app (logo, dark theme, sidebar). Tabbed
management UI, usable on the edge PC without the cloud app:

- **Overview** — live device status, sink health (DB / MQTT / InfluxDB / MES),
  disk-buffer backlog, executing Job-Order counts, and live tag values.
- **Devices** — add/edit/delete Modbus devices (protocol, IP/port or serial
  params, unit id, poll interval, machine binding; auto-bound to this gateway).
- **Tags** — add/edit/delete tags with register address/type, scaling
  (`scaleFactor`/`offset`), word count/order, and counter role/edge.
- **Meters** — add energy meters (with their linked Modbus device), pick a
  template (e.g. PM5110) to auto-create the meter's ENERGY tags.
- **Settings** — edit service connections (**DB / MQTT / InfluxDB / MES Platform**)
  + gateway name/factory/poll. Saved to `gateway-config.json` (overrides `.env`);
  use **Save & Restart** to apply (as a Windows service it auto-restarts; in dev
  re-run `node dist/main.js`).

## After it's running — configure acquisition

In the web app **or** the gateway's own dashboard (Devices / Tags / Meters tabs):

1. **Add a device**: Protocol *Modbus TCP* (or RTU / RTU-over-TCP), IP + Port
   (or serial port/baud/parity/data/stop bits), **Assigned Gateway** = this
   gateway, **Bound Machine** = the machine to count for, Unit ID.
2. **Add tags** on the device:
   - **Counter**: Tag Type *Counter*, register **Address** + **Type**
     (Holding/Input/Coil/Discrete), **Counter Role** (`Total`+`Good`, or
     `Good`+`Bad`), Edge Trigger *Rising*. A machine may have at most one active
     tag per role (a duplicate is rejected to prevent double-counting).
   - **Machine status** (optional): mark the tag as the machine-status tag —
     BOOL (`true`=RUNNING, `false`=stopped) or an INT with a `statusMap`
     (defaults to the standard 0-based map: `0` IDLE, `1` RUNNING, `2` BREAKDOWN,
     `3` PLANNED_STOP, `4` SETUP, …). Down states open a `DowntimeEvent`
     automatically.
   - **Energy**: usually created for you by the meter template; set `energyRole`
     (`ENERGY_IMPORT_TOTAL`, `ACTIVE_POWER_TOTAL`, per-phase V/I/P/PF/Hz, …).

The running gateway reconciles device/tag config against the DB **every ~10 s** —
no restart needed. Each rising edge increments the bound machine's **EXECUTING**
Job Order (Good/Bad/Total, only while RUNNING) and everything published to MQTT +
InfluxDB.

### MQTT topics published

| Topic | Payload |
|---|---|
| `industry360/<factoryId>/<machineCode|id>/<tagCode>` | per-poll `{ tagId, value, quality, ts }` |
| `industry360/<factoryId>/jo/<jobOrderId>/count` | count event `{ role, good, rejected, total, goodDelta, scrapDelta, ts }` |
| `industry360/<factoryId>/energy/<meterId>` | energy event `{ readingId, value, powerKw, ts }` |
| `industry360/control/historian` *(subscribed)* | retained `{ paused }` from the platform's System console — pauses/resumes this gateway's InfluxDB writes |

---

## Local test with the Modbus simulator (no PLC needed)

`scripts/modbus-sim.mjs` is a built-in Modbus-TCP server that pulses a coil
(for counters) and exposes a full **Schneider PM5110** register map (Float32
V/I/P/PF/Hz + Int64 energy) so you can exercise the whole chain on one PC. It
emulates a **single slave at unit id 1**.

`scripts/modbus-sim-farm.mjs` launches N of those, one per port (`1502, 1503,…`),
each in its own process with a slightly different load profile — so every seeded
device (which gets its own port, see below) reads distinct live values.

> **Important:** each device must use `unitId = 1` (the simulator's slave id) and
> its **own port**. A device pointed at a port with a non-matching unit id gets no
> response (reads "Timed out"). The demo seed already sets this up correctly.

### 1. Bring up the platform stack (Postgres / MQTT / InfluxDB / API / web)
```bash
docker compose -f docker-compose.prod-local.yml up -d
```

### 2. Seed demo IIoT + energy data (idempotent)
Adds, for the NPDF factory: a **Plant Edge Gateway**, a **Modbus PLC + Good/Total
counter tags per machine**, a **PM5110 power meter per machine**, and a
**line-level meter** for the packaging line — all with the full template tag set:
```bash
cd apps/api
DATABASE_URL="postgresql://i360_user:i360_pass_2026@localhost:5433/industry360?schema=public" \
  npx tsx prisma/seeds/iot-energy-demo.ts
```
(Also runs automatically as part of `pnpm --filter @i360/api prisma db seed`.)
The seeded devices each get their **own port** starting at `127.0.0.1:1502`
(unit id 1) and are bound to the **Plant Edge Gateway**, so run the gateway with
that identity (step 4). 5 machines → 11 devices (5 PLCs + 5 meters + 1 line meter),
so ports `1502`–`1512`.

### 3. Start the simulator farm (one instance per device)
```bash
cd apps/edgegateway
# count = number of seeded devices (≥ 11 for the default NPDF seed)
node scripts/modbus-sim-farm.mjs 1502 12
```
(For a single device you can still use `node scripts/modbus-sim.mjs 1502`.)

### 4. Run the edge gateway against the LOCAL stack
The gateway prefers `gateway-config.json` (which may point at production). For a
local test, bypass it with a non-existent config path so it falls back to `.env`
(localhost), and adopt the seeded gateway by name:
```bash
cd apps/edgegateway
# Windows PowerShell:
$env:GATEWAY_CONFIG_FILE="./_local.json"; $env:GATEWAY_NAME="Plant Edge Gateway"; node dist/main.js
# Git Bash:
GATEWAY_CONFIG_FILE=./_local.json GATEWAY_NAME="Plant Edge Gateway" node dist/main.js
```
Ensure `.env` has `GATEWAY_FACTORY_CODE=NPDF` and localhost URLs (DB `5433`,
MQTT `1883`, Influx `8086`).

### 5. What you should see (within ~15 s)
- Devices go **CONNECTED**; PM5110 meters auto-provision their ENERGY tags.
- **IIoT → Tag Browser** (`:8080`): live per-phase V/I/P values updating.
- **Energy → Live**: live power per meter; meters on machines with **no EXECUTING
  Job Order** are flagged **Standby** ("consuming with no production").
- **Energy → Meters / dashboard**: consumption populates from the readings.
- The gateway's own dashboard (`:4900`) shows the same live data.

### Stop the demo
Stop the two `node` processes (Ctrl-C), or free the ports:
```powershell
Get-NetTCPConnection -LocalPort 4900,1502 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Gateway not shown in web **Edge Gateways** | `GATEWAY_FACTORY_CODE` ≠ the factory you're viewing. Set it and restart (or view as the matching factory / a SUPER_ADMIN). |
| Dashboard login `401 Invalid credentials` | Use an **edge account** (`admin@industry360.sa` / `engineer@industry360.sa`), not a platform user. Passwords are set in `config-users.ts` / env. |
| `Can't reach database server at …:5433` | Stack not up, wrong `DATABASE_URL` host, or firewall. Gateway keeps running and buffers to disk; it recovers when the DB returns. |
| Device stays `DISCONNECTED` / `ERROR` | Wrong IP/port/unit id (or serial params), or the PLC isn't reachable from the gateway PC. Check `lastError` on the device. |
| Counts not moving | Tag must be `COUNTER` with a `counterRole`, bound to a machine with an **EXECUTING** Job Order — **and** the machine must be RUNNING (a machine-status tag reporting a non-RUNNING state gates the counter). |
| Downtime not recorded | Needs a tag flagged as the machine-status tag; INT tags need a valid `statusMap` value (or use the default 0-based map). |
| Energy readings missing | Meter needs a `templateKey` (tags auto-provision on the next reload) and the device must report `ENERGY_IMPORT_TOTAL` / `ACTIVE_POWER_TOTAL`; writes are throttled to ~1 / 10 s per meter. |
| History empty but MQTT/DB fine | InfluxDB writes may be **paused** remotely (`industry360/control/historian`), Influx not configured, or the tag has historization disabled. |
| `pkg` build fails on Prisma | The engine ships beside the exe via `scripts/copy-runtime-assets.mjs`; keep `query_engine-windows.dll.node` next to `edgegateway.exe`. |
| Build fails with `EPERM … rename query_engine-windows.dll.node` | A **running gateway** has the Prisma engine DLL loaded, so `prisma generate` can't overwrite it. Stop the gateway (Ctrl-C, or `nssm stop Industry360EdgeGateway`) before building, then rebuild. |
