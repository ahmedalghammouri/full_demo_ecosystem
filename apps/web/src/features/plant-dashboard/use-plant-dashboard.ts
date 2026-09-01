'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api.client';

// ── Shared types ─────────────────────────────────────────────────────────────
export type EntityType = 'plant' | 'area' | 'line' | 'machine';

export interface Widget {
  id?: string;
  widgetType: string;
  title?: string;
  x: number; y: number; width: number; height: number;
  zIndex?: number; rotation?: number; locked?: boolean; visible?: boolean;
  scopeConfig?: Record<string, any>;
  dataConfig?: Record<string, any>;
  displayConfig?: Record<string, any>;
  refreshConfig?: Record<string, any>;
  thresholdConfig?: Record<string, any>;
}

export interface Dashboard {
  id: string;
  name: string;
  entityType: EntityType;
  entityId: string;
  backgroundImageUrl?: string | null;
  backgroundSettings?: Record<string, any> | null;
  canvasSettings?: Record<string, any> | null;
  status: 'draft' | 'published';
  version: number;
  widgets: Widget[];
}

export const DEFAULT_CANVAS = { width: 1920, height: 1080, grid: 10, snap: true };

// ── Queries / mutations ──────────────────────────────────────────────────────
export function useEntityDashboards(entityType: string, entityId: string) {
  return useQuery<Array<{ id: string; name: string; status: string; updatedAt: string }>>({
    queryKey: ['plant-dashboards', entityType, entityId],
    queryFn: () => api.get(`/plant-dashboards/entity/${entityType}/${entityId}`),
  });
}

export function useDashboard(id: string | null) {
  return useQuery<Dashboard>({
    queryKey: ['plant-dashboard', id],
    queryFn: () => api.get(`/plant-dashboards/${id}`),
    enabled: !!id,
  });
}

export function usePublishedDashboard(entityType: string, entityId: string) {
  return useQuery<Dashboard & { backgroundImageUrl?: string }>({
    queryKey: ['plant-dashboard-published', entityType, entityId],
    queryFn: () => api.get(`/plant-dashboards/published/${entityType}/${entityId}`),
    retry: false,
  });
}

export function useKpiCatalog() {
  return useQuery<Array<{ code: string; label: string; category: string; unit: string; decimals: number }>>({
    queryKey: ['plant-dashboard-kpi-catalog'],
    queryFn: () => api.get('/plant-dashboards/kpi-catalog'),
    staleTime: 600_000,
  });
}

export function useScopeOptions() {
  return useQuery<any[]>({
    queryKey: ['plant-dashboard-scope-options'],
    queryFn: () => api.get('/plant-dashboards/scope-options'),
    staleTime: 300_000,
  });
}

export function useDashboardMutations(id: string | null) {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['plant-dashboard', id] });
    qc.invalidateQueries({ queryKey: ['plant-dashboards'] });
  };
  return {
    create: useMutation({
      mutationFn: (body: Partial<Dashboard>) => api.post('/plant-dashboards', body),
      onSuccess: invalidate,
    }),
    save: useMutation({
      mutationFn: (body: Partial<Dashboard>) => api.put(`/plant-dashboards/${id}`, body),
      onSuccess: invalidate,
    }),
    publish: useMutation({
      mutationFn: () => api.post(`/plant-dashboards/${id}/publish`, {}),
      onSuccess: invalidate,
    }),
    uploadBackground: useMutation({
      mutationFn: (file: File) => {
        const fd = new FormData();
        fd.append('file', file);
        return api.upload(`/plant-dashboards/${id}/background`, fd);
      },
      onSuccess: invalidate,
    }),
    removeBackground: useMutation({
      mutationFn: () => api.delete(`/plant-dashboards/${id}/background`),
      onSuccess: invalidate,
    }),
  };
}

/** Batched live values for a set of card subscriptions. */
export async function fetchLiveData(subscriptions: Array<{ widgetId: string; kpiCode: string; scopeType: string; scopeId: string; timeRange?: string }>) {
  return api.post('/plant-dashboards/live-data', { subscriptions }) as Promise<{ data: any[]; at: string }>;
}

/** Pre-publish validation — per-widget error list ([] = ok). */
export async function validateDashboard(id: string) {
  return api.get(`/plant-dashboards/${id}/validate`) as Promise<Array<{ widgetId: string; message: string }>>;
}

// ── Default landing view ─────────────────────────────────────────────────────
export type DefaultView = { id: string; name: string; entityType: string; entityId: string } | null;

