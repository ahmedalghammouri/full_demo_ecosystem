'use client';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';
import {
  Factory,
  ClipboardList,
  Gauge,
  AlertTriangle,
  Trash2,
  FileText,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { api } from '@/services/api.client';

// ── Types ──────────────────────────────────────────────────────────────────────

interface DashboardKPIs {
  oee: number | null;
  totalOutput: number | null;
  activeAlarms: number | null;
  [key: string]: unknown;
}

// ── Report card definitions ────────────────────────────────────────────────────

const REPORT_CARDS = [
  {
    title: 'Production Overview',
    description: 'Live production status, machine states, and shift summaries.',
    href: '/production',
    icon: Factory,
    color: 'text-brand-400',
    bg: 'bg-brand-500/15',
    border: 'border-brand-500/20',
  },
  {
    title: 'Work Orders',
    description: 'Manage and track work orders across all production lines.',
    href: '/production/orders',
    icon: ClipboardList,
    color: 'text-green-400',
    bg: 'bg-green-500/15',
    border: 'border-green-500/20',
  },
  {
    title: 'OEE Analytics',
    description: 'Overall Equipment Effectiveness trends and breakdowns.',
    href: '/production/oee',
    icon: Gauge,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/15',
    border: 'border-cyan-500/20',
  },
  {
    title: 'Downtime Analysis',
    description: 'Root-cause analysis and frequency of machine downtime events.',
    href: '/production/downtime',
    icon: AlertTriangle,
    color: 'text-amber-400',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/20',
  },
  {
    title: 'Scrap Audit',
    description: 'Review scrap entries, waste rates, and quality rejection logs.',
    href: '/production/scrap-log',
    icon: Trash2,
    color: 'text-red-400',
    bg: 'bg-red-500/15',
    border: 'border-red-500/20',
  },
  {
    title: 'Production Report',
    description: 'Detailed production reports with export and date-range filtering.',
    href: '/reports/production',
    icon: FileText,
    color: 'text-purple-400',
    bg: 'bg-purple-500/15',
    border: 'border-purple-500/20',
  },
] as const;

// ── Component ──────────────────────────────────────────────────────────────────

export default function ProductionReportsView() {
  const { t } = useTranslation(['production', 'common']);
  const { filter, key } = useScope();
  const { params: timeParams, key: timeKey } = useTimeRange();
  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'kpis', key, timeKey],
    queryFn: () => api.get<DashboardKPIs>('/dashboard/kpis', {
      // The reader's period. /dashboard/kpis is window-scoped, so calling it
      // without one asked for whatever the endpoint defaults to while the filter
      // panel sat above the page claiming otherwise.
      params: { ...filter, ...timeParams },
    }),
    staleTime: 30_000,
  });

  const kpis = data as DashboardKPIs | undefined;

  const safeNum = (v: number | null | undefined) => Number(v ?? 0);

  const pills = [
    {
      label: 'OEE',
      value: `${safeNum(kpis?.oee).toFixed(1)}%`,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/15 border border-cyan-500/25',
    },
    {
      label: 'OEE (Time-Based)',
      value: `${safeNum(kpis?.oeeTb as number | undefined).toFixed(1)}%`,
      color: 'text-cyan-300',
      bg: 'bg-cyan-500/10 border border-cyan-500/20',
    },
    {
      label: 'Units Today',
      value: safeNum(kpis?.totalOutput).toLocaleString(),
      color: 'text-green-400',
      bg: 'bg-green-500/15 border border-green-500/25',
    },
    {
      label: 'Active Alarms',
      value: safeNum(kpis?.activeAlarms).toLocaleString(),
      color: safeNum(kpis?.activeAlarms) > 0 ? 'text-red-400' : 'text-muted-foreground',
      bg: safeNum(kpis?.activeAlarms) > 0
        ? 'bg-red-500/15 border border-red-500/25'
        : 'bg-muted/30 border border-border',
    },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-500/20 flex items-center justify-center">
          <Factory className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t('headers.reports.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('headers.reports.subtitle')}
          </p>
        </div>
      </div>

      {/* ── KPI Pills ── */}
      <div className="flex flex-wrap gap-3">
        {pills.map((pill, i) => (
          <motion.div
            key={pill.label}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={cn(
              'flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium',
              pill.bg,
            )}
          >
            {isLoading ? (
              <span className="shimmer h-4 w-20 rounded-full" />
            ) : (
              <>
                <span className="text-muted-foreground text-xs">{pill.label}</span>
                <span className={cn('font-bold tabular-nums', pill.color)}>
                  {pill.value}
                </span>
              </>
            )}
          </motion.div>
        ))}
      </div>

      {/* ── Report Cards Grid ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {REPORT_CARDS.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.href}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.06 }}
            >
              <Link href={card.href} className="group block h-full">
                <div
                  className={cn(
                    'glass-card rounded-xl p-5 h-full flex flex-col gap-4',
                    'border transition-all duration-200',
                    'hover:border-foreground/10 hover:bg-foreground/[0.03]',
                    card.border,
                  )}
                >
                  {/* Icon + Arrow */}
                  <div className="flex items-start justify-between">
                    <div
                      className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center',
                        card.bg,
                      )}
                    >
                      <Icon className={cn('w-5 h-5', card.color)} />
                    </div>
                    <ChevronRight
                      className="w-4 h-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    />
                  </div>

                  {/* Text */}
                  <div className="flex-1 space-y-1">
                    <h3 className="font-semibold text-sm leading-tight">{card.title}</h3>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {card.description}
                    </p>
                  </div>

                  {/* Footer badge */}
                  <div>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] px-2 py-0', card.color)}
                    >
                      View Report
                    </Badge>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
