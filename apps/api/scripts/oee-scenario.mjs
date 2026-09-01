#!/usr/bin/env node
/**
 * OEE verification run — a shift whose answer is known before it starts.
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * Every other check on this engine compares it with itself. This one does not:
 * the scenario below DECIDES what the machine did, minute by minute, and works
 * out the OEE that must follow from the published formulas. The engine is then
 * asked the same question through its own API. If the two disagree, one of them
 * is wrong, and the scenario is the one you can read in twenty lines.
 *
 * Time is compressed. The scenario writes machine states and counter values at
 * synthetic timestamps and drives the minute writer through them, so an
 * eight-hour shift is verified in a few seconds instead of eight hours.
 *
 * ── Usage ───────────────────────────────────────────────────────────────────
 *   cd apps/api
 *   node scripts/oee-scenario.mjs                    # the default shift
 *   node scripts/oee-scenario.mjs --scenario starved # a line-constrained shift
 *   node scripts/oee-scenario.mjs --keep             # leave the rows for the UI
 *
 * Env: API_URL (default http://localhost:8080/api/v1)
 *      API_EMAIL / API_PASSWORD (default the seeded admin)
 *      DATABASE_URL (from .env — the states and counters are written directly)
 */
import { PrismaClient } from '@prisma/client';

const API = (process.env.API_URL || 'http://localhost:8080/api/v1').replace(/\/$/, '');
const EMAIL = process.env.API_EMAIL || 'admin@industry360.sa';
const PASSWORD = process.env.API_PASSWORD || 'Password@123';
const KEEP = process.argv.includes('--keep');
// indexOf returns -1 when the flag is absent, and argv[0] is the node binary —
// so the naive `argv[indexOf(flag) + 1]` reports the interpreter as a scenario name.
const scenarioAt = process.argv.indexOf('--scenario');
const WANTED = scenarioAt >= 0 ? (process.argv[scenarioAt + 1] || 'default') : 'default';

/**
 * Which engine to verify. The scenarios are the same either way — what changes
 * is the denominator, so running one scenario against both is the cleanest way
 * to see what the schedule basis actually does to a reading.
 *
 *   standard  divides by the time that went by
 *   schedule  divides by the slot the order was committed to
 *
 * `--slack N` extends the planned end N minutes past the run, so the schedule
 * engine has a stretch of slot the order never reaches. With no slack the two
 * engines must agree exactly, which is itself worth asserting.
 */
const engineAt = process.argv.indexOf('--engine');
const ENGINE = engineAt >= 0 ? (process.argv[engineAt + 1] || 'standard') : 'standard';
const slackAt = process.argv.indexOf('--slack');
const SLACK_MIN = slackAt >= 0 ? Number(process.argv[slackAt + 1] || 0) : 0;
if (!['standard', 'schedule'].includes(ENGINE)) {
  console.error(`Unknown engine "${ENGINE}". Use standard or schedule.`);
  process.exit(1);
}
const BASE = ENGINE === 'schedule' ? '/oee-schedule' : '/oee-standard';

/**
 * The minute table this run owns.
 *
 * Each engine writes its own, and a run that backs up and clears the wrong one
 * leaves the engine under test reading rows it never wrote — its own live cron
 * output from before the replay, complete with a committed slot of its own. The
 * first schedule run reported 249.7 committed minutes against 240 for exactly
 * that reason, and every factor downstream moved with it.
 */
const store = (prisma) => (ENGINE === 'schedule' ? prisma.oeeScheduleMinute : prisma.oeeMinute);

const MIN = 60_000;
const prisma = new PrismaClient();

/**
 * The scenarios.
 *
 * Each step is a run of whole minutes in one machine state, producing at a fixed
 * rate. Whole minutes on purpose: a step that ended mid-minute would split a
 * bucket, and then the expected answer would depend on the same interval
 * arithmetic the engine is being tested on. The point is to check the engine
 * against something simpler than itself.
 *
 *   state       what the machine reported
 *   minutes     how long it held that state
 *   partsPerMin parts completed per minute (0 while stopped)
 *   rejectPct   share of those parts that were rejected
 */
