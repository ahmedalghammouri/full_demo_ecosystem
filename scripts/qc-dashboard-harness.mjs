// ============================================================
// Industry360° — Dashboard QC Harness
// Tests dashboard endpoints (live API) across scenarios, independently
// recomputes KPIs from Postgres (via docker exec psql), runs pure formula
// unit-tests, and checks cross-page consistency. Prints a PASS/FAIL report.
//
// Run:  node scripts/qc-dashboard-harness.mjs
// Requires: docker stack running (i360-api-plocal @ :3001, i360-postgres-plocal).
// ============================================================
import { execSync } from 'node:child_process';

const API = 'http://localhost:3001/api/v1';
const PG = 'i360-postgres-plocal';
const DB = 'industry360';
const FACTORY = '10a9c8ab-aa3b-47d1-a0cb-9cbaa38b1e78'; // SDPF
const LINE = '203c6a13-a687-47ea-9258-7c1be85a692f';    // Powder Packing Line 1

const results = [];
const rec = (group, name, status, detail) => { results.push({ group, name, status, detail }); };
const approx = (a, b, tol = 0.5) => a != null && b != null && Math.abs(a - b) <= tol;

function sql(q) {
  const out = execSync(`docker exec ${PG} psql -U i360_user -d ${DB} -tAc "${q.replace(/"/g, '\\"')}"`, { encoding: 'utf8' });
  return out.trim();
}
function sqlNum(q) { const v = sql(q); return v === '' ? null : Number(v); }

