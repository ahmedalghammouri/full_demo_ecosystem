'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { useTimeRange } from '@/hooks/use-time-range';

export interface ExecutiveRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // Time-based twin so the executive table can honour the OEE-basis toggle.
  oeeTb?: number;
  availabilityTb?: number;
  output: number;
  costMtd: number;
  electricalMtd: number;
  activeAlarms: number;
  openNCRs: number;
  openMaintenance: number;
}

export interface ExecutiveData {
  rows: ExecutiveRow[];
  totals: {
    factories: number;
    avgOee: number;
    avgOeeTb?: number;
    totalOutput: number;
    totalCostMtd: number;
    totalElectricalMtd: number;
    totalAlarms: number;
    totalOpenNCRs: number;
    totalOpenMaintenance: number;
  };
  generatedAt: string;
}

export function useExecutive() {
  const { params, key: timeKey } = useTimeRange();
  const query = useQuery({
    queryKey: ['dashboard', 'executive', timeKey],
    queryFn: () => api.get<ExecutiveData>('/dashboard/executive', { params }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  return { data: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
