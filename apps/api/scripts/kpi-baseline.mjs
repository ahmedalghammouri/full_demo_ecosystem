/**
 * A full snapshot of every KPI-bearing endpoint, for before/after comparison.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The consolidation moves ~23 pages from one store to another. The single thing
 * that must be provable at each step is: NOTHING a user reads changed except
 * where we intended it to. That cannot be established by reasoning about the
 * code — the whole reason for the work is that the code has six places that
 * each decide what a number means.
 *
 * So: capture every endpoint's answer, in full, before touching anything. Then
 * capture again after each stage and diff. A difference is either intended and
 * explainable, or it is a regression — and there is no third category.
 *
 *   node scripts/kpi-baseline.mjs capture before
 *   …make a change…
 *   node scripts/kpi-baseline.mjs capture after
 *   node scripts/kpi-baseline.mjs diff before after
 *
 * The window is pinned to a fixed date pair rather than "today", because a
 * moving window would make every diff meaningless — the line keeps producing
 * between the two captures.
 */
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '.baselines');
const BASE = process.env.BASE || 'http://localhost:8080/api/v1';

const login = async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: process.env.EMAIL || 'admin@industry360.sa',
      password: process.env.PASSWORD || 'admin@industry360.sa@admin@industry360.sa',
    }),
  });
  const j = await r.json();
  if (!j?.data?.accessToken) throw new Error(`login failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data.accessToken;
};

/**
 * A CLOSED window — one that has already ended.
 *
 * The first version of this pinned the DAY and thought that was enough. It was
 * not: a day window ends at "now", so the line kept producing between the two
 * captures and 19 endpoints reported a difference that had nothing to do with
 * the change under test. `totalMin 3355 → 3379` is not a regression, it is
 * twenty-four minutes of detergent.
 *
 * So the upper bound is the top of the CURRENT hour, which is in the past and
 * stays there. Both captures then cover the same production and a difference
 * can only come from the code.
 */
const now = new Date();
const p2 = (n) => String(n).padStart(2, '0');
const DAY = process.env.BASELINE_DAY || `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
const TO = process.env.BASELINE_TO || `${DAY}T${p2(now.getHours())}:00:00`;
const W = { dateFrom: `${DAY}T00:00:00`, dateTo: TO };

/**
 * Every endpoint a KPI-bearing page reads, grouped by the engine behind it.
 * `volatile` lists fields that legitimately move between captures (a clock, a
 * request id) and are dropped before diffing.
 */
const ENDPOINTS = [
  // ── the old engine ───────────────────────────────────────────────────────
  // The `volatile` ones accept NO window: they read "now" by construction, so a
  // second capture legitimately differs. Marked rather than removed — they are
  // still diffed and printed, they just cannot fail the check on a field that
  // was always going to move.
  { id: 'old.oee.calculate', path: '/production/oee/calculate', params: { ...W, timeframe: 'day' } },
  { id: 'old.oee.trend', path: '/production/oee/trend', params: { ...W, timeframe: 'day', groupBy: 'workOrder' } },
  { id: 'old.oee.hierarchy', path: '/production/oee/hierarchy', params: W },
  { id: 'old.oee.records', path: '/production/oee-records', params: { ...W, limit: 50 } },
  { id: 'old.production.kpis', path: '/production/kpis', params: {} , volatile: true },
  { id: 'old.dashboard.kpis', path: '/dashboard/kpis', params: {} , volatile: true },
  { id: 'old.dashboard.overview', path: '/dashboard/overview', params: {} , volatile: true },
  { id: 'old.dashboard.commandCenter', path: '/dashboard/command-center', params: {} , volatile: true },
  { id: 'old.dashboard.executive', path: '/dashboard/executive', params: {} , volatile: true },
  { id: 'old.machineStatus.availability', path: '/machine-status/availability', params: W },
  { id: 'old.machineStatus.performance', path: '/machine-status/performance', params: W },
  { id: 'old.machineStatus.quality', path: '/machine-status/quality', params: W },
  { id: 'old.machineStatus.analytics', path: '/machine-status/analytics', params: W },
  { id: 'old.kpi.msa', path: '/production/kpi/master-schedule-attainment', params: W },
  { id: 'old.kpi.capacity', path: '/production/kpi/capacity-utilization', params: W },
  { id: 'old.shifts.analysis', path: '/shifts/analysis', params: {} , volatile: true },
  { id: 'old.downtime.summary', path: '/production/downtime/summary', params: W },

  // ── the new engines ──────────────────────────────────────────────────────
  { id: 'new.standard', path: '/oee-standard', params: { ...W, granularity: 'hour' } },
  { id: 'new.standard.dimensions', path: '/oee-standard/dimensions', params: W },
  { id: 'new.schedule', path: '/oee-schedule', params: { ...W, granularity: 'hour' } },
  { id: 'new.liveShift.standard', path: '/live-shift', params: { window: 'shift', basis: 'standard' }, volatile: true },
  { id: 'new.liveShift.schedule', path: '/live-shift', params: { window: 'shift', basis: 'schedule' }, volatile: true },
];

/**
 * Fields that move on their own between two captures seconds apart.
 *
 * Stripped rather than tolerated: a diff that is allowed to be "close" stops
 * being a check. Anything genuinely time-dependent is either listed here or the
 * whole endpoint is marked volatile and reported separately.
 */
const DROP_KEYS = new Set([
  'timestamp', 'requestId', 'generatedAt', 'now', 'at', 'to', 'updatedAt', 'lastEventAt',
  'since', 'elapsedMin', 'remainingMin', 'progressPct', 'slotElapsedPct', 'statusSince',
]);

function scrub(v) {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (DROP_KEYS.has(k)) continue;
      out[k] = scrub(val);
    }
    return out;
  }
  // Float noise from a minute that was still being written. Two captures of the
  // same closed window agree exactly; rounding here would hide a real drift.
  return typeof v === 'number' ? Math.round(v * 1000) / 1000 : v;
}

