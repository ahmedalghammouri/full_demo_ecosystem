import type { EdgeType } from './types';

/** Truthy test shared by BOOL and numeric signals: numeric > 0, or boolean true. */
function isHigh(v: number | boolean | null | undefined): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  return v > 0;
}

/**
 * Pure edge detector. Returns the number of counts to add (0 or 1) given the
 * previous and current raw values.
 *
 * - RISING  (default): low→high transition  (0→1, false→true)   → +1
 * - FALLING:           high→low transition  (1→0, true→false)   → +1
 * - CHANGE:            any change in level                       → +1
 * - TOTALIZER:         a device-accumulated register — see {@link totalizerDelta}
 *
 * The first observation (prev === null/undefined) never counts — we only have a
 * baseline, not a transition. This is what makes restarts safe when the caller
 * seeds `prev` from the persisted last raw value.
 */
export function detectEdge(
  prev: number | boolean | null | undefined,
  curr: number | boolean | null | undefined,
  edgeType: EdgeType = 'RISING',
): number {
  if (prev === null || prev === undefined) return 0; // baseline only
  if (curr === null || curr === undefined) return 0;

  const prevHigh = isHigh(prev);
  const currHigh = isHigh(curr);

  switch (edgeType) {
    case 'RISING':
      return !prevHigh && currHigh ? 1 : 0;
    case 'FALLING':
      return prevHigh && !currHigh ? 1 : 0;
    case 'CHANGE':
      return prevHigh !== currHigh ? 1 : 0;
    case 'TOTALIZER':
      // The register carries the count itself; the caller supplies the width.
      return totalizerDelta(prev, curr);
    default:
      return 0;
  }
}

/**
 * Stateful wrapper around {@link detectEdge}. Holds the last observed raw value
 * (seed it from the DB on startup) and an optional debounce window that ignores
 * edges arriving faster than `debounceMs` apart (suppresses contact bounce).
 */
export class EdgeCounter {
  private last: number | boolean | null;
  private lastEdgeAt = 0;

  constructor(
    private readonly edgeType: EdgeType = 'RISING',
    private readonly debounceMs = 0,
    seed: number | boolean | null = null,
  ) {
    this.last = seed;
  }

  /** Feed a new raw value; returns counts to add (0 or 1). */
  update(curr: number | boolean | null, now: number = Date.now()): number {
    const inc = detectEdge(this.last, curr, this.edgeType);
    this.last = curr;
    if (inc === 0) return 0;
    if (this.debounceMs > 0 && now - this.lastEdgeAt < this.debounceMs) return 0;
    this.lastEdgeAt = now;
    return inc;
  }

  get lastValue(): number | boolean | null {
    return this.last;
  }
}

/** Register widths a Modbus counter is normally published in. */
const WIDTH_16 = 0x1_0000;
const WIDTH_32 = 0x1_0000_0000;

/**
 * Counts from a register the DEVICE accumulates, rather than from a level the
 * gateway has to catch in the act.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * Edge counting is bounded by how often the wire is read. On SDPF's packing
 * line the carton pulse was measured at one sample or less — 27-32 ms against a
 * Modbus round-trip of the same size — so a share of every batch was invisible
 * no matter how the gateway was tuned. A module that counts its own pulses in
 * hardware removes the question: the gateway reads a running total and takes
 * the difference, and the answer is the same whether it read a moment ago or a
 * minute ago.
 *
 * ── Wrap versus reset ───────────────────────────────────────────────────────
 * A total that goes DOWN is either a register wrapping past its width or a
 * device that restarted, and nothing in the reading says which. What separates
 * them is size: between two reads a genuine wrap has only just happened, so the
 * remainder is the handful of counts made since — while a reset leaves whatever
 * the register had climbed to.
 *
 * So a wrap is accepted only when the remainder is SMALL in absolute terms.
 * A looser rule — anything under half the register — reads 40000 → 12 as 25,548
 * cartons, which is how a heuristic invents a shift's production out of a device
 * reboot. The asymmetry decides it: re-baselining costs the few counts either
 * side of a restart, and guessing wrong costs the shift.
 *
 * ── Going UP is never capped ────────────────────────────────────────────────
 * A large forward jump is not suspicious, it is the point. If the gateway is
 * offline for an hour the module keeps counting, and the first reading back
 * recovers every unit made in between — production an edge counter would simply
 * never have seen.
 */
/** Counts plausibly made between two reads; beyond this a decrease is a reset. */
const MAX_WRAP_REMAINDER = 10_000;

export function totalizerDelta(
  prev: number | boolean | null | undefined,
  curr: number | boolean | null | undefined,
  width: number = WIDTH_32,
): number {
  if (typeof prev !== 'number' || typeof curr !== 'number') return 0;
  if (!Number.isFinite(prev) || !Number.isFinite(curr)) return 0;

  if (curr >= prev) return curr - prev;

  const wrapped = width - prev + curr;
  return wrapped > 0 && wrapped <= MAX_WRAP_REMAINDER ? wrapped : 0;
}

/** The register width implied by a tag's word count (1 word = 16 bits). */
export function totalizerWidth(wordCount: number | null | undefined): number {
  return (wordCount ?? 1) <= 1 ? WIDTH_16 : WIDTH_32;
}
