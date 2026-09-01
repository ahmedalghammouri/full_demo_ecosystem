'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';

export interface QualityCockpitData {
  scope: { areaId?: string; lineId?: string; machineId?: string } | null;
  kpis: {
    fpy: number;
    passRate: number;
    reworkRate: number;
    scrapRate: number;
    openNCRs: number;
    criticalNCRs: number;
    openCAPAs: number;
    capaComplianceRate: number;
    inspectionsToday: number;
    cpk: number | null;
  };
  fpyTrend: Array<{ time: string; fpy: number }>;
  defectPareto: Array<{ category: string; quantity: number; count: number; cumulative: number }>;
  ncrBySeverity: Array<{ severity: string; count: number }>;
  ncrByStatus: Array<{ status: string; count: number }>;
  inspectionByResult: Array<{ result: string; count: number }>;
  capaByStatus: Array<{ status: string; count: number }>;
  generatedAt: string;
}

export function useQualityCockpit() {
  const { filter, key } = useScope();
  const { dateFrom, dateTo, key: timeKey } = useTimeRange();

  const query = useQuery({
    queryKey: ['quality', 'cockpit', key, timeKey],
    queryFn: () => api.get<QualityCockpitData>('/quality/cockpit', { params: { ...filter, dateFrom, dateTo } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return { data: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
