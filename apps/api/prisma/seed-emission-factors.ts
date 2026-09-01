// ============================================================
// Industry360° — Scope 2 grid emission factor bootstrap
// ------------------------------------------------------------
// Ensures every factory has a grid emission factor so the Scope 2 carbon KPI
// (kg CO2e = kWh × factor) has an auditable, configured value instead of falling
// back to a hard-coded default.
//
// I360 supplied 0.568 kg CO2e/kWh for the KSA national grid.
//
// IDEMPOTENT AND NON-DESTRUCTIVE — this runs on EVERY boot:
//   • factory with no factor at all → insert the I360 baseline
//   • factory that already has one  → leave it completely alone
//
// The second rule matters: the factor is editable in the app (a new version is
// added and the previous one closed off, so historical carbon reports stay
// reproducible). A boot-time seed that overwrote it would silently revert the
// customer's own figure and corrupt past reports. So this only ever fills a gap.
//
// Run standalone:  node node_modules/.bin/ts-node --transpile-only prisma/seed-emission-factors.ts
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** I360-supplied factor for the KSA national grid, used as the PoC baseline. */
const KSA_GRID_FACTOR = 0.568;
const SOURCE = 'I360-supplied KSA national grid emission factor (PoC baseline)';
const EFFECTIVE_FROM = new Date('2026-01-01T00:00:00.000Z');

async function main() {
  const factories = await prisma.factory.findMany({ select: { id: true, code: true, name: true } });

  if (factories.length === 0) {
    console.log('  no factories yet — nothing to seed.');
    return;
  }

  let created = 0;
  let kept = 0;

  for (const f of factories) {
    const existing = await prisma.gridEmissionFactor.findFirst({
      where: { factoryId: f.id },
      orderBy: { effectiveFrom: 'desc' },
      select: { factorKgPerKwh: true, effectiveFrom: true },
    });

    if (existing) {
      kept += 1;
      console.log(
        `  ${f.code}: keeping configured factor ${existing.factorKgPerKwh} kg CO2e/kWh ` +
          `(effective ${existing.effectiveFrom.toISOString().slice(0, 10)})`,
      );
      continue;
    }

    await prisma.gridEmissionFactor.create({
      data: {
        factoryId: f.id,
        factorKgPerKwh: KSA_GRID_FACTOR,
        unit: 'kg CO2e/kWh',
        source: SOURCE,
        effectiveFrom: EFFECTIVE_FROM,
        isActive: true,
        notes:
          'Seeded baseline. Confirm with I360 whether 0.568 is fixed for the PoC or should ' +
          'track a published update; edit it in the app rather than here.',
      },
    });
    created += 1;
    console.log(`  ${f.code}: seeded ${KSA_GRID_FACTOR} kg CO2e/kWh`);
  }

  console.log(`✅ Grid emission factors — ${created} seeded, ${kept} left untouched.`);
}

main()
  .catch((e) => {
    console.error('❌ Emission-factor seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