const SCENARIOS = {
  /**
   * A believable shift: runs, breaks down, is repaired, changes over, runs again.
   * Design speed is 60 parts/hour = 1 per minute, so a minute of running at
   * 1 part/min is exactly 100% performance and any slower rate is a speed loss
   * you can compute in your head.
   */
  default: {
    label: 'A four-hour shift with one breakdown and one changeover',
    designCycleSec: 60,
    steps: [
      { state: 'RUNNING', minutes: 90, partsPerMin: 1.0, rejectPct: 2 },
      { state: 'BREAKDOWN', minutes: 25, partsPerMin: 0, rejectPct: 0 },
      { state: 'RUNNING', minutes: 45, partsPerMin: 0.8, rejectPct: 2 },
      { state: 'CHANGEOVER', minutes: 20, partsPerMin: 0, rejectPct: 0 },
      { state: 'RUNNING', minutes: 60, partsPerMin: 1.0, rejectPct: 5 },
    ],
  },

  /**
   * The same machine, stopped by the line rather than by itself. Availability
   * must NOT move: starvation is carved out above planned production time.
   * Run this one against `default` to see the difference a State Rule makes.
   */
  starved: {
    label: 'A shift where the constraint is upstream, not this machine',
    designCycleSec: 60,
    steps: [
      { state: 'RUNNING', minutes: 60, partsPerMin: 1.0, rejectPct: 1 },
      { state: 'STARVED', minutes: 90, partsPerMin: 0, rejectPct: 0 },
      { state: 'RUNNING', minutes: 60, partsPerMin: 1.0, rejectPct: 1 },
    ],
  },

  /**
   * A machine with no status signal at all. Every minute is unmeasured, so the
   * engine must report NO availability — not 0%, and certainly not 100%.
   */
  silent: {
    label: 'A machine that reports nothing',
    designCycleSec: 60,
    steps: [{ state: null, minutes: 60, partsPerMin: 0, rejectPct: 0 }],
  },
};

/**
 * What the reference formulas say this scenario must produce.
 *
 * @param piecesPerPart how many PIECES one counted part is worth. The engine
 *   stores every quantity on the packaging ladder's bottom rung so machines
 *   counting inners, cartons and pallets can be added together. A scenario that
 *   counts "parts" therefore has to say which rung it means, or a wrapper making
 *   180 pallets is compared against 180 pieces and the engine looks 160x wrong
 *   while being exactly right. That is what the first run of this script did.
 */
function expected(scenario, piecesPerPart = 1) {
  const producing = new Set(['RUNNING']);
  // Mirrors the fallback State Rules the writer uses when the plant has none.
  const planned = new Set(['CHANGEOVER', 'SETUP', 'PLANNED_STOP', 'MAINTENANCE']);
  const external = new Set(['STARVED', 'BLOCKED', 'OFFLINE']);

  let totalMin = 0, plannedStopMin = 0, availabilityLossMin = 0;
  let externalLossMin = 0, unmeasuredMin = 0, operatingMin = 0;
  let good = 0, rejected = 0;

  for (const s of scenario.steps) {
    totalMin += s.minutes;
    if (s.state == null) unmeasuredMin += s.minutes;
    else if (producing.has(s.state)) operatingMin += s.minutes;
    else if (planned.has(s.state)) plannedStopMin += s.minutes;
    else if (external.has(s.state)) externalLossMin += s.minutes;
    else availabilityLossMin += s.minutes;

    const parts = s.minutes * s.partsPerMin * piecesPerPart;
    const bad = parts * (s.rejectPct / 100);
    good += parts - bad;
    rejected += bad;
  }

  // Design speed is seconds per OUTPUT unit, so it climbs the same ladder.
  const designSpeedPph = (3600 / scenario.designCycleSec) * piecesPerPart;
  const theoretical = (operatingMin / 60) * designSpeedPph;

  const operationalMin = Math.max(0, totalMin - plannedStopMin - externalLossMin - unmeasuredMin);
  const totalParts = good + rejected;

  const ratio = (n, d) => (d > 0 ? (n / d) * 100 : null);
  const cap = (n) => (n == null ? null : Math.min(100, n));
  const availability = cap(ratio(operatingMin, operationalMin));
  const performance = cap(ratio(totalParts, theoretical));
  const quality = cap(ratio(good, totalParts));
  const oee = availability != null && performance != null && quality != null
    ? (availability / 100) * (performance / 100) * (quality / 100) * 100
    : null;

  return {
    totalMin, plannedStopMin, availabilityLossMin, externalLossMin, unmeasuredMin,
    operatingMin, operationalMin,
    good, rejected, totalParts, theoretical,
    availability, performance, quality, oee,
  };
}

