// ============================================================
// Industry360° — machine status signals  (Action Tracker ID 2, 10, 11)
// ------------------------------------------------------------
// Binds the DIGITAL INPUT signals I360 made available on the remote Modbus I/O.
//
// ── The hardware constraint that shapes all of this ─────────────────────────
// The remote I/O module carries EIGHT DIGITAL INPUTS and nothing else. Every
// machine signal is therefore a DISCRETE input reading true/false — there is no
// status word, no analogue value, no integer state code. A design that assumed a
// status register would not survive contact with this plant.
//
// ── I360's signal mapping, verbatim ──────────────────────────────────────────
//
// Powder Filler I/O module:
//   ID 3  Powder Filler — Run Mode
//         ON : running and carton feed enabled
//         OFF: alarm, emergency stop, or Scenario 1
//   ID 4  Carton Packer — Run Mode
//         ON : running/ready, INCLUDING ready with no product being processed
//         OFF: alarm or emergency stop
//   ID 5  Euro-Pack Robot — Run Mode
//         Steady : running with product / ready with no product
//         Pulsing: STOP mode
//         OFF    : alarm or emergency stop
//
// Uni-Tech I/O module:
//   ID 5  Uni-Tech Wrapping Table
//         Table rotation indicates a pallet is BEING PROCESSED.
//         Provided specifically to support Starved / Blocked detection.
//   ID 6  Uni-Tech Wrapping — Run Mode
//         ON : running/ready, INCLUDING no product being processed
//         OFF: alarm or emergency stop
//
// ── Why "ready with no product" changes everything ──────────────────────────
// Carton Packer and Uni-Tech keep their Run Mode signal ON while starved. A starved
// machine does NOT stop — it stands ready with nothing to work on. So starvation
// can never be read from the run signal alone. It needs a second signal saying
// whether product is actually flowing, which is exactly what the wrapping table
// rotation provides.
//
//   Run ON  + processing      → RUNNING
//   Run ON  + NOT processing  → STARVED   (ready, nothing to do)
//   Run OFF                   → BREAKDOWN (alarm / e-stop)
//
// ── signalRole makes the interpretation DATA, not code ──────────────────────
// Each tag declares how its bit is to be read. A different plant, a different
// machine, or a corrected interpretation is a configuration change.
//
//   RUN_MODE         ON = available/ready, OFF = alarm or e-stop
//   RUN_MODE_PULSED  steady ON = running, PULSING = stopped, OFF = alarm
//                    (Euro-Pack Robot — pulse detection over a time window)
//   PROCESSING       active = product actually being processed
//
// IDEMPOTENT AND NON-DESTRUCTIVE — runs on EVERY boot. A tag that already exists
// is left alone, including an address or interpretation an engineer corrected on
// site.
//
// Run standalone:
//   node node_modules/.bin/ts-node --transpile-only prisma/seed-machine-status-tags.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * I360's I/O IDs are 1-based terminal numbers; Modbus addresses are 0-based.
 *
 *   ID 1 → DI 0 · ID 2 → DI 1 · ID 3 → DI 2 · …
 *
 * Confirmed with I360. The offset is applied in one place rather than written out
 * per signal, so the table below stays readable against their document and cannot
 * drift from it row by row.
 *
 * The mapping corroborates itself: on the Powder Filler module IDs 1–2 are that
 * machine's existing TOTAL/GOOD counters on DI0/DI1, and on the Uni-Tech module
 * IDs 1–4 are the two counter pairs on DI0–DI3. The new signals land on the free
 * inputs above them with no collision.
 */
const diAddress = (ioId: number) => ioId - 1;

interface SignalSpec {
  machineCode: string;
  deviceName: string;
  ioId: number;
  code: string;
  name: string;
  signalRole: 'RUN_MODE' | 'RUN_MODE_PULSED' | 'PROCESSING';
  /** I360's own words, stored so the interpretation travels with the tag. */
  interpretation: string;
}

