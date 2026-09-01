'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { CarbonScope2Card } from './carbon-scope2-card';
import { useTranslation } from 'react-i18next';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Zap, Gauge, DollarSign, Activity, Thermometer, AlertTriangle, Factory, TrendingDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useOrderFilterStore } from '@/store/order-filter-store';
import { cn, formatNumber } from '@/lib/utils';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

interface EnergyOverview {
  meterCount: number;
  totalConsumptionMtd: number;
  totalCostMtd: number;
  totalConsumptionToday: number;
  byType: Record<string, number>;
  trend: { date: string; value: number }[];
}

interface EnergyMeter {
  id: string;
  meterNumber: string;
  name: string;
  type: string;
  unit: string;
  location: string | null;
  machine: { name: string; code: string } | null;
  area: { name: string } | null;
  lastReading: { value: number; unit: string; timestamp: string } | null;
  mtdConsumption: number;
  mtdCost: number;
}

const TYPE_COLORS: Record<string, string> = {
  ELECTRICAL: '#4c7571',
  NATURAL_GAS: '#f59e0b',
  COMPRESSED_AIR: '#06b6d4',
  WATER: '#3b82f6',
  STEAM: '#8b5cf6',
  CHILLED_WATER: '#10b981',
};

const TYPE_ICONS: Record<string, React.FC<{ className?: string; style?: React.CSSProperties }>> = {
  ELECTRICAL: Zap,
  NATURAL_GAS: Thermometer,
  COMPRESSED_AIR: Gauge,
  WATER: Activity,
  STEAM: Thermometer,
  CHILLED_WATER: Activity,
};

interface WOEnergySummary {
  workOrderId: string;
  totalKwh: number;
  runningKwh: number;
  idleKwh: number;
  downtimeKwh: number;
  kwhPerUnit: number | null;
  kwhPerKgBatch: number | null;
  peakPowerKw: number | null;
  avgPowerKw: number | null;
  anomalyCount: number;
  wasteKwh: number;
  wastePct: number;
  efficiencyPct: number;
}

interface WorkCenterEnergy {
  workCenterId: string;
  workCenter: { id: string; code: string; name: string; level: string } | null;
  totalKwh: number;
  avgPowerKw: number | null;
  readingCount: number;
}

/** Energy ratio resolved to one machine on one work order. */
interface MachineEnergyRatio {
  machineId: string;
  machineCode: string;
  machineName: string;
  totalKwh: number;
  runningKwh: number;
  idleKwh: number;
  downtimeKwh: number;
  kwhPerUnit: number | null;
  kwhPerKg: number | null;
  kwhPerRunHour: number | null;
  productiveKwhPerUnit: number | null;
  wastePct: number | null;
  baselineKwhPerUnit: number | null;
  variancePct: number | null;
  peakPowerKw: number | null;
  avgPowerKw: number | null;
  goodQty: number | null;
  outputUnit: string | null;
  runMinutes: number;
}

interface WorkOrderMachineEnergy {
  workOrderId: string | null;
  orderNumber: string | null;
  machines: MachineEnergyRatio[];
  lineTotalKwh: number;
  lineKwhPerUnit: number | null;
  status: 'OK' | 'WORK_ORDER_NOT_FOUND' | 'NO_METER_DATA';
}

/**
 * Energy ratio per machine for one work order — the operational-level view the
 * per-WO summary above cannot give, because that one is keyed on the work order
 * alone and cannot say which machine spent the energy.
 */
