'use client';
/**
 * Shared foundation for the four OEE analytics pages.
 *
 * Availability, Performance, Quality and the combined view all read ONE
 * endpoint and slice the same payload. None of them computes a factor, a loss
 * or a total of its own — that is the rule this whole project has been enforcing
 * since the first complaint, which was that the same filter produced different
 * numbers on different screens.
 *
 * The hook is shared too, so all four also agree on which machines and which
 * seconds they are describing: one scope, one window, one query key.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Info } from 'lucide-react';
import { ResponsiveContainer } from 'recharts';

import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { cn } from '@/lib/utils';

export interface FactorTotals {
  calendarMin: number; loadingMin: number; scheduleLossMin: number;
  plannedProductionMin: number; plannedStopMin: number;
  runMin: number; unplannedStopMin: number; externalMin: number;
  netOperatingMin: number; performanceLossMin: number; microStopMin: number; idealRunMin: number;
  fullyProductiveMin: number; qualityLossMin: number;
  output: number; goodOutput: number; scrap: number;
  availability: number; performance: number; quality: number;
  oee: number; utilization: number; teep: number;
}

export interface AnalyticsPayload {
  from: string; to: string;
  totals: FactorTotals;
  machines: Array<FactorTotals & { machineId: string; code: string; name: string; line: string | null }>;
  waterfall: Array<{ key: string; minutes: number; kind: 'base' | 'loss' | 'result' }>;
  losses: Array<{ key: string; minutes: number; factor: string }>;
  trend: Array<{
    date: string; availability: number; performance: number; quality: number;
    oee: number; utilization: number; teep: number; output: number; good: number;
  }>;
}

/** One query, one cache entry — every page that calls this shares the result. */
export function useOeeAnalytics() {
  const { filter, key: scopeKey, scope } = useScope();
  const { params, key: timeKey } = useTimeRange();

  const query = useQuery({
    queryKey: ['oee-analytics', scopeKey, timeKey],
    queryFn: () => api.get('/machine-status/analytics', {
      // The whole params object, `timeframe` included. Sending only the dates made
      // the sidebar's "Shift" resolve to the calendar day on all four analytics
      // pages while the OEE page resolved the real shift, so the same machine
      // reported two availabilities depending on which page you were looking at.
      params: { ...filter, ...params },
    }),
    staleTime: 20_000,
    retry: 2,
  });

  const data = ((query.data as any)?.data ?? query.data) as AnalyticsPayload | undefined;
  return { ...query, data, scope, window: { from: params.dateFrom, to: params.dateTo } };
}

export const fmtMin = (m?: number) => {
  if (!m || m < 1) return '0m';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
};

export const fmtNum = (n?: number) => Math.round(n ?? 0).toLocaleString();

export const fmtDay = (d: string) =>
  new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });

export const CHART_TOOLTIP = {
  // contentStyle alone is not enough: Recharts paints the tooltip's LABEL and
  // each ITEM with its own default dark colour, so on a dark card the text is
  // near-invisible. All three have to be told about the theme.
  contentStyle: {
    background: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 12,
    color: 'hsl(var(--foreground))',
  },
  labelStyle: { color: 'hsl(var(--foreground))' },
  itemStyle: { color: 'hsl(var(--foreground))' },
};

/**
 * Factor colours — CSS tokens, not literals, so the hue follows the theme.
 *
 * These were hex strings taken from the palette's LIGHT column, which meant the
 * light steps were painted on the dark surface too: violet came out at 2.04:1
 * there, effectively invisible. The tokens in globals.css carry a separate,
 * separately validated set of steps for each theme.
 *
 * The same hue means the same factor on every page — availability is always
 * blue, performance always yellow — so a reader never relearns the chart.
 */
export const FACTOR_COLORS = {
  availability: 'var(--viz-1)',  // blue
  performance: 'var(--viz-4)',   // yellow
  quality: 'var(--viz-6)',       // green
  utilization: 'var(--viz-7)',   // violet
  oee: 'var(--viz-2)',           // orange
} as const;

/**
 * Loss colours, by who owns the loss. Same tokens, so a hue means one thing
 * across every chart in the product.
 */
export const LOSS_COLORS = {
  scheduleLoss: 'var(--viz-7)',
  plannedStops: 'var(--viz-1)',
  external: 'var(--viz-4)',
  breakdowns: 'var(--viz-8)',
  speedLoss: 'var(--viz-2)',
  qualityLoss: 'var(--viz-5)',
  productive: 'var(--viz-6)',
} as const;

