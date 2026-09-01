# Industry360° — Ecosystem Demo

> One platform. Three factories. Three manufacturing paradigms on one ISA-95 data model.

A demonstration of the Industry360° Application Suite: four integrated layers — connectivity,
MES execution, simulation, and AI — running as a single system over an estate of three
fictional Saudi factories, each chosen to exercise a different kind of manufacturing.

Every identity, product, measurement and coordinate in this system is invented for the
demonstration. No customer name, site, drawing or measurement report appears anywhere.

---

## The estate

| Code | Factory | City | Paradigm | What it demonstrates |
|---|---|---|---|---|
| **NPDF** | Nahdah Powder & Detergents Factory | Dammam | Batch / lot | Production orders, OEE, downtime, quality, maintenance, inventory, lot traceability |
| **AFCC** | Afaq Composite Cylinders | Riyadh | Discrete serialised | Per-unit genealogy across nine stages, vision inspection, digital twin |
| **RMTC** | Rimal Membrane Technologies | Jeddah | Continuous web | Energy, power quality, harmonics, capacitor banks, sustainability, cost allocation |

Three factories under one enterprise (`I360DG`). The factory selector is the case-study
picker: choose a site and the navigation adapts to what that site actually has.

**47 machines · 5 production lines · 136 tags · 18 energy meters · 21 routing steps ·
110 downtime causes · 36 users**

---

## Running it

There are two modes, and the difference matters: development compiles routes on
demand (a first page load takes ~30 s), production serves a compiled bundle
(~0.3 s). Demonstrate from production.

### Production

```bash
cp .env.prod.example .env      # then change every secret in it
docker compose -f docker-compose.yml up -d --build
```

First boot takes two to three minutes: the API applies migrations, seeds the
master data, then generates roughly 409,000 measured minutes of history. Watch
it with `docker compose logs -f api`. Both seeds are idempotent, so a restart
converges rather than duplicating.

### Development

```bash
docker compose up -d           # picks up docker-compose.override.yml automatically
```

The override swaps both apps to their development targets, mounts the source and
runs the watchers. It is loaded with no flag, which is why the *base* file is the
production one: compose merges `volumes` across files rather than replacing them,
so a production overlay on a development base could never remove the source
mount that shadows the built bundle.

### Deploying behind Traefik

Full walkthrough for the Hostinger VPS, including what to verify and in what
order: **[DEPLOYMENT.md](DEPLOYMENT.md)**.

```bash
docker compose -f docker-compose.yml -f docker-compose.traefik.yml   -p i360 up -d --build
```

Routes `i360.industry360.cloud` through the Traefik already running on the host.
Set `BIND_ADDR=127.0.0.1` in `.env` first — Traefik dials the container directly
over the compose network, so nothing needs a published port, and that one line
keeps the database, cache, broker and object store off the public interface.

Verify after deploying; every line must show a `127.0.0.1` binding:

```bash
docker compose -p i360 ps --format '{{.Name}}	{{.Ports}}'
```

| Service | URL |
|---|---|
| **The application** | **http://localhost:8100** |
| API docs (Swagger) | http://localhost:4100/api/v1/docs |
| Grafana | http://localhost:3103 |
| Prometheus | http://localhost:9091 |
| MinIO console | http://localhost:9011 |

**Open the app on the nginx port, not the Next port.** Nginx is the entry point:
it serves the app at `/` and proxies `/api/` and `/socket.io/` to the API. The
browser client calls **same-origin** so the app works unchanged from any device
on the network — a hard-coded `localhost` would resolve to the visitor's own
machine. The Next server also proxies `/api` itself, so hitting it directly
works too; it is simply not the intended door.

Default host ports sit clear of anything else on the box and every one of them
is configurable in `.env`.

### Sign in

Every demo account uses the password **`Demo@2026`**.

