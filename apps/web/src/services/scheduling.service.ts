import { api } from './api.client';
import type { GanttItem } from '@/components/charts/gantt-chart';

export interface ScheduleTypeMeta {
  type: string;
  label: string;
  color: string;
}

export interface UnifiedSchedule {
  items: GanttItem[];
  range: { from: string; to: string };
  counts: Record<string, number>;
  typeMeta: ScheduleTypeMeta[];
}

export interface UnifiedScheduleParams {
  dateFrom?: string;
  dateTo?: string;
  types?: string;
  machineId?: string;
  areaId?: string;
  lineId?: string;
}

export const schedulingService = {
  getUnified: (params: UnifiedScheduleParams = {}) =>
    api.get<UnifiedSchedule>('/scheduling/unified', { params }),
};
