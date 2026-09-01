import { validatePlantModel, plantSummary, moduleCoverage, ECOSYSTEM_MODULES, DEMO_USERS, LAYER_META } from './plant-model';

const issues = validatePlantModel();
const errors = issues.filter((i) => i.severity === 'ERROR');
const warns = issues.filter((i) => i.severity === 'WARN');

console.log('=== PLANT SUMMARY ===');
console.table(plantSummary());

console.log('\n=== ECOSYSTEM COVERAGE ===');
const cov = moduleCoverage();
let tot = 0, sc = 0;
for (const [k, v] of Object.entries(cov)) {
  console.log(`  ${LAYER_META[k as keyof typeof LAYER_META].name.padEnd(34)} ${String(v.score).padStart(5)} / ${String(v.total).padStart(2)}  ${String(v.pct).padStart(3)}%`);
  tot += v.total; sc += v.score;
}
console.log(`  ${'TOTAL'.padEnd(34)} ${String(sc).padStart(5)} / ${tot}  ${Math.round(sc/tot*100)}%`);
console.log(`  modules defined: ${ECOSYSTEM_MODULES.length}`);
console.log(`  demo users: ${DEMO_USERS.length}`);

console.log(`\n=== VALIDATION: ${errors.length} error(s), ${warns.length} warning(s) ===`);
for (const i of issues) console.log(`  [${i.severity}] ${i.factory}: ${i.message}`);
process.exit(errors.length ? 1 : 0);
