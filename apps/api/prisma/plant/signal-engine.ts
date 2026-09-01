/**
 * i360 Ecosystem Demo — signal engine.
 *
 * Deterministic by construction: every value is a pure function of
 * (factory, machine, tag, instant). That single property is what makes the
 * estate coherent. The seeded history and the live Virtual Plant evaluate the
 * same functions, so a trend that ends "now" joins the live feed without a
 * seam, and restarting a container never rewrites the past.
 *
 * The relationships modelled are the ones a real plant actually shows, so a
 * reviewer who goes looking for them finds them:
 *
 *   · output follows the shift pattern — nights genuinely run slower
 *   · cycle time stretches as a machine degrades between preventive services
 *   · alarm density rises with the same degradation, so MTBF and the
 *     performance loss are not independent free parameters
 *   · process drives quality — a unit wound while fiber tension was excursing
 *     is the one that fails the hydrostatic test downstream
 *   · availability is measured from the state timeline the control room shows,
 *     never assumed, so OEE decomposes into three factors that each mean
 *     something and each sit below 1
 *
 * Nothing here reads the database. The engine is the model's arithmetic; the
 * seeder and the Virtual Plant are the two things that call it.
 */

import type { FactoryDef, MachineDef, ShiftDef, TagDef } from './types';

// ────────────────────────────────────────────────────────────────────────────
// Deterministic pseudo-randomness
// ────────────────────────────────────────────────────────────────────────────

/** Small fast PRNG. Same seed produces the same stream on any machine. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A stable [0,1) drawn from a key and a time bucket. */
export function rand(key: string, bucket: number): number {
  return mulberry32(hashString(key) ^ (bucket >>> 0))();
}

