'use client';

/**
 * Job-Order Live Dashboard — /shop-floor/live/[id]
 *
 * One live page per job order, fed entirely by GET /production/job-orders/:id/live
 * (real data model — OEE ISO 22400 + TEEP, six big losses, time-model waterfall,
 * machine state distribution, downtime + microstop Pareto, MTTR/MTBF/MTTA + the
 * availability-metrics concept, production & reject trends, alarms, maintenance,
 * and industry benchmark standards). Polls every 5s.
 *
 * Styling follows the project design system: glass-card surfaces, Badge variants,
 * brand/success/warning/danger tokens, recharts — consistent with the shop floor
 * and the OEE analytics views.
 */

import React, { useMemo, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Activity, RefreshCw, Cpu, User, Package, Timer,
  Wrench, BellRing, AlertTriangle, Check, CheckCircle2, Target,
  TrendingUp, TrendingDown, Clock, Zap, Gauge as GaugeIcon,
  ShieldAlert, BarChart2, PieChart as PieIcon, ListChecks, HardHat, Layers,
  BookOpen, Crosshair, Sparkles,
} from 'lucide-react';
import {
  ResponsiveContainer, ComposedChart, BarChart, Bar, Line, LineChart,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, ReferenceLine, Legend, Cell,
  PieChart, Pie,
} from 'recharts';

import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StateTimelineStrip } from '@/components/charts/state-timeline-strip';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { useBreadcrumbStore } from '@/store/breadcrumb-store';
import { SelectMenu } from '@/components/ui/select-menu';
import { JobFilterBar } from './job-filter-bar';
import { ShiftSummaryBand, JobShiftBand } from './shift-summary-band';
import {
  MaintenanceRequestDialog, MachineStateDialog, AlarmDialog,
  type JOActionTarget,
} from './shop-floor-actions';
import { LogDowntimeDialog } from './log-downtime-dialog';

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

const fmtMins = (m: number | null | undefined) => {
  if (m == null) return '—';
  if (m < 1) return `${Math.round(m * 60)}s`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
};
const fmtTime = (d: string | Date) =>
  new Date(d).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const fmtDT = (d: string | Date) =>
  new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtDay = (d: string | Date) =>
  new Date(d).toLocaleDateString([], { month: 'short', day: 'numeric' });

