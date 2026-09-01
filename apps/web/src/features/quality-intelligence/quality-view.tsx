'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';

import React from 'react';
import { motion } from 'framer-motion';
import {
  ShieldCheck, CheckCircle2, AlertTriangle, Repeat, Trash2, Activity, Gauge,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';
import { KPICard } from '@/components/widgets/kpi-card';
import { SectionTitle } from '@/features/command-center/command-center-charts';

import { useQualityCockpit } from './use-quality-cockpit';
import { FpyTrend, DefectPareto, CategoryBars, SEVERITY_COLOR, RESULT_COLOR, CAPA_COLOR, NCR_STATUS_COLOR } from './quality-charts';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

const containerVariants = { hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.04, delayChildren: 0.06 } } };
const itemVariants = { hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0, transition: { duration: 0.3 } } };

export function QualityIntelligenceView() {
  /**
   * Declared, because the shell reads it -- see
   * analytics-pages-declare-their-mode.spec.ts. A page that skips this does not
   * get a default; it inherits whatever the LAST page set, so its filter bar
   * changes depending on where the reader arrived from.
   */
  useDeclareViewMode('analytics');
  const { t } = useTranslation(['quality', 'common']);
  const { data, isLoading } = useQualityCockpit();
  const { trendType } = useDashboardPrefsStore();

  const k = data?.kpis;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold text-foreground flex items-center gap-2">
            <ShieldCheck size={18} className="text-purple-500" />
            {t('cockpit.title')}
            <DashboardInfo id="quality-intelligence" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('cockpit.subtitle')}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div variants={containerVariants} initial="hidden" animate="visible" className="space-y-6">
          {/* KPI strip */}
          <motion.div variants={itemVariants} className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <KPICard title={t('cockpit.kpi.fpy')} value={k?.fpy ?? 0} unit="%" target={95} colorMode="oee" isLoading={isLoading} icon={<CheckCircle2 size={16} />} />
            <KPICard title={t('cockpit.kpi.scrapRate')} value={k?.scrapRate ?? 0} unit="%" colorMode="alarm" isLoading={isLoading} icon={<Trash2 size={16} />} />
            <KPICard title={t('cockpit.kpi.reworkRate')} value={k?.reworkRate ?? 0} unit="%" colorMode="alarm" isLoading={isLoading} icon={<Repeat size={16} />} />
            <KPICard title={t('cockpit.kpi.openNCRs')} value={k?.openNCRs ?? 0} colorMode="alarm" isLoading={isLoading} icon={<AlertTriangle size={16} />} />
            <KPICard title={t('cockpit.kpi.openCAPAs')} value={k?.openCAPAs ?? 0} isLoading={isLoading} icon={<ShieldCheck size={16} />} />
            <KPICard title={t('cockpit.kpi.cpk')} value={k?.cpk ?? 0} isLoading={isLoading} icon={<Gauge size={16} />} subtitle={k?.cpk == null ? '—' : undefined} />
          </motion.div>

          {/* FPY trend + Defect Pareto */}
          <motion.section variants={itemVariants}>
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 lg:col-span-6">
                <SectionTitle icon={CheckCircle2} color="#22c55e">{t('cockpit.sections.trend')}</SectionTitle>
                <div className="industrial-card p-4"><FpyTrend data={data?.fpyTrend ?? []} type={trendType} /></div>
              </div>
              <div className="col-span-12 lg:col-span-6">
                <SectionTitle icon={AlertTriangle} color="#a855f7">{t('cockpit.sections.pareto')}</SectionTitle>
                <div className="industrial-card p-4"><DefectPareto data={data?.defectPareto ?? []} /></div>
              </div>
            </div>
          </motion.section>

          {/* NCR mix + CAPA + Inspections */}
          <motion.section variants={itemVariants}>
            <SectionTitle icon={Activity} color="#4c7571">{t('cockpit.sections.ncr')}</SectionTitle>
            <div className="grid grid-cols-12 gap-4">
              <div className="industrial-card p-4 col-span-12 md:col-span-6 lg:col-span-3">
                <div className="text-xs font-semibold text-muted-foreground mb-3">{t('cockpit.bySeverity')}</div>
                <CategoryBars rows={(data?.ncrBySeverity ?? []).map((r) => ({ key: r.severity, count: r.count }))} palette={SEVERITY_COLOR} labelNs="cockpit.severity" />
              </div>
              <div className="industrial-card p-4 col-span-12 md:col-span-6 lg:col-span-3">
                <div className="text-xs font-semibold text-muted-foreground mb-3">{t('cockpit.byStatus')}</div>
                <CategoryBars rows={(data?.ncrByStatus ?? []).map((r) => ({ key: r.status, count: r.count }))} palette={NCR_STATUS_COLOR} labelNs="cockpit.ncrStatus" />
              </div>
              <div className="industrial-card p-4 col-span-12 md:col-span-6 lg:col-span-3">
                <div className="text-xs font-semibold text-muted-foreground mb-3">{t('cockpit.sections.capa')}</div>
                <CategoryBars rows={(data?.capaByStatus ?? []).map((r) => ({ key: r.status, count: r.count }))} palette={CAPA_COLOR} labelNs="cockpit.capaStatus" />
              </div>
              <div className="industrial-card p-4 col-span-12 md:col-span-6 lg:col-span-3">
                <div className="text-xs font-semibold text-muted-foreground mb-3">{t('cockpit.sections.inspections')}</div>
                <CategoryBars rows={(data?.inspectionByResult ?? []).map((r) => ({ key: r.result, count: r.count }))} palette={RESULT_COLOR} labelNs="cockpit.result" />
              </div>
            </div>
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}
