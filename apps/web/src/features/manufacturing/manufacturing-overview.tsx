'use client';
import { DataModeBadge } from '@/components/ui/data-mode-badge';

import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import {
  Factory,
  Gauge,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Monitor,
  Users,
  Zap,
  Clock,
} from 'lucide-react';
import Link from 'next/link';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn, formatPercent, formatNumber } from '@/lib/utils';

// ─── TypeScript interfaces ────────────────────────────────────────────────────

interface KPIs {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
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
}

interface Machine {
  id: string;
  name: string;
  code: string;
  state: 'RUNNING' | 'IDLE' | 'DOWN' | 'MAINTENANCE' | string;
  oee: number;
  currentOrder: string | null;
  throughput: number;
  runtime: number;
  lastUpdate: string;
  area: string;
}

interface ProductionStatus {
  runningLines: number;
  totalLines: number;
  activeOrders: number;
  completedToday: number;
  plannedOutput: number;
  actualOutput: number;
}

interface ProductionTrendPoint {
  time: string;
  actual: number;
  target: number;
}

interface ShiftSummary {
  shiftName: string;
  operator: string;
  startTime: string;
  elapsed: string;
  output: number;
  target: number;
  oee: number;
  downtime: number;
  defects: number;
}

interface DashboardOverview {
  kpis: KPIs;
  machines: Machine[];
  productionStatus: ProductionStatus;
  productionTrend: ProductionTrendPoint[];
  shiftSummary: ShiftSummary;
}

interface WorkOrderSKU {
  name: string;
}

interface WorkOrder {
  id: string;
  woNumber: string;
  status: string;
  sku: WorkOrderSKU;
  plannedQty: number;
  goodQty: number;
  scrapQty: number;
  progress: number;
  completedSteps: number;
  totalSteps: number;
}

interface WorkOrdersResponse {
  data: WorkOrder[];
  total: number;
}

interface JobOrderMachine {
  name: string;
}

interface JobOrderOperator {
  firstName: string;
  lastName: string;
}

interface JobOrder {
  id: string;
  joNumber: string;
  status: string;
  machine: JobOrderMachine;
  operator: JobOrderOperator;
  joOEE: number;
}