export function useDefaultDashboard() {
  return useQuery<DefaultView>({
    queryKey: ['plant-default-dashboard'],
    queryFn: () => api.get('/plant-dashboards/default'),
    staleTime: 60_000,
  });
}
/** Fetch the factory default landing view (used by the post-login resolver). */
export async function fetchDefaultDashboard(): Promise<DefaultView> {
  return api.get('/plant-dashboards/default').catch(() => null) as Promise<DefaultView>;
}
export async function setDefaultDashboard(id: string) { return api.post(`/plant-dashboards/${id}/default`, {}); }
export async function clearDefaultDashboard(id: string) { return api.delete(`/plant-dashboards/${id}/default`); }

// Which KPI codes each widget type needs resolved.
export function widgetKpiCodes(w: Widget): string[] {
  switch (w.widgetType) {
    case 'kpiValue': return w.dataConfig?.kpiCode ? [String(w.dataConfig.kpiCode)] : [];
    case 'multiKpi': return (w.dataConfig?.kpis ?? []).map((k: any) => k.kpiCode).filter(Boolean);
    // Both bases, because the card is the one place a reader sees them side by
    // side. OEE divides by the slot each order was COMMITTED to; OEE-TB by the
    // time that actually went by. Performance and Quality do not depend on the
    // time basis, so they are shown once.
    case 'oeeSummary':
      return ['OEE', 'AVAILABILITY', 'PERFORMANCE', 'QUALITY', 'OEE_TB', 'AVAILABILITY_TB'];
    case 'productionSummary': return ['TOTAL_PRODUCTION', 'GOOD_COUNT', 'REJECT_COUNT', 'DOWNTIME'];
    case 'equipmentStatus':
    case 'lineStatus': return ['STATE', 'OEE', 'SPEED'];
    case 'activeAlarms': return ['ALARMS'];
    case 'trendChart': return [`TREND:${w.dataConfig?.kpiCode || 'OEE'}`];
    default: return [];
  }
}

/** Turn visible widgets into a flat, deduped subscription list (one per widget×kpi). */
export function buildSubscriptions(widgets: Widget[]) {
  const subs: Array<{ widgetId: string; kpiCode: string; scopeType: string; scopeId: string; timeRange?: string }> = [];
  for (const w of widgets) {
    if (w.visible === false) continue;
    const scopeType = w.scopeConfig?.scopeType, scopeId = w.scopeConfig?.scopeId;
    if (!scopeType || !scopeId) continue;
    for (const kpiCode of widgetKpiCodes(w)) {
      subs.push({ widgetId: `${w.id}::${kpiCode}`, kpiCode, scopeType: String(scopeType), scopeId: String(scopeId), timeRange: w.scopeConfig?.timeRange });
    }
  }
  return subs;
}

/** Group flat results back per widget into { value, values{kpi:val} } + speed/oee helpers. */
export function groupLive(results: any[] | undefined): Map<string, any> {
  const map = new Map<string, any>();
  for (const r of results ?? []) {
    const [base, kpi] = String(r.widgetId).split('::');
    const cur = map.get(base) ?? { values: {} as Record<string, number> };
    if (r.error) cur.error = r.error;
    if (kpi === 'STATE' && typeof r.text === 'string') cur.state = r.text;
    if (kpi === 'ALARMS' && Array.isArray(r.alarms)) cur.alarms = r.alarms;
    if (kpi.startsWith('TREND') && Array.isArray(r.series)) cur.trend = r.series;
    if (typeof r.value === 'number') {
      cur.values[kpi] = r.value;
      cur.value = r.value; // single-KPI cards read `.value`
      if (kpi === 'SPEED') cur.speed = r.value;
      if (kpi === 'OEE') cur.oee = r.value;
    }
    cur.at = r.at;
    map.set(base, cur);
  }
  return map;
}

/**
 * Loads an authed image (background) as an object URL — a plain <img src> can't
 * carry the Bearer token, so we fetch the stream via the api client and blob it.
 */
export function useAuthedImage(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoked: string | null = null;
    let cancelled = false;
    if (!path) { setUrl(null); return; }
    api.blob(`/${path.replace(/^\//, '')}`)
      .then((blob) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setUrl(revoked);
      })
      .catch(() => setUrl(null));
    return () => { cancelled = true; if (revoked) URL.revokeObjectURL(revoked); };
  }, [path]);
  return url;
}
