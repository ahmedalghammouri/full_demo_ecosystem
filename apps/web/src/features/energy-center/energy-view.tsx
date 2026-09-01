'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Zap, Power, BatteryWarning, Activity, Flame, Gauge, TrendingDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';
import { KPICard } from '@/components/widgets/kpi-card';
import { PowerGauge, UtilityBreakdown, SectionTitle } from '@/features/command-center/command-center-charts';

import { useEnergyCockpit } from './use-energy-cockpit';
import { ConsumptionTrend, WasteSplit, UTILITY_COLOR } from './energy-charts';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.06 } } };
const itemVariants = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

export function EnergyCenterView() {
  /**
   * Declared, because the shell reads it.
   *
   * `useDeclareViewMode` is what shows the period control -- and a page that
   * skips it inherits whatever the LAST page set. That is why these analytics
   * screens showed a partial filter bar: not a missing feature, an undeclared
   * one, and the bar they got depended on where the reader had just been.
   */
  useDeclareViewMode('analytics');

  const { t } = useTranslation(['dashboard', 'common']);
  const { data, isLoading } = useEnergyCockpit();
  const { trendType } = useDashboardPrefsStore();

  const ov = data?.overview;
  const live = data?.live;
  const waste = data?.waste;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Zap size={18} className="text-yellow-500" />
            {t('energyCenter.title')}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('energyCenter.subtitle')}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
          {/* KPI strip */}
          <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KPICard title={t('energyCenter.kpi.power')} value={live?.totalPowerKw ?? 0} unit="kW" isLoading={isLoading} icon={<Power size={16} />} />
            <KPICard title={t('energyCenter.kpi.standby')} value={live?.standbyPowerKw ?? 0} unit="kW" colorMode="alarm" isLoading={isLoading} icon={<BatteryWarning size={16} />} />
            <KPICard title={t('energyCenter.kpi.consumptionMtd')} value={ov?.totalConsumptionMtd ?? 0} unit="kWh" isLoading={isLoading} icon={<Activity size={16} />} />
            <KPICard title={t('energyCenter.kpi.costMtd')} value={ov?.totalCostMtd ?? 0} unit="SAR" isLoading={isLoading} icon={<Flame size={16} />} />
            <KPICard title={t('energyCenter.kpi.today')} value={ov?.totalConsumptionToday ?? 0} unit="kWh" isLoading={isLoading} icon={<Zap size={16} />} />
            <KPICard title={t('energyCenter.kpi.perUnit')} value={waste?.avgKwhPerUnit ?? 0} unit="kWh" isLoading={isLoading} icon={<Gauge size={16} />} />
          </motion.div>

          {/* Live power + meters */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Power} color="#eab308">{t('energyCenter.sections.live')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="industrial-card p-4 col-span-12 sm:col-span-6 lg:col-span-3 flex flex-col">
                <div className="text-xs font-semibold text-muted-foreground">{t('commandCenter.energy.livePower')}</div>
                <div className="flex-1 min-h-[160px]"><PowerGauge value={live?.totalPowerKw ?? null} isLoading={isLoading} /></div>
                <div className="text-center text-[11px] text-muted-foreground -mt-2">
                  {ov?.meterCount ?? 0} {t('commandCenter.energy.meters')}
                </div>
              </div>
              <div className="industrial-card p-4 col-span-12 sm:col-span-6 lg:col-span-4">
                <div className="text-xs font-semibold text-muted-foreground mb-3">{t('commandCenter.energy.byType')}</div>
                <UtilityBreakdown byType={ov?.byType ?? {}} />
              </div>
              {/* Top live consumers */}
              <div className="industrial-card p-4 col-span-12 lg:col-span-5">
                <div className="text-xs font-semibold text-muted-foreground mb-3">{t('energyCenter.sections.consumers')}</div>
                {(data?.topConsumers?.length ?? 0) === 0 ? (
                  <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">{t('energyCenter.consumers.noData')}</div>
                ) : (
                  <div className="space-y-2">
                    {data!.topConsumers.map((m) => {
                      const color = UTILITY_COLOR[m.type] ?? '#64748b';
                      const peak = Math.max(...data!.topConsumers.map((x) => x.powerKw ?? 0), 1);
                      return (
                        <div key={m.meterId} className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className="text-[11px] truncate flex-1" title={m.name}>{m.name}</span>
                          {m.standby && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-amber-500/15 text-amber-500 shrink-0">{t('energyCenter.consumers.standbyTag')}</span>
                          )}
                          <div className="w-20 h-1.5 bg-muted/50 rounded-full overflow-hidden shrink-0">
                            <div className="h-full rounded-full" style={{ width: `${((m.powerKw ?? 0) / peak) * 100}%`, backgroundColor: color }} />
                          </div>
                          <span className="text-[11px] font-semibold tabular-nums w-14 text-end shrink-0">{(m.powerKw ?? 0).toFixed(1)} kW</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.section>

          {/* Consumption trend */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Activity} color="#0ea5e9">{t('energyCenter.sections.consumption')}</SectionTitle>
            <div className="industrial-card p-4">
              <ConsumptionTrend chart={(data?.consumption?.chart ?? []) as Array<Record<string, string | number>>} type={trendType} />
            </div>
          </motion.section>

          {/* Waste & efficiency */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={TrendingDown} color="#f43f5e">{t('energyCenter.sections.waste')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="industrial-card p-4 col-span-12 md:col-span-6">
                <div className="text-xs font-semibold text-muted-foreground mb-2">{t('energyCenter.waste.title')}</div>
                <WasteSplit waste={waste ?? { runningKwh: 0, idleKwh: 0, downtimeKwh: 0 }} />
              </div>
              <div className="col-span-12 md:col-span-6 grid grid-cols-2 gap-4 content-start">
                <KPICard title={t('energyCenter.waste.idle')} value={waste?.idleKwh ?? 0} unit="kWh" colorMode="alarm" isLoading={isLoading} icon={<BatteryWarning size={16} />} />
                <KPICard title={t('energyCenter.waste.downtime')} value={waste?.downtimeKwh ?? 0} unit="kWh" colorMode="alarm" isLoading={isLoading} icon={<TrendingDown size={16} />} />
                <KPICard title={t('energyCenter.waste.running')} value={waste?.runningKwh ?? 0} unit="kWh" isLoading={isLoading} icon={<Activity size={16} />} />
                <KPICard title={t('energyCenter.waste.anomalies')} value={waste?.anomalyCount ?? 0} colorMode="alarm" isLoading={isLoading} icon={<BatteryWarning size={16} />} />
              </div>
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
