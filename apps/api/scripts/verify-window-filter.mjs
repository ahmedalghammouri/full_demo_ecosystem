/**
 * Does the time filter actually reach every surface?
 *
 * Not "does the page render" — that passes while a table quietly ignores the
 * window. This checks the properties that can only hold if the filter reached
 * all the way down:
 *
 *   1. Every trend point lies inside the window.
 *   2. Every timeline segment lies inside the window.
 *   3. The trend sums back to the headline total.
 *   4. The machine table sums back to the headline total.
 *   5. The shift table sums back to the headline total.
 *   6. A narrower window returns strictly less than a wider one.
 *
 * (3)-(5) are the ones that catch a table built from its own query with the
 * window left off: it renders, it looks plausible, and it does not add up.
 */
const BASE = process.env.BASE || 'http://localhost:8080/api/v1';
const EMAIL = process.env.EMAIL || 'admin@industry360.sa';
const PASSWORD = process.env.PASSWORD || 'admin@industry360.sa@admin@industry360.sa';

const login = async () => {
  const r = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const j = await r.json();
  if (!j?.data?.accessToken) throw new Error(`login failed: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data.accessToken;
};

const get = async (tok, path, params) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null));
  const r = await fetch(`${BASE}${path}?${qs}`, { headers: { Authorization: `Bearer ${tok}` } });
  const j = await r.json();
  if (j.statusCode >= 400) throw new Error(`${path} → ${j.statusCode} ${String(j.message).slice(0, 200)}`);
  return j.data ?? j;
};

const sum = (rows, pick) => rows.reduce((a, r) => a + (pick(r) ?? 0), 0);
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;

let failures = 0;
const check = (name, ok, detail) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `   ${detail}` : ''}`);
  if (!ok) failures++;
};

async function audit(tok, engine, label, params) {
  console.log(`\n── ${engine}  ${label}  (${params.dateFrom} → ${params.dateTo})`);
  const d = await get(tok, engine, { ...params, granularity: 'hour' });

  const from = new Date(d.window?.from ?? params.dateFrom).getTime();
  // The schedule basis charges the WHOLE promised slot, including the part of it
  // that has not happened yet — that is the entire point of the basis. Its upper
  // bound for "inside the window" is therefore slotTo, not now. Holding it to
  // `to` marks the not-yet-reached slot as out of range, which is the engine
  // doing its job.
  const to = new Date(d.window?.to ?? params.dateTo).getTime();
  const outerTo = new Date(d.window?.slotTo ?? d.window?.to ?? params.dateTo).getTime();
  // The schedule engine's top bar is the COMMITTED slot, not elapsed time — it
  // has no `totalMin` at all. Checking the wrong field there reports 0 against 0
  // and calls it a pass, which is a test that cannot fail.
  const topKey = engine.includes('schedule') ? 'committedMin' : 'totalMin';
  const total = d.time?.[topKey] ?? 0;
  if (!(topKey in (d.time ?? {}))) {
    check(`the engine reports its top-level time bar (${topKey})`, false, `keys: ${Object.keys(d.time ?? {}).join(',')}`);
  }
  console.log(`   window ${new Date(from).toISOString().slice(0, 16)} → ${new Date(to).toISOString().slice(0, 16)}`
    + `   total ${total.toFixed(1)}m   OEE ${d.oee}`);

  // 1. trend points inside the window. An hour bucket is STAMPED at its start,
  //    so the last one may begin before `to` and legitimately extend past it.
  const outside = (d.trend ?? []).filter((p) => {
    const t = new Date(p.at).getTime();
    return t < from - 3_600_000 || t > outerTo;
  });
  check('every trend point is inside the window', outside.length === 0,
    outside.length ? `${outside.length} outside, first ${outside[0].at}` : `${d.trend?.length ?? 0} points`);

  // 2. timeline segments inside the window
  const segOut = (d.timeline ?? []).filter((s) => {
    const a = new Date(s.from).getTime(), b = new Date(s.to).getTime();
    return b < from - 1000 || a > outerTo + 1000;
  });
  check('every timeline segment is inside the window', segOut.length === 0,
    segOut.length ? `${segOut.length} outside` : `${d.timeline?.length ?? 0} segments`);

  // 3-5. the roll-ups must reconcile to the headline
  const trendMin = sum(d.trend ?? [], (p) => p.time?.[topKey]);
  const machMin = sum(d.machines ?? [], (m) => m.time?.[topKey]);
  const shiftMin = sum(d.shifts ?? [], (s) => s.time?.[topKey]);

  check('trend sums to the headline total', near(trendMin, total, Math.max(1, total * 0.001)),
    `trend ${trendMin.toFixed(1)}m vs ${total.toFixed(1)}m`);
  check('machine table sums to the headline total', near(machMin, total, Math.max(1, total * 0.001)),
    `machines ${machMin.toFixed(1)}m vs ${total.toFixed(1)}m`);
  check('shift table sums to the headline total', near(shiftMin, total, Math.max(1, total * 0.001)),
    `shifts ${shiftMin.toFixed(1)}m vs ${total.toFixed(1)}m`);

  return { total, good: d.counts?.good ?? 0, trendPoints: d.trend?.length ?? 0 };
}

const main = async () => {
  const tok = await login();
  const today = new Date();
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const stamp = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${iso(d)}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  };
  const T = iso(today);

  for (const engine of ['/oee-standard', '/oee-schedule']) {
    const wide = await audit(tok, engine, 'whole day', { dateFrom: T, dateTo: T });

    // 6. A narrower window must return strictly less. This is the check that
    //    distinguishes "the filter works" from "all the data happens to be today".
    //
    //    Built by subtracting from the clock, not by decrementing the hour
    //    STRING: at 00:22 the old form clamped `hour - 2` to 00 and produced the
    //    same window as the whole day, so the check compared 88 minutes with 88
    //    minutes and reported a failure the engine had nothing to do with.
    //    Clamped to the start of the day as well, so it is genuinely a SUBSET of
    //    the wide window. Unclamped, "the last two hours" at 00:24 reaches back
    //    into yesterday and is legitimately the LARGER of the two — which makes
    //    the comparison meaningless rather than failing.
    const startOfDay = new Date(today);
    startOfDay.setHours(0, 0, 0, 0);
    const narrowFrom = new Date(
      Math.max(startOfDay.getTime(), today.getTime() - 2 * 3_600_000),
    );
    const narrow = await audit(tok, engine, 'last 2 hours (within the day)', {
      dateFrom: stamp(narrowFrom),
      dateTo: stamp(today),
    });

    console.log(`\n── ${engine}  narrowing`);
    // Strictly-less is only a meaningful demand when there IS data outside the
    // tail. Keying that on the clock was wrong: at 04:05 the day is four hours
    // old, but if the line only started producing at 02:36 then the last two
    // hours legitimately contain everything the day contains, and equality is
    // the correct answer. So ask the head of the day directly.
    const head = await audit(tok, engine, 'before the tail', {
      dateFrom: stamp(startOfDay),
      dateTo: stamp(narrowFrom),
    });
    const hasOlderData = head.total > 0.5;
    check('a narrower window returns less total time',
      hasOlderData ? narrow.total < wide.total : narrow.total <= wide.total + 0.5,
      `${narrow.total.toFixed(0)}m of ${wide.total.toFixed(0)}m`
        + (hasOlderData ? '' : ' — nothing recorded before the tail, equality expected'));
    check('a narrower window returns no more output',
      narrow.good <= wide.good,
      `good ${narrow.good} vs ${wide.good}`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
};

main().catch((e) => { console.error('ERROR', e.message); process.exit(2); });
