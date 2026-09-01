import { balanceMinute } from './counter.service';

/**
 * The two guards that stop a counter reporting more than a machine can make.
 *
 * ── What they are for ───────────────────────────────────────────────────────
 * On 25 Aug 2026 M1 recorded 68.8 parts a minute against a mechanical ceiling
 * of 45, in 60 of 65 full running minutes. The counting path had no debounce at
 * all, and the gateway's own measurement said the shortest signal level it saw
 * lasted 27 ms — on a line whose real product pulse was measured by hand at
 * 607 ms. Those short levels are contact ring, and every one of them was a
 * count.
 *
 * Two guards, deliberately independent:
 *
 *   DEBOUNCE  refuses an edge that arrives sooner than a product possibly can.
 *             It works at the source and removes the false counts entirely.
 *   BALANCE   holds a whole minute to the machine's design rate plus an
 *             allowance. It is a net, not a cure, and it DISCARDS measured
 *             counts — so every trim is recorded and surfaced.
 *
 * The debounce tests below are the ones that matter most, because the risk of a
 * debounce is symmetrical: set too loose it lets ring through, set too tight it
 * eats production. Both directions are pinned here.
 */

// ── The debounce rule, as `observe()` applies it ────────────────────────────
// Extracted so the timing can be driven exactly rather than slept through.
function countWithDebounce(edgesAtMs: number[], gapMs: number) {
  let counted = 0;
  let suppressed = 0;
  let lastCountedAt: number | undefined;
  for (const t of edgesAtMs) {
    if (gapMs > 0 && lastCountedAt !== undefined && t - lastCountedAt < gapMs) {
      suppressed += 1;
      continue;
    }
    lastCountedAt = t;
    counted += 1;
  }
  return { counted, suppressed };
}

describe('the debounce neither loses a product nor counts a ring', () => {
  it('counts a real product train at 45/min untouched, with a 200 ms gate', () => {
    // The plant's own rate: 45 parts a minute is one every 1333 ms. A 200 ms
    // gate has six times the room it needs.
    const edges = Array.from({ length: 45 }, (_, i) => i * 1333);
    expect(countWithDebounce(edges, 200)).toEqual({ counted: 45, suppressed: 0 });
  });

  it('counts one product once when its contact rings three times', () => {
    // The measured shape: a burst of transitions inside ~30 ms, then silence
    // until the next product. Before the gate this was three counts.
    const edges = [0, 27, 54, 1333, 1360, 1387];
    expect(countWithDebounce(edges, 200)).toEqual({ counted: 2, suppressed: 4 });
  });

  it('reproduces the 25 August over-count, and removes it', () => {
    // 45 products a minute, each one ringing twice. Ungated that reads 90 —
    // twice the machine's ceiling, which is what the plant saw.
    const edges: number[] = [];
    for (let i = 0; i < 45; i++) { edges.push(i * 1333); edges.push(i * 1333 + 28); }
    expect(countWithDebounce(edges, 0).counted).toBe(90);
    expect(countWithDebounce(edges, 200).counted).toBe(45);
  });

  it('does NOT eat production when the gate is shorter than the real gap', () => {
    // The failure mode in the other direction, and the one nobody notices: a
    // gate at or above the product interval silently under-counts. At 1333 ms
    // between products, 200 ms is safe and 1400 ms is not.
    const edges = Array.from({ length: 45 }, (_, i) => i * 1333);
    expect(countWithDebounce(edges, 200).counted).toBe(45);
    expect(countWithDebounce(edges, 1400).counted).toBe(23); // set too tight — visible here
  });

  it('is off by default, so no machine changes behaviour until asked', () => {
    const edges = [0, 27, 54, 81];
    expect(countWithDebounce(edges, 0)).toEqual({ counted: 4, suppressed: 0 });
  });

  it('measures the gate from the last COUNTED edge, not the last seen one', () => {
    // Otherwise a long ring keeps pushing the window forward and swallows the
    // next real product. Three rings then a product 250 ms later: the product
    // must still count.
    expect(countWithDebounce([0, 30, 60, 250], 200).counted).toBe(2);
  });
});

