'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';

import React from 'react';
import { motion } from 'framer-motion';
import {
  LayoutGrid, Activity, AlertTriangle, CheckCircle2, Zap, TrendingUp,
  Gauge, Flame, Factory, BatteryWarning, Power,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';
import { KPICard } from '@/components/widgets/kpi-card';
import { OEEGauge } from '@/components/charts/oee-gauge';
import { ProductionTrendChart } from '@/components/charts/production-trend';
import { MachineStatusGrid } from '@/components/widgets/machine-status-grid';
import { AlarmList } from '@/components/widgets/alarm-list';
import { ProductionStatusBar } from '@/components/widgets/production-status-bar';
import { ShiftSummaryCard } from '@/components/widgets/shift-summary-card';
import { DowntimePareto } from '@/components/charts/downtime-pareto';
import { QualityTrendChart } from '@/components/charts/quality-trend';
import { cn } from '@/lib/utils';

import { useCommandCenter } from './use-command-center';
import {
  PowerGauge, UtilityBreakdown, EnergyTrend, ExecutiveComparison, SectionTitle,
} from './command-center-charts';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.06 } },
};
const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export function CommandCenterView() {
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
  const { data, isLoading } = useCommandCenter();
  const { trendType, atOee } = useDashboardPrefsStore();

  const kpis = data?.ops?.kpis;
  const energy = data?.energy;
  const live = energy?.live;
  const executive = data?.executive;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <Gauge size={18} className="text-primary" />
            {t('commandCenter.title')}
            <DashboardInfo id="command-center" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('commandCenter.subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" asChild>
          <Link href="/dashboard-center">
            <LayoutGrid size={13} />
            {t('dashboardCenter')}
          </Link>
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
          {/* Production status bar */}
          <motion.div variants={itemVariants}>
            <ProductionStatusBar data={data?.ops?.productionStatus} isLoading={isLoading} />
          </motion.div>

          {/* KPI strip */}
          <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
            <KPICard title={atOee ? t('kpi.atOee') : t('kpi.oee')} value={(atOee ? kpis?.oeeTb : kpis?.oee) ?? 0} unit="%" trend={atOee ? kpis?.oeeTbTrend : kpis?.oeeTrend} target={85} colorMode="oee" isLoading={isLoading} icon={<Zap size={16} />} />
            <KPICard title={atOee ? t('kpi.atAvailability') : t('kpi.availability')} value={(atOee ? kpis?.availabilityTb : kpis?.availability) ?? 0} unit="%" trend={atOee ? kpis?.availabilityTbTrend : kpis?.availabilityTrend} target={90} colorMode="oee" isLoading={isLoading} icon={<Activity size={16} />} />
            <KPICard title={t('kpi.performance')} value={kpis?.performance ?? 0} unit="%" trend={kpis?.performanceTrend} target={95} colorMode="oee" isLoading={isLoading} icon={<TrendingUp size={16} />} />
            <KPICard title={t('kpi.quality')} value={kpis?.quality ?? 0} unit="%" trend={kpis?.qualityTrend} target={99} colorMode="oee" isLoading={isLoading} icon={<CheckCircle2 size={16} />} />
            <KPICard title={t('kpi.output')} value={kpis?.totalOutput ?? 0} unit={t('units')} trend={kpis?.outputTrend} isLoading={isLoading} icon={<Activity size={16} />} />
            <KPICard title={t('kpi.alarms')} value={kpis?.activeAlarms ?? 0} trend={kpis?.alarmTrend} colorMode="alarm" isLoading={isLoading} icon={<AlertTriangle size={16} />} />
          </motion.div>

          {/* ── Performance & OEE ── */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Gauge} color="#4c7571">{t('commandCenter.sections.performance')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 lg:col-span-4">
                <OEEGauge oee={(atOee ? kpis?.oeeTb : kpis?.oee) ?? 0} availability={(atOee ? kpis?.availabilityTb : kpis?.availability) ?? 0} performance={kpis?.performance ?? 0} quality={kpis?.quality ?? 0} isLoading={isLoading} />
              </div>
              <div className="col-span-12 lg:col-span-8">
                <ProductionTrendChart data={data?.ops?.productionTrend} isLoading={isLoading} trendType={trendType} />
              </div>
            </div>
          </motion.section>

          {/* ── Energy & Utilities ── */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Zap} color="#eab308">{t('commandCenter.sections.energy')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              {/* Live power gauge */}
              <div className="industrial-card p-4 col-span-12 sm:col-span-6 lg:col-span-3 flex flex-col">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <Power size={13} className="text-yellow-500" />{t('commandCenter.energy.livePower')}
                </div>
                <div className="flex-1 min-h-[160px]"><PowerGauge value={live?.totalPowerKw ?? null} isLoading={isLoading} /></div>
                <div className="text-center text-[11px] text-muted-foreground -mt-2">
                  {energy?.meterCount ?? 0} {t('commandCenter.energy.meters')}
                </div>
              </div>

              {/* Standby + consumption + cost cards */}
              <div className="col-span-12 sm:col-span-6 lg:col-span-3 grid grid-rows-2 gap-4">
                <div className={cn('industrial-card p-4 flex flex-col justify-center', (live?.standbyCount ?? 0) > 0 && 'ring-1 ring-amber-500/40')}>
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground mb-1">
                    <BatteryWarning size={13} className="text-amber-500" />{t('commandCenter.energy.standby')}
                  </div>
                  <div className="text-2xl font-bold tabular-nums text-foreground">
                    {(live?.standbyPowerKw ?? 0).toFixed(1)} <span className="text-sm text-muted-foreground">kW</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    {t('commandCenter.energy.standbyMeters', { n: live?.standbyCount ?? 0 })}
                  </div>
                </div>
                <KPICard title={t('commandCenter.energy.today')} value={energy?.totalConsumptionToday ?? 0} unit="kWh" isLoading={isLoading} icon={<Zap size={16} />} />
              </div>

              {/* MTD consumption + cost */}
              <div className="col-span-12 sm:col-span-6 lg:col-span-3 grid grid-rows-2 gap-4">
                <KPICard title={t('commandCenter.energy.consumptionMtd')} value={energy?.totalConsumptionMtd ?? 0} unit="kWh" isLoading={isLoading} icon={<Activity size={16} />} />
                <KPICard title={t('commandCenter.energy.costMtd')} value={energy?.totalCostMtd ?? 0} unit="SAR" isLoading={isLoading} icon={<Flame size={16} />} />
              </div>

              {/* Utility breakdown */}
              <div className="industrial-card p-4 col-span-12 sm:col-span-6 lg:col-span-3">
                <div className="text-xs font-semibold text-muted-foreground mb-3">{t('commandCenter.energy.byType')}</div>
                <UtilityBreakdown byType={energy?.byType ?? {}} />
              </div>

              {/* 7-day electricity trend (render type from toolbar) */}
              <div className="industrial-card p-4 col-span-12">
                <div className="text-xs font-semibold text-muted-foreground mb-2">{t('commandCenter.energy.trend')}</div>
                <div className="h-40"><EnergyTrend data={energy?.trend ?? []} type={trendType} /></div>
              </div>
            </div>
          </motion.section>

          {/* ── Losses & Downtime ── */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={AlertTriangle} color="#f43f5e">{t('commandCenter.sections.losses')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 lg:col-span-6"><DowntimePareto data={data?.ops?.downtimePareto} isLoading={isLoading} /></div>
              <div className="col-span-12 lg:col-span-6"><QualityTrendChart data={data?.ops?.qualityTrend} isLoading={isLoading} trendType={trendType} /></div>
            </div>
          </motion.section>

          {/* ── Executive Overview ── */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Factory} color="#06b6d4">{t('commandCenter.sections.executive')}</SectionTitle>
            <div className="industrial-card p-4">
              <div className="text-xs font-semibold text-muted-foreground mb-2">
                {executive?.dimension === 'factory'
                  ? t('commandCenter.executive.byFactory')
                  : t('commandCenter.executive.byArea')}
              </div>
              <div className="h-72">
                <ExecutiveComparison rows={executive?.rows ?? []} locale={i18n.language} />
              </div>
            </div>
          </motion.section>

          {/* ── Live Shop Floor ── */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Activity} color="#22c55e">{t('commandCenter.sections.floor')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 lg:col-span-7"><MachineStatusGrid machines={data?.ops?.machines} isLoading={isLoading} /></div>
              <div className="col-span-12 lg:col-span-5 space-y-4">
                <ShiftSummaryCard data={data?.ops?.shiftSummary} isLoading={isLoading} />
                <AlarmList alarms={data?.ops?.alarms} isLoading={isLoading} />
              </div>
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
