/**
 * The Insights Hub OEE time model, as arithmetic.
 *
 *   https://documentation.mindsphere.io/MindSphere/apps/insights-hub-oee/OEE-standard-formulas.html
 *
 * Pure functions over summed minutes and counts — no database, no clock, no
 * configuration. That is the point: this file is the reference implementation,
 * and anything that disagrees with it is wrong by definition rather than by
 * argument. Every number a screen shows comes through `computeOee`.
 *
 * ── The reference, verbatim ─────────────────────────────────────────────────
 *   OEE                   = Availability × Performance × Quality
 *   Availability          = OperatingTime ÷ PlannedProductionTime
 *   PlannedProductionTime = TotalTime − PlannedShutdown
 *   OperatingTime         = PlannedProductionTime − Σ Downtimes
 *   Performance           = TotalParts ÷ TheoreticalOutput
 *   TheoreticalOutput     = OperatingTime × DesignSpeed
 *   Quality               = GoodParts ÷ TotalParts
 *   TEEP                  = OEE × (PlannedProductionTime ÷ TotalTime)
 *
 * ── The one place this goes beyond the reference, and why ───────────────────
 * The reference knows two kinds of stopped time: planned shutdown, and
 * downtime. This plant's State Rules know a third — a state marked as downtime
 * that does NOT affect OEE, which is how starvation and blockage are recorded.
 * A machine waiting on the line is healthy, and charging it for the line's
 * constraint makes the palletiser look worse than the filler that stopped it.
 *
 * Those minutes are carved out ABOVE Planned Production Time, beside planned
 * stops — excluded from the ratio, never hidden from the waterfall. Set every
 * State Rule to affectsOEE and the term is zero and this file reduces exactly to
 * the reference.
 */

import { oeeIdentityOf } from '../../common/oee-identity.util';

/** Summed primitives for a window. Every field is minutes except the counts. */
export interface OeeTotals {
  /** Every minute the job order occupied. The top of the time model. */
  totalMin: number;
  /** Scheduled stops plus any state the plant classes as planned. */
  plannedStopMin: number;
  /** Unplanned downtime charged to this machine. */
  availabilityLossMin: number;
  /** Stopped by the line, not by the machine — excluded from the ratio. */
  externalLossMin: number;
  /** The machine reported nothing. Neither running nor stopped. */
  unmeasuredMin: number;
  microStopMin?: number;
  /** Minutes the machine was running. */
  operatingMin: number;
  goodParts: number;
  rejectedParts: number;
  /** Σ (operating minutes × that product's design speed). */
  theoreticalParts: number;
  /**
   * Parts counted in minutes the engine measured NO running time for.
   *
   * The counters are read from the job order and are deliberately independent
   * of how the minute was classified — a pulse is a pulse. So a line that runs
   * through a scheduled break still books its output, while the theoretical
   * denominator for those minutes is zero, because the schedule took them.
   *
   * That is a real event and it must not be silent: those parts inflate the
   * Performance numerator against a denominator they never contributed to.
   * Carried here so the audit can name the amount instead of the reading
   * quietly drifting upward. Optional so older callers still typecheck.
   */
  outputWithoutRuntimeParts?: number;
}

export interface OeeFactors {
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  teep: number | null;
  /** PlannedProductionTime ÷ TotalTime — how much of the clock was even planned. */
  utilization: number | null;
}

/** One bar of the time-model chart. `kind` drives how it is drawn. */
export interface TimeModelBar {
  key: string;
  minutes: number;
  /** Share of Total time, which is what the reference's chart plots. */
  pct: number;
  kind: 'base' | 'loss' | 'result';
}

export interface OeeResult extends OeeFactors {
  totals: OeeTotals;
  /** The named levels of the time model, in order. */
  time: {
    totalMin: number;
    plannedStopMin: number;
    externalLossMin: number;
    unmeasuredMin: number;
    /** PlannedProductionTime — the availability denominator. */
    operationalMin: number;
    availabilityLossMin: number;
    /** OperatingTime — the availability numerator. */
    netProductionMin: number;
    performanceLossMin: number;
    microstopLossMin: number;
    netOperationalMin: number;
    qualityLossMin: number;
    usedOperationalMin: number;
  };
  counts: { good: number; rejected: number; total: number; theoretical: number };
  bars: TimeModelBar[];
}

export const EMPTY_TOTALS: OeeTotals = {
  totalMin: 0, plannedStopMin: 0, availabilityLossMin: 0, externalLossMin: 0,
  unmeasuredMin: 0, operatingMin: 0, goodParts: 0, rejectedParts: 0, theoreticalParts: 0,
  outputWithoutRuntimeParts: 0,
};