// OEE benchmark classes (industry standard levels)
const BENCH: Record<string, { labelKey: string; color: string; bg: string }> = {
  WORLD_CLASS: { labelKey: 'jolive.bench.worldClass', color: '#22c55e', bg: 'bg-green-500/10 border-green-500/30 text-green-400' },
  GOOD:        { labelKey: 'jolive.bench.good',        color: '#3b82f6', bg: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  FAIR:        { labelKey: 'jolive.bench.fair',        color: '#eab308', bg: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' },
  POOR:        { labelKey: 'jolive.bench.poor',        color: '#ef4444', bg: 'bg-red-500/10 border-red-500/30 text-red-400' },
};

const STATE_COLORS: Record<string, string> = {
  RUNNING: '#22c55e', IDLE: '#94a3b8', PLANNED_STOP: '#3b82f6', BREAKDOWN: '#ef4444',
  SETUP: '#f59e0b', CHANGEOVER: '#f59e0b', STARVED: '#fb923c', BLOCKED: '#a855f7',
  OFFLINE: '#475569', MAINTENANCE: '#06b6d4',
};

const SEV_VARIANT: Record<string, 'destructive' | 'warning' | 'info' | 'secondary'> = {
  CRITICAL: 'destructive', HIGH: 'warning', MEDIUM: 'warning', LOW: 'info', INFO: 'secondary',
};

const MAINT_STATUS_VARIANT: Record<string, 'info' | 'warning' | 'success' | 'destructive' | 'secondary'> = {
  OPEN: 'info', AWAITING_PARTS: 'warning', ASSIGNED: 'info', IN_PROGRESS: 'success',
  ON_HOLD: 'warning', COMPLETED: 'success', CANCELLED: 'destructive',
};

const SCRAP_COLORS = ['#ef4444', '#f97316', '#eab308', '#a855f7', '#06b6d4', '#ec4899', '#64748b', '#84cc16'];

function BenchBadge({ cls }: { cls: string | null }) {
  const { t } = useTranslation('production');
  if (!cls || !BENCH[cls]) return null;
  const b = BENCH[cls];
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${b.bg}`}>{t(b.labelKey)}</span>;
}

// Radial gauge (SVG) — value 0..100
function Gauge({ value, label, cls, size = 120 }: { value: number | null; label: string; cls: string | null; size?: number }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const color = cls && BENCH[cls] ? BENCH[cls].color : '#64748b';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={9} className="text-muted/40" />
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={9}
            strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (c * pct) / 100}
            style={{ transition: 'stroke-dashoffset 0.8s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold tabular-nums" style={{ color }}>
            {value != null ? `${value.toFixed(1)}` : '—'}
          </span>
          {value != null && <span className="text-[10px] text-muted-foreground -mt-0.5">%</span>}
        </div>
      </div>
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <BenchBadge cls={cls} />
    </div>
  );
}

// One availability calculation method (classic schedule-based or time-based),
// with its formula, resulting value/class and the OEE it produces.
function AvailabilityMethod({
  title, subtitle, value, cls, formula, oeeValue, oeeCls, rows, highlight,
}: {
  title: string; subtitle: string; value: number | null; cls: string | null;
  formula: string; oeeValue: number | null; oeeCls: string | null;
  rows: Array<[string, string]>; highlight?: boolean;
}) {
  const color = cls && BENCH[cls] ? BENCH[cls].color : '#64748b';
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'border-brand-400/40 bg-brand-500/5' : 'border-border/50 bg-background/40'}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold">{title}</div>
          <div className="text-[10px] text-muted-foreground">{subtitle}</div>
        </div>
        <BenchBadge cls={cls} />
      </div>
      <div className="flex items-baseline gap-2 mt-2">
        <span className="text-3xl font-bold tabular-nums leading-none" style={{ color }}>
          {value != null ? value.toFixed(1) : '—'}
        </span>
        <span className="text-sm text-muted-foreground">%</span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          OEE <span className="font-bold text-foreground tabular-nums">{oeeValue != null ? `${oeeValue}%` : '—'}</span>
        </span>
      </div>
      <code className="block mt-2 text-[10px] text-muted-foreground bg-muted/40 rounded px-2 py-1 font-mono">{formula}</code>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2 text-[11px]">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-muted-foreground">{k}</span>
            <span className="tabular-nums font-medium">{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiTile({ icon, label, value, sub, tone }: {
  icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; tone?: string;
}) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/40 px-3.5 py-3 flex items-center gap-3 transition-colors hover:border-border">
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${tone ?? 'bg-brand-500/15 text-brand-400'}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
        <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground truncate">{sub}</div>}
      </div>
    </div>
  );
}

function SectionCard({ title, icon, children, right }: {
  title: string; icon?: React.ReactNode; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div className="glass-card rounded-2xl overflow-hidden transition-all duration-300 hover:border-border/80 hover:shadow-lg">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/40 bg-gradient-to-r from-muted/40 via-muted/10 to-transparent">
        <h3 className="text-sm font-bold flex items-center gap-2.5 min-w-0">
          {icon && (
            <span className="w-7 h-7 rounded-lg bg-brand-500/15 flex items-center justify-center shrink-0 [&>svg]:text-brand-400">
              {icon}
            </span>
          )}
          <span className="truncate">{title}</span>
        </h3>
        {right && <div className="shrink-0">{right}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

const CHART_TOOLTIP = {
  contentStyle: {
    background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))',
    borderRadius: 8, fontSize: 12,
  },
};

// ── Machine status timeline strip ──
// The bespoke renderer that used to live here laid its bands out in a flex row,
// which closes the gaps between records: a machine that reported nothing for an
// hour looked as though it had been running. It now uses the shared strip, so
// this view and the Machine Status page draw the same records the same way.
function StateTimeline({ records, windowStart, windowEnd }: {
  records: any[]; windowStart: string; windowEnd: string | null;
}) {
  return (
    <StateTimelineStrip
      segments={records}
      windowStart={windowStart}
      windowEnd={windowEnd}
    />
  );
}

// ── Metric trend lines (real InfluxDB historian series) ──
// `mode` toggles between the OEE comparison (classic vs time-based) and the
// full A/P/Q breakdown — both fed by the TSDB.
function MetricTrend({ data, mode }: { data: any[]; mode: 'oee' | 'components' }) {
  const { t } = useTranslation('production');
  const chartData = useMemo(() => data.map((d) => ({ ...d, label: fmtDay(d.date) })), [data]);
  if (!chartData.length) {
    return <div className="text-xs text-muted-foreground py-8 text-center">{t('jolive.noHistorian')}</div>;
  }
  const interval = chartData.length > 16 ? Math.floor(chartData.length / 12) : 0;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" interval={interval} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <RTooltip {...CHART_TOOLTIP} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <ReferenceLine y={85} stroke="#22c55e" strokeDasharray="4 4" label={{ value: t('jolive.worldClass85'), fontSize: 9, fill: '#22c55e', position: 'insideTopRight' }} />
        {mode === 'oee' ? (
          <>
            <Line type="monotone" dataKey="oee" name={t('jolive.oeeSchedule')} stroke="#0ea5e9" strokeWidth={2.5} dot={false} />
            <Line type="monotone" dataKey="oeeTb" name={t('jolive.oeeTimeBased')} stroke="#f59e0b" strokeWidth={2.5} strokeDasharray="5 3" dot={false} />
            <Line type="monotone" dataKey="availability" name={t('jolive.availabilitySchedule')} stroke="#22c55e" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="availabilityTb" name={t('jolive.availabilityTimeBased')} stroke="#a855f7" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
          </>
        ) : (
          <>
            <Line type="monotone" dataKey="availability" name={t('jolive.availability')} stroke="#22c55e" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="availabilityTb" name={t('jolive.availabilityTimeBased')} stroke="#a855f7" strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
            <Line type="monotone" dataKey="performance" name={t('jolive.performance')} stroke="#f59e0b" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="quality" name={t('jolive.quality')} stroke="#ec4899" strokeWidth={1.5} dot={false} />
          </>
        )}
      </LineChart>
    </ResponsiveContainer>
  );
}

// ── Time-model overview as percentages (TEEP / ISO 22400 waterfall) ──
function PercentWaterfall({ tm }: { tm: any }) {
  const { t } = useTranslation('production');
  const total = tm.totalMins ?? 0;
  if (total <= 0) return <div className="text-xs text-muted-foreground py-3 text-center">{t('jolive.noElapsedTime')}</div>;
  const rows: Array<{ label: string; mins: number | null; kind: 'time' | 'loss' | 'final' }> = [
    { label: t('jolive.tm.totalTime'), mins: tm.totalMins, kind: 'time' },
    { label: t('jolive.tm.plannedStops'), mins: tm.plannedStopMins, kind: 'loss' },
    { label: t('jolive.tm.operationalTime'), mins: tm.operationalMins, kind: 'time' },
    { label: t('jolive.tm.availabilityLosses'), mins: tm.availabilityLossMins, kind: 'loss' },
    { label: t('jolive.tm.netProductionTime'), mins: tm.netProductionMins, kind: 'time' },
    { label: t('jolive.tm.performanceLosses'), mins: tm.performanceLossMins, kind: 'loss' },
    { label: t('jolive.tm.microstopLosses'), mins: tm.microStopMins, kind: 'loss' },
    { label: t('jolive.tm.netOperationalTime'), mins: tm.netOperatingMins, kind: 'time' },
    { label: t('jolive.tm.qualityLosses'), mins: tm.qualityLossMins, kind: 'loss' },
    { label: t('jolive.tm.usedOperationalTime'), mins: tm.usedOperationalMins, kind: 'final' },
  ];
  return (
    <div className="space-y-1.5">
      {rows.map((r) => {
        if (r.mins == null) return (
          <div key={r.label} className="flex items-center gap-2 text-[11px]">
            <span className="w-40 shrink-0 text-muted-foreground">{r.label}</span>
            <span className="text-muted-foreground/50">{t('jolive.needsIdealCycle')}</span>
          </div>
        );
        const pct = Math.min(100, (r.mins / total) * 100);
        const color = r.kind === 'loss' ? 'bg-amber-500/80' : r.kind === 'final' ? 'bg-green-500' : 'bg-muted-foreground/30';
        return (
          <div key={r.label} className="flex items-center gap-2 text-[11px]">
            <span className={`w-40 shrink-0 ${r.kind === 'loss' ? 'text-amber-400/90' : r.kind === 'final' ? 'text-green-400 font-semibold' : 'text-muted-foreground'}`}>
              {r.label}
            </span>
            <div className="flex-1 h-4 bg-muted/30 rounded overflow-hidden">
              <div className={`h-full rounded ${color}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="w-24 text-right tabular-nums text-muted-foreground">
              {fmtMins(r.mins)} <span className="opacity-60">({pct.toFixed(1)}%)</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Machine state distribution (donut + occurrence/total/median/avg + list) ──
function StateDistribution({ sd }: { sd: any }) {
  const { t } = useTranslation('production');
  const data = (sd?.byState ?? []).filter((s: any) => s.mins > 0);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
      <div className="relative">
        {data.length === 0 ? (
          <div className="text-xs text-muted-foreground py-10 text-center">{t('jolive.noStateInWindow')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie data={data} dataKey="mins" nameKey="state" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                {data.map((s: any, i: number) => <Cell key={i} fill={STATE_COLORS[s.state] ?? SCRAP_COLORS[i % SCRAP_COLORS.length]} />)}
              </Pie>
              <RTooltip {...CHART_TOOLTIP} formatter={(v: any, n: any) => [fmtMins(v as number), n]} />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="space-y-3">
        {/* Occurrence / Total / Median / Average — like the time-model summary */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-1.5 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">{t('jolive.occurrence')}</div>
            <div className="text-base font-bold tabular-nums">{sd?.occurrences ?? 0}</div>
          </div>
          <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-1.5 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">{t('jolive.total')}</div>
            <div className="text-base font-bold tabular-nums">{fmtMins(sd?.totalMins)}</div>
          </div>
          <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-1.5 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">{t('jolive.median')}</div>
            <div className="text-base font-bold tabular-nums">{fmtMins(sd?.medianMins)}</div>
          </div>
          <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-1.5 text-center">
            <div className="text-[10px] uppercase text-muted-foreground">{t('jolive.average')}</div>
            <div className="text-base font-bold tabular-nums">{fmtMins(sd?.avgMins)}</div>
          </div>
        </div>
        <div className="space-y-1">
          {data.map((s: any) => (
            <div key={s.state} className="flex items-center gap-2 text-xs">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: STATE_COLORS[s.state] ?? '#64748b' }} />
              <span className="flex-1 font-medium">{s.state}</span>
              <span className="text-muted-foreground tabular-nums">{fmtMins(s.mins)}</span>
              <span className="text-muted-foreground/60 tabular-nums w-8 text-right">{s.count}×</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Pareto (downtime / microstop) ──
function ParetoChart({ rows }: { rows: any[] }) {
  const { t } = useTranslation('production');
  if (!rows?.length) return <div className="text-xs text-muted-foreground py-8 text-center">{t('jolive.noneRecorded')}</div>;
  const total = rows.reduce((s: number, p: any) => s + p.mins, 0);
  let cum = 0;
  const data = rows.slice(0, 8).map((p: any) => {
    cum += p.mins;
    return { ...p, cumPct: total > 0 ? Math.round((cum / total) * 1000) / 10 : 0 };
  });
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
        <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" interval={0} angle={-15} textAnchor="end" height={50} />
        <YAxis yAxisId="l" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" label={{ value: 'min', fontSize: 10, position: 'insideTopLeft' }} />
        <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
        <RTooltip {...CHART_TOOLTIP} />
        <Bar yAxisId="l" dataKey="mins" name={t('jolive.durationMin')} fill="#dc2626" radius={[3, 3, 0, 0]} />
        <Line yAxisId="r" type="monotone" dataKey="cumPct" name={t('jolive.cumulativePct')} stroke="#0ea5e9" strokeWidth={2} dot={{ r: 3 }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ── Six Big Losses (professional explainer matching the standard) ──
function SixLossesPanel({ sl }: { sl: any }) {
  const { t } = useTranslation('production');
  const groups = [
    {
      title: t('jolive.sl.availabilityLosses'), cls: 'border-blue-500/30 bg-blue-500/5', titleCls: 'text-blue-400',
      items: [
        { n: 1, name: t('jolive.sl.equipmentFailures'), desc: t('jolive.sl.equipmentFailuresDesc'), v: `${fmtMins(sl.availability.equipmentFailure.mins)} · ${sl.availability.equipmentFailure.count}×` },
        { n: 2, name: t('jolive.sl.setupAdjustments'), desc: t('jolive.sl.setupAdjustmentsDesc'), v: `${fmtMins(sl.availability.setupAdjustments.mins)} · ${sl.availability.setupAdjustments.count}×` },
      ],
    },
    {
      title: t('jolive.sl.performanceLosses'), cls: 'border-green-500/30 bg-green-500/5', titleCls: 'text-green-400',
      items: [
        { n: 3, name: t('jolive.sl.idlingMinorStops'), desc: t('jolive.sl.idlingMinorStopsDesc'), v: `${fmtMins(sl.performance.idlingMinorStops.mins)} · ${sl.performance.idlingMinorStops.count}×` },
        { n: 4, name: t('jolive.sl.reducedSpeed'), desc: t('jolive.sl.reducedSpeedDesc'), v: sl.performance.reducedSpeed.mins != null ? fmtMins(sl.performance.reducedSpeed.mins) : t('jolive.needsCycleTime') },
      ],
    },
    {
      title: t('jolive.sl.qualityLosses'), cls: 'border-red-500/30 bg-red-500/5', titleCls: 'text-red-400',
      items: [
        { n: 5, name: t('jolive.sl.processDefects'), desc: t('jolive.sl.processDefectsDesc'), v: `${sl.quality.processDefects.qty} ${t('jolive.pcs')}${sl.quality.processDefects.mins != null ? ` · ${fmtMins(sl.quality.processDefects.mins)}` : ''}` },
        { n: 6, name: t('jolive.sl.startupRejects'), desc: t('jolive.sl.startupRejectsDesc'), v: `${sl.quality.startupRejects.qty} ${t('jolive.pcs')}${sl.quality.startupRejects.mins != null ? ` · ${fmtMins(sl.quality.startupRejects.mins)}` : ''}` },
      ],
    },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {groups.map((g) => (
        <div key={g.title} className={`rounded-xl border p-3 ${g.cls}`}>
          <p className={`text-xs font-bold mb-2 ${g.titleCls}`}>{g.title}</p>
          <div className="space-y-2">
            {g.items.map((it) => (
              <div key={it.n} className="rounded-lg bg-background/60 border border-border/40 px-3 py-2">
                <p className="text-xs font-semibold">{it.n}. {it.name}</p>
                <p className="text-[10px] text-muted-foreground">{it.desc}</p>
                <p className="text-sm font-bold tabular-nums mt-1">{it.v}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Availability Metrics concept (MTTD → Repair → Resume → MTBF) with real values ──
function AvailabilityMetricsDiagram({ dt }: { dt: any }) {
  const { t } = useTranslation('production');
  const Marker = ({ x, color, label }: { x: string; color: string; label: string }) => (
    <div className="flex flex-col items-center" style={{ position: 'absolute', left: x, transform: 'translateX(-50%)' }}>
      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
      <span className="text-[9px] text-muted-foreground mt-1 whitespace-nowrap">{label}</span>
    </div>
  );
  return (
    <div className="space-y-4">
      <div className="relative h-20 mx-2">
        <div className="absolute top-3 left-0 right-0 h-0.5 bg-border" />
        <Marker x="6%" color="#f97316" label={t('jolive.am.failure')} />
        <Marker x="26%" color="#fbbf24" label={t('jolive.am.repairStarts')} />
        <Marker x="50%" color="#10b981" label={t('jolive.am.resume')} />
        <Marker x="94%" color="#f97316" label={t('jolive.am.nextFailure')} />
        {/* Span labels */}
        <div className="absolute top-10 text-center text-[10px]" style={{ left: '6%', width: '20%' }}>
          <span className="text-amber-400 font-semibold">MTTD/MTTA</span>
          <div className="text-muted-foreground tabular-nums">{fmtMins(dt.mttaMins)}</div>
        </div>
        <div className="absolute top-10 text-center text-[10px]" style={{ left: '26%', width: '24%' }}>
          <span className="text-emerald-400 font-semibold">{t('jolive.am.repairTime')}</span>
          <div className="text-muted-foreground tabular-nums">{fmtMins(dt.repairTimeMins)}</div>
        </div>
        <div className="absolute top-10 text-center text-[10px]" style={{ left: '50%', width: '44%' }}>
          <span className="text-blue-400 font-semibold">MTBF</span>
          <div className="text-muted-foreground tabular-nums">{fmtMins(dt.mtbfMins)}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-2 py-2">
          <div className="text-[10px] uppercase text-amber-400">MTTR</div>
          <div className="text-sm font-bold tabular-nums">{fmtMins(dt.mttrMins)}</div>
          <div className="text-[9px] text-muted-foreground">{t('jolive.am.meanTimeToRepair')}</div>
        </div>
        <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 px-2 py-2">
          <div className="text-[10px] uppercase text-blue-400">MTBF</div>
          <div className="text-sm font-bold tabular-nums">{fmtMins(dt.mtbfMins)}</div>
          <div className="text-[9px] text-muted-foreground">{t('jolive.am.betweenFailures')}</div>
        </div>
        <div className="rounded-lg border border-purple-500/30 bg-purple-500/5 px-2 py-2">
          <div className="text-[10px] uppercase text-purple-400">MTTA</div>
          <div className="text-sm font-bold tabular-nums">{fmtMins(dt.mttaMins)}</div>
          <div className="text-[9px] text-muted-foreground">{t('jolive.am.toAcknowledge')}</div>
        </div>
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-2 py-2">
          <div className="text-[10px] uppercase text-emerald-400">{t('jolive.am.repair')}</div>
          <div className="text-sm font-bold tabular-nums">{fmtMins(dt.repairTimeMins)}</div>
          <div className="text-[9px] text-muted-foreground">{t('jolive.am.ackToResume')}</div>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground text-center">{t('jolive.am.computedFrom', { days: dt.reliabilityWindowDays })}</p>
    </div>
  );
}

// ── AI Analysis — deterministic, rule-based insights derived from the live data
// (no mock — same philosophy as the project's /ai detectors, scoped to this JO). ──
function buildAiInsights(d: any, t: (k: string, o?: any) => string) {
  const o = d.oee, prod = d.production, dt = d.downtime, tm = d.timeModel, sl = d.sixLosses;
  const out: Array<{ sev: 'high' | 'medium' | 'low' | 'good'; title: string; detail: string; rec: string; confidence: number }> = [];

  // Constraint analysis — which OEE factor is the bottleneck
  const factors = [
    { k: 'Availability', label: t('jolive.availability'), v: o.joAvailability },
    { k: 'Performance', label: t('jolive.performance'), v: o.joPerformance },
    { k: 'Quality', label: t('jolive.quality'), v: o.joQuality },
  ].filter((f) => f.v != null).sort((a, b) => (a.v! - b.v!));
  if (factors.length) {
    const worst = factors[0];
    out.push({
      sev: worst.v! < 60 ? 'high' : worst.v! < 75 ? 'medium' : 'good',
      title: t('jolive.ai.limitingFactor', { factor: worst.label, value: worst.v }),
      detail: t('jolive.ai.limitingFactorDetail', { factor: worst.label, oee: o.joOEE ?? '—' }),
      rec: worst.k === 'Availability'
        ? t('jolive.ai.recAvailability')
        : worst.k === 'Performance'
        ? t('jolive.ai.recPerformance')
        : t('jolive.ai.recQuality'),
      confidence: 92,
    });
  }

  // Availability method divergence
  if (o.joAvailability != null && o.availabilityTimeBased != null) {
    const gap = Math.round((o.availabilityTimeBased - o.joAvailability) * 10) / 10;
    if (Math.abs(gap) >= 5) {
      out.push({
        sev: 'low',
        title: t('jolive.ai.methodsDiverge', { gap: `${gap > 0 ? '+' : ''}${gap}` }),
        detail: t('jolive.ai.methodsDivergeDetail', { tb: o.availabilityTimeBased, sched: o.joAvailability }),
        rec: t('jolive.ai.recMethods'),
        confidence: 88,
      });
    }
  }

  // Dominant loss
  const losses = [
    { k: t('jolive.ai.lossEquipmentFailures'), v: sl.availability.equipmentFailure.mins },
    { k: t('jolive.ai.lossSetupAdjustments'), v: sl.availability.setupAdjustments.mins },
    { k: t('jolive.ai.lossIdlingMinorStops'), v: sl.performance.idlingMinorStops.mins },
    { k: t('jolive.ai.lossReducedSpeed'), v: sl.performance.reducedSpeed.mins ?? 0 },
  ].sort((a, b) => b.v - a.v);
  if (losses[0]?.v > 0) {
    out.push({
      sev: losses[0].v > (tm.totalMins ?? 0) * 0.15 ? 'high' : 'medium',
      title: t('jolive.ai.largestLoss', { loss: losses[0].k, value: fmtMins(losses[0].v) }),
      detail: t('jolive.ai.largestLossDetail'),
      rec: t('jolive.ai.recLargestLoss'),
      confidence: 85,
    });
  }

  // Reliability signal
  if (dt.mtbfMins != null && dt.mttrMins != null) {
    out.push({
      sev: dt.mtbfMins < 60 ? 'high' : dt.mtbfMins < 180 ? 'medium' : 'good',
      title: t('jolive.ai.reliability', { mtbf: fmtMins(dt.mtbfMins), mttr: fmtMins(dt.mttrMins) }),
      detail: t('jolive.ai.reliabilityDetail', { mtbf: fmtMins(dt.mtbfMins), mttr: fmtMins(dt.mttrMins) }),
      rec: dt.mtbfMins < 120 ? t('jolive.ai.recReliabilityBad') : t('jolive.ai.recReliabilityGood'),
      confidence: 80,
    });
  }

  // Pace vs target
  if (prod.paceGoodPerHr != null && prod.idealRatePerHr != null) {
    const ratio = prod.idealRatePerHr > 0 ? prod.paceGoodPerHr / prod.idealRatePerHr : 1;
    out.push({
      sev: ratio < 0.7 ? 'high' : ratio < 0.9 ? 'medium' : 'good',
      title: ratio >= 0.9 ? t('jolive.ai.onPace', { pace: Math.round(prod.paceGoodPerHr) }) : t('jolive.ai.behindPace', { pct: Math.round((1 - ratio) * 100) }),
      detail: t('jolive.ai.paceDetail', { pace: Math.round(prod.paceGoodPerHr), ideal: Math.round(prod.idealRatePerHr) }) + (prod.etaMins != null ? ' ' + t('jolive.ai.etaToTarget', { eta: fmtMins(prod.etaMins) }) : ''),
      rec: ratio < 0.9 ? t('jolive.ai.recPaceBad') : t('jolive.ai.recPaceGood'),
      confidence: 83,
    });
  }

  const sevRank = { high: 0, medium: 1, low: 2, good: 3 };
  return out.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || b.confidence - a.confidence);
}

const AI_SEV: Record<string, { cls: string; labelKey: string }> = {
  high: { cls: 'border-red-500/40 bg-red-500/5 text-red-400', labelKey: 'jolive.ai.sevHigh' },
  medium: { cls: 'border-amber-500/40 bg-amber-500/5 text-amber-400', labelKey: 'jolive.ai.sevMedium' },
  low: { cls: 'border-blue-500/40 bg-blue-500/5 text-blue-400', labelKey: 'jolive.ai.sevInfo' },
  good: { cls: 'border-green-500/40 bg-green-500/5 text-green-400', labelKey: 'jolive.ai.sevHealthy' },
};

function AiAnalysisPanel({ d }: { d: any }) {
  const { t } = useTranslation('production');
  const insights = useMemo(() => buildAiInsights(d, t), [d, t]);
  const high = insights.filter((i) => i.sev === 'high').length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <KpiTile icon={<Sparkles className="w-4 h-4" />} label={t('jolive.ai.insights')} value={insights.length} sub={t('jolive.ai.ruleBasedDetectors')} />
        <KpiTile icon={<AlertTriangle className="w-4 h-4" />} label={t('jolive.ai.highPriority')} value={high} tone={high > 0 ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'} />
        <KpiTile icon={<GaugeIcon className="w-4 h-4" />} label={t('jolive.oeeSchedule')} value={d.oee.joOEE != null ? `${d.oee.joOEE}%` : '—'} />
        <KpiTile icon={<GaugeIcon className="w-4 h-4" />} label={t('jolive.oeeTimeBased')} value={d.oee.oeeTimeBased != null ? `${d.oee.oeeTimeBased}%` : '—'} />
      </div>
      <div className="space-y-2">
        {insights.map((it, i) => {
          const s = AI_SEV[it.sev];
          return (
            <div key={i} className={`rounded-lg border px-3 py-2.5 ${s.cls}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{it.title}</p>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] px-1.5 py-0.5 rounded border border-current font-bold">{t(s.labelKey)}</span>
                  <span className="text-[10px] text-muted-foreground">{it.confidence}%</span>
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">{it.detail}</p>
              <p className="text-[11px] mt-1 flex items-start gap-1.5"><Sparkles className="w-3 h-3 mt-0.5 shrink-0 text-brand-400" /><span className="text-foreground/90">{it.rec}</span></p>
            </div>
          );
        })}
        {insights.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">{t('jolive.ai.notEnoughData')}</div>}
      </div>
    </div>
  );
}

// ── Shift data analysis (current shift window, factory-wide) ──
function ShiftAnalysisPanel({ shift, currentMachineId }: { shift: any; currentMachineId?: string }) {
  const { t: tr } = useTranslation('production');
  if (!shift?.status?.active) {
    return <div className="text-xs text-muted-foreground py-8 text-center">{tr('jolive.noActiveShift')}</div>;
  }
  const t = shift.totals;

  return (
    <div className="space-y-4">
      {/* Shift identity + progress */}
      <ShiftSummaryBand shift={shift} />

      {/* Shift KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <KpiTile icon={<Package className="w-4 h-4" />} label={`${tr('jolive.finished')} · ${t.unit ?? tr('jolive.base')}`} value={t.good.toLocaleString()} sub={tr('jolive.terminalStepBaseUnit')} tone="bg-green-500/15 text-green-400" />
        <KpiTile icon={<AlertTriangle className="w-4 h-4" />} label={tr('jolive.scrapShift')} value={t.scrap.toLocaleString()} sub={tr('jolive.inUnit', { unit: t.unit ?? tr('jolive.base') })} tone="bg-red-500/15 text-red-400" />
        <KpiTile icon={<CheckCircle2 className="w-4 h-4" />} label={tr('jolive.quality')} value={t.quality != null ? `${t.quality}%` : '—'} />
        <KpiTile icon={<Zap className="w-4 h-4" />} label={tr('jolive.pace')} value={t.paceGoodPerHr != null ? `${t.paceGoodPerHr.toLocaleString()}/hr` : '—'} sub={t.projectedGood != null ? tr('jolive.projected', { value: t.projectedGood.toLocaleString() }) : undefined} />
        <KpiTile icon={<Cpu className="w-4 h-4" />} label={tr('jolive.running')} value={`${t.runningMachines}/${t.totalMachines}`} sub={tr('jolive.machines')} />
        <KpiTile icon={<Timer className="w-4 h-4" />} label={tr('jolive.downtime')} value={fmtMins(t.downtimeMins)} sub={tr('jolive.unplannedSuffix', { value: fmtMins(t.unplannedDownMins) })} tone="bg-amber-500/15 text-amber-400" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per-machine breakdown — own packaging unit + base-unit equivalent */}
        <SectionCard title={tr('jolive.machinesThisShift')} icon={<Cpu className="w-4 h-4 text-brand-400" />}
          right={<span className="text-[10px] text-muted-foreground">{tr('jolive.finishedGoodsStepLegend')}</span>}>
          <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
            {shift.machines.map((m: any) => (
              <div key={m.id} className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${m.id === currentMachineId ? 'border-brand-400/50 bg-brand-500/5' : 'border-border/40 bg-background/40'}`}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: STATE_COLORS[m.state] ?? '#64748b' }} />
                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0">{m.code}</span>
                <span className="text-sm font-medium truncate flex-1 flex items-center gap-1">
                  {m.isTerminal && <span className="text-amber-400" title={tr('jolive.finishedGoodsTerminalStep')}>★</span>}
                  {m.name}
                  {m.id === currentMachineId && <span className="text-[9px] text-brand-400 ml-1">{tr('jolive.thisJo')}</span>}
                </span>
                <span className="text-xs text-green-400 tabular-nums">
                  {m.good.toLocaleString()}<span className="text-[9px] text-muted-foreground ml-0.5">{m.unit ?? ''}</span>
                </span>
                {m.unit && m.goodBase !== m.good && (
                  <span className="text-[10px] text-muted-foreground tabular-nums" title={tr('jolive.baseUnitEquivalent')}>≈{m.goodBase.toLocaleString()}</span>
                )}
                {m.scrap > 0 && <span className="text-[10px] text-red-400 tabular-nums">✗{m.scrap}</span>}
                {m.oee != null && <span className="text-[10px] text-muted-foreground tabular-nums w-12 text-right">OEE {Math.round(m.oee)}%</span>}
              </div>
            ))}
            {shift.machines.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">{tr('jolive.noMachines')}</div>}
          </div>
        </SectionCard>

        {/* Shift downtime reasons */}
        <SectionCard title={tr('jolive.shiftDowntimeReasons')} icon={<PieIcon className="w-4 h-4 text-brand-400" />}
          right={<span className="text-[10px] text-muted-foreground">{tr('jolive.eventsCount', { count: shift.downtime.occurrences })} · {fmtMins(shift.downtime.totalMins)}</span>}>
          {shift.downtime.byReason.length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">{tr('jolive.noDowntimeShift')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={shift.downtime.byReason} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="label" tick={{ fontSize: 10 }} width={120} stroke="hsl(var(--muted-foreground))" />
                <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [fmtMins(v as number), tr('jolive.duration')]} />
                <Bar dataKey="mins" name={tr('jolive.duration')} fill="#dc2626" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </SectionCard>
      </div>
    </div>
  );
}

// ── OEE Industry Benchmarks & Standards — both availability methods compared ──
function classify(v: number | null) {
  return v == null ? null : v >= 85 ? 'WORLD_CLASS' : v >= 70 ? 'GOOD' : v >= 60 ? 'FAIR' : 'POOR';
}
function IndustryBenchmarks({ oeeValue, oeeTimeBasedValue }: { oeeValue: number | null; oeeTimeBasedValue: number | null }) {
  const { t } = useTranslation('production');
  const levels = [
    { name: t('jolive.bench.worldClass'), range: '85%+', desc: t('jolive.bench.worldClassDesc'), key: 'WORLD_CLASS' },
    { name: t('jolive.bench.good'), range: '70–85%', desc: t('jolive.bench.goodDesc'), key: 'GOOD' },
    { name: t('jolive.bench.fair'), range: '60–70%', desc: t('jolive.bench.fairDesc'), key: 'FAIR' },
    { name: t('jolive.bench.poor'), range: '<60%', desc: t('jolive.bench.poorDesc'), key: 'POOR' },
  ];
  const industries = [
    [t('jolive.ind.automotive'), '60–75%'], [t('jolive.ind.foodBeverage'), '50–65%'], [t('jolive.ind.pharmaceuticals'), '65–80%'],
    [t('jolive.ind.electronics'), '70–85%'], [t('jolive.ind.packaging'), '55–70%'], [t('jolive.ind.textiles'), '45–60%'],
  ];
  const schedLevel = classify(oeeValue);
  const tbLevel = classify(oeeTimeBasedValue);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-muted-foreground">{t('jolive.oeePerformanceLevels')}</p>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-400" />{t('jolive.schedule')} {oeeValue != null ? `${oeeValue}%` : '—'}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />{t('jolive.timeBased')} {oeeTimeBasedValue != null ? `${oeeTimeBasedValue}%` : '—'}</span>
          </div>
        </div>
        <div className="space-y-2">
          {levels.map((l) => {
            const isSched = schedLevel === l.key;
            const isTb = tbLevel === l.key;
            return (
              <div key={l.key} className={`rounded-lg border px-3 py-2 flex items-center justify-between ${BENCH[l.key].bg} ${isSched || isTb ? 'ring-2 ring-current' : ''}`}>
                <div>
                  <div className="text-sm font-bold flex items-center gap-1.5 flex-wrap">
                    {l.name}
                    {isSched && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/40 font-semibold">{t('jolive.schedule')}</span>}
                    {isTb && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40 font-semibold">{t('jolive.timeBased')}</span>}
                  </div>
                  <div className="text-[10px] opacity-80">{l.desc}</div>
                </div>
                <span className="text-sm font-bold">{l.range}</span>
              </div>
            );
          })}
        </div>
        {schedLevel && tbLevel && schedLevel !== tbLevel && (
          <p className="text-[10px] text-muted-foreground mt-2">
            {t('jolive.benchTiersNote')}
          </p>
        )}
      </div>
      <div>
        <p className="text-xs font-bold text-muted-foreground mb-2">{t('jolive.industryTypicalOee')}</p>
        <div className="space-y-1.5">
          {industries.map(([name, range]) => (
            <div key={name} className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 flex items-center justify-between">
              <span className="text-sm">{name}</span>
              <span className="text-sm font-bold tabular-nums">{range}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main page component
// ─────────────────────────────────────────────────────────────

export function JOLiveDashboard({ jobOrderId }: { jobOrderId: string }) {
  const { t } = useTranslation('production');
  const router = useRouter();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [actionKind, setActionKind] = useState<'maintenance' | 'state' | 'alarm' | 'downtime' | null>(null);
  const [machineSel, setMachineSel] = useState<string[]>([]);
  const [poSel, setPoSel] = useState('');
  const [woSel, setWoSel] = useState('');

  const { data, isLoading, isError, error, dataUpdatedAt } = useQuery({
    queryKey: ['jo-live', jobOrderId],
    queryFn: () => api.get(`/production/job-orders/${jobOrderId}/live`),
    refetchInterval: 5_000,
  });

  // JO switcher — jump between live job orders from the same page
  const { data: allJos } = useQuery({
    queryKey: ['shop-floor-jobs', 'switcher'],
    queryFn: () => api.get('/production/job-orders'),
    staleTime: 30_000,
  });

  // Shift analysis (factory-wide, current shift window)
  const { data: shiftData } = useQuery({
    queryKey: ['shift-analysis'],
    queryFn: () => api.get('/shifts/analysis'),
    refetchInterval: 30_000,
  });

  const d: any = data;
  const jo = d?.jobOrder;

  // Register a friendly breadcrumb label for this id segment (replaces the raw UUID)
  const setCrumb = useBreadcrumbStore((s) => s.setLabel);
  const clearCrumb = useBreadcrumbStore((s) => s.clearLabel);
  useEffect(() => {
    if (jo) setCrumb(jobOrderId, `#${jo.sequenceOrder} ${jo.operationName}`);
    return () => clearCrumb(jobOrderId);
  }, [jo?.sequenceOrder, jo?.operationName, jobOrderId, setCrumb, clearCrumb]);

  const target: JOActionTarget | null = jo ? {
    jobOrderId: jo.id,
    workOrderId: jo.workOrder?.id,
    machineId: d.machine?.id,
    machineName: d.machine?.name,
    operationName: jo.operationName,
  } : null;

  // ── Smart filters (same bar as the Shop Floor) → narrow the job-order nav chips ──
  const jobs = (allJos as any[]) ?? [];
  const machineOptions = useMemo(() => {
    const m = new Map<string, { id: string; name: string; code: string; count: number }>();
    for (const j of jobs) if (j.machine?.id) {
      const cur = m.get(j.machine.id) ?? { id: j.machine.id, name: j.machine.name, code: j.machine.code, count: 0 };
      cur.count += 1; m.set(j.machine.id, cur);
    }
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [jobs]);
  const poOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs) { const po = j.workOrder?.productionOrder; if (po?.id) m.set(po.id, po.orderNumber); }
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [jobs]);
  const woOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const j of jobs) { if (poSel && j.workOrder?.productionOrder?.id !== poSel) continue; if (j.workOrder?.id) m.set(j.workOrder.id, j.workOrder.orderNumber); }
    return [...m.entries()].map(([value, label]) => ({ value, label })).sort((a, b) => String(a.label).localeCompare(String(b.label)));
  }, [jobs, poSel]);

  const navJobs = useMemo(() => jobs
    .filter((j) => !machineSel.length || (j.machine?.id && machineSel.includes(j.machine.id)))
    .filter((j) => !poSel || j.workOrder?.productionOrder?.id === poSel)
    .filter((j) => !woSel || j.workOrder?.id === woSel)
    .filter((j) => ['READY', 'EXECUTING', 'PAUSED', 'COMPLETE'].includes(j.status))
    .sort((a, b) => (a.workOrder?.orderNumber ?? '').localeCompare(b.workOrder?.orderNumber ?? '') || a.sequenceOrder - b.sequenceOrder),
    [jobs, machineSel, poSel, woSel]);

  // Make the filters actually DO something: when a filter excludes the current job
  // order, jump to the first matching one so picking a machine/PO/WO navigates.
  useEffect(() => {
    if (!navJobs.length) return;
    if (!navJobs.some((j: any) => j.id === jobOrderId)) {
      router.push(`/shop-floor/live/${navJobs[0].id}`);
    }
  }, [navJobs, jobOrderId, router]);

  // Trend series → chart data
  const trendData = useMemo(() => {
    const t = d?.production?.trend ?? [];
    return t.filter((p: any) => p.type === 'COUNT_UPDATE' || p.good != null).map((p: any) => ({
      time: fmtTime(p.t),
      delta: Math.max(0, p.delta ?? 0),
      scrapDelta: p.scrapDelta ?? 0,
      good: p.good,
      rejected: p.rejected,
    }));
  }, [d]);

  // Alarm mutations
  const ackMut = useMutation({
    mutationFn: (id: string) => api.patch(`/alarms/${id}/acknowledge`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jo-live'] }); toast({ title: t('jolive.toast.alarmAcknowledged') }); },
    onError: (e: any) => toast({ variant: 'destructive', title: t('jolive.toast.failed'), description: e?.response?.data?.message }),
  });
  const resolveMut = useMutation({
    mutationFn: (id: string) => api.patch(`/alarms/${id}/resolve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['jo-live'] }); toast({ title: t('jolive.toast.alarmResolved') }); },
    onError: (e: any) => toast({ variant: 'destructive', title: t('jolive.toast.failed'), description: e?.response?.data?.message }),
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <div className="shimmer h-16 rounded-2xl" />
        <div className="grid grid-cols-4 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-40 rounded-2xl" />)}</div>
        <div className="shimmer h-80 rounded-2xl" />
      </div>
    );
  }
  if (isError || !d) {
    return (
      <div className="p-10 text-center space-y-3">
        <AlertTriangle className="w-10 h-10 text-red-400 mx-auto" />
        <p className="font-semibold">{t('jolive.couldNotLoad')}</p>
        <p className="text-sm text-muted-foreground">{(error as any)?.response?.data?.message ?? t('jolive.notFound')}</p>
        <Button variant="outline" onClick={() => router.push('/shop-floor')}>
          <ArrowLeft className="w-4 h-4 mr-2" />{t('jolive.backToShopFloor')}
        </Button>
      </div>
    );
  }

  const oee = d.oee;
  const prod = d.production;
  const dt = d.downtime;
  const isLive = d.window.isLive;

  return (
    <div className="min-h-screen bg-background">
      {/* ── Header ── */}
      <div className="sticky top-0 z-30 bg-background/90 backdrop-blur-lg border-b border-border/60 px-4 py-3">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-3 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => router.push('/shop-floor')}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div className="flex items-center gap-2">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center border ${isLive ? 'bg-green-500/15 border-green-400/30' : 'bg-muted border-border'}`}>
              <Activity className={`w-5 h-5 ${isLive ? 'text-green-400 animate-pulse' : 'text-muted-foreground'}`} />
            </div>
            <div>
              <div className="text-base font-bold leading-none flex items-center gap-2">
                #{jo.sequenceOrder} {jo.operationName}
                <Badge variant={jo.status === 'EXECUTING' ? 'success' : jo.status === 'PAUSED' ? 'warning' : jo.status === 'COMPLETE' ? 'success' : 'secondary'} className="text-[10px]">
                  {jo.status}
                </Badge>
                {isLive && <span className="text-[10px] text-green-400 font-bold tracking-wider">● {t('jolive.live')}</span>}
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                {jo.workOrder?.orderNumber} · {jo.workOrder?.productionOrder?.orderNumber} · {jo.workOrder?.sku?.name}
                {' · '}{t('jolive.updated')} {fmtTime(new Date(dataUpdatedAt))}
              </p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 flex-wrap">
            <Button variant="outline" size="sm" className="text-amber-400 border-amber-400/40" onClick={() => setActionKind('maintenance')}>
              <Wrench className="w-3.5 h-3.5 mr-1.5" />{t('jolive.maintenance')}
            </Button>
            <Button variant="outline" size="sm" className="text-red-400 border-red-400/40" onClick={() => setActionKind('downtime')}>
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />{t('jolive.logDowntime')}
            </Button>
            <Button variant="outline" size="sm" className="text-orange-400 border-orange-400/40" onClick={() => setActionKind('state')}>
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />{t('jolive.state')}
            </Button>
            <Button variant="outline" size="sm" className="text-red-400 border-red-400/40" onClick={() => setActionKind('alarm')}>
              <BellRing className="w-3.5 h-3.5 mr-1.5" />{t('jolive.alarm')}
              {d.alarms.active > 0 && (
                <span className="ml-1.5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">{d.alarms.active}</span>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['jo-live', jobOrderId] })}>
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-screen-2xl mx-auto p-4 space-y-4">
        {/* ── Smart filters (same as Shop Floor) — switch job order via WO/machine ── */}
        <JobFilterBar
          machines={machineOptions}
          pos={poOptions}
          wos={woOptions}
          machineSel={machineSel}
          onMachineSel={setMachineSel}
          po={poSel}
          onPo={setPoSel}
          wo={woSel}
          onWo={setWoSel}
          right={
            navJobs.length > 0 ? (
              <SelectMenu
                value={jobOrderId}
                onValueChange={(v) => v && v !== jobOrderId && router.push(`/shop-floor/live/${v}`)}
                options={navJobs.map((j: any) => ({
                  value: j.id,
                  label: `${j.workOrder?.orderNumber ?? ''} · #${j.sequenceOrder} ${j.operationName} (${j.status})`,
                }))}
                placeholder={t('jolive.switchJobOrder')}
                size="sm"
              />
            ) : (
              <span className="text-xs text-muted-foreground">{t('jolive.noMatchingJobOrders')}</span>
            )
          }
        />

        {/* ── This job order's shift context (below the filters) ── */}
        {(shiftData as any)?.status?.active && (
          <JobShiftBand
            status={(shiftData as any).status}
            machine={((shiftData as any).machines ?? []).find((m: any) => m.id === d.machine?.id)}
            machineName={d.machine?.name}
          />
        )}

        {/* ── Open downtime banner ── */}
        {dt.open && (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 animate-pulse shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold text-red-400">{t('jolive.machineInDowntimeSince', { time: fmtTime(dt.open.startTime) })}</p>
              <p className="text-xs text-muted-foreground">
                {dt.open.cause?.name ?? dt.open.reason ?? dt.open.reasonCode} · {dt.open.category}
              </p>
            </div>
            <Button size="sm" variant="outline" className="text-green-400 border-green-400/40" onClick={() => setActionKind('state')}>
              <Check className="w-3.5 h-3.5 mr-1.5" />{t('jolive.resolve')}
            </Button>
          </div>
        )}

        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="overview"><GaugeIcon className="w-3.5 h-3.5 mr-1.5" />{t('jolive.tab.overview')}</TabsTrigger>
            <TabsTrigger value="production"><TrendingUp className="w-3.5 h-3.5 mr-1.5" />{t('jolive.tab.production')}</TabsTrigger>
            <TabsTrigger value="losses"><PieIcon className="w-3.5 h-3.5 mr-1.5" />{t('jolive.tab.losses')}</TabsTrigger>
            <TabsTrigger value="quality"><CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />{t('jolive.tab.quality')}</TabsTrigger>
            <TabsTrigger value="alarms">
              <BellRing className="w-3.5 h-3.5 mr-1.5" />{t('jolive.tab.alarms')}
              {d.alarms.active > 0 && <span className="ml-1.5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">{d.alarms.active}</span>}
            </TabsTrigger>
            <TabsTrigger value="maintenance">
              <Wrench className="w-3.5 h-3.5 mr-1.5" />{t('jolive.tab.maintenance')}
              {d.maintenance.open > 0 && <span className="ml-1.5 px-1.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">{d.maintenance.open}</span>}
            </TabsTrigger>
            <TabsTrigger value="shift"><Clock className="w-3.5 h-3.5 mr-1.5" />{t('jolive.tab.shift')}</TabsTrigger>
            <TabsTrigger value="standards"><Sparkles className="w-3.5 h-3.5 mr-1.5" />{t('jolive.tab.standards')}</TabsTrigger>
          </TabsList>

          {/* ═══════════ OVERVIEW ═══════════ */}
          <TabsContent value="overview" className="space-y-4 mt-4">
            {/* OEE & dual-availability — full width */}
            <SectionCard title={t('jolive.oeeAvailabilityTwoMethods')} icon={<GaugeIcon className="w-4 h-4 text-brand-400" />}
              right={
                <div className="flex items-center gap-1.5">
                  <BenchBadge cls={oee.oeeClass} />
                  <span className="text-muted-foreground/40">vs</span>
                  <BenchBadge cls={oee.oeeTimeBasedClass} />
                </div>
              }>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
                {/* Gauges: dual OEE + Performance + Quality */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-center justify-items-center">
                  <Gauge value={oee.joOEE} label={t('jolive.oeeScheduleShort')} cls={oee.oeeClass} size={118} />
                  <Gauge value={oee.oeeTimeBased} label={t('jolive.oeeTimeBasedShort')} cls={oee.oeeTimeBasedClass} size={118} />
                  <Gauge value={oee.joPerformance} label={t('jolive.performance')} cls={oee.performanceClass} size={92} />
                  <Gauge value={oee.joQuality} label={t('jolive.quality')} cls={oee.qualityClass} size={92} />
                </div>

                {/* Two availability methods side by side */}
                <div className="grid sm:grid-cols-2 gap-3">
                  <AvailabilityMethod
                    title={t('jolive.scheduleBased')} subtitle={t('jolive.scheduleBasedSub')}
                    value={oee.joAvailability} cls={oee.availabilityClass}
                    formula={t('jolive.formulaSchedule')}
                    oeeValue={oee.joOEE} oeeCls={oee.oeeClass}
                    rows={[[t('jolive.window'), fmtMins(d.window.minutes)], [t('jolive.utilization'), oee.utilizationPct != null ? `${oee.utilizationPct}%` : '—']]}
                  />
                  <AvailabilityMethod
                    title={t('jolive.timeBased')} subtitle={t('jolive.timeBasedSub')}
                    value={oee.availabilityTimeBased} cls={oee.availabilityTimeBasedClass}
                    formula={t('jolive.formulaTimeBased')}
                    oeeValue={oee.oeeTimeBased} oeeCls={oee.oeeTimeBasedClass}
                    rows={[[t('jolive.uptime'), fmtMins(oee.uptimeMins)], [t('jolive.downtime'), fmtMins(oee.downtimeMins)]]}
                    highlight
                  />
                </div>
              </div>

              {/* TEEP (both) + utilization */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-4 pt-3 border-t border-border/40">
                <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">{t('jolive.teepSchedule')}</div>
                    <div className="text-[9px] text-muted-foreground">{t('jolive.teepScheduleFormula')}</div>
                  </div>
                  <span className="text-lg font-bold tabular-nums">{oee.teepPct != null ? `${oee.teepPct}%` : '—'}</span>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] uppercase text-muted-foreground">{t('jolive.teepTimeBased')}</div>
                    <div className="text-[9px] text-muted-foreground">{t('jolive.teepTimeBasedFormula')}</div>
                  </div>
                  <span className="text-lg font-bold tabular-nums">{oee.teepTimeBasedPct != null ? `${oee.teepTimeBasedPct}%` : '—'}</span>
                </div>
                <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 flex items-center justify-between">
                  <div className="text-[10px] uppercase text-muted-foreground">{t('jolive.utilization')}</div>
                  <span className="text-lg font-bold tabular-nums">{oee.utilizationPct != null ? `${oee.utilizationPct}%` : '—'}</span>
                </div>
              </div>
            </SectionCard>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Production summary */}
              <SectionCard title={t('jolive.production')} icon={<Package className="w-4 h-4 text-brand-400" />}>
                <div className="space-y-3">
                  <div>
                    <div className="flex items-end justify-between mb-1">
                      <span className="text-3xl font-bold tabular-nums">{prod.good.toLocaleString()}</span>
                      <span className="text-sm text-muted-foreground">/ {prod.plannedQty?.toLocaleString() ?? '—'} {prod.unit ?? ''}</span>
                    </div>
                    <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${prod.progressPct ?? 0}%` }} />
                    </div>
                    <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
                      <span>{t('jolive.percentComplete', { pct: prod.progressPct ?? 0 })}</span>
                      {prod.rejected > 0 && <span className="text-red-400">{t('jolive.rejectedCount', { count: prod.rejected, rate: prod.rejectRatePct })}</span>}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <KpiTile icon={<Zap className="w-4 h-4" />} label={t('jolive.pace')} value={prod.paceGoodPerHr != null ? `${Math.round(prod.paceGoodPerHr).toLocaleString()}/hr` : '—'}
                      sub={prod.idealRatePerHr != null ? t('jolive.idealRate', { rate: Math.round(prod.idealRatePerHr).toLocaleString() }) : undefined}
                      tone={prod.paceGoodPerHr != null && prod.idealRatePerHr != null && prod.paceGoodPerHr >= prod.idealRatePerHr * 0.85 ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'} />
                    <KpiTile icon={<Clock className="w-4 h-4" />} label="ETA" value={prod.etaMins != null ? fmtMins(prod.etaMins) : '—'} sub={t('jolive.toTargetAtPace')} />
                    <KpiTile icon={<Timer className="w-4 h-4" />} label={t('jolive.window')} value={fmtMins(d.window.minutes)} sub={isLive ? t('jolive.runningStatus') : t('jolive.completedStatus')} />
                    <KpiTile icon={<Target className="w-4 h-4" />} label={t('jolive.cycleTime')} value={prod.idealCycleTimeSec != null ? `${prod.idealCycleTimeSec}s` : '—'} sub={t('jolive.idealPerUnit')} />
                  </div>
                </div>
              </SectionCard>

              {/* Context: machine + operator + order */}
              <SectionCard title={t('jolive.context')} icon={<Layers className="w-4 h-4 text-brand-400" />}>
                <div className="space-y-2 text-sm">
                  {d.machine && (
                    <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 flex items-center gap-2">
                      <Cpu className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold truncate">{d.machine.name} <span className="font-mono text-xs text-muted-foreground">({d.machine.code})</span></p>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {d.machine.area?.name}{d.machine.line ? ` · ${d.machine.line.name}` : ''}
                        </p>
                      </div>
                      {d.machine.currentStatus && (
                        <span className="text-[10px] font-bold px-2 py-1 rounded-full border"
                          style={{ color: STATE_COLORS[d.machine.currentStatus.state], borderColor: `${STATE_COLORS[d.machine.currentStatus.state]}55`, backgroundColor: `${STATE_COLORS[d.machine.currentStatus.state]}15` }}>
                          {d.machine.currentStatus.state}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span>{jo.operator?.name ?? <span className="text-muted-foreground italic">{t('jolive.noOperatorAssigned')}</span>}</span>
                  </div>
                  <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('jolive.workOrder')}</span><span className="font-mono">{jo.workOrder?.orderNumber}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('jolive.productionOrder')}</span><span className="font-mono">{jo.workOrder?.productionOrder?.orderNumber ?? '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('jolive.product')}</span><span className="truncate ml-2">{jo.workOrder?.sku?.name}</span></div>
                    {jo.workOrder?.productionOrder?.customer && (
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('jolive.customer')}</span><span>{jo.workOrder.productionOrder.customer}</span></div>
                    )}
                    <div className="flex justify-between"><span className="text-muted-foreground">{t('jolive.started')}</span><span>{jo.actualStart ? fmtDT(jo.actualStart) : '—'}</span></div>
                    {jo.predecessor && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('jolive.predecessor')} ({jo.depType?.split('_').map((w: string) => w[0]).join('') ?? 'FS'})</span>
                        <span>{jo.predecessor.operationName} · {jo.predecessor.status}</span>
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>
            </div>

            {/* OEE trend — classic vs time-based, from the InfluxDB historian */}
            <SectionCard title={t('jolive.oeeTrendTitle')} icon={<TrendingUp className="w-4 h-4 text-brand-400" />}
              right={<span className="text-[10px] text-muted-foreground">{t('jolive.tsdbHistory')}</span>}>
              <MetricTrend data={oee.trend ?? []} mode="oee" />
            </SectionCard>

            {/* Machine status timeline */}
            {d.machine && (
              <SectionCard title={t('jolive.machineStatusTimeline')} icon={<BarChart2 className="w-4 h-4 text-brand-400" />}>
                <StateTimeline records={d.machine.stateTimeline ?? []} windowStart={d.window.start} windowEnd={d.window.end} />
              </SectionCard>
            )}

            {/* Six losses quick view */}
            <SectionCard title={t('jolive.sixBigLosses')} icon={<ShieldAlert className="w-4 h-4 text-brand-400" />}>
              <SixLossesPanel sl={d.sixLosses} />
            </SectionCard>
          </TabsContent>

          {/* ═══════════ PRODUCTION & TRENDS ═══════════ */}
          <TabsContent value="production" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiTile icon={<Package className="w-4 h-4" />} label={t('jolive.produced')} value={prod.total.toLocaleString()} sub={t('jolive.goodRejected', { good: prod.good.toLocaleString(), rejected: prod.rejected })} />
              <KpiTile icon={<Zap className="w-4 h-4" />} label={t('jolive.rate')} value={prod.paceGoodPerHr != null ? `${Math.round(prod.paceGoodPerHr).toLocaleString()}/hr` : '—'}
                sub={prod.idealRatePerHr != null ? t('jolive.goalRate', { rate: Math.round(prod.idealRatePerHr).toLocaleString() }) : undefined}
                tone={prod.paceGoodPerHr != null && prod.idealRatePerHr != null && prod.paceGoodPerHr >= prod.idealRatePerHr * 0.85 ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'} />
              <KpiTile icon={prod.paceGoodPerHr != null && prod.idealRatePerHr != null && prod.paceGoodPerHr >= prod.idealRatePerHr ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                label={t('jolive.diffToGoal')}
                value={prod.paceGoodPerHr != null && prod.idealRatePerHr != null && prod.idealRatePerHr > 0
                  ? `${(((prod.paceGoodPerHr - prod.idealRatePerHr) / prod.idealRatePerHr) * 100).toFixed(1)}%` : '—'}
                tone={prod.paceGoodPerHr != null && prod.idealRatePerHr != null && prod.paceGoodPerHr >= prod.idealRatePerHr ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'} />
              <KpiTile icon={<Clock className="w-4 h-4" />} label={t('jolive.etaToTarget')} value={prod.etaMins != null ? fmtMins(prod.etaMins) : '—'} />
            </div>

            <SectionCard title={t('jolive.productionOverTime')} icon={<BarChart2 className="w-4 h-4 text-brand-400" />}
              right={<span className="text-[10px] text-muted-foreground">{t('jolive.fromCountEvents')}</span>}>
              {trendData.length === 0 ? (
                <div className="text-xs text-muted-foreground py-8 text-center">
                  {t('jolive.noCountEvents')}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip {...CHART_TOOLTIP} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="delta" name={t('jolive.producedDelta')} fill="#0e7490" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="scrapDelta" name={t('jolive.scrapDelta')} fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title={t('jolive.targetTrending')} icon={<TrendingUp className="w-4 h-4 text-brand-400" />}>
              {trendData.length === 0 ? (
                <div className="text-xs text-muted-foreground py-8 text-center">{t('jolive.noDataYet')}</div>
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip {...CHART_TOOLTIP} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {prod.plannedQty != null && (
                      <ReferenceLine y={prod.plannedQty} stroke="#f97316" strokeDasharray="6 3"
                        label={{ value: t('jolive.targetValue', { value: prod.plannedQty }), fontSize: 10, fill: '#f97316', position: 'insideTopRight' }} />
                    )}
                    <Line type="monotone" dataKey="good" name={t('jolive.goodCumulative')} stroke="#22c55e" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="rejected" name={t('jolive.rejectedCumulative')} stroke="#ef4444" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </SectionCard>
          </TabsContent>

          {/* ═══════════ DOWNTIME & LOSSES ═══════════ */}
          <TabsContent value="losses" className="space-y-4 mt-4">
            {/* Availability / reliability KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
              <KpiTile icon={<CheckCircle2 className="w-4 h-4" />} label={t('jolive.netProduction')} value={fmtMins(d.timeModel.netProductionMins)} tone="bg-green-500/15 text-green-400" />
              <KpiTile icon={<TrendingDown className="w-4 h-4" />} label={t('jolive.availabilityLoss')} value={fmtMins(d.timeModel.availabilityLossMins)} tone="bg-red-500/15 text-red-400" />
              <KpiTile icon={<Timer className="w-4 h-4" />} label={t('jolive.occurrences')} value={dt.occurrences} sub={t('jolive.medAvg', { med: fmtMins(dt.medianMins), avg: fmtMins(dt.avgMins) })} />
              <KpiTile icon={<Wrench className="w-4 h-4" />} label="MTTR" value={fmtMins(dt.mttrMins)} sub={t('jolive.mttrSub', { days: dt.reliabilityWindowDays })} tone="bg-amber-500/15 text-amber-400" />
              <KpiTile icon={<Activity className="w-4 h-4" />} label="MTBF" value={fmtMins(dt.mtbfMins)} sub={t('jolive.am.betweenFailures')} tone="bg-blue-500/15 text-blue-400" />
              <KpiTile icon={<BellRing className="w-4 h-4" />} label="MTTA" value={fmtMins(dt.mttaMins)} sub={t('jolive.mttaSub')} tone="bg-purple-500/15 text-purple-400" />
            </div>

            {/* Availability metrics concept */}
            <SectionCard title={t('jolive.availabilityMetrics')} icon={<Crosshair className="w-4 h-4 text-brand-400" />}>
              <AvailabilityMetricsDiagram dt={dt} />
            </SectionCard>

            {/* Time model % waterfall + state distribution */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SectionCard title={t('jolive.timeModelOverview')} icon={<BarChart2 className="w-4 h-4 text-brand-400" />}
                right={oee.teepPct != null ? <Badge variant="info" className="text-[10px]">TEEP {oee.teepPct}%</Badge> : undefined}>
                <PercentWaterfall tm={d.timeModel} />
              </SectionCard>
              <SectionCard title={t('jolive.statusReasonsByDuration')} icon={<PieIcon className="w-4 h-4 text-brand-400" />}>
                <StateDistribution sd={d.stateDistribution} />
              </SectionCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {/* Downtime Pareto */}
              <SectionCard title={t('jolive.topDowntimeReasons')} icon={<PieIcon className="w-4 h-4 text-brand-400" />}>
                <ParetoChart rows={dt.pareto} />
              </SectionCard>
              {/* Microstop Pareto */}
              <SectionCard title={t('jolive.topMicrostopReasons')} icon={<Zap className="w-4 h-4 text-brand-400" />}
                right={<span className="text-[10px] text-muted-foreground">{t('jolive.performanceLossUnder5')}</span>}>
                <ParetoChart rows={dt.microstopPareto} />
              </SectionCard>
            </div>

            {/* Downtime events list */}
            <SectionCard title={t('jolive.downtimeEvents')} icon={<ListChecks className="w-4 h-4 text-brand-400" />}
              right={<span className="text-[10px] text-muted-foreground">{t('jolive.unplannedPlanned', { unplanned: fmtMins(dt.unplannedMins), planned: fmtMins(dt.plannedMins) })}</span>}>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {dt.events.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">{t('jolive.noEvents')}</div>}
                {dt.events.map((ev: any) => (
                  <div key={ev.id} className={`rounded-lg border px-3 py-2 ${!ev.endTime ? 'border-red-500/40 bg-red-500/5' : 'border-border/40 bg-background/40'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-semibold truncate">
                        {ev.cause?.name ?? ev.reason ?? ev.reasonCode}
                        {!ev.endTime && <span className="text-red-400 ml-2 animate-pulse">● {t('jolive.open')}</span>}
                      </p>
                      <Badge variant={ev.isPlanned ? 'info' : 'destructive'} className="text-[10px] shrink-0">
                        {ev.isPlanned ? t('jolive.planned') : t('jolive.unplanned')}
                      </Badge>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {fmtDT(ev.startTime)} {ev.endTime ? `→ ${fmtTime(ev.endTime)}` : ''} · {ev.durationMinutes != null ? fmtMins(ev.durationMinutes) : t('jolive.ongoing')} · {ev.category}
                      {ev.operator?.name ? ` · ${t('jolive.byOperator', { name: ev.operator.name })}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </SectionCard>

            <SectionCard title={t('jolive.sixBigLossesDetail')} icon={<ShieldAlert className="w-4 h-4 text-brand-400" />}>
              <SixLossesPanel sl={d.sixLosses} />
            </SectionCard>
          </TabsContent>

          {/* ═══════════ QUALITY & SCRAP ═══════════ */}
          <TabsContent value="quality" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KpiTile icon={<Package className="w-4 h-4" />} label={t('jolive.produced')} value={prod.total.toLocaleString()} />
              <KpiTile icon={<Check className="w-4 h-4" />} label={t('jolive.good')} value={prod.good.toLocaleString()} tone="bg-green-500/15 text-green-400" />
              <KpiTile icon={<AlertTriangle className="w-4 h-4" />} label={t('jolive.rejected')} value={prod.rejected.toLocaleString()} tone="bg-red-500/15 text-red-400" />
              <KpiTile icon={<GaugeIcon className="w-4 h-4" />} label={t('jolive.rejectRate')} value={prod.rejectRatePct != null ? `${prod.rejectRatePct}%` : '—'}
                tone={prod.rejectRatePct != null && prod.rejectRatePct > 5 ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'} />
              <KpiTile icon={<Clock className="w-4 h-4" />} label={t('jolive.highestRejectsAt')} value={d.scrap.highestRejectAt ? fmtTime(d.scrap.highestRejectAt) : '—'}
                sub={d.scrap.highestRejectQty != null ? `${d.scrap.highestRejectQty} ${t('jolive.pcs')}` : undefined} />
            </div>

            {/* Good vs rejected ratio bar */}
            {prod.total > 0 && (
              <div className="h-3 rounded-full overflow-hidden flex border border-border/40">
                <div className="h-full bg-green-500" style={{ width: `${(prod.good / prod.total) * 100}%` }} />
                <div className="h-full bg-red-500" style={{ width: `${(prod.rejected / prod.total) * 100}%` }} />
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SectionCard title={t('jolive.scrapByCategory')} icon={<PieIcon className="w-4 h-4 text-brand-400" />}>
                {d.scrap.byCategory.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-8 text-center">{t('jolive.noScrapRecorded')}</div>
                ) : (
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={d.scrap.byCategory} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis type="number" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={90} stroke="hsl(var(--muted-foreground))" />
                      <RTooltip {...CHART_TOOLTIP} />
                      <Bar dataKey="qty" name={t('jolive.qty')} radius={[0, 3, 3, 0]}>
                        {d.scrap.byCategory.map((_c: any, i: number) => <Cell key={i} fill={SCRAP_COLORS[i % SCRAP_COLORS.length]} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </SectionCard>

              {/* Top reject reasons (Pareto-style list) */}
              <SectionCard title={t('jolive.topRejectReasons')} icon={<ListChecks className="w-4 h-4 text-brand-400" />}>
                {(!d.scrap.topReasons || d.scrap.topReasons.length === 0) ? (
                  <div className="text-xs text-muted-foreground py-8 text-center">{t('jolive.noRejectReasons')}</div>
                ) : (
                  <div className="space-y-2">
                    {d.scrap.topReasons.map((r: any, i: number) => {
                      const max = d.scrap.topReasons[0].qty || 1;
                      return (
                        <div key={i}>
                          <div className="flex items-center justify-between text-xs mb-0.5">
                            <span className="font-medium truncate flex items-center gap-2">
                              <span className="text-muted-foreground tabular-nums">{i + 1}.</span>{r.reason}
                              <Badge variant="outline" className="text-[9px] py-0">{r.category}</Badge>
                            </span>
                            <span className="tabular-nums text-muted-foreground">{r.qty} {t('jolive.pcs')} · {r.count}×</span>
                          </div>
                          <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${(r.qty / max) * 100}%`, backgroundColor: SCRAP_COLORS[i % SCRAP_COLORS.length] }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>
            </div>

            <SectionCard title={t('jolive.rejectsOverTime')} icon={<BarChart2 className="w-4 h-4 text-brand-400" />}>
              {trendData.filter((p: any) => p.scrapDelta > 0).length === 0 ? (
                <div className="text-xs text-muted-foreground py-8 text-center">{t('jolive.noRejectEvents')}</div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                    <RTooltip {...CHART_TOOLTIP} />
                    <Bar dataKey="scrapDelta" name={t('jolive.rejected')} fill="#dc2626" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </SectionCard>

            <SectionCard title={t('jolive.scrapLog')} icon={<ListChecks className="w-4 h-4 text-brand-400" />}>
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {d.scrap.logs.length === 0 && <div className="text-xs text-muted-foreground py-6 text-center">{t('jolive.noScrapEntries')}</div>}
                {d.scrap.logs.map((s: any) => (
                  <div key={s.id} className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold truncate">{s.reason}</p>
                      <p className="text-[10px] text-muted-foreground">{fmtDT(s.createdAt)}{s.operator?.name ? ` · ${s.operator.name}` : ''}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="warning" className="text-[10px]">{s.category}</Badge>
                      <span className="text-sm font-bold text-red-400 tabular-nums">−{s.qty}</span>
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </TabsContent>

          {/* ═══════════ ALARMS ═══════════ */}
          <TabsContent value="alarms" className="space-y-4 mt-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <KpiTile icon={<BellRing className="w-4 h-4" />} label={t('jolive.active')} value={d.alarms.active} tone={d.alarms.active > 0 ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'} />
                <KpiTile icon={<AlertTriangle className="w-4 h-4" />} label={t('jolive.unacknowledged')} value={d.alarms.unacknowledged} tone={d.alarms.unacknowledged > 0 ? 'bg-orange-500/15 text-orange-400' : 'bg-green-500/15 text-green-400'} />
                {d.alarms.bySeverity.map((s: any) => (
                  <Badge key={s.severity} variant={SEV_VARIANT[s.severity] ?? 'secondary'}>{s.severity}: {s.count}</Badge>
                ))}
              </div>
              <Button size="sm" variant="outline" className="text-red-400 border-red-400/40" onClick={() => setActionKind('alarm')}>
                <BellRing className="w-3.5 h-3.5 mr-1.5" />{t('jolive.raiseAlarm')}
              </Button>
            </div>

            <SectionCard title={t('jolive.alarmLog')} icon={<BellRing className="w-4 h-4 text-brand-400" />}>
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {d.alarms.events.length === 0 && <div className="text-xs text-muted-foreground py-8 text-center">{t('jolive.noAlarms')}</div>}
                {d.alarms.events.map((a: any) => (
                  <div key={a.id} className={`rounded-lg border px-3 py-2.5 ${!a.resolvedAt ? 'border-red-500/30 bg-red-500/5' : 'border-border/40 bg-background/40'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant={SEV_VARIANT[a.severity] ?? 'secondary'} className="text-[10px]">{a.severity}</Badge>
                          <span className="text-[10px] font-mono text-muted-foreground">{a.code}</span>
                          {a.machine && <span className="text-[10px] text-muted-foreground">{a.machine.name}</span>}
                          {!a.resolvedAt && !a.acknowledgedAt && <span className="text-[10px] text-red-400 font-bold animate-pulse">{t('jolive.unack')}</span>}
                          {a.resolvedAt && <span className="text-[10px] text-emerald-400">{t('jolive.resolvedAt', { time: fmtTime(a.resolvedAt) })}</span>}
                        </div>
                        <p className="text-sm font-semibold mt-1">{a.description}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {fmtDT(a.triggeredAt)}
                          {a.durationMinutes != null ? ` · ${fmtMins(a.durationMinutes)}` : ''}
                          {a.acknowledgedAt && !a.resolvedAt ? ` · ${t('jolive.ackedAt', { time: fmtTime(a.acknowledgedAt) })}` : ''}
                        </p>
                      </div>
                      {!a.resolvedAt && (
                        <div className="flex gap-1.5 shrink-0">
                          {!a.acknowledgedAt && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={ackMut.isPending} onClick={() => ackMut.mutate(a.id)}>
                              {t('jolive.ack')}
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="h-7 text-xs text-green-400 border-green-400/40" disabled={resolveMut.isPending} onClick={() => resolveMut.mutate(a.id)}>
                            {t('jolive.resolve')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </SectionCard>
          </TabsContent>

          {/* ═══════════ MAINTENANCE ═══════════ */}
          <TabsContent value="maintenance" className="space-y-4 mt-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <KpiTile icon={<Wrench className="w-4 h-4" />} label={t('jolive.openWos')} value={d.maintenance.open} tone={d.maintenance.open > 0 ? 'bg-amber-500/15 text-amber-400' : 'bg-green-500/15 text-green-400'} />
                <KpiTile icon={<Wrench className="w-4 h-4" />} label="MTTR" value={fmtMins(dt.mttrMins)} sub={t('jolive.dayMachineHistory', { days: dt.reliabilityWindowDays })} />
                <KpiTile icon={<Activity className="w-4 h-4" />} label="MTBF" value={fmtMins(dt.mtbfMins)} />
                <KpiTile icon={<Crosshair className="w-4 h-4" />} label={t('jolive.repairTime')} value={fmtMins(dt.repairTimeMins)} sub={t('jolive.am.ackToResume')} />
              </div>
              <Button size="sm" variant="outline" className="text-amber-400 border-amber-400/40" onClick={() => setActionKind('maintenance')}>
                <Wrench className="w-3.5 h-3.5 mr-1.5" />{t('jolive.requestMaintenance')}
              </Button>
            </div>

            <SectionCard title={t('jolive.maintenanceWorkOrders', { machine: d.machine?.name ?? t('jolive.machine') })} icon={<HardHat className="w-4 h-4 text-brand-400" />}>
              <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                {d.maintenance.workOrders.length === 0 && (
                  <div className="text-xs text-muted-foreground py-8 text-center">{t('jolive.noMaintenanceWos')}</div>
                )}
                {d.maintenance.workOrders.map((m: any) => (
                  <div key={m.id} className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[10px] font-mono text-muted-foreground">{m.woNumber}</span>
                        <Badge variant={MAINT_STATUS_VARIANT[m.status] ?? 'secondary'} className="text-[10px]">{m.status}</Badge>
                        <Badge variant="outline" className="text-[10px]">{m.type}</Badge>
                        <Badge variant={m.priority === 'CRITICAL' ? 'destructive' : m.priority === 'HIGH' ? 'warning' : 'outline'} className="text-[10px]">{m.priority}</Badge>
                      </div>
                      <span className="text-[10px] text-muted-foreground">{fmtDT(m.createdAt)}</span>
                    </div>
                    <p className="text-sm font-semibold mt-1">{m.title}</p>
                    {m.description && <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{m.description}</p>}
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {m.requestedBy?.name ? t('jolive.requestedBy', { name: m.requestedBy.name }) : ''}
                      {m.assignedTo?.name ? ` · ${t('jolive.assignedTo', { name: m.assignedTo.name })}` : ` · ${t('jolive.unassigned')}`}
                      {m.dueDate ? ` · ${t('jolive.dueDate', { date: fmtDT(m.dueDate) })}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </SectionCard>
          </TabsContent>

          {/* ═══════════ SHIFT ANALYSIS ═══════════ */}
          <TabsContent value="shift" className="space-y-4 mt-4">
            <ShiftAnalysisPanel shift={shiftData} currentMachineId={d.machine?.id} />
          </TabsContent>

          {/* ═══════════ AI ANALYSIS & BENCHMARKS ═══════════ */}
          <TabsContent value="standards" className="space-y-4 mt-4">
            <SectionCard title={t('jolive.aiAnalysisTitle')} icon={<Sparkles className="w-4 h-4 text-brand-400" />}
              right={<span className="text-[10px] text-muted-foreground">{t('jolive.ruleBasedRealData')}</span>}>
              <AiAnalysisPanel d={d} />
            </SectionCard>
            <SectionCard title={t('jolive.oeeBenchmarksTitle')} icon={<BarChart2 className="w-4 h-4 text-brand-400" />}
              right={
                <div className="flex items-center gap-1.5">
                  <BenchBadge cls={oee.oeeClass} />
                  <span className="text-muted-foreground/40">vs</span>
                  <BenchBadge cls={oee.oeeTimeBasedClass} />
                </div>
              }>
              <IndustryBenchmarks oeeValue={oee.joOEE} oeeTimeBasedValue={oee.oeeTimeBased} />
            </SectionCard>
            <SectionCard title={t('jolive.sixBigLossesManufacturing')} icon={<ShieldAlert className="w-4 h-4 text-brand-400" />}>
              <SixLossesPanel sl={d.sixLosses} />
            </SectionCard>
            <SectionCard title={t('jolive.availabilityMetricsMtt')} icon={<Crosshair className="w-4 h-4 text-brand-400" />}>
              <AvailabilityMetricsDiagram dt={dt} />
            </SectionCard>
          </TabsContent>
        </Tabs>
      </div>

      {/* ── Action dialogs (shared with shop floor cards) ── */}
      <MaintenanceRequestDialog open={actionKind === 'maintenance'} onOpenChange={(v) => !v && setActionKind(null)} target={target} />
      <MachineStateDialog open={actionKind === 'state'} onOpenChange={(v) => !v && setActionKind(null)} target={target} />
      <LogDowntimeDialog open={actionKind === 'downtime'} onOpenChange={(v) => !v && setActionKind(null)} target={target} />
      <AlarmDialog open={actionKind === 'alarm'} onOpenChange={(v) => !v && setActionKind(null)} target={target} />
    </div>
  );
}
