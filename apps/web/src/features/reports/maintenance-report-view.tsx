'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { useTranslation } from 'react-i18next';
import { toFactoryDayKey } from '@/lib/datetime';

import React, { useState } from 'react';
import { Download, FileText, Info, TrendingUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { KPICard } from '@/components/widgets/kpi-card';
import { api } from '@/services/api.client';

const PERIODS = [7, 30, 90] as const;

interface ReliabilityLenses {
  maintenance: {
    failures: number; repairs: number; repairHours: number;
    operatingHours: number; operatingHoursSource: 'MACHINE_STATE' | 'CALENDAR';
    mttrHours: number; mtbfHours: number; machineCount: number; windowHours: number;
  };
  equipment: {
    failures: number; unplannedStops: number; failureDowntimeHours: number;
    unplannedDowntimeHours: number; plannedDowntimeHours: number; totalDowntimeHours: number;
    capacityHours: number; uptimeHours: number; mttrHours: number; mtbfHours: number;
    machineCount: number; windowHours: number;
  };
  variance: { mtbfHours: number; mttrHours: number; failures: number };
}

interface MaintenanceReport {
  mtbf: number; mttr: number; totalWO: number; completedWO: number; completionRate: number;
  failures: number; totalCost: number;
  byType: Record<string, number>; byStatus: Record<string, number>;
  reliability?: ReliabilityLenses;
}

function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

export function MaintenanceReportView() {
  const { t } = useTranslation('modules');
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const to = toFactoryDayKey(new Date());
  const from = toFactoryDayKey(Date.now() - days * 86_400_000);
  const { data: reportData, isLoading } = useQuery({
    queryKey: ['reports', 'maintenance', from, to],
    queryFn: () => api.get<MaintenanceReport>('/reports/maintenance', { params: { from, to } }),
    staleTime: 60_000,
  });
  const r = reportData as MaintenanceReport | undefined;
  const rel = r?.reliability;
  const handleExport = () => {
    downloadCsv(`maintenance-report-${from}_${to}.csv`, [
      [t('reports.maintenance.title'), `${from} → ${to}`],
      [t('reports.maint.mtbf'), r?.mtbf ?? 0], [t('reports.maint.mttr'), r?.mttr ?? 0],
      [t('reports.maint.workOrders'), r?.totalWO ?? 0], [t('reports.maint.completionRate'), `${r?.completionRate ?? 0}%`],
      [t('reports.maint.failures'), r?.failures ?? 0], [t('reports.maint.totalCost'), r?.totalCost ?? 0],
      [t('reports.maint.completedWos'), `${r?.completedWO ?? 0} / ${r?.totalWO ?? 0}`],
      [],
      [t('reports.maint.reconciliation')],
      ['', t('reports.maint.lensMaintenance'), t('reports.maint.lensEquipment')],
      [t('reports.maint.mtbf'), rel?.maintenance.mtbfHours ?? 0, rel?.equipment.mtbfHours ?? 0],
      [t('reports.maint.mttr'), rel?.maintenance.mttrHours ?? 0, rel?.equipment.mttrHours ?? 0],
      [t('reports.maint.failureEvents'), rel?.maintenance.failures ?? 0, rel?.equipment.failures ?? 0],
      [t('reports.maint.denominator'), rel?.maintenance.operatingHours ?? 0, rel?.equipment.uptimeHours ?? 0],
    ]);
  };
  const byType: [string, number][] = Object.entries(r?.byType ?? {});
  const byStatus: [string, number][] = Object.entries(r?.byStatus ?? {});
  const pretty = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">{t('reports.maintenance.title')}
            <DashboardInfo id="maintenance-report" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('reports.maintenance.subtitle')}
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
            {t('reports.maint.exportPdf')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={t('reports.maint.mtbf')} value={(reportData as any)?.mtbf ?? 0} unit={t('reports.maint.hrs')} isLoading={isLoading} />
          <KPICard title={t('reports.maint.mttr')} value={(reportData as any)?.mttr ?? 0} unit={t('reports.maint.hrs')} isLoading={isLoading} />
          <KPICard title={t('reports.maint.workOrders')} value={(reportData as any)?.totalWO ?? 0} isLoading={isLoading} />
          <KPICard title={t('reports.maint.completionRate')} value={(reportData as any)?.completionRate ?? 0} unit="%" colorMode="default" isLoading={isLoading} />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* By status */}
          <div className="industrial-card p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><FileText size={14} className="text-brand-400" /> {t('reports.maint.byStatus')}</h3>
            {byStatus.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">{t('reports.maint.noWorkOrders')}</p>
            ) : (
              <div className="space-y-2">
                {byStatus.sort((a, b) => b[1] - a[1]).map(([s, n]) => (
                  <div key={s} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{pretty(s)}</span>
                    <span className="font-semibold tabular-nums text-foreground">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* By type */}
          <div className="industrial-card p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2"><TrendingUp size={14} className="text-brand-400" /> {t('reports.maint.byType')}</h3>
            {byType.length === 0 ? (
              <p className="text-xs text-muted-foreground py-6 text-center">{t('reports.maint.noWorkOrders')}</p>
            ) : (
              <div className="space-y-2">
                {byType.sort((a, b) => b[1] - a[1]).map(([t, n]) => (
                  <div key={t} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{pretty(t)}</span>
                    <span className="font-semibold tabular-nums text-foreground">{n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Cost + reliability */}
          <div className="industrial-card p-4">
            <h3 className="text-sm font-semibold mb-3">{t('reports.maint.costReliability')}</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('reports.maint.totalCost')}</span>
                <span className="font-semibold tabular-nums text-foreground">{t('reports.maint.sarValue', { value: (r?.totalCost ?? 0).toLocaleString() })}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('reports.maint.failures')}</span>
                <span className="font-semibold tabular-nums text-foreground">{r?.failures ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{t('reports.maint.completedWos')}</span>
                <span className="font-semibold tabular-nums text-foreground">{r?.completedWO ?? 0} / {r?.totalWO ?? 0}</span>
              </div>
            </div>
          </div>
        </div>

        {/* ------------------------------------------------------------------ */}
        {/* Reliability basis — the two lenses side by side, so the report and    */}
        {/* the Downtime Command Center can be reconciled rather than compared.  */}
        {/* ------------------------------------------------------------------ */}
        <div className="industrial-card p-4">
          <h3 className="text-sm font-semibold mb-1 flex items-center gap-2">
            <Info size={14} className="text-brand-400" /> {t('reports.maint.reconciliation')}
          </h3>
          <p className="text-xs text-muted-foreground mb-4">{t('reports.maint.reconciliationHint')}</p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[520px]">
              <thead>
                <tr className="text-muted-foreground border-b border-border/50">
                  <th className="text-start font-medium py-2">{t('reports.maint.metric')}</th>
                  <th className="text-end font-medium py-2">{t('reports.maint.lensMaintenance')}</th>
                  <th className="text-end font-medium py-2">{t('reports.maint.lensEquipment')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                <tr>
                  <td className="py-2 text-muted-foreground">{t('reports.maint.mtbf')}</td>
                  <td className="py-2 text-end font-semibold tabular-nums">{rel?.maintenance.mtbfHours ?? 0} {t('reports.maint.hrs')}</td>
                  <td className="py-2 text-end font-semibold tabular-nums">{rel?.equipment.mtbfHours ?? 0} {t('reports.maint.hrs')}</td>
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">{t('reports.maint.mttr')}</td>
                  <td className="py-2 text-end font-semibold tabular-nums">{rel?.maintenance.mttrHours ?? 0} {t('reports.maint.hrs')}</td>
                  <td className="py-2 text-end font-semibold tabular-nums">{rel?.equipment.mttrHours ?? 0} {t('reports.maint.hrs')}</td>
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">{t('reports.maint.failureEvents')}</td>
                  <td className="py-2 text-end tabular-nums">{rel?.maintenance.failures ?? 0}</td>
                  <td className="py-2 text-end tabular-nums">{rel?.equipment.failures ?? 0}</td>
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">{t('reports.maint.repairSample')}</td>
                  <td className="py-2 text-end tabular-nums">{rel?.maintenance.repairs ?? 0}</td>
                  <td className="py-2 text-end tabular-nums">{rel?.equipment.failures ?? 0}</td>
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">{t('reports.maint.denominator')}</td>
                  <td className="py-2 text-end tabular-nums">{rel?.maintenance.operatingHours ?? 0} {t('reports.maint.hrs')}</td>
                  <td className="py-2 text-end tabular-nums">{rel?.equipment.uptimeHours ?? 0} {t('reports.maint.hrs')}</td>
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">{t('reports.maint.denominatorSource')}</td>
                  <td className="py-2 text-end">
                    {rel?.maintenance.operatingHoursSource === 'MACHINE_STATE'
                      ? t('reports.maint.srcMachineState')
                      : t('reports.maint.srcCalendar')}
                  </td>
                  <td className="py-2 text-end">{t('reports.maint.srcCapacity')}</td>
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">{t('reports.maint.unplannedStops')}</td>
                  <td className="py-2 text-end text-muted-foreground">—</td>
                  <td className="py-2 text-end tabular-nums">{rel?.equipment.unplannedStops ?? 0}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-3 border-t border-border/50">
            <p className="text-xs font-medium mb-2">{t('reports.maint.methodology')}</p>
            <ul className="space-y-1.5 text-xs text-muted-foreground list-disc ps-4">
              <li>{t('reports.maint.formulaMaintMttr')}</li>
              <li>{t('reports.maint.formulaMaintMtbf')}</li>
              <li>{t('reports.maint.formulaEquipMttr')}</li>
              <li>{t('reports.maint.formulaEquipMtbf')}</li>
              <li>{t('reports.maint.inclusion')}</li>
              <li>{t('reports.maint.exclusion')}</li>
              <li>{t('reports.maint.windowNote')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
