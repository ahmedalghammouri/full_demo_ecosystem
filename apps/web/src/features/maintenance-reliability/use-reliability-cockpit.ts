'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';

export interface ReliabilityCockpitData {
  scope: { areaId?: string; lineId?: string; machineId?: string } | null;
  kpis: {
    openWOs: number;
    overdueWOs: number;
    completionRate: number;
    mttr: number;
    mtbf: number;
    availabilityRate: number;
    pmCompliance: number;
  };
  reliabilityTrend: Array<{ month: string; mttr: number; mtbf: number }>;
  woByStatus: Array<{ status: string; count: number }>;
  woByType: Array<{ type: string; count: number }>;
  assetReliability: Array<{ machineId: string; name: string; code: string | null; failures: number; mttr: number }>;
  topFailureModes: Array<{
    id: string; code: string; description: string; machine: string | null;
    rpn: number; severity: number; occurrence: number; detection: number;
  }>;
  aging: { lt1d: number; d1to3: number; d3to7: number; gt7d: number };
  openTotal: number;
  overdue: number;
  generatedAt: string;
}

export function useReliabilityCockpit() {
  const { filter, key } = useScope();
  const query = useQuery({
    queryKey: ['maintenance', 'reliability-cockpit', key],
    queryFn: () => api.get<ReliabilityCockpitData>('/maintenance/reliability-cockpit', { params: { months: 6, ...filter } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return { data: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
