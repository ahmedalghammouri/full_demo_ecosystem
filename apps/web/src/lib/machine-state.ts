/**
 * Machine state presentation.
 *
 * The platform's `MachineState` enum, with the colour and label every surface
 * that shows a state must use. One table, because a machine wall and a twin
 * disagreeing about what amber means is worse than either being wrong alone.
 *
 * This is a **status scale**, not a categorical palette: the states are ordered
 * by how much attention they want, and every mark that carries one also carries
 * its label. Running-green and breakdown-red are indistinguishable under
 * deuteranopia by construction, so colour is never the only channel.
 */

export type MachineState =
  | 'RUNNING' | 'IDLE' | 'PLANNED_STOP' | 'BREAKDOWN' | 'SETUP' | 'CHANGEOVER'
  | 'STARTUP' | 'STARVED' | 'BLOCKED' | 'OFFLINE' | 'MAINTENANCE';

interface StateMeta {
  label: string;
  labelAr: string;
  colour: string;
  /** Only these states are producing. Matches the OEE engine's definition. */
  producing: boolean;
  /** Rank for sorting a wall so what needs attention floats up. */
  attention: number;
}

export const STATE_META: Record<string, StateMeta> = {
  RUNNING:      { label: 'Running',      labelAr: 'يعمل',           colour: '#2E9E6B', producing: true,  attention: 0 },
  STARTUP:      { label: 'Starting up',  labelAr: 'بدء التشغيل',    colour: '#4FA9C4', producing: false, attention: 2 },
  IDLE:         { label: 'Idle',         labelAr: 'متوقف',          colour: '#8A9A94', producing: false, attention: 4 },
  STARVED:      { label: 'Starved',      labelAr: 'نقص تغذية',      colour: '#C89A3C', producing: false, attention: 5 },
  BLOCKED:      { label: 'Blocked',      labelAr: 'محجوز',          colour: '#C87F3C', producing: false, attention: 5 },
  SETUP:        { label: 'Setup',        labelAr: 'تجهيز',          colour: '#7C87C4', producing: false, attention: 3 },
  CHANGEOVER:   { label: 'Changeover',   labelAr: 'تغيير إنتاج',    colour: '#9B7CC4', producing: false, attention: 3 },
  PLANNED_STOP: { label: 'Planned stop', labelAr: 'توقف مخطط',      colour: '#5B6B84', producing: false, attention: 1 },
  MAINTENANCE:  { label: 'Maintenance',  labelAr: 'صيانة',          colour: '#4F7FA9', producing: false, attention: 3 },
  BREAKDOWN:    { label: 'Breakdown',    labelAr: 'عطل',            colour: '#C4453C', producing: false, attention: 9 },
  OFFLINE:      { label: 'Offline',      labelAr: 'خارج الخدمة',    colour: '#3A4450', producing: false, attention: 1 },
};

const FALLBACK: StateMeta = {
  label: 'Unknown', labelAr: 'غير معروف', colour: '#5B6B84', producing: false, attention: 6,
};

export function stateMeta(state: string | null | undefined): StateMeta {
  return (state && STATE_META[state]) || FALLBACK;
}

export function stateColor(state: string | null | undefined): string {
  return stateMeta(state).colour;
}

export function stateLabel(state: string | null | undefined, locale: 'en' | 'ar' = 'en'): string {
  const m = stateMeta(state);
  return locale === 'ar' ? m.labelAr : m.label;
}

export function isProducing(state: string | null | undefined): boolean {
  return stateMeta(state).producing;
}

/**
 * Format a measured value.
 *
 * Null is rendered as an em dash, never as zero: "not measured" and "measured
 * zero" are different facts, and a nought on a plant screen reads as a machine
 * that produced nothing.
 */
export function fmtNumber(value: number | null | undefined, decimals = 0): string {
  if (value == null || Number.isNaN(value)) return '—';
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
