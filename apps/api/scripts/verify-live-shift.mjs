/**
 * The live shift page and the analysis page must agree.
 *
 * This is the check the whole design rests on. The live page exists because
 * "what is happening now" and "what happened" are different questions, but they
 * are asked of the SAME minutes — so if the two screens ever disagree about the
 * shift that is running, the split has recreated the problem it was built to
 * end.
 *
 * It is not testable by unit test: it is a property of two endpoints reading one
 * store, and only a live database can show whether they do.
 *
 *   1. Every live window lies inside the shift the header names.
 *   2. A narrower window returns no more than a wider one.
 *   3. The machine table reconciles to the headline.
 *   4. THE EQUIVALENCE: /live-shift?window=shift equals the analysis endpoint
 *      over the same instants and the same shift — factor by factor, machine by
 *      machine — on BOTH bases. The OEE / OEE-TB switch has to mean the same
 *      thing on the live page as on the analysis page, or the two screens are
 *      once again answering one question two ways.
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
const near = (a, b, tol) => Math.abs((a ?? 0) - (b ?? 0)) <= tol;

/**
 * Two values that are BOTH missing are not agreement.
 *
 * `near(undefined, undefined)` coerces both to 0 and passes, so a field that
 * neither side has looks like a match. That is how a comparison of
 * `time.operatingMin` — a key the payload does not have, since the engine calls
 * it `netProductionMin` — reported PASS while the page showed a dash.
 */
const agree = (a, b, tol) => a != null && b != null && near(a, b, tol);

/** A plant-local `YYYY-MM-DDTHH:mm:ss` — the format the analysis endpoint parses. */
const localStamp = (iso) => {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
    + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

const BASES = [
  { basis: 'standard', endpoint: '/oee-standard', top: 'totalMin' },
  { basis: 'schedule', endpoint: '/oee-schedule', top: 'committedMin' },
];

const main = async () => {
  const tok = await login();
  for (const b of BASES) await runBasis(tok, b);
  console.log(`
${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

const runBasis = async (tok, { basis, endpoint, top }) => {
  console.log(`
${'='.repeat(70)}
  BASIS: ${basis}   (${endpoint})
${'='.repeat(70)}`);

  console.log('── the shift, and each window inside it');
  const whole = await get(tok, '/live-shift', { window: 'shift', basis });
  check('the endpoint answered on the basis that was asked for', whole.basis === basis,
    `asked ${basis}, got ${whole.basis}`);
  const s = whole.shift;
  console.log(`   ${s.code} "${s.name}"  resolved=${s.resolved}`
    + `  ${new Date(s.start).toLocaleTimeString()} → ${new Date(s.end).toLocaleTimeString()}`
    + `  elapsed ${s.elapsedMin}m / ${s.plannedMin}m`);

  const shiftStart = new Date(s.start).getTime();
  const shiftEnd = new Date(s.end).getTime();

  const seen = [];
  for (const w of ['shift', '120', '60', '30', '15']) {
    const d = await get(tok, '/live-shift', { window: w, basis });
    const win = d.window;
    const from = new Date(win.from).getTime();
    const to = new Date(win.to).getTime();

    console.log(`   ${String(w).padStart(5)}  ${String(win.minutes).padStart(4)}m`
      + `  clamped=${win.clamped ? 'Y' : 'n'}  bucket=${d.bucketMin}m`
      + `  OEE=${String(d.oee).padStart(5)}  good=${String(d.counts?.good ?? 0).padStart(7)}`
      + `  trend=${String(d.trend?.length ?? 0).padStart(3)}  JO=${d.jobOrders?.length ?? 0}`);

    check(`window=${w} starts no earlier than the shift`, from >= shiftStart - 1000,
      `${new Date(from).toLocaleTimeString()} vs shift ${new Date(shiftStart).toLocaleTimeString()}`);
    check(`window=${w} ends no later than the shift`, to <= shiftEnd + 1000);

    const headline = d.time?.[top];
    check(`window=${w} reports its top-level bar (${top})`, headline != null,
      `keys: ${Object.keys(d.time ?? {}).join(',')}`);
    const machMin = (d.machines ?? []).reduce((a, m) => a + (m.time?.[top] ?? 0), 0);
    check(`window=${w} machine table reconciles to the headline`,
      near(machMin, headline ?? 0, Math.max(1, (headline ?? 0) * 0.001)),
      `${machMin.toFixed(1)}m vs ${(headline ?? 0).toFixed(1)}m`);

    seen.push({ w, minutes: win.minutes, total: headline ?? 0, good: d.counts?.good ?? 0 });
  }

  console.log('\n── narrower windows return less');
  for (let i = 1; i < seen.length; i++) {
    const wide = seen[i - 1];
    const narrow = seen[i];
    check(`${narrow.w} ≤ ${wide.w}`,
      narrow.total <= wide.total + 0.5 && narrow.good <= wide.good + 0.5,
      `${narrow.total.toFixed(0)}m/${narrow.good} vs ${wide.total.toFixed(0)}m/${wide.good}`);
  }

  // ── The equivalence ───────────────────────────────────────────────────────
  console.log('\n── live shift vs OEE Analysis, same instants, same shift');
  // On the schedule basis the analysis endpoint takes its SLOT bound from
  // dateTo while still capping the DATA window at now — which is exactly what
  // the live page does with the shift end. Handing it the shift end therefore
  // reproduces the live window and the live slot in one call. Handing it `now`
  // drops the unreached remainder, and the two disagree by construction.
  const analysis = await get(tok, endpoint, {
    dateFrom: localStamp(whole.window.from),
    dateTo: localStamp(basis === 'schedule' ? s.end : whole.window.to),
    shiftTemplateId: s.templateId,
    granularity: 'hour',
  });

  const pairs = [
    [`top bar (${top})`, whole.time?.[top], analysis.time?.[top], 0.5],
    ['net production', whole.time?.netProductionMin, analysis.time?.netProductionMin, 0.5],
    ['operational', whole.time?.operationalMin, analysis.time?.operationalMin, 0.5],
    ['availability loss', whole.time?.availabilityLossMin, analysis.time?.availabilityLossMin, 0.5],
    ['external loss', whole.time?.externalLossMin, analysis.time?.externalLossMin, 0.5],
    ['good', whole.counts?.good, analysis.counts?.good, 1],
    ['rejected', whole.counts?.rejected, analysis.counts?.rejected, 1],
    ['theoretical', whole.counts?.theoretical, analysis.counts?.theoretical, 1],
    ['Availability', whole.availability, analysis.availability, 0.15],
    ['Performance', whole.performance, analysis.performance, 0.15],
    ['Quality', whole.quality, analysis.quality, 0.15],
    ['OEE', whole.oee, analysis.oee, 0.15],
  ];
  for (const [name, a, b, tol] of pairs) {
    check(`${name} agrees`, agree(a, b, tol),
      a == null || b == null
        ? `MISSING — live ${a} vs analysis ${b}`
        : `live ${a} vs analysis ${b}`);
  }

  console.log('\n── machine by machine');
  const byKey = new Map((analysis.machines ?? []).map((m) => [m.key, m]));
  for (const m of whole.machines ?? []) {
    const other = byKey.get(m.key);
    check(`${m.label}`, !!other
      && agree(m.time?.[top], other.time?.[top], 0.5)
      && agree(m.counts?.good, other.counts?.good, 1),
      other
        ? `${m.time?.[top]?.toFixed(1)}m/${m.counts?.good} vs ${other.time?.[top]?.toFixed(1)}m/${other.counts?.good}`
        : 'missing from the analysis page');
  }
};

main().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