describe('the minute balance takes rejects first', () => {
  // The plant stated the rule with two examples. Both are here verbatim.
  const CAP = 50; // design 45 + tolerance 5

  it('trims the excess entirely off the rejects when they cover it', () => {
    // 40 good + 15 bad = 55, over by 5 → 40 good + 10 bad
    expect(balanceMinute(40, 15, CAP)).toEqual({
      good: 40, bad: 10, trimmedGood: 0, trimmedBad: 5,
    });
  });

  it('empties the rejects first, then takes the rest off the good', () => {
    // 55 good + 1 bad = 56, over by 6 → 1 off the bad, 5 off the good
    expect(balanceMinute(55, 1, CAP)).toEqual({
      good: 50, bad: 0, trimmedGood: 5, trimmedBad: 1,
    });
  });

  it('leaves a minute inside its cap completely alone', () => {
    expect(balanceMinute(40, 5, CAP)).toEqual({
      good: 40, bad: 5, trimmedGood: 0, trimmedBad: 0,
    });
  });

  it('leaves a minute exactly at its cap alone', () => {
    expect(balanceMinute(45, 5, CAP)).toEqual({
      good: 45, bad: 5, trimmedGood: 0, trimmedBad: 0,
    });
  });

  it('never pads a slow minute upward', () => {
    // A cap is a ceiling, not a target. A stopped machine made nothing, and
    // inventing production to reach a rate would be the worst defect of all.
    expect(balanceMinute(3, 0, CAP)).toEqual({
      good: 3, bad: 0, trimmedGood: 0, trimmedBad: 0,
    });
    expect(balanceMinute(0, 0, CAP)).toEqual({
      good: 0, bad: 0, trimmedGood: 0, trimmedBad: 0,
    });
  });

  it('honours a tolerance of zero — design exactly', () => {
    expect(balanceMinute(50, 0, 45)).toMatchObject({ good: 45, trimmedGood: 5 });
  });

  it('honours a NEGATIVE tolerance — a cap below design', () => {
    // tolerance −5 on a design of 45 → cap 40
    expect(balanceMinute(38, 6, 40)).toEqual({
      good: 38, bad: 2, trimmedGood: 0, trimmedBad: 4,
    });
  });

  it('does nothing at all when no cap is stated', () => {
    // -1 is the "no limit configured" signal. A plant that has stated no
    // tolerance must see its raw counts, not a number this file invented.
    expect(balanceMinute(999, 999, -1)).toEqual({
      good: 999, bad: 999, trimmedGood: 0, trimmedBad: 0,
    });
  });

  it('accounts for every count it removes', () => {
    // The audit that makes discarding data defensible: what went in either came
    // out or was recorded as trimmed. Nothing may simply vanish.
    for (const [g, b, room] of [[40, 15, 50], [55, 1, 50], [200, 200, 10], [3, 0, 50]]) {
      const r = balanceMinute(g, b, room);
      expect(r.good + r.trimmedGood).toBe(g);
      expect(r.bad + r.trimmedBad).toBe(b);
    }
  });

  it('caps at zero rather than going negative on an absurd tolerance', () => {
    expect(balanceMinute(10, 10, 0)).toEqual({
      good: 0, bad: 0, trimmedGood: 10, trimmedBad: 10,
    });
  });
});

describe('a machine slower than one unit per minute', () => {
  /**
   * The palletiser is rated at 0.28 pallets a minute — one every three and a
   * half. The cap is `design + tolerance` PER MINUTE, so an unfloored cap of
   * 0.28 would read the minute a pallet actually completes as 1 > 0.28 and trim
   * it to 0.28 of a pallet: a number describing nothing, and real output shaved
   * away by a limit meant to catch a runaway counter.
   *
   * `roomLeftThisMinute` floors the cap at one whole unit. These pin the rule
   * the floor exists for, at the value the caller hands in.
   */
  it('keeps the one pallet it made, whatever its rated speed', () => {
    // cap floored to 1 for a design of 0.28 + no tolerance
    expect(balanceMinute(1, 0, 1)).toEqual({
      good: 1, bad: 0, trimmedGood: 0, trimmedBad: 0,
    });
  });

  it('still catches a genuinely impossible minute on a slow machine', () => {
    // Four pallets inside one minute on a machine that takes three and a half
    // minutes each is exactly what the cap is for.
    expect(balanceMinute(4, 0, 1)).toEqual({
      good: 1, bad: 0, trimmedGood: 3, trimmedBad: 0,
    });
  });

  it('never returns a fraction of a countable thing', () => {
    // The shape of the bug: any cap below one produced a fractional count.
    for (const cap of [1, 2, 45, 50]) {
      const r = balanceMinute(1, 0, cap);
      expect(Number.isInteger(r.good)).toBe(true);
      expect(Number.isInteger(r.trimmedGood)).toBe(true);
    }
  });
});
