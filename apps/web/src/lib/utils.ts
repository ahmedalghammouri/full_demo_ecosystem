import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistance, formatRelative, parseISO } from 'date-fns';
import { formatDate as fmtDateTz, formatDateTime as fmtDateTimeTz } from './datetime';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// OEE color classification
export function getOEEColor(value: number): string {
  if (value >= 85) return 'text-success-400';
  if (value >= 65) return 'text-brand-400';
  if (value >= 45) return 'text-warning-400';
  return 'text-danger-400';
}

export function getOEEBgColor(value: number): string {
  if (value >= 85) return 'bg-success-500';
  if (value >= 65) return 'bg-brand-500';
  if (value >= 45) return 'bg-warning-500';
  return 'bg-danger-500';
}

// Machine state styling
export function getMachineStateStyle(state: string): { color: string; bg: string; label: string } {
  const states: Record<string, { color: string; bg: string; label: string }> = {
    RUNNING: { color: 'text-machine-running', bg: 'bg-machine-running/10', label: 'Running' },
    IDLE: { color: 'text-machine-idle', bg: 'bg-machine-idle/10', label: 'Idle' },
    STOPPED: { color: 'text-machine-stopped', bg: 'bg-machine-stopped/10', label: 'Stopped' },
    FAULT: { color: 'text-machine-fault', bg: 'bg-machine-fault/10', label: 'Fault' },
    MAINTENANCE: { color: 'text-machine-maintenance', bg: 'bg-machine-maintenance/10', label: 'Maintenance' },
    OFFLINE: { color: 'text-gray-400', bg: 'bg-gray-500/10', label: 'Offline' },
  };
  return states[state.toUpperCase()] || states.OFFLINE;
}

// Format numbers
export function formatNumber(value: number | string | null | undefined, decimals = 1): string {
  if (value == null) return '—';
  const n = Number(value);
  if (!isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  // A non-zero value must never render as "0". At decimals=0 a live load of
  // 0.4 kW printed as "0", which reads as "nothing is running" — the opposite
  // of the truth. Borrow just enough precision to show a significant digit.
  if (n !== 0 && Math.abs(Number(n.toFixed(decimals))) === 0) {
    const needed = Math.min(4, Math.ceil(-Math.log10(Math.abs(n))) + 1);
    return n.toFixed(Math.max(decimals, needed));
  }
  return n.toFixed(decimals);
}

export function formatPercent(value: number | null | undefined, decimals = 1): string {
  if (value == null || !isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Date helpers
/**
 * Both formatters render in the FACTORY's timezone, not the browser's — see
 * `lib/datetime.ts` for why. They are re-exported here so the ~50 existing
 * call sites become timezone-correct without touching each one.
 */
export function formatDate(date: Date | string | null | undefined): string {
  return fmtDateTz(date);
}

export function formatDateTime(date: Date | string | null | undefined): string {
  return fmtDateTimeTz(date);
}

export function timeAgo(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const d = typeof date === 'string' ? parseISO(date) : date;
  if (isNaN(d.getTime())) return '—';
  return formatDistance(d, new Date(), { addSuffix: true });
}

// Priority styling
export function getPriorityStyle(priority: string): { color: string; label: string } {
  const map: Record<string, { color: string; label: string }> = {
    CRITICAL: { color: 'text-danger-400', label: 'Critical' },
    HIGH: { color: 'text-warning-400', label: 'High' },
    MEDIUM: { color: 'text-brand-400', label: 'Medium' },
    LOW: { color: 'text-muted-foreground', label: 'Low' },
  };
  return map[priority?.toUpperCase()] || map.LOW;
}

// Status badge variants
export function getStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const map: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
    ACTIVE: 'default',
    COMPLETED: 'default',
    APPROVED: 'default',
    OPEN: 'secondary',
    IN_PROGRESS: 'secondary',
    PENDING: 'outline',
    CLOSED: 'secondary',
    CANCELLED: 'destructive',
    FAILED: 'destructive',
    FAULT: 'destructive',
  };
  return map[status?.toUpperCase()] || 'outline';
}

// Generate random ID (for client-side temp)
export function generateId(): string {
  return crypto.randomUUID();
}

// Deep clone
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

// Debounce
export function debounce<T extends (...args: unknown[]) => unknown>(fn: T, delay: number): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// Truncate text
export function truncate(text: string, length = 50): string {
  if (text.length <= length) return text;
  return `${text.slice(0, length)}...`;
}
