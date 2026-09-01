'use client';

/**
 * AdvancedKpiCards — the three production KPIs the plant asked for in the PoC review:
 *
 *   • Overall Line OEE   — bottleneck A × bottleneck P × final-outfeed Q
 *   • Master Schedule Attainment (MSA)
 *   • Volume-Based Capacity Utilization
 *
 * Each card shows the formula and the resolved basis next to the number, because
 * the recurring complaint on this project has been figures that could not be
 * explained or reconciled. Nothing here re-derives a value in the browser: every
 * number, and the method text describing it, comes from the API.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Gauge, CalendarCheck, Boxes, Info, AlertTriangle } from 'lucide-react';

import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import * as PopoverPrimitive from '@radix-ui/react-popover';

// ---------------------------------------------------------------------------
// API shapes (mirrors of the service return types)
// ---------------------------------------------------------------------------

interface LineOeeResponse {
  lineId: string; lineName: string;
  /** Which basis produced this figure — the line's configured choice. */
  method: 'ROLLUP' | 'BOTTLENECK';
  oee: number; availability: number; performance: number; quality: number;
  basis: {
    method: string;
    formula: string;
    /** BOTTLENECK only. */
    bottleneckMachineName?: string;
    outfeedMachineNames?: string[];
    bottleneckResolvedBy?: 'CONFIGURED' | 'SLOWEST_ROUTING_CYCLE_TIME' | 'UNRESOLVED';
    outfeedResolvedBy?: 'CONFIGURED' | 'ALL_MACHINES_ON_LINE';
    bottleneckExternalLossMin?: number;
    /** ROLLUP only. */
    machineCount?: number;
    externalLossMin?: number;
  };
  machines: {
    machineId: string; name: string; isBottleneck: boolean; isOutfeed: boolean;
    oee: number; externalLossMin: number;
  }[];
}

interface MsaResponse {
  msaPct: number;
  totalScheduledQty: number; totalCreditedQty: number; totalActualQty: number;
  orderCount: number;
  lines: { orderNumber: string; scheduledQty: number; actualQty: number; creditedQty: number; attainmentPct: number }[];
  method: { formula: string; note: string };
}

interface CapacityResponse {
  utilizationPct: number;
  actualUnits: number; maxDesignedUnits: number; windowHours: number; machineCount: number;
  machinesMissingCapacity: { id: string; name: string; reason: string }[];
  byMachine: {
    machineId: string; name: string; ratedUnitsPerHour: number | null;
    ratedFrom: { processName: string; operationName: string; cycleTimeSec: number } | null;
    actualUnits: number; utilizationPct: number | null;
  }[];
  method: { formula: string; capacityBasis: string; note: string };
}

// ---------------------------------------------------------------------------
// Shared card shell
// ---------------------------------------------------------------------------

