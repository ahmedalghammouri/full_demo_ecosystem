import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TimePreset = 'today' | 'shift' | 'week' | 'month' | 'custom';

interface TimeRangeState {
  preset: TimePreset;
  from: string | null; // ISO date (YYYY-MM-DD) — only used when preset === 'custom'
  to: string | null;
  setPreset: (preset: Exclude<TimePreset, 'custom'>) => void;
  setCustom: (from: string, to: string) => void;
}

/**
 * Global analysis time range, shared across every OEE / KPI / trend page (like the
 * scope). Presets map to backend `timeframe`; 'custom' sends explicit dateFrom/dateTo.
 */
export const useTimeRangeStore = create<TimeRangeState>()(
  persist(
    (set) => ({
      preset: 'today',
      from: null,
      to: null,
      setPreset: (preset) => set({ preset, from: null, to: null }),
      setCustom: (from, to) => set({ preset: 'custom', from, to }),
    }),
    { name: 'mes-time-range' },
  ),
);
