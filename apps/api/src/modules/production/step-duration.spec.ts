import { stepDurationMins } from './step-duration';
import { convertUnits } from '../../common/units.util';

/**
 * The estimate quoted the palletiser for pallets it never makes.
 *
 * ── The plant's own arithmetic ──────────────────────────────────────────────
 * PO-27-8-2026-S001 runs 1500 cartons into the palletiser, and this SKU stacks
 * 65 cartons to a pallet. 1500 / 65 is 23.08 pallets. A job order cannot be
 * issued for 23.08 of anything, so the QUANTITY is ceiled to 24 — correctly:
 * the part-filled pallet is real, somebody has to move it, and the next step
 * has to be given enough to work with.
 *
 * The ceiling then leaked into the CLOCK. 24 pallets at the step's cycle time
 * is 187 minutes; the 1500 cartons that actually arrive are 180. Seven minutes
 * on one step of one order — but it lands on every coarsening step of every
 * order, and it is the kind of error that makes a finish time quietly
 * untrustworthy rather than obviously wrong.
 *
 * The ladder is read from `units.util` here rather than written down, so the
 * test computes 1500/65 the way the system does instead of agreeing with a
 * number I typed.
 */
const SKU = { unitsPerInner: 1, innersPerCarton: 6, cartonsPerPallet: 65 };

// 187 minutes for 24 pallets is what the estimate showed, so this is the cycle
// time behind it: the fixture is derived from the defect, not invented.
const CYCLE_SEC = (187 * 60) / 24;

describe('a step is timed by what passes through it', () => {
  const exactPallets = convertUnits(1500, 'CARTON', 'PALLET', SKU);
  const issuedPallets = Math.ceil(exactPallets);

  it('agrees with the plant that 1500 cartons is 23.08 pallets', () => {
    expect(exactPallets).toBeCloseTo(1500 / 65, 6);
    expect(issuedPallets).toBe(24);
  });

  it('quotes 180 minutes, not 187', () => {
    expect(stepDurationMins(exactPallets, CYCLE_SEC)).toBe(180);
    // What it used to do, kept visible so the defect cannot come back unseen.
    expect(stepDurationMins(issuedPallets, CYCLE_SEC)).toBe(187);
  });

  it('changes nothing when the division comes out whole', () => {
    // 1300 cartons is exactly 20 pallets: ceiling and exact agree, and the
    // estimate must not move for orders that were never affected.
    const whole = convertUnits(1300, 'CARTON', 'PALLET', SKU);
    expect(whole).toBe(20);
    expect(stepDurationMins(whole, CYCLE_SEC)).toBe(stepDurationMins(Math.ceil(whole), CYCLE_SEC));
  });

  it('is unaffected on a step whose unit does not coarsen', () => {
    // Filling runs PIECE -> INNER at 1:1 here; there is no rounding to leak.
    const inners = convertUnits(9000, 'PIECE', 'INNER', SKU);
    expect(inners).toBe(9000);
    expect(stepDurationMins(inners, 1.2)).toBe(180);
  });

  it('adds setup time on top of the work content', () => {
    // Setup is per-run, not per-unit, so it is added whole and not scaled.
    expect(stepDurationMins(exactPallets, CYCLE_SEC, 15)).toBe(195);
  });

  it('returns null when the step has no cycle time, rather than zero', () => {
    // Zero would read as "instant" on a Gantt. The caller has a fallback for
    // null and none for a lie.
    expect(stepDurationMins(100, null)).toBeNull();
    expect(stepDurationMins(100, undefined)).toBeNull();
    expect(stepDurationMins(100, NaN)).toBeNull();
  });

  it('never returns a negative duration', () => {
    expect(stepDurationMins(-5, CYCLE_SEC)).toBe(0);
    expect(stepDurationMins(NaN, CYCLE_SEC)).toBe(0);
  });

  it('still counts a run shorter than one whole output unit', () => {
    // 30 cartons is less than half a pallet. The palletiser still runs, and a
    // floor at one pallet would overstate it just as the ceiling did.
    const part = convertUnits(30, 'CARTON', 'PALLET', SKU);
    expect(part).toBeLessThan(1);
    expect(stepDurationMins(part, CYCLE_SEC)).toBe(4);
  });
});