const SIGNALS: SignalSpec[] = [
  {
    machineCode: 'M1', deviceName: 'EDGECOUNTER01', ioId: 3,
    code: 'M1_RUN_MODE', name: 'Powder Filler — Run Mode',
    signalRole: 'RUN_MODE',
    interpretation: 'ON: running and carton feed enabled. OFF: alarm, emergency stop, or Scenario 1.',
  },
  {
    machineCode: 'M3', deviceName: 'EDGECOUNTER01', ioId: 4,
    code: 'M3_RUN_MODE', name: 'Carton Packer — Run Mode',
    signalRole: 'RUN_MODE',
    interpretation: 'ON: running/ready, including ready with no product being processed. OFF: alarm or emergency stop.',
  },
  {
    machineCode: 'M4', deviceName: 'EDGECOUNTER01', ioId: 5,
    code: 'M4_RUN_MODE', name: 'Euro-Pack Robot — Run Mode',
    signalRole: 'RUN_MODE_PULSED',
    interpretation: 'Steady: running with product / ready with no product. Pulsing: STOP mode. OFF: alarm or emergency stop.',
  },
  {
    machineCode: 'M5', deviceName: 'EDGECOUNTER02', ioId: 5,
    code: 'M5_TABLE_ROTATION', name: 'Uni-Tech Wrapping Table — rotation',
    signalRole: 'PROCESSING',
    interpretation: 'Table rotation indicates a pallet is being processed. Supports Starved / Blocked detection.',
  },
  {
    machineCode: 'M5', deviceName: 'EDGECOUNTER02', ioId: 6,
    code: 'M5_RUN_MODE', name: 'Uni-Tech Wrapping — Run Mode',
    signalRole: 'RUN_MODE',
    interpretation: 'ON: running/ready, including no product being processed. OFF: alarm or emergency stop.',
  },
];

async function main() {
  let created = 0;
  let kept = 0;
  let skipped = 0;

  for (const s of SIGNALS) {
    const machine = await prisma.machine.findFirst({
      where: { code: s.machineCode, isActive: true },
      select: { id: true, factoryId: true },
    });
    if (!machine) {
      console.log(`  – ${s.code}: machine ${s.machineCode} not found, skipped`);
      skipped++;
      continue;
    }

    // Keyed on the tag CODE, not on "any status tag for this machine": M5 has two
    // signals with different roles, and treating one as satisfying the other would
    // leave the wrapper without its table-rotation input — the very signal the
    // Starved detection depends on.
    const existing = await prisma.tagDefinition.findFirst({
      where: { factoryId: machine.factoryId, code: s.code },
      select: { id: true },
    });
    if (existing) {
      console.log(`  = ${s.code}: already configured, left alone`);
      kept++;
      continue;
    }

    const device = await prisma.device.findFirst({
      where: { factoryId: machine.factoryId, name: s.deviceName },
      select: { id: true },
    });
    if (!device) {
      console.log(`  – ${s.code}: device ${s.deviceName} not found, skipped`);
      skipped++;
      continue;
    }

    await prisma.tagDefinition.create({
      data: {
        factoryId: machine.factoryId,
        machineId: machine.id,
        deviceId: device.id,
        code: s.code,
        name: s.name,
        description: `I360 I/O ID ${s.ioId}. ${s.interpretation}`,
        address: String(diAddress(s.ioId)),
        // Eight digital inputs is all this module has.
        registerType: 'DISCRETE',
        dataType: 'BOOL',
        tagType: 'STATUS',
        // Only a RUN_MODE signal drives the machine's state directly. PROCESSING is
        // an input to the Starved/Blocked decision, not a state in itself — marking
        // it as a status tag would let "table not rotating" be read as "machine
        // stopped", which is precisely the confusion this design removes.
        isMachineStatus: s.signalRole !== 'PROCESSING',
        signalRole: s.signalRole,
        // A stop must reach the downtime log promptly; at a slower poll its
        // timestamp is wrong by the polling interval.
        pollIntervalMs: 500,
        isActive: true,
      },
    });
    console.log(`  + ${s.code}: created → ${s.deviceName} DI${diAddress(s.ioId)} (I360 ID ${s.ioId}, ${s.signalRole})`);
    created++;
  }

  console.log(`\n[status-signals] created ${created}, kept ${kept}, skipped ${skipped}`);
}

main()
  .catch((e) => {
    console.error('[status-signals] seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