interface JobOrdersResponse {
  data: JobOrder[];
  total: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getMachineStateStyle(state: string): {
  label: string;
  badgeClass: string;
  dotClass: string;
} {
  switch (state?.toUpperCase()) {
    case 'RUNNING':
      return {
        label: 'Running',
        badgeClass: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        dotClass: 'bg-emerald-400',
      };
    case 'IDLE':
      return {
        label: 'Idle',
        badgeClass: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
        dotClass: 'bg-yellow-400',
      };
    case 'DOWN':
      return {
        label: 'Down',
        badgeClass: 'bg-red-500/20 text-red-400 border-red-500/30',
        dotClass: 'bg-red-400',
      };
    case 'MAINTENANCE':
      return {
        label: 'Maintenance',
        badgeClass: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
        dotClass: 'bg-blue-400',
      };
    default:
      return {
        label: state ?? 'Unknown',
        badgeClass: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
        dotClass: 'bg-gray-400',
      };
  }
}

function getOEEBarColor(oee: number): string {
  if (oee >= 85) return 'bg-emerald-500';
  if (oee >= 65) return 'bg-yellow-500';
  if (oee >= 45) return 'bg-orange-500';
  return 'bg-red-500';
}

function TrendIndicator({ value }: { value: number }) {
  const positive = value >= 0;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        positive ? 'text-emerald-400' : 'text-red-400'
      )}
    >
      {positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonBlock({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-md bg-foreground/5', className)} />;
}

function OverviewSkeleton() {
  return (
    <div className="space-y-6 p-6">
      <SkeletonBlock className="h-10 w-80" />
      <SkeletonBlock className="h-16 w-full" />
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-28" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonBlock className="h-64" />
        </div>
        <SkeletonBlock className="h-64" />
      </div>
      <SkeletonBlock className="h-48" />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function ManufacturingOverview() {
  const { t } = useTranslation('modules');
  const { filter: scopeFilter, key: scopeKey } = useScope();
  // The period the reader picked. Without it this page asked /dashboard/overview
  // for whatever that endpoint defaults to, so the filter panel's Today / Shift /
  // Week buttons changed the scope tree above these cards and nothing in them.
  const { params: timeParams, key: timeKey } = useTimeRange();
  const { data: overview, isLoading: overviewLoading } = useQuery<DashboardOverview>({
    queryKey: ['dashboard-overview', scopeKey, timeKey],
    queryFn: () => api.get<DashboardOverview>('/dashboard/overview', {
      params: { ...scopeFilter, ...timeParams },
    }),
    refetchInterval: 15000,
  });

  const { data: workOrdersResp, isLoading: woLoading } = useQuery<WorkOrdersResponse>({
    queryKey: ['work-orders-in-progress', scopeKey],
    queryFn: () =>
      api.get<WorkOrdersResponse>('/production/work-orders', { params: { status: 'IN_PROGRESS', limit: 20, ...scopeFilter } }),
    refetchInterval: 15000,
  });

  const { data: jobOrdersResp, isLoading: joLoading } = useQuery<JobOrdersResponse>({
    queryKey: ['job-orders-executing', scopeKey],
    queryFn: () =>
      api.get<JobOrdersResponse>('/production/job-orders', { params: { status: 'EXECUTING', limit: 30, ...scopeFilter } }),
    refetchInterval: 15000,
  });

  const isLoading = overviewLoading || woLoading || joLoading;

  if (isLoading) return <OverviewSkeleton />;

  const kpis = overview?.kpis;
  const machines = overview?.machines ?? [];
  const productionTrend = overview?.productionTrend ?? [];
  const shiftSummary = overview?.shiftSummary;
  const workOrders = workOrdersResp?.data ?? [];
  const jobOrders = jobOrdersResp?.data ?? [];
  const activeAlarms = kpis?.activeAlarms ?? 0;
  const shiftOutputPct =
    shiftSummary && shiftSummary.target > 0
      ? Math.min(100, (shiftSummary.output / shiftSummary.target) * 100)
      : 0;

  const kpiCards = [
    {
      label: t('mfgOverview.kpi.activeWo'),
      value: workOrdersResp?.total ?? workOrders.length,
      trend: null,
      icon: <Monitor className="h-5 w-5 text-blue-400" />,
      alarm: false,
    },
    {
      label: t('mfgOverview.kpi.activeJo'),
      value: jobOrdersResp?.total ?? jobOrders.length,
      trend: null,
      icon: <Users className="h-5 w-5 text-purple-400" />,
      alarm: false,
    },
    {
      label: t('mfgOverview.kpi.oee'),
      value: kpis ? formatPercent(kpis.oee) : '—',
      trend: kpis?.oeeTrend,
      icon: <Gauge className="h-5 w-5 text-emerald-400" />,
      alarm: false,
    },
    {
      label: t('mfgOverview.kpi.availability'),
      value: kpis ? formatPercent(kpis.availability) : '—',
      trend: kpis?.availabilityTrend,
      icon: <Zap className="h-5 w-5 text-yellow-400" />,
      alarm: false,
    },
    {
      label: t('mfgOverview.kpi.unitsToday'),
      value: kpis ? formatNumber(kpis.totalOutput, 0) : '—',
      trend: kpis?.outputTrend,
      icon: <TrendingUp className="h-5 w-5 text-cyan-400" />,
      alarm: false,
    },
    {
      label: t('mfgOverview.kpi.activeAlarms'),
      value: activeAlarms,
      trend: null,
      icon: <AlertTriangle className="h-5 w-5 text-red-400" />,
      alarm: activeAlarms > 0,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35 }}
      className="space-y-6 p-6"
    >
      {/* ── 1. Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Factory className="h-7 w-7 text-brand-400" />
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2">{t('mfgOverview.title')}
            <DataModeBadge mode="live" />
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            {t('mfgOverview.live')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href="/manufacturing/control">{t('mfgOverview.controlPanel')}</Link>
          </Button>
          <Button size="sm" asChild>
            <Link href="/manufacturing/oee">{t('mfgOverview.viewOee')}</Link>
          </Button>
        </div>
      </div>

      {/* ── 2. Shift Summary Bar ──────────────────────────────────────────── */}
      {shiftSummary && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-foreground/10 bg-foreground/5 px-5 py-3">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">{shiftSummary.shiftName}</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>{t('mfgOverview.elapsed')}:</span>
            <span className="font-medium text-foreground">{shiftSummary.elapsed}</span>
          </div>
          <div className="flex min-w-[180px] flex-1 items-center gap-2">
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {t('mfgOverview.output')} {formatNumber(shiftSummary.output, 0)} / {formatNumber(shiftSummary.target, 0)}
            </span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-500"
                style={{ width: `${shiftOutputPct}%` }}
              />
            </div>
            <span className="text-xs font-medium text-foreground">{shiftOutputPct.toFixed(0)}%</span>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="text-muted-foreground">{t('mfgOverview.kpi.oee')}:</span>
            <span
              className={cn(
                'font-bold',
                shiftSummary.oee >= 85
                  ? 'text-emerald-400'
                  : shiftSummary.oee >= 65
                  ? 'text-yellow-400'
                  : 'text-red-400'
              )}
            >
              {formatPercent(shiftSummary.oee)}
            </span>
          </div>
        </div>
      )}

      {/* ── 3. KPI Cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {kpiCards.map((card) => (
          <motion.div
            key={card.label}
            whileHover={{ scale: 1.02 }}
            className={cn(
              'rounded-xl border bg-foreground/5 p-4 transition-colors',
              card.alarm
                ? 'border-red-500/50 bg-red-500/10'
                : 'border-foreground/10 hover:border-foreground/20'
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              {card.icon}
              {card.trend !== null && card.trend !== undefined && (
                <TrendIndicator value={card.trend} />
              )}
            </div>
            <div
              className={cn(
                'text-2xl font-bold',
                card.alarm ? 'text-red-400' : 'text-foreground'
              )}
            >
              {String(card.value)}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">{card.label}</div>
          </motion.div>
        ))}
      </div>

      {/* Time-Based (OEE-TB) — shown beside the schedule-based KPIs above */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground px-1">
        <span>{t('mfgOverview.atOee')}: <b className="text-foreground">{kpis ? formatPercent(kpis.oeeTb ?? 0) : '—'}</b></span>
        <span>{t('mfgOverview.availabilityTb')}: <b className="text-foreground">{kpis ? formatPercent(kpis.availabilityTb ?? 0) : '—'}</b></span>
        <span className="opacity-70">{t('mfgOverview.scheduleNote')}</span>
      </div>

      {/* ── 4. Machine Grid + Active Operations ───────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* LEFT: Machine Status Grid */}
        <div className="lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <Monitor className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">{t('mfgOverview.machineStatusGrid')}</h2>
            <Badge variant="outline" className="text-xs">
              {t('mfgOverview.machinesCount', { count: machines.length })}
            </Badge>
          </div>
          {machines.length === 0 ? (
            <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-8 text-center text-sm text-muted-foreground">
              {t('mfgOverview.noMachineData')}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {machines.map((machine) => {
                const stateStyle = getMachineStateStyle(machine.state);
                return (
                  <motion.div
                    key={machine.id}
                    whileHover={{ scale: 1.01 }}
                    className="rounded-xl border border-foreground/10 bg-foreground/5 p-3 transition-colors hover:border-foreground/20"
                  >
                    <div className="mb-2 flex items-start justify-between gap-1">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{machine.name}</p>
                        <p className="text-xs text-muted-foreground">{machine.code}</p>
                      </div>
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
                          stateStyle.badgeClass
                        )}
                      >
                        <span className={cn('h-1.5 w-1.5 rounded-full', stateStyle.dotClass)} />
                        {t(`mfgOverview.state.${String(machine.state ?? '').toUpperCase()}`, { defaultValue: stateStyle.label })}
                      </span>
                    </div>
                    {machine.area && (
                      <span className="mb-2 inline-block rounded bg-foreground/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {machine.area}
                      </span>
                    )}
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{t('mfgOverview.kpi.oee')}</span>
                      <span className="font-medium text-foreground">{formatPercent(machine.oee)}</span>
                    </div>
                    <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-foreground/10">
                      <div
                        className={cn('h-full rounded-full transition-all duration-500', getOEEBarColor(machine.oee))}
                        style={{ width: `${Math.min(100, machine.oee ?? 0)}%` }}
                      />
                    </div>
                    {machine.currentOrder && (
                      <p className="truncate text-xs text-muted-foreground">
                        {t('mfgOverview.order')}:{' '}
                        <span className="font-medium text-foreground">{machine.currentOrder}</span>
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t('mfgOverview.throughput')}:{' '}
                      <span className="font-medium text-foreground">
                        {t('mfgOverview.uPerHr', { value: formatNumber(machine.throughput, 0) })}
                      </span>
                    </p>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT: Active Operations */}
        <div>
          <div className="mb-3 flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">{t('mfgOverview.activeOperations')}</h2>
            <Badge variant="outline" className="text-xs">
              {jobOrders.length}
            </Badge>
          </div>
          <div className="overflow-hidden rounded-xl border border-foreground/10 bg-foreground/5">
            {jobOrders.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {t('mfgOverview.noExecutingJo')}
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {jobOrders.map((jo) => {
                  const wo = workOrders.find((w) =>
                    w.woNumber === jo.joNumber?.split('-')[0]
                  );
                  return (
                    <div
                      key={jo.id}
                      className="flex items-start gap-2 px-3 py-2.5 text-xs hover:bg-foreground/5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground">{jo.joNumber}</p>
                        {wo && (
                          <p className="truncate text-muted-foreground">{wo.woNumber}</p>
                        )}
                        {jo.machine && <p className="truncate text-muted-foreground">{jo.machine.name}</p>}
                        {jo.operator && (
                          <p className="truncate text-muted-foreground">
                            {jo.operator.firstName} {jo.operator.lastName}
                          </p>
                        )}
                      </div>
                      <span className="mt-0.5 shrink-0 rounded-full bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                        {jo.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── 5. Production Trend Chart ──────────────────────────────────────── */}
      <div className="rounded-xl border border-foreground/10 bg-foreground/5 p-4">
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">{t('mfgOverview.productionTrend')}</h2>
        </div>
        {productionTrend.length === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-sm text-muted-foreground">
            {t('mfgOverview.noTrendData')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={productionTrend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="gradActual" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradTarget" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#4c7571" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#4c7571" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis
                dataKey="time"
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1a1a2e',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: '#fff',
                }}
              />
              <Area
                type="monotone"
                dataKey="target"
                stroke="#4c7571"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                fill="url(#gradTarget)"
                name={t('mfgOverview.chartTarget')}
              />
              <Area
                type="monotone"
                dataKey="actual"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#gradActual)"
                name={t('mfgOverview.chartActual')}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── 6. Active Alarms (conditional) ────────────────────────────────── */}
      {activeAlarms > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-400" />
            <h2 className="text-sm font-semibold text-red-400">
              {t('mfgOverview.activeAlarmsTitle', { count: activeAlarms })}
            </h2>
          </div>
          <div className="space-y-2">
            {/* Placeholder rows — real alarm data would come from a dedicated endpoint */}
            {Array.from({ length: Math.min(activeAlarms, 5) }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs"
              >
                <span className="rounded-full bg-red-500/30 px-2 py-0.5 font-semibold text-red-300">
                  {t('mfgOverview.high')}
                </span>
                <span className="flex-1 text-red-200">{t('mfgOverview.alarmPlaceholder', { num: i + 1 })}</span>
                <span className="text-red-400/60">—</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}
