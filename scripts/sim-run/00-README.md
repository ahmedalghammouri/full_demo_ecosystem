# Simulated run of WO-2026-0005

An end-to-end check with no plant: the simulator serves the same Modbus devices
the gateway is configured to poll, the real `edgegateway.exe` counts them, and
`05-verify.sh` compares what was emitted against what the database recorded.

## Run these in order, each in its own terminal where noted

| # | Script | Terminal | What it does |
|---|--------|----------|--------------|
| 1 | `01-deploy.sh` | any | Rebuilds api + web, recreates them, **verifies the running container matches the image** |
| 2 | `02-point-local.sh` | any | Repoints the Modbus devices at `127.0.0.1` and stashes the field IPs |
| 3 | `03-simulator.sh` | **keep open** | Serves the devices. Writes `sim-tally.json` every 15s |
| 4 | `04-edge.sh` | **keep open** | Runs the real `edgegateway.exe` against the local database |
| 5 | `05-start-order.sh` | any | Puts WO-2026-0005 and its four job orders into EXECUTING |
| 6 | `05-verify.sh` | any | Compares the simulator's tally with the database. Run whenever you like |
| — | `99-stop.sh` | any | Pauses the order and restores the field IPs |

## Why this order

The gateway and simulator start **before** the order does, on purpose. Every
pulse emitted while nothing is EXECUTING must be *dropped* and tallied as
orphaned — that is the fix for the 25–26 August jump, and starting in this order
exercises it rather than avoiding it.

`05-verify.sh` therefore compares against the pulses emitted **after** the order
started, and reports the pre-start pulses separately.

## What "passing" looks like

- Every machine's counted total is within a few units of the simulator's
  emitted total. A gap of one or two per machine is the ~2 s attribution window
  around a status change, not a defect.
- No single minute in `oee_minutes` exceeds the machine's design rate.
- `counter-state.json` shows `accumulated == synced` for every tag when idle.

Anything else is worth stopping for.
