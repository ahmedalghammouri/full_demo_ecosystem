/**
 * The line basis, checked against the page's own machine table.
 *
 * A line OEE is only trustworthy if you can rebuild it from figures already on
 * the screen. So every assertion here is made against the SAME response that
 * carries the line number — never against a second query that could be right
 * while the page is wrong:
 *
 *   1. A single machine has no line basis, and says so.
 *   2. BOTTLENECK takes A and P from the constraint's own row in the table.
 *   3. Line Quality = last-station good ÷ (that + scrap at every machine),
 *      and theoretical comes from the same station as good.
 *   4. Line OEE = A × P × Q, to the same rounding the page shows.
 *   5. ROLLUP returns the engine's own line-scoped aggregate, unchanged.
 *   6. The two methods genuinely differ — a switch that changes nothing is a
 *      switch that is not wired.
 *   7. Above a line, minutes and pieces stay additive while percentages average.
 */
const BASE = process.env.BASE || 'http://localhost:8080/api/v1';

const login = async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@industry360.sa',
      password: 'admin@industry360.sa@admin@industry360.sa',
    }),
  });
  const j = await r.json();
  if (!j?.data?.accessToken) throw new Error(`login failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data.accessToken;
};

const get = async (tok, path, params = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null));
  const r = await fetch(`${BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${tok}` } });
  const j = await r.json();
  if (j.statusCode >= 400) throw new Error(`${path} → ${j.statusCode} ${String(j.message).slice(0, 300)}`);
  return j.data ?? j;
};

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures++;
};
const near = (a, b, tol) => a != null && b != null && Math.abs(a - b) <= tol;
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const main = async () => {
  const tok = await login();
  const T = iso(new Date());
  const range = { dateFrom: T, dateTo: T, granularity: 'hour' };

  const tree = await get(tok, '/hierarchy/tree');
  const roots = Array.isArray(tree) ? tree : [tree];
  const lines = [];
  const walk = (n) => {
    if (n?.type === 'PRODUCTION_LINE') lines.push(n);
    (n?.children ?? []).forEach(walk);
  };
  roots.forEach(walk);
  if (lines.length === 0) throw new Error('no production line in the hierarchy');
  const line = lines[0];
  console.log(`line under test: ${line.code} ${line.name}  (${line.id})`);

  for (const engine of ['/oee-standard', '/oee-schedule']) {
    console.log(`\n${'='.repeat(70)}\n  ${engine}\n${'='.repeat(70)}`);

    // ── 1 ────────────────────────────────────────────────────────────────────
    const firstMachine = (line.children ?? []).find((c) => c.type === 'MACHINE');
    if (firstMachine) {
      const m = await get(tok, engine, { ...range, machineId: firstMachine.id, lineBasis: 'bottleneck' });
      check('a single machine reports no line basis', m.lineOee?.applies === false,
        `applies=${m.lineOee?.applies} level=${m.lineOee?.level}`);
    }

    // ── 2-4 ──────────────────────────────────────────────────────────────────
    const bn = await get(tok, engine, { ...range, lineId: line.id, lineBasis: 'bottleneck' });
    const lo = bn.lineOee;
    check('the line basis applies at line scope', lo?.applies === true, `level=${lo?.level}`);
    if (!lo?.applies) continue;

    const row = lo.lines[0];
    console.log(`   method=${row.method} (configured ${row.configured})`
      + `  constraint=${row.bottleneckName}`
      + `  outfeed=${row.outfeedNames.join('+')} [${row.outfeedResolvedBy}]`);
    console.log(`   A ${lo.availability}  P ${lo.performance}  Q ${lo.quality}  OEE ${lo.oee}`
      + `   good ${lo.counts.good}  rejected ${lo.counts.rejected}`);

    if (row.method === 'BOTTLENECK') {
      // A and P must be the constraint's OWN row in the machine table on screen.
      const constraint = (bn.machines ?? []).find((m) => m.label === row.bottleneckName
        || m.sublabel === row.bottleneckName || m.key === row.bottleneckId);
      check('the constraint has a row in the machine table', !!constraint,
        constraint ? '' : `looked for ${row.bottleneckName} among ${(bn.machines ?? []).map((m) => m.label).join(', ')}`);
      if (constraint) {
        check('line Availability is the constraint’s own',
          near(lo.availability, constraint.availability, 0.11),
          `line ${lo.availability} vs ${constraint.label} ${constraint.availability}`);
        check('line Performance is the constraint’s own',
          near(lo.performance, constraint.performance, 0.11),
          `line ${lo.performance} vs ${constraint.label} ${constraint.performance}`);
        check('line Availability is NOT the whole-line aggregate',
          bn.availability === constraint.availability
            || !near(lo.availability, bn.availability, 0.11),
          `line ${lo.availability} vs aggregate ${bn.availability}`);
      }

      // Scrap must be the WHOLE line's, not just the outfeed's.
      check('rejected counts every machine on the line',
        near(lo.counts.rejected, bn.counts.rejected, 1),
        `line ${lo.counts.rejected} vs engine aggregate ${bn.counts.rejected}`);

      const total = lo.counts.good + lo.counts.rejected;
      check('Quality = last-station good ÷ (that + line scrap)',
        total > 0 ? near(lo.quality, r1((lo.counts.good / total) * 100), 0.11) : lo.quality == null,
        `${lo.counts.good} / ${total} = ${total > 0 ? r1((lo.counts.good / total) * 100) : '—'}  vs ${lo.quality}`);

      check('counts.total is good + rejected', lo.counts.total === total,
        `${lo.counts.total} vs ${total}`);
    }

    const expectOee = lo.availability == null || lo.performance == null || lo.quality == null
      ? null
      : r1((lo.availability / 100) * (lo.performance / 100) * (lo.quality / 100) * 100);
    check('OEE = A × P × Q', near(lo.oee, expectOee, 0.11) || (lo.oee == null && expectOee == null),
      `${lo.oee} vs ${expectOee}`);

    // ── 5 and 6 ──────────────────────────────────────────────────────────────
    const ru = await get(tok, engine, { ...range, lineId: line.id, lineBasis: 'rollup' });
    const ro = ru.lineOee;
    console.log(`   ROLLUP  A ${ro.availability}  P ${ro.performance}  Q ${ro.quality}  OEE ${ro.oee}`);

    check('ROLLUP is the engine’s own line aggregate, untouched',
      near(ro.availability, ru.availability, 0.011)
      && near(ro.performance, ru.performance, 0.011)
      && near(ro.quality, ru.quality, 0.011),
      `basis ${ro.availability}/${ro.performance}/${ro.quality} vs engine ${ru.availability}/${ru.performance}/${ru.quality}`);

    check('ROLLUP says it overrode the line’s configured method',
      ro.lines[0].method === 'ROLLUP' && ro.lines[0].configured === row.configured,
      `method=${ro.lines[0].method} configured=${ro.lines[0].configured}`);

    if (row.method === 'BOTTLENECK') {
      // Compared on the FACTORS, not on OEE. When the line's quality is zero —
      // which it is whenever the last station has produced nothing yet — both
      // methods multiply out to zero for a reason that has nothing to do with
      // the method, and an OEE comparison would report a wired switch as dead.
      const differs = !near(lo.availability ?? -1, ro.availability ?? -2, 0.05)
        || !near(lo.performance ?? -1, ro.performance ?? -2, 0.05)
        || !near(lo.oee ?? -1, ro.oee ?? -2, 0.05);
      check('the two methods give different answers', differs,
        `bottleneck A ${lo.availability} P ${lo.performance} OEE ${lo.oee}`
        + `  vs rollup A ${ro.availability} P ${ro.performance} OEE ${ro.oee}`);
    }

    // ── 7 ────────────────────────────────────────────────────────────────────
    const fac = await get(tok, engine, { ...range, lineBasis: 'bottleneck' });
    const fo = fac.lineOee;
    console.log(`   FACTORY level=${fo.level} lines=${fo.lines.length}`
      + `  A ${fo.availability}  OEE ${fo.oee}`);
    check('factory scope reports the factory level', fo.level === 'FACTORY');
    if (fo.lines.length === 1) {
      check('a factory with one line reports that line',
        near(fo.oee, lo.oee, 0.11) || (fo.oee == null && lo.oee == null),
        `${fo.oee} vs line ${lo.oee}`);
    } else {
      const good = fo.lines.reduce((a, l) => a + l.counts.good, 0);
      check('pieces stay additive above a line', near(fo.counts.good, good, 1),
        `${fo.counts.good} vs Σ ${good}`);
    }
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
