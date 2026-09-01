import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface SidebarStore {
  isCollapsed: boolean;
  toggle: () => void;
  collapse: () => void;
  expand: () => void;
}

export const useSidebarStore = create<SidebarStore>()(
  persist(
    immer((set) => ({
      isCollapsed: false,
      toggle: () => set((s) => { s.isCollapsed = !s.isCollapsed; }),
      collapse: () => set((s) => { s.isCollapsed = true; }),
      expand: () => set((s) => { s.isCollapsed = false; }),
    })),
    { name: 'industry360-sidebar' },
  ),
);

interface UIStore {
  globalLoading: boolean;
  setGlobalLoading: (v: boolean) => void;

  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (v: boolean) => void;

  activeModal: string | null;
  openModal: (id: string) => void;
  closeModal: () => void;

  selectedSiteId: string | null;
  setSelectedSiteId: (id: string | null) => void;

  selectedShiftId: string | null;
  setSelectedShiftId: (id: string | null) => void;

  dateRange: { from: Date | null; to: Date | null };
  setDateRange: (range: { from: Date | null; to: Date | null }) => void;
}

export const useUIStore = create<UIStore>()(
  immer((set) => ({
    globalLoading: false,
    setGlobalLoading: (v) => set((s) => { s.globalLoading = v; }),

    commandPaletteOpen: false,
    setCommandPaletteOpen: (v) => set((s) => { s.commandPaletteOpen = v; }),

    activeModal: null,
    openModal: (id) => set((s) => { s.activeModal = id; }),
    closeModal: () => set((s) => { s.activeModal = null; }),

    selectedSiteId: null,
    setSelectedSiteId: (id) => set((s) => { s.selectedSiteId = id; }),

    selectedShiftId: null,
    setSelectedShiftId: (id) => set((s) => { s.selectedShiftId = id; }),

    dateRange: { from: null, to: null },
    setDateRange: (range) => set((s) => { s.dateRange = range; }),
  })),
);
