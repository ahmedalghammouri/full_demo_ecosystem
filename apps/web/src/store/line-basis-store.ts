import { create } from 'zustand';

export type LineBasis = 'bottleneck' | 'rollup';

interface LineBasisState {
  basis: LineBasis;
  setBasis: (v: LineBasis) => void;
}

/**
 * How a LINE is scored — the constraint, or the roll-up of its machines.
 *
 * ── Why this is a view control and not only a line setting ──────────────────
 * `ProductionLine.oeeMethod` is the plant's standing decision and it stays
 * authoritative for everything that is a fact about the plant: which machine is
 * the constraint, and where saleable units are counted. What this control
 * changes is only the METHOD, so an analyst can ask "what would this line look
 * like measured the other way" without editing master data that other screens
 * depend on.
 *
 * Bottleneck is the default because a line runs at the speed of its constraint;
 * the roll-up answers a different and narrower question — how the assets
 * performed — and reading it as the line's score is the misreading that made
 * this control necessary.
 */
export const useLineBasisStore = create<LineBasisState>((set) => ({
  basis: 'bottleneck',
  setBasis: (basis) => set({ basis }),
}));
