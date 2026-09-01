'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth-store';
import { authService } from '@/services/auth.service';

const isPublicRoute = (pathname: string) =>
  pathname === '/' ||
  pathname.startsWith('/login') ||
  pathname.startsWith('/forgot-password') ||
  pathname.startsWith('/reset-password');

// The tablet Operation Hub — the ONLY surface hub-locked roles (no platform:access)
// may reach. Everything else on the desktop platform redirects them back here.
const HUB_ROUTE = '/operation-hub';
const isHubRoute = (pathname: string) => pathname.startsWith(HUB_ROUTE);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated, accessToken, refreshToken, setAuth, setUser, logout, hasPermission } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();
  const refreshAttempted = useRef(false);
  const profileSynced = useRef(false);

  // Self-heal sessions created before RBAC shipped: their persisted user has no
  // `permissions` array. Re-fetch the profile ONCE so gating has real data —
  // without this, a stale manager/admin would be wrongly hub-locked on load.
  useEffect(() => {
    if (!isAuthenticated || !user || profileSynced.current) return;
    if (Array.isArray(user.permissions)) { profileSynced.current = true; return; }
    profileSynced.current = true;
    authService.getProfile().then((u) => u && setUser(u)).catch(() => {});
  }, [isAuthenticated, user, setUser]);

  // Wait for Zustand persist to finish hydrating from localStorage before
  // running the route guard. Without this, opening a new tab briefly sees
  // isAuthenticated=false (pre-hydration default), triggers a redirect to /,
  // and the / guard then bounces to /dashboard.
  // NOTE: useState initializer runs on the server (SSR) where localStorage /
  // persist API don't exist — keep it false and check inside useEffect only.
  const [storeHydrated, setStoreHydrated] = useState(false);
  useEffect(() => {
    const p = useAuthStore.persist;
    if (!p) { setStoreHydrated(true); return; }
    if (p.hasHydrated()) { setStoreHydrated(true); return; }
    const unsub = p.onFinishHydration(() => setStoreHydrated(true));
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!storeHydrated) return;

    const isPublic = isPublicRoute(pathname);

    // Hard lock: a signed-in user without desktop-platform access may only be in
    // the Operation Hub. Applies both when landing on a public route after login
    // and when trying to deep-link into any platform page by URL. Only decided once
    // the permission set is actually known (Array present) — otherwise we'd bounce
    // a still-loading session before the self-heal fetch above populates it.
    const permsKnown = user?.role === 'SUPER_ADMIN' || Array.isArray(user?.permissions);
    const hubLocked = isAuthenticated && permsKnown && !hasPermission('platform:access');

    if (isAuthenticated && isPublic) {
      refreshAttempted.current = false;
      if (hubLocked) { router.replace(HUB_ROUTE); return; }
      // Send other public routes (e.g. /login) to root; let RootPage itself resolve
      // the landing (factory default plant live view, else /apps) — avoids a bounce.
      if (pathname !== '/') router.replace('/');
      return;
    }

    if (hubLocked && !isHubRoute(pathname)) {
      router.replace(HUB_ROUTE);
      return;
    }

    if (!isAuthenticated && !isPublic) {
      if (!refreshAttempted.current && refreshToken) {
        refreshAttempted.current = true;
        authService
          .refreshToken(refreshToken)
          .then((data) => {
            if (data) {
              setAuth(data.user, data.accessToken, data.refreshToken);
            } else {
              router.replace('/');
            }
          })
          .catch(() => {
            router.replace('/');
          });
      } else {
        router.replace('/');
      }
    }
  }, [isAuthenticated, pathname, router, setAuth, logout, refreshToken, storeHydrated, hasPermission, user]);

  useEffect(() => {
    if (!accessToken || !refreshToken) return;

    const decoded = parseJwt(accessToken);
    if (!decoded) return;

    const expiresAt = decoded.exp * 1000;
    const refreshAt = expiresAt - 60 * 1000;
    const delay = refreshAt - Date.now();

    if (delay <= 0) return;

    const timer = setTimeout(() => {
      authService
        .refreshToken(refreshToken)
        .then((data) => {
          if (data) setAuth(data.user, data.accessToken, data.refreshToken);
          else {
            logout();
            router.replace('/');
          }
        })
        .catch(() => {
          logout();
          router.replace('/');
        });
    }, delay);

    return () => clearTimeout(timer);
  }, [accessToken, refreshToken, setAuth, logout]);

  return <>{children}</>;
}

function parseJwt(token: string): { exp: number } | null {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(window.atob(base64));
  } catch {
    return null;
  }
}
