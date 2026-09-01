import { OEE_THRESHOLDS } from './constants';

export function calculateOEE(
  availability: number,
  performance: number,
  quality: number,
): number {
  return (availability / 100) * (performance / 100) * (quality / 100) * 100;
}

export function getOEECategory(oee: number): 'world-class' | 'good' | 'fair' | 'poor' {
  if (oee >= OEE_THRESHOLDS.WORLD_CLASS) return 'world-class';
  if (oee >= OEE_THRESHOLDS.GOOD) return 'good';
  if (oee >= OEE_THRESHOLDS.FAIR) return 'fair';
  return 'poor';
}

export function formatOrderNumber(date: Date, sequence: number): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const seq = String(sequence).padStart(4, '0');
  return `WO-${year}${month}${day}-${seq}`;
}

export function roundTo(value: number, decimals: number): number {
  return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function isValidTenantId(tenantId: string): boolean {
  return /^[a-f0-9-]{36}$/.test(tenantId);
}
