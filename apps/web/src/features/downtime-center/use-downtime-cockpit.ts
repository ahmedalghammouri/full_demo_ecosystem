'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';

export interface DowntimeKpis {
  totalEvents: number;
  totalDowntimeMin: number;
  plannedMin: number;
  unplannedMin: number;
  oeeImpactMin: number;
  openEvents: number;
  mttrHours: number;
  mtbfHours: number;
  availabilityLossPct: number;
}

export interface DowntimeCockpitData {
  scope: { areaId?: string; lineId?: string; machineId?: string } | null;
  generatedAt: string;
  kpis: DowntimeKpis;
  trend: Array<{ date: string; planned: number; unplanned: number }>;
  byMachine: Array<{ name: string; minutes: number }>;
  byCategory: Array<{ category: string; minutes: number; cumulativePct: number }>;
  topCauses: Array<{ reason: string; minutes: number; count: number }>;
  plannedVsUnplanned: { planned: number; unplanned: number };
  liveOpen: Array<{ machine: string; code: string; reason: string; category: string; startedAt: string; elapsedMin: number; planned: boolean }>;
  recent: Array<{ machine: string; reason: string; category: string; start: string; end: string | null; durationMin: number; planned: boolean; oeeImpact: boolean }>;
}

export function useDowntimeCockpit() {
  const { filter, key } = useScope();
  const { params: timeParams, key: timeKey } = useTimeRange();

  const query = useQuery({
    queryKey: ['downtime-cockpit', key, timeKey],
    queryFn: () => api.get<DowntimeCockpitData>('/production/downtime/cockpit', { params: { ...filter, ...timeParams } }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  return { data: query.data, isLoading: query.isLoading, refetch: query.refetch };
}
