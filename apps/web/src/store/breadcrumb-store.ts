import { create } from 'zustand';

interface BreadcrumbState {
  /** Friendly labels keyed by raw URL segment (e.g. a UUID → "#4 Palletizing"). */
  labels: Record<string, string>;
  setLabel: (segment: string, label: string) => void;
  clearLabel: (segment: string) => void;
}

/**
 * Dynamic breadcrumb labels. Pages on dynamic routes (e.g. /shop-floor/live/[id])
 * register a human label for their id segment so the topbar shows
 * "Shop Floor / Live Dashboard / #4 Palletizing" instead of a raw UUID.
 */
export const useBreadcrumbStore = create<BreadcrumbState>((set) => ({
  labels: {},
  setLabel: (segment, label) =>
    set((s) => (s.labels[segment] === label ? s : { labels: { ...s.labels, [segment]: label } })),
  clearLabel: (segment) =>
    set((s) => {
      if (!(segment in s.labels)) return s;
      const next = { ...s.labels };
      delete next[segment];
      return { labels: next };
    }),
}));
