import axios, { type AxiosInstance, type AxiosRequestConfig, type AxiosResponse } from 'axios';

import { useAuthStore } from '@/store/auth-store';

// Resolve the API base so it works from ANY device on the LAN (desktop + phone).
// The app is served behind nginx (which proxies /api/ to the backend), so in the
// browser we always call SAME-ORIGIN — requests go to whatever host:port served
// the page (e.g. http://10.94.130.16:8080), never a hard-coded localhost that
// would resolve to the visitor's own device. An explicit non-localhost
// NEXT_PUBLIC_API_URL (a real domain) still wins; SSR falls back to the env/port.
function resolveApiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_URL;
  if (env && !/localhost|127\.0\.0\.1/i.test(env)) return env; // real external domain
  if (typeof window !== 'undefined') return '';                // browser → same-origin
  return env || 'http://localhost:3001';                       // SSR / build fallback
}
const API_URL = resolveApiBase();
const API_VERSION = '/api/v1';

export const apiClient: AxiosInstance = axios.create({
  baseURL: `${API_URL}${API_VERSION}`,
  timeout: 30_000,
  headers: {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  },
});

/** The persisted session, read straight from storage. */
const PERSISTED_AUTH_KEY = 'industry360-auth';

/**
 * The access token, from the store if it is ready and from storage if it is not.
 *
 * The store is the normal source. But `persist` rehydrates AFTER the first
 * render, and several widgets fire their queries on mount — the notification
 * badge, the hierarchy tree, the alarm counters and every analytics page. On a
 * DIRECT page load (typing the URL, a bookmark, F5) those requests went out
 * with no Authorization header, came back 401, and the reader was left with
 * screens that never resolved even though a perfectly valid session was sitting
 * in localStorage the whole time.
 *
 * Reading storage as a fallback closes that window. It is a fallback and not the
 * primary source on purpose: once hydrated, the store is authoritative, and a
 * token refreshed in memory must not be shadowed by a stale copy on disk.
 */
function currentAccessToken(): string | null {
  const fromStore = useAuthStore.getState().accessToken;
  if (fromStore) return fromStore;
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(PERSISTED_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { accessToken?: string } };
    return parsed?.state?.accessToken ?? null;
  } catch {
    // Corrupt or unreadable storage is not a reason to fail the request; it
    // simply means we have nothing better than the empty store.
    return null;
  }
}

/** The persisted refresh token, for the same pre-hydration window. */
function persistedRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PERSISTED_AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { state?: { refreshToken?: string } };
    return parsed?.state?.refreshToken ?? null;
  } catch {
    return null;
  }
}

// Request interceptor — inject auth token
apiClient.interceptors.request.use(
  (config) => {
    const accessToken = currentAccessToken();
    if (accessToken) {
      config.headers.Authorization = `Bearer ${accessToken}`;
    }
    return config;
  },
  (error) => Promise.reject(error),
);

// Response interceptor — unwrap envelope + handle 401 + token refresh
apiClient.interceptors.response.use(
  (response: AxiosResponse) => {
    // Unwrap standard API envelope: { success, data, timestamp } → data
    if (response.data && typeof response.data === 'object' && 'success' in response.data && 'data' in response.data) {
      response.data = response.data.data;
    }
    return response;
  },
  async (error) => {
    const originalRequest = error.config as AxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      const { setTokens, logout } = useAuthStore.getState();
      // Same fallback as the request side: a 401 that arrives before the store
      // has rehydrated would otherwise find no refresh token, log the user out,
      // and discard a session that was valid all along.
      const refreshToken = useAuthStore.getState().refreshToken ?? persistedRefreshToken();

      if (refreshToken) {
        try {
          const response = await axios.post<{ success: boolean; data: { accessToken: string; refreshToken: string } }>(
            `${API_URL}${API_VERSION}/auth/refresh`,
            { refreshToken },
          );
          const { accessToken: newAccess, refreshToken: newRefresh } = response.data.data ?? response.data;
          setTokens(newAccess, newRefresh);
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newAccess}`;
          }
          return apiClient(originalRequest);
        } catch {
          logout();
        }
      } else {
        logout();
      }
    }

    return Promise.reject(error);
  },
);

// Generic request helpers
export const api = {
  get: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.get<T>(url, config).then((r) => r.data),

  post: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.post<T>(url, data, config).then((r) => r.data),

  put: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.put<T>(url, data, config).then((r) => r.data),

  patch: <T>(url: string, data?: unknown, config?: AxiosRequestConfig) =>
    apiClient.patch<T>(url, data, config).then((r) => r.data),

  delete: <T>(url: string, config?: AxiosRequestConfig) =>
    apiClient.delete<T>(url, config).then((r) => r.data),

  /** Multipart upload (file + fields via FormData). Lets the browser set the
   *  multipart boundary by clearing the default JSON Content-Type. */
  upload: <T>(url: string, formData: FormData, config?: AxiosRequestConfig) =>
    apiClient
      .post<T>(url, formData, {
        ...config,
        headers: { ...(config?.headers ?? {}), 'Content-Type': undefined as unknown as string },
      })
      .then((r) => r.data),

  /** Fetch a binary response (e.g. an attachment) as a Blob, with auth applied. */
  blob: (url: string, config?: AxiosRequestConfig) =>
    apiClient.get(url, { ...config, responseType: 'blob' }).then((r) => r.data as Blob),
};
