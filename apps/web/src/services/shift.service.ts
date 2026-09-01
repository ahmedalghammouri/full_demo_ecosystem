import { api } from './api.client';

// ── Types ────────────────────────────────────────────────────────────────────
export type ShiftStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED';

export interface ShiftTemplate {
  id: string;
  factoryId: string;
  code: string;
  name: string;
  nameAr: string | null;
  startTime: string;        // HH:mm
  endTime: string;          // HH:mm
  crossesMidnight: boolean;
  shiftDurationHours: number;
  plannedProductionHours: number;
  /** @deprecated Replaced by planned stop rows. The API still returns it for
   *  older clients; nothing reads it and nothing writes it. */
  breakMinutes?: number;
  /** @deprecated see breakMinutes */
  cleaningMinutes?: number;
  /** Planned stops scheduled inside this shift. The availability denominator is
   *  derived from these, so this list is what makes the number explicable. */
  plannedStops?: Array<{ id: string; name: string; durationMinutes: number; startOffsetMin: number | null }>;
  days: number[];           // 0=Sun … 6=Sat
  targetQtyPerShift: number | null;
  targetUnit?: string;      // PIECE/INNER/CARTON/PALLET
  isActive: boolean;
  plannedProductionMinutes: number;
  instanceCount: number;
}

export interface ShiftTemplateInput {
  code: string;
  name: string;
  nameAr?: string;
  startTime: string;
  endTime: string;
  shiftDurationHours: number;
  plannedProductionHours: number;
  breakMinutes?: number;
  cleaningMinutes?: number;
  days: number[];
  targetQtyPerShift?: number;
  targetUnit?: string;
  isActive?: boolean;
}

export interface ShiftConfigSummary {
  shiftsPerDay: number;
  workingDaysPerWeek: number;
  workingDays: number[];
  plannedProductionHoursPerDay: number;
  shifts: Array<{
    id: string;
    code: string;
    name: string;
    nameAr: string | null;
    window: string;
    plannedProductionHours: number;
    shiftDurationHours: number;
    targetQtyPerShift: number | null;
  }>;
}

export interface ShiftInstance {
  id: string;
  shiftDate: string;
  startTime: string;
  endTime: string | null;
  targetQty: number | null;
  actualQty: number;
  goodQty: number;
  scrapQty: number;
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  downtimeMinutes: number;
  status: ShiftStatus;
  handoverNotes: string | null;
  shiftTemplate: { code: string; name: string; nameAr: string | null };
  line: { name: string; code: string } | null;
  operator: { name: string } | null;
  supervisor: { name: string } | null;
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface GenerateInstancesInput {
  dateFrom: string;
  dateTo?: string;
  templateIds?: string[];
  lineId?: string;
  withPlannedDowntime?: boolean;
}

export interface PlannedDowntimeCause {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  category: string;
  isPlanned: boolean;
  sortOrder: number;
}

export interface PlannedDowntimeEvent {
  id: string;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
  category: string;
  isPlanned: boolean;
  affectsOEE: boolean;
  machine: { name: string; code: string } | null;
  cause: { code: string; name: string; category: string } | null;
}

export interface PlannedDowntimeList extends Paginated<PlannedDowntimeEvent> {
  totalPlannedMinutes: number;
}

export interface GeneratePlannedDowntimeInput {
  dateFrom: string;
  dateTo?: string;
  templateIds?: string[];
  machineIds?: string[];
}

export type PlannedScope = 'AREA' | 'LINE' | 'MACHINE';

export interface AddPlannedDowntimeInput {
  causeId: string;
  scopeType: PlannedScope;
  scopeId: string;
  startTime: string;
  durationMinutes: number;
  notes?: string;
  shiftInstanceId?: string;
}

// ── Service ──────────────────────────────────────────────────────────────────
export const shiftService = {
  getConfig: () => api.get<ShiftConfigSummary>('/shifts/config'),

  listTemplates: (includeInactive = false) =>
    api.get<ShiftTemplate[]>('/shifts/templates', { params: { includeInactive } }),

  getTemplate: (id: string) => api.get<ShiftTemplate>(`/shifts/templates/${id}`),

  createTemplate: (body: ShiftTemplateInput) =>
    api.post<ShiftTemplate>('/shifts/templates', body),

  updateTemplate: (id: string, body: Partial<ShiftTemplateInput>) =>
    api.patch<ShiftTemplate>(`/shifts/templates/${id}`, body),

  deleteTemplate: (id: string) =>
    api.delete<{ id: string; deleted?: boolean; deactivated?: boolean }>(`/shifts/templates/${id}`),

  generateInstances: (body: GenerateInstancesInput) =>
    api.post<{ created: number; skipped: number; days: number; templates: number }>(
      '/shifts/instances/generate', body,
    ),

  listInstances: (params: {
    dateFrom?: string; dateTo?: string; status?: ShiftStatus;
    templateId?: string; lineId?: string; page?: number; limit?: number;
  } = {}) => api.get<Paginated<ShiftInstance>>('/shifts/instances', { params }),

  getCurrent: () => api.get<ShiftInstance | null>('/shifts/instances/current'),

  startShift: (id: string, body: { operatorId?: string; supervisorId?: string } = {}) =>
    api.post<ShiftInstance>(`/shifts/instances/${id}/start`, body),

  completeShift: (id: string, body: { actualQty?: number; goodQty?: number; scrapQty?: number; handoverNotes?: string } = {}) =>
    api.post<ShiftInstance>(`/shifts/instances/${id}/complete`, body),

  // ── Planned downtime (break + cleaning ↔ downtime reasons) ──
  listPlannedCauses: () => api.get<PlannedDowntimeCause[]>('/shifts/downtime-causes'),

  generatePlannedDowntime: (body: GeneratePlannedDowntimeInput) =>
    api.post<{ created: number; skipped: number; instances: number; machines: number }>(
      '/shifts/planned-downtime/generate', body,
    ),

  listPlannedDowntime: (params: { dateFrom?: string; dateTo?: string; machineId?: string; page?: number; limit?: number } = {}) =>
    api.get<PlannedDowntimeList>('/shifts/planned-downtime', { params }),

  addPlannedDowntime: (body: AddPlannedDowntimeInput) =>
    api.post<{ created: number; skipped: number; machines: number; scope: PlannedScope }>(
      '/shifts/planned-downtime', body,
    ),

  deletePlannedDowntime: (id: string) =>
    api.delete<{ id: string; deleted: boolean }>(`/shifts/planned-downtime/${id}`),
};

// Day-of-week helpers (0=Sun … 6=Sat) used across the shift UI
export const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_ORDER = [6, 0, 1, 2, 3, 4, 5]; // Sat-first (KSA work week)