| Account | Scope |
|---|---|
| `admin@industry360.sa` | SUPER_ADMIN, every factory |
| `executive@industry360.sa` | Group operations view |
| `plant.npdf@industry360.sa` | Plant manager, NPDF |
| `plant.afcc@industry360.sa` | Plant manager, AFCC |
| `plant.rmtc@industry360.sa` | Plant manager, RMTC |

Eleven roles are seeded per factory on the pattern `<role>.<factory>@industry360.sa` —
`operator.npdf@`, `quality.afcc@`, `energy.rmtc@`, and so on. Role-based access is enforced
by the API, not only in the interface.

**These accounts have published passwords. They are demonstration accounts and must never
survive into anything real.**

---

## The plant is data, not code

Everything the running system contains is described in [`apps/api/prisma/plant/`](apps/api/prisma/plant/)
and nowhere else. A reviewer can read the model and know exactly what the estate is,
without reading the seeder.

| File | What it holds |
|---|---|
| `types.ts` | The shape of a factory — hierarchy, operating model, products, quality, connectivity |
| `factory-npdf.ts` · `factory-afcc.ts` · `factory-rmtc.ts` | The three estates |
| `plant-model.ts` | Enterprise, demo users, the 64-module ecosystem catalogue, and validation |
| `signal-engine.ts` | The deterministic arithmetic every number is derived from |

```bash
pnpm plant:check     # validate the model — 0 errors before anything is written
pnpm plant:engine    # run the engine over a week and check the numbers are physical
```

### Validation is not decoration

`plant:check` runs before the seeder writes anything. It enforces the rules that would
otherwise corrupt the numbers rather than merely fail:

- A machine may carry **at most one status tag** — two would race to set the machine state.
- A machine may carry **one tag per counter role** — two GOOD counters double the shift's output.
- `designCapacity` and `idealCycleSeconds` must **agree** — if they disagree, Performance is a fiction.
- An energy meter must scope **exactly one** of machine, line or area.
- Every routing step, quality spec, alarm rule and gateway reference must **resolve**.
- No two devices may claim the same TCP port across the whole estate.

A mistyped reference caught here costs seconds. Caught on a screen during a demo, it costs
the demo.

---

## Why the numbers hang together

The estate is generated by one deterministic engine rather than by independent random
series, so the relationships a reviewer would look for are actually present.

**Deterministic.** Every value is a pure function of *(factory, machine, tag, instant)*.
The seeded history and the live feed evaluate the same functions, so a trend that ends
"now" joins the live feed without a seam, and restarting a container never rewrites the past.

**The line runs at its constraint.** A serial line cannot run faster than its slowest
station. Capacities are normalised through each factory's packaging ladder before being
compared, so a cartoner's 300/h and a filler's 1,800/h are the same quantity before they
are ranked. The consequence is what makes bottleneck analysis mean anything:

| NPDF Line 1 | Availability | Performance | Quality | OEE |
|---|---|---|---|---|
| M1 Powder Filler | 80.2% | 61.2% | 97.0% | 47.6% |
| **M3 Carton Packer** *(constraint)* | 79.2% | **92.0%** | 99.1% | **72.1%** |
| M4 Shrink Wrapper | 81.3% | 76.5% | 98.8% | 61.4% |
| M5 Palletizer | 81.0% | 75.4% | 99.9% | 61.0% |

The constraint runs near its ideal cycle; everything faster shows a real performance loss
because it spends part of its run time waiting. All four stations move the same quantity of
product — within 2.4% over a week, which is buffer breathing, not a modelling error.

**Availability is measured, never assumed.** It is read from the same state timeline the
machine wall renders, so the number on the KPI screen and the states on the wall are one
fact rather than two estimates that drift apart.

**Process drives quality.** A unit produced while a process tag was excursing is the one
that fails downstream. The scrap Pareto puts winding defects first *because* winding
tension carries the most weight in the process-stress term — not because the number was
typed in.

