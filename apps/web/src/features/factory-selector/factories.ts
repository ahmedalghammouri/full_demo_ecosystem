/**
 * Factory-selector types. All factory data (branding, coordinates and KPIs)
 * comes live from `GET /auth/factories/overview` — there is no static list.
 */

export interface Factory {
  id: string;
  code: string;
  name: string;
  nameAr: string;
  city: string;
  cityAr?: string;
  district?: string;
  districtAr?: string;
  /** Real-world WGS84 coordinates */
  lat: number;
  lng: number;
  color: string;
  glowColor: string;
  isActive?: boolean;
  kpis: FactoryKPI;
}

/**
 * Nullable wherever the figure is a MEASUREMENT, plain where it is a COUNT.
 *
 * Null means nothing was measured in the window -- no scheduled time, so no
 * availability and therefore no OEE. It is not zero, and no consumer may render
 * it as one: `0.0%` on a landing tile reads as "this factory produced nothing",
 * which is what the login page told every visitor until this was fixed.
 *
 * Kept in step with `FactoryLiveKpis` in services/auth.service.ts, which is the
 * shape the endpoint actually returns.
 */
export interface FactoryKPI {
  oee: number | null;
  production: number | null;
  productionUnit?: string;
  quality: number | null;
  availability: number | null;
  performance: number | null;
  /** Counts, not measurements: zero here is a real zero. */
  activeAlarms: number;
  employees: number;
  shiftsToday: number;
  uptime: number | null;
}
