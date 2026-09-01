// SDPF Line 1 simulator — stands in for the field hardware, tag for tag.
//
// ── What this is for ─────────────────────────────────────────────────────────
// The plant is stopped, so nothing can be tested against real product. This
// serves the SAME Modbus devices the gateway is configured to poll, driving the
// SAME discrete inputs, at each machine's OWN cycle time — so a work order can
// be run to completion on a desk.
//
// ── It reads the configuration, it does not carry one ────────────────────────
// Every device, tag, address and edge polarity comes from the live database at
// startup. A hardcoded copy would be a second source of truth for exactly the
// thing this exists to exercise, and it would drift the first time a tag was
// edited. If the plant swaps DI2 for DI3, this follows without being touched.
//
// ── Reproducing 25 August ────────────────────────────────────────────────────
//   --ring   every pulse bounces two or three times inside ~30 ms, which is what
//            a worn photo-eye contact does and what made M1 read 1.53x its
//            mechanical ceiling. With the gateway's debounce OFF the counts come
//            out high; set the machine's debounce to 200 ms on the Counting
//            Limits page and they come back to the true rate. That comparison is
//            the whole point of the flag.
//
// ── Usage ────────────────────────────────────────────────────────────────────
// PowerShell has no inline `VAR=x cmd` prefix — set the variable first, and it
// holds for the rest of that window:
//
//   cd "D:\NEW WORKS\New folder\Industry360_SDPF\apps\edgegateway"
//   $env:DATABASE_URL = "postgresql://i360_user:i360_pass_2026@localhost:5433/industry360?schema=public"
//   node scripts/modbus-sim-line.mjs --point-local --speed 5
//
// bash / git-bash:
//   cd apps/edgegateway
//   node scripts/modbus-sim-line.mjs                 # clean pulses, true rate
//   node scripts/modbus-sim-line.mjs --ring          # reproduce the 25 Aug fault
//   node scripts/modbus-sim-line.mjs --speed 20      # 20x faster, to finish an order
//   node scripts/modbus-sim-line.mjs --point-local   # also repoint the devices at 127.0.0.1
//   node scripts/modbus-sim-line.mjs --restore-ips   # put the field IPs back, then exit
//
// Env: DATABASE_URL must point at the database the gateway is using.

// Console output here is deliberately plain ASCII. A Windows terminal on the
// default code page renders an arrow or a box-drawing glyph as mojibake, and a
// tool whose first screen looks broken does not get trusted with a number. The
// comments keep their typography — they are read in an editor, which has no
// code page to get wrong.
import { writeFileSync } from 'node:fs';
import pkg from 'modbus-serial';
import { PrismaClient } from '@prisma/client';

const { ServerTCP } = pkg;
const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const num = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : d;
};

const RING = has('--ring');
const SPEED = Math.max(0.1, num('--speed', 1));

/**
 * Drive ONE work order's machines, at ITS cycle times.
 *
 * Without this the pace came from whichever job order happened to sort first
 * across the whole plant, which is fine for "make the line look busy" and
 * useless for "does the gateway count what I emitted". A comparison needs both
 * sides to be talking about the same order.
 */
const WO = (() => { const i = argv.indexOf('--wo'); return i >= 0 ? argv[i + 1] : null; })();

/**
 * Where the emitted tally is written, so the check afterwards reads a number
 * this process actually produced rather than one a human copied off a screen.
 * Written on every summary tick AND on shutdown, so a Ctrl-C still leaves a
 * usable file.
 */
const TALLY = (() => { const i = argv.indexOf('--tally'); return i >= 0 ? argv[i + 1] : 'sim-tally.json'; })();
const POINT_LOCAL = has('--point-local');
const RESTORE = has('--restore-ips');

/** How long a clean pulse is held. Comfortably above the ~30 ms round trip. */
const PULSE_MS = num('--pulse', 250);
/** Ring burst: this many extra transitions, this far apart. */
const RING_EXTRA = 2;
const RING_GAP_MS = 28;

/**
 * Where a device's real address is stashed while it points at the simulator.
 *
 * In the device's own `config` JSON rather than a note field: it is structured
 * data about the device, and `--restore-ips` has to find it reliably rather
 * than parse it back out of prose.
 */
const IP_STASH = 'simFieldIp';

// ── Configuration, read from the database ───────────────────────────────────

