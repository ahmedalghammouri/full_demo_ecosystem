'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Factory, Gauge, Activity, Flame, AlertTriangle, ShieldCheck, Wrench } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KPICard } from '@/components/widgets/kpi-card';
import { ExecutiveComparison, SectionTitle } from '@/features/command-center/command-center-charts';
import { getOEEColor, cn } from '@/lib/utils';

import { useExecutive } from './use-executive';
import { useOeeMode } from '@/hooks/use-oee-mode';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.06 } } };
const itemVariants = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

export function ExecutiveView() {
  /**
   * Declared, because the shell reads it.
   *
   * `useDeclareViewMode` is what shows the period control -- and a page that
   * skips it inherits whatever the LAST page set. That is why these analytics
   * screens showed a partial filter bar: not a missing feature, an undeclared
   * one, and the bar they got depended on where the reader had just been.
   */
  useDeclareViewMode('analytics');

  const { t, i18n } = useTranslation(['dashboard', 'common']);
  const { data, isLoading } = useExecutive();
  const oeeMode = useOeeMode();
  const isAr = i18n.language === 'ar';

  const totals = data?.totals;
  const rows = data?.rows ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Factory size={18} className="text-cyan-500" />
            {t('executiveCenter.title')}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('executiveCenter.subtitle')}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
          {/* Enterprise totals */}
          <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KPICard title={oeeMode.label(t('executiveCenter.totals.avgOee'))} value={oeeMode.pick(totals?.avgOee, totals?.avgOeeTb)} unit="%" target={85} colorMode="oee" isLoading={isLoading} icon={<Gauge size={16} />} />
            <KPICard title={t('executiveCenter.totals.output')} value={totals?.totalOutput ?? 0} unit={t('units')} isLoading={isLoading} icon={<Activity size={16} />} />
            <KPICard title={t('executiveCenter.totals.cost')} value={totals?.totalCostMtd ?? 0} unit="SAR" isLoading={isLoading} icon={<Flame size={16} />} />
            <KPICard title={t('executiveCenter.totals.alarms')} value={totals?.totalAlarms ?? 0} colorMode="alarm" isLoading={isLoading} icon={<AlertTriangle size={16} />} />
            <KPICard title={t('executiveCenter.totals.ncrs')} value={totals?.totalOpenNCRs ?? 0} colorMode="alarm" isLoading={isLoading} icon={<ShieldCheck size={16} />} />
            <KPICard title={t('executiveCenter.totals.maintenance')} value={totals?.totalOpenMaintenance ?? 0} isLoading={isLoading} icon={<Wrench size={16} />} />
          </motion.div>

          {/* Comparison chart */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Factory} color="#06b6d4">{t('executiveCenter.comparison')}</SectionTitle>
            <div className="industrial-card p-4">
              <div className="h-72"><ExecutiveComparison rows={rows} locale={i18n.language} /></div>
            </div>
          </motion.section>

          {/* Factory table */}
          <motion.section variants={itemVariants}>
            <div className="industrial-card p-0 overflow-x-auto">
              {rows.length === 0 ? (
                <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">{t('executiveCenter.noData')}</div>
              ) : (
                <table className="w-full text-xs min-w-[640px]">
                  <thead>
                    <tr className="border-b border-border/50 text-muted-foreground text-[10px] uppercase tracking-wider">
                      <th className="text-start font-medium px-4 py-2.5">{t('executiveCenter.table.factory')}</th>
                      <th className="text-center font-medium px-3 py-2.5">{t('executiveCenter.table.oee')}</th>
                      <th className="text-center font-medium px-3 py-2.5">{t('executiveCenter.table.apq')}</th>
                      <th className="text-end font-medium px-3 py-2.5">{t('executiveCenter.table.output')}</th>
                      <th className="text-end font-medium px-3 py-2.5">{t('executiveCenter.table.cost')}</th>
                      <th className="text-center font-medium px-3 py-2.5">{t('executiveCenter.table.alarms')}</th>
                      <th className="text-center font-medium px-3 py-2.5">{t('executiveCenter.table.ncrs')}</th>
                      <th className="text-center font-medium px-3 py-2.5">{t('executiveCenter.table.maint')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.id} className="border-b border-border/30 last:border-0 hover:bg-muted/30">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-foreground">{isAr && r.nameAr ? r.nameAr : r.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{r.code}</div>
                        </td>
                        <td className={cn('px-3 py-2.5 text-center font-bold tabular-nums', getOEEColor(oeeMode.pick(r.oee, r.oeeTb)))}>{oeeMode.pick(r.oee, r.oeeTb).toFixed(1)}%</td>
                        <td className="px-3 py-2.5 text-center tabular-nums text-muted-foreground">{r.availability.toFixed(0)} / {r.performance.toFixed(0)} / {r.quality.toFixed(0)}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums">{Math.round(r.output).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-end tabular-nums">{r.costMtd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                        <td className={cn('px-3 py-2.5 text-center tabular-nums', r.activeAlarms > 0 && 'text-rose-500 font-semibold')}>{r.activeAlarms}</td>
                        <td className={cn('px-3 py-2.5 text-center tabular-nums', r.openNCRs > 0 && 'text-amber-500 font-semibold')}>{r.openNCRs}</td>
                        <td className="px-3 py-2.5 text-center tabular-nums">{r.openMaintenance}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
