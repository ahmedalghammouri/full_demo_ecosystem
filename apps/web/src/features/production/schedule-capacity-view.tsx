'use client';
/**
 * Schedule & Capacity Analytics — the three KPIs the plant asked for, in full.
 *
 * The KPI screen shows Overall Line OEE, Master Schedule Attainment and Capacity
 * Utilization as three numbers on three cards. Three numbers is where a question
 * starts, not where it ends: an attainment of 27.7% does not say which order is
 * behind, and a utilization figure does not say which machine is idle or which one
 * has no rated capacity at all.
 *
 * This page is the long form. Every figure keeps the formula and the resolved basis
 * beside it, and nothing is recomputed in the browser — the API is the single
 * arithmetic authority, exactly as on the OEE analytics pages.
 *
 * It also states plainly where two numbers on the same screen disagree, because on
 * this plant they do: schedule-based OEE and time-based OEE answer different
 * questions, and a reader who is not told that will assume one of them is broken.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertTriangle, Target } from 'lucide-react';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RTooltip, Legend, Cell, ReferenceLine, LineChart, Line,
} from 'recharts';

import { api } from '@/services/api.client';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  PageHeader, Empty, Failed, Note, AXIS,
  fmtMin, fmtNum, fmtDay, CHART_TOOLTIP, FACTOR_COLORS,
} from './oee-analytics-shared';

// ── API shapes ─────────────────────────────────────────────────────────────
interface LineOee {
  lineId: string; lineName: string; lineCode: string | null;
  method: 'ROLLUP' | 'BOTTLENECK';
  oee: number; availability: number; performance: number; quality: number;
  oeeTb: number; availabilityTb: number;
  basis: {
    formula: string;
    bottleneckMachineName?: string; outfeedMachineNames?: string[];
    bottleneckResolvedBy?: string; outfeedResolvedBy?: string;
    machineCount?: number; externalLossMin?: number; bottleneckExternalLossMin?: number;
  };
  machines: Array<{
    machineId: string; name: string; code: string | null;
    isBottleneck: boolean; isOutfeed: boolean;
    oee: number; availability: number; performance: number; quality: number;
    availabilityTb: number; oeeTb: number;
    externalLossMin: number; output: number;
  }>;
}

interface Msa {
  msaPct: number;
  totalScheduledQty: number; totalCreditedQty: number; totalActualQty: number;
  orderCount: number;
  lines: Array<{
    productionOrderId: string; orderNumber: string; sku: string | null;
    scheduledQty: number; actualQty: number; creditedQty: number;
    attainmentPct: number; status: string;
  }>;
  method: { formula: string; note: string };
  /**
   * Attainment as it stood at the end of each day, read from frozen rows.
   *
   * `day` is the PLANT's calendar day; `date` is the instant that day begins.
   * The label comes from `day` so the point cannot slide to the day before when
   * the browser sits in a different zone from the factory.
   */
  trend?: Array<{ date: string; day?: string; msaPct: number; credited: number; scheduled: number }>;
}

interface Capacity {
  utilizationPct: number;
  actualUnits: number; maxDesignedUnits: number; windowHours: number; machineCount: number;
  machinesMissingCapacity: Array<{ id: string; name: string; code?: string | null; reason: string }>;
  byMachine: Array<{
    machineId: string; name: string; code: string | null;
    ratedUnitsPerHour: number | null;
    ratedFrom: { processName: string; operationName: string; cycleTimeSec: number } | null;
    maxDesignedUnits: number; actualUnits: number; utilizationPct: number | null;
  }>;
  method: { formula: string; capacityBasis: string; note: string };
  trend?: Array<{ date: string; utilizationPct: number; actualUnits: number; designedUnits: number }>;
}

