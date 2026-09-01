'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { AdvancedKpiCards } from './advanced-kpi-cards';
import { toFactoryDayKey } from '@/lib/datetime';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import React, { useMemo } from 'react';
import type { TFunction } from 'i18next';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Award,
  CheckCircle2,
  Factory,
  BarChart3,
  Gauge,
  Download,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { useOrderFilterStore } from '@/store/order-filter-store';
import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';
import { useDisplayUnit } from '@/hooks/use-display-unit';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DashboardKpis {
  /**
   * NULLABLE, and typed that way deliberately.
   *
   * These come from the two engines, which keep "not measured" distinct from
   * "measured at zero": a job order whose final step produced no units in the
   * window has no quality and no OEE, and says so.
   *
   * They were typed `number` while the API had already started returning null,
   * so `r.quality.toFixed(1)` compiled cleanly and threw at runtime — the page
   * went white and the compiler had no reason to object. Widening the type is
   * what makes the next such call a build error instead of a blank screen.
   */
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  // Time-based (OEE-TB) variant emitted by the backend alongside schedule-based OEE.
  oeeTb?: number;
  availabilityTb?: number;
  totalOutput: number;
  activeAlarms: number;
  oeeTrend: number;
  availabilityTrend: number;
  performanceTrend: number;
  qualityTrend: number;
  outputTrend: number;
  alarmTrend: number;
}

interface OeeRecord {
  id: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  totalOutput: number;
  recordDate: string;
  machineId: string;
  machine: { name: string };
}

interface WorkOrderItem {
  id: string;
  woNumber: string;
  status: string;
  plannedQty: number;
  goodQty: number;
  scrapQty: number;
  completedAt: string | null;
  progress: number;
}

