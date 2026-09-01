'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api.client';

// ── Types (mirror the dashboards backend) ─────────────────────────

export type DashboardSource = 'Industry360_NATIVE' | 'GRAFANA' | 'REPORT' | 'EXTERNAL' | 'TEMPLATE';
export type DashboardType =
  | 'OPERATIONAL' | 'KPI' | 'ANALYTICS' | 'REPORT' | 'EXECUTIVE'
  | 'ENERGY' | 'QUALITY' | 'MAINTENANCE' | 'PRODUCTION' | 'CUSTOM';
export type DashboardVisibility = 'PRIVATE' | 'FACTORY' | 'ENTERPRISE' | 'PUBLIC';

export interface DashboardCategory {
  id: string;
  key: string;
  name: string;
  nameAr?: string | null;
  icon?: string | null;
  color?: string | null;
  sortOrder: number;
  isSystem: boolean;
  dashboardCount: number;
}

export interface DashboardCatalogItem {
  id: string;
  title: string;
  titleAr?: string | null;
  description?: string | null;
  source: DashboardSource;
  type: DashboardType;
  visibility: DashboardVisibility;
  category?: { id: string; key: string; name: string; icon?: string | null; color?: string | null } | null;
  route?: string | null;
  externalUrl?: string | null;
  grafanaUid?: string | null;
  icon?: string | null;
  thumbnailUrl?: string | null;
  tags: string[];
  isFactoryAware: boolean;
  supportedScopes: string[];
  isTemplate: boolean;
  isSystem: boolean;
  isFavorite: boolean;
  favoriteCount: number;
  viewCount: number;
  canManage: boolean;
}

export interface EmbedContext {
  factoryId?: string | null;
  factoryCode?: string | null;
  areaId?: string | null;
  lineId?: string | null;
  machineId?: string | null;
  shiftId?: string | null;
  productId?: string | null;
  batchId?: string | null;
  from?: string | null;
  to?: string | null;
  theme?: string | null;
}

export interface EmbedResolution {
  kind: 'grafana' | 'native' | 'external' | 'template';
  embeddable: boolean;
  url?: string | null;
  route?: string | null;
  grafanaConfigured?: boolean;
  dashboard: {
    id: string;
    title: string;
    description?: string | null;
    source: DashboardSource;
    type: DashboardType;
    icon?: string | null;
    route?: string | null;
    isFactoryAware: boolean;
    supportedScopes: string[];
    defaultTimeRange?: string | null;
    refreshInterval?: string | null;
    grafanaUid?: string | null;
  };
  context: EmbedContext;
}

export interface DashboardFilters {
  search?: string;
  source?: DashboardSource;
  type?: DashboardType;
  category?: string;
  favorites?: boolean;
  templates?: boolean;
  tags?: string;
}

// ── Hooks ─────────────────────────────────────────────────────────

export function useDashboardCategories() {
  return useQuery({
    queryKey: ['dashboard-center', 'categories'],
    queryFn: () => api.get<DashboardCategory[]>('/dashboards/categories'),
    staleTime: 60_000,
  });
}

export function useDashboards(filters: DashboardFilters) {
  return useQuery({
    queryKey: ['dashboard-center', 'list', filters],
    queryFn: () =>
      api.get<DashboardCatalogItem[]>('/dashboards', {
        params: {
          search: filters.search || undefined,
          source: filters.source || undefined,
          type: filters.type || undefined,
          category: filters.category || undefined,
          favorites: filters.favorites ? 'true' : undefined,
          templates: filters.templates ? 'true' : undefined,
          tags: filters.tags || undefined,
        },
      }),
    staleTime: 15_000,
  });
}

export function useDashboardEmbed(id: string | null, ctx: EmbedContext) {
  return useQuery({
    enabled: !!id,
    queryKey: ['dashboard-center', 'embed', id, ctx],
    queryFn: () =>
      api.get<EmbedResolution>(`/dashboards/${id}/embed`, {
        params: {
          factoryId: ctx.factoryId || undefined,
          areaId: ctx.areaId || undefined,
          lineId: ctx.lineId || undefined,
          machineId: ctx.machineId || undefined,
          shiftId: ctx.shiftId || undefined,
          productId: ctx.productId || undefined,
          batchId: ctx.batchId || undefined,
          from: ctx.from || undefined,
          to: ctx.to || undefined,
          theme: ctx.theme || undefined,
        },
      }),
    staleTime: 10_000,
  });
}

export function useToggleFavorite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ favorite: boolean }>(`/dashboards/${id}/favorite`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-center', 'list'] });
      qc.invalidateQueries({ queryKey: ['dashboard-center', 'categories'] });
    },
  });
}

export function useCloneDashboard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ id: string }>(`/dashboards/${id}/clone`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard-center', 'list'] }),
  });
}

export function useGrafanaHealth() {
  return useQuery({
    queryKey: ['dashboard-center', 'grafana-health'],
    queryFn: () => api.get<{ configured: boolean; apiEnabled: boolean; reachable: boolean }>('/dashboards/grafana/health'),
    staleTime: 120_000,
  });
}
