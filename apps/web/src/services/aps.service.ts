import { api } from './api.client';

export interface ApsItem {
  id: string;
  type: string;
  title: string;
  subtitle?: string;
  operation: string;
  sequenceOrder: number;
  orderNumber: string;
  workOrderId: string;
  productionOrderId: string | null;
  productionOrderNumber: string | null;
  predecessorId: string | null;
  predecessorType: 'FINISH_TO_START' | 'START_TO_START' | 'START_TO_FINISH' | 'FINISH_TO_FINISH';
  predecessorLagMins: number;
  status: string;
  resourceId: string;
  resourceName: string;
  start: string;
  end: string;
  qty: number | null;
  progress: number;
  color: string;
  statusColor: string;
  priority: string;
}

export interface ApsDemand {
  orderNumber: string;
  color: string;
  dueDate: string | null;
  scheduledFinish: string;
  late: boolean;
  priority: string;
}

export interface ApsMetrics {
  makespanHours: number;
  onTimeOrders: number;
  lateOrderCount: number;
  onTimePct: number;
  machinesUsed: number;
  utilizationPct: number;
  lateOrders: { orderNumber: string; finish: string; due: string | null; lateHours: number }[];
}

export interface ApsPlan {
  items: ApsItem[];
  machines: { id: string; name: string; code: string }[];
  demand: ApsDemand[];
  unscheduled: number;
  range: { from: string; to: string };
  metrics: ApsMetrics;
}

export interface RunScheduleResult extends ApsMetrics {
  scheduled: number;
  dryRun?: boolean;
  updates?: Array<{ id: string; start: string; end: string }>;
}

export interface CtpResult {
  sku: { id: string; code: string; name: string };
  quantity?: number;
  machine?: { id: string; name: string; code: string; capacityPerHour: number | null };
  earliestStart?: string;
  promiseDate?: string;
  runtimeHours?: number;
  requestedDate?: string | null;
  feasible: boolean;
  slackHours?: number | null;
  reason?: string;
}

export interface MrpRequirement {
  materialId: string;
  code: string;
  name: string;
  unit: string;
  required: number;
  available: number;
  shortage: number;
  requiredDate: string;
  suggestedOrderDate: string | null;
  leadTimeDays: number | null;
}

export interface MrpResult {
  requirements: MrpRequirement[];
  shortages: number;
  ordersConsidered: number;
}

export const apsService = {
  getPlan: () => api.get<ApsPlan>('/aps/plan'),

  runSchedule: (body: { startFrom?: string; workOrderId?: string; dryRun?: boolean; overrides?: Array<{ id: string; start: string; end: string }> } = {}) =>
    api.post<RunScheduleResult>('/aps/schedule', body),

  saveSchedule: (updates: Array<{ id: string; start: string; end: string }>) =>
    api.post<{ saved: number; gated: Array<{ orderNumber: string; requestId: string; lateHours: number }> }>('/aps/save-schedule', { updates }),

  rescheduleJob: (body: { jobId: string; machineId?: string; start: string; end?: string }) =>
    api.post<{ id: string; start: string; end: string; rippledSuccessors: number }>('/aps/reschedule-job', body),

  ctp: (body: { skuId: string; quantity: number; dueDate?: string }) =>
    api.post<CtpResult>('/aps/ctp', body),

  getMrp: () => api.get<MrpResult>('/aps/mrp'),
};
