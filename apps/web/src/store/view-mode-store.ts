'use client';

import { create } from 'zustand';

/**
 * Which half of a page the reader is on: "now" or "over a period".
 *
 * ── Why this is global state and not a local tab ────────────────────────────
 * The time filter does not live on the page. It lives in the left filter panel,
 * beside the scope tree, and it is shared by everything. So a page cannot hide it
 * on its own — it has to say which mode it is in and let the panel respond.
 *
 * That is the whole point: on a live tab the period control is not merely unused,
 * it is *wrong*, because the window is the shift that is running and the browser
 * has no say in it. Leaving a period selector visible there invites a reader to
 * change it and then wonder why nothing moved — which is the confusion the whole
 * live/analytics split exists to end.
 *
 * Pages that are entirely one or the other set the mode on mount. Pages with both
 * halves set it when the tab changes.
 */
export type ViewMode = 'live' | 'analytics';

interface ViewModeState {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
}

export const useViewModeStore = create<ViewModeState>((set) => ({
  // Analytics is the safe default: a page that forgets to declare itself still
  // gets the full filter set, which is confusing at worst. The reverse — a
  // historical page with no period control — would be broken.
  mode: 'analytics',
  setMode: (mode) => set({ mode }),
}));
