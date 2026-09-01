import { totalizerDelta, totalizerWidth } from '@i360/industrial-drivers';

/**
 * Counting from a register the device accumulates.
 *
 * ── Why this mode exists ────────────────────────────────────────────────────
 * Edge counting can only see a pulse the gateway happens to sample while it is
 * present. On SDPF's packing line the gateway measured that pulse at ONE SAMPLE
 * or less — 27-32 ms against a Modbus round-trip of the same size — which means
 * a share of every batch is invisible at any software setting. Reading a total
 * the module keeps in hardware removes the dependency on when we looked.
 *
 * The arithmetic is small and the two ways it goes wrong are both about a total
 * that goes DOWN, so they are pinned here.
 */
describe('totalizer counting', () => {
  const W16 = totalizerWidth(1);
  const W32 = totalizerWidth(2);

  it('counts the difference between readings, however far apart', () => {
    // The whole point: the gap between two reads does not change the answer.
    expect(totalizerDelta(100, 101, W16)).toBe(1);
    expect(totalizerDelta(100, 144, W16)).toBe(44);
    expect(totalizerDelta(100, 100, W16)).toBe(0);
  });

  it('never counts the first reading', () => {
    // No previous total means no difference to take — only a baseline. This is
    // what makes a gateway restart safe.
    expect(totalizerDelta(null, 5_000, W16)).toBe(0);
    expect(totalizerDelta(undefined, 5_000, W16)).toBe(0);
  });

  it('carries a register that wraps past its width', () => {
    // 16-bit register rolling over: 65530 → 3 is six units, not a loss.
    expect(totalizerDelta(65_530, 3, W16)).toBe(9);
    expect(totalizerDelta(0xFFFF_FFF0, 5, W32)).toBe(21);
  });

  it('counts nothing when the device restarts', () => {
    // A reset looks like a wrap, and reading it as one would invent tens of
    // thousands of cartons. Told apart by size: a wrap leaves a small
    // remainder, a reset leaves nearly the whole register.
    expect(totalizerDelta(5_000, 0, W16)).toBe(0);
    expect(totalizerDelta(40_000, 12, W16)).toBe(0);
    expect(totalizerDelta(3_000_000, 0, W32)).toBe(0);
  });

  it('takes its wrap point from the tag width, not a guess', () => {
    expect(totalizerWidth(1)).toBe(0x1_0000);
    expect(totalizerWidth(null)).toBe(0x1_0000);
    expect(totalizerWidth(2)).toBe(0x1_0000_0000);

    // The same pair of readings means different things at different widths: a
    // wrap in a 16-bit register is a reset in a 32-bit one.
    expect(totalizerDelta(65_530, 3, W16)).toBe(9);
    expect(totalizerDelta(65_530, 3, W32)).toBe(0);
  });

  it('ignores a non-numeric reading rather than counting garbage', () => {
    expect(totalizerDelta(true as any, 5, W16)).toBe(0);
    expect(totalizerDelta(5, null, W16)).toBe(0);
    expect(totalizerDelta(5, NaN, W16)).toBe(0);
  });
});