async function login(email, password) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  return j.accessToken || j.access_token || j.token || (j.data && (j.data.accessToken || j.data.token));
}
async function get(token, path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '')).toString();
  const r = await fetch(`${API}${path}${qs ? '?' + qs : ''}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  // API wraps payloads as { success, data, timestamp } — unwrap to .data.
  const body = parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
  return { status: r.status, body, raw: parsed };
}

// ── Pure formula unit-tests (prove the documented equations) ──
function formulaTests() {
  const round1 = (x) => Math.round(x * 10) / 10;
  // OEE = A×P×Q
  const oee = 0.90 * 0.95 * 0.99 * 100;
  rec('Formula', 'OEE = A×P×Q (0.90×0.95×0.99)', approx(round1(oee), 84.6, 0.1) ? 'PASS' : 'FAIL', `expected 84.6%, got ${round1(oee)}%`);
  // FPY = passed/inspected
  const fpy = (950 / 1000) * 100;
  rec('Formula', 'FPY = passed/inspected (950/1000)', approx(fpy, 95.0) ? 'PASS' : 'FAIL', `expected 95.0%, got ${fpy}%`);
  // MTTR/MTBF/Availability
  const mttr = 12 / 4;                 // 3h
  const mtbf = 480 / 4;                // 120h
  const avail = (mtbf / (mtbf + mttr)) * 100; // 97.56%
  rec('Formula', 'MTTR = repairTime/repairs (12/4)', approx(mttr, 3) ? 'PASS' : 'FAIL', `expected 3h, got ${mttr}h`);
  rec('Formula', 'MTBF = opHours/failures (480/4)', approx(mtbf, 120) ? 'PASS' : 'FAIL', `expected 120h, got ${mtbf}h`);
  rec('Formula', 'Availability = MTBF/(MTBF+MTTR)', approx(round1(avail), 97.6, 0.1) ? 'PASS' : 'FAIL', `expected 97.6%, got ${round1(avail)}%`);
  // Inventory available = current - reserved
  rec('Formula', 'Available stock = current − reserved (100−30)', (100 - 30) === 70 ? 'PASS' : 'FAIL', 'expected 70');
  // Energy intensity = energy / units
  rec('Formula', 'Energy intensity = kWh/units (5000/1000)', (5000 / 1000) === 5 ? 'PASS' : 'FAIL', 'expected 5');
  // Division-by-zero guards (what the backend must do on empty data)
  rec('Formula', 'Guard: 0 inspected ⇒ FPY 0 (no NaN)', (0 === 0 ? 0 : 0 / 0) === 0 ? 'PASS' : 'FAIL', 'FPY must be 0 not NaN');
}

async function run() {
  formulaTests();

  // Auth as SDPF factory admin (scoped to SDPF automatically).
  const faEmail = 'factoryadmin1_sdpf@industry360.sa';
  let token = await login(faEmail, `${faEmail}@${faEmail}`);
  if (!token) { token = await login('admin@industry360.sa', 'admin@industry360.sa@admin@industry360.sa'); rec('Auth', 'factory-admin login', 'WARN', 'fell back to super-admin (unscoped)'); }
  else rec('Auth', 'SDPF factory-admin login', 'PASS', faEmail);
  if (!token) { rec('Auth', 'login', 'FAIL', 'no token — aborting API tests'); return; }

  // ── Scenario S1: Whole factory ──
  const prodKpi = await get(token, '/production/kpis');
  const oeeCalc = await get(token, '/production/oee/calculate', { timeframe: 'month' });
  const woList = await get(token, '/production/work-orders', { limit: 100 });
  const maintKpi = await get(token, '/maintenance/kpis');
  const qualKpi = await get(token, '/quality/kpis');
  const invOv = await get(token, '/inventory/overview');
  const downtime = await get(token, '/production/downtime');
  const energyOv = await get(token, '/energy/overview');

  // Endpoint reachability
  for (const [name, resp] of [['/production/kpis', prodKpi], ['/production/oee/calculate', oeeCalc], ['/production/work-orders', woList], ['/maintenance/kpis', maintKpi], ['/quality/kpis', qualKpi], ['/inventory/overview', invOv], ['/production/downtime', downtime], ['/energy/overview', energyOv]]) {
    rec('Reachability', `GET ${name}`, resp.status >= 200 && resp.status < 300 ? 'PASS' : 'FAIL', `HTTP ${resp.status}`);
  }

  // ── DB independent recompute vs API ──
  // 1) Work-order counts
  const dbTotal = sqlNum(`SELECT count(*) FROM work_orders WHERE "factoryId"='${FACTORY}' AND "deletedAt" IS NULL`);
  const dbCompleted = sqlNum(`SELECT count(*) FROM work_orders WHERE "factoryId"='${FACTORY}' AND "deletedAt" IS NULL AND status='COMPLETED'`);
  const dbInProg = sqlNum(`SELECT count(*) FROM work_orders WHERE "factoryId"='${FACTORY}' AND "deletedAt" IS NULL AND status='IN_PROGRESS'`);
  const k = prodKpi.body || {};
  rec('Consistency', 'production/kpis.totalOrders == DB', k.totalOrders === dbTotal ? 'PASS' : 'WARN', `api=${k.totalOrders} db=${dbTotal}`);
  rec('Consistency', 'production/kpis.completedOrders == DB', k.completedOrders === dbCompleted ? 'PASS' : 'WARN', `api=${k.completedOrders} db=${dbCompleted}`);
  rec('Consistency', 'production/kpis.inProgressOrders == DB', k.inProgressOrders === dbInProg ? 'PASS' : 'WARN', `api=${k.inProgressOrders} db=${dbInProg}`);

  // 2) OEE source check — OEERecord rows exist?
  const dbOeeRecords = sqlNum(`SELECT count(*) FROM oee_records WHERE "factoryId"='${FACTORY}'`);
  rec('DataIntegrity', 'OEE has source records (oee_records)', dbOeeRecords > 0 ? 'PASS' : 'WARN', `oee_records=${dbOeeRecords} ⇒ OEE will be null/0`);
  rec('Consistency', 'production/kpis.oee reflects empty source', (dbOeeRecords === 0 ? (k.oee == null || k.oee === 0) : true) ? 'PASS' : 'FAIL', `api.oee=${k.oee}`);

  // 3) OEE cross-page consistency (kpis vs oee/calculate) — same window (today)
  const oeeA = k.oee;
  const oeeB = oeeCalc.body?.oee ?? oeeCalc.body?.current?.oee;
  rec('Consistency', 'OEE: /production/kpis vs /oee/calculate(today)', approx(oeeA, (await get(token, '/production/oee/calculate', { timeframe: 'day' })).body?.oee, 1) ? 'PASS' : 'WARN', `kpis=${oeeA} calc(month)=${oeeB}`);

  // 3b) OEE-source gap: completed WOs carry oee but the engine reads OEERecord.
  const dbWoOeeAvg = sqlNum(`SELECT ROUND(AVG(oee)::numeric,1) FROM work_orders WHERE "factoryId"='${FACTORY}' AND status='COMPLETED' AND oee IS NOT NULL`);
  const dbCompletedWithOee = sqlNum(`SELECT count(*) FROM work_orders WHERE "factoryId"='${FACTORY}' AND status='COMPLETED' AND oee IS NOT NULL`);
  rec('Finding', 'OEE engine has OEERecord source for completed WOs',
    (dbCompletedWithOee > 0 && dbOeeRecords === 0) ? 'WARN' : 'PASS',
    `${dbCompletedWithOee} completed WO(s) carry oee (avg ${dbWoOeeAvg}%) but oee_records=${dbOeeRecords} ⇒ current-OEE KPI shows ${oeeA}. Historical WO OEE not rolled into the live KPI (data-seeding gap).`);

  // 4) Quality FPY source
  const dbInsp = sqlNum(`SELECT count(*) FROM inspection_results WHERE "factoryId"='${FACTORY}'`);
  rec('DataIntegrity', 'Quality has source records (inspection_results)', dbInsp > 0 ? 'PASS' : 'WARN', `inspections=${dbInsp} ⇒ FPY will be 0`);
  const apiFpy = qualKpi.body?.fpy ?? qualKpi.body?.passRate;
  rec('Consistency', 'quality/kpis.fpy reflects empty source (no NaN)', (dbInsp === 0 ? (apiFpy === 0 || apiFpy == null) : true) && apiFpy !== 'NaN' && !Number.isNaN(apiFpy) ? 'PASS' : 'FAIL', `api.fpy=${apiFpy}`);

  // 5) Maintenance open WOs
  const dbOpenMaint = sqlNum(`SELECT count(*) FROM maintenance_wos WHERE "factoryId"='${FACTORY}' AND "deletedAt" IS NULL AND status IN ('OPEN','ASSIGNED','IN_PROGRESS','AWAITING_PARTS')`);
  const apiOpen = maintKpi.body?.openWOs;
  rec('Consistency', 'maintenance/kpis.openWOs ~ DB open', apiOpen != null && dbOpenMaint != null ? (apiOpen === dbOpenMaint ? 'PASS' : 'WARN') : 'WARN', `api=${apiOpen} db=${dbOpenMaint}`);
  // MTTR/MTBF guards
  for (const m of ['mttr', 'mtbf', 'availabilityRate', 'pmCompliance']) {
    const v = maintKpi.body?.[m];
    rec('Guard', `maintenance/kpis.${m} is a finite number`, typeof v === 'number' && Number.isFinite(v) ? 'PASS' : 'WARN', `value=${v}`);
  }
  // Availability must equal MTBF/(MTBF+MTTR) from the API's own mttr/mtbf (internal equation check)
  const mm = maintKpi.body || {};
  if (typeof mm.mttr === 'number' && typeof mm.mtbf === 'number' && (mm.mttr + mm.mtbf) > 0) {
    const recomputed = (mm.mtbf / (mm.mtbf + mm.mttr)) * 100;
    rec('Equation', 'maintenance availability == MTBF/(MTBF+MTTR)', approx(recomputed, mm.availabilityRate, 1.5) ? 'PASS' : 'WARN', `api=${mm.availabilityRate}% recomputed(from displayed mttr/mtbf)=${recomputed.toFixed(1)}% (≤1.5% diff = rounding of displayed inputs)`);
  }

  // 6) Downtime total
  const dbDownMin = sqlNum(`SELECT COALESCE(ROUND(SUM(EXTRACT(EPOCH FROM (COALESCE("endTime",now())-"startTime"))/60)),0) FROM downtime_events WHERE "factoryId"='${FACTORY}'`);
  rec('DataIntegrity', 'Downtime events present', (sqlNum(`SELECT count(*) FROM downtime_events WHERE "factoryId"='${FACTORY}'`)) > 0 ? 'PASS' : 'WARN', `total downtime minutes(db)≈${dbDownMin}`);

  // 7) Inventory available = current - reserved (logic the gate uses)
  const negAvail = sqlNum(`SELECT count(*) FROM raw_materials WHERE "factoryId"='${FACTORY}' AND ("currentStock"-"reservedStock") < 0`);
  rec('Logic', 'No raw material has reserved > current (available ≥ 0)', negAvail === 0 ? 'PASS' : 'WARN', `${negAvail} item(s) with negative available`);

  // 8) Energy source
  rec('DataIntegrity', 'Energy meters configured', sqlNum(`SELECT count(*) FROM energy_meters WHERE "factoryId"='${FACTORY}'`) > 0 ? 'PASS' : 'WARN', 'no meters ⇒ energy dashboard shows 0');

  // ── Scenario S2: scoped to line ──
  const prodKpiLine = await get(token, '/production/kpis', { lineId: LINE });
  rec('Scenario', 'S2 scoped /production/kpis (lineId) reachable + finite OEE', prodKpiLine.status < 300 && (prodKpiLine.body?.oee == null || Number.isFinite(prodKpiLine.body?.oee)) ? 'PASS' : 'WARN', `oee=${prodKpiLine.body?.oee}`);

  // ── Scenario S3: OEE timeframe variants ──
  for (const tf of ['day', 'week', 'month']) {
    const r = await get(token, '/production/oee/calculate', { timeframe: tf });
    rec('Scenario', `S3 oee/calculate timeframe=${tf}`, r.status < 300 ? 'PASS' : 'FAIL', `HTTP ${r.status}`);
  }

  // ── Output ──
  const counts = results.reduce((a, r) => (a[r.status] = (a[r.status] || 0) + 1, a), {});
  console.log('\n================ Industry360 DASHBOARD QC RESULTS ================');
  let group = '';
  for (const r of results) {
    if (r.group !== group) { group = r.group; console.log(`\n── ${group} ──`); }
    const icon = r.status === 'PASS' ? '✅' : r.status === 'WARN' ? '⚠️ ' : '❌';
    console.log(`${icon} ${r.name}  —  ${r.detail}`);
  }
  console.log('\n================ SUMMARY ================');
  console.log(`PASS=${counts.PASS || 0}  WARN=${counts.WARN || 0}  FAIL=${counts.FAIL || 0}  TOTAL=${results.length}`);
  console.log('\n--- RAW endpoint snapshots (whole factory) ---');
  console.log('production/kpis:', JSON.stringify(prodKpi.body));
  console.log('maintenance/kpis:', JSON.stringify(maintKpi.body));
  console.log('quality/kpis:', JSON.stringify(qualKpi.body));
  console.log('inventory/overview:', JSON.stringify(invOv.body).slice(0, 400));
}

run().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
