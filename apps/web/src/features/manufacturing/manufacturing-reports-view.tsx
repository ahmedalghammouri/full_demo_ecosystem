'use client';

import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import {
  BarChart3,
  Factory,
  Gauge,
  AlertTriangle,
  Layers,
  Clock,
  ChevronRight,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api.client';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn, formatPercent } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

interface DashboardKPIs {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  // Time-based (OEE-TB) variant emitted by the backend alongside schedule-based OEE.
  oeeTb?: number;
  availabilityTb?: number;
  totalOutput: number;
  activeAlarms: number;
  oeeTrend?: number;
  availabilityTrend?: number;
  outputTrend?: number;
  alarmTrend?: number;
}

// ── Report card config ───────────────────────────────────────────────────────

const REPORT_CARDS = [
  {
    key: 'production',
    href: '/reports/production',
    icon: Factory,
    iconColor: 'text-brand-400',
    iconBg: 'bg-brand-500/15',
  },
  {
    key: 'oeeAnalysis',
    href: '/manufacturing/oee',
    icon: Gauge,
    iconColor: 'text-green-400',
    iconBg: 'bg-green-500/15',
  },
  {
    key: 'downtime',
    href: '/production/downtime',
    icon: AlertTriangle,
    iconColor: 'text-amber-400',
    iconBg: 'bg-amber-500/15',
  },
  {
    key: 'scrap',
    href: '/production/scrap-log',
    icon: Trash2,
    iconColor: 'text-red-400',
    iconBg: 'bg-red-500/15',
  },
  {
    key: 'jobOrders',
    href: '/production/job-orders',
    icon: Layers,
    iconColor: 'text-purple-400',
    iconBg: 'bg-purple-500/15',
  },
  {
    key: 'shift',
    href: '/manufacturing/kpi',
    icon: Clock,
    iconColor: 'text-cyan-400',
    iconBg: 'bg-cyan-500/15',
  },
] as const;

// ── Component ────────────────────────────────────────────────────────────────

export default function ManufacturingReportsView() {
  const { t } = useTranslation('modules');
  const { params: timeParams, key: timeKey } = useTimeRange();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'kpis'],
    queryFn: () => api.get<DashboardKPIs>('/dashboard/kpis', {
      // The reader's period. /dashboard/kpis is window-scoped, so calling it
      // without one asked for whatever the endpoint defaults to while the filter
      // panel sat above the page claiming otherwise.
      params: { ...timeParams },
    }),
    staleTime: 60_000,
  });

  const kpis = data as unknown as DashboardKPIs | undefined;

  const pills = [
    {
      label: t('mfgReports.pills.oee'),
      value: isLoading ? '—' : formatPercent(kpis?.oee ?? null),
      color: 'text-brand-400',
      bg: 'bg-brand-500/15 border-brand-500/30',
    },
    {
      label: t('mfgReports.pills.oeeTb'),
      value: isLoading ? '—' : formatPercent(kpis?.oeeTb ?? null),
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/15 border-cyan-500/30',
    },
    {
      label: t('mfgReports.pills.availability'),
      value: isLoading ? '—' : formatPercent(kpis?.availability ?? null),
      color: 'text-green-400',
      bg: 'bg-green-500/15 border-green-500/30',
    },
    {
      label: t('mfgReports.pills.availabilityTb'),
      value: isLoading ? '—' : formatPercent(kpis?.availabilityTb ?? null),
      color: 'text-green-300',
      bg: 'bg-green-500/10 border-green-500/20',
    },
    {
      label: t('mfgReports.pills.unitsToday'),
      value: isLoading ? '—' : (kpis?.totalOutput ?? 0).toLocaleString(),
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/15 border-cyan-500/30',
    },
    {
      label: t('mfgReports.pills.activeAlarms'),
      value: isLoading ? '—' : (kpis?.activeAlarms ?? 0).toString(),
      color: (kpis?.activeAlarms ?? 0) > 0 ? 'text-red-400' : 'text-muted-foreground',
      bg:
        (kpis?.activeAlarms ?? 0) > 0
          ? 'bg-red-500/15 border-red-500/30'
          : 'bg-muted/30 border-border',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center gap-3"
      >
        <div className="w-10 h-10 rounded-xl bg-brand-500/15 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t('mfgReports.title')}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t('mfgReports.subtitle')}
          </p>
        </div>
      </motion.div>

      {/* KPI pills row */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="flex flex-wrap gap-2"
      >
        {pills.map((pill) => (
          <div
            key={pill.label}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm font-medium',
              pill.bg,
            )}
          >
            <TrendingUp className={cn('w-3.5 h-3.5', pill.color)} />
            <span className="text-muted-foreground text-xs">{pill.label}</span>
            {isLoading ? (
              <div className="shimmer h-3.5 w-10 rounded-full" />
            ) : (
              <span className={cn('font-semibold tabular-nums', pill.color)}>{pill.value}</span>
            )}
          </div>
        ))}
      </motion.div>

      {/* Report cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {REPORT_CARDS.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.href}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + i * 0.06 }}
              className="glass-card rounded-xl p-5 flex flex-col gap-4 group hover:ring-1 hover:ring-white/10 transition-all"
            >
              {/* Card header */}
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0',
                    card.iconBg,
                  )}
                >
                  <Icon className={cn('w-5 h-5', card.iconColor)} />
                </div>
                <div className="flex-1 min-w-0">
                  <h2 className="font-semibold text-sm leading-snug">{t(`mfgReports.cards.${card.key}.title`)}</h2>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {t(`mfgReports.cards.${card.key}.description`)}
                  </p>
                </div>
              </div>

              {/* View Report button */}
              <div className="mt-auto">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-between text-xs group-hover:border-foreground/20 transition-colors"
                  asChild
                >
                  <Link href={card.href}>
                    <span>{t('mfgReports.viewReport')}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
                  </Link>
                </Button>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
