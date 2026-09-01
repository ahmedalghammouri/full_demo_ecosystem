import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ScopeType = 'FACTORY' | 'AREA' | 'LINE' | 'MACHINE';

export interface ScopeSelection {
  type: ScopeType;
  id: string;
  name: string;
  code?: string | null;
}

interface ScopeState {
  /** Selected hierarchy node; null = whole factory (no filter). */
  scope: ScopeSelection | null;
  setScope: (scope: ScopeSelection | null) => void;
  /** Secondary scope panel collapsed state (persisted). */
  collapsed: boolean;
  toggleCollapsed: () => void;
}

/**
 * Global analysis scope (Factory→Area→Line→Machine). Shared by every dashboard /
 * KPI / OEE / report page via the ScopePanel + useScope hook. Persisted so the
 * selection follows the user across pages.
 */
export const useScopeStore = create<ScopeState>()(
  persist(
    (set) => ({
      scope: null,
      setScope: (scope) => set({ scope }),
      collapsed: false,
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
    }),
    { name: 'mes-analysis-scope' },
  ),
);
