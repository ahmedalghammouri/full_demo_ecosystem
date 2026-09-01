'use client';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';
import {
  ShieldCheck,
  ClipboardCheck,
  AlertTriangle,
  CheckCircle2,
  LineChart,
  FileText,
  ChevronRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useScope } from '@/hooks/use-scope';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api.client';
import { cn, formatPercent } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface NCRListResponse {
  data: unknown[];
  total: number;
}

/** Canonical quality KPIs — GET /quality/kpis. FPY and Defect Rate come from here. */
interface QualityKPIs {
  fpy: number;
  defectRate: number;
  defectPpm: number;
  passRate: number;
  reworkRate: number;
  scrapRate: number;
  totalInspected: number;
  totalPassed: number;
  totalFailed: number;
  openNCRs: number;
  inspectionsToday: number;
}

// ---------------------------------------------------------------------------
// Report card definitions
// ---------------------------------------------------------------------------

interface ReportCard {
  title: string;
  href: string;
  icon: React.FC<{ className?: string }>;
  description: string;
  color: string;
  bg: string;
}

const REPORT_CARDS: ReportCard[] = [
  {
    title: 'Quality Overview',
    href: '/quality',
    icon: ShieldCheck,
    description: 'Full quality dashboard with KPIs',
    color: 'text-purple-400',
    bg: 'bg-purple-500/15',
  },
  {
    title: 'Inspection Records',
    href: '/quality/records',
    icon: ClipboardCheck,
    description: 'All inspection results and pass rates',
    color: 'text-brand-400',
    bg: 'bg-brand-500/15',
  },
  {
    title: 'NCR Management',
    href: '/quality/ncr',
    icon: AlertTriangle,
    description: 'Non-conformance reports and resolution',
    color: 'text-warning-400',
    bg: 'bg-warning-500/15',
  },
  {
    title: 'CAPA Tracking',
    href: '/quality/capa',
    icon: CheckCircle2,
    description: 'Corrective and preventive action status',
    color: 'text-success-400',
    bg: 'bg-success-500/15',
  },
  {
    title: 'SPC Analysis',
    href: '/quality/spc',
    icon: LineChart,
    description: 'Statistical process control charts',
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/15',
  },
  {
    title: 'Quality Report',
    href: '/reports/quality',
    icon: FileText,
    description: 'Detailed quality performance export',
    color: 'text-rose-400',
    bg: 'bg-rose-500/15',
  },
];

// ---------------------------------------------------------------------------
// Animation variants
// ---------------------------------------------------------------------------

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface KPIPillProps {
  label: string;
  value: string;
  variant?: 'default' | 'danger' | 'success';
  isLoading?: boolean;
}

