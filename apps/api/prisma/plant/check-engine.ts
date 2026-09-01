/**
 * Engine sanity harness.
 *
 * Runs the signal engine over a week and prints what the estate would report.
 * The point is to catch a model that is arithmetically valid but physically
 * absurd — 100% performance, zero downtime, a bottleneck that is not the
 * constraint — before any of it reaches a screen.
 */

import { FACTORIES } from './plant-model';
import {
  DAY, HOUR, MINUTE, computeOee, machineOutputForHour, machineHourAvailability,
  machineStateAt, throughputFactor, isScheduled, meterLoadKw, meterPowerFactor, lineConstraint,
  meterCurrentThd, qualityRateAt, machineHealth, pickDowntimeReason, round,
} from './signal-engine';

const WEEK_START = Date.parse('2026-08-16T00:00:00');
const HOURS = 7 * 24;

let failures = 0;
function check(name: string, ok: boolean, detail: string) {
  if (!ok) { failures++; console.log(`  FAIL  ${name} — ${detail}`); }
  else console.log(`  ok    ${name} — ${detail}`);
}

for (const f of FACTORIES) {
  console.log(`\n${'═'.repeat(78)}\n${f.code} — ${f.name}  [${f.paradigm}]\n${'═'.repeat(78)}`);

  // ── Shift coverage ──────────────────────────────────────────────────────
  let scheduled = 0;
  for (let h = 0; h < HOURS; h++) if (isScheduled(f, WEEK_START + h * HOUR)) scheduled++;
  const schedPct = Math.round((scheduled / HOURS) * 100);
  check('shift coverage', schedPct > 20 && schedPct < 95, `${scheduled}/${HOURS} h scheduled (${schedPct}%)`);

  // ── Per-line OEE over the week ──────────────────────────────────────────
  for (const line of f.lines) {
    const machines = f.machines.filter((m) => m.lineCode === line.code && m.designCapacity);
    const bottleneck = f.machines.find((m) => m.code === line.bottleneckMachine);

    const rows: { code: string; a: number; p: number; q: number; oee: number; total: number; rate: number }[] = [];

    for (const m of machines) {
      let runMin = 0, plannedMin = 0, total = 0, good = 0;
      for (let h = 0; h < HOURS; h++) {
        const hs = WEEK_START + h * HOUR;
        if (!isScheduled(f, hs + 30 * MINUTE)) continue;
        plannedMin += 60;
        const av = machineHourAvailability(f, m, hs);
        runMin += 60 * av;
        const o = machineOutputForHour(f, m, hs);
        total += o.total; good += o.good;
      }
      const oee = computeOee({
        runTimeMinutes: runMin, plannedTimeMinutes: plannedMin,
        totalCount: total, goodCount: good, idealCycleSeconds: m.idealCycleSeconds!,
      });
      rows.push({ code: m.code, a: oee.availability, p: oee.performance, q: oee.quality, oee: oee.oee, total, rate: total / (runMin / 60 || 1) });
    }

    console.log(`\n  Line ${line.code} (${line.oeeMethod}, bottleneck ${line.bottleneckMachine ?? '—'})`);
    console.log(`    ${'machine'.padEnd(9)} ${'A'.padStart(6)} ${'P'.padStart(6)} ${'Q'.padStart(6)} ${'OEE'.padStart(6)}  ${'week total'.padStart(11)}  ${'per run-h'.padStart(9)}`);
    for (const r of rows) {
      console.log(`    ${r.code.padEnd(9)} ${(r.a * 100).toFixed(1).padStart(5)}% ${(r.p * 100).toFixed(1).padStart(5)}% ${(r.q * 100).toFixed(1).padStart(5)}% ${(r.oee * 100).toFixed(1).padStart(5)}%  ${r.total.toLocaleString().padStart(11)}  ${r.rate.toFixed(1).padStart(9)}`);
    }

    // Every factor must sit strictly inside (0,1) — a pinned KPI carries no information.
    for (const r of rows) {
      check(`${line.code}/${r.code} performance below ceiling`, r.p > 0.4 && r.p < 0.995, `P=${(r.p * 100).toFixed(1)}%`);
      check(`${line.code}/${r.code} availability plausible`, r.a > 0.5 && r.a < 0.98, `A=${(r.a * 100).toFixed(1)}%`);
      check(`${line.code}/${r.code} quality plausible`, r.q > 0.85 && r.q < 0.999, `Q=${(r.q * 100).toFixed(1)}%`);
    }

    // The declared bottleneck must be the group the engine actually found.
    const lc = lineConstraint(f, line.code);
    const declaredGroup = (bottleneck?.metadata?.parallelGroup as string) ?? bottleneck?.code;
    check(`${line.code} bottleneck is the constraint`, lc.constraintGroup === declaredGroup,
      `engine constraint is ${lc.constraintGroup} @ ${lc.baseRatePerHour.toFixed(0)} base/h; declared ${declaredGroup}`);

    // Upstream and downstream must move the same quantity of product. Compared
    // in base units, every station on a serial line has to agree — a filler
    // that makes more inners than the cartoner ever packs is not a plant.
    const inBase = rows.map((r) => {
      const m = machines.find((x) => x.code === r.code)!;
      const group = (m.metadata?.parallelGroup as string) ?? m.code;
      return { group, base: r.total * (f.unitFactors[m.countUnit ?? ''] ?? 1) };
    });
    const byGroup = new Map<string, number>();
    for (const x of inBase) byGroup.set(x.group, (byGroup.get(x.group) ?? 0) + x.base);
    const vals = [...byGroup.values()];
    const spread = (Math.max(...vals) - Math.min(...vals)) / Math.max(...vals);
    // 5%, not 0: inter-station buffers absorb short-term differences, and each
    // station has its own downtime stream. The check exists to catch a
    // structural mismatch — a filler outrunning its cartoner by a third — not
    // the normal breathing of a buffered line.
    check(`${line.code} stations move the same quantity`, spread < 0.05,
      `base-unit throughput spread ${(spread * 100).toFixed(1)}% across ${byGroup.size} stations (${vals.map((v) => Math.round(v).toLocaleString()).join(' · ')})`);

    // The constraint should be the busiest machine; everything else waits.
    const bnRow = rows.find((r) => r.code === bottleneck?.code);
    if (bnRow) {
      const others = rows.filter((r) => r.code !== bottleneck!.code);
      check(`${line.code} constraint runs hottest`, others.every((o) => o.p <= bnRow.p + 0.005),
        `bottleneck P=${(bnRow.p * 100).toFixed(1)}% vs others ${others.map((o) => (o.p * 100).toFixed(0) + '%').join('/')}`);
    }
  }

  // ── State distribution on one representative machine ────────────────────
  const rep = f.machines.find((m) => m.lineCode && m.designCapacity)!;
  const dist: Record<string, number> = {};
  for (let i = 0; i < 7 * 96; i++) {
    const s = machineStateAt(f, rep, WEEK_START + i * 15 * MINUTE);
    dist[s] = (dist[s] ?? 0) + 1;
  }
  const totalBuckets = Object.values(dist).reduce((a, b) => a + b, 0);
  console.log(`\n  State distribution — ${rep.code} (15-min buckets over a week)`);
  for (const [s, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${s.padEnd(14)} ${String(n).padStart(4)}  ${((n / totalBuckets) * 100).toFixed(1).padStart(5)}%`);
  }
  check('every state reachable', Object.keys(dist).length >= 5, `${Object.keys(dist).length} distinct states seen`);
  check('downtime reasons resolve',
    ['BREAKDOWN', 'BLOCKED', 'STARVED', 'CHANGEOVER'].every((s) => pickDowntimeReason(f, s as any, rep.code, 42) !== null),
    'all unplanned states map to a level-3 reason');

  // ── Health cycles ───────────────────────────────────────────────────────
  const hMin = Math.min(...Array.from({ length: 60 }, (_, d) => machineHealth(rep.code, WEEK_START + d * DAY)));
  const hMax = Math.max(...Array.from({ length: 60 }, (_, d) => machineHealth(rep.code, WEEK_START + d * DAY)));
  check('health cycles between services', hMax - hMin > 0.15, `${rep.code} health ranges ${hMin.toFixed(2)}–${hMax.toFixed(2)} over 60 days`);

  // ── Energy ──────────────────────────────────────────────────────────────
  console.log(`\n  Energy meters (sampled Tue 10:00 and Fri 03:00)`);
  const busy = WEEK_START + 3 * DAY + 10 * HOUR;
  const quiet = WEEK_START + 6 * DAY + 3 * HOUR;
  for (const m of f.energyMeters.filter((x) => x.baselineKw)) {
    const kwBusy = meterLoadKw(f, m.code, busy);
    const kwQuiet = meterLoadKw(f, m.code, quiet);
    const pf = meterPowerFactor(f, m.code, busy);
    const ithd = meterCurrentThd(f, m.code, busy);
    console.log(`    ${m.code.padEnd(9)} busy ${kwBusy.toFixed(0).padStart(5)} kW   quiet ${kwQuiet.toFixed(0).padStart(5)} kW   PF ${pf.toFixed(3)}   ITHD ${ithd.toFixed(1).padStart(5)}%`);
    check(`${m.code} load never zero`, kwQuiet > 0, `quiet load ${kwQuiet.toFixed(0)} kW (fixed base runs regardless of output)`);
    check(`${m.code} load falls off-shift`, kwQuiet < kwBusy, `${kwQuiet.toFixed(0)} < ${kwBusy.toFixed(0)} kW`);
  }
}

console.log(`\n${'═'.repeat(78)}`);
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures ? 1 : 0);
