import { create } from 'zustand';

interface OrderFilterState {
  /** Selected Production Order number ('' = all POs). */
  poNumber: string;
  /** Selected Work Order id ('' = all WOs). */
  woId: string;
  /** Selected product / SKU id ('' = all products). */
  skuId: string;
  /** Selected shift template id ('' = all shifts). */
  shiftTemplateId: string;
  setPoNumber: (v: string) => void;
  setWoId: (v: string) => void;
  setSkuId: (v: string) => void;
  setShiftTemplateId: (v: string) => void;
  reset: () => void;
}

/**
 * The global order / product / shift filter, driven from the ScopePanel.
 *
 * ── Why product and shift live here rather than on each page ────────────────
 * They are the same kind of question as the order filter: "which slice of the
 * plant's work am I looking at". Keeping them beside it means one control
 * surface answers the whole question, and a reader who narrows to a product on
 * one page finds the same narrowing when they move to another — rather than
 * each page carrying its own half-remembered filter bar.
 *
 * Session-scoped, not persisted: which product ran last week is rarely the
 * question this week, and a filter silently restored from a previous visit is
 * how a page comes to show "no data" for no visible reason.
 */
export const useOrderFilterStore = create<OrderFilterState>((set) => ({
  poNumber: '',
  woId: '',
  skuId: '',
  shiftTemplateId: '',
  // Changing the PO clears the WO — a work order from another production order
  // would select nothing, and an empty page with two filters set gives the
  // reader no clue which one is responsible.
  setPoNumber: (poNumber) => set({ poNumber, woId: '' }),
  setWoId: (woId) => set({ woId }),
  setSkuId: (skuId) => set({ skuId }),
  setShiftTemplateId: (shiftTemplateId) => set({ shiftTemplateId }),
  reset: () => set({ poNumber: '', woId: '', skuId: '', shiftTemplateId: '' }),
}));
