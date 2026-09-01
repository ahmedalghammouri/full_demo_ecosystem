'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';

import React from 'react';
import { motion } from 'framer-motion';
import {
  Wrench, AlertTriangle, Clock, Activity, ShieldCheck, Cpu, TrendingUp, Layers,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KPICard } from '@/components/widgets/kpi-card';
import { MTTRMTBFChart } from '@/components/charts/mttr-mtbf-chart';
import { SectionTitle } from '@/features/command-center/command-center-charts';
import { useScope } from '@/hooks/use-scope';

import { useReliabilityCockpit } from './use-reliability-cockpit';
import { BreakdownDonut, AgingBars, AssetReliabilityChart, STATUS_COLOR, TYPE_COLOR } from './reliability-charts';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.06 } } };
const itemVariants = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

function rpnColor(rpn: number): string {
  if (rpn >= 200) return '#f43f5e';
  if (rpn >= 100) return '#f59e0b';
  if (rpn >= 40) return '#eab308';
  return '#22c55e';
}

export function ReliabilityView() {
  /**
   * Declared, because the shell reads it -- see
   * analytics-pages-declare-their-mode.spec.ts. A page that skips this does not
   * get a default; it inherits whatever the LAST page set, so its filter bar
   * changes depending on where the reader arrived from.
   */
  useDeclareViewMode('analytics');
  const { t } = useTranslation(['maintenance', 'common']);
  const { filter, key } = useScope();
  const { data, isLoading } = useReliabilityCockpit();

  const k = data?.kpis;

  const statusData = (data?.woByStatus ?? [])
    .filter((s) => s.count > 0)
    .map((s) => ({ name: s.status, label: t(`woStatus.${s.status}`, { defaultValue: s.status }), value: s.count, color: STATUS_COLOR[s.status] ?? '#64748b' }));
  const typeData = (data?.woByType ?? [])
    .filter((s) => s.count > 0)
    .map((s) => ({ name: s.type, label: t(`type.${s.type}`, { defaultValue: s.type }), value: s.count, color: TYPE_COLOR[s.type] ?? '#64748b' }));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Wrench size={18} className="text-amber-500" />
            {t('cockpit.title')}
            <DashboardInfo id="maintenance-reliability" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('cockpit.subtitle')}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
          {/* KPI strip */}
          <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KPICard title={t('cockpit.kpi.openWOs')} value={k?.openWOs ?? 0} isLoading={isLoading} icon={<Wrench size={16} />} />
            <KPICard title={t('cockpit.kpi.overdue')} value={k?.overdueWOs ?? 0} colorMode="alarm" isLoading={isLoading} icon={<AlertTriangle size={16} />} />
            <KPICard title={t('cockpit.kpi.mttr')} value={k?.mttr ?? 0} unit="h" isLoading={isLoading} icon={<Clock size={16} />} />
            <KPICard title={t('cockpit.kpi.mtbf')} value={k?.mtbf ?? 0} unit="h" isLoading={isLoading} icon={<TrendingUp size={16} />} />
            <KPICard title={t('cockpit.kpi.availability')} value={k?.availabilityRate ?? 0} unit="%" target={90} colorMode="oee" isLoading={isLoading} icon={<Activity size={16} />} />
            <KPICard title={t('cockpit.kpi.pmCompliance')} value={k?.pmCompliance ?? 0} unit="%" target={95} colorMode="oee" isLoading={isLoading} icon={<ShieldCheck size={16} />} />
          </motion.div>

          {/* Reliability trend */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={TrendingUp} color="#22c55e">{t('cockpit.sections.trend')}</SectionTitle>
            <MTTRMTBFChart scopeParams={filter} scopeKey={key} isLoading={isLoading} />
          </motion.section>

          {/* Asset reliability + FMEA */}
          <motion.section variants={itemVariants}>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 lg:col-span-6">
                <SectionTitle icon={Cpu} color="#f43f5e">{t('cockpit.sections.assets')}</SectionTitle>
                <div className="industrial-card p-4">
                  <AssetReliabilityChart rows={data?.assetReliability ?? []} />
                </div>
              </div>
              <div className="col-span-12 lg:col-span-6">
                <SectionTitle icon={AlertTriangle} color="#f59e0b">{t('cockpit.sections.fmea')}</SectionTitle>
                <div className="industrial-card p-0 overflow-hidden">
                  {(data?.topFailureModes?.length ?? 0) === 0 ? (
                    <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">{t('cockpit.noFmea')}</div>
                  ) : (
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border/50 text-muted-foreground text-[10px] uppercase tracking-wider">
                          <th className="text-start font-medium px-3 py-2">{t('cockpit.fmeaCol.mode')}</th>
                          <th className="text-start font-medium px-3 py-2">{t('cockpit.fmeaCol.asset')}</th>
                          <th className="text-center font-medium px-3 py-2">{t('cockpit.fmeaCol.obs', { defaultValue: 'Failures' })}</th>
                          <th className="text-center font-medium px-3 py-2">{t('cockpit.fmeaCol.sod')}</th>
                          <th className="text-end font-medium px-3 py-2">{t('cockpit.fmeaCol.rpn')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.topFailureModes.map((f) => (
                          <tr key={f.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                            <td className="px-3 py-2 max-w-[180px] truncate" title={f.description}>{f.description}</td>
                            <td className="px-3 py-2 text-muted-foreground">{f.machine ?? '—'}</td>
                            <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{(f as any).observed ?? 0}</td>
                            <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{f.severity}·{f.occurrence}·{f.detection}</td>
                            <td className="px-3 py-2 text-end">
                              <span className="inline-flex items-center justify-center min-w-[2.5rem] rounded-md px-1.5 py-0.5 text-[11px] font-bold text-white" style={{ backgroundColor: rpnColor(f.rpn) }}>
                                {f.rpn}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          </motion.section>

          {/* Workload */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Layers} color="#4c7571">{t('cockpit.sections.workload')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="industrial-card p-4 col-span-12 md:col-span-4">
                <div className="text-xs font-semibold text-muted-foreground mb-2">{t('cockpit.byStatus')}</div>
                <BreakdownDonut data={statusData} />
              </div>
              <div className="industrial-card p-4 col-span-12 md:col-span-4">
                <div className="text-xs font-semibold text-muted-foreground mb-2">{t('cockpit.byType')}</div>
                <BreakdownDonut data={typeData} />
              </div>
              <div className="industrial-card p-4 col-span-12 md:col-span-4">
                <div className="text-xs font-semibold text-muted-foreground mb-2">{t('cockpit.aging')}</div>
                <AgingBars aging={data?.aging ?? { lt1d: 0, d1to3: 0, d3to7: 0, gt7d: 0 }} />
              </div>
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
