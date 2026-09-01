'use client';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';
import {
  Wrench,
  ClipboardList,
  Calendar,
  Cpu,
  FileText,
  Clock,
  Activity,
  Gauge,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

// ── Types ───────────────────────────────────────────────────────

interface MaintenanceKPIs {
  openWOs: number;
  overdueWOs: number;
  completionRate: number;
  mttr: number;
  mtbf: number;
  availabilityRate: number;
  pmCompliance: number;
}

// ── Report card config ──────────────────────────────────────────

const REPORT_CARDS = [
  {
    titleKey: 'reportsView.cards.overviewTitle',
    href: '/maintenance',
    icon: Wrench,
    descKey: 'reportsView.cards.overviewDesc',
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
  },
  {
    titleKey: 'reportsView.cards.historyTitle',
    href: '/maintenance/work-orders',
    icon: ClipboardList,
    descKey: 'reportsView.cards.historyDesc',
    color: 'text-blue-400',
    bg: 'bg-blue-500/15',
  },
  {
    titleKey: 'reportsView.cards.pmTitle',
    href: '/maintenance/preventive',
    icon: Calendar,
    descKey: 'reportsView.cards.pmDesc',
    color: 'text-green-400',
    bg: 'bg-green-500/15',
  },
  {
    titleKey: 'reportsView.cards.assetTitle',
    href: '/maintenance/assets',
    icon: Cpu,
    descKey: 'reportsView.cards.assetDesc',
    color: 'text-purple-400',
    bg: 'bg-purple-500/15',
  },
  {
    titleKey: 'reportsView.cards.reportTitle',
    href: '/reports/maintenance',
    icon: FileText,
    descKey: 'reportsView.cards.reportDesc',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/15',
  },
] as const;

// ── Component ───────────────────────────────────────────────────

export default function MaintenanceReportsView() {
  const { t } = useTranslation(['maintenance', 'common']);
  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', 'kpis'],
    queryFn: () =>
      api.get<MaintenanceKPIs>('/maintenance/kpis'),
    staleTime: 60_000,
  });

  const kpis: MaintenanceKPIs = (data as any) ?? {
    openWOs: 0,
    overdueWOs: 0,
    completionRate: 0,
    mttr: 0,
    mtbf: 0,
    availabilityRate: 0,
    pmCompliance: 0,
  };

  const kpiCards = [
    {
      label: t('reportsView.kpiMttr'),
      unit: t('reportsView.hours'),
      value: Number(kpis.mttr ?? 0).toFixed(1),
      icon: Clock,
      color: 'text-amber-400',
      bg: 'bg-amber-500/20',
    },
    {
      label: t('reportsView.kpiMtbf'),
      unit: t('reportsView.hours'),
      value: Number(kpis.mtbf ?? 0).toFixed(1),
      icon: Activity,
      color: 'text-green-400',
      bg: 'bg-green-500/20',
    },
    {
      label: t('reportsView.kpiPmCompliance'),
      unit: '%',
      value: Number(kpis.pmCompliance ?? 0).toFixed(1),
      icon: Calendar,
      color: 'text-blue-400',
      bg: 'bg-blue-500/20',
    },
    {
      label: t('reportsView.kpiAvailability'),
      unit: '%',
      value: Number(kpis.availabilityRate ?? 0).toFixed(1),
      icon: Gauge,
      color: 'text-purple-400',
      bg: 'bg-purple-500/20',
    },
  ];

  const completionRate = Math.min(Math.max(Number(kpis.completionRate ?? 0), 0), 100);
  const progressColor =
    completionRate >= 90
      ? 'bg-green-500'
      : completionRate >= 70
        ? 'bg-amber-500'
        : 'bg-red-500';

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
          <Wrench className="w-5 h-5 text-amber-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t('headers.reports.title')}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t('headers.reports.subtitle')}
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpiCards.map((kpi, i) => {
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
                  <div
                    className={cn(
                      'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                      kpi.bg,
                    )}
                  >
                    <Icon className={cn('w-5 h-5', kpi.color)} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs text-muted-foreground truncate">
                      {kpi.label}
                    </div>
                    <div className="text-xl font-bold mt-0.5 tabular-nums">
                      {kpi.value}
                      <span className="text-sm font-medium text-muted-foreground ml-1">
                        {kpi.unit}
                      </span>
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Overdue Alert */}
      {!isLoading && kpis.overdueWOs > 0 && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between gap-4 rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <span className="text-sm font-medium text-red-300">
              {t('reportsView.overdueCount', { count: kpis.overdueWOs })}
            </span>
          </div>
          <Link href="/maintenance/scheduling">
            <Button
              variant="outline"
              size="sm"
              className="border-red-500/40 text-red-400 hover:bg-red-500/20 hover:text-red-300 shrink-0"
            >
              {t('reportsView.viewSchedule')}
              <ChevronRight className="w-3.5 h-3.5 ml-1" />
            </Button>
          </Link>
        </motion.div>
      )}

      {/* Report Cards Grid */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          {t('reportsView.availableReports')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {REPORT_CARDS.map((card, i) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.href}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2 + i * 0.05 }}
              >
                <Link href={card.href} className="block group">
                  <div className="glass-card rounded-xl p-5 flex items-start gap-4 hover:border-border/80 transition-colors cursor-pointer">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center shrink-0 mt-0.5',
                        card.bg,
                      )}
                    >
                      <Icon className={cn('w-5 h-5', card.color)} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm">{t(card.titleKey)}</span>
                        <ChevronRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                        {t(card.descKey)}
                      </p>
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Completion Rate Progress */}
      <div className="glass-card rounded-xl p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm">Work Order Completion</h2>
          <Badge variant="outline" className="text-xs">This Month</Badge>
        </div>
        {isLoading ? (
          <div className="shimmer h-4 w-full rounded-full" />
        ) : (
          <>
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>This Month: {completionRate.toFixed(1)}%</span>
              <span className="text-xs">
                {kpis.openWOs} open WO{kpis.openWOs !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="h-2.5 bg-muted rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${completionRate}%` }}
                transition={{ duration: 0.9, ease: 'easeOut' }}
                className={cn('h-full rounded-full', progressColor)}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>0%</span>
              <span>Target: 100%</span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
