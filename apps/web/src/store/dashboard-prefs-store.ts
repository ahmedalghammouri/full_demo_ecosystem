import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TrendType = 'area' | 'line' | 'bar';

interface DashboardPrefsState {
  /** Render style for every time-series chart across the app. */
  trendType: TrendType;
  setTrendType: (t: TrendType) => void;
  /**
   * Show the STANDARD basis (OEE-TB) rather than the SCHEDULE basis (OEE).
   *
   * Defaults to true, and that default is a deliberate choice rather than an
   * accident. The schedule basis divides by the slot each order was COMMITTED
   * to, including the part of it the order has not reached yet — so mid-morning
   * it reads a few per cent and climbs all day. That is a progress figure, and
   * correct, but it is not what a headline card should open on: a manager
   * glancing at 1.6% reads a broken line, not a shift that is four per cent
   * through its committed slot.
   *
   * The standard basis is complete at every instant, which is what a card that
   * carries no explanation needs. The toggle reaches the schedule basis, and now
   * genuinely does — until this was fixed both positions showed the same number.
   */
  atOee: boolean;
  setAtOee: (v: boolean) => void;
}

/**
 * Global dashboard view preferences, driven from the unified ScopePanel and read
 * by every chart/cockpit. Persisted so the chosen trend style + OEE mode follow
 * the user across pages — the single source for what used to be per-page toolbars.
 */
export const useDashboardPrefsStore = create<DashboardPrefsState>()(
  persist(
    (set) => ({
      trendType: 'area',
      setTrendType: (trendType) => set({ trendType }),
      atOee: true,
      setAtOee: (atOee) => set({ atOee }),
    }),
    {
      name: 'mes-dashboard-prefs',
      /**
       * v1 — the OEE basis default moved to OEE-TB.
       *
       * Without a version bump this change would reach nobody who has already
       * opened the app: the persisted `false` wins over the new default. And
       * that stored `false` was never a preference anybody expressed — it was
       * the old default, on a toggle whose two positions returned the same
       * number, so there was nothing to express. Anyone who genuinely wants the
       * schedule basis flips it once and that choice persists from here.
       */
      version: 1,
      migrate: (persisted: unknown, from: number) => {
        const state = (persisted ?? {}) as Partial<DashboardPrefsState>;
        return from < 1 ? { ...state, atOee: true } : state;
      },
    },
  ),
);
