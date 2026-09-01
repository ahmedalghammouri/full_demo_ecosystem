'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Gauge, Zap, TrendingDown, Factory, Download, Info } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { toFactoryDayKey } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

/** Dimensions the API can group by. Order drives the selector. */
const GROUPS = [
  { id: 'sku', labelKey: 'analytics.gSku' },
  { id: 'workOrder', labelKey: 'analytics.gWorkOrder' },
  { id: 'productionOrder', labelKey: 'analytics.gProductionOrder' },
  { id: 'machine', labelKey: 'analytics.gMachine' },
  { id: 'line', labelKey: 'analytics.gLine' },
  { id: 'area', labelKey: 'analytics.gArea' },
  { id: 'shift', labelKey: 'analytics.gShift' },
  { id: 'day', labelKey: 'analytics.gDay' },
  { id: 'hour', labelKey: 'analytics.gHour' },
  { id: 'week', labelKey: 'analytics.gWeek' },
] as const;

type GroupId = (typeof GROUPS)[number]['id'];

const RANGES = [
  { id: '7', labelKey: 'analytics.r7' },
  { id: '30', labelKey: 'analytics.r30' },
  { id: '90', labelKey: 'analytics.r90' },
  { id: '365', labelKey: 'analytics.r365' },
] as const;

interface AnalyticsRow {
  key: string;
  label: string;
  subLabel: string | null;
  totalKwh: number;
  runningKwh: number;
  idleKwh: number;
  downtimeKwh: number;
  wastePct: number | null;
  goodQty: number | null;
  outputUnit: string | null;
  kwhPerUnit: number | null;
  kwhPerKg: number | null;
  productiveKwhPerUnit: number | null;
  cost: number | null;
  costPerUnit: number | null;
  avgPowerKw: number | null;
  peakPowerKw: number | null;
  runMinutes: number;
  sharePct: number;
  qtySource: 'SNAPSHOT' | 'WORK_ORDER' | 'NONE';
}

interface AnalyticsResp {
  groupBy: GroupId;
  from: string;
  to: string;
  rows: AnalyticsRow[];
  totals: {
    totalKwh: number;
    runningKwh: number;
    idleKwh: number;
    downtimeKwh: number;
    wastePct: number | null;
    goodQty: number | null;
    outputUnit: string | null;
    kwhPerUnit: number | null;
    cost: number | null;
    groups: number;
    readingCount: number;
  };
  currency: string;
  qtySource: 'SNAPSHOT' | 'WORK_ORDER' | 'NONE';
  /** Energy that exists but could not be placed in the chosen dimension. */
  unattributed: { intervals: number; kwh: number };
}

/** Trailing window, quantised to the day so the react-query key stays stable. */
function range(days: number) {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  // Plant-local day keys — a UTC day boundary would drop the current evening's
  // production into tomorrow's window.
  return { dateFrom: toFactoryDayKey(from), dateTo: toFactoryDayKey(to) };
}

/**
 * A number, at the requested precision -- unless that precision would print a
 * real measurement as zero.
 *
 * The plant read "Energy ratio (kWh/inner) 0.000" on a line that had consumed
 * 15 kWh, while the table two rows below showed 0.001 and 0.0004 for the same
 * kind of figure. Nothing was wrong with the arithmetic; three decimal places
 * simply cannot hold it. A measured value displayed as zero is indistinguishable
 * from no measurement at all, and this plant has spent a week learning what that
 * costs.
 *
 * So a non-zero value borrows just enough precision to show one significant
 * digit. A true zero still prints as zero -- it is a fact and must not be
 * dressed up.
 */
const num = (n: number | null | undefined, dp = 1) => {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n !== 0 && Math.abs(Number(n.toFixed(dp))) === 0) {
    const needed = Math.min(6, Math.ceil(-Math.log10(Math.abs(n))) + 1);
    return n.toFixed(Math.max(dp, needed));
  }
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

/**
 * Mirrors the loaded layout — KPI strip, chart, table — so the page does not
 * reflow when data lands. A single generic block was worse than nothing here:
 * this view can take several seconds on a 90-day window, and a shape-matched
 * placeholder tells the user what is coming and roughly how much of it.
 */