function MachineEnergyRatioPanel({ workOrderId }: { workOrderId: string }) {
  const { t } = useTranslation('modules');

  const { data, isLoading } = useQuery({
    queryKey: ['energy', 'wo-machine-kpis', workOrderId],
    queryFn: () => api.get<WorkOrderMachineEnergy>(`/energy/work-orders/${workOrderId}/machine-kpis`),
    enabled: !!workOrderId,
  });

  if (isLoading) return <div className="shimmer h-28 rounded" />;

  const machines = data?.machines ?? [];

  // Say why there is nothing rather than rendering an empty space — a blank panel
  // is indistinguishable from a broken one.
  if (machines.length === 0) {
    const reason =
      data?.status === 'WORK_ORDER_NOT_FOUND'
        ? t('energy.ratioWoNotFound')
        : t('energy.ratioNoMeterData');
    return (
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-1">
          <Gauge size={16} className="text-primary" />
          <h2 className="font-semibold text-sm">{t('energy.ratioByMachine')}</h2>
        </div>
        <p className="text-xs text-muted-foreground mt-3">{reason}</p>
      </div>
    );
  }

  const unit = machines[0]?.outputUnit?.toLowerCase() ?? 'unit';
  const worstRatio = Math.max(...machines.map((m) => m.kwhPerUnit ?? 0), 0);

  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-primary" />
          <h2 className="font-semibold text-sm">{t('energy.ratioByMachine')}</h2>
        </div>
        {data?.lineKwhPerUnit != null && (
          <Badge variant="outline" className="text-xs font-mono">
            {t('energy.ratioLineTotal', {
              value: formatNumber(data.lineKwhPerUnit, 3),
              unit,
            })}
          </Badge>
        )}
      </div>
      <p className="text-[10px] text-muted-foreground mb-4">{t('energy.ratioHint')}</p>

      <div className="space-y-3">
        {machines.map((m) => {
          const ratio = m.kwhPerUnit;
          const barPct = worstRatio > 0 && ratio != null ? (ratio / worstRatio) * 100 : 0;
          // Positive variance = consuming more than the best previously demonstrated.
          const drifting = m.variancePct != null && m.variancePct > 5;
          const improving = m.variancePct != null && m.variancePct < -5;

          return (
            <div key={m.machineId} className="bg-background/40 rounded-lg border border-border/30 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono text-[10px] text-muted-foreground shrink-0">{m.machineCode}</span>
                  <span className="text-xs font-medium truncate">{m.machineName}</span>
                </div>
                <div className="flex items-baseline gap-1 shrink-0">
                  <span className="text-lg font-bold text-blue-400">
                    {ratio != null ? formatNumber(ratio, 3) : '—'}
                  </span>
                  <span className="text-[10px] text-muted-foreground">kWh/{unit}</span>
                </div>
              </div>

              <div className="h-1.5 rounded-full bg-muted/30 mb-2">
                <div className="h-full rounded-full bg-blue-500/70" style={{ width: `${barPct}%` }} />
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
                <div>
                  <span className="text-muted-foreground block">{t('energy.mTotalKwh')}</span>
                  <span className="font-semibold">{m.totalKwh.toFixed(1)}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('energy.ratioProductive')}</span>
                  <span className="font-semibold">
                    {m.productiveKwhPerUnit != null ? formatNumber(m.productiveKwhPerUnit, 3) : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('energy.mIdleWastePct')}</span>
                  <span className={cn('font-semibold', (m.wastePct ?? 0) > 15 ? 'text-red-400' : 'text-green-400')}>
                    {m.wastePct != null ? `${m.wastePct.toFixed(1)}%` : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-muted-foreground block">{t('energy.ratioVsBest')}</span>
                  {m.variancePct != null ? (
                    <span
                      className={cn(
                        'font-semibold',
                        drifting ? 'text-red-400' : improving ? 'text-green-400' : 'text-muted-foreground',
                      )}
                    >
                      {m.variancePct > 0 ? '+' : ''}
                      {m.variancePct.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{t('energy.ratioNoBaseline')}</span>
                  )}
                </div>
              </div>

              {drifting && (
                <div className="mt-2 flex items-center gap-1.5 text-[10px] text-red-400">
                  <TrendingDown size={11} />
                  <span>
                    {t('energy.ratioDrift', {
                      pct: m.variancePct!.toFixed(1),
                      baseline: formatNumber(m.baselineKwhPerUnit, 3),
                    })}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A window ending "now", quantised to the minute.
 *
 * The quantisation is load-bearing: these strings go into react-query `queryKey`s,
 * and an unrounded `new Date()` yields a different key on every single render —
 * which makes every render a cache miss, refetch, re-render, refetch… The loop
 * hammers the API until nginx's rate limiter starts returning 503.
 *
 * Truncating to the minute keeps the key stable between renders and lines up with
 * the 60s `staleTime`, so the data still refreshes once a minute.
 */
function dateRange(days: number) {
  const to = new Date();
  to.setSeconds(0, 0);
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

// ── MES Contextualization Panel ─────────────────────────────────────────────

function EnergyContextPanel() {
  const { t } = useTranslation('modules');
  const [woId, setWoId] = useState('');
  const [submittedWoId, setSubmittedWoId] = useState('');
  const { from, to } = dateRange(7);

  // Wire to the unified scope panel: selecting a WO there auto-analyses its energy.
  const scopeWoId = useOrderFilterStore((s) => s.woId);
  const effectiveWoId = submittedWoId || scopeWoId;

  const { data: woSummary, isLoading: woLoading } = useQuery({
    queryKey: ['energy', 'wo', effectiveWoId],
    queryFn: () => api.get<WOEnergySummary>(`/iot/energy/wo/${effectiveWoId}`),
    enabled: !!effectiveWoId,
  });

  const { data: wcData } = useQuery({
    queryKey: ['energy', 'by-workcenter', from, to],
    queryFn: () => api.get<WorkCenterEnergy[]>('/iot/energy/by-workcenter', { params: { from, to } }),
    staleTime: 60_000,
  });

  const summary = woSummary as WOEnergySummary | null | undefined;
  const wcEnergy: WorkCenterEnergy[] = Array.isArray(wcData) ? wcData : [];

  const wasteBreakdown = summary ? [
    { name: t('energy.wasteRunning'), value: parseFloat((summary.runningKwh ?? 0).toFixed(2)), fill: '#22c55e' },
    { name: t('energy.wasteIdle'), value: parseFloat((summary.idleKwh ?? 0).toFixed(2)), fill: '#f59e0b' },
    { name: t('energy.wasteDowntime'), value: parseFloat((summary.downtimeKwh ?? 0).toFixed(2)), fill: '#ef4444' },
  ].filter(d => d.value > 0) : [];

  return (
    <div className="space-y-5">
      {/* WO Energy lookup */}
      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Factory size={16} className="text-primary" />
          <h2 className="font-semibold">{t('energy.woEnergyTitle')}</h2>
        </div>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder={t('energy.searchWoId')}
            value={woId}
            onChange={e => setWoId(e.target.value)}
            className="h-8 text-xs font-mono"
            onKeyDown={e => { if (e.key === 'Enter' && woId.trim()) setSubmittedWoId(woId.trim()); }}
          />
          <Button size="sm" className="h-8 text-xs shrink-0" onClick={() => setSubmittedWoId(woId.trim())} disabled={!woId.trim()}>
            {t('energy.analyse')}
          </Button>
        </div>

        {woLoading && <div className="shimmer h-32 rounded" />}

        {summary && !woLoading && (
          <div className="space-y-4">
            {/* Key metrics */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: t('energy.mTotalKwh'), value: summary.totalKwh?.toFixed(2) ?? '—', color: 'text-yellow-400', icon: Zap },
                { label: t('energy.mKwhPerUnit'), value: summary.kwhPerUnit != null ? formatNumber(summary.kwhPerUnit, 3) : '—', color: 'text-blue-400', icon: Gauge },
                { label: t('energy.mIdleWastePct'), value: `${summary.wastePct?.toFixed(1) ?? '—'}%`, color: 'text-red-400', icon: TrendingDown },
                { label: t('energy.mAnomalies'), value: String(summary.anomalyCount ?? 0), color: summary.anomalyCount > 0 ? 'text-orange-400' : 'text-muted-foreground', icon: AlertTriangle },
              ].map(({ label, value, color, icon: Icon }) => (
                <div key={label} className="bg-background/40 rounded-lg border border-border/30 p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">{label}</span>
                    <Icon size={12} className={color} />
                  </div>
                  <p className={cn('text-lg font-bold', color)}>{value}</p>
                </div>
              ))}
            </div>

            {/* Waste breakdown pie */}
            {wasteBreakdown.length > 0 && (
              <div className="flex items-center gap-6">
                <ResponsiveContainer width={120} height={120}>
                  <PieChart>
                    <Pie data={wasteBreakdown} dataKey="value" innerRadius={35} outerRadius={55} paddingAngle={2}>
                      {wasteBreakdown.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--popover-foreground))', borderRadius: '8px', fontSize: 11 }}
                      formatter={(v: number) => [`${v} kWh`]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5">
                  {wasteBreakdown.map(d => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.fill }} />
                      <span className="text-muted-foreground">{d.name}</span>
                      <span className="font-semibold ml-auto">{d.value} kWh</span>
                    </div>
                  ))}
                  <div className="pt-1 border-t border-border/30 flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">{t('energy.efficiency')}</span>
                    <span className="font-bold text-green-400 ms-auto">{summary.efficiencyPct?.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* Anomaly warning */}
            {summary.anomalyCount > 0 && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 text-xs text-orange-400">
                <AlertTriangle size={13} />
                <span>{t('energy.anomalyDetected', { count: summary.anomalyCount })}</span>
              </div>
            )}
          </div>
        )}

        {!summary && !woLoading && submittedWoId && (
          <div className="text-center text-muted-foreground text-sm py-4">{t('energy.noWoData')}</div>
        )}
      </div>

      {/* Energy ratio per machine for the selected WO */}
      {effectiveWoId && <MachineEnergyRatioPanel workOrderId={effectiveWoId} />}

      {/* Plant energy map by WorkCenter */}
      {wcEnergy.length > 0 && (
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm">{t('energy.byWorkCenter')}</h2>
            <Badge variant="outline" className="text-xs">kWh</Badge>
          </div>
          <div className="space-y-2">
            {wcEnergy
              .sort((a, b) => b.totalKwh - a.totalKwh)
              .map(wc => {
                const maxKwh = wcEnergy[0]?.totalKwh ?? 1;
                const pct = (wc.totalKwh / maxKwh) * 100;
                return (
                  <div key={wc.workCenterId} className="space-y-0.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{wc.workCenter?.name ?? wc.workCenterId.slice(0, 8)}</span>
                      <div className="flex items-center gap-3">
                        {wc.avgPowerKw != null && (
                          <span className="text-[10px] text-muted-foreground">{t('energy.kwAvg', { value: wc.avgPowerKw.toFixed(1) })}</span>
                        )}
                        <span className="font-semibold">{wc.totalKwh.toFixed(1)} kWh</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/30">
                      <div
                        className="h-full rounded-full bg-yellow-500/70"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

export function EnergyOverview() {
  /**
   * Declared, because the shell reads it.
   *
   * `useDeclareViewMode` is what shows the period control -- and a page that
   * skips it inherits whatever the LAST page set. That is why these analytics
   * screens showed a partial filter bar: not a missing feature, an undeclared
   * one, and the bar they got depended on where the reader had just been.
   */
  useDeclareViewMode('analytics');

  const { t } = useTranslation('modules');
  const { filter: scopeFilter, key: scopeKey } = useScope();
  const [activeTab, setActiveTab] = useState<'overview' | 'mes'>('overview');
  const { data: overview, isLoading: ovLoading } = useQuery({
    queryKey: ['energy', 'overview', scopeKey],
    queryFn: () => api.get<EnergyOverview>('/energy/overview', { params: scopeFilter }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const { data: metersData, isLoading: metersLoading } = useQuery({
    queryKey: ['energy', 'meters', scopeKey],
    queryFn: () => api.get<EnergyMeter[]>('/energy/meters', { params: scopeFilter }),
    staleTime: 30_000,
  });

  const { from, to } = dateRange(30);
  const { data: consumptionData } = useQuery({
    queryKey: ['energy', 'consumption', '30d', scopeKey],
    queryFn: () => api.get<{ chart: any[] }>('/energy/consumption', { params: { from, to, ...scopeFilter } }),
    staleTime: 60_000,
  });

  const ov: EnergyOverview = (overview as any) ?? {
    meterCount: 0, totalConsumptionMtd: 0, totalCostMtd: 0, totalConsumptionToday: 0, byType: {}, trend: [],
  };
  const meters: EnergyMeter[] = Array.isArray(metersData) ? metersData : [];
  const chartData: any[] = (consumptionData as any)?.chart ?? ov.trend.map(t => ({ date: t.date, ELECTRICAL: t.value }));

  // Derive the series keys from the CHART ROWS themselves (every numeric, non-date
  // field) — NOT from ov.byType. Sourcing from a different query caused a load-order
  // race where the <Area dataKey> didn't match the data, so the line flashed then
  // vanished. This keeps the plotted series and the data perfectly in sync.
  const energyTypes = useMemo(() => {
    const keys = new Set<string>();
    for (const row of chartData) {
      for (const k of Object.keys(row)) {
        if (k !== 'date' && typeof row[k] === 'number') keys.add(k);
      }
    }
    return [...keys];
  }, [chartData]);

  const byTypeChart = useMemo(() =>
    Object.entries(ov.byType).map(([type, value]) => ({ type: type.replace(/_/g, ' '), value })),
    [ov.byType],
  );

  /**
   * Every figure says what it covers.
   *
   * The plant read 16 kWh here, 16.22 on Energy Monitoring and 15.0 on Factory
   * Analytics and took the three for a contradiction. All three were right --
   * different scopes over different periods -- and nothing on the screen said
   * so. A number without its window is an invitation to compare it with one
   * that has a different window.
   */
  const monthLabel = new Date().toLocaleDateString(undefined, { month: 'long' });
  const kpis = [
    { label: t('energy.kpiActiveMeters'), value: ov.meterCount, note: t('energy.scopeWholeFactory'),
      icon: Gauge, color: 'text-brand-400', bg: 'bg-brand-500/20' },
    { label: t('energy.kpiConsumptionMtd'), value: ov.totalConsumptionMtd.toLocaleString(),
      note: t('energy.scopeFactorySince', { month: monthLabel }),
      icon: Zap, color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
    { label: t('energy.kpiCostMtd'), value: ov.totalCostMtd.toLocaleString(),
      note: t('energy.scopeFactorySince', { month: monthLabel }),
      icon: DollarSign, color: 'text-green-400', bg: 'bg-green-500/20' },
    { label: t('energy.kpiTodayConsumption'), value: ov.totalConsumptionToday.toLocaleString(),
      note: t('energy.scopeFactoryToday'),
      icon: Activity, color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-2xl font-bold">{t('energy.overview.title')}</h1><DashboardInfo id="energy-overview" /><DataModeBadge mode="period" /></div>
          <p className="text-muted-foreground text-sm mt-1">{t('energy.overview.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              className={cn('px-4 py-1.5 transition-colors', activeTab === 'overview' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/20')}
              onClick={() => setActiveTab('overview')}
            >
              {t('energy.tabOverview')}
            </button>
            <button
              className={cn('px-4 py-1.5 flex items-center gap-1.5 transition-colors', activeTab === 'mes' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/20')}
              onClick={() => setActiveTab('mes')}
            >
              <Factory size={11} />
              {t('energy.tabMesContext')}
            </button>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/energy/meters">{t('energy.manageMeters')}</Link>
          </Button>
        </div>
      </div>

      {activeTab === 'mes' && <EnergyContextPanel />}

      {activeTab === 'overview' && (<>
      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card rounded-xl p-4 flex items-center gap-4"
            >
              {ovLoading ? (
                <div className="shimmer h-12 w-full rounded" />
              ) : (
                <>
                  <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', kpi.bg)}>
                    <Icon className={cn('w-5 h-5', kpi.color)} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] text-muted-foreground">{kpi.label}</div>
                    <div className="text-xl font-bold mt-0.5">{kpi.value}</div>
                    {kpi.note && (
                      <div className="text-[10px] text-muted-foreground/70 mt-0.5 truncate">{kpi.note}</div>
                    )}
                  </div>
                </>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Scope 2 emissions — derived from the same kWh figure as the cards above. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        <CarbonScope2Card />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{t('energy.consumptionTrend')}</h2>
            <Badge variant="outline" className="text-xs">{t('energy.kwhDay')}</Badge>
          </div>
          {chartData.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t('energy.noDataPeriod')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="energyGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#4c7571" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#4c7571" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--popover-foreground))', borderRadius: '8px' }}
                />
                {energyTypes.length > 0 ? energyTypes.map(type => (
                  <Area
                    key={type}
                    type="monotone"
                    dataKey={type}
                    stroke={TYPE_COLORS[type] ?? '#4c7571'}
                    fill="url(#energyGrad)"
                    strokeWidth={2}
                    /* show dots when sparse — a single point with dot={false} renders nothing */
                    dot={chartData.length <= 3 ? { r: 3 } : false}
                    connectNulls={false}
                    name={type.replace(/_/g, ' ')}
                  />
                )) : (
                  <Area type="monotone" dataKey="value" stroke="#4c7571" fill="url(#energyGrad)" strokeWidth={2} dot={chartData.length <= 3 ? { r: 3 } : false} connectNulls={false} />
                )}
                {energyTypes.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{t('energy.consumptionByType')}</h2>
            <Badge variant="outline" className="text-xs">{t('energy.kwh')}</Badge>
          </div>
          {byTypeChart.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t('energy.noData')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={byTypeChart} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
                <YAxis dataKey="type" type="category" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} width={100} />
                <Tooltip
                  contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', color: 'hsl(var(--popover-foreground))', borderRadius: '8px' }}
                />
                <Bar dataKey="value" fill="#4c7571" name={t('energy.consumption')} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Meters table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="p-4 border-b border-border/50">
          <h2 className="font-semibold text-sm">{t('energy.metersTitle')}</h2>
        </div>
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/60">
              <tr className="border-b border-border">
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('energy.colMeter')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('energy.colType')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('energy.colLocation')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('energy.colLastReading')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('energy.colMtdKwh')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('energy.colMtdCost')}</th>
              </tr>
            </thead>
            <tbody>
              {metersLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i}><td colSpan={6} className="p-3"><div className="shimmer h-5 rounded" /></td></tr>
                ))
              ) : meters.length === 0 ? (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground text-sm">{t('energy.noMetersConfigured')}</td></tr>
              ) : (
                meters.map(m => {
                  const color = TYPE_COLORS[m.type] ?? '#94a3b8';
                  const Icon = TYPE_ICONS[m.type] ?? Zap;
                  return (
                    <tr key={m.id} className="border-b border-border/30 hover:bg-foreground/5">
                      <td className="p-3 text-xs">
                        <div className="font-medium">{m.name}</div>
                        <div className="text-muted-foreground font-mono">{m.meterNumber}</div>
                      </td>
                      <td className="p-3 text-xs">
                        <div className="flex items-center gap-1.5">
                          <Icon className="w-3 h-3" style={{ color }} />
                          <span style={{ color }}>{m.type.replace(/_/g, ' ')}</span>
                        </div>
                      </td>
                      <td className="p-3 text-xs text-muted-foreground">
                        {m.machine?.name ?? m.area?.name ?? m.location ?? '—'}
                      </td>
                      <td className="p-3 text-xs text-right">
                        {m.lastReading
                          ? <span className="font-semibold">{m.lastReading.value} {m.lastReading.unit}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="p-3 text-xs text-right font-semibold">{m.mtdConsumption.toLocaleString()}</td>
                      <td className="p-3 text-xs text-right text-muted-foreground">{m.mtdCost.toLocaleString()}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>)}
    </div>
  );
}