/** Stable roughly-normal value in [-1, 1], from two draws. */
export function noise(key: string, bucket: number): number {
  return rand(key, bucket) + rand(`${key}~`, bucket * 2 + 1) - 1;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function round(v: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ────────────────────────────────────────────────────────────────────────────
// Time
// ────────────────────────────────────────────────────────────────────────────

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/**
 * The estate's commissioning epoch. The ramp term improves output over the
 * first months and then flattens, which is why the year-long trend screens
 * show a plant that got better rather than a flat line with noise on it.
 */
export const RAMP_START = Date.parse('2025-01-06T00:00:00Z');

export function startOfHour(t: Date | number): Date {
  const d = new Date(t);
  d.setMinutes(0, 0, 0);
  return d;
}

export function startOfDay(t: Date | number): Date {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Minutes since midnight for a "HH:mm" string. */
function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Which shift covers an instant at this factory, and when that shift began.
 *
 * Handles both the three-by-eight and two-by-twelve patterns, and shifts that
 * cross midnight — a night shift that starts at 22:00 belongs to the previous
 * calendar day, which is the distinction that makes a night shift's output
 * land on the right day on every report.
 */
export function shiftAt(f: FactoryDef, t: Date | number): { shift: ShiftDef; start: Date } | null {
  const d = new Date(t);
  const minutes = d.getHours() * 60 + d.getMinutes();

  for (const s of f.shifts) {
    const from = hhmmToMinutes(s.startTime);
    const to = hhmmToMinutes(s.endTime);

    if (!s.crossesMidnight) {
      if (minutes >= from && minutes < to && s.days.includes(d.getDay())) {
        const start = new Date(d);
        start.setHours(Math.floor(from / 60), from % 60, 0, 0);
        return { shift: s, start };
      }
      continue;
    }

    // Crosses midnight: either late today, or early tomorrow morning.
    if (minutes >= from) {
      if (!s.days.includes(d.getDay())) continue;
      const start = new Date(d);
      start.setHours(Math.floor(from / 60), from % 60, 0, 0);
      return { shift: s, start };
    }
    if (minutes < to) {
      const prev = new Date(d.getTime() - DAY);
      if (!s.days.includes(prev.getDay())) continue;
      const start = new Date(prev);
      start.setHours(Math.floor(from / 60), from % 60, 0, 0);
      return { shift: s, start };
    }
  }
  return null;
}

/** True when the factory is scheduled to be producing at this instant. */
export function isScheduled(f: FactoryDef, t: Date | number): boolean {
  return shiftAt(f, t) !== null;
}

// ────────────────────────────────────────────────────────────────────────────
// Machine health
// ────────────────────────────────────────────────────────────────────────────

/**
 * Health 0.35..1 for a machine at an instant.
 *
 * Degrades between preventive services and resets when one is performed. The
 * interval differs per machine so the fleet does not degrade in lockstep,
 * which is what gives alarm clustering and cycle-time drift their shape and
 * keeps MTBF from being a constant.
 */
export function machineHealth(code: string, t: Date | number): number {
  const days = Math.floor(new Date(t).getTime() / DAY);
  const interval = 21 + (hashString(code) % 21); // 21–41 days
  const sinceService = days % interval;
  const decay = sinceService / interval; // 0 fresh → 1 due
  const jitter = 0.05 * noise(`health:${code}`, days);
  return clamp(1 - 0.32 * decay + jitter, 0.35, 1);
}

/** Days until the next preventive service is due for this machine. */
export function daysToService(code: string, t: Date | number): number {
  const days = Math.floor(new Date(t).getTime() / DAY);
  const interval = 21 + (hashString(code) % 21);
  return interval - (days % interval);
}

// ────────────────────────────────────────────────────────────────────────────
// Throughput
// ────────────────────────────────────────────────────────────────────────────

/**
 * The performance factor at an instant — what fraction of the ideal rate the
 * line actually achieves.
 *
 * Composed of: the shift's own pace, a within-shift warm-up and end-of-shift
 * tail, a commissioning ramp, a weekend effect, bounded wobble, and micro-stops
 * too brief to be logged as downtime.
 *
 * Held strictly below 1. A line cannot beat its own ideal cycle time, and a
 * performance figure that touches 100% means the ideal cycle time is wrong —
 * not that the machine outran physics.
 */
export function throughputFactor(f: FactoryDef, t: Date | number): number {
  const d = new Date(t);
  const sh = shiftAt(f, d);
  if (!sh) return 0;

  const base = sh.shift.efficiencyFactor;
  const lengthMin = sh.shift.shiftDurationHours * 60;
  const intoShift = (d.getTime() - sh.start.getTime()) / MINUTE;

  const warmMin = Math.min(40, lengthMin * 0.09);
  const tailMin = Math.min(30, lengthMin * 0.06);
  const warm = intoShift < warmMin ? 0.82 + 0.18 * (intoShift / warmMin) : 1;
  const tail =
    intoShift > lengthMin - tailMin
      ? 1 - 0.25 * ((intoShift - (lengthMin - tailMin)) / tailMin)
      : 1;

  const weeks = Math.max(0, (d.getTime() - RAMP_START) / (7 * DAY));
  const ramp = 0.88 + 0.12 * (1 - Math.exp(-weeks / 11));

  // Friday is the maintenance-heavy day in a KSA plant; Saturday is lighter.
  const dow = d.getDay();
  const weekday = dow === 5 ? 0.74 : dow === 6 ? 0.94 : 1;

  const bucket = Math.floor(d.getTime() / HOUR);
  const wobble = 1 + 0.035 * noise(`thr:${f.code}:${bucket}`, dow);
  const microStops = 0.955 + 0.03 * rand(`micro:${f.code}:${bucket}`, dow);

  return clamp(base * warm * tail * ramp * weekday * wobble * microStops, 0.05, 0.995);
}

// ────────────────────────────────────────────────────────────────────────────
// Machine state
// ────────────────────────────────────────────────────────────────────────────

/** The states this platform treats as producing. Matches the OEE engine. */
export const PRODUCING_STATES = new Set(['RUNNING']);

export type MachineState =
  | 'RUNNING' | 'IDLE' | 'PLANNED_STOP' | 'BREAKDOWN' | 'SETUP' | 'CHANGEOVER'
  | 'STARTUP' | 'STARVED' | 'BLOCKED' | 'OFFLINE' | 'MAINTENANCE';

/**
 * Machine state at an instant, on a 15-minute decision bucket.
 *
 * Weighted so the control room mostly shows RUNNING — a wall where everything
 * is faulted teaches a viewer nothing — while every state the platform can
 * display still occurs often enough to be seen and coded.
 *
 * Availability falls out of this cascade rather than being asserted anywhere.
 * Tuning the plant means tuning these thresholds and nothing else.
 */
export function machineStateAt(f: FactoryDef, m: MachineDef, t: Date | number): MachineState {
  const d = new Date(t);

  // Outside a scheduled shift the machine is not idle, it is off. Charging
  // unscheduled time to availability is the single most common way an OEE
  // figure becomes meaningless.
  const sh = shiftAt(f, d);
  if (!sh) return 'OFFLINE';

  const intoShift = (d.getTime() - sh.start.getTime()) / MINUTE;
  const lengthMin = sh.shift.shiftDurationHours * 60;

  // Startup at the head of the shift, cleaning at the tail.
  if (intoShift < 12) return 'STARTUP';
  if (intoShift > lengthMin - sh.shift.cleaningMinutes) return 'PLANNED_STOP';

  // The scheduled break sits near the middle of the shift.
  const breakStart = lengthMin * 0.45;
  if (intoShift >= breakStart && intoShift < breakStart + sh.shift.breakMinutes * 0.6) {
    return 'PLANNED_STOP';
  }

  const bucket = Math.floor(d.getTime() / (15 * MINUTE));
  const r = rand(`state:${f.code}:${m.code}`, bucket);
  const health = machineHealth(m.code, d);

  // A degraded machine spends more time broken down and more time blocked.
  const breakdownP = 0.010 + 0.038 * (1 - health);
  const blockedP = 0.014 + 0.030 * (1 - health);

  // Utility assets are not on a line and do not starve or change over.
  if (!m.lineCode) {
    if (r < 0.004) return 'MAINTENANCE';
    if (r < 0.004 + breakdownP * 0.5) return 'BREAKDOWN';
    return 'RUNNING';
  }

  let acc = 0;
  if (r < (acc += 0.004)) return 'MAINTENANCE';
  if (r < (acc += breakdownP)) return 'BREAKDOWN';
  if (r < (acc += blockedP)) return 'BLOCKED';
  if (r < (acc += 0.022)) return 'STARVED';
  if (r < (acc += 0.012)) return 'CHANGEOVER';
  if (r < (acc += 0.008)) return 'SETUP';
  if (r < (acc += 0.020)) return 'IDLE';
  return 'RUNNING';
}

/**
 * Fraction of a line's machines producing at an instant.
 *
 * Read from the same state function the machine wall renders, so the number on
 * the KPI screen and the states on the wall are the same fact rather than two
 * independent estimates that drift apart.
 */
export function lineAvailability(f: FactoryDef, lineCode: string, t: Date | number): number {
  const machines = f.machines.filter((m) => m.lineCode === lineCode);
  if (!machines.length) return 0;
  const producing = machines.filter((m) => PRODUCING_STATES.has(machineStateAt(f, m, t))).length;
  return clamp(producing / machines.length, 0, 1);
}

/** Mean availability across an hour, sampled on the state engine's own buckets. */
export function hourAvailability(f: FactoryDef, lineCode: string, hourStart: number): number {
  let sum = 0;
  for (let q = 0; q < 4; q++) sum += lineAvailability(f, lineCode, hourStart + q * 15 * MINUTE);
  return clamp(sum / 4, 0, 1);
}

/** Availability of one machine across an hour. */
export function machineHourAvailability(f: FactoryDef, m: MachineDef, hourStart: number): number {
  let producing = 0;
  for (let q = 0; q < 4; q++) {
    if (PRODUCING_STATES.has(machineStateAt(f, m, hourStart + q * 15 * MINUTE))) producing++;
  }
  return producing / 4;
}

// ────────────────────────────────────────────────────────────────────────────
// Output
// ────────────────────────────────────────────────────────────────────────────

/**
 * The rate a line can actually sustain, and each machine's share of it.
 *
 * A serial line runs at its slowest station, not at each machine's nameplate.
 * Modelling every machine at its own capacity would have the filler make far
 * more inners than the cartoner ever packs — a discrepancy any reviewer would
 * spot on the first screen, and one no amount of downstream arithmetic could
 * explain away.
 *
 * Capacities are normalised through `unitFactors` before being compared,
 * because a cartoner's 300/h and a filler's 1,800/h are not the same quantity.
 * Machines sharing a `parallelGroup` add together: four moulding machines each
 * at 18/h are one 72/h station, not four independent constraints.
 *
 * The consequence is what makes bottleneck analysis meaningful: the constraint
 * runs near its ideal cycle, and every faster machine shows a real performance
 * loss because it spends part of its run time waiting.
 */
export function lineConstraint(
  f: FactoryDef,
  lineCode: string,
): { baseRatePerHour: number; constraintGroup: string; shareOf: (m: MachineDef) => number } {
  const machines = f.machines.filter((m) => m.lineCode === lineCode && m.designCapacity);

  const groupOf = (m: MachineDef) => (m.metadata?.parallelGroup as string | undefined) ?? m.code;
  const factorOf = (m: MachineDef) => f.unitFactors[m.countUnit ?? ''] ?? 1;

  const groups = new Map<string, { baseCap: number; members: MachineDef[] }>();
  for (const m of machines) {
    const g = groupOf(m);
    const entry = groups.get(g) ?? { baseCap: 0, members: [] };
    entry.baseCap += m.designCapacity! * factorOf(m);
    entry.members.push(m);
    groups.set(g, entry);
  }

  let constraintGroup = '';
  let baseRatePerHour = Infinity;
  for (const [g, e] of groups) {
    if (e.baseCap < baseRatePerHour) { baseRatePerHour = e.baseCap; constraintGroup = g; }
  }
  if (!Number.isFinite(baseRatePerHour)) baseRatePerHour = 0;

  return {
    baseRatePerHour,
    constraintGroup,
    shareOf(m: MachineDef) {
      const g = groups.get(groupOf(m));
      if (!g || !m.designCapacity) return 0;
      // Parallel members split the line rate between them.
      const perMember = baseRatePerHour / g.members.length;
      // Converted back into this machine's own counting unit.
      return perMember / factorOf(m);
    },
  };
}

/**
 * Units a machine should produce in a given hour, in that machine's own
 * counting unit.
 *
 * line rate × availability × performance. Because availability is measured
 * from the state timeline and performance from the throughput factor, the
 * recorded output is consistent with the recorded run time — which is what
 * lets OEE decompose into three factors instead of one figure and a residual.
 */
export function machineOutputForHour(
  f: FactoryDef,
  m: MachineDef,
  hourStart: number,
): { total: number; good: number; availability: number; performance: number; quality: number } {
  if (!m.designCapacity || !m.lineCode) {
    return { total: 0, good: 0, availability: 0, performance: 0, quality: 1 };
  }
  const availability = machineHourAvailability(f, m, hourStart);
  const performance = throughputFactor(f, hourStart + 30 * MINUTE);
  const rate = lineConstraint(f, m.lineCode).shareOf(m);
  const total = Math.max(0, Math.round(rate * availability * performance));

  const quality = qualityRateAt(f, m, hourStart);
  const good = total - scrapCount(f, m, hourStart, total, quality);
  return { total, good, availability, performance, quality };
}

/**
 * How many of an hour's units are scrap.
 *
 * The fractional part is resolved by a deterministic draw rather than rounded
 * away. A palletizer making eight pallets an hour at a 0.5% defect rate has an
 * expected 0.04 rejects; rounding that to zero every hour would report a
 * permanent 100% quality — a KPI pinned to its ceiling, which carries no
 * information and is exactly the failure this avoids.
 */
export function scrapCount(
  f: FactoryDef,
  m: MachineDef,
  hourStart: number,
  total: number,
  quality: number,
): number {
  if (total <= 0) return 0;
  const exact = total * (1 - quality);
  const whole = Math.floor(exact);
  const frac = exact - whole;
  const extra = rand(`scrapfrac:${f.code}:${m.code}`, Math.floor(hourStart / HOUR)) < frac ? 1 : 0;
  return Math.min(total, whole + extra);
}

// ────────────────────────────────────────────────────────────────────────────
// Process tags
// ────────────────────────────────────────────────────────────────────────────

/**
 * Value of one tag at an instant.
 *
 * nominal + slow diurnal drift + a degradation offset + bounded wander,
 * clamped to the tag's engineering range. Excursions past a specification
 * limit are possible but uncommon, and they are what the alarm log and the
 * downstream quality failures are actually drawn from — not a separate
 * coin flip.
 */
export function tagValue(f: FactoryDef, machineCode: string, tag: TagDef, t: Date | number): number {
  const ms = new Date(t).getTime();

  if (tag.dataType === 'BOOL') {
    const m = f.machines.find((x) => x.code === machineCode);
    if (!m) return 0;
    return PRODUCING_STATES.has(machineStateAt(f, m, ms)) ? 1 : 0;
  }

  const range = tag.range ?? [0, 100];
  const [lo, hi] = range;
  const mid = (lo + hi) / 2;
  const span = hi - lo;
  const key = `${f.code}:${machineCode}:${tag.code}`;

  // Ambient conditions move every thermal process, peaking mid-afternoon.
  const hourOfDay = ((ms % DAY) + DAY) % DAY / HOUR;
  const diurnal = Math.sin(((hourOfDay - 4) / 24) * 2 * Math.PI);

  // Slow wander, re-drawn every ~10 minutes rather than every sample, so a
  // trend line looks like a process and not like static.
  const slowBucket = Math.floor(ms / (10 * MINUTE));
  const wander = noise(`wander:${key}`, slowBucket);

  // A degraded machine sits further from nominal.
  const health = machineHealth(machineCode, ms);
  const drift = (1 - health) * 0.18;

  // Fast term, re-drawn each second, small.
  const fast = noise(`fast:${key}`, Math.floor(ms / SECOND)) * 0.02;

  const value = mid + span * (0.06 * diurnal + 0.14 * wander + drift * Math.sign(wander || 1) + fast);
  return round(clamp(value, lo, hi), decimalsFor(tag));
}

function decimalsFor(tag: TagDef): number {
  if (tag.dataType === 'BOOL') return 0;
  if (tag.unit === '') return 3; // power factor
  const span = tag.range ? tag.range[1] - tag.range[0] : 100;
  if (span <= 1) return 5;
  if (span <= 20) return 2;
  return 1;
}

/**
 * How far a tag sits from the centre of its range, 0..1.
 *
 * This is the quantity that couples process to quality: a unit produced while
 * this is high is the unit that fails downstream.
 */
export function tagDeviation(f: FactoryDef, machineCode: string, tag: TagDef, t: Date | number): number {
  if (!tag.range) return 0;
  const [lo, hi] = tag.range;
  const mid = (lo + hi) / 2;
  const half = (hi - lo) / 2 || 1;
  return clamp(Math.abs(tagValue(f, machineCode, tag, t) - mid) / half, 0, 1);
}

/** Every tag on a machine, sampled at one instant. */
export function sampleMachine(f: FactoryDef, m: MachineDef, t: Date | number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const d of f.devices) {
    for (const tag of d.tags) {
      if (tag.ownerCode !== m.code) continue;
      out[tag.code] = tagValue(f, m.code, tag, t);
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Process stress and quality
// ────────────────────────────────────────────────────────────────────────────

/**
 * Aggregate process stress on a machine at an instant, 0..1.
 *
 * The mean deviation of its PROCESS tags, weighted up by poor health. This is
 * the single term that makes the demo's numbers hang together: the scrap
 * Pareto puts winding defects first *because* winding tension carries the most
 * weight here, not because the number was typed in.
 */
export function processStress(f: FactoryDef, m: MachineDef, t: Date | number): number {
  const tags: TagDef[] = [];
  for (const d of f.devices) {
    for (const tag of d.tags) {
      if (tag.ownerCode === m.code && tag.role === 'PROCESS') tags.push(tag);
    }
  }
  const health = machineHealth(m.code, t);
  if (!tags.length) return clamp((1 - health) * 0.6, 0, 1);

  let sum = 0;
  for (const tag of tags) sum += tagDeviation(f, m.code, tag, t);
  const mean = sum / tags.length;
  return clamp(mean * 0.75 + (1 - health) * 0.45, 0, 1);
}

/**
 * Quality rate for a machine over an hour, 0..1.
 *
 * Starts from the baseline pass rate of the quality specs that apply at this
 * machine's routing step and degrades with process stress. A machine with no
 * spec still loses a little, because packaging damage happens everywhere.
 */
export function qualityRateAt(f: FactoryDef, m: MachineDef, t: Date | number): number {
  const step = f.routing.find((r) => r.machines.includes(m.code));
  const specs = step?.tests?.map((c) => f.qualitySpecs.find((q) => q.code === c)).filter(Boolean) ?? [];

  const baseline = specs.length
    ? specs.reduce((p, s) => p * (s!.baselinePassRate), 1)
    : 0.995;

  const stress = processStress(f, m, t);
  // Stress can take up to a further 4.5 points off the pass rate.
  return clamp(baseline - stress * 0.045, 0.80, 0.9995);
}

/**
 * Whether one unit passes one quality spec, and the measured value.
 *
 * Deterministic in the unit's own key, so re-reading a serial always returns
 * the same verdict — a traceability screen that changed its mind on refresh
 * would be worse than no traceability screen.
 */
export function qualityResult(
  f: FactoryDef,
  specCode: string,
  unitKey: string,
  stress: number,
): { value: number; pass: boolean } {
  const spec = f.qualitySpecs.find((q) => q.code === specCode);
  if (!spec) return { value: 0, pass: true };

  const lo = spec.lsl ?? (spec.target !== undefined ? spec.target * 0.9 : 0);
  const hi = spec.usl ?? (spec.target !== undefined ? spec.target * 1.1 : 100);
  const target = spec.target ?? (lo + hi) / 2;
  const half = Math.max(Math.abs(hi - target), Math.abs(target - lo)) || 1;

  // Stress both shifts the mean and widens the spread — the two things that
  // actually move a capability index.
  const shift = stress * 0.55 * half * (rand(`qs:${specCode}:${unitKey}`, 7) > 0.5 ? 1 : -1);
  const spread = (0.24 + stress * 0.40) * half;
  const value = target + shift + noise(`q:${specCode}:${unitKey}`, 11) * spread;

  const pass =
    (spec.lsl === undefined || value >= spec.lsl) &&
    (spec.usl === undefined || value <= spec.usl);

  return { value: round(value, 4), pass };
}

/**
 * Pick a scrap code for a failed unit, weighted by the model's own weights and
 * by which step was under the most stress.
 */
export function pickScrapCode(f: FactoryDef, unitKey: string, stressByStep: Record<string, number>): string {
  const weighted = f.scrapCodes.map((s) => ({
    code: s.code,
    w: s.weight * (1 + 1.8 * (s.stepCode ? stressByStep[s.stepCode] ?? 0 : 0)),
  }));
  const total = weighted.reduce((n, x) => n + x.w, 0);
  let r = rand(`scrap:${unitKey}`, 3) * total;
  for (const x of weighted) {
    r -= x.w;
    if (r <= 0) return x.code;
  }
  return weighted[weighted.length - 1].code;
}

// ────────────────────────────────────────────────────────────────────────────
// Downtime
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pick a downtime reason for a stop, from the level-3 leaves whose category
 * matches the state that caused it. Reason codes are the operator's language;
 * states are the machine's, and this is the mapping between them.
 */
export function pickDowntimeReason(
  f: FactoryDef,
  state: MachineState,
  machineCode: string,
  bucket: number,
): { code: string; minutes: number } | null {
  const wanted: Record<string, string[]> = {
    BREAKDOWN: ['MECHANICAL', 'ELECTRICAL'],
    BLOCKED: ['PROCESS', 'QUALITY', 'MATERIAL'],
    STARVED: ['MATERIAL', 'UTILITY'],
    CHANGEOVER: ['CHANGEOVER'],
    SETUP: ['CHANGEOVER'],
    MAINTENANCE: ['PLANNED_MAINTENANCE'],
    PLANNED_STOP: ['PLANNED_BREAK', 'PLANNED_CLEANING'],
    IDLE: ['OPERATOR', 'PROCESS', 'OTHER'],
  };
  const cats = wanted[state];
  if (!cats) return null;

  let leaves = f.downtimeCauses.filter(
    (d) => d.level === 3 && cats.includes(d.category) && (d.weight ?? 0) > 0,
  );
  // A factory that models no cause in the natural category still has to code
  // the stop. Falling back to any unplanned leaf keeps the downtime log
  // complete; returning null here would silently drop the event instead.
  if (!leaves.length) {
    leaves = f.downtimeCauses.filter((d) => d.level === 3 && !d.isPlanned && (d.weight ?? 0) > 0);
  }
  if (!leaves.length) return null;

  const total = leaves.reduce((n, d) => n + (d.weight ?? 0), 0);
  let r = rand(`dt:${machineCode}:${state}`, bucket) * total;
  let chosen = leaves[leaves.length - 1];
  for (const d of leaves) {
    r -= d.weight ?? 0;
    if (r <= 0) { chosen = d; break; }
  }

  const [lo, hi] = chosen.durationRange ?? [5, 20];
  const minutes = lo + rand(`dtlen:${machineCode}:${chosen.code}`, bucket) * (hi - lo);
  return { code: chosen.code, minutes: round(minutes, 1) };
}

// ────────────────────────────────────────────────────────────────────────────
// Energy
// ────────────────────────────────────────────────────────────────────────────

/**
 * Active power for a meter at an instant, in kW.
 *
 * Load follows production but never falls to zero: chillers, HVAC, water
 * treatment and standby losses run regardless of output. That fixed share is
 * why a production-linked efficiency measure can only ever reach part of the
 * bill, and the energy baseline screen exists to make that visible.
 */
export function meterLoadKw(f: FactoryDef, meterCode: string, t: Date | number): number {
  const meter = f.energyMeters.find((m) => m.code === meterCode);
  if (!meter?.baselineKw) return 0;

  const scheduled = isScheduled(f, t);
  const perf = scheduled ? throughputFactor(f, t) : 0;

  // Utility and area meters carry a larger fixed share than line meters.
  const fixedShare = meter.lineCode ? 0.28 : 0.62;
  const variable = (1 - fixedShare) * perf;

  const ms = new Date(t).getTime();
  const hourOfDay = ((ms % DAY) + DAY) % DAY / HOUR;
  // Cooling load tracks ambient temperature, peaking late afternoon.
  const ambient = 1 + 0.10 * Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI);
  const wobble = 1 + 0.04 * noise(`kw:${f.code}:${meterCode}`, Math.floor(ms / (5 * MINUTE)));

  return round(meter.baselineKw * (fixedShare + variable) * ambient * wobble, 2);
}

/**
 * Power factor at a meter.
 *
 * Degrades under load, which is the physical behaviour that makes reactive
 * power a cost rather than a curiosity. RMTC's MDP-1 sits lower than the rest
 * of the estate because its capacitor bank is modelled as ineffective.
 */
export function meterPowerFactor(f: FactoryDef, meterCode: string, t: Date | number): number {
  const meter = f.energyMeters.find((m) => m.code === meterCode);
  if (!meter) return 0.95;

  const load = meter.baselineKw ? meterLoadKw(f, meterCode, t) / meter.baselineKw : 0.5;
  const impaired = f.code === 'RMTC' && (meter.code === 'EM-MDP1' || meter.code === 'EM-MDP3');
  const ceiling = impaired ? 0.93 : 0.98;
  const floor = impaired ? 0.79 : 0.88;

  const ms = new Date(t).getTime();
  const wobble = 0.012 * noise(`pf:${f.code}:${meterCode}`, Math.floor(ms / (5 * MINUTE)));
  return round(clamp(ceiling - (ceiling - floor) * clamp(load, 0, 1) + wobble, 0.70, 0.99), 3);
}

/**
 * Current total harmonic distortion, as a percentage.
 *
 * Current THD is worst at part load — the harmonic current from a drive is
 * roughly constant while the fundamental falls — which is the opposite of what
 * most people expect and the reason a survey taken at full load understates
 * the problem.
 */
export function meterCurrentThd(f: FactoryDef, meterCode: string, t: Date | number): number {
  const meter = f.energyMeters.find((m) => m.code === meterCode);
  if (!meter?.baselineKw) return 0;

  const load = clamp(meterLoadKw(f, meterCode, t) / meter.baselineKw, 0.05, 1.2);
  const impaired = f.code === 'RMTC' && meter.code === 'EM-MDP1';
  const scale = impaired ? 9.5 : 4.5;

  const ms = new Date(t).getTime();
  const wobble = 1 + 0.10 * noise(`ithd:${f.code}:${meterCode}`, Math.floor(ms / (5 * MINUTE)));
  return round(clamp((scale / load) * 0.75 * wobble, 2, 34), 2);
}

/** Voltage THD, which unlike current THD does rise with load. */
export function meterVoltageThd(f: FactoryDef, meterCode: string, t: Date | number): number {
  const meter = f.energyMeters.find((m) => m.code === meterCode);
  if (!meter?.baselineKw) return 0;

  const load = clamp(meterLoadKw(f, meterCode, t) / meter.baselineKw, 0, 1.2);
  const impaired = f.code === 'RMTC' && meter.code === 'EM-MDP1';
  const base = impaired ? 3.4 : 1.8;
  const gain = impaired ? 3.2 : 1.6;

  const ms = new Date(t).getTime();
  const wobble = 1 + 0.08 * noise(`vthd:${f.code}:${meterCode}`, Math.floor(ms / (5 * MINUTE)));
  return round(clamp((base + gain * load) * wobble, 0.8, 8), 2);
}

// ────────────────────────────────────────────────────────────────────────────
// OEE
// ────────────────────────────────────────────────────────────────────────────

export interface OeeResult {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
}

/**
 * OEE from measured parts.
 *
 * Every factor is clamped to (0, 1]. Performance above 1 does not mean the
 * machine beat physics — it means the ideal cycle time is wrong — so it is
 * capped and the condition is worth surfacing rather than hiding.
 */
export function computeOee(input: {
  runTimeMinutes: number;
  plannedTimeMinutes: number;
  totalCount: number;
  goodCount: number;
  idealCycleSeconds: number;
}): OeeResult {
  const { runTimeMinutes, plannedTimeMinutes, totalCount, goodCount, idealCycleSeconds } = input;

  const availability = plannedTimeMinutes > 0 ? clamp(runTimeMinutes / plannedTimeMinutes, 0, 1) : 0;
  const earnedMinutes = (totalCount * idealCycleSeconds) / 60;
  const performance = runTimeMinutes > 0 ? clamp(earnedMinutes / runTimeMinutes, 0, 1) : 0;
  const quality = totalCount > 0 ? clamp(goodCount / totalCount, 0, 1) : 0;

  return {
    availability: round(availability, 4),
    performance: round(performance, 4),
    quality: round(quality, 4),
    oee: round(availability * performance * quality, 4),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Serials
// ────────────────────────────────────────────────────────────────────────────

/** Serial for a discrete unit — stable, sortable and human-readable. */
export function serialFor(factoryCode: string, productCode: string, sequence: number, when: Date): string {
  const y = when.getFullYear() % 100;
  const doy = Math.floor((when.getTime() - startOfDay(new Date(when.getFullYear(), 0, 1)).getTime()) / DAY) + 1;
  return `${factoryCode}-${productCode.replace(/[^A-Z0-9]/gi, '')}-${String(y).padStart(2, '0')}${String(doy).padStart(3, '0')}-${String(sequence).padStart(5, '0')}`;
}

/** Lot code for a batch-process unit. */
export function lotFor(factoryCode: string, productCode: string, when: Date, index: number): string {
  const y = when.getFullYear();
  const m = String(when.getMonth() + 1).padStart(2, '0');
  const d = String(when.getDate()).padStart(2, '0');
  return `${factoryCode}-${productCode}-${y}${m}${d}-${String(index).padStart(3, '0')}`;
}
