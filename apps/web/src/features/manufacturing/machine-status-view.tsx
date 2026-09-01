'use client';
/**
 * Machine Status — availability, performance and quality over a chosen window.
 *
 * Three tabs, one scope, one date range. All three read endpoints that resolve
 * scope and window through the same helpers on the server, so the tabs cannot
 * end up describing different machines or different seconds — the divergence
 * that made the dashboards disagree with each other in the first place.
 *
 * The timeline is the centrepiece of the availability tab. It reads
 * `machine_state_records`, which is the only place STARVED and BLOCKED minutes
 * live. Nothing wrote to that table until 15 Aug 2026, so there is no history
 * before then and the strip will simply be empty for earlier windows — that is
 * honest rather than a bug to work around.
 */
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Activity, Gauge, ShieldCheck, Clock, AlertTriangle, Info,
} from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line, XAxis, YAxis,
  CartesianGrid, Tooltip as RTooltip, Legend, ReferenceLine, Cell,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn } from '@/lib/utils';
import { MachineStateGantt } from '@/components/charts/machine-state-gantt';

const TABS = ['availability', 'performance', 'quality'] as const;
type Tab = (typeof TABS)[number];

const fmtMin = (m: number) => {
  if (!m || m < 1) return '0m';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
};

const fmtDay = (d: string | Date) =>
  new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });

const CHART_TOOLTIP = {
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

export function MachineStatusView() {
  const { t } = useTranslation(['production', 'common']);
  const { filter, key: scopeKey, scope } = useScope();
  const { params: timeParams, key: timeKey } = useTimeRange();
  const [tab, setTab] = useState<Tab>('availability');
  // No auth gate here on purpose: the API client now reads the persisted
  // session when the store has not rehydrated yet, so a request fired on first
  // render still carries its token. Gating on isAuthenticated would flash
  // "no machines" for a frame before the store catches up.

  // `timeframe` travels with the dates. Without it the API fell back to the calendar
  // day, so picking "Shift" measured midnight→now here while the OEE page measured
  // the minutes since the shift actually began — two pages, one button, two windows.
  const query = { ...filter, ...timeParams };

  const availability = useQuery({
    queryKey: ['machine-status', 'availability', scopeKey, timeKey],
    queryFn: () => api.get('/machine-status/availability', { params: query }),
    staleTime: 20_000,
    // Keep the previous window on screen while the next is fetched, so a
    // filter change updates the figures instead of unmounting the view.
    placeholderData: keepPreviousData,
    enabled: tab === 'availability',
    // Bounded: without a cap the tab spins for ever on a failing request and
    // the reader never learns anything went wrong.
    retry: 2,
  });

  const performance = useQuery({
    queryKey: ['machine-status', 'performance', scopeKey, timeKey],
    queryFn: () => api.get('/machine-status/performance', { params: query }),
    staleTime: 20_000,
    // Keep the previous window on screen while the next is fetched, so a
    // filter change updates the figures instead of unmounting the view.
    placeholderData: keepPreviousData,
    enabled: tab === 'performance',
    // Bounded: without a cap the tab spins for ever on a failing request and
    // the reader never learns anything went wrong.
    retry: 2,
  });

  const quality = useQuery({
    queryKey: ['machine-status', 'quality', scopeKey, timeKey],
    queryFn: () => api.get('/machine-status/quality', { params: query }),
    staleTime: 20_000,
    // Keep the previous window on screen while the next is fetched, so a
    // filter change updates the figures instead of unmounting the view.
    placeholderData: keepPreviousData,
    enabled: tab === 'quality',
    // Bounded: without a cap the tab spins for ever on a failing request and
    // the reader never learns anything went wrong.
    retry: 2,
  });

  const unwrap = (r: unknown) => (r as any)?.data ?? r;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Activity size={22} /> {t('machineStatus.title')}
            <DataModeBadge mode="live" />
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('machineStatus.subtitle')}
            {scope && scope.type !== 'FACTORY' && (
              <> · <span className="font-medium">{scope.code ?? scope.name}</span></>
            )}
            {' · '}{timeParams.dateFrom} → {timeParams.dateTo}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border/50">
        {TABS.map((x) => {
          const Icon = x === 'availability' ? Clock : x === 'performance' ? Gauge : ShieldCheck;
          return (
            <button
              key={x}
              onClick={() => setTab(x)}
              className={cn(
                'px-4 py-2 text-sm flex items-center gap-2 border-b-2 -mb-px transition-colors',
                tab === x
                  ? 'border-primary text-foreground font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon size={15} /> {t(`machineStatus.${x}`)}
            </button>
          );
        })}
      </div>

      {tab === 'availability' && (
        <AvailabilityTab data={unwrap(availability.data)} isLoading={availability.isLoading} error={availability.error} onRetry={availability.refetch} />
      )}
      {tab === 'performance' && (
        <PerformanceTab data={unwrap(performance.data)} isLoading={performance.isLoading} error={performance.error} onRetry={performance.refetch} />
      )}
      {tab === 'quality' && (
        <QualityTab data={unwrap(quality.data)} isLoading={quality.isLoading} error={quality.error} onRetry={quality.refetch} />
      )}
    </div>
  );
}

/**
 * True once a load has run long past any reasonable response time.
 *
 * react-query reports a request as loading for as long as its promise is
 * unsettled, and on a direct-URL load this app's session bootstrap can leave
 * promises hanging indefinitely — the same symptom hits the hierarchy tree and
 * the notification badges. Rather than present that as an endless spinner, the
 * tab calls it a failure and offers a retry, which is both truthful and a way
 * out. Fifteen seconds is far beyond the 35 ms this endpoint answers in
 * normally, so a genuinely slow window is never mislabelled.
 */
function useStalled(hasData: boolean, afterMs = 15_000) {
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (hasData) { setStalled(false); return; }
    // Started once, from mount. An earlier version keyed this on the loading
    // flag, which flips false between retries and reset the clock every time —
    // so the very case it existed for never tripped it.
    const id = setTimeout(() => setStalled(true), afterMs);
    return () => clearTimeout(id);
  }, [hasData, afterMs]);
  return stalled;
}