function AnalyticsSkeleton() {
  const { t } = useTranslation('modules');
  return (
    <div className="space-y-5" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{t('analytics.loading')}</span>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="glass-card rounded-xl p-3">
            <div className="shimmer h-2.5 w-20 rounded mb-3" />
            <div className="shimmer h-6 w-24 rounded" />
          </div>
        ))}
      </div>

      <div className="glass-card rounded-xl p-5">
        <div className="shimmer h-3.5 w-48 rounded mb-5" />
        {/* bars of varied height read as a chart rather than a grey box */}
        <div className="flex items-end gap-3 h-[240px]">
          {[68, 52, 84, 40, 61, 33, 74, 46, 57, 29, 65, 38].map((h, i) => (
            <div key={i} className="shimmer flex-1 rounded-t-md" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>

      <div className="glass-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="shimmer h-3.5 w-28 rounded" />
          <div className="shimmer h-4 w-16 rounded-full" />
        </div>
        <div className="space-y-2.5">
          <div className="shimmer h-3 w-full rounded opacity-60" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shimmer h-7 w-full rounded" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function EnergyAnalyticsView() {
  /**
   * Declared, because the shell reads it -- see
   * analytics-pages-declare-their-mode.spec.ts. A page that skips this does not
   * get a default; it inherits whatever the LAST page set, so its filter bar
   * changes depending on where the reader arrived from.
   */
  useDeclareViewMode('analytics');
  const { t } = useTranslation('modules');
  const { filter, key: scopeKey } = useScope();
  // Product is the default: it is the most business-meaningful cut and it always
  // has a per-unit denominator. Machine/line/time show absolute kWh and waste but
  // no ratio, because a work order's output cannot be split across them.
  const [groupBy, setGroupBy] = useState<GroupId>('sku');
  const [days, setDays] = useState('30');

  const { dateFrom, dateTo } = useMemo(() => range(Number(days)), [days]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['energy', 'analytics', groupBy, dateFrom, dateTo, scopeKey],
    queryFn: () =>
      api.get<AnalyticsResp>('/energy/analytics', {
        params: { groupBy, dateFrom, dateTo, ...filter },
      }),
    staleTime: 60_000,
  });

  // isFetching (not just isLoading) so switching dimension or period shows the
  // skeleton too — those refetches are the slow ones, and previously the page
  // sat on stale numbers with no indication anything was happening.
  const busy = isLoading || isFetching;

  const rows = data?.rows ?? [];
  const totals = data?.totals;
  const unit = totals?.outputUnit?.toLowerCase() ?? t('analytics.unit');

  const chartData = useMemo(
    () => rows.slice(0, 12).map((r) => ({ name: r.label.slice(0, 22), kwh: r.totalKwh, ratio: r.kwhPerUnit ?? 0 })),
    [rows],
  );

  const exportCsv = () => {
    const head = [
      t('analytics.colName'), 'kWh', 'running kWh', 'idle kWh', 'downtime kWh', 'waste %',
      `qty (${unit})`, `kWh/${unit}`, 'kWh/kg', `cost (${data?.currency ?? 'SAR'})`,
      'avg kW', 'peak kW', 'run min', 'share %', 'qty source',
    ];
    const body = rows.map((r) => [
      r.subLabel ? `${r.label} (${r.subLabel})` : r.label,
      r.totalKwh, r.runningKwh, r.idleKwh, r.downtimeKwh, r.wastePct ?? '',
      r.goodQty ?? '', r.kwhPerUnit ?? '', r.kwhPerKg ?? '', r.cost ?? '',
      r.avgPowerKw ?? '', r.peakPowerKw ?? '', r.runMinutes, r.sharePct, r.qtySource,
    ]);
    const csv = [head, ...body].map((l) => l.map((c) => `"${String(c)}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `energy-by-${groupBy}-${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-5">
      {/* ── header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">{t('analytics.title')}
            <DashboardInfo id="energy-analytics" />
          </h1>
          <p className="text-sm text-muted-foreground">{t('analytics.subtitle')}</p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={exportCsv} disabled={!rows.length}>
          <Download size={13} className="me-1.5" />
          {t('energy.exportCsv')}
        </Button>
      </div>

      {/* ── controls ───────────────────────────────────────────── */}
      <div className="glass-card rounded-xl p-4 space-y-3">
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('analytics.groupBy')}</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {GROUPS.map((g) => (
              <button
                key={g.id}
                onClick={() => setGroupBy(g.id)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs border transition-colors',
                  groupBy === g.id
                    ? 'bg-primary/15 border-primary/40 text-primary font-medium'
                    : 'bg-background/40 border-border/30 text-muted-foreground hover:text-foreground',
                )}
              >
                {t(g.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{t('analytics.period')}</span>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {RANGES.map((r) => (
              <button
                key={r.id}
                onClick={() => setDays(r.id)}
                className={cn(
                  'px-2.5 py-1 rounded-md text-xs border transition-colors',
                  days === r.id
                    ? 'bg-primary/15 border-primary/40 text-primary font-medium'
                    : 'bg-background/40 border-border/30 text-muted-foreground hover:text-foreground',
                )}
              >
                {t(r.labelKey)}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground pt-1 border-t border-border/20">
          {t('analytics.scopeHint')}
        </p>
      </div>

      {busy && <AnalyticsSkeleton />}

      {!busy && rows.length === 0 && (
        <div className="glass-card rounded-xl p-8 text-center">
          <Zap size={22} className="mx-auto text-muted-foreground mb-3" />
          {/* Energy present but unplaceable is a different problem from no energy
              at all — say which one it is instead of a blanket "no data". */}
          {(data?.unattributed.kwh ?? 0) > 0 ? (
            <>
              <p className="text-sm font-medium">{t('analytics.unattributedTitle')}</p>
              <p className="text-xs text-muted-foreground mt-1.5 max-w-xl mx-auto">
                {t('analytics.unattributedBody', {
                  kwh: num(data!.unattributed.kwh, 1),
                  group: t(GROUPS.find((g) => g.id === groupBy)!.labelKey).toLowerCase(),
                })}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">{t('analytics.emptyTitle')}</p>
              <p className="text-xs text-muted-foreground mt-1.5 max-w-xl mx-auto">{t('analytics.emptyBody')}</p>
            </>
          )}
        </div>
      )}

      {!busy && rows.length > 0 && totals && (
        <>
          {/* ── KPI strip ────────────────────────────────────────── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: t('analytics.kTotal'), value: `${num(totals.totalKwh)} kWh`, icon: Zap, color: 'text-yellow-400' },
              {
                label: t('analytics.kRatio', { unit }),
                value: totals.kwhPerUnit != null ? num(totals.kwhPerUnit, 3) : '—',
                icon: Gauge, color: 'text-blue-400',
              },
              {
                label: t('analytics.kWaste'),
                value: totals.wastePct != null ? `${num(totals.wastePct)}%` : '—',
                icon: TrendingDown, color: (totals.wastePct ?? 0) > 15 ? 'text-red-400' : 'text-green-400',
              },
              {
                label: t('analytics.kCost', { currency: data.currency }),
                value: totals.cost != null ? num(totals.cost, 2) : '—',
                icon: Factory, color: 'text-emerald-400',
              },
              { label: t('analytics.kGroups'), value: String(totals.groups), icon: Info, color: 'text-muted-foreground' },
            ].map(({ label, value, icon: Icon, color }) => (
              <div key={label} className="glass-card rounded-xl p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                  <Icon size={12} className={color} />
                </div>
                <p className={cn('text-lg font-bold', color)}>{value}</p>
              </div>
            ))}
          </div>

          {/* ── denominator provenance ───────────────────────────── */}
          {data.qtySource !== 'SNAPSHOT' && (
            <div
              className={cn(
                'flex items-start gap-2 p-3 rounded-lg text-xs border',
                data.qtySource === 'WORK_ORDER'
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-muted/20 border-border/30 text-muted-foreground',
              )}
            >
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>
                {data.qtySource === 'WORK_ORDER' ? t('analytics.srcWorkOrder') : t('analytics.srcNone')}
              </span>
            </div>
          )}

          {/* ── chart ────────────────────────────────────────────── */}
          <div className="glass-card rounded-xl p-5">
            <h2 className="text-sm font-semibold">{t('analytics.chartTitle')}</h2>
            <p className="text-[10px] text-muted-foreground mb-4">{t('analytics.chartHint')}</p>
            <ResponsiveContainer width="100%" height={300}>
              {/* One measure across categories → ONE hue. The bar length already
                  encodes magnitude, so colour carries no extra information; the
                  previous "first bar yellow" coloured by RANK, which repaints the
                  survivors whenever a filter changes the ordering. */}
              <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 56, left: 4 }} barCategoryGap="22%">
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} opacity={0.35} />
                <XAxis
                  dataKey="name"
                  // Ticks must wear text tokens — with no `fill` Recharts defaults
                  // to #666, which is unreadable on the dark card.
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={{ stroke: 'hsl(var(--border))' }}
                  angle={-32}
                  textAnchor="end"
                  interval={0}
                  height={56}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }}
                  tickLine={false}
                  axisLine={false}
                  width={48}
                />
                <Tooltip
                  cursor={{ fill: 'hsl(var(--muted-foreground))', opacity: 0.08 }}
                  contentStyle={{
                    background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))',
                    color: 'hsl(var(--popover-foreground))', borderRadius: 8, fontSize: 11,
                  }}
                  labelStyle={{ color: 'hsl(var(--foreground))', fontWeight: 600 }}
                  formatter={(v: number) => [`${num(v, 2)} kWh`, t('analytics.kTotal')]}
                />
                <Bar dataKey="kwh" radius={[4, 4, 0, 0]} fill="hsl(var(--chart-series-1))" maxBarSize={72} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* ── table ────────────────────────────────────────────── */}
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold">{t('analytics.tableTitle')}</h2>
              <Badge variant="outline" className="text-xs">
                {t('analytics.rowsBadge', { count: rows.length })}
              </Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border/30 text-muted-foreground">
                    <th className="text-start py-2 pe-3 font-medium">{t('analytics.colName')}</th>
                    <th className="text-end py-2 px-2 font-medium">kWh</th>
                    <th className="text-end py-2 px-2 font-medium">{t('analytics.colShare')}</th>
                    <th className="text-end py-2 px-2 font-medium">{t('analytics.colQty')}</th>
                    <th className="text-end py-2 px-2 font-medium">kWh/{unit}</th>
                    <th className="text-end py-2 px-2 font-medium">{t('analytics.colProductive')}</th>
                    <th className="text-end py-2 px-2 font-medium">kWh/kg</th>
                    <th className="text-end py-2 px-2 font-medium">{t('analytics.colWaste')}</th>
                    <th className="text-end py-2 px-2 font-medium">{t('analytics.colAvgKw')}</th>
                    <th className="text-end py-2 ps-2 font-medium">{data.currency}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="border-b border-border/15 hover:bg-muted/10">
                      <td className="py-2 pe-3">
                        <div className="font-medium text-foreground">{r.label}</div>
                        {r.subLabel && <div className="text-[10px] text-muted-foreground">{r.subLabel}</div>}
                      </td>
                      <td className="text-end px-2 font-semibold">{num(r.totalKwh, 2)}</td>
                      <td className="text-end px-2 text-muted-foreground">{num(r.sharePct)}%</td>
                      <td className="text-end px-2">
                        {r.goodQty != null ? (
                          <span className={r.qtySource === 'WORK_ORDER' ? 'text-amber-300' : ''}>
                            {num(r.goodQty, 0)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="text-end px-2 font-semibold text-blue-400">
                        {r.kwhPerUnit != null ? num(r.kwhPerUnit, 3) : '—'}
                      </td>
                      <td className="text-end px-2">{r.productiveKwhPerUnit != null ? num(r.productiveKwhPerUnit, 3) : '—'}</td>
                      <td className="text-end px-2">{r.kwhPerKg != null ? num(r.kwhPerKg, 4) : '—'}</td>
                      <td className={cn('text-end px-2', (r.wastePct ?? 0) > 15 ? 'text-red-400' : 'text-green-400')}>
                        {r.wastePct != null ? `${num(r.wastePct)}%` : '—'}
                      </td>
                      <td className="text-end px-2 text-muted-foreground">{r.avgPowerKw != null ? num(r.avgPowerKw, 1) : '—'}</td>
                      <td className="text-end ps-2">{r.cost != null ? num(r.cost, 2) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border/40 font-semibold">
                    <td className="py-2 pe-3">{t('analytics.total')}</td>
                    <td className="text-end px-2">{num(totals.totalKwh, 2)}</td>
                    <td className="text-end px-2">100%</td>
                    <td className="text-end px-2">{totals.goodQty != null ? num(totals.goodQty, 0) : '—'}</td>
                    <td className="text-end px-2 text-blue-400">{totals.kwhPerUnit != null ? num(totals.kwhPerUnit, 3) : '—'}</td>
                    <td className="text-end px-2">—</td>
                    <td className="text-end px-2">—</td>
                    <td className="text-end px-2">{totals.wastePct != null ? `${num(totals.wastePct)}%` : '—'}</td>
                    <td className="text-end px-2">—</td>
                    <td className="text-end ps-2">{totals.cost != null ? num(totals.cost, 2) : '—'}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
