import { readFileSync } from 'node:fs';
import { routeCapability, filterNavByCapability, type FactoryCapability } from '../apps/web/src/lib/nav-capabilities';
import { FACTORIES, capabilitiesOf, CAPABILITY_ROUTES } from '../apps/api/prisma/plant/plant-model';

// Every href the real sidebar offers.
const src = readFileSync('apps/web/src/components/layout/sidebar.tsx', 'utf8');
const hrefs = [...new Set([...src.matchAll(/href:\s*'([^']+)'/g)].map((m) => m[1]))].sort();

console.log(`sidebar offers ${hrefs.length} distinct routes\n`);

const gated = hrefs.filter((h) => routeCapability(h));
console.log(`${gated.length} are capability-gated:`);
for (const h of gated) console.log(`   ${h.padEnd(28)} needs ${routeCapability(h)}`);

console.log('\nWhat each factory actually gets:\n');
const rows: Record<string, string[]> = {};
for (const f of FACTORIES) {
  const caps = capabilitiesOf(f) as unknown as FactoryCapability[];
  const tree = hrefs.map((h) => ({ href: h }));
  const kept = filterNavByCapability(tree, caps).map((x) => x.href!);
  const dropped = hrefs.filter((h) => !kept.includes(h));
  rows[f.code] = dropped;
  console.log(`${f.code}  [${f.type}]  ${caps.length} capabilities`);
  console.log(`   keeps  ${kept.length}/${hrefs.length} routes`);
  console.log(`   hides  ${dropped.length ? dropped.join(', ') : '(nothing)'}\n`);
}

// The three must genuinely differ, or the classification does nothing.
const sets = Object.values(rows).map((r) => r.sort().join('|'));
const allSame = sets.every((s) => s === sets[0]);
console.log(allSame ? 'FAIL — all three factories see the same nav' : 'OK — the three factories see different navigation');

// Web and API tables must agree, or the sidebar offers what the backend refuses.
const apiRoutes = new Set(Object.values(CAPABILITY_ROUTES).map((r) => r.href));
const missing = gated.filter((h) => !apiRoutes.has(h) && !gated.some((g) => g !== h && h.startsWith(g + '/')));
console.log(missing.length ? `WARN — gated in web but absent from CAPABILITY_ROUTES: ${missing.join(', ')}` : 'OK — web gating agrees with the API capability routes');
process.exit(allSame ? 1 : 0);
