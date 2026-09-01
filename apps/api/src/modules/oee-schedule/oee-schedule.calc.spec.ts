import {
  computeSchedule, auditSchedule, committedSlot,
  EMPTY_SCHEDULE_TOTALS, type ScheduleTotals,
} from './oee-schedule.calc';

const totals = (over: Partial<ScheduleTotals>): ScheduleTotals => ({ ...EMPTY_SCHEDULE_TOTALS, ...over });
const at = (h: number, m = 0) => new Date(2026, 7, 20, h, m, 0, 0);

/**
 * The schedule basis, stated as the plant stated it.
 *
 *   committedFrom = min(plannedStart, actualStart)
 *   committedTo   = actualEnd == null ? max(now, plannedEnd)
 *                                     : max(actualEnd, plannedEnd)
 *
 * The tests below are mostly about the two kinds of time this basis creates and
 * the standard engine has no room for: slot minutes before the order started,
 * and slot minutes it has not reached yet.
 */
describe('OEE schedule engine — the committed slot', () => {
  // ── The slot itself ───────────────────────────────────────────────────────
  describe('committedSlot', () => {
    const now = at(12);

    it('runs to the planned end while the order is still inside its slot', () => {
      const s = committedSlot(
        { plannedStart: at(8), plannedEnd: at(16), actualStart: at(9), actualEnd: null }, now,
      )!;
      expect(s.from).toEqual(at(8));  // the slot opened at 08:00, not at 09:00
      expect(s.to).toEqual(at(16));   // and runs to 16:00, not to 12:00
    });

    it('runs to now once the order has overrun its slot', () => {
      const late = at(18);
      const s = committedSlot(
        { plannedStart: at(8), plannedEnd: at(16), actualStart: at(9), actualEnd: null }, late,
      )!;
      expect(s.to).toEqual(late);
    });

    it('opens early when the order started before its planned start', () => {
      // Neither the plan nor the actual bounds the slot on its own.
      const s = committedSlot(
        { plannedStart: at(8), plannedEnd: at(16), actualStart: at(7), actualEnd: null }, now,
      )!;
      expect(s.from).toEqual(at(7));
    });

    it('closes at the planned end when the order finished early', () => {
      const s = committedSlot(
        { plannedStart: at(8), plannedEnd: at(16), actualStart: at(9), actualEnd: at(11) }, now,
      )!;
      expect(s.to).toEqual(at(16)); // the slot was held even though the work stopped
    });

    it('closes at the actual end when the order finished late', () => {
      const s = committedSlot(
        { plannedStart: at(8), plannedEnd: at(16), actualStart: at(9), actualEnd: at(19) }, now,
      )!;
      expect(s.to).toEqual(at(19));
    });

    it('falls back to the actual window when nothing was planned', () => {
      const s = committedSlot(
        { plannedStart: null, plannedEnd: null, actualStart: at(9), actualEnd: at(11) }, now,
      )!;
      expect(s.from).toEqual(at(9));
      expect(s.to).toEqual(at(11));
    });

    it('has no slot at all before anything is scheduled or started', () => {
      expect(committedSlot(
        { plannedStart: null, plannedEnd: null, actualStart: null, actualEnd: null }, now,
      )).toBeNull();
    });

    it('refuses a slot that would end before it begins', () => {
      // Bad master data. Returning a negative span would let it cancel another
      // order's minutes inside the same SUM.
      expect(committedSlot(
        { plannedStart: at(16), plannedEnd: at(8), actualStart: at(16), actualEnd: at(16) }, at(16),
      )).toBeNull();
    });
  });

  // ── What the basis does to the numbers ────────────────────────────────────
  it('charges the slot minutes the order has not reached yet', () => {
    // Eight hours committed, one hour elapsed, that hour spent running.
    const r = computeSchedule(totals({
      committedMin: 480, elapsedMin: 60, operatingMin: 60,
      theoreticalParts: 60, goodParts: 60,
    }));
    expect(r.time.notYetReachedMin).toBe(420);
    expect(r.time.operationalMin).toBe(480);
    expect(r.availability).toBe(12.5); // 60 ÷ 480
    expect(r.slotElapsedPct).toBe(12.5);
  });

  it('charges a late start to the slot', () => {
    const r = computeSchedule(totals({
      committedMin: 480, elapsedMin: 420, notStartedMin: 60, operatingMin: 420,
      theoreticalParts: 420, goodParts: 420,
    }));
    expect(r.time.notStartedMin).toBe(60);
    expect(r.time.notYetReachedMin).toBe(0);
    expect(r.availability).toBe(87.5); // 420 ÷ 480
  });

  it('reads the same as the standard engine once the slot is fully used', () => {
    // No slot left over, so the extra terms are zero and the model reduces to
    // the published one. That is the property that makes the two comparable.
    const r = computeSchedule(totals({
      committedMin: 480, elapsedMin: 480, plannedStopMin: 60,
      availabilityLossMin: 105, operatingMin: 315,
      theoreticalParts: 315, goodParts: 315,
    }));
    expect(r.time.notStartedMin).toBe(0);
    expect(r.time.notYetReachedMin).toBe(0);
    expect(r.time.operationalMin).toBe(420);
    expect(r.availability).toBe(75);
  });

  it('keeps planned stops and external loss out of the denominator', () => {
    const r = computeSchedule(totals({
      committedMin: 480, elapsedMin: 480, plannedStopMin: 60, externalLossMin: 120,
      availabilityLossMin: 60, operatingMin: 240,
      theoreticalParts: 240, goodParts: 240,
    }));
    expect(r.time.operationalMin).toBe(300); // 480 − 60 − 120
    expect(r.availability).toBe(80);         // 240 ÷ 300
  });

  it('says how far through the promise it is, beside the reading', () => {
    // The same 12% means "not yet" at the start of a slot and "missed" at the
    // end of one. Without this the two are indistinguishable.
    const early = computeSchedule(totals({ committedMin: 480, elapsedMin: 60, operatingMin: 60, theoreticalParts: 60, goodParts: 60 }));
    const done = computeSchedule(totals({ committedMin: 480, elapsedMin: 480, availabilityLossMin: 420, operatingMin: 60, theoreticalParts: 60, goodParts: 60 }));
    expect(early.availability).toBe(done.availability);
    expect(early.slotElapsedPct).toBe(12.5);
    expect(done.slotElapsedPct).toBe(100);
  });

  it('reports nothing rather than zero for a slot that has not opened', () => {
    const r = computeSchedule(EMPTY_SCHEDULE_TOTALS);
    expect(r.availability).toBeNull();
    expect(r.oee).toBeNull();
  });

  /**
   * A slot that EXISTS but has not been reached yet.
   *
   * The empty-totals case above never had a denominator, so it fell out for
   * free. This one does: an hour of the promise that has not begun still has
   * 60 committed minutes, and `operationalMin` is a real 60. Dividing zero
   * running minutes by it used to give Availability = 0%.
   *
   * That mattered on the trend, which generates a bucket for every hour of the
   * slot including the unreached ones: it drew Availability along the floor
   * from now until the end of the day, which reads as a breakdown. Performance
   * and Quality were already null there — this makes the three agree.
   */
  it('does not call an unreached hour 0% available', () => {
    const t = totals({ committedMin: 60, elapsedMin: 0, notStartedMin: 0 });
    const r = computeSchedule(t);

    expect(r.availability).toBeNull();
    expect(r.performance).toBeNull();
    expect(r.quality).toBeNull();
    expect(r.oee).toBeNull();
    // The promise is still charged in full — only the factors decline to answer.
    expect(r.time.committedMin).toBe(60);
    expect(r.time.notYetReachedMin).toBe(60);
  });

  it('still reports 0% available for an hour that was observed and idle', () => {
    // One minute of the slot was actually recorded, and the machine ran for
    // none of it. That IS zero availability, and must not be swept up by the
    // guard above.
    const t = totals({ committedMin: 60, elapsedMin: 60, operatingMin: 0 });
    const r = computeSchedule(t);

    expect(r.availability).toBe(0);
    expect(r.time.notYetReachedMin).toBe(0);
  });

  // ── The self-check ────────────────────────────────────────────────────────
  it('accounts for every minute of the slot', () => {
    const t = totals({
      committedMin: 480, elapsedMin: 300, notStartedMin: 60,
      plannedStopMin: 30, externalLossMin: 20, unmeasuredMin: 10,
      availabilityLossMin: 40, operatingMin: 200,
    });
    const a = auditSchedule(t);
    expect(a.ok).toBe(true);
    expect(a.bucketDriftMin).toBe(0);
    expect(a.identityDriftMin).toBe(0);
  });

  it('catches a slot whose minutes do not add up', () => {
    const t = totals({ committedMin: 480, elapsedMin: 300, operatingMin: 200 });
    const a = auditSchedule(t);
    expect(a.ok).toBe(false);
    expect(a.bucketDriftMin).toBe(100); // 100 elapsed minutes landed nowhere
  });

  it('bars sum down the model without a gap', () => {
    // Each bar is rounded to a tenth for display, so a chain of four can drift by
    // one rounding step. The tolerance is that step and no more: a real gap in
    // the model is minutes, not tenths.
    const closeEnough = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(0.2);
    const r = computeSchedule(totals({
      committedMin: 480, elapsedMin: 420, notStartedMin: 60,
      plannedStopMin: 30, availabilityLossMin: 90, operatingMin: 300,
      theoreticalParts: 400, goodParts: 285, rejectedParts: 15,
    }));
    const b = Object.fromEntries(r.bars.map((x) => [x.key, x.minutes]));
    closeEnough(b.committedTime - b.plannedStops - b.externalLoss - b.unmeasured, b.operationalTime);
    closeEnough(b.operationalTime - b.notStarted - b.notYetReached - b.availabilityLosses, b.netProductionTime);
    closeEnough(b.netProductionTime - b.performanceLosses, b.netOperationalTime);
    closeEnough(b.netOperationalTime - b.qualityLosses, b.usedOperationalTime);
  });
});