export function addTotals(a: OeeTotals, b: Partial<OeeTotals>): OeeTotals {
  return {
    totalMin: a.totalMin + (b.totalMin ?? 0),
    plannedStopMin: a.plannedStopMin + (b.plannedStopMin ?? 0),
    availabilityLossMin: a.availabilityLossMin + (b.availabilityLossMin ?? 0),
    externalLossMin: a.externalLossMin + (b.externalLossMin ?? 0),
    unmeasuredMin: a.unmeasuredMin + (b.unmeasuredMin ?? 0),
    operatingMin: a.operatingMin + (b.operatingMin ?? 0),
    goodParts: a.goodParts + (b.goodParts ?? 0),
    rejectedParts: a.rejectedParts + (b.rejectedParts ?? 0),
    theoreticalParts: a.theoreticalParts + (b.theoreticalParts ?? 0),
  };
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A ratio, or null when the denominator does not exist.
 *
 * Null rather than zero throughout. A machine nobody scheduled has no
 * availability; reporting 0% says it was asked to run and failed, which is a
 * different and worse claim than "not asked".
 */
function ratio(num: number, den: number): number | null {
  if (!(den > 0)) return null;
  return (num / den) * 100;
}

/**
 * The whole model, from summed primitives.
 *
 * @param cap  clamp Performance and Quality at 100%. On by default: beating the
 *             design speed means the design speed is wrong, not that the machine
 *             outran physics — and an uncapped factor pushes OEE above 100 too.
 *             Pass false when auditing master data, where the raw figure is the
 *             finding.
 */
export function computeOee(t: OeeTotals, opts: { cap?: boolean } = {}): OeeResult {
  const cap = opts.cap !== false;
  const clamp = (n: number | null) => (n == null ? null : cap ? Math.min(100, n) : n);

  const totalMin = t.totalMin;

  // PlannedProductionTime = TotalTime − PlannedShutdown.
  // Unmeasured minutes leave from here too: time nobody observed cannot be part
  // of the time we claim to have planned to produce in, and leaving it in is how
  // a machine with no status signal used to report a flattering availability.
  const operationalMin = Math.max(0, totalMin - t.plannedStopMin - t.externalLossMin - t.unmeasuredMin);

  // OperatingTime = PlannedProductionTime − Σ Downtimes.
  // Read from the measured operating minutes rather than by subtraction, then
  // checked against the identity below — a subtraction cannot disagree with
  // itself, which is exactly why it hides a writer that has lost minutes.
  const netProductionMin = t.operatingMin;

  const availability = clamp(ratio(netProductionMin, operationalMin));
  const performance = clamp(ratio(t.goodParts + t.rejectedParts, t.theoreticalParts));
  const totalParts = t.goodParts + t.rejectedParts;
  const quality = clamp(ratio(t.goodParts, totalParts));

  // The losses are the time-model expression of the same two factors. Deriving
  // them from the factors (rather than storing them) guarantees the bars always
  // reconcile with the percentages printed beside them.
  const netOperationalMin = performance != null ? netProductionMin * (performance / 100) : netProductionMin;
  const performanceLossMin = Math.max(0, netProductionMin - netOperationalMin);
  const usedOperationalMin = quality != null ? netOperationalMin * (quality / 100) : netOperationalMin;
  const qualityLossMin = Math.max(0, netOperationalMin - usedOperationalMin);

  const oee =
    availability != null && performance != null && quality != null
      ? oeeIdentityOf(availability, performance, quality)
      : null;

  const utilization = ratio(operationalMin, totalMin);
  const teep = oee != null && utilization != null ? (oee / 100) * utilization : null;

  const pct = (m: number) => (totalMin > 0 ? r2((m / totalMin) * 100) : 0);
  const bar = (key: string, minutes: number, kind: TimeModelBar['kind']): TimeModelBar => ({
    key, minutes: r1(minutes), pct: pct(minutes), kind,
  });

  return {
    availability: availability == null ? null : r1(availability),
    performance: performance == null ? null : r1(performance),
    quality: quality == null ? null : r1(quality),
    oee: oee == null ? null : r1(oee),
    teep: teep == null ? null : r1(teep),
    utilization: utilization == null ? null : r1(utilization),
    totals: t,
    time: {
      totalMin: r1(totalMin),
      plannedStopMin: r1(t.plannedStopMin),
      externalLossMin: r1(t.externalLossMin),
      unmeasuredMin: r1(t.unmeasuredMin),
      operationalMin: r1(operationalMin),
      availabilityLossMin: r1(t.availabilityLossMin),
      netProductionMin: r1(netProductionMin),
      performanceLossMin: r1(performanceLossMin),
      // Microstops are a named level of the reference's model and this plant does
      // not measure them yet. Reported as an explicit zero rather than omitted,
      // so the bar reads "nothing measures this" instead of "this never happens".
      microstopLossMin: r1(t.microStopMin ?? 0),
      netOperationalMin: r1(netOperationalMin),
      qualityLossMin: r1(qualityLossMin),
      usedOperationalMin: r1(usedOperationalMin),
    },
    counts: {
      good: r1(t.goodParts),
      rejected: r1(t.rejectedParts),
      total: r1(totalParts),
      theoretical: r1(t.theoreticalParts),
    },
    bars: [
      bar('totalTime', totalMin, 'base'),
      bar('plannedStops', t.plannedStopMin, 'loss'),
      bar('externalLoss', t.externalLossMin, 'loss'),
      bar('unmeasured', t.unmeasuredMin, 'loss'),
      bar('operationalTime', operationalMin, 'base'),
      bar('availabilityLosses', t.availabilityLossMin, 'loss'),
      bar('netProductionTime', netProductionMin, 'base'),
      bar('performanceLosses', performanceLossMin, 'loss'),
      bar('microstopLosses', 0, 'loss'),
      bar('netOperationalTime', netOperationalMin, 'base'),
      bar('qualityLosses', qualityLossMin, 'loss'),
      bar('usedOperationalTime', usedOperationalMin, 'result'),
    ],
  };
}

/**
 * Does this window's arithmetic actually hold together?
 *
 * Two identities that a correct writer satisfies by construction. They are
 * checked rather than assumed because the failure they catch is silent: minutes
 * that go missing between the clock and the buckets do not raise an error, they
 * quietly inflate availability. Surfaced on the page beside the numbers, so the
 * plant can see the engine checking itself.
 *
 *   1. every minute of Total time lands in exactly one bucket
 *   2. Operational time − availability loss = Net production time
 */
export function auditTotals(t: OeeTotals): {
  ok: boolean;
  bucketsMin: number;
  bucketDriftMin: number;
  identityDriftMin: number;
  /** Parts booked in minutes with no measured runtime. See OeeTotals. */
  outputWithoutRuntimeParts: number;
  /**
   * How many points those parts add to Performance.
   *
   * Stated in the unit the reader is actually judging — nobody can tell what
   * "1,245 pieces" does to a percentage without doing the division themselves.
   */
  outputWithoutRuntimePct: number;
} {
  const buckets =
    t.plannedStopMin + t.externalLossMin + t.unmeasuredMin + t.availabilityLossMin + t.operatingMin;
  const bucketDrift = t.totalMin - buckets;

  const operationalMin = Math.max(0, t.totalMin - t.plannedStopMin - t.externalLossMin - t.unmeasuredMin);
  const identityDrift = operationalMin - t.availabilityLossMin - t.operatingMin;

  // Parts the plant made in minutes the engine credited no runtime for. Not a
  // drift — nothing is lost — but it moves Performance without moving its
  // denominator, so it belongs beside the drifts rather than nowhere.
  const orphan = t.outputWithoutRuntimeParts ?? 0;
  const orphanPct = t.theoreticalParts > 0 ? (orphan / t.theoreticalParts) * 100 : 0;

  // A tenth of a minute over a whole window is float noise, not lost time.
  const TOL = 0.1;
  return {
    // `ok` stays a statement about the MINUTES reconciling. Orphan output is a
    // separate fact with its own line: folding it in here would turn a window
    // whose time model is perfect into a red banner, and the two need
    // different actions — one is a writer bug, the other is a schedule that
    // does not match what the line did.
    ok: Math.abs(bucketDrift) <= TOL && Math.abs(identityDrift) <= TOL,
    bucketsMin: r1(buckets),
    bucketDriftMin: r1(bucketDrift),
    identityDriftMin: r1(identityDrift),
    outputWithoutRuntimeParts: Math.round(orphan),
    outputWithoutRuntimePct: r2(orphanPct),
  };
}

/**
 * Design speed in parts per hour, from a cycle time in seconds per part.
 *
 * The reference states Performance in terms of design speed; this codebase
 * stores its inverse. Converting in one named place keeps the reciprocal — and
 * the divide-by-zero at the end of it — from being written out five times.
 */
export function designSpeedPph(idealCycleTimeSec: number | null | undefined): number | null {
  if (!idealCycleTimeSec || idealCycleTimeSec <= 0) return null;
  return 3600 / idealCycleTimeSec;
}
