// ============================================================
// Industry360° — Production init / master-data bootstrap
// ------------------------------------------------------------
// Runs ONCE when the stack first comes up (see the `migrate-seed`
// service in docker-compose.prod.yml). It is idempotent:
//
//   • DB empty   → load master data only (users, factories, SKUs,
//                  raw materials, machines, shifts, downtime tree,
//                  product master data) via seed-i360-master.ts,
//                  then the Dashboard Center catalog.
//   • DB has data → skip, so restarts NEVER wipe what you entered.
//
// NOTE: seed-i360-master.ts performs a full TRUNCATE on run, which is
// exactly why we guard it behind the "is the DB empty?" check here.
// No production / manufacturing demo data (work orders, production
// orders, inspections, NCR/CAPA, SPC, sensor history) is loaded.
// ============================================================
const { PrismaClient } = require('@prisma/client');
const { execFileSync } = require('child_process');
const path = require('path');

async function alreadySeeded() {
  const prisma = new PrismaClient();
  try {
    const count = await prisma.enterprise.count();
    return count;
  } catch (e) {
    // Table may not exist yet on a brand-new DB — treat as empty.
    return 0;
  } finally {
    await prisma.$disconnect().catch(() => {});
  }
}

function runSeed(file) {
  const tsNode = require.resolve('ts-node/dist/bin.js');
  const seedPath = path.join(__dirname, file);
  console.log(`\n▶ Running ${file} ...`);
  execFileSync('node', [tsNode, '--transpile-only', seedPath], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'), // /app  (so relative imports resolve)
  });
}

(async () => {
  const count = await alreadySeeded();

  if (count > 0) {
    console.log(`✅ Master data already present (${count} enterprise) — skipping master seed.`);
  } else {
    console.log('▶ Empty database detected — loading master data (no production/manufacturing data)...');
    runSeed('seed-i360-master.ts'); // users, factories, machines, SKUs, materials, shifts, downtime tree
  }

  // The Dashboard Center catalog is idempotent CONFIG (slug/key-keyed upserts), NOT
  // production data — so (re)seed it on EVERY boot. This self-heals an empty catalog
  // and picks up newly added dashboards on each deploy, regardless of DB state.
  // A catalog failure must never block the stack from starting → log, don't exit.
  try {
    runSeed('seed-dashboard-center.ts');
  } catch (e) {
    console.error('⚠ Dashboard Center seed failed (non-fatal):', e?.message ?? e);
  }

  // RBAC — seed the canonical permission catalog on every boot (idempotent upserts,
  // picks up newly shipped permissions) and the default role→permission matrix on
  // first boot only (admin edits in the Access Control UI are never overwritten).
  try {
    runSeed('seed-rbac.ts');
  } catch (e) {
    console.error('⚠ RBAC seed skipped (non-fatal):', e?.message ?? e);
  }

  // Quantity units — repairs quantities stored before units were recorded, and
  // recomputes work-order totals from their job orders in PIECES. Convergent: every
  // value is re-derived from source, so running it on every boot is safe and it
  // self-heals if a bad write ever slips through.
  try {
    runSeed('backfill-quantity-units.ts');
  } catch (e) {
    console.error('⚠ Quantity-unit backfill skipped (non-fatal):', e?.message ?? e);
  }

  // Scope 2 grid emission factor — CONFIG, so it runs on every boot like the two
  // seeds above. It only fills a gap: a factory that already has a factor keeps it,
  // because the value is editable in the app and overwriting it would silently
  // revert the customer's own figure and change past carbon reports.
  try {
    runSeed('seed-emission-factors.ts');
  } catch (e) {
    console.error('⚠ Emission-factor seed skipped (non-fatal):', e?.message ?? e);
  }

  // Machine STATUS tags — CONFIG, same contract as the seed above: it only fills
  // a gap and never touches a machine that already has a status tag bound, so an
  // address or value map an engineer corrected on site survives every restart.
  //
  // Without these, a machine that stops produces no downtime event at all: the
  // counters go quiet and nothing records why.
  try {
    runSeed('seed-machine-status-tags.ts');
  } catch (e) {
    console.error('⚠ Machine status-tag seed skipped (non-fatal):', e?.message ?? e);
  }

  // The ProductionSnapshot backfill used to run here. That store is deleted —
  // table, model and writer — and `oee_minutes` is the only place a measured
  // minute lives now. The require() outlived the deletion, throwing into its own
  // catch on every boot and logging a warning about a module that is gone.

  // Machine numbering — CONFIG, and convergent: the order comes from the ROUTING
  // and codes are rewritten only where they disagree, so running it on every boot
  // is safe and it self-heals a line left half-renumbered by a partial run. A
  // retired machine is moved OUT of the numbering, never deleted.
  try {
    runSeed('renumber-machines.ts');
  } catch (e) {
    console.error('⚠ Machine renumbering skipped (non-fatal):', e?.message ?? e);
  }

  // Powder Filler's PROCESSING signal — same contract as the status-tag seed above: it
  // fills a gap so STARVED can be told apart from BREAKDOWN at the filler, which is
  // impossible without it. Keyed on the tag code, so it converges rather than
  // duplicating.
  try {
    runSeed('seed-m1-carton-pusher.ts');
  } catch (e) {
    console.error('⚠ Carton-pusher tag seed skipped (non-fatal):', e?.message ?? e);
  }

  // How fast the counter devices are polled — plant data, not a constant. A
  // pulse shorter than the interval is missed silently, which is how 44 cartons
  // were recorded as 4. Only ever lowered, and only on devices carrying a
  // counter tag, so a deliberately slowed device stays slowed.
  try {
    runSeed('counter-poll-rate.ts');
  } catch (e) {
    console.error('⚠ Counter poll rate skipped (non-fatal):', e?.message ?? e);
  }

  // Give every shift template a ScheduleRule.
  //
  // Recurrence moved out of ShiftTemplate.days into ScheduleRule, and the
  // planned-stop generator reads only the new column. A shift that was never
  // migrated therefore looked like a shift with NO recurrence, and every
  // planned stop attached to it produced zero events while reporting success —
  // a break configured correctly, on a shift configured correctly, appearing
  // nowhere. Convergent: a template that already has a rule is skipped.
  try {
    runSeed('migrate-planned-stops.ts');
  } catch (e) {
    console.error('⚠ Shift recurrence migration skipped (non-fatal):', e?.message ?? e);
  }

  // Close orphaned open machine_state_records — the data left behind by a
  // concurrency race in the edge gateway's status writer, fixed in
  // status.service.ts but not retroactive. Convergent: a machine with at most
  // one open record is skipped, so this is a no-op after the first boot that
  // runs it.
  try {
    runSeed('repair-orphaned-state-records.ts');
  } catch (e) {
    console.error('⚠ Orphaned state record repair skipped (non-fatal):', e?.message ?? e);
  }

  console.log('\n✅ Init complete. Login: admin@industry360.sa');
})().catch((e) => {
  console.error('❌ prod-init failed:', e);
  process.exit(1);
});
