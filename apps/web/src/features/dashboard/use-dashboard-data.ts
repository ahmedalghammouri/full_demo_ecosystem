import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { useRealtimeData } from '@/hooks/use-websocket';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';

export interface DashboardKPIs {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // Time-based (OEE-TB) variant emitted by the backend alongside schedule-based OEE.
  oeeTb: number;
  availabilityTb: number;
  totalOutput: number;
  activeAlarms: number;
  oeeTrend: number;
  oeeTbTrend: number;
  availabilityTrend: number;
  availabilityTbTrend: number;
  performanceTrend: number;
  qualityTrend: number;
  outputTrend: number;
  alarmTrend: number;
}

export interface Machine {
  id: string;
  name: string;
  code: string;
  state: 'RUNNING' | 'IDLE' | 'STOPPED' | 'FAULT' | 'MAINTENANCE' | 'OFFLINE';
  oee: number;
  /**
   * Time-based OEE. Null when the machine has no live job order — the stored
   * snapshot carries only the schedule-based figure, so there is nothing honest to
   * show on the time basis and the card falls back rather than inventing one.
   */
  oeeTb?: number | null;
  currentOrder?: string;
  throughput: number;
  runtime: number;
  lastUpdate: string;
  area: string;
}

export interface ProductionStatus {
  runningLines: number;
  totalLines: number;
  activeOrders: number;
  completedToday: number;
  plannedOutput: number;
  actualOutput: number;
}

export interface Alarm {
  id: string;
  code: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  machine: string;
  triggeredAt: string;
  acknowledged: boolean;
}

export interface DashboardData {
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

async function fetchDashboardData(filter: Record<string, string>): Promise<DashboardData> {
  return api.get<DashboardData>('/dashboard/overview', { params: filter });
}

export function useDashboardData() {
  const { filter, key } = useScope();
  const { params: timeParams, key: timeKey } = useTimeRange();
  const mergedFilter = { ...filter, ...timeParams };
  const query = useQuery({
    queryKey: ['dashboard', 'overview', key, timeKey],
    queryFn: () => fetchDashboardData(mergedFilter),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  // Real-time updates for KPIs via WebSocket
  const realtimeKPIs = useRealtimeData<Partial<DashboardKPIs>>('dashboard:kpis', {});
  const realtimeMachines = useRealtimeData<Machine[]>('machines:status', []);

  return {
    data: query.data
      ? {
          ...query.data,
          kpis: { ...query.data.kpis, ...realtimeKPIs },
          machines: realtimeMachines.length > 0 ? realtimeMachines : query.data.machines,
        }
      : undefined,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