**Health drives cycle time and alarms together.** Machines degrade between preventive
services on intervals that differ per machine, so the fleet does not degrade in lockstep,
and MTBF is a result rather than a constant.

**Nights run slower.** Shift C carries a lower pace as a property of the shift, visible in
the shift comparison — a real property of the plant rather than noise.

**Load never falls to zero.** Chillers, HVAC, water treatment and standby losses run
regardless of output. That fixed share is why a production-linked efficiency measure can
only ever reach part of the bill.

**Performance is held below 1.** A machine cannot beat its own ideal cycle time. A
performance figure that touches 100% means the ideal cycle time is wrong, not that the
machine outran physics.

---

## Ecosystem coverage

The Application Suite names **64 modules** across four layers plus DX and emerging
technologies. This platform's honest position, scored *implemented = 1, partial = 0.5*:

| Layer | Modules | Coverage |
|---|---|---|
| 01 · Connectivity & Data Foundation | 15 | 40% |
| 02 · MES | 16 | 94% |
| 03 · Simulation & Optimization | 10 | 65% |
| 04 · AI & Intelligence | 13 | 54% |
| DX · Digital Transformation | 5 | 50% |
| Emerging Technologies | 5 | 20% |
| **Total** | **64** | **59%** |

The Ecosystem Home renders locked modules **as locked**, which is what the Application
Suite's own POC scope prescribes. Industrial cybersecurity, the extended data platform
(Data Lake, warehouse, iPaaS, Kafka) and the emerging technologies are not built, are shown
as not built, and are the honest frontier.

---

## Architecture

```
apps/api            NestJS · Prisma · Socket.IO · PostgreSQL/TimescaleDB · Redis · InfluxDB
apps/web            Next.js 15 (App Router) · React 19 · Tailwind · ECharts · Recharts
apps/edgegateway    On-prem acquisition — Modbus/OPC-UA polling, store-and-forward
```

### The database

`timescale/timescaledb:2.17.2-pg16` — the same PostgreSQL 16 major version the platform
already targeted, so the swap is a one-line image change and the extension is opt-in per
table. Hypertables carry the high-frequency telemetry; everything else is ordinary
relational storage.

### Acquisition is a separate deployable

The edge gateway runs beside the PLCs, not on the server, because it has to keep polling
and keep buffering when the network to the platform is the thing that failed. Readings
append to a JSONL buffer on disk and replay in order when the sink returns; the file is
truncated only once a batch is accepted, so a crash mid-replay repeats a batch rather than
losing one.

---

## Status

**Built and verified**

- Platform base, renamed to **i360** throughout, with every trace of pilot-customer data removed
- Three-factory plant model — validated, 0 errors, 0 warnings
- **Factory classification driving the product**: each site declares a type, the type grants a
  capability set, and the capability set decides the navigation. Verified end to end — the three
  factories see 98, 97 and 101 of 110 routes, and the sets genuinely differ
- Deterministic signal engine — 134 physical-plausibility checks passing
- Master-data seeder — idempotent, type-checked, run by the API container on boot
- Clean baseline schema: 112 tables, migrations applied by `migrate deploy` (not `db push`)
- TimescaleDB verified active
- Traefik deployment overlay for `i360.industry360.cloud`, every host port parameterised
  behind `BIND_ADDR` so nothing collides with the sibling stacks

**In progress**

- `seed-history.ts` — transactional history: orders, counts, downtime, quality, energy.
  Until it lands, KPI tiles correctly read `—` rather than a fabricated zero
- The capability-gated screens themselves: `/twin`, `/vision`, `/materials`, `/power-quality`,
  `/harmonics`, `/power-factor`, `/sld`, `/cost`, `/sustainability`, `/predictive`, `/environment`
- `apps/virtualplant` — Modbus TCP server the real edge gateway polls unmodified
- Ecosystem Home — the 64 modules by layer, locked ones shown as locked

---

*© 2026 Industry360° — i360 Industrial Intelligence Ecosystem*
