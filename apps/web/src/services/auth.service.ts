import { api } from './api.client';
import type { User } from '@/store/auth-store';

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface FactoryInfo {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  color: string;
  glowColor: string;
  isActive: boolean;
  /** Classification and capability list — what the navigation gates on. */
  metadata?: {
    type?: string;
    typeName?: string;
    typeNameAr?: string;
    capabilities?: string[];
    [k: string]: unknown;
  } | null;
}

/**
 * A landing KPI is nullable, and that is the point.
 *
 * `null` means the factory reported nothing in the window -- no scheduled time,
 * so no availability, so no OEE. It is NOT zero. The endpoint used to read a
 * table that has never held a row and coerce the resulting null to 0, which put
 * "Overall OEE 0.0%" on the login screen of a plant that had just run a full
 * order. Every consumer must render null as an em-dash, never as a number.
 *
 * The counts below stay plain numbers: a headcount or an alarm tally of zero is
 * a real, measured zero.
 */
export interface FactoryLiveKpis {
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  uptime: number | null;
  /** Today's good output at the final routing step, in base units. */
  production: number | null;
  employees: number;
  activeAlarms: number;
  shiftsToday: number;
}

export interface FactoryOverviewItem extends FactoryInfo {
  kpis: FactoryLiveKpis;
}

export interface FactoriesOverview {
  factories: FactoryOverviewItem[];
  /** Rolling window the OEE and quality figures describe, in days. */
  windowDays: number;
  summary: {
    avgOEE: number | null;
    avgQuality: number | null;
    totalFactories: number;
    totalEmployees: number;
    totalActiveAlarms: number;
  };
}

export const authService = {
  // Factory selector — load all active factories from the backend
  getFactories: () => api.get<FactoryInfo[]>('/auth/factories'),

  // Landing page — factories enriched with live KPIs + network summary
  getFactoriesOverview: () => api.get<FactoriesOverview>('/auth/factories/overview'),

  // Factory-scoped login: pass factoryCode so JWT gets the right factoryId
  login: (email: string, password: string, factoryCode?: string) =>
    api.post<LoginResponse>('/auth/login', { email, password, factoryCode }),

  logout: () => api.post('/auth/logout').catch(() => {}),

  refreshToken: (refreshToken: string) =>
    api.post<LoginResponse & { user: User }>('/auth/refresh', { refreshToken }),

  getProfile: () => api.get<User>('/auth/me'),

  forgotPassword: (email: string) =>
    api.post('/auth/forgot-password', { email }),

  resetPassword: (token: string, password: string) =>
    api.post('/auth/reset-password', { token, password }),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.patch('/auth/change-password', { currentPassword, newPassword }),
};