async function loadDevices() {
  const devices = await prisma.device.findMany({
    where: { protocol: 'MODBUS', isActive: true },
    select: {
      id: true, name: true, ipAddress: true, port: true, unitId: true, config: true,
      tagDefinitions: {
        where: { isActive: true, address: { not: null }, registerType: 'DISCRETE' },
        select: {
          id: true, code: true, address: true, tagType: true,
          counterRole: true, edgeType: true, isMachineStatus: true, signalRole: true,
          machine: { select: { id: true, code: true, name: true } },
        },
        orderBy: { address: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });
  return devices.filter((d) => d.tagDefinitions.length > 0);
}

/**
 * Each machine's true pace, in seconds per count of ITS OWN unit.
 *
 * Taken from the job order the machine is actually running, because that is
 * where the routing's cycle time lives and it is already per output unit — the
 * same unit the counter counts in. A machine with nothing scheduled falls back
 * to the line's design rate rather than stopping, so a simulator run is never
 * blocked by an empty schedule.
 */
async function loadPace() {
  const jos = await prisma.jobOrder.findMany({
    where: {
      machineId: { not: null },
      idealCycleTimeSec: { gt: 0 },
      // Scoped to one order when asked. Its machines are the only ones driven,
      // so a machine belonging to some other order stays silent instead of
      // adding counts nobody is comparing against.
      ...(WO ? { workOrder: { orderNumber: WO } } : {}),
    },
    select: { machineId: true, idealCycleTimeSec: true, status: true, plannedStart: true },
    orderBy: [{ status: 'asc' }, { plannedStart: 'desc' }],
  });
  const byMachine = new Map();
  // EXECUTING and PAUSED sort before READY/SCHEDULED alphabetically, which is
  // the order we want: the order actually on the machine wins.
  for (const jo of jos) if (!byMachine.has(jo.machineId)) byMachine.set(jo.machineId, jo.idealCycleTimeSec);
  return byMachine;
}

// ── One machine's pulse generator ───────────────────────────────────────────

/**
 * The live level of every discrete input, keyed by `${deviceId}:${address}`.
 *
 * A single flat map because that is exactly what a Modbus read asks for, and
 * because the polarity work is already done by the time a value lands here.
 */
const bits = new Map();
const key = (deviceId, address) => `${deviceId}:${address}`;

/** Counters, for the run summary. */
const emitted = new Map();
/** tagId -> { machine, role }, so the tally reads as machines not as uuids. */
const tagOwner = new Map();

/**
 * What this process actually emitted, written where the comparison can read it.
 *
 * A number read off a terminal is a number somebody retyped. This is the same
 * count the generator incremented, in a file, with the moment it was written.
 */
function writeTally(startedAt) {
  const rows = [...emitted.entries()].map(([tagId, pulses]) => ({
    tagId,
    machine: tagOwner.get(tagId)?.machine ?? '?',
    role: tagOwner.get(tagId)?.role ?? '?',
    pulses,
  }));
  try {
    writeFileSync(TALLY, JSON.stringify({
      workOrder: WO, ring: RING, speed: SPEED,
      startedAt, writtenAt: new Date().toISOString(), rows,
    }, null, 2));
  } catch (err) {
    console.error(`tally write failed: ${err.message}`);
  }
}

/**
 * Drive one counter tag for one part.
 *
 * Polarity comes from the tag's own `edgeType`: a RISING counter rests LOW and
 * pulses HIGH, a FALLING one rests HIGH and pulses LOW. Getting this backwards
 * would produce a simulator that counts nothing while looking busy — and this
 * line genuinely mixes the two, so it cannot be assumed.
 */
function pulse(deviceId, tag) {
  const k = key(deviceId, tag.address);
  const active = tag.edgeType === 'FALLING' ? 0 : 1;
  const rest = active ? 0 : 1;

  const transitions = [];
  if (RING) {
    // A worn contact makes and breaks several times before it settles. Each
    // make is a rising edge, and an ungated counter takes every one.
    for (let i = 0; i < RING_EXTRA; i++) {
      transitions.push([i * RING_GAP_MS * 2, active], [i * RING_GAP_MS * 2 + RING_GAP_MS, rest]);
    }
  }
  const settleAt = RING ? RING_EXTRA * RING_GAP_MS * 2 : 0;
  transitions.push([settleAt, active], [settleAt + PULSE_MS, rest]);

  for (const [at, v] of transitions) setTimeout(() => bits.set(k, v), at);
  emitted.set(tag.id, (emitted.get(tag.id) ?? 0) + 1);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function restoreIps() {
  const devices = await prisma.device.findMany({
    where: { protocol: 'MODBUS' },
    select: { id: true, name: true, ipAddress: true, config: true },
  });
  let n = 0;
  for (const d of devices) {
    const cfg = (d.config && typeof d.config === 'object') ? { ...d.config } : null;
    const ip = cfg?.[IP_STASH];
    if (!ip) continue;
    delete cfg[IP_STASH];
    await prisma.device.update({
      where: { id: d.id },
      data: { ipAddress: ip, config: Object.keys(cfg).length ? cfg : null },
    });
    console.log(`  ${d.name} -> ${ip}`);
    n++;
  }
  if (n === 0) { console.log('Nothing to restore - no device carries a stashed field IP.'); return; }
  console.log(`Restored ${n} device(s). Restart the gateway to pick them up.`);
}

async function pointLocal(devices) {
  for (const d of devices) {
    if (d.ipAddress === '127.0.0.1') continue;
    // The field address is stashed first, so --restore-ips always has a way
    // home. Overwriting it with no way back would make this script something
    // nobody dares run twice.
    const cfg = (d.config && typeof d.config === 'object') ? { ...d.config } : {};
    cfg[IP_STASH] = d.ipAddress;
    await prisma.device.update({
      where: { id: d.id }, data: { ipAddress: '127.0.0.1', config: cfg },
    });
    console.log(`  ${d.name}: ${d.ipAddress} -> 127.0.0.1  (field IP stashed)`);
  }
  console.log('Devices repointed. Restart the gateway, and run --restore-ips when finished.');
}

async function main() {
  if (RESTORE) { await restoreIps(); return; }

  const devices = await loadDevices();
  if (devices.length === 0) {
    console.error('No active MODBUS TCP device with discrete tags found. Is DATABASE_URL right?');
    process.exitCode = 1;
    return;
  }
  if (POINT_LOCAL) await pointLocal(devices);

  const pace = await loadPace();

  console.log('');
  console.log(`SDPF Line 1 simulator - ${RING ? 'RING MODE (reproducing 25 Aug)' : 'clean pulses'}`
    + (SPEED !== 1 ? `, ${SPEED}x speed` : ''));
  console.log('');

  for (const dev of devices) {
    // Rest every input at its own idle level before anything reads them, so a
    // counter's first sample is a baseline rather than a phantom edge.
    for (const t of dev.tagDefinitions) {
      const idle = t.tagType === 'COUNTER' ? (t.edgeType === 'FALLING' ? 1 : 0) : 1;
      bits.set(key(dev.id, t.address), idle);
    }

    const vector = {
      getDiscreteInput: (addr, _unit, cb) => cb(null, bits.get(key(dev.id, addr)) ?? 0),
      getCoil: (addr, _unit, cb) => cb(null, bits.get(key(dev.id, addr)) ?? 0),
      getInputRegister: (_a, _u, cb) => cb(null, 0),
      getHoldingRegister: (_a, _u, cb) => cb(null, 0),
      setCoil: (_a, _v, _u, cb) => cb(null),
      setRegister: (_a, _v, _u, cb) => cb(null),
    };
    const server = new ServerTCP(vector, {
      host: '0.0.0.0', port: dev.port ?? 502, debug: false, unitID: dev.unitId ?? 1,
    });
    server.on('socketError', (e) => console.error(`[${dev.name}] socket: ${e?.message}`));
    server.on('serverError', (e) => console.error(`[${dev.name}] server: ${e?.message}`));

    console.log(`> ${dev.name}  0.0.0.0:${dev.port} (unit ${dev.unitId ?? 1})`);

    // Group this device's counters by machine — a machine's TOTAL and GOOD must
    // pulse from ONE part, not from two independent trains, or Good > Total
    // appears in the simulator for the same reason it appeared on the plant.
    const byMachine = new Map();
    for (const t of dev.tagDefinitions) {
      if (t.tagType !== 'COUNTER' || !t.machine) {
        console.log(`    DI${t.address}  ${t.code}  (status - held at 1)`);
        continue;
      }
      const g = byMachine.get(t.machine.id) ?? { machine: t.machine, tags: [] };
      g.tags.push(t);
      byMachine.set(t.machine.id, g);
    }

    // ── One address, one pulse train ────────────────────────────────────
    // This plant binds DI2 on EDGE_COUNTER_M03 to BOTH M3 and M4's good
    // counters. On the floor that means one sensor is counted twice, once per
    // machine -- which is a real thing to know about. Here it would mean two
    // generators writing one bit at different rates, each cutting the other's
    // pulse short, and both counts coming out wrong for a reason that has
    // nothing to do with the gateway.
    //
    // So an address is driven ONCE, by the first machine that claims it, and
    // the sharing is named rather than silently worked around.
    const driven = new Map(); // "deviceId:address" -> machine code driving it

    for (const [machineId, g] of byMachine) {
      // Scoped run: a machine with no job order in THIS work order is left
      // resting. Driving it would put counts into the comparison that the
      // order under test never produced.
      if (WO && !pace.has(machineId)) {
        console.log(`    ${g.machine.code}  idle - not part of ${WO}`);
        continue;
      }

      const shared = g.tags.filter((t) => driven.has(key(dev.id, t.address)));
      if (shared.length === g.tags.length && g.tags.length > 0) {
        const owners = [...new Set(shared.map((t) => driven.get(key(dev.id, t.address))))];
        console.log(`    ${g.machine.code}  SHARES every input with ${owners.join(', ')}`
          + ` - not driven separately`);
        console.log(`          DI${shared.map((t) => t.address).join(',DI')} is ONE physical`
          + ` input bound to both machines in the tag configuration.`);
        console.log(`          On the line that means one sensor is counted twice.`);
        continue;
      }
      for (const t of g.tags) driven.set(key(dev.id, t.address), g.machine.code);

      const cycleSec = pace.get(machineId) ?? 1.3333;
      const periodMs = Math.max(40, (cycleSec * 1000) / SPEED);
      const total = g.tags.find((t) => t.counterRole === 'TOTAL');
      const good = g.tags.find((t) => t.counterRole === 'GOOD');
      // A modest reject rate so `rejected = total - good` is a real number
      // rather than a permanent zero.
      const rejectPct = total && good ? 3 : 0;

      console.log(`    ${g.machine.code}  every ${(periodMs / 1000).toFixed(2)}s`
        + `  ${g.tags.map((t) => `DI${t.address}=${t.counterRole}/${t.edgeType}`).join(' ')}`
        + (rejectPct ? `  ~${rejectPct}% reject` : ''));

      // Remembered so the tally can be reported per machine and per role,
      // which is the shape the comparison needs.
      for (const t of g.tags) tagOwner.set(t.id, { machine: g.machine.code, role: t.counterRole });

      setInterval(() => {
        const isReject = rejectPct > 0 && Math.random() * 100 < rejectPct;
        if (total) pulse(dev.id, total);
        if (good && !isReject) pulse(dev.id, good);
        // A machine with only a GOOD counter has no way to say "reject" — it
        // simply does not pulse, which is what the real station does too.
        if (!total && good && isReject) { /* nothing */ }
      }, periodMs);
    }
  }

  console.log('');
  console.log(RING
    ? 'Ring mode: every part emits 3 makes inside ~84 ms. With debounce OFF the counts\n'
      + '  run high; set 200 ms on the Counting Limits page and they return to the true rate.'
    : 'Clean mode: one make per part. Counts should track the design rate exactly.');
  console.log('Ctrl-C to stop.');
  console.log('');

  // A periodic summary, so a long run can be judged without reading the gateway.
  const startedAt = new Date().toISOString();
  writeTally(startedAt);
  setInterval(() => {
    const parts = [...emitted.entries()]
      .map(([id, n]) => `${tagOwner.get(id)?.machine ?? id.slice(0, 6)}/${tagOwner.get(id)?.role ?? '?'}=${n}`)
      .join('  ');
    if (parts) console.log(`  emitted: ${parts}`);
    writeTally(startedAt);
  }, 15_000);

  // Ctrl-C must still leave a usable tally, not an empty one from startup.
  simStartedAt = startedAt;
}

let simStartedAt = new Date().toISOString();
const shutdown = async () => {
  writeTally(simStartedAt);
  console.log(`
tally written to ${TALLY}`);
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect().catch(() => {});
  process.exitCode = 1;
});
