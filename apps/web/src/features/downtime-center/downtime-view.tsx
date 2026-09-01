'use client';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { DashboardInfo } from '@/components/ui/dashboard-info';

import React from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, Clock, Activity, Wrench, Timer, Gauge, PauseCircle, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { KPICard } from '@/components/widgets/kpi-card';
import { SectionTitle } from '@/features/command-center/command-center-charts';
import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';
import { cn } from '@/lib/utils';

import { useDowntimeCockpit } from './use-downtime-cockpit';
import { DowntimeTrend, DowntimeByMachine, CategoryPareto, PlannedSplit } from './downtime-charts';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.06 } } };
const itemVariants = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);

export function DowntimeCenterView() {
  /**
   * Declared, because the shell reads it.
   *
   * `useDeclareViewMode` is what shows the period control -- and a page that
   * skips it inherits whatever the LAST page set. That is why these analytics
   * screens showed a partial filter bar: not a missing feature, an undeclared
   * one, and the bar they got depended on where the reader had just been.
   */
  useDeclareViewMode('analytics');

  const { t } = useTranslation(['downtime', 'common']);
  const { data, isLoading } = useDowntimeCockpit();
  const { trendType } = useDashboardPrefsStore();

  const k = data?.kpis;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <PauseCircle size={18} className="text-rose-500" />
            {t('cockpit.title')}
            <DashboardInfo id="downtime-center" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('cockpit.subtitle')}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
          {/* KPI strip */}
          <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <KPICard title={t('cockpit.kpi.total')} value={fmtMin(k?.totalDowntimeMin ?? 0)} colorMode="alarm" isLoading={isLoading} icon={<Clock size={16} />} />
            <KPICard title={t('cockpit.kpi.unplanned')} value={fmtMin(k?.unplannedMin ?? 0)} colorMode="alarm" isLoading={isLoading} icon={<AlertTriangle size={16} />} />
            <KPICard title={t('cockpit.kpi.planned')} value={fmtMin(k?.plannedMin ?? 0)} isLoading={isLoading} icon={<Layers size={16} />} />
            <KPICard title={t('cockpit.kpi.oeeImpact')} value={fmtMin(k?.oeeImpactMin ?? 0)} colorMode="alarm" isLoading={isLoading} icon={<Gauge size={16} />} />
            <KPICard title={t('cockpit.kpi.availLoss')} value={k?.availabilityLossPct ?? 0} unit="%" colorMode="alarm" isLoading={isLoading} icon={<Activity size={16} />} />
            <KPICard title={t('cockpit.kpi.mttr')} value={k?.mttrHours ?? 0} unit="h" isLoading={isLoading} icon={<Wrench size={16} />} />
            <KPICard title={t('cockpit.kpi.mtbf')} value={k?.mtbfHours ?? 0} unit="h" isLoading={isLoading} icon={<Timer size={16} />} />
          </motion.div>

          {/* Trend + planned split */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Activity} color="#f43f5e">{t('cockpit.sections.trend')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="industrial-card p-4 col-span-12 lg:col-span-8">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xs font-semibold text-muted-foreground">{t('cockpit.plannedVsUnplanned')}</span>
                  <DataModeBadge mode="period" />
                </div>
                <div className="h-64"><DowntimeTrend data={data?.trend ?? []} type={trendType} /></div>
              </div>
              <div className="industrial-card p-4 col-span-12 lg:col-span-4">
                <div className="text-xs font-semibold text-muted-foreground mb-2">{t('cockpit.split')}</div>
                <div className="h-64"><PlannedSplit planned={data?.plannedVsUnplanned.planned ?? 0} unplanned={data?.plannedVsUnplanned.unplanned ?? 0} /></div>
              </div>
            </div>
          </motion.section>

          {/* Machine + category Pareto */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={AlertTriangle} color="#f59e0b">{t('cockpit.sections.breakdown')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="industrial-card p-4 col-span-12 lg:col-span-6">
                <div className="text-xs font-semibold text-muted-foreground mb-2">{t('cockpit.byMachine')}</div>
                <div className="h-60">
                  {(data?.byMachine.length ?? 0) === 0
                    ? <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{t('cockpit.noData')}</div>
                    : <DowntimeByMachine data={data!.byMachine} />}
                </div>
              </div>
              <div className="industrial-card p-4 col-span-12 lg:col-span-6">
                <div className="text-xs font-semibold text-muted-foreground mb-2">{t('cockpit.byCategory')}</div>
                <div className="h-60">
                  {(data?.byCategory.length ?? 0) === 0
                    ? <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{t('cockpit.noData')}</div>
                    : <CategoryPareto data={data!.byCategory} />}
                </div>
              </div>
            </div>
          </motion.section>

          {/* Live open + recent log */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Clock} color="#22c55e">{t('cockpit.sections.events')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              {/* Live open stops */}
              <div className="industrial-card p-4 col-span-12 lg:col-span-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold text-muted-foreground">{t('cockpit.liveOpen')} · {data?.liveOpen.length ?? 0}</span>
                  <DataModeBadge mode="live" />
                </div>
                {(data?.liveOpen.length ?? 0) === 0 ? (
                  <div className="flex h-28 items-center justify-center text-xs text-muted-foreground">{t('cockpit.allRunning')}</div>
                ) : (
                  <div className="space-y-2">
                    {data!.liveOpen.map((e, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-2.5 py-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-semibold truncate">{e.machine}</div>
                          <div className="text-[10px] text-muted-foreground truncate">{e.reason}</div>
                        </div>
                        <span className="text-[11px] font-bold tabular-nums text-rose-400">{fmtMin(e.elapsedMin)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Recent log */}
              <div className="industrial-card p-4 col-span-12 lg:col-span-8">
                <div className="text-xs font-semibold text-muted-foreground mb-3">{t('cockpit.recent')}</div>
                {(data?.recent.length ?? 0) === 0 ? (
                  <div className="flex h-28 items-center justify-center text-xs text-muted-foreground">{t('cockpit.noData')}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border/50">
                          <th className="text-start font-medium py-1.5 px-2">{t('cockpit.col.machine')}</th>
                          <th className="text-start font-medium py-1.5 px-2">{t('cockpit.col.reason')}</th>
                          <th className="text-start font-medium py-1.5 px-2">{t('cockpit.col.category')}</th>
                          <th className="text-end font-medium py-1.5 px-2">{t('cockpit.col.duration')}</th>
                          <th className="text-center font-medium py-1.5 px-2">{t('cockpit.col.oee')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data!.recent.map((e, i) => (
                          <tr key={i} className="border-b border-border/30">
                            <td className="py-1.5 px-2 font-medium">{e.machine}</td>
                            <td className="py-1.5 px-2 text-muted-foreground truncate max-w-[220px]" title={e.reason}>{e.reason}</td>
                            <td className="py-1.5 px-2">
                              <span className={cn('text-[10px] px-1.5 py-0.5 rounded', e.planned ? 'bg-primary/15 text-primary' : 'bg-rose-500/15 text-rose-400')}>{e.category}</span>
                            </td>
                            <td className="py-1.5 px-2 text-end tabular-nums">{fmtMin(e.durationMin)}</td>
                            <td className="py-1.5 px-2 text-center">
                              {e.oeeImpact
                                ? <span className="text-[10px] text-rose-400 font-semibold">{t('cockpit.impact')}</span>
                                : <span className="text-[10px] text-muted-foreground">—</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
