import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Matches the Factory interface from both the static data and the API response
export interface FactoryBrief {
  id: string;
  code: string;
  name: string;
  nameAr?: string | null;
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
  color: string;
  glowColor: string;
  isActive: boolean;
  /**
   * Classification and the resolved capability list, computed in the plant
   * model and written onto the factory row. The navigation reads it to decide
   * which modules this site has; see lib/nav-capabilities.ts.
   */
  metadata?: {
    type?: string;
    typeName?: string;
    typeNameAr?: string;
    capabilities?: string[];
    tagline?: string;
    taglineAr?: string;
    [k: string]: unknown;
  } | null;
}

interface FactoryState {
  selectedFactoryId: string | null;
  selectedFactory: FactoryBrief | null;
  allFactories: FactoryBrief[];
}

interface FactoryActions {
  setFactory: (factory: FactoryBrief) => void;
  setFactories: (factories: FactoryBrief[]) => void;
  clearFactory: () => void;
}

export const useFactoryStore = create<FactoryState & FactoryActions>()(
  persist(
    (set, get) => ({
      selectedFactoryId: null,
      selectedFactory: null,
      allFactories: [],

      setFactory: (factory) => {
        set({ selectedFactoryId: factory.id, selectedFactory: factory });
      },

      setFactories: (factories) => {
        set({ allFactories: factories });
      },

      clearFactory: () => set({ selectedFactoryId: null, selectedFactory: null }),
    }),
    {
      name: 'industry360-factory',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