function KPIPill({ label, value, variant = 'default', isLoading }: KPIPillProps) {
  const variantClass =
    variant === 'danger'
      ? 'border-danger-500/40 bg-danger-500/10 text-danger-400'
      : variant === 'success'
        ? 'border-success-500/40 bg-success-500/10 text-success-400'
        : 'border-border/60 bg-muted/30 text-foreground';

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-full border px-4 py-2 text-sm',
        variantClass,
      )}
    >
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      {isLoading ? (
        <div className="shimmer h-4 w-12 rounded" />
      ) : (
        <span className="font-bold tabular-nums">{value}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function QualityReportsView() {
  const { t } = useTranslation(['quality', 'common']);
  // Canonical quality KPIs — FPY / Defect Rate are inspection-based and come from
  // /quality/kpis, the same source as the Quality cockpit and the Analytics quality
  // report. (The OEE quality factor on /dashboard/kpis is a different measure and was
  // previously mislabelled as First Pass Yield here.)
  const { filter: scopeFilter, key: scopeKey } = useScope();
  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['quality', 'kpis', scopeKey],
    queryFn: () => api.get<QualityKPIs>('/quality/kpis', { params: scopeFilter }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Fetch open NCR count
  const { data: ncrData, isLoading: ncrLoading } = useQuery({
    queryKey: ['quality', 'ncr', 'open-count'],
    queryFn: () =>
      api.get<NCRListResponse>('/quality/ncr', {
        params: { status: 'OPEN', limit: 1 },
      }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const firstPassYield = kpis?.fpy ?? 0;
  const defectRate = kpis?.defectRate ?? 0;
  const openNCRs = (ncrData as any)?.total ?? 0;

  // Derived stats for quick-stats section
  const passRate = firstPassYield;
  const passRateBar = Math.min(Math.max(passRate, 0), 100);
  // Treat open NCRs > 5 as trending up (worse), otherwise stable
  const ncrTrend = openNCRs > 5 ? 'high' : openNCRs > 0 ? 'moderate' : 'clear';
  const defectBar = Math.min(Math.max(defectRate, 0), 100);
  const inspectedUnits = kpis?.totalInspected ?? 0;
  const failedUnits = kpis?.totalFailed ?? 0;

  const isLoading = kpisLoading || ncrLoading;

  return (
    <div className="p-6 space-y-8">
      {/* ------------------------------------------------------------------ */}
      {/* Header                                                               */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/15 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-purple-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{t('headers.reports.title')}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {t('headers.reports.subtitle')}
            </p>
          </div>
        </div>

        {/* KPI pills */}
        <div className="flex flex-wrap items-center gap-2">
          <KPIPill
            label="First Pass Yield"
            value={isLoading ? '—' : `${firstPassYield.toFixed(1)}%`}
            variant={firstPassYield >= 95 ? 'success' : firstPassYield >= 85 ? 'default' : 'danger'}
            isLoading={isLoading}
          />
          <KPIPill
            label="Defect Rate"
            value={isLoading ? '—' : `${defectRate.toFixed(1)}%`}
            variant={defectRate <= 1 ? 'success' : defectRate <= 5 ? 'default' : 'danger'}
            isLoading={isLoading}
          />
          <KPIPill
            label="Open NCRs"
            value={isLoading ? '—' : String(openNCRs)}
            variant={openNCRs > 0 ? 'danger' : 'success'}
            isLoading={isLoading}
          />
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Report cards — 3-col grid                                           */}
      {/* ------------------------------------------------------------------ */}
      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4"
      >
        {REPORT_CARDS.map((card) => {
          const Icon = card.icon;
          return (
            <motion.div key={card.href} variants={itemVariants}>
              <Link href={card.href} className="block group">
                <div className="glass-card rounded-xl p-5 flex items-start gap-4 transition-colors hover:bg-foreground/5 hover:border-border/80 cursor-pointer">
                  <div
                    className={cn(
                      'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-transform group-hover:scale-105',
                      card.bg,
                    )}
                  >
                    <Icon className={cn('w-5 h-5', card.color)} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm">{card.title}</span>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {card.description}
                    </p>
                  </div>
                </div>
              </Link>
            </motion.div>
          );
        })}
      </motion.div>

      {/* ------------------------------------------------------------------ */}
      {/* Quick quality stats row                                             */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Pass rate bar */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="glass-card rounded-xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Pass Rate
            </span>
            <Badge
              variant={passRate >= 95 ? 'default' : 'outline'}
              className="text-[10px] h-5"
            >
              {isLoading ? '—' : formatPercent(passRate)}
            </Badge>
          </div>
          <div className="space-y-1.5">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              {isLoading ? (
                <div className="shimmer h-full w-full rounded-full" />
              ) : (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${passRateBar}%` }}
                  transition={{ duration: 0.9, ease: 'easeOut', delay: 0.5 }}
                  className={cn(
                    'h-full rounded-full',
                    passRate >= 95
                      ? 'bg-success-500'
                      : passRate >= 85
                        ? 'bg-warning-500'
                        : 'bg-danger-500',
                  )}
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0%</span>
              <span>Target 99%</span>
              <span>100%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {passRate >= 95
              ? 'Pass rate is within acceptable limits.'
              : passRate >= 85
                ? 'Pass rate is slightly below target — review recent inspections.'
                : 'Pass rate is below threshold — immediate action required.'}
          </p>
        </motion.div>

        {/* NCR trend */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="glass-card rounded-xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              NCR Trend
            </span>
            <Badge
              variant={ncrTrend === 'clear' ? 'default' : ncrTrend === 'moderate' ? 'outline' : 'destructive'}
              className="text-[10px] h-5 capitalize"
            >
              {ncrTrend}
            </Badge>
          </div>
          <div className="flex items-end gap-1 h-12">
            {isLoading ? (
              <div className="shimmer h-full w-full rounded" />
            ) : (
              /* Sparkbar — static representation showing relative NCR intensity */
              [20, 35, 28, 50, 42, 38, openNCRs > 0 ? Math.min(openNCRs * 8, 100) : 15].map(
                (pct, i) => (
                  <motion.div
                    key={i}
                    initial={{ scaleY: 0 }}
                    animate={{ scaleY: 1 }}
                    transition={{ delay: 0.55 + i * 0.05, duration: 0.3 }}
                    style={{ height: `${pct}%`, originY: 1 }}
                    className={cn(
                      'flex-1 rounded-sm',
                      i === 6
                        ? openNCRs > 0
                          ? 'bg-danger-500'
                          : 'bg-success-500'
                        : 'bg-muted',
                    )}
                  />
                ),
              )
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? 'Loading NCR data...'
              : openNCRs === 0
                ? 'No open NCRs — quality conformance is good.'
                : `${openNCRs} open NCR${openNCRs !== 1 ? 's' : ''} require${openNCRs === 1 ? 's' : ''} attention.`}
          </p>
        </motion.div>

        {/* Defect rate — failed ÷ inspected, the complement of FPY */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="glass-card rounded-xl p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Defect Rate
            </span>
            <Badge
              variant={defectRate <= 1 ? 'default' : 'outline'}
              className="text-[10px] h-5"
            >
              {isLoading ? '—' : formatPercent(defectRate)}
            </Badge>
          </div>
          <div className="space-y-1.5">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              {isLoading ? (
                <div className="shimmer h-full w-full rounded-full" />
              ) : (
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${defectBar}%` }}
                  transition={{ duration: 0.9, ease: 'easeOut', delay: 0.65 }}
                  className={cn(
                    'h-full rounded-full',
                    defectRate <= 1
                      ? 'bg-success-500'
                      : defectRate <= 5
                        ? 'bg-warning-500'
                        : 'bg-danger-500',
                  )}
                />
              )}
            </div>
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>0%</span>
              <span>Target ≤ 1%</span>
              <span>100%</span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? 'Loading inspection data…'
              : inspectedUnits === 0
                ? 'No units inspected in the current period.'
                : `${failedUnits.toLocaleString()} of ${inspectedUnits.toLocaleString()} inspected units failed first inspection (${kpis?.defectPpm ?? 0} PPM).`}
          </p>
        </motion.div>
      </div>
    </div>
  );
}