interface TabProps {
  data: any;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
}

// ────────────────────────────────────────────────────────────
// AVAILABILITY
// ────────────────────────────────────────────────────────────

function AvailabilityTab({ data, isLoading, error, onRetry }: TabProps) {
  const { t } = useTranslation(['production', 'common']);
  const stalled = useStalled(!!data?.machines?.length);
  if (error || stalled) return <Failed onRetry={onRetry} />;
  if (isLoading) return <Empty text={t('common:loading')} />;
  if (!data?.machines?.length) return <Empty text={t('machineStatus.noMachines')} />;

  const totals = data.totals ?? {};
  const from = new Date(data.from).getTime();
  const to = new Date(data.to).getTime();

  return (
    <div className="space-y-6">

      <div className="rounded-lg border border-border/50 p-4">
        <h2 className="text-sm font-semibold mb-1">{t('machineStatus.timeline')}</h2>
        <p className="text-[11px] text-muted-foreground mb-4">{t('machineStatus.timelineHelp')}</p>

        <MachineStateGantt
          rows={data.machines.map((m: any) => ({
            id: m.machineId,
            label: m.code,
            sublabel: m.name,
            meta: `${m.availabilityPct == null ? '—' : `${m.availabilityPct}%`} · ${fmtMin(m.runMin)}`,
            segments: m.segments ?? [],
            // The schedule for the same window, stacked above the machine's own
            // band. Undefined when nothing was booked: the chart sizes the row
            // from whether this field is there at all.
            planSegments: m.planSegments?.length ? m.planSegments : undefined,
          }))}
          windowStart={from}
          windowEnd={to}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PerMachineTable
          title={t('machineStatus.perMachine')}
          rows={data.machines}
          columns={[
            { key: 'm', label: t('machineStatus.machine'), text: true, render: nameCell },
            // Availability and uptime are DIFFERENT questions and both are shown,
            // because the difference between them is the planned time — which is
            // exactly what an argument about "but the machine was running" is about.
            { key: 'av', label: 'Availability', render: (r) => pctCell(r.availabilityPct) },
            { key: 'up', label: 'Uptime', render: (r) => pctCell(r.uptimePct) },
            { key: 'run', label: 'Running', render: (r) => fmtMin(r.runMin) },
            { key: 'down', label: 'Unplanned', render: (r) => fmtMin(r.unplannedMin) },
            { key: 'plan', label: 'Planned', render: (r) => fmtMin(r.plannedStopMin) },
            { key: 'ext', label: 'External', render: (r) => fmtMin(r.externalMin) },
            { key: 'un', label: 'Unmeasured', render: (r) => fmtMin(r.unmeasuredMin) },
            { key: 'st', label: 'Stops', render: (r) => r.stops ?? 0 },
          ]}
        />

        <div className="rounded-lg border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-1">{t('machineStatus.pareto')}</h2>
          <p className="text-[11px] text-muted-foreground mb-3">{t('machineStatus.paretoHelp')}</p>
          {data.reasons?.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data.reasons.slice(0, 8)} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="label" width={130} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [fmtMin(Number(v)), t('machineStatus.duration')]} />
                <Bar dataKey="minutes" radius={[0, 4, 4, 0]}>
                  {data.reasons.slice(0, 8).map((r: any, i: number) => (
                    // Planned stops in blue, external in amber, the machine's own
                    // faults in red — the colour says who owns the loss.
                    <Cell key={i} fill={r.isPlanned ? '#3b82f6' : !r.affectsOEE ? '#f59e0b' : '#ef4444'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <Empty text={t('machineStatus.noStops')} />
          )}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// PERFORMANCE
// ────────────────────────────────────────────────────────────

function PerformanceTab({ data, isLoading, error, onRetry }: TabProps) {
  const { t } = useTranslation(['production', 'common']);
  const stalled = useStalled(!!data?.machines?.length);
  if (error) return <Failed onRetry={onRetry} />;
  if (isLoading) return <Empty text={t('common:loading')} />;
  if (!data?.machines?.length) return <Empty text={t('machineStatus.noMachines')} />;

  const totals = data.totals ?? {};
  const saturated = data.machines.filter((m: any) => m.performancePct >= 100).length;
  const series = (data.series ?? []).map((d: any) => ({ ...d, label: fmtDay(d.date) }));

  return (
    <div className="space-y-6">

      {saturated > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <b>{t('machineStatus.saturatedTitle', { count: saturated })}</b>
            <p className="text-xs text-muted-foreground mt-1">{t('machineStatus.saturatedBody')}</p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border/50 p-4">
        <h2 className="text-sm font-semibold mb-3">{t('machineStatus.performanceTrend')}</h2>
        {series.length ? (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={series}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
              <RTooltip {...CHART_TOOLTIP} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={85} stroke="#22c55e" strokeDasharray="4 4"
                label={{ value: t('machineStatus.worldClass'), fontSize: 9, fill: '#22c55e', position: 'insideTopRight' }} />
              <Line type="monotone" dataKey="performancePct" name={t('machineStatus.performance')}
                stroke="#0ea5e9" strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        ) : <Empty text={t('machineStatus.noSnapshots')} />}
      </div>

      <PerMachineTable
        title={t('machineStatus.perMachine')}
        rows={data.machines}
        columns={[
          { key: 'm', label: t('machineStatus.machine'), text: true, render: nameCell },
          { key: 'perf', label: 'Performance', render: (r) => pctCell(r.performancePct) },
          { key: 'rate', label: 'Rate /h', render: (r) => Math.round(r.actualRatePerHour ?? 0).toLocaleString() },
          { key: 'run', label: 'Running', render: (r) => fmtMin(r.runMin) },
          // The ideal time the output WOULD have taken. Performance is this over
          // the actual running time, so both halves of the ratio are on the row.
          { key: 'ideal', label: 'Ideal time', render: (r) => fmtMin(r.idealRunMin) },
          { key: 'out', label: 'Output', render: (r) => Math.round(r.output ?? 0).toLocaleString() },
          { key: 'good', label: 'Good', render: (r) => Math.round(r.goodOutput ?? 0).toLocaleString() },
        ]}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────
// QUALITY
// ────────────────────────────────────────────────────────────

function QualityTab({ data, isLoading, error, onRetry }: TabProps) {
  const { t } = useTranslation(['production', 'common']);
  const stalled = useStalled(!!data?.machines?.length);
  if (error) return <Failed onRetry={onRetry} />;
  if (isLoading) return <Empty text={t('common:loading')} />;
  if (!data?.machines?.length) return <Empty text={t('machineStatus.noMachines')} />;

  const totals = data.totals ?? {};
  const series = (data.series ?? []).map((d: any) => ({ ...d, label: fmtDay(d.date) }));

  return (
    <div className="space-y-6">

      <p className="text-[11px] text-muted-foreground flex gap-1.5">
        <Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('machineStatus.unitHelp')}
      </p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-lg border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-3">{t('machineStatus.qualityTrend')}</h2>
          {series.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <YAxis domain={[90, 100]} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <RTooltip {...CHART_TOOLTIP} />
                <Line type="monotone" dataKey="qualityPct" name={t('machineStatus.quality')}
                  stroke="#22c55e" strokeWidth={2.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          ) : <Empty text={t('machineStatus.noSnapshots')} />}
        </div>

        <div className="rounded-lg border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-3">{t('machineStatus.scrapByMachine')}</h2>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={data.machines}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
              <XAxis dataKey="code" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
              <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
              <RTooltip {...CHART_TOOLTIP} />
              <Bar dataKey="scrap" name={t('machineStatus.scrap')} fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <PerMachineTable
        title={t('machineStatus.perMachine')}
        rows={data.machines}
        columns={[
          { key: 'm', label: t('machineStatus.machine'), text: true, render: nameCell },
          { key: 'q', label: 'Quality', render: (r) => pctCell(r.qualityPct) },
          { key: 'scrapPct', label: 'Scrap %', render: (r) => pctCell(r.scrapPct) },
          { key: 'good', label: 'Good', render: (r) => Math.round(r.good ?? 0).toLocaleString() },
          { key: 'scrap', label: 'Scrap', render: (r) => Math.round(r.scrap ?? 0).toLocaleString() },
          { key: 'rework', label: 'Rework', render: (r) => Math.round(r.rework ?? 0).toLocaleString() },
          { key: 'total', label: 'Total', render: (r) => Math.round(r.total ?? 0).toLocaleString() },
        ]}
      />
    </div>
  );
}

// ── Small shared pieces ─────────────────────────────────────



/** A request that failed says so, and offers the way out. */
function Failed({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation(['production', 'common']);
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <AlertTriangle className="h-8 w-8 text-amber-500/70" />
      <div className="text-sm text-muted-foreground max-w-sm">{t('machineStatus.loadFailed')}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="text-xs px-3 py-1.5 rounded-md border border-border/60 hover:border-border transition-colors"
        >
          {t('machineStatus.retry')}
        </button>
      )}
    </div>
  );
}

/**
 * One machine per row — the numbers behind the picture above it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * All three tabs carried a card headed "Per machine" containing NOTHING: a
 * border, a title, and no body. Every chart on this page aggregates or ranks,
 * so a reader who wanted the actual figure for one machine — the one they came
 * to look at — had nowhere to read it. The section was not broken data; it was
 * never written.
 *
 * Columns are given per tab because the useful figures differ: availability is
 * about where the time went, performance about rate, quality about what came
 * out. A single shared column set would have been three-quarters irrelevant on
 * every tab.
 */
function PerMachineTable({
  title, rows, columns,
}: {
  title: string;
  rows: any[];
  columns: Array<{
    key: string;
    label: string;
    /** Right-aligned and tabular by default; a name column opts out. */
    text?: boolean;
    render: (r: any) => React.ReactNode;
  }>;
}) {
  return (
    <div className="rounded-lg border border-border/50 overflow-hidden">
      <div className="px-4 py-3 border-b border-border/50 text-sm font-semibold">{title}</div>
      {rows.length === 0 ? (
        <Empty text="—" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50 bg-muted/30">
                {columns.map((c) => (
                  <th key={c.key}
                    className={cn(
                      'px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground',
                      c.text ? 'text-start' : 'text-end',
                    )}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.machineId} className="border-b border-border/30 last:border-0">
                  {columns.map((c) => (
                    <td key={c.key}
                      className={cn('px-4 py-2', c.text ? 'text-start' : 'text-end tabular-nums')}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** A percentage that says "—" when it was never measured, rather than 0%. */
const pctCell = (v: number | null | undefined) =>
  v == null ? <span className="text-muted-foreground">—</span> : `${Number(v).toFixed(1)}%`;

/** The machine's identity, in one cell. */
const nameCell = (r: any) => (
  <div>
    <div className="font-medium">{r.code}</div>
    <div className="text-[11px] text-muted-foreground">{r.name}{r.line ? ` · ${r.line}` : ''}</div>
  </div>
);


function Empty({ text }: { text: string }) {
  return <div className="text-sm text-muted-foreground text-center py-12">{text}</div>;
}
