'use client';
import { useTranslation } from 'react-i18next';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip as ReTooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { Zap, Activity, ChevronRight, AlertCircle, Download } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn } from '@/lib/utils';

interface EnergyMeter {
  id: string;
  name: string;
  type: string;
  unit: string;
  status?: string;
  lastReading?: { value: number; unit: string; timestamp: string } | null;
}
interface ConsumptionResp {
  summaries: unknown[];
  chart: Array<Record<string, number | string>>;
}

// Color per energy type for the stacked area chart.
const TYPE_COLOR: Record<string, string> = {
  ELECTRICAL: '#4c7571',
  NATURAL_GAS: '#f59e0b',
  COMPRESSED_AIR: '#10b981',
  WATER: '#22d3ee',
  STEAM: '#f43f5e',
  CHILLED_WATER: '#38bdf8',
};
const colorFor = (t: string, i: number) => TYPE_COLOR[t] ?? ['#a78bfa', '#fb7185', '#34d399', '#fbbf24'][i % 4];

function formatTimestamp(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function EnergyReportsView() {
  const { t } = useTranslation('modules');
  const { filter, key, scope } = useScope();
  const { dateFrom, dateTo, key: timeKey, label: timeLabel } = useTimeRange();

  const { data: metersData } = useQuery({
    queryKey: ['energy', 'meters', key],
    queryFn: () => api.get<EnergyMeter[]>('/energy/meters', { params: filter }).catch(() => null),
    staleTime: 60_000,
  });
  const meters: EnergyMeter[] = Array.isArray(metersData) ? metersData : [];
  const hasMeters = meters.length > 0;

  const { data: consumption, isLoading } = useQuery({
    queryKey: ['energy', 'consumption-report', key, timeKey],
    queryFn: () => api.get<ConsumptionResp>('/energy/consumption', {
      params: { from: dateFrom, to: dateTo, periodType: 'DAILY', ...filter },
    }),
    staleTime: 30_000,
  });

  const chart = consumption?.chart ?? [];
  // Discover the energy-type series present in the data (all keys except `date`).
  const typeKeys = useMemo(() => {
    const set = new Set<string>();
    for (const row of chart) for (const k of Object.keys(row)) if (k !== 'date') set.add(k);
    return [...set];
  }, [chart]);

  // Totals per type for the summary cards.
  const totals = useMemo(() => {
    const t: Record<string, number> = {};
    for (const row of chart) for (const k of typeKeys) t[k] = (t[k] ?? 0) + (Number(row[k]) || 0);
    return t;
  }, [chart, typeKeys]);
  const grandTotal = Object.values(totals).reduce((s, v) => s + v, 0);

  const exportCsv = () => {
    if (!chart.length) return;
    const header = ['date', ...typeKeys];
    const rows = chart.map((r) => header.map((h) => r[h] ?? 0).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `energy-consumption_${dateFrom}_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-yellow-500/20 flex items-center justify-center shrink-0">
          <Zap className="w-5 h-5 text-yellow-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('energy.reports.title')}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t('energy.consumptionAnalytics')} — <span className="text-foreground">{scope?.name ?? t('energy.wholeFactory')}</span> · {timeLabel}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {hasMeters && (
            <Badge variant="outline" className="text-xs">{t('energy.metersBadge', { count: meters.length })}</Badge>
          )}
          <Button size="sm" variant="outline" className="gap-1.5 h-8 text-xs" onClick={exportCsv} disabled={!chart.length}>
            <Download className="w-3.5 h-3.5" /> {t('energy.exportCsv')}
          </Button>
        </div>
      </div>

      {/* Summary cards: total + by type */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="industrial-card rounded-xl p-4">
          <div className="text-xs text-muted-foreground">{t('energy.totalConsumption')}</div>
          <div className="text-2xl font-bold text-foreground tabular-nums">{grandTotal.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
          <div className="text-[10px] text-muted-foreground">{t('energy.kwhEquivalent')} · {timeLabel}</div>
        </div>
        {Object.entries(totals).sort(([, a], [, b]) => b - a).slice(0, 3).map(([type, val], i) => (
          <div key={type} className="industrial-card rounded-xl p-4">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full" style={{ background: colorFor(type, i) }} />
              {type.replace(/_/g, ' ')}
            </div>
            <div className="text-2xl font-bold text-foreground tabular-nums">{val.toLocaleString(undefined, { maximumFractionDigits: 1 })}</div>
            <div className="text-[10px] text-muted-foreground">{t('energy.pctOfTotal', { value: grandTotal > 0 ? ((val / grandTotal) * 100).toFixed(0) : 0 })}</div>
          </div>
        ))}
      </div>

      {/* Consumption trend by type */}
      <div className="industrial-card rounded-xl p-4">
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} className="text-yellow-400" />
          <h2 className="text-sm font-semibold text-foreground">{t('energy.consumptionByType')}</h2>
          <span className="ml-auto text-[10px] text-muted-foreground">{t('energy.daily')} · {timeLabel}</span>
        </div>
        {isLoading ? (
          <div className="shimmer h-56 rounded" />
        ) : chart.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-xs text-muted-foreground">{t('energy.noConsumptionPeriod')}</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chart} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.12)" />
              <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
              <ReTooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {typeKeys.map((t, i) => (
                <Area
                  key={t}
                  type="monotone"
                  dataKey={t}
                  name={t.replace(/_/g, ' ')}
                  stackId="1"
                  stroke={colorFor(t, i)}
                  fill={colorFor(t, i)}
                  fillOpacity={0.25}
                  strokeWidth={2}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Connected meters */}
      {hasMeters && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">{t('energy.connectedMeters')}</h2>
          <div className="industrial-card rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t('energy.colName')}</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t('energy.colType')}</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t('energy.colUnit')}</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t('energy.colStatus')}</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">{t('energy.cardLastReading')}</th>
                </tr>
              </thead>
              <tbody>
                {meters.map((meter, i) => {
                  const isActive = !meter.status || meter.status === 'ACTIVE';
                  return (
                    <tr key={meter.id} className={cn('border-b border-border/20 last:border-0 hover:bg-muted/10', i % 2 === 0 ? '' : 'bg-muted/5')}>
                      <td className="px-4 py-3 font-medium text-foreground">{meter.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{meter.type.replace(/_/g, ' ')}</td>
                      <td className="px-4 py-3 text-muted-foreground">{meter.unit}</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline" className={cn('text-[10px]', isActive ? 'text-green-400 border-green-500/40 bg-green-500/10' : 'text-red-400 border-red-500/40 bg-red-500/10')}>
                          <Activity className="w-2.5 h-2.5 mr-1" />
                          {isActive ? t('energy.statusActive') : t('energy.statusOffline')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {meter.lastReading ? `${meter.lastReading.value} ${meter.lastReading.unit} — ${formatTimestamp(meter.lastReading.timestamp)}` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Navigation tip */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{t('energy.configureMetersAt')}</span>
        <Link href="/energy/meters" className="inline-flex items-center gap-0.5 text-primary hover:underline underline-offset-2">
          {t('energy.metersTitle')} <ChevronRight className="w-3 h-3" />
        </Link>
      </div>
    </div>
  );
}
