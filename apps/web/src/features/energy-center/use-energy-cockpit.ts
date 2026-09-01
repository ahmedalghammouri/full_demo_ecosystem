'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import type { CommandCenterEnergy } from '@/features/command-center/use-command-center';

export interface EnergyCockpitData {
  scope: { areaId?: string; lineId?: string; machineId?: string } | null;
  overview: Omit<CommandCenterEnergy, 'live'>;
  live: NonNullable<CommandCenterEnergy['live']>;
  consumption: {
    chart: Array<Record<string, string | number>>;
    summaries: unknown[];
  };
  waste: {
    runningKwh: number;
    idleKwh: number;
    downtimeKwh: number;
    anomalyCount: number;
    avgKwhPerUnit: number | null;
    woCount: number;
  };
  topConsumers: Array<{
    meterId: string; name: string; type: string;
    powerKw: number | null; standby: boolean; machineState: string | null;
  }>;
  generatedAt: string;
}

export function useEnergyCockpit() {
  const { filter, key } = useScope();
  const { dateFrom, dateTo, key: timeKey } = useTimeRange();

  const query = useQuery({
    queryKey: ['energy', 'cockpit', key, timeKey],
    queryFn: () => api.get<EnergyCockpitData>('/energy/cockpit', { params: { ...filter, dateFrom, dateTo } }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  return { data: query.data, isLoading: query.isLoading, error: query.error, refetch: query.refetch };
}