interface WorkOrdersResponse {
  data: WorkOrderItem[];
  total: number;
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function trendColor(trend: number) {
  if (trend > 0) return 'text-emerald-400';
  if (trend < 0) return 'text-rose-400';
  return 'text-slate-400';
}

function TrendIcon({ trend }: { trend: number }) {
  if (trend > 0) return <TrendingUp size={14} className="text-emerald-400" />;
  if (trend < 0) return <TrendingDown size={14} className="text-rose-400" />;
  return null;
}

function oeeColor(value: number): string {
  if (value >= 85) return 'text-emerald-400';
  if (value >= 65) return 'text-brand-400';
  if (value >= 45) return 'text-amber-400';
  return 'text-rose-400';
}

function statusChip(gap: number, t: TFunction) {
  if (gap >= 0)
    return (
      <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">
        {t('kpiv.onTarget')}
      </Badge>
    );
  if (gap >= -5)
    return (
      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 text-xs">
        {t('kpiv.nearTarget')}
      </Badge>
    );
  return (
    <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-xs">
      {t('kpiv.belowTarget')}
    </Badge>
  );
}

function getISOWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `W${weekNo}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PrimaryKpiCardProps {
  title: string;
  /** null when nothing was measured -- rendered as a dash, never as zero. */
  value: number | null;
  unit: string;
  trend: number;
  target: number;
  icon: React.ReactNode;
  benchmarkNote: string;
}

function PrimaryKpiCard({
  title,
  value,
  unit,
  trend,
  target,
  icon,
  benchmarkNote,
}: PrimaryKpiCardProps) {
  const { t } = useTranslation(['production', 'common']);
  // A card with nothing behind it draws no bar, no gap and no colour. Zero is
  // a claim about the plant; a dash is an admission about the data.
  const missing = value == null || !Number.isFinite(value);
  const pct = missing ? 0 : Math.min(100, ((value as number) / target) * 100);
  const gap = missing ? null : (value as number) - target;
  // Percentages keep one decimal; unit counts show as whole, grouped numbers.
  const isPct = unit === '%';
  const fmt = (v: number) => (isPct ? v.toFixed(1) : Math.round(v).toLocaleString());

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-card border border-border/50 rounded-xl p-5 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </span>
        <span className="text-muted-foreground/60">{icon}</span>
      </div>

      <div className="flex items-end gap-2">
        <span className={cn('text-3xl font-bold tabular-nums',
          missing ? 'text-muted-foreground' : oeeColor(value as number))}>
          {missing ? '—' : fmt(value as number)}
        </span>
        <span className="text-sm text-muted-foreground mb-1">{unit}</span>
        <div className={cn('flex items-center gap-0.5 ml-auto text-xs font-medium', trendColor(trend))}>
          <TrendIcon trend={trend} />
          {trend > 0 ? '+' : ''}
          {trend.toFixed(1)}%
        </div>
      </div>

      {/* Target progress bar */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t('kpiv.vsTarget', { target, unit })}</span>
          <span className={cn('font-medium',
            gap == null ? 'text-muted-foreground'
              : gap >= 0 ? 'text-emerald-400' : 'text-rose-400')}>
            {gap == null ? '—' : <>{gap >= 0 ? '+' : ''}{fmt(gap)}{unit}</>}
          </span>
        </div>
        <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              pct >= 100 ? 'bg-emerald-500' : pct >= 80 ? 'bg-amber-500' : 'bg-rose-500',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <p className="text-[10px] text-muted-foreground/60">{benchmarkNote}</p>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/** A percentage, or an em-dash when there is no figure. Never a false zero. */
const showPct = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(1)}%`;

export default function ProductionKpiView() {
  /**
   * Declared, because the shell reads it.
   *
   * `useDeclareViewMode` is what shows the period control -- and a page that
   * skips it inherits whatever the LAST page set. That is why these analytics
   * screens showed a partial filter bar: not a missing feature, an undeclared
   * one, and the bar they got depended on where the reader had just been.
   */
  useDeclareViewMode('analytics');

  const { t } = useTranslation(['production', 'common']);
  const { filter, key } = useScope();
  const { params: timeParams, dateFrom, dateTo, key: timeKey } = useTimeRange();

  // Work-order metric filters now live in the global ScopePanel (Orders section).
  const { poNumber: poFilter, woId: woFilter } = useOrderFilterStore();
  const { atOee } = useDashboardPrefsStore();
  const { unitLabel } = useDisplayUnit();

  // --- Queries ---
  const { data: poResp } = useQuery({
    queryKey: ['production', 'production-orders', 'kpi-filter'],
    queryFn: () => api.get<any>('/production/production-orders', { params: { limit: 200 } }),
    staleTime: 60_000,
  });
  const productionOrders: any[] = Array.isArray(poResp) ? poResp : (poResp?.data ?? []);

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['dashboard', 'kpis', key],
    queryFn: () => api.get<DashboardKpis>('/dashboard/kpis', { params: filter }),
    refetchInterval: 60_000,
  });

  // First Pass Yield comes from INSPECTIONS, not from production counts. Deriving it
  // from good/total output computes the OEE Quality factor instead — a different
  // metric that answers a different question, which is why this card used to show a
  // number identical to OEE Q. Same window as every other figure on the page.
  const { data: qualityReport } = useQuery({
    queryKey: ['reports', 'quality', 'fpy', timeKey, key],
    queryFn: () => api.get<{ fpy: number; defectRate: number; inspectionCount: number }>(
      '/reports/quality', { params: { from: dateFrom, to: dateTo } },
    ),
    refetchInterval: 60_000,
  });

  const { data: oeeRecordsResp, isLoading: recordsLoading } = useQuery({
    queryKey: ['production', 'oee-records', timeKey, key],
    queryFn: () => api.get<{ data: OeeRecord[]; total: number }>('/production/oee-records', { params: { limit: 365, ...filter, ...timeParams } }),
    refetchInterval: 60_000,
  });
  const oeeRecords = Array.isArray(oeeRecordsResp?.data) ? oeeRecordsResp.data : [];

  // Resolve the selected PO (the filter holds its order-number) to its id so the
  // OEE engine can drill the cards to that PO. woFilter already holds the WO id.
  const poId = poFilter ? productionOrders.find((p) => p.orderNumber === poFilter)?.id : undefined;

  // Canonical, scope+time OEE from the SAME engine the OEE Analytics page uses
  // (time-weighted rollup) — now ALSO drilled by the PO / WO filter so the
  // OEE/A/P/Q/Output/Scrap cards react to the same filters as the tables.
  const { data: oeeCalc } = useQuery({
    queryKey: ['production', 'oee-calc', timeKey, key, poId ?? '', woFilter],
    queryFn: () => api.get<any>('/production/oee/calculate', {
      // The whole period: Today and Shift share dateFrom/dateTo, and only
      // `timeframe` tells them apart — the shift is resolved server-side.
      params: { ...filter, ...timeParams, productionOrderId: poId || undefined, workOrderId: woFilter || undefined },
    }),
    refetchInterval: 60_000,
  });

  const { data: workOrdersResp, isLoading: woLoading } = useQuery({
    queryKey: ['production', 'work-orders', 200, key],
    queryFn: () => api.get<WorkOrdersResponse>('/production/work-orders', { params: { limit: 200, ...filter } }),
    refetchInterval: 60_000,
  });

  // --- OEE summary from the canonical rollup (matches OEE Analytics exactly) ---
  const summary = useMemo(() => {
    const r1 = (v: any) => Math.round((Number(v) || 0) * 10) / 10;
    const c: any = oeeCalc ?? {};
    return {
      oee: r1(c.oee ?? c.current?.oee),
      oeeTb: r1(c.oeeTb ?? c.current?.oeeTb),
      availability: r1(c.availability ?? c.current?.availability),
      availabilityTb: r1(c.availabilityTb ?? c.current?.availabilityTb),
      performance: r1(c.performance ?? c.current?.performance),
      quality: r1(c.quality ?? c.current?.quality),
      // Output is base-unit normalised → round to whole units for display.
      totalOutput: Math.round(Number(c.totalCount ?? 0)),
      goodOutput: Math.round(Number(c.goodCount ?? 0)),
    };
  }, [oeeCalc]);

  // --- Derived metrics ---
  const allWorkOrders = workOrdersResp?.data ?? [];

  // Apply the PO / WO filters to the WO-derived sections. (OEE cards stay scope+time
  // driven — those records aren't WO-keyed.) PO match is by the WO's parent PO number.
  const workOrders = useMemo(() => {
    return allWorkOrders.filter((w: any) => {
      if (woFilter && w.id !== woFilter) return false;
      if (poFilter && (w.productionOrder?.orderNumber ?? w.poNumber) !== poFilter) return false;
      return true;
    });
  }, [allWorkOrders, woFilter, poFilter]);

  // Every headline figure is scoped to the SELECTED PERIOD so the whole page is
  // internally consistent (no "OEE 0% today but FPY 60% all-time" contradiction):
  //   • OEE / Output / Scrap / First-Pass-Yield come from the windowed OEE engine.
  //   • Completion counts only the WOs relevant to the window, excluding cancelled
  //     (a cancelled order is removed from the plan, so it must not drag it down).
  const fromMs = new Date(dateFrom).getTime();
  const toMs = new Date(dateTo).getTime() + 86_399_999;
  const inWindow = (w: any) => {
    const ae = w.actualEnd ? +new Date(w.actualEnd) : null;
    if (ae != null) return ae >= fromMs && ae <= toMs;                 // completed → by completion date
    const ps = w.plannedStart ? +new Date(w.plannedStart) : null;
    const pe = w.plannedEnd ? +new Date(w.plannedEnd) : null;
    if (ps == null && pe == null) return true;
    return (ps == null || ps <= toMs) && (pe == null || pe >= fromMs); // else schedule overlaps window
  };
  const windowWOs = useMemo(
    () => workOrders.filter((w) => w.status !== 'CANCELLED' && inWindow(w)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workOrders, dateFrom, dateTo],
  );
  const completedCount = windowWOs.filter((w) => w.status === 'COMPLETED').length;
  const totalWOs = windowWOs.length;
  const completionRate = totalWOs > 0 ? (completedCount / totalWOs) * 100 : 0;

  // First-Pass Yield = good ÷ total produced, from the windowed engine (consistent
  // with Output/Scrap). 0 when nothing was produced in the selected period.
  // The OEE Quality factor — good units ÷ total produced. NOT first-pass yield.
  const qualityFactor = summary.totalOutput > 0 ? (summary.goodOutput / summary.totalOutput) * 100 : 0;
  // Real FPY from inspection records. Falls back to 0 (not to the quality factor)
  // when no inspections exist in the window, so an absent measurement reads as
  // absent instead of borrowing an unrelated number.
  /**
   * No inspections is not zero quality.
   *
   * `?? 0` printed 0.0% under the words "No inspections recorded in this
   * period", and KPI Targets then flagged it as Below Target -99% -- a red
   * alarm about a problem that does not exist. A dashboard that cries wolf is
   * how the real alarms come to be ignored.
   */
  const firstPassYield: number | null = qualityReport?.fpy ?? null;
  const hasInspections = (qualityReport?.inspectionCount ?? 0) > 0;
  const totalScrap = Math.max(0, summary.totalOutput - summary.goodOutput);

  // --- Radar data ---
  const radarData = useMemo(
    () => [
      {
        subject: t('cards.availability'),
        Actual: summary.availability,
        'World Class': 90,
      },
      {
        subject: t('cards.performance'),
        Actual: summary.performance,
        'World Class': 95,
      },
      {
        subject: t('cards.quality'),
        Actual: summary.quality,
        'World Class': 99,
      },
    ],
    [summary, t],
  );

  // --- KPI target table rows ---
  const plannedOutput = summary.totalOutput ? Math.ceil(summary.totalOutput * 1.1) : 1000;
  const kpiRows = useMemo(
    () => [
      {
        metric: t('cards.oee'),
        actual: summary.oee,
        target: 85,
        unit: '%',
      },
      {
        metric: t('cards.firstPassYield'),
        actual: firstPassYield,
        target: 99,
        unit: '%',
      },
      {
        metric: t('kpiv.metricOutput'),
        actual: summary.totalOutput,
        target: plannedOutput,
        unit: t('kpiv.unitsSuffix'),
      },
      {
        metric: t('kpiv.metricCompletionRate'),
        actual: completionRate,
        target: 95,
        unit: '%',
      },
    ],
    [summary, firstPassYield, completionRate, plannedOutput, t],
  );

  // --- Production volume by week (BarChart) ---
  // Include in-progress WOs (planned vs produced-so-far), not only COMPLETED — otherwise
  // the chart is empty while a run is still executing.
  const volumeByWeek = useMemo(() => {
    const map: Record<string, { week: string; planned: number; actual: number }> = {};
    workOrders.forEach((w) => {
      const dateStr = w.completedAt ?? (w as any).actualStart ?? (w as any).plannedStart ?? null;
      const d = dateStr ? new Date(dateStr) : new Date();
      const key = getISOWeek(d);
      if (!map[key]) map[key] = { week: key, planned: 0, actual: 0 };
      map[key].planned += w.plannedQty ?? 0;
      map[key].actual += (w.goodQty ?? 0) + (w.scrapQty ?? 0);
    });
    return Object.values(map)
      .sort((a, b) => a.week.localeCompare(b.week))
      .slice(-12);
  }, [workOrders]);

  // --- Quality trend from OEE records ---
  const qualityTrend = useMemo(() => {
    if (!oeeRecords) return [];
    return [...oeeRecords]
      .sort((a, b) => new Date(a.recordDate).getTime() - new Date(b.recordDate).getTime())
      /**
       * A record with no measured quality is DROPPED, not plotted as zero.
       *
       * The records list projects the engines now, and the engines keep "not
       * measured" distinct from "measured at zero" — a job order whose final
       * step produced no units in the window has no quality, and returns null
       * rather than a number. This line read `r.quality.toFixed(1)` and threw on
       * the first such row, taking the whole page down with it.
       *
       * Coercing to 0 would have stopped the crash and drawn a false cliff to
       * zero on the trend, which is worse than a shorter line: the chart would
       * be reporting perfect scrap on an order that simply had nothing counted.
       */
      .filter((r): r is typeof r & { quality: number } => typeof r.quality === 'number')
      .map((r) => ({
        // Include time so same-day records don't collapse to one repeated axis label.
        date: new Date(r.recordDate).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        quality: Number(r.quality.toFixed(1)),
      }));
  }, [oeeRecords]);

  // --- Top 10 WOs by FPY ---
  const topWOs = useMemo(() => {
    return [...workOrders]
      .map((w) => {
        const good = (w as any).liveGoodQty ?? w.goodQty ?? 0;
        // FPY = good units / units actually produced (capped 100) — NOT good/planned,
        // which mixes units across routing steps and yields nonsense like 4000%.
        const produced = (w as any).actualQty || good || w.plannedQty || 0;
        return {
          ...w,
          output: good,
          fpy: produced > 0 ? Math.min(100, (good / produced) * 100) : 0,
        };
      })
      .filter((w) => (w.plannedQty ?? 0) > 0)
      .sort((a, b) => b.fpy - a.fpy || b.output - a.output)
      .slice(0, 10);
  }, [workOrders]);

  const isLoading = kpisLoading || recordsLoading || woLoading;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-brand-500/10">
            <TrendingUp size={18} className="text-brand-400" />
          </div>
          <div>
            <div className="flex items-center gap-2"><h1 className="text-lg font-bold">{t('headers.kpiAnalytics.title')}</h1><DashboardInfo id="production-kpi" /><DataModeBadge mode="period" /></div>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('headers.kpiAnalytics.subtitle')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Scope, period and PO/WO filters now live in the unified ScopePanel. */}
          <Button
            variant="outline" size="sm" className="gap-1.5 h-8 text-xs"
            onClick={() => {
              const recs = oeeRecords ?? [];
              const rows = [
                [t('kpiv.csv.date'), t('kpiv.csv.machine'), t('kpiv.csv.oee'), t('kpiv.csv.availability'), t('kpiv.csv.performance'), t('kpiv.csv.quality'), t('kpiv.csv.output')],
                ...recs.map((r: any) => [
                  (r.recordDate ?? r.createdAt ?? '').slice(0, 10),
                  r.machine?.name ?? r.machineId ?? '—',
                  (r.oee ?? 0).toFixed(1), (r.availability ?? 0).toFixed(1),
                  (r.performance ?? 0).toFixed(1), (r.quality ?? 0).toFixed(1),
                  r.totalOutput ?? 0,
                ]),
              ];
              const blob = new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' });
              const a = document.createElement('a');
              a.href = URL.createObjectURL(blob);
              a.download = `production-kpi-${timeKey}-${toFactoryDayKey(new Date())}.csv`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            <Download size={13} />
            {t('common:actions.export')}
          </Button>
        </div>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-auto p-6 space-y-6">

        {/* 1. Primary KPI row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <PrimaryKpiCard
            title={atOee ? `${t('cards.oee')} (OEE-TB)` : t('cards.oee')}
            value={atOee ? summary.oeeTb : summary.oee}
            unit="%"
            trend={kpis?.oeeTrend ?? 0}
            target={85}
            icon={<Gauge size={16} />}
            benchmarkNote={t('kpiv.benchWorldClass')}
          />
          <PrimaryKpiCard
            title={t('cards.firstPassYield')}
            value={firstPassYield}
            unit="%"
            trend={kpis?.qualityTrend ?? 0}
            target={99}
            icon={<Award size={16} />}
            // With no inspections in the window there is nothing to measure — say so
            // rather than letting a 0% read as a catastrophic yield.
            benchmarkNote={hasInspections
              ? t('kpiv.benchSixSigma')
              : t('kpiv.noInspections', 'No inspections recorded in this period')}
          />
          <PrimaryKpiCard
            title={t('cards.totalOutput')}
            value={summary.totalOutput}
            // Output spans every SKU in scope, so it stays in PIECES — there is no
            // single conversion factor for a multi-product total. The unit is named
            // rather than left as a generic "units", which told the user nothing.
            unit={` ${unitLabel('PIECE')}`}
            trend={kpis?.outputTrend ?? 0}
            target={plannedOutput}
            icon={<Factory size={16} />}
            benchmarkNote={t('kpiv.benchScrap', { qty: totalScrap.toLocaleString() })}
          />
          <PrimaryKpiCard
            title={t('cards.orderCompletion')}
            value={completionRate}
            unit="%"
            trend={0}
            target={95}
            icon={<CheckCircle2 size={16} />}
            benchmarkNote={t('kpiv.benchWorkOrders', { done: completedCount, total: totalWOs })}
          />
        </div>

        {/* Time-Based (OEE-TB) — standardized backend metric, beside the schedule-based KPIs above */}
        {/*
          One source for OEE-TB, not two.

          This line used to read `kpis.oeeTb` while the card six rows above read
          `summary.oeeTb` -- a different query for the same metric. The screen
          showed 55.8% on the card and 0.0% here, at the same moment, under the
          same name. Whichever was right, a reader had no way to tell.

          `?? 0` was the other half of it: an absent figure printed as a
          measured zero. A zero is a claim about the plant; a dash is an
          admission about the data, and only one of them was true.
        */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground -mt-3 px-1">
          <span>{t('atOee')}: <b className="text-foreground">{showPct(summary.oeeTb)}</b></span>
          <span>{t('availabilityTb')}: <b className="text-foreground">{showPct(summary.availabilityTb)}</b></span>
          <span className="opacity-70">{t('kpiv.atOeeHint')}</span>
        </div>

        {/* 1b. Bottleneck Line OEE, Master Schedule Attainment, Capacity Utilization.
               Each carries its formula and resolved basis next to the number. */}
        <AdvancedKpiCards />

        {/* 2. OEE Components — Radar + Target table */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Radar chart — col-span-2 */}
          <div className="lg:col-span-2 bg-card border border-border/50 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 size={15} className="text-brand-400" />
              <h2 className="text-sm font-semibold">{t('kpiv.oeeComponents')}</h2>
            </div>
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="hsl(var(--border))" />
                <PolarAngleAxis
                  dataKey="subject"
                  tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                />
                <Radar
                  name={t('kpiv.seriesActual')}
                  dataKey="Actual"
                  stroke="#4c7571"
                  fill="#4c7571"
                  fillOpacity={0.3}
                  dot={{ r: 3, fill: '#4c7571' }}
                />
                <Radar
                  name={t('kpiv.seriesWorldClass')}
                  dataKey="World Class"
                  stroke="#10b981"
                  fill="#10b981"
                  fillOpacity={0.1}
                  strokeDasharray="4 2"
                  dot={{ r: 3, fill: '#10b981' }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }}
                />
                <Tooltip
                  contentStyle={{
                    background: 'hsl(var(--card))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(val: number) => [`${val.toFixed(1)}%`]}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          {/* KPI Target table — col-span-1 */}
          <div className="bg-card border border-border/50 rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Target size={15} className="text-brand-400" />
              <h2 className="text-sm font-semibold">{t('kpiv.kpiTargets')}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/50">
                    {[
                      { key: 'metric', label: t('kpiv.colMetric') },
                      { key: 'actual', label: t('kpiv.colActual') },
                      { key: 'target', label: t('kpiv.colTarget') },
                      { key: 'gap', label: t('kpiv.colGap') },
                      { key: 'status', label: t('po.col.status') },
                    ].map((h) => (
                      <th
                        key={h.key}
                        className="text-left pb-2 font-medium text-muted-foreground pr-2 last:pr-0"
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {kpiRows.map((row) => {
                    // A metric with nothing measured has no gap and no status.
                    // Reporting "Below Target -99%" for a quality figure that
                    // rests on zero inspections is a false alarm, and false
                    // alarms are how the real ones come to be ignored.
                    const missing = row.actual == null || !Number.isFinite(row.actual as number);
                    const gap = missing ? null : (row.actual as number) - row.target;
                    // Percentages keep one decimal; unit counts show as whole numbers.
                    const rfmt = (v: number | null) =>
                      v == null || !Number.isFinite(v) ? '—'
                        : (row.unit === '%' ? v.toFixed(1) : Math.round(v).toLocaleString());
                    return (
                      <tr key={row.metric} className="h-10">
                        <td className="pr-2 font-medium text-foreground/80">{row.metric}</td>
                        <td className={cn('pr-2 tabular-nums font-bold',
                          missing ? 'text-muted-foreground' : oeeColor(row.actual as number))}>
                          {rfmt(row.actual)}{missing ? '' : row.unit}
                        </td>
                        <td className="pr-2 text-muted-foreground tabular-nums">
                          {rfmt(row.target)}{row.unit}
                        </td>
                        <td
                          className={cn(
                            'pr-2 tabular-nums font-medium',
                            gap == null ? 'text-muted-foreground'
                              : gap >= 0 ? 'text-emerald-400' : 'text-rose-400',
                          )}
                        >
                          {gap == null ? '—' : (
                            <>{gap >= 0 ? '+' : ''}{rfmt(gap)}{row.unit}</>
                          )}
                        </td>
                        <td>
                          {gap == null
                            ? <span className="text-[10px] text-muted-foreground">no data</span>
                            : statusChip(gap, t)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* 3. Production Volume BarChart */}
        <div className="bg-card border border-border/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 size={15} className="text-brand-400" />
            <h2 className="text-sm font-semibold">{t('kpiv.volumeByWeek')}</h2>
            <span className="ml-auto text-xs text-muted-foreground">{t('kpiv.plannedVsActual')}</span>
          </div>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={volumeByWeek} barGap={4} barCategoryGap="25%">
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="week"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: 'hsl(var(--muted-foreground))' }} />
              <Bar dataKey="planned" name={t('kpiv.seriesPlanned')} fill="#4c7571" radius={[3, 3, 0, 0]} />
              <Bar dataKey="actual" name={t('kpiv.seriesActual')} fill="#10b981" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* 4. Quality Trend LineChart */}
        <div className="bg-card border border-border/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={15} className="text-brand-400" />
            <h2 className="text-sm font-semibold">{t('kpiv.qualityTrend')}</h2>
            <span className="ml-auto text-xs text-muted-foreground">{t('kpiv.last90')}</span>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={qualityTrend}>
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="hsl(var(--border))"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                width={36}
                unit="%"
              />
              <Tooltip
                contentStyle={{
                  background: 'hsl(var(--card))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(val: number) => [`${val.toFixed(1)}%`, t('cards.quality')]}
              />
              <ReferenceLine y={99} stroke="#10b981" strokeDasharray="4 2" label={{ value: t('kpiv.targetLabel'), fontSize: 10, fill: '#10b981' }} />
              <Line
                type="monotone"
                dataKey="quality"
                name={t('cards.quality')}
                stroke="#4c7571"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: '#4c7571' }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* 5. Top Performing Work Orders table */}
        <div className="bg-card border border-border/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Award size={15} className="text-brand-400" />
            <h2 className="text-sm font-semibold">{t('kpiv.topWos')}</h2>
            <span className="ml-auto text-xs text-muted-foreground">{t('kpiv.top10Fpy')}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border/50">
                  {[
                    { key: 'wo', label: t('kpiv.colWo') },
                    { key: 'product', label: t('kpiv.colProductSku') },
                    { key: 'planned', label: t('kpiv.colPlanned') },
                    { key: 'output', label: t('kpiv.colOutput') },
                    { key: 'fpy', label: t('kpiv.colFpy') },
                    { key: 'status', label: t('po.col.status') },
                  ].map((h) => (
                    <th
                      key={h.key}
                      className="text-left pb-2 font-medium text-muted-foreground pr-3 last:pr-0"
                    >
                      {h.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {topWOs.map((w, idx) => (
                  <motion.tr
                    key={w.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.03 }}
                    className="h-10 hover:bg-accent/30 transition-colors"
                  >
                    <td className="pr-3 font-mono font-medium text-foreground/90">
                      {(w as any).orderNumber ?? (w as any).woNumber ?? '—'}
                    </td>
                    <td className="pr-3 text-muted-foreground truncate max-w-[200px]">
                      {(w as any).productName ?? (w as any).sku?.name ?? '—'}
                    </td>
                    <td className="pr-3 tabular-nums text-muted-foreground">
                      {(w.plannedQty ?? 0).toLocaleString()}
                    </td>
                    <td className="pr-3 tabular-nums font-medium text-foreground/80">
                      {(w.output ?? 0).toLocaleString()}
                    </td>
                    <td className="pr-3">
                      <span
                        className={cn(
                          'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border',
                          w.fpy >= 99
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : w.fpy >= 95
                            ? 'bg-amber-500/20 text-amber-400 border-amber-500/30'
                            : 'bg-rose-500/20 text-rose-400 border-rose-500/30',
                        )}
                      >
                        {w.fpy.toFixed(1)}%
                      </span>
                    </td>
                    <td>
                      <Badge
                        variant={
                          w.status === 'COMPLETED'
                            ? 'default'
                            : w.status === 'IN_PROGRESS'
                            ? 'default'
                            : 'secondary'
                        }
                        className={cn(
                          'text-[10px]',
                          w.status === 'COMPLETED' && 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
                          w.status === 'IN_PROGRESS' && 'bg-brand-500/20 text-brand-400 border-brand-500/30',
                        )}
                      >
                        {t(`po.status.${w.status}`, { defaultValue: w.status.replace('_', ' ') })}
                      </Badge>
                    </td>
                  </motion.tr>
                ))}
                {topWOs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">
                      {isLoading ? t('kpiv.loadingWos') : t('kpiv.noWos')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}
