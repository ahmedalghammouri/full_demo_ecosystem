import { oeeIdentity, oeeTimeBased, pctOf } from './oee-identity.util';

/**
 * The one definition of OEE, and the edge cases sixteen hand-written copies
 * disagreed about.
 *
 * The multiplication was never the problem. What differed between the copies was
 * what they did when a factor was missing, and that is what reached the screen.
 */
describe('oeeIdentity', () => {
  it('multiplies the three factors', () => {
    expect(oeeIdentity(100, 100, 100)).toBe(100);
    expect(oeeIdentity(50, 50, 100)).toBe(25);
    expect(oeeIdentity(90, 80, 95)).toBeCloseTo(68.4, 6);
  });

  /**
   * The failure this file exists to end.
   *
   * A machine with no parts counted has no measurable Performance. That is not
   * "Performance = 0%". One of the copies wrote `(r.performance ?? 0) / 100`,
   * which turns an absent measurement into a real OEE of 0.0% — and a reader
   * cannot tell that from a machine that genuinely produced nothing.
   */
  it('returns null when any factor is missing, never zero', () => {
    expect(oeeIdentity(null, 80, 95)).toBeNull();
    expect(oeeIdentity(90, null, 95)).toBeNull();
    expect(oeeIdentity(90, 80, null)).toBeNull();
    expect(oeeIdentity(undefined, 80, 95)).toBeNull();
    expect(oeeIdentity(90, 80, undefined)).toBeNull();
  });

  it('treats NaN as missing rather than propagating it', () => {
    // A NaN that reaches a page renders as "NaN%". It is not a measurement, and
    // it arrives from a 0/0 upstream that nobody guarded.
    expect(oeeIdentity(Number.NaN, 80, 95)).toBeNull();
    expect(oeeIdentity(90, Number.POSITIVE_INFINITY, 95)).toBeNull();
  });

  it('distinguishes a measured zero from a missing factor', () => {
    // Measured at zero IS a reading, and multiplies out to zero.
    expect(oeeIdentity(0, 80, 95)).toBe(0);
    expect(oeeIdentity(90, 0, 95)).toBe(0);
    // Missing is not.
    expect(oeeIdentity(null, 80, 95)).toBeNull();
  });

  /**
   * A factor above 100 means the machine outran its own design speed — a master
   * data problem, not a performance. Left unclamped it inflates the product.
   */
  it('clamps a factor that exceeds 100 rather than inflating the product', () => {
    expect(oeeIdentity(100, 162, 100)).toBe(100);
    expect(oeeIdentity(80, 150, 100)).toBeCloseTo(80, 6);
  });

  it('clamps a negative factor to zero', () => {
    expect(oeeIdentity(-10, 80, 95)).toBe(0);
  });

  it('does not round — the caller decides the precision', () => {
    // 33.333… must survive intact; rounding here would silently move every
    // existing figure the moment this was adopted.
    const r = oeeIdentity(100 / 3, 100, 100) as number;
    expect(r).toBeGreaterThan(33.33);
    expect(r).toBeLessThan(33.34);
    expect(Number.isInteger(r)).toBe(false);
  });
});

describe('oeeTimeBased', () => {
  it('differs from OEE in exactly one factor', () => {
    // Same P and Q, a different A. A call site that recomputed all three would
    // be answering a different question than the number printed beside it.
    expect(oeeTimeBased(70, 80, 95)).toBe(oeeIdentity(70, 80, 95));
    expect(oeeTimeBased(70, 80, 95)).not.toBe(oeeIdentity(90, 80, 95));
  });

  it('propagates a missing time-based availability', () => {
    expect(oeeTimeBased(null, 80, 95)).toBeNull();
  });
});

describe('pctOf', () => {
  it('is a percentage of the denominator', () => {
    expect(pctOf(50, 200)).toBe(25);
  });

  it('refuses a denominator of zero rather than returning zero or Infinity', () => {
    // 0/0 is the source of most NaN on a KPI page; x/0 is the source of most
    // Infinity. Neither is a ratio, and neither should be printed as one.
    expect(pctOf(0, 0)).toBeNull();
    expect(pctOf(5, 0)).toBeNull();
    expect(pctOf(5, -1)).toBeNull();
  });

  it('propagates a missing numerator', () => {
    expect(pctOf(null, 100)).toBeNull();
    expect(pctOf(undefined, 100)).toBeNull();
  });
});
