'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { useTranslation } from 'react-i18next';
import { toFactoryDayKey } from '@/lib/datetime';

import React from 'react';
import { Download, Info } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import { KPICard } from '@/components/widgets/kpi-card';
import { api } from '@/services/api.client';

const PERIODS = [7, 30, 90] as const;

interface QualityTrendPoint {
  date: string;
  fpy: number;
  defectRate: number;
  inspected: number;
}

interface QualityParetoRow {
  category: string;
  quantity: number;
  count: number;
}

interface QualityReport {
  fpy: number;
  defectRate: number;
  defectPpm: number;
  inspectionCount: number;
  ncrCount: number;
  criticalNcrCount: number;
  totalInspected: number;
  totalPassed: number;
  totalFailed: number;
  trend: QualityTrendPoint[];
  defectPareto: QualityParetoRow[];
}

function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function QualityReportView() {
  const { t } = useTranslation('modules');
  const [days, setDays] = React.useState<(typeof PERIODS)[number]>(7);
  const to = toFactoryDayKey(new Date());
  const from = toFactoryDayKey(Date.now() - days * 86_400_000);
  const { data, isLoading } = useQuery({
    queryKey: ['reports', 'quality', from, to],
    queryFn: () => api.get<QualityReport>('/reports/quality', { params: { from, to } }),
    staleTime: 60_000,
  });

  const d = data as QualityReport | undefined;
  const trend = d?.trend ?? [];
  const pareto = d?.defectPareto ?? [];
  const paretoTotal = pareto.reduce((s, r) => s + (r.quantity || r.count), 0) || 1;

  const handleExport = () => {
    downloadCsv(`quality-report-${from}_${to}.csv`, [
      [t('reports.quality.title'), `${from} → ${to}`],
      [t('reports.qual.fpy'), `${d?.fpy ?? 0}%`],
      [t('reports.qual.defectRate'), `${d?.defectRate ?? 0}%`],
      [t('reports.qual.defectPpm'), d?.defectPpm ?? 0],
      [t('reports.qual.inspections'), d?.inspectionCount ?? 0],
      [t('reports.qual.unitsInspected'), d?.totalInspected ?? 0],
      [t('reports.qual.unitsPassed'), d?.totalPassed ?? 0],
      [t('reports.qual.unitsFailed'), d?.totalFailed ?? 0],
      [t('reports.qual.ncrs'), d?.ncrCount ?? 0],
      [t('reports.qual.criticalNcrs'), d?.criticalNcrCount ?? 0],
      [],
      [t('reports.qual.trend'), t('reports.qual.fpy'), t('reports.qual.defectRate'), t('reports.qual.unitsInspected')],
      ...trend.map((p) => [p.date, p.fpy, p.defectRate, p.inspected]),
    ]);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">{t('reports.quality.title')}
            <DashboardInfo id="quality-report" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('reports.quality.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border/60 overflow-hidden">
            {PERIODS.map((p) => (
              <button key={p} onClick={() => setDays(p)}
                className={`px-2.5 h-8 text-xs ${days === p ? 'bg-primary text-primary-foreground' : 'hover:bg-muted/50'}`}>
                {p}d
              </button>
            ))}
          </div>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleExport} disabled={isLoading}>
            <Download size={13} />
            {t('reports.qual.exportPdf')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={t('reports.qual.fpy')} value={d?.fpy ?? 0} unit="%" colorMode="oee" isLoading={isLoading} />
          <KPICard title={t('reports.qual.defectRate')} value={d?.defectRate ?? 0} unit="%" colorMode="alarm" isLoading={isLoading} />
          <KPICard title={t('reports.qual.inspections')} value={d?.inspectionCount ?? 0} isLoading={isLoading} />
          <KPICard title={t('reports.qual.ncrs')} value={d?.ncrCount ?? 0} colorMode="alarm" isLoading={isLoading} />
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={t('reports.qual.unitsInspected')} value={d?.totalInspected ?? 0} isLoading={isLoading} />
          <KPICard title={t('reports.qual.unitsPassed')} value={d?.totalPassed ?? 0} isLoading={isLoading} />
          <KPICard title={t('reports.qual.unitsFailed')} value={d?.totalFailed ?? 0} colorMode="alarm" isLoading={isLoading} />
          <KPICard title={t('reports.qual.defectPpm')} value={d?.defectPpm ?? 0} colorMode="alarm" isLoading={isLoading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* FPY / defect-rate trend */}
          <div className="industrial-card p-4 lg:col-span-2">
            <h3 className="text-sm font-semibold mb-4">{t('reports.qual.trend')}</h3>
            {trend.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">{t('reports.qual.noData')}</p>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border/40" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} stroke="currentColor" className="text-muted-foreground" />
                  <Tooltip contentStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="fpy" name={t('reports.qual.fpy')} stroke="#22c55e" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="defectRate" name={t('reports.qual.defectRate')} stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>

          {/* Defect Pareto */}
          <div className="industrial-card p-4">
            <h3 className="text-sm font-semibold mb-3">{t('reports.qual.pareto')}</h3>
            {pareto.length === 0 ? (
              <p className="text-xs text-muted-foreground py-16 text-center">{t('reports.qual.noData')}</p>
            ) : (
              <div className="space-y-2.5">
                {pareto.slice(0, 8).map((row) => {
                  const value = row.quantity || row.count;
                  return (
                    <div key={row.category} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground truncate">{row.category}</span>
                        <span className="font-semibold tabular-nums text-foreground">{value}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full rounded-full bg-danger-500" style={{ width: `${(value / paretoTotal) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Methodology — the definitions travel with the numbers */}
        <div className="industrial-card p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Info size={14} className="text-brand-400" /> {t('reports.qual.howCalculated')}
          </h3>
          <ul className="space-y-1.5 text-xs text-muted-foreground list-disc ps-4">
            <li>{t('reports.qual.fpyFormula')}</li>
            <li>{t('reports.qual.defectFormula')}</li>
            <li>{t('reports.qual.sourceNote')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