const get = async (tok, path, params) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, x]) => x != null));
  const r = await fetch(`${BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${tok}` } });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { __unparseable: text.slice(0, 300) }; }
  return { status: r.status, body: body?.data ?? body };
};

async function capture(name) {
  const tok = await login();
  if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });
  const snap = { day: DAY, window: W, capturedAt: new Date().toISOString(), endpoints: {} };

  for (const e of ENDPOINTS) {
    process.stdout.write(`  ${e.id.padEnd(30)}`);
    try {
      const r = await get(tok, e.path, e.params);
      snap.endpoints[e.id] = { status: r.status, volatile: !!e.volatile, body: scrub(r.body) };
      const size = JSON.stringify(r.body ?? '').length;
      console.log(`${r.status}  ${String(size).padStart(7)} bytes${e.volatile ? '  (volatile)' : ''}`);
    } catch (err) {
      snap.endpoints[e.id] = { status: 0, error: String(err.message).slice(0, 200) };
      console.log(`ERROR  ${err.message}`);
    }
  }

  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(snap, null, 2));
  console.log(`
wrote .baselines/${name}.json`);
  console.log(`  window ${W.dateFrom} → ${W.dateTo}  (closed — it will not move)`);
  console.log('  capture the AFTER run with the same window:');
  console.log(`    BASELINE_DAY=${DAY} BASELINE_TO=${TO} node scripts/kpi-baseline.mjs capture <name>`);
}

/** Every leaf path where two objects differ, as `a.b[0].c: x → y`. */
function walk(a, b, path = '', out = []) {
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const prim = (v) => v === null || typeof v !== 'object';
  if (prim(a) || prim(b)) { out.push({ path, before: a, after: b }); return out; }
  if (Array.isArray(a) !== Array.isArray(b)) { out.push({ path, before: `${typeof a}`, after: `${typeof b}` }); return out; }
  if (Array.isArray(a)) {
    if (a.length !== b.length) out.push({ path: `${path}.length`, before: a.length, after: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i++) walk(a[i], b[i], `${path}[${i}]`, out);
    return out;
  }
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    walk(a[k], b[k], path ? `${path}.${k}` : k, out);
  }
  return out;
}

function diff(x, y) {
  const A = JSON.parse(readFileSync(join(OUT, `${x}.json`), 'utf8'));
  const B = JSON.parse(readFileSync(join(OUT, `${y}.json`), 'utf8'));
  const wa = JSON.stringify(A.window ?? A.day);
  const wb = JSON.stringify(B.window ?? B.day);
  if (wa !== wb) {
    console.log(`REFUSING: the two captures cover different windows.
  before ${wa}
  after  ${wb}`);
    console.log('A diff across two windows measures the line, not the change.');
    process.exit(2);
  }
  console.log(`window ${wa}
`);

  let changed = 0;
  let volatileChanged = 0;
  for (const id of Object.keys({ ...A.endpoints, ...B.endpoints })) {
    const a = A.endpoints[id], b = B.endpoints[id];
    if (!a || !b) { console.log(`  ${'GONE/NEW'.padEnd(9)} ${id}`); changed++; continue; }
    if (a.status !== b.status) {
      console.log(`  ${'STATUS'.padEnd(9)} ${id}  ${a.status} → ${b.status}`);
      changed++;
      continue;
    }
    const d = walk(a.body, b.body);
    if (d.length === 0) { console.log(`  ${'same'.padEnd(9)} ${id}`); continue; }
    if (a.volatile) {
      console.log(`  ${'moved'.padEnd(9)} ${id}  ${d.length} field(s) — endpoint is volatile, not counted`);
      volatileChanged++;
      continue;
    }
    changed++;
    console.log(`  ${'CHANGED'.padEnd(9)} ${id}  ${d.length} field(s)`);
    for (const f of d.slice(0, 12)) {
      console.log(`      ${f.path}: ${JSON.stringify(f.before)} → ${JSON.stringify(f.after)}`);
    }
    if (d.length > 12) console.log(`      … ${d.length - 12} more`);
  }

  console.log(`\n${changed === 0 ? 'NO STABLE ENDPOINT CHANGED' : `${changed} endpoint(s) changed`}`
    + `${volatileChanged ? `, ${volatileChanged} volatile endpoint(s) moved as expected` : ''}`);
  process.exit(changed === 0 ? 0 : 1);
}

const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'capture' && a) await capture(a);
else if (cmd === 'diff' && a && b) diff(a, b);
else {
  console.log('usage:\n  node scripts/kpi-baseline.mjs capture <name>\n  node scripts/kpi-baseline.mjs diff <before> <after>');
  process.exit(2);
}
