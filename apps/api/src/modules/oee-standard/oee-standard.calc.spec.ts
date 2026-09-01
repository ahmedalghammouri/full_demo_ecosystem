import { computeOee, auditTotals, designSpeedPph, EMPTY_TOTALS, type OeeTotals } from './oee-standard.calc';

const totals = (over: Partial<OeeTotals>): OeeTotals => ({ ...EMPTY_TOTALS, ...over });

/**
 * The engine against its published reference.
 *
 * The first test reproduces a worked example from the Insights Hub time-model
 * chart bar for bar. That is the whole point of a second engine: not that it is
 * newer, but that its output can be laid beside a reference someone else
 * publishes and checked. A number nobody can check is not a measurement.
 */
describe('OEE standard engine — Insights Hub time model', () => {
  /**
   * Every percentage below is read off the reference chart. The minutes are that
   * chart's percentages applied to a 24-hour window, and the counts are chosen to
   * land Performance and Quality on their published figures.
   */
  const reference = totals({
    totalMin: 1440,
    plannedStopMin: 771.4,      // 53.57%
    availabilityLossMin: 390.5, // 27.12%
    operatingMin: 278.1,        // 19.31% — net production time
    theoreticalParts: 1000,
    goodParts: 805.7,
    rejectedParts: 90.2,        // total 895.9 → performance 89.59%
  });

  it('reproduces the reference time model bar for bar', () => {
    const pct = Object.fromEntries(computeOee(reference).bars.map((b) => [b.key, b.pct]));

    expect(pct.totalTime).toBeCloseTo(100, 1);
    expect(pct.plannedStops).toBeCloseTo(53.57, 1);
    expect(pct.operationalTime).toBeCloseTo(46.43, 1);
    expect(pct.availabilityLosses).toBeCloseTo(27.12, 1);
    expect(pct.netProductionTime).toBeCloseTo(19.31, 1);
    expect(pct.performanceLosses).toBeCloseTo(2.01, 1);
    expect(pct.netOperationalTime).toBeCloseTo(17.3, 1);
    expect(pct.qualityLosses).toBeCloseTo(1.74, 1);
    expect(pct.usedOperationalTime).toBeCloseTo(15.56, 1);
  });

  it('reproduces the reference factors', () => {
    const r = computeOee(reference);
    expect(r.availability).toBeCloseTo(41.6, 0);
    expect(r.performance).toBeCloseTo(89.6, 0);
    expect(r.quality).toBeCloseTo(89.9, 0);
    expect(r.oee).toBeCloseTo(33.5, 0);
  });

  it('agrees with itself: the factors multiply out to the bars', () => {
    // OEE is defined twice over — as A×P×Q, and as used operational time over
    // operational time. A model whose two definitions disagree is not a model.
    const r = computeOee(reference);
    expect(r.oee!).toBeCloseTo((r.time.usedOperationalMin / r.time.operationalMin) * 100, 1);
  });

  // ── The formulas, one at a time ────────────────────────────────────────────
  it('PlannedProductionTime = TotalTime − PlannedShutdown', () => {
    const r = computeOee(totals({ totalMin: 480, plannedStopMin: 60, operatingMin: 420 }));
    expect(r.time.operationalMin).toBe(420);
  });

  it('Availability = OperatingTime ÷ PlannedProductionTime', () => {
    const r = computeOee(totals({ totalMin: 480, plannedStopMin: 60, availabilityLossMin: 105, operatingMin: 315 }));
    expect(r.time.operationalMin).toBe(420);
    expect(r.availability).toBe(75); // 315 / 420
  });

  it('Performance = TotalParts ÷ TheoreticalOutput', () => {
    const r = computeOee(totals({
      totalMin: 100, operatingMin: 100, theoreticalParts: 200, goodParts: 150, rejectedParts: 0,
    }));
    expect(r.performance).toBe(75);
  });

  it('Quality = GoodParts ÷ TotalParts', () => {
    const r = computeOee(totals({
      totalMin: 100, operatingMin: 100, theoreticalParts: 100, goodParts: 90, rejectedParts: 10,
    }));
    expect(r.quality).toBe(90);
  });

  it('TEEP = OEE × (PlannedProductionTime ÷ TotalTime), which is used time over the clock', () => {
    // The two forms collapse: (used ÷ operational) × (operational ÷ total) = used ÷ total.
    // Asserting the identity rather than the rounded product tests the model
    // instead of testing Math.round.
    const r = computeOee(reference);
    expect(r.utilization).toBeCloseTo(46.4, 0);
    expect(r.teep).toBeCloseTo((r.time.usedOperationalMin / r.time.totalMin) * 100, 1);
    expect(r.teep!).toBeLessThan(r.oee!); // TEEP is always the smaller number
  });

  it('design speed is the reciprocal of cycle time, in parts per hour', () => {
    expect(designSpeedPph(60)).toBe(60);   // one a minute
    expect(designSpeedPph(3.6)).toBe(1000);
    expect(designSpeedPph(0)).toBeNull();
    expect(designSpeedPph(null)).toBeNull();
  });

  // ── Null is not zero ──────────────────────────────────────────────────────
  it('reports no availability for a machine nothing was planned for', () => {
    // 0% says it was asked to run and failed. That is a different — and worse —
    // claim than "never asked", and the two must not print the same.
    const r = computeOee(totals({ totalMin: 60, plannedStopMin: 60 }));
    expect(r.time.operationalMin).toBe(0);
    expect(r.availability).toBeNull();
    expect(r.oee).toBeNull();
  });

  it('reports no performance or quality before anything is produced', () => {
    const r = computeOee(totals({ totalMin: 60, operatingMin: 60 }));
    expect(r.availability).toBe(100);
    expect(r.performance).toBeNull();
    expect(r.quality).toBeNull();
    expect(r.oee).toBeNull(); // and OEE cannot be claimed on one factor out of three
  });

  // ── The plant's third kind of stopped time ────────────────────────────────
  it('carves external loss out above Planned Production Time', () => {
    // A machine starved by the line is healthy. Charging it for the constraint
    // makes the palletiser score worse than the filler that stopped it.
    const withExternal = computeOee(totals({
      totalMin: 480, plannedStopMin: 60, externalLossMin: 120, availabilityLossMin: 60, operatingMin: 240,
    }));
    expect(withExternal.time.operationalMin).toBe(300); // 480 − 60 − 120
    expect(withExternal.availability).toBe(80);         // 240 / 300
  });

  it('reduces exactly to the reference when no state is marked external', () => {
    // The deviation is opt-in. A plant that sets every State Rule to affect OEE
    // gets the published model back, unchanged.
    const t = totals({ totalMin: 480, plannedStopMin: 60, availabilityLossMin: 180, operatingMin: 240 });
    const r = computeOee(t);
    expect(r.time.externalLossMin).toBe(0);
    expect(r.availability).toBe(r1(240 / 420 * 100));
  });

  it('takes unmeasured minutes out of both sides', () => {
    // Time nobody observed is not time we can claim to have planned to produce
    // in. Leaving it in the denominator is how a machine with no status signal
    // reported a flattering availability.
    const r = computeOee(totals({ totalMin: 480, unmeasuredMin: 180, operatingMin: 300 }));
    expect(r.time.operationalMin).toBe(300);
    expect(r.availability).toBe(100);
  });

  // ── The cap ───────────────────────────────────────────────────────────────
  it('caps performance at 100 and says so through the audit, not silently', () => {
    const over = totals({ totalMin: 60, operatingMin: 60, theoreticalParts: 100, goodParts: 150 });
    expect(computeOee(over).performance).toBe(100);
    // Uncapped is available for exactly one purpose: auditing the design speed.
    expect(computeOee(over, { cap: false }).performance).toBe(150);
  });

  // ── The self-check ────────────────────────────────────────────────────────
  it('passes its own audit when every minute is accounted for', () => {
    const a = auditTotals(reference);
    expect(a.ok).toBe(true);
    expect(Math.abs(a.bucketDriftMin)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(a.identityDriftMin)).toBeLessThanOrEqual(0.1);
  });

  it('catches a writer that has lost minutes', () => {
    // The failure this exists for is silent: minutes that fall out between the
    // clock and the buckets do not raise an error, they inflate availability.
    const leaky = totals({ totalMin: 480, plannedStopMin: 60, availabilityLossMin: 60, operatingMin: 300 });
    const a = auditTotals(leaky);
    expect(a.ok).toBe(false);
    expect(a.bucketDriftMin).toBe(60); // an hour of the clock landed nowhere
  });

  it('adds nothing to an empty window rather than dividing by it', () => {
    const r = computeOee(EMPTY_TOTALS);
    expect(r.oee).toBeNull();
    expect(r.bars.every((b) => b.pct === 0)).toBe(true);
    expect(auditTotals(EMPTY_TOTALS).ok).toBe(true);
  });
});

const r1 = (n: number) => Math.round(n * 10) / 10;
