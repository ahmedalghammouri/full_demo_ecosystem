// ============================================================
// Industry360° — machine state rules bootstrap
// ------------------------------------------------------------
// Moves the edge gateway's hard-coded state interpretation into editable rows.
//
// These decisions used to live in a constant in status.service.ts: STARVED became
// a MATERIAL stop, PLANNED_STOP became a planned one, and a fixed list decided
// which reasons were excluded from OEE. Every one of those is a PLANT decision,
// not an engineering one. A customer who classifies a changeover differently, or
// who wants cleaning excluded from availability, needed a code change and a
// redeploy in order to say so.
//
// The classification below reproduces the previous behaviour exactly, so turning
// this on changes nothing until somebody edits a rule — which is the point.
//
// ONE EXCEPTION, and it is a correction rather than a preference: the states that
// chatter get a settling time. Live running on 14 Aug 2026 recorded three BLOCKED
// events for one machine inside two seconds. The total minutes were about right,
// but the event COUNT was nonsense and the log was unreadable. States derived
// from neighbouring machines move whenever a neighbour moves, so they settle for
// longer than a contact does.
//
// IDEMPOTENT AND NON-DESTRUCTIVE — runs on EVERY boot. A state that already has a
// rule is left completely alone: these are editable in the app, and a boot-time
// seed that overwrote them would silently revert the customer's own configuration.
//
// Run standalone:
//   node node_modules/.bin/ts-node --transpile-only prisma/seed-machine-state-rules.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface RuleSpec {
  state: string;
  isDowntime: boolean;
  isPlanned: boolean;
  affectsOEE: boolean;
  reasonCode: string | null;
  debounceSeconds?: number;
  category: string;
  description: string;
}

const RULES: RuleSpec[] = [
  {
    state: 'RUNNING',
    isDowntime: false, isPlanned: false, affectsOEE: true,
    reasonCode: null, category: 'OTHER',
    description: 'Machine producing. No downtime event.',
  },
  {
    state: 'IDLE',
    isDowntime: false, isPlanned: false, affectsOEE: true,
    reasonCode: null, category: 'OTHER',
    debounceSeconds: 3, // a contact that chatters must not open an event per poll
    description: 'Powered but not assigned work. No event unless a job order is running.',
  },
  {
    state: 'BREAKDOWN',
    isDowntime: true, isPlanned: false, affectsOEE: true,
    reasonCode: 'UNPLANNED_BREAKDOWN', category: 'MECHANICAL',
    debounceSeconds: 3, // same — a stop worth recording lasts longer than a bounce
    description: 'Unplanned stop — alarm or emergency stop. Charged to the machine.',
  },
  {
    state: 'PLANNED_STOP',
    isDowntime: true, isPlanned: true, affectsOEE: false,
    reasonCode: 'PLANNED_MAINTENANCE', category: 'PLANNED_BREAK',
    description: 'Scheduled stop. Removed from the availability denominator.',
  },
  {
    state: 'MAINTENANCE',
    isDowntime: true, isPlanned: true, affectsOEE: false,
    reasonCode: 'PLANNED_MAINTENANCE', category: 'PLANNED_MAINTENANCE',
    description: 'Planned maintenance. Not charged against availability.',
  },
  {
    state: 'SETUP',
    isDowntime: true, isPlanned: true, affectsOEE: true,
    reasonCode: 'CHANGEOVER', category: 'CHANGEOVER',
    description: 'Setup before a run. Planned, but still counted as a loss by default.',
  },
  {
    state: 'CHANGEOVER',
    isDowntime: true, isPlanned: true, affectsOEE: true,
    reasonCode: 'CHANGEOVER', category: 'CHANGEOVER',
    description: 'Product changeover. Planned, but still counted as a loss by default.',
  },
  {
    state: 'STARVED',
    isDowntime: true, isPlanned: false, affectsOEE: false,
    reasonCode: 'STARVED', category: 'MATERIAL',
    debounceSeconds: 5, // derived from neighbouring states, which move together
    description:
      'Ready, but nothing arriving from upstream. EXTERNAL loss: recorded so the ' +
      'constraint is visible, excluded from this machine’s own OEE so it is not ' +
      'punished for waiting.',
  },
  {
    state: 'BLOCKED',
    isDowntime: true, isPlanned: false, affectsOEE: false,
    reasonCode: 'BLOCKED', category: 'PROCESS',
    debounceSeconds: 5, // derived from neighbouring states, which move together
    description:
      'Ready, but nowhere to discharge downstream. EXTERNAL loss, treated exactly ' +
      'as STARVED is.',
  },
  {
    state: 'OFFLINE',
    isDowntime: true, isPlanned: false, affectsOEE: false,
    reasonCode: 'EXTERNAL', category: 'EXTERNAL',
    description: 'No signal from the machine. Recorded, but not charged as a fault.',
  },
];

async function main() {
  const factories = await prisma.factory.findMany({
    where: { isActive: true },
    select: { id: true, code: true },
  });

  let created = 0;
  let kept = 0;

  for (const f of factories) {
    for (const r of RULES) {
      // Factory-wide rule: machineId null. A per-machine override can be added in
      // the app on top of this without the seed ever touching it.
      const existing = await prisma.machineStateRule.findFirst({
        where: { factoryId: f.id, machineId: null, state: r.state },
        select: { id: true },
      });
      if (existing) {
        kept++;
        continue;
      }

      await prisma.machineStateRule.create({
        data: {
          factoryId: f.id,
          machineId: null,
          state: r.state,
          isDowntime: r.isDowntime,
          isPlanned: r.isPlanned,
          affectsOEE: r.affectsOEE,
          reasonCode: r.reasonCode,
          category: r.category as never,
          debounceSeconds: r.debounceSeconds ?? 0,
          description: r.description,
          isActive: true,
        },
      });
      created++;
    }
    console.log(`  ${f.code}: ${RULES.length} states reviewed`);
  }

  console.log(`\n[state-rules] created ${created}, kept ${kept}`);
}

main()
  .catch((e) => {
    console.error('[state-rules] seed failed:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