/** A framed block with a title and an optional formula line under it. */
function Panel({
  title, subtitle, formula, children, action,
}: {
  title: string; subtitle?: string; formula?: string;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border/50 overflow-hidden">
      <header className="px-4 py-3 border-b border-border/50 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {subtitle && <p className="text-[11px] text-muted-foreground mt-0.5">{subtitle}</p>}
          {formula && (
            <p className="text-[11px] font-mono text-muted-foreground/80 mt-1 break-words">{formula}</p>
          )}
        </div>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** An amber advisory. Used only where a number would otherwise be read as sound. */
function Caveat({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 flex gap-2.5">
      <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-muted-foreground mt-1 space-y-1">{children}</div>
      </div>
    </div>
  );
}

export function ScheduleCapacityView() {
  const { t } = useTranslation(['production', 'common']);
  useDeclareViewMode('analytics');
  const { filter, key: scopeKey, scope } = useScope();
  const { params, dateFrom, dateTo, key: timeKey, preset: timeframe } = useTimeRange();

  // Line OEE is only defined for a LINE scope — a bottleneck belongs to a line.
  const lineId = scope?.type === 'LINE' ? scope.id : null;

  const lineOee = useQuery({
    queryKey: ['sched-cap', 'line-oee', lineId, timeKey],
    queryFn: () => api.get<LineOee>('/production/oee/line', {
      params: { lineId, timeframe, dateFrom, dateTo },
    }),
    enabled: !!lineId,
    staleTime: 30_000,
    // Keep the previous window on screen while the next is fetched, so a
    // filter change updates the figures instead of unmounting the view.
    placeholderData: keepPreviousData,
  });

  const msa = useQuery({
    queryKey: ['sched-cap', 'msa', scopeKey, timeKey],
    queryFn: () => api.get<Msa>('/production/kpi/master-schedule-attainment', {
      params: { timeframe, dateFrom, dateTo, lineId: filter.lineId },
    }),
    staleTime: 30_000,
    // Keep the previous window on screen while the next is fetched, so a
    // filter change updates the figures instead of unmounting the view.
    placeholderData: keepPreviousData,
  });

  const capacity = useQuery({
    queryKey: ['sched-cap', 'capacity', scopeKey, timeKey],
    queryFn: () => api.get<Capacity>('/production/kpi/capacity-utilization', {
      params: { timeframe, dateFrom, dateTo, ...filter },
    }),
    staleTime: 30_000,
    // Keep the previous window on screen while the next is fetched, so a
    // filter change updates the figures instead of unmounting the view.
    placeholderData: keepPreviousData,
  });

  const unwrap = <T,>(q: { data: unknown }) => ((q.data as any)?.data ?? q.data) as T | undefined;
  const lo = unwrap<LineOee>(lineOee);
  const ms = unwrap<Msa>(msa);
  const cap = unwrap<Capacity>(capacity);

  const loading = lineOee.isLoading || msa.isLoading || capacity.isLoading;
  const failed = msa.error || capacity.error;

  const body = () => {
    if (failed) return <Failed onRetry={() => { msa.refetch(); capacity.refetch(); lineOee.refetch(); }} />;
    if (loading) return <Empty text={t('common:loading')} />;

    // ── Reconciliation facts, computed once and reused ──────────────────────
    // The two OEE bases differ by construction; the size of the gap is the story.
    const basisGap = lo ? Math.abs(lo.oee - lo.oeeTb) : 0;
    const overProduced = (ms?.lines ?? []).filter((l) => l.actualQty > l.scheduledQty);
    const shortfall = (ms?.totalScheduledQty ?? 0) - (ms?.totalCreditedQty ?? 0);
    const missing = cap?.machinesMissingCapacity ?? [];
    const overCapacity = (cap?.byMachine ?? []).filter((m) => (m.utilizationPct ?? 0) > 100);

    const msaChart = (ms?.lines ?? []).map((l) => ({
      name: l.orderNumber,
      scheduled: l.scheduledQty,
      credited: l.creditedQty,
      over: Math.max(0, l.actualQty - l.scheduledQty),
      attainment: l.attainmentPct,
    }));

    const capChart = (cap?.byMachine ?? []).map((m) => ({
      name: m.code ?? m.name,
      utilization: m.utilizationPct ?? 0,
      rated: m.ratedUnitsPerHour ?? 0,
      actual: m.actualUnits,
      designed: m.maxDesignedUnits,
      unrated: m.ratedUnitsPerHour == null,
    }));

    return (
      <div className="space-y-6">
        {/* ── Headline ──────────────────────────────────────────────────── */}

        {/* ── Where the numbers disagree, said out loud ─────────────────── */}
        {lo && basisGap >= 5 && (
          <Caveat title={t('schedCap.basisGapTitle', { gap: basisGap.toFixed(1) })}>
            <p>{t('schedCap.basisGapBody')}</p>
            <p className="font-mono text-[11px]">
              {t('schedCap.scheduleBased')}: {lo.oee.toFixed(1)}% (A {lo.availability.toFixed(1)}%) ·{' '}
              {t('schedCap.timeBased')}: {lo.oeeTb.toFixed(1)}% (A {lo.availabilityTb.toFixed(1)}%)
            </p>
          </Caveat>
        )}

        {overCapacity.length > 0 && (
          <Caveat title={t('schedCap.overCapacityTitle', { count: overCapacity.length })}>
            <p>{t('schedCap.overCapacityBody')}</p>
            <p className="font-mono text-[11px]">{overCapacity.map((m) => `${m.code ?? m.name} ${m.utilizationPct}%`).join(' · ')}</p>
          </Caveat>
        )}

        {/* The basis is stated up front, not buried: two pages reporting different
            availabilities for one machine is only defensible if each says which
            question it is answering. */}
        <Note>{t('schedCap.scheduleBasisNote')}</Note>

        {/* ── Line OEE composition ─────────────────────────────────────── */}
        {lo ? (
          <Panel
            title={t('schedCap.lineComposition')}
            subtitle={t('schedCap.lineCompositionHelp')}
            formula={lo.basis.formula}
            action={
              <Badge variant="outline" className="shrink-0 text-[10px]">
                {lo.method === 'BOTTLENECK'
                  ? `${t('schedCap.bottleneck')}: ${lo.basis.bottleneckMachineName ?? '—'}`
                  : t('schedCap.rollup')}
              </Badge>
            }
          >
            {/* Replaces the per-machine table. A/P/Q side by side per machine is
                the comparison a reader was making by eye across six columns. */}
            <ResponsiveContainer width="100%" height={Math.max(220, lo.machines.length * 52)}>
              <BarChart data={lo.machines} layout="vertical" margin={{ left: 8, right: 28 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} horizontal={false} />
                <XAxis type="number" domain={[0, 100]} unit="%" {...AXIS} />
                <YAxis type="category" dataKey="code" width={54} {...AXIS} />
                <RTooltip {...CHART_TOOLTIP} formatter={(v: any, n: any) => [`${v}%`, n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="availability" name={t('oeeAn.availability')} fill={FACTOR_COLORS.availability} radius={[0, 4, 4, 0]} />
                <Bar dataKey="performance" name={t('oeeAn.performance')} fill={FACTOR_COLORS.performance} radius={[0, 4, 4, 0]} />
                <Bar dataKey="quality" name={t('oeeAn.quality')} fill={FACTOR_COLORS.quality} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </Panel>
        ) : (
          <Panel title={t('schedCap.lineComposition')} subtitle={t('schedCap.lineCompositionHelp')}>
            <Empty text={t('schedCap.selectLine')} />
          </Panel>
        )}

        {/* ── Master Schedule Attainment ───────────────────────────────── */}
        <Panel
          title={t('schedCap.msaTitle')}
          subtitle={ms?.method.note}
          formula={ms?.method.formula}
        >
          {msaChart.length ? (
            <>
              {/* Credited and over-production stacked against the commitment line:
                  the bar can reach the line but never pass it, which is the whole
                  point of the min() in the formula. Over-production is drawn
                  separately so it is visible without being credited. */}
              <ResponsiveContainer width="100%" height={Math.max(180, msaChart.length * 46)}>
                <BarChart data={msaChart} layout="vertical" margin={{ left: 8, right: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                  <RTooltip {...CHART_TOOLTIP} formatter={(v: any, n: any) => [fmtNum(Number(v)), n]} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="credited" name={t('schedCap.credited')} stackId="a" fill={FACTOR_COLORS.quality} radius={[0, 0, 0, 0]} />
                  <Bar dataKey="over" name={t('schedCap.overProduced')} stackId="a" fill={FACTOR_COLORS.performance} radius={[0, 4, 4, 0]} />
                  <Bar dataKey="scheduled" name={t('schedCap.scheduled')} fill="hsl(var(--muted-foreground))" fillOpacity={0.25} radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>


              {overProduced.length > 0 && (
                <Note>{t('schedCap.overProducedNote', { count: overProduced.length })}</Note>
              )}
            </>
          ) : (
            <Empty text={t('schedCap.noOrders')} />
          )}
        </Panel>

        {/* Attainment over time. It could not exist before: the figure was read
            from a cumulative counter that only ever knows today. Derived from the
            fact store, which was written a minute at a time and so knows every
            day. */}
        {(ms?.trend?.length ?? 0) > 1 && (
          <Panel title={t('schedCap.attainmentTrend')} subtitle={t('schedCap.attainmentTrendHelp')}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={(ms!.trend ?? []).map((d) => ({ ...d, label: fmtDay(d.day ?? d.date) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis domain={[0, 100]} unit="%" {...AXIS} />
                <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('schedCap.msa')]} />
                <ReferenceLine y={95} stroke={FACTOR_COLORS.quality} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="msaPct" name={t('schedCap.msa')}
                  stroke={FACTOR_COLORS.availability} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        )}

        {(cap?.trend?.length ?? 0) > 1 && (
          <Panel title={t('schedCap.capacityTrend')} subtitle={t('schedCap.capacityTrendHelp')}>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={(cap!.trend ?? []).map((d) => ({ ...d, label: fmtDay(d.date) }))}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis dataKey="label" {...AXIS} />
                <YAxis unit="%" {...AXIS} />
                <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('schedCap.capacity')]} />
                {/* 100% is the designed ceiling, not a target — crossing it means
                    the rated cycle time is wrong. */}
                <ReferenceLine y={100} stroke={FACTOR_COLORS.performance} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="utilizationPct" name={t('schedCap.capacity')}
                  stroke={FACTOR_COLORS.utilization} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </Panel>
        )}

        {/* ── Capacity utilization ─────────────────────────────────────── */}
        <Panel
          title={t('schedCap.capacityTitle')}
          subtitle={cap?.method.capacityBasis}
          formula={cap?.method.formula}
        >
          {capChart.length ? (
            <ResponsiveContainer width="100%" height={Math.max(180, capChart.length * 42)}>
              <BarChart data={capChart} layout="vertical" margin={{ left: 8, right: 32 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} stroke="hsl(var(--muted-foreground))" />
                <RTooltip {...CHART_TOOLTIP} formatter={(v: any) => [`${v}%`, t('schedCap.utilization')]} />
                {/* 100% is the designed ceiling, not a target — crossing it means the
                    rated cycle time is wrong, so the line is drawn to be crossed
                    visibly rather than hidden. */}
                <ReferenceLine x={100} stroke="#d03b3b" strokeDasharray="4 4"
                  label={{ value: t('schedCap.designedCeiling'), fontSize: 9, fill: '#d03b3b', position: 'insideTopRight' }} />
                <Bar dataKey="utilization" radius={[0, 4, 4, 0]}>
                  {capChart.map((m, i) => (
                    <Cell key={i} fill={m.unrated ? '#8a8a85' : m.utilization > 100 ? '#d03b3b' : m.utilization >= 60 ? '#008300' : '#eda100'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <Empty text={t('machineStatus.noMachines')} />}


          {missing.length > 0 && (
            <Note>{t('schedCap.unratedNote', { names: missing.map((m) => m.code ?? m.name).join(', ') })}</Note>
          )}
          <Note>{t('schedCap.windowNote')}</Note>
        </Panel>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title={t('schedCap.title')}
        subtitle={t('schedCap.subtitle')}
        icon={Target}
        scope={scope}
        window={{ from: params.dateFrom, to: params.dateTo }}
      />
      {body()}
    </div>
  );
}