export function PageHeader({
  title, subtitle, icon: Icon, scope, window: win,
}: {
  title: string; subtitle: string; icon: React.ElementType;
  scope: any; window: { from: string; to: string };
}) {
  return (
    <div>
      <h1 className="text-2xl font-bold flex items-center gap-2">
        <Icon size={22} /> {title}
        <DataModeBadge mode="live" />
      </h1>
      <p className="text-sm text-muted-foreground mt-0.5">
        {subtitle}
        {scope && scope.type !== 'FACTORY' && <> · <span className="font-medium">{scope.code ?? scope.name}</span></>}
        {' · '}{win.from} → {win.to}
      </p>
    </div>
  );
}

export function Stat({
  label, value, sub, tone,
}: {
  label: string; value: string; sub?: string;
  tone?: 'good' | 'bad' | 'warn' | 'primary';
}) {
  return (
    <div className="rounded-lg border border-border/50 p-3">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className={cn(
        'text-xl font-bold mt-0.5',
        tone === 'good' && 'text-emerald-500',
        tone === 'bad' && 'text-red-400',
        tone === 'warn' && 'text-amber-500',
      )}>{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

export function Pct({ v, good = 85 }: { v?: number | null; good?: number }) {
  // null is not zero. A machine with no planned production in the window has no
  // availability to report, and rendering that as 0% accuses it of failing when it
  // was simply never asked to run. An em dash says "not applicable" honestly.
  if (v == null) {
    return <span className="text-sm text-muted-foreground" title="No planned production in this window">—</span>;
  }
  return (
    <span className={cn('text-sm font-semibold',
      v >= good ? 'text-emerald-500' : v >= good * 0.7 ? 'text-amber-500' : 'text-red-400')}>
      {v}%
    </span>
  );
}

/**
 * Axis defaults.
 *
 * `stroke` colours the axis LINE; the tick TEXT takes its colour from `tick.fill`.
 * Setting only stroke leaves the labels at Recharts' default near-black, which is
 * invisible on a dark card — a bug this project has already fixed once across
 * two dozen axes, so it lives in one place now.
 */
export const AXIS = {
  tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' },
  stroke: 'hsl(var(--muted-foreground))',
} as const;

/** A 2px surface-coloured outline, so touching stacked segments read as divided. */
export const SEGMENT_GAP = {
  stroke: 'hsl(var(--card))',
  strokeWidth: 2,
} as const;

/**
 * A framed chart. The title states the question the chart answers, not the
 * measure it plots — "Which machine is worst" beats "Availability by machine".
 */
export function Chart({
  title, help, height = 260, children,
}: {
  title: string; help?: string; height?: number; children: React.ReactElement;
}) {
  return (
    <section className="rounded-lg border border-border/50 p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {help && <p className="text-[11px] text-muted-foreground mt-0.5">{help}</p>}
      <div className="mt-3">
        <ResponsiveContainer width="100%" height={height}>{children}</ResponsiveContainer>
      </div>
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground text-center py-12">{text}</div>;
}

export function Failed({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation(['production', 'common']);
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-500/70" />
      <div className="text-sm text-muted-foreground max-w-sm">{t('machineStatus.loadFailed')}</div>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="text-xs px-3 py-1.5 rounded-md border border-border/60 hover:border-border transition-colors">
          {t('machineStatus.retry')}
        </button>
      )}
    </div>
  );
}

export function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] text-muted-foreground flex gap-1.5">
      <Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {children}
    </p>
  );
}

/**
 * A horizontal loss bar: what the factor started with, and what each loss took.
 *
 * Shown as minutes rather than percentages because minutes are what a plant
 * manager can act on — "we lost four hours to changeovers" leads somewhere,
 * "availability was 94%" does not.
 */
export function LossBar({
  segments, total,
}: {
  segments: Array<{ label: string; minutes: number; color: string }>;
  total: number;
}) {
  const span = Math.max(1, total);
  return (
    <div>
      <div className="flex h-7 rounded-md overflow-hidden border border-border/40 bg-muted/25">
        {segments.filter((s) => s.minutes > 0).map((s, i) => (
          <div
            key={i}
            // A 2px surface gap separates touching marks, so the boundary is
            // read as a division rather than as a colour change.
            style={{ width: `calc(${(s.minutes / span) * 100}% - 2px)`, backgroundColor: s.color, minWidth: 2 }}
            className="h-full"
            title={`${s.label} — ${fmtMin(s.minutes)}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-3 mt-2">
        {segments.filter((s) => s.minutes > 0).map((s, i) => (
          <span key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: s.color }} />
            {s.label} <span className="text-foreground font-medium">{fmtMin(s.minutes)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
