export const OEE_THRESHOLDS = {
  WORLD_CLASS: 85,
  GOOD: 70,
  FAIR: 55,
} as const;

export const MACHINE_STATES = {
  RUNNING: 'RUNNING',
  IDLE: 'IDLE',
  FAULT: 'FAULT',
  MAINTENANCE: 'MAINTENANCE',
  OFFLINE: 'OFFLINE',
  SETUP: 'SETUP',
} as const;

export const ALARM_SEVERITIES = {
  CRITICAL: 'CRITICAL',
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
} as const;

export const WORK_ORDER_STATUSES = {
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  ON_HOLD: 'ON_HOLD',
  CANCELLED: 'CANCELLED',
} as const;

export const PRIORITIES = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
} as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const SHIFT_DURATION_HOURS = 8;
export const SHIFTS_PER_DAY = 3;