function MethodPopover({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>
        <button
          type="button"
          title={title}
          aria-label={title}
          className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border/60
                     text-muted-foreground transition-colors hover:border-brand-500/40
                     hover:bg-brand-500/10 hover:text-brand-400"
        >
          <Info size={13} />
        </button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="end"
          sideOffset={6}
          className="z-50 w-80 rounded-lg border border-border/70 bg-popover p-3 text-xs leading-relaxed
                     text-popover-foreground shadow-xl outline-none"
        >
          <p className="mb-2 font-semibold">{title}</p>
          {children}
          <PopoverPrimitive.Arrow className="fill-border" />
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

function KpiShell({
  icon: Icon, label, value, unit, tone = 'brand', method, footer, isLoading, warning,
}: {
  // lucide-react icons are ForwardRefExoticComponent, whose `size` accepts
  // string | number — a narrower FC signature here is not assignable.
  icon: React.ComponentType<{ size?: string | number; className?: string }>;
  label: string;
  value: string;
  unit?: string;
  tone?: 'brand' | 'green' | 'amber';
  method: React.ReactNode;
  footer?: React.ReactNode;
  isLoading?: boolean;
  warning?: string | null;
}) {
  const toneClass =
    tone === 'green' ? 'text-success-400 bg-success-500/15'
    : tone === 'amber' ? 'text-warning-400 bg-warning-500/15'
    : 'text-brand-400 bg-brand-500/15';

  return (
    <div className="industrial-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', toneClass)}>
            <Icon size={15} />
          </span>
          <span className="truncate text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </span>
        </div>
        <MethodPopover title={label}>{method}</MethodPopover>
      </div>

      <div className="flex items-baseline gap-1.5">
        {isLoading ? (
          <div className="shimmer h-8 w-24 rounded" />
        ) : (
          <>
            <span className="text-3xl font-bold tabular-nums">{value}</span>
            {unit && <span className="text-sm text-muted-foreground">{unit}</span>}
          </>
        )}
      </div>

      {warning && (
        <p className="flex items-start gap-1.5 text-[11px] leading-snug text-warning-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          {warning}
        </p>
      )}

      {footer && <div className="border-t border-border/40 pt-2 text-[11px] text-muted-foreground">{footer}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function AdvancedKpiCards() {
  const { t } = useTranslation('modules');
  const { filter, key: scopeKey, scope } = useScope();
  //  IS the timeframe the rest of the app sends; these three cards were the
  // only ones omitting it, which is why they answered for a different period.
  const { dateFrom, dateTo, key: timeKey, preset: timeframe } = useTimeRange();

  // Line OEE is only defined for a LINE scope — a bottleneck belongs to a line.
  const lineId = scope?.type === 'LINE' ? scope.id : null;

  const lineOee = useQuery({
    queryKey: ['production', 'oee', 'line', lineId, timeKey],
    queryFn: () => api.get<LineOeeResponse>('/production/oee/line', {
      //  matters: the API resolves 'shift' from the shift templates, so
      // omitting it made this card answer for a calendar day while the OEE card above
      // it answered for the current shift.
      params: { lineId, timeframe, dateFrom, dateTo },
    }),
    enabled: !!lineId,
    staleTime: 60_000,
  });

  const msa = useQuery({
    queryKey: ['production', 'msa', scopeKey, timeKey],
    queryFn: () => api.get<MsaResponse>('/production/kpi/master-schedule-attainment', {
      params: { timeframe, dateFrom, dateTo, lineId: filter.lineId },
    }),
    staleTime: 60_000,
  });

  const capacity = useQuery({
    queryKey: ['production', 'capacity-utilization', scopeKey, timeKey],
    queryFn: () => api.get<CapacityResponse>('/production/kpi/capacity-utilization', {
      params: { timeframe, dateFrom, dateTo, ...filter },
    }),
    staleTime: 60_000,
  });

  const lo = lineOee.data;
  const ms = msa.data;
  const cap = capacity.data;

  const missing = cap?.machinesMissingCapacity ?? [];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {/* ── Overall Line OEE (bottleneck) ─────────────────────────────── */}
      <KpiShell
        icon={Gauge}
        label={t('advKpi.lineOee', 'Overall Line OEE')}
        value={lineId ? (lo ? `${lo.oee.toFixed(1)}` : '—') : '—'}
        unit={lineId && lo ? '%' : undefined}
        tone="brand"
        isLoading={!!lineId && lineOee.isLoading}
        warning={
          !lineId
            ? t('advKpi.selectLine', 'Select a production line in the scope panel.')
            : lo?.method === 'BOTTLENECK' && lo.basis.bottleneckResolvedBy === 'SLOWEST_ROUTING_CYCLE_TIME'
              ? t('advKpi.bottleneckAuto', 'No bottleneck configured — using the slowest routing cycle time. Set it in Plant Hierarchy → Edit Production Line.')
              : null
        }
        method={
          <>
            <p className="mb-2 font-mono text-[11px]">{lo?.basis.formula ?? '—'}</p>
            <p className="text-muted-foreground">
              {lo?.method === 'ROLLUP'
                ? t('advKpi.rollupWhy',
                    'Quantity-weighted across every machine on the line — the minutes and counts are summed, then A, P and Q are re-derived from the totals. It is not an average of machine percentages.')
                : t('advKpi.lineOeeWhy',
                    'A line runs at the speed of its constraint. Averaging every machine misrepresents it, because assets downstream of the bottleneck idle by design whenever it stops.')}
            </p>
            {lo?.method === 'BOTTLENECK' && (
              <dl className="mt-2 space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t('advKpi.bottleneck', 'Bottleneck')}</dt>
                  <dd className="font-medium">{lo.basis.bottleneckMachineName ?? '—'}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="shrink-0 text-muted-foreground">{t('advKpi.outfeed', 'Outfeed point')}</dt>
                  <dd className="text-right font-medium">
                    {lo.basis.outfeedResolvedBy === 'ALL_MACHINES_ON_LINE'
                      ? t('advKpi.outfeedAll', 'All machines on the line')
                      : (lo.basis.outfeedMachineNames ?? []).join(' + ') || '—'}
                  </dd>
                </div>
              </dl>
            )}
            <p className="mt-2 border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
              {t('advKpi.changeBasis', 'Change the basis in Plant Hierarchy → Edit Production Line.')}
            </p>
          </>
        }
        footer={
          lo && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>A {lo.availability.toFixed(1)}%</span>
              <span>P {lo.performance.toFixed(1)}%</span>
              <span>Q {lo.quality.toFixed(1)}%</span>
              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                {lo.method === 'BOTTLENECK'
                  ? (lo.basis.bottleneckMachineName ?? t('advKpi.methodBottleneck', 'Bottleneck'))
                  : t('advKpi.methodRollup', 'Roll-up')}
              </Badge>
            </div>
          )
        }
      />

      {/* ── Master Schedule Attainment ────────────────────────────────── */}
      <KpiShell
        icon={CalendarCheck}
        label={t('advKpi.msa', 'Master Schedule Attainment')}
        value={ms ? ms.msaPct.toFixed(1) : '—'}
        unit={ms ? '%' : undefined}
        tone={ms && ms.msaPct >= 95 ? 'green' : 'amber'}
        isLoading={msa.isLoading}
        method={
          <>
            <p className="mb-2 font-mono text-[11px]">
              {ms?.method.formula ?? 'Σ min(Actual, Scheduled) ÷ Total Scheduled × 100'}
            </p>
            <p className="text-muted-foreground">{ms?.method.note}</p>
          </>
        }
        footer={
          ms && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{t('advKpi.credited', 'Credited')} {Math.round(ms.totalCreditedQty).toLocaleString()}</span>
              <span>/ {Math.round(ms.totalScheduledQty).toLocaleString()} {t('advKpi.scheduled', 'scheduled')}</span>
              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                {ms.orderCount} {t('advKpi.orders', 'orders')}
              </Badge>
            </div>
          )
        }
      />

      {/* ── Volume-Based Capacity Utilization ─────────────────────────── */}
      <KpiShell
        icon={Boxes}
        label={t('advKpi.capacity', 'Capacity Utilization')}
        value={cap ? cap.utilizationPct.toFixed(1) : '—'}
        unit={cap ? '%' : undefined}
        tone="brand"
        isLoading={capacity.isLoading}
        warning={
          missing.length > 0
            ? t('advKpi.missingCapacity',
                '{{count}} machine(s) have no routing cycle time, so they add nothing to the denominator.',
                { count: missing.length })
            : null
        }
        method={
          <>
            <p className="mb-2 font-mono text-[11px]">
              {cap?.method.formula ?? 'Actual Units ÷ Maximum Designed Unit Capacity × 100'}
            </p>
            <p className="text-muted-foreground">{cap?.method.capacityBasis}</p>
            {missing.length > 0 && (
              <p className="mt-2 text-warning-400">
                {t('advKpi.missingList', 'Not in any routing:')} {missing.map((m) => m.name).join(', ')}
              </p>
            )}
          </>
        }
        footer={
          cap && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{Math.round(cap.actualUnits).toLocaleString()}</span>
              <span>/ {Math.round(cap.maxDesignedUnits).toLocaleString()} {t('advKpi.designed', 'designed')}</span>
              <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                {cap.machineCount} {t('advKpi.machines', 'machines')}
              </Badge>
            </div>
          )
        }
      />
    </div>
  );
}
