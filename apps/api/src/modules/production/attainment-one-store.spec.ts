import * as fs from 'fs';
import * as path from 'path';

/**
 * A headline and the chart beneath it read the same rows.
 *
 * ── The bug this was written for ────────────────────────────────────────────
 * The Schedule & Capacity page showed Master Schedule Attainment as 100% with a
 * trend chart directly underneath it reading 5%, for the same window, on the
 * same screen. Both were "right" by their own arithmetic:
 *
 *   the headline   Σ targetQty over orders, in whatever unit each order used,
 *                  against `ProductionOrder.completedQty`
 *   the trend      Σ scheduled in each SKU's BASE unit, against the output of
 *                  each order's FINAL routing step
 *
 * Two orders — 1,000 pallets and 160,000 inners — were added together as 1,030
 * by one and as 164,800 by the other. A 160-fold denominator gap is not a
 * rounding difference; it is two different questions sharing a caption.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Whatever the source, a number and its own trend come from ONE call site. This
 * fails if the endpoint ever goes back to deriving the two separately.
 */

const CTRL = path.resolve(__dirname, 'production.controller.ts');

describe('attainment headline and trend share a store', () => {
  const src = fs.readFileSync(CTRL, 'utf8');

  /** The handler body, from its route decorator to the next one. */
  const handler = (() => {
    const at = src.indexOf("'kpi/master-schedule-attainment'");
    expect(at).toBeGreaterThan(-1);
    const next = src.indexOf('@Get(', at + 10);
    return src.slice(at, next === -1 ? src.length : next);
  })();

  it('takes both the headline and the trend from the snapshot service', () => {
    expect(handler).toContain('this.attainment.headline');
    expect(handler).toContain('this.attainment.trend');
  });

  it('uses the live derivation only as a fallback, never alongside', () => {
    // `masterScheduleAttainment` may still appear — but only after a `??`, as
    // the answer for a window the snapshot has no rows for. A bare call is the
    // old defect returning.
    const liveCalls = [...handler.matchAll(/this\.scheduleKpi\.(masterScheduleAttainment|attainmentTrend)/g)];
    for (const m of liveCalls) {
      const before = handler.slice(Math.max(0, m.index! - 220), m.index!);
      expect(before).toMatch(/\?\?|return stored|stored\.length/);
    }
  });

  /**
   * The snapshot is only trustworthy if it converts units before it sums, and
   * takes output from the last step. Both rules live in the writer.
   */
  it('the writer converts to base units and reads the final step', () => {
    const w = fs.readFileSync(path.resolve(__dirname, 'attainment-snapshot.service.ts'), 'utf8');
    expect(w).toContain('toBaseUnits');
    // The last routing step, not the sum of the steps.
    expect(w).toMatch(/steps\[steps\.length - 1\]/);
    // The credit rule, applied before anything is stored.
    expect(w).toMatch(/creditedQty:\s*Math\.min\(actualQty, scheduledQty\)/);
  });

  it('would catch the two-source form', () => {
    const bad = "'master-schedule-attainment' … this.scheduleKpi.masterScheduleAttainment(a), this.attainment.trend(b)";
    const m = [...bad.matchAll(/this\.scheduleKpi\.(masterScheduleAttainment|attainmentTrend)/g)];
    expect(m.length).toBe(1);
    expect(bad.slice(0, m[0].index!)).not.toMatch(/\?\?|return stored|stored\.length/);
  });
});