/** Pieces in one unit of `unit`, for this SKU's packaging ladder. */
function ladderFactor(unit, sku) {
  const inner = Math.max(1, sku?.unitsPerInner || 1);
  const carton = Math.max(1, sku?.innersPerCarton || 1) * inner;
  const pallet = Math.max(1, sku?.cartonsPerPallet || 1) * carton;
  const rung = String(unit || 'PIECE').toUpperCase();
  if (rung.startsWith('INNER') || rung === 'BAG' || rung === 'POUCH') return inner;
  if (rung.startsWith('CARTON') || rung === 'CTN' || rung === 'BOX' || rung === 'CASE') return carton;
  if (rung.startsWith('PALLET') || rung === 'PLT') return pallet;
  return 1;
}

const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);
const fmt = (n) => (n == null ? '  —  ' : `${r1(n).toFixed(1)}`.padStart(6));

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status}) — is the API up at ${API}?`);
  const body = unwrap(await res.json());
  const token = body.accessToken || body.access_token || body.token;
  if (!token) throw new Error('login returned no token');
  return token;
}

/**
 * The API wraps every response as { success, data, timestamp }. Unwrapping in
 * one place keeps the envelope from being half-handled — which is how this
 * script first reported "login returned no token" against a login that had
 * plainly succeeded.
 */
function unwrap(body) {
  return body && typeof body === 'object' && 'data' in body && 'success' in body ? body.data : body;
}

async function main() {
  const scenario = SCENARIOS[WANTED];
  if (!scenario) {
    console.error(`Unknown scenario "${WANTED}". Available: ${Object.keys(SCENARIOS).join(', ')}`);
    process.exit(1);
  }

  const token = await login();
  const auth = { Authorization: `Bearer ${token}` };

  // A job order to attach the run to. An existing one is reused so the scenario
  // exercises the same relations production does; a throwaway would test a
  // shape the plant never has.
  const jo = await prisma.jobOrder.findFirst({
    where: { machineId: { not: null } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, machineId: true, factoryId: true, workOrderId: true,
      operationName: true, outputUnit: true,
      machine: { select: { code: true } },
      workOrder: { select: { sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } } } },
    },
  });
  if (!jo) throw new Error('no job order in the database to run the scenario against');

  // The rung this job order counts on, in pieces. Read from the SKU rather than
  // assumed, because it is the difference between 180 and 28,880.
  const piecesPerPart = ladderFactor(jo.outputUnit, jo.workOrder?.sku);

  const totalMinutes = scenario.steps.reduce((a, s) => a + s.minutes, 0);
  // Anchor far enough back that the run cannot collide with live data, and on a
  // whole minute so every step boundary is a bucket boundary.
  const t0 = new Date(Math.floor((Date.now() - (totalMinutes + 5) * MIN) / MIN) * MIN);
  const tEnd = new Date(t0.getTime() + totalMinutes * MIN);

  console.log(`\n  OEE verification run [${ENGINE}] — ${scenario.label}`);
  console.log(`  job order ${jo.operationName ?? jo.id} on machine ${jo.machine?.code ?? jo.machineId}`);
  console.log(`  counting in ${jo.outputUnit ?? 'PIECE'} — 1 part = ${piecesPerPart} piece(s)`);
  console.log(`  ${totalMinutes} synthetic minutes from ${t0.toLocaleString()}\n`);

  // ── Save what we are about to overwrite ─────────────────────────────────
  /** State records stood aside for the run, put back in the finally block. */
  let savedStates = [];
  /** Every oee_minute this job order already had, so the run can put them back. */
  let savedMinutes = [];
  const saved = await prisma.jobOrder.findUnique({
    where: { id: jo.id },
    select: { status: true, actualStart: true, actualEnd: true, idealCycleTimeSec: true, actualQtyGood: true, actualQtyRejected: true },
  });

  try {
    // ── Back up this job order's minutes before touching any of them ──────
    // The run deletes rows both inside the window and outside it: inside to
    // start clean, outside because the writer's cron keeps adding live minutes
    // that would otherwise land in the same day and be read back as part of the
    // replay. The outside-the-window delete is the whole of this job order's
    // history, which is real production data — so it is saved first and put
    // back afterwards rather than being spent to make a test read cleanly.
    savedMinutes = await store(prisma).findMany({ where: { jobOrderId: jo.id } });
    await store(prisma).deleteMany({ where: { jobOrderId: jo.id } });

    // Every state record that OVERLAPS the window, not merely those that START
    // inside it. A record opened before t0 and still open covers the whole run,
    // so the machine goes on reporting a state the scenario never scripted.
    // That is how "a machine that reports nothing" came back as sixty minutes of
    // availability loss and looked like an engine defect — it was the live
    // gateway writing states underneath the replay. The amount moved between
    // runs, which is the signature of a race rather than of a defect.
    savedStates = await prisma.machineStateRecord.findMany({
      where: {
        machineId: jo.machineId,
        startTime: { lt: tEnd },
        OR: [{ endTime: null }, { endTime: { gt: t0 } }],
      },
    });
    await prisma.machineStateRecord.deleteMany({ where: { id: { in: savedStates.map((r) => r.id) } } });

    await prisma.jobOrder.update({
      where: { id: jo.id },
      data: {
        status: 'EXECUTING', actualStart: t0, actualEnd: null,
        // The slot the schedule basis divides by. Pinned to the run so the
        // expected answer is arithmetic rather than whatever the seed left on
        // the order; --slack adds a stretch it will never reach.
        plannedStart: t0,
        plannedEnd: new Date(tEnd.getTime() + SLACK_MIN * MIN),
        idealCycleTimeSec: scenario.designCycleSec,
        actualQtyGood: 0, actualQtyRejected: 0,
      },
    });

    // ── Replay ────────────────────────────────────────────────────────────
    let cursor = t0.getTime();
    let good = 0, rejected = 0;
    for (const step of scenario.steps) {
      const from = new Date(cursor);
      const to = new Date(cursor + step.minutes * MIN);

      if (step.state) {
        await prisma.machineStateRecord.create({
          data: {
            machineId: jo.machineId, factoryId: jo.factoryId, state: step.state,
            startTime: from, endTime: to,
            durationMinutes: step.minutes,
          },
        });
      }

      for (let m = 0; m < step.minutes; m++) {
        const parts = step.partsPerMin;
        const bad = parts * (step.rejectPct / 100);
        good += parts - bad;
        rejected += bad;
        // The counters are cumulative on the job order, exactly as the gateway
        // writes them — the writer's delta logic is part of what is under test.
        await prisma.jobOrder.update({
          where: { id: jo.id },
          data: { actualQtyGood: good, actualQtyRejected: rejected },
        });

        // Capture the minute that has just closed: pass the START of the next.
        const at = new Date(cursor + (m + 1) * MIN);
        const res = await fetch(`${API}${BASE}/capture?at=${encodeURIComponent(at.toISOString())}`, {
          method: 'POST', headers: auth,
        });
        if (!res.ok) throw new Error(`capture failed (${res.status}) at ${at.toISOString()}`);
      }
      cursor = to.getTime();
      process.stdout.write(`  ${String(step.state ?? 'no state').padEnd(12)} ${String(step.minutes).padStart(4)} min  ✓\n`);
    }

    // ── Close the order before reading ────────────────────────────────────
    // The writer's own cron is still running once a minute. With the order left
    // open it keeps capturing LIVE minutes against the same job order, and those
    // land in today's window alongside the replay — one extra minute of total
    // time, and counts from whatever the gateway happens to be feeding it.
    // Setting actualEnd clips every later bucket to nothing, so the cron writes
    // no row rather than being raced against.
    await prisma.jobOrder.update({ where: { id: jo.id }, data: { actualEnd: tEnd } });
    await store(prisma).deleteMany({
      where: { jobOrderId: jo.id, OR: [{ bucketStart: { lt: t0 } }, { bucketStart: { gte: tEnd } }] },
    });

    // ── Ask the engine ────────────────────────────────────────────────────
    const url = new URL(`${API}${BASE}`);
    url.searchParams.set('jobOrderId', jo.id);
    url.searchParams.set('dateFrom', ymd(t0));
    url.searchParams.set('dateTo', ymd(tEnd));
    const res = await fetch(url, { headers: auth });
    if (!res.ok) throw new Error(`read failed (${res.status})`);
    const actual = unwrap(await res.json());
    const exp = expected(scenario, piecesPerPart);
    if (ENGINE === 'schedule') {
      // committedMin = the run plus whatever slack was added past its end.
      // notStarted is zero here because the scenario starts the order exactly
      // when its slot opens — the late-start term is covered by unit tests.
      exp.committedMin = exp.totalMin + SLACK_MIN;
      exp.notStartedMin = 0;
      exp.notYetReachedMin = SLACK_MIN;
      exp.operationalMin = Math.max(0, exp.committedMin - exp.plannedStopMin - exp.externalLossMin - exp.unmeasuredMin);
      exp.availability = exp.operationalMin > 0 ? Math.min(100, (exp.operatingMin / exp.operationalMin) * 100) : null;
      exp.oee = exp.availability != null && exp.performance != null && exp.quality != null
        ? (exp.availability / 100) * (exp.performance / 100) * (exp.quality / 100) * 100 : null;
    }

    report(exp, actual, jo.outputUnit, piecesPerPart);
  } finally {
    if (KEEP) {
      console.log(`\n  --keep: rows left in place. Open /oee-standard and pick ${ymd(t0)}.`);
    } else {
      await store(prisma).deleteMany({ where: { jobOrderId: jo.id } });
      if (savedMinutes.length) {
        await store(prisma).createMany({ data: savedMinutes, skipDuplicates: true });
      }
      await prisma.machineStateRecord.deleteMany({ where: { machineId: jo.machineId, startTime: { gte: t0, lt: tEnd } } });
      // Put the real history back exactly as it was found.
      if (savedStates.length) {
        await prisma.machineStateRecord.createMany({ data: savedStates, skipDuplicates: true });
      }
      await prisma.jobOrder.update({ where: { id: jo.id }, data: saved });
      console.log(`\n  scenario rows removed; restored ${savedMinutes.length} minute(s), ${savedStates.length} state record(s) and the job order`);
    }
    await prisma.$disconnect();
  }
}

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Side by side, with the verdict computed rather than eyeballed. */
function report(exp, got, outputUnit, piecesPerPart) {
  const rows = [
    ...(ENGINE === 'schedule'
      ? [['Committed time', exp.committedMin, got.time.committedMin, 'min'],
         ['Not started', exp.notStartedMin, got.time.notStartedMin, 'min'],
         ['Not yet reached', exp.notYetReachedMin, got.time.notYetReachedMin, 'min']]
      : [['Total time', exp.totalMin, got.time.totalMin, 'min']]),
    ['Planned stops', exp.plannedStopMin, got.time.plannedStopMin, 'min'],
    ['External loss', exp.externalLossMin, got.time.externalLossMin, 'min'],
    ['Unmeasured', exp.unmeasuredMin, got.time.unmeasuredMin, 'min'],
    ['Operational time', exp.operationalMin, got.time.operationalMin, 'min'],
    ['Availability losses', exp.availabilityLossMin, got.time.availabilityLossMin, 'min'],
    ['Net production time', exp.operatingMin, got.time.netProductionMin, 'min'],
    ['Good parts', exp.good, got.counts.good, 'pcs'],
    ['Rejected parts', exp.rejected, got.counts.rejected, 'pcs'],
    ['Theoretical parts', exp.theoretical, got.counts.theoretical, 'pcs'],
    ['Availability', exp.availability, got.availability, '%'],
    ['Performance', exp.performance, got.performance, '%'],
    ['Quality', exp.quality, got.quality, '%'],
    ['OEE', exp.oee, got.oee, '%'],
  ];

  console.log(`\n  quantities in PIECES (1 ${outputUnit ?? 'PIECE'} = ${piecesPerPart} pcs)`);
  console.log('\n  ┌────────────────────────┬────────┬────────┬──────┐');
  console.log('  │                        │ expect │ engine │      │');
  console.log('  ├────────────────────────┼────────┼────────┼──────┤');
  let failures = 0;
  for (const [label, e, a, unit] of rows) {
    // A tenth of a unit is float noise over a few hundred minutes; anything
    // larger is a disagreement worth reading.
    // Tolerance scales with the unit: a tenth of a minute is noise, but so is a
    // tenth of a piece when one counted part is worth 160 of them.
    const tol = unit === 'pcs' ? Math.max(0.1, Math.abs(e ?? 0) * 1e-6) : 0.1;
    const ok = e == null && a == null ? true : e != null && a != null && Math.abs(e - a) <= tol;
    if (!ok) failures++;
    console.log(`  │ ${label.padEnd(22)} │ ${fmt(e)} │ ${fmt(a)} │ ${ok ? ' ok ' : 'FAIL'} │${unit ? ` ${unit}` : ''}`);
  }
  console.log('  └────────────────────────┴────────┴────────┴──────┘');

  console.log(`\n  engine self-audit: ${got.audit.ok ? 'every minute accounted for' : 'MINUTES DO NOT RECONCILE'}`
    + `  (bucket drift ${got.audit.bucketDriftMin}m, identity drift ${got.audit.identityDriftMin}m)`);

  if (failures === 0 && got.audit.ok) {
    console.log('\n  ✓ the engine reproduced the scenario exactly\n');
  } else {
    console.log(`\n  ✗ ${failures} value(s) disagree — the scenario is the readable one; start there\n`);
    process.exitCode = 1;
  }
}

main().catch(async (err) => {
  console.error(`\n  scenario failed: ${err.message}\n`);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
