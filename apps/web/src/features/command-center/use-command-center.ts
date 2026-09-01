'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import type {
  DashboardKPIs,
  Machine,
  ProductionStatus,
  Alarm,
} from '@/features/dashboard/use-dashboard-data';

/** Operations slice — identical shape to the /dashboard/overview payload. */
export interface CommandCenterOps {
  kpis: DashboardKPIs;
  machines: Machine[];
  productionStatus: ProductionStatus;
  productionTrend: Array<{ time: string; actual: number; target: number; efficiency: number }>;
  qualityTrend: Array<{ time: string; fpy: number; rework: number; scrap: number }>;
  downtimePareto: Array<{ reason: string; duration: number; frequency: number; cumulative: number }>;
  shiftSummary: {
    shiftName: string;
    operator: string | null;
    startTime: string;
    elapsed: number;
    output: number;
    target: number | null;
    oee: number | null;
    downtime: number;
    defects: number;
  } | null;
  alarms: Alarm[];
}

export interface CommandCenterEnergy {
  meterCount: number;
  totalConsumptionMtd: number;
  totalConsumptionUnit: string;
  totalConsumptionAllMtd: number;
  totalCostMtd: number;
  totalConsumptionToday: number;
  byType: Record<string, number>;
  trend: Array<{ date: string; value: number }>;
  live: {
    totalPowerKw: number;
    standbyPowerKw: number;
    standbyCount: number;
    meters: Array<{
      meterId: string;
      name: string;
      type: string;
      powerKw: number | null;
      standby: boolean;
      inProduction: boolean;
      machineState: string | null;
    }>;
  } | null;
}

export interface CommandCenterExecutiveRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  oee: number;
  output: number;
  costMtd: number;
}

export interface CommandCenterData {
  scope: { areaId?: string; lineId?: string; machineId?: string } | null;
  ops: CommandCenterOps;
  energy: CommandCenterEnergy | null;
  executive: { dimension: 'factory' | 'area'; rows: CommandCenterExecutiveRow[] } | null;
  generatedAt: string;
}

export function useCommandCenter() {
  const { filter, key } = useScope();
  const { params: timeParams, key: timeKey } = useTimeRange();
  const mergedFilter = { ...filter, ...timeParams };

  const query = useQuery({
    queryKey: ['command-center', key, timeKey],
    queryFn: () => api.get<CommandCenterData>('/dashboard/command-center', { params: mergedFilter }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
