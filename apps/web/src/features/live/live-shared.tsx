'use client';
/**
 * Shared foundation for the "now" pages.
 *
 * ── The rule this file enforces ─────────────────────────────────────────────
 * A live page does not import useTimeRange. Not once. The window is the shift
 * that is running, decided by the server from the shift templates — the browser
 * has no say in it, so no live page can quietly become a historical one and then
 * disagree with the analytics page beside it.
 *
 * That separation is why these pages exist at all. Everything here also keeps it
 * visible to the reader: every screen states which shift it is measuring, from
 * when, and which orders are running in it. A number without that context is
 * exactly what the analytics pages are for.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, RadioTower } from 'lucide-react';

import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { cn } from '@/lib/utils';

export interface LiveMachine {
  machineId: string; code: string; name: string; line: string | null;
  state: string; stateSince: string | null;
  runMin: number; downMin: number; plannedMin: number;
  externalMin: number; unmeasuredMin: number;
  output: number; good: number; scrap: number;
  availability: number | null; performance: number | null;
  quality: number | null; oee: number | null;
  /** The time-based pair — run ÷ (run + downtime). Both bases always travel. */
  availabilityTb: number | null; oeeTb: number | null;
}

export interface LiveJobOrder {
  jobOrderId: string; operationName: string | null; sequenceOrder: number;
  machineId: string | null; machineCode: string | null;
  workOrderNumber: string | null; productionOrderNumber: string | null;
  sku: string | null;
  plannedQty: number; plannedQtyUnit: string | null;
  goodQty: number; scrapQty: number; outputUnit: string | null;
  startedAt: string | null;
}

export interface LiveTotals {
  runMin: number; downMin: number; plannedMin: number;
  externalMin: number; unmeasuredMin: number;
  output: number; good: number; scrap: number;
  availability: number | null; performance: number | null;
  quality: number | null; oee: number | null;
  /** The time-based pair — run ÷ (run + downtime). Both bases always travel. */
  availabilityTb: number | null; oeeTb: number | null;
}

/** Plant-wide readings that are about the whole shift rather than one machine. */
export interface LivePlant {
  calendarMin: number;
  /** How much of the clock the plant even planned to use. */
  utilization: number | null;
  /** OEE carried the rest of the way to the calendar. */
  teep: number | null;
  teepTb: number | null;
  scheduleAttainment: number | null;
  scheduledOrders: number;
  capacityUtilization: number | null;
  machinesWithoutRate: number;
}

export interface LivePayload {
  window: { from: string; to: string; basis: 'SHIFT' | 'DAY' };
  shift: { code: string; name: string; startedAt: string } | null;
  machines: LiveMachine[];
  jobOrders: LiveJobOrder[];
  totals: LiveTotals;
  plant: LivePlant;
}

/**
 * One query for every live page.
 *
 * Only the LINE travels from the scope tree. A live page answers "how is the
 * plant running", and one machine in isolation is an analytics question — the
 * server declines a machine scope for the same reason.
 */
export function useLive() {
  const { scope } = useScope();
  const lineId = scope?.type === 'LINE' ? scope.id : undefined;

  const query = useQuery({
    queryKey: ['live', 'overview', lineId ?? 'factory'],
    queryFn: () => api.get('/live/overview', { params: lineId ? { lineId } : {} }),
    // A shop-floor screen is read at a glance and left running. Ten seconds feels
    // live without hammering the API from a wall display.
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const data = ((query.data as any)?.data ?? query.data) as LivePayload | undefined;
  return { ...query, data, lineId, scope };
}

export const fmtMin = (m?: number | null) => {
  if (m == null || m < 1) return '0m';
  const h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`;
};

export const fmtNum = (n?: number | null) => Math.round(n ?? 0).toLocaleString();

/** How long ago, in words — a live page's only honest way to show a timestamp. */
export function since(iso: string | null | undefined) {
  if (!iso) return null;
  const mins = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h}h ${Math.round(mins % 60)}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * State colours, from the validated status palette.
 *
 * Green is producing, red is the machine's own fault, amber is caused outside it,
 * blue is planned. The same hue means the same thing on the timeline, the shop
 * floor card and here — a reader should never have to relearn the colours.
 */
export const STATE_TONE: Record<string, string> = {
  RUNNING: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  IDLE: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  BREAKDOWN: 'bg-red-500/15 text-red-400 border-red-500/30',
  STARVED: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  BLOCKED: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  SETUP: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  CHANGEOVER: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  PLANNED_STOP: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  MAINTENANCE: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  OFFLINE: 'bg-slate-500/15 text-slate-500 border-slate-500/30',
};

export function StateChip({ state }: { state: string }) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold',
      STATE_TONE[state] ?? STATE_TONE.OFFLINE,
    )}>
      {state}
    </span>
  );
}

/**
 * The header every live page carries.
 *
 * It names the shift and when it started, because "now" is meaningless without
 * saying since when. A page that showed a figure with no window is how the live
 * and historical numbers became indistinguishable in the first place.
 */
export function LiveHeader({
  title, subtitle, icon: Icon, data, scope,
}: {
  title: string; subtitle: string;
  icon: React.ElementType;
  data?: LivePayload; scope: any;
}) {
  const { t } = useTranslation(['production', 'common']);
  const started = data?.shift?.startedAt ?? data?.window.from;
  return (
    <div>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Icon size={22} /> {title}
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10
                         px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
          <RadioTower size={10} className="animate-pulse" /> {t('live.badge')}
        </span>
      </h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        {subtitle}
        {scope && scope.type !== 'FACTORY' && <> · <span className="font-medium">{scope.code ?? scope.name}</span></>}
      </p>
      {data && (
        <p className="text-xs text-muted-foreground mt-1.5">
          {data.shift
            ? <>{t('live.measuring')} <span className="font-semibold text-foreground">{data.shift.name}</span></>
            : <>{t('live.measuringDay')}</>}
          {' · '}{t('live.since', { ago: since(started) })}
        </p>
      )}
    </div>
  );
}

export function LiveStat({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string;
  tone?: 'good' | 'bad' | 'warn' | 'primary';
}) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn(
        'text-2xl font-bold mt-0.5 tabular-nums',
        tone === 'good' && 'text-emerald-500',
        tone === 'bad' && 'text-red-400',
        tone === 'warn' && 'text-amber-500',
      )}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{sub}</div>}
    </div>
  );
}

/** Percentage, or an em dash when nothing was planned to judge it against. */
export function LivePct({ v, good = 85 }: { v: number | null; good?: number }) {
  const { t } = useTranslation('production');
  if (v == null) {
    return <span className="text-sm text-muted-foreground" title={t('live.notPlanned')}>—</span>;
  }
  return (
    <span className={cn('text-sm font-semibold tabular-nums',
      v >= good ? 'text-emerald-500' : v >= good * 0.7 ? 'text-amber-500' : 'text-red-400')}>
      {v}%
    </span>
  );
}

export function LiveEmpty({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground text-center py-12">{text}</div>;
}

export function LiveFailed({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation(['production', 'common']);
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-500/70" />
      <div className="text-sm text-muted-foreground max-w-sm">{t('live.loadFailed')}</div>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="text-xs px-3 py-1.5 rounded-md border border-border/60 hover:border-border transition-colors">
          {t('machineStatus.retry')}
        </button>
      )}
    </div>
  );
}
