import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

export interface User {
  id: string;
  name: string;
  nameAr?: string;
  email: string;
  role: string;
  // Live permission-key set for the user's role (resolved server-side). Drives
  // nav/route gating. `platform:access` gates the desktop platform; its absence
  // hard-locks the user (OPERATOR / MAINTENANCE_TECHNICIAN) to the Operation Hub.
  permissions?: string[];
  enterpriseId: string;
  factoryId: string | null;
  factoryCode: string | null;
  department?: string;
  jobTitle?: string;
  phone?: string;
  avatarUrl?: string;
  mfaEnabled?: boolean;
  language: 'en' | 'ar';
  timezone: string;
  // Factory embedded in user profile response
  factory?: {
    id: string;
    code: string;
    name: string;
    nameAr?: string;
    city?: string;
    color: string;
    glowColor: string;
    /**
     * Classification and capability list, as written by the seeder.
     *
     * The navigation gates on this. It was absent here, so the login path built
     * a factory object without it and every specialised screen was offered at
     * every site — including the ones the API then refused.
     */
    metadata?: {
      type?: string;
      typeName?: string;
      typeNameAr?: string;
      capabilities?: string[];
      [k: string]: unknown;
    } | null;
    lat?: number;
    lng?: number;
  } | null;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthActions {
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  hasRole: (role: string | string[]) => boolean;
  hasPermission: (permission: string | string[]) => boolean;
  isSuperAdmin: () => boolean;
  canAccessFactory: (factoryId: string) => boolean;
}

export const useAuthStore = create<AuthState & AuthActions>()(
  persist(
    immer((set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: false,

      setAuth: (user, accessToken, refreshToken) => {
        set((state) => {
          state.user = user;
          state.accessToken = accessToken;
          state.refreshToken = refreshToken;
          state.isAuthenticated = true;
        });
      },

      setUser: (user) => {
        set((state) => { state.user = user; });
      },

      setTokens: (accessToken, refreshToken) => {
        set((state) => {
          state.accessToken = accessToken;
          state.refreshToken = refreshToken;
        });
      },

      logout: () => {
        set((state) => {
          state.user = null;
          state.accessToken = null;
          state.refreshToken = null;
          state.isAuthenticated = false;
        });
      },

      setLoading: (loading) => {
        set((state) => { state.isLoading = loading; });
      },

      hasRole: (role: string | string[]) => {
        const { user } = get();
        if (!user) return false;
        const roles = Array.isArray(role) ? role : [role];
        return roles.includes(user.role);
      },

      // SUPER_ADMIN implicitly holds every permission (matches the backend guard).
      // For an array, ANY match grants (OR semantics) — nav items list alternatives.
      hasPermission: (permission: string | string[]) => {
        const { user } = get();
        if (!user) return false;
        if (user.role === 'SUPER_ADMIN') return true;
        const needed = Array.isArray(permission) ? permission : [permission];
        if (needed.length === 0) return true;
        const held = user.permissions ?? [];
        return needed.some((p) => held.includes(p));
      },

      isSuperAdmin: () => {
        return get().user?.role === 'SUPER_ADMIN';
      },

      canAccessFactory: (factoryId: string) => {
        const { user } = get();
        if (!user) return false;
        if (user.role === 'SUPER_ADMIN') return true;
        return user.factoryId === factoryId;
      },
    })),
    {
      name: 'industry360-auth',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
      }),
    },
  ),
);
