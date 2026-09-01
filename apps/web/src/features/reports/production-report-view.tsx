'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { useTranslation } from 'react-i18next';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, TrendingDown, Download,
  Activity, BarChart3, Clock, CheckCircle2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { api } from '@/services/api.client';
import { useOeeMode } from '@/hooks/use-oee-mode';

type Range = '7d' | '30d' | '90d';

const RANGE_DAYS: Record<Range, number> = { '7d': 7, '30d': 30, '90d': 90 };

function dateRange(days: number): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { from: from.toISOString(), to: to.toISOString() };
}

interface ReportRecord {
  date: string;
  machine: string;
  plannedQty: number;
  actualQty: number;
  goodQty: number;
  oee: number | null;
  downtime: number;
}

interface ReportSummary {
  totalPlanned: number;
  totalActual: number;
  totalGood: number;
  totalScrap: number;
  efficiency: number;
  quality: number;
  totalDowntime: number;
  avgOEE: number;
  // Time-based (OEE-TB) variant for report consistency with the dashboards.
  avgOeeTb?: number;
  availability?: number;
  availabilityTb?: number;
}

export function ProductionReportView() {
  const { t } = useTranslation('modules');
  const oeeMode = useOeeMode();
  const [range, setRange] = useState<Range>('7d');

  const { from, to } = dateRange(RANGE_DAYS[range]);

  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'production', range],
    queryFn: () => api.get<{ summary: ReportSummary; records: ReportRecord[] }>('/reports/production', {
      params: { from, to },
    }),
    staleTime: 60_000,
  });

  const summary: ReportSummary = (data as any)?.summary ?? { totalPlanned: 0, totalActual: 0, totalGood: 0, totalScrap: 0, efficiency: 0, quality: 0, totalDowntime: 0, avgOEE: 0 };
  const records: ReportRecord[] = (data as any)?.records ?? [];

  const handleExport = () => {
    const header = ['Date', 'Machine', 'Planned', 'Actual', 'Acceptance', 'OEE %', 'Downtime (min)'];
    const body = records.map((r) => [r.date.slice(0, 10), r.machine, r.plannedQty, r.actualQty, r.goodQty, r.oee ?? '', r.downtime]);
    const csv = [header, ...body].map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url; a.download = `production-report-${range}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // Group records by date for OEE trend chart
  const oeeTrend = useMemo(() => {
    const byDate: Record<string, { sum: number; count: number }> = {};
    for (const r of records) {
      const day = r.date.slice(0, 10);
      if (!byDate[day]) byDate[day] = { sum: 0, count: 0 };
      byDate[day].sum += r.oee ?? 0;
      byDate[day].count += 1;
    }
    return Object.entries(byDate).map(([date, { sum, count }]) => ({
      date: date.slice(5), // MM-DD
      oee: parseFloat((sum / count).toFixed(1)),
    }));
  }, [records]);

  // Group by machine for output chart
  const outputByMachine = useMemo(() => {
    const byMachine: Record<string, { actual: number; planned: number }> = {};
    for (const r of records) {
      if (!byMachine[r.machine]) byMachine[r.machine] = { actual: 0, planned: 0 };
      byMachine[r.machine].actual += r.actualQty;
      byMachine[r.machine].planned += r.plannedQty;
    }
    return Object.entries(byMachine).map(([machine, v]) => ({ machine, ...v }));
  }, [records]);

  const safeNum = (v: number | null | undefined) => Number(v ?? 0);
  const kpis = [
    // The FIRST card follows the basis chosen in the filter panel; the second always
    // shows the other one, so a report never hides a basis — it only decides which
    // leads. A report read months later must still show both.
    { label: oeeMode.label(t('reports.prod.kpiAvgOee')), value: `${safeNum(oeeMode.pick(summary.avgOEE, summary.avgOeeTb)).toFixed(1)}%`, icon: Activity,     color: 'text-brand-400',  bg: 'bg-brand-500/20',  up: true },
    { label: t('reports.prod.kpiAvgOeeTb'),   value: `${safeNum(summary.avgOeeTb).toFixed(1)}%`, icon: Activity, color: 'text-cyan-400',   bg: 'bg-cyan-500/20',   up: true },
    { label: t('reports.prod.kpiTotalOutput'), value: safeNum(summary.totalActual).toLocaleString(), icon: BarChart3, color: 'text-green-400',  bg: 'bg-green-500/20',  up: true },
    { label: t('reports.prod.kpiDowntime'),   value: safeNum(summary.totalDowntime).toLocaleString(), icon: Clock,   color: 'text-amber-400',  bg: 'bg-amber-500/20',  up: false },
    { label: t('reports.prod.kpiFpy'),        value: `${safeNum(summary.quality).toFixed(1)}%`, icon: CheckCircle2, color: 'text-cyan-400',   bg: 'bg-cyan-500/20',   up: true },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">{t('reports.production.title')}
            <DashboardInfo id="production-report" />
          </h1>
          <p className="text-muted-foreground text-sm mt-1">{t('reports.production.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden">
            {(['7d', '30d', '90d'] as Range[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 text-sm transition-colors ${range === r ? 'bg-brand-600 text-white' : 'text-muted-foreground hover:bg-foreground/5'}`}
              >
                {r}
              </button>
            ))}
          </div>
          <Button size="sm" onClick={handleExport} disabled={isLoading || records.length === 0}><Download className="w-4 h-4 mr-1" />{t('reports.prod.export')}</Button>
        </div>
      </div>

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
              {isLoading ? (
                <div className="shimmer h-12 w-full rounded" />
              ) : (
                <>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${kpi.bg}`}>
                    <Icon className={`w-5 h-5 ${kpi.color}`} />
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{kpi.label}</div>
                    <div className="text-xl font-bold mt-0.5">{kpi.value}</div>
                  </div>
                </>
              )}
            </motion.div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{t('reports.prod.oeeTrend')}</h2>
            <Badge variant="outline" className="text-xs capitalize">{range}</Badge>
          </div>
          {isLoading ? (
            <div className="shimmer h-[220px] rounded" />
          ) : oeeTrend.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t('reports.prod.noOeeRecords')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={oeeTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#94a3b8' }} unit="%" />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                  formatter={(v: number) => [`${v}%`]}
                />
                <Line type="monotone" dataKey="oee" stroke="#4c7571" strokeWidth={2} dot={false} name={t('reports.prod.oee')} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="glass-card rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{t('reports.prod.outputByMachine')}</h2>
            <Badge variant="outline" className="text-xs capitalize">{range}</Badge>
          </div>
          {isLoading ? (
            <div className="shimmer h-[220px] rounded" />
          ) : outputByMachine.length === 0 ? (
            <div className="h-[220px] flex items-center justify-center text-muted-foreground text-sm">{t('reports.prod.noOutputData')}</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={outputByMachine} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis dataKey="machine" type="category" tick={{ fontSize: 10, fill: '#94a3b8' }} width={80} />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '8px' }}
                />
                <Bar dataKey="planned" fill="rgba(76,117,113,0.25)" name={t('reports.prod.target')} radius={[0, 4, 4, 0]} />
                <Bar dataKey="actual"  fill="#4c7571" name={t('reports.prod.actual')} radius={[0, 4, 4, 0]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Records table */}
      {records.length > 0 && (
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50">
            <h2 className="font-semibold text-sm">{t('reports.prod.detailRecords', { count: records.length })}</h2>
          </div>
          <div className="overflow-auto max-h-64">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background/80 backdrop-blur">
                <tr className="border-b border-border">
                  <th className="text-left p-3 text-muted-foreground font-medium text-xs">{t('reports.prod.colDate')}</th>
                  <th className="text-left p-3 text-muted-foreground font-medium text-xs">{t('reports.prod.colMachine')}</th>
                  <th className="text-right p-3 text-muted-foreground font-medium text-xs">{t('reports.prod.colPlanned')}</th>
                  <th className="text-right p-3 text-muted-foreground font-medium text-xs">{t('reports.prod.colActual')}</th>
                  <th className="text-right p-3 text-muted-foreground font-medium text-xs">{t('reports.prod.colGood')}</th>
                  <th className="text-right p-3 text-muted-foreground font-medium text-xs">{t('reports.prod.colOee')}</th>
                  <th className="text-right p-3 text-muted-foreground font-medium text-xs">{t('reports.prod.colDowntime')}</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r, i) => (
                  <tr key={i} className="border-b border-border/30 hover:bg-foreground/5">
                    <td className="p-3 text-xs text-muted-foreground">{r.date.slice(0, 10)}</td>
                    <td className="p-3 text-xs font-medium">{r.machine}</td>
                    <td className="p-3 text-xs text-right">{Number(r.plannedQty ?? 0).toLocaleString()}</td>
                    <td className="p-3 text-xs text-right">{Number(r.actualQty ?? 0).toLocaleString()}</td>
                    <td className="p-3 text-xs text-right text-green-400">{Number(r.goodQty ?? 0).toLocaleString()}</td>
                    <td className="p-3 text-xs text-right font-semibold text-primary">{r.oee != null ? `${r.oee.toFixed(1)}%` : '—'}</td>
                    <td className="p-3 text-xs text-right text-muted-foreground">{r.downtime}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
