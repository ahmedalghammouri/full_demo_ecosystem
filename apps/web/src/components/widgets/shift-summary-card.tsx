'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, User, Target, AlertTriangle } from 'lucide-react';
import { cn, formatPercent, formatDuration } from '@/lib/utils';

interface ShiftSummaryData {
  shiftName: string;
  operator: string | null;
  startTime: string;
  elapsed: number;
  output: number;
  inProcess?: number;
  unit?: string | null;
  target: number | null;
  oee: number | null;
  downtime: number;
  defects: number;
}

interface ShiftSummaryCardProps {
  data?: ShiftSummaryData | null;
  isLoading?: boolean;
}

export function ShiftSummaryCard({ data, isLoading }: ShiftSummaryCardProps) {
  const { t } = useTranslation('common');
  // target/oee can be null when not configured on the shift — guard against NaN/Infinity.
  const outputPct = data && data.target && data.target > 0 ? (data.output / data.target) * 100 : 0;

  return (
    <div className="industrial-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('charts.currentShift')}</h3>
          {data && <p className="text-xs text-muted-foreground">{data.shiftName}</p>}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-success-400">
          <span className="w-1.5 h-1.5 rounded-full bg-success-400 animate-pulse" />
          {t('widgets.active')}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="shimmer h-4 rounded" />
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Operator & Time */}
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <User size={12} />
              <span>{data?.operator ?? '—'}</span>
            </div>
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Clock size={12} />
              <span>{data?.elapsed ? formatDuration(data.elapsed) : '—'} {t('widgets.elapsed')}</span>
            </div>
          </div>

          {/* Output progress */}
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted-foreground">{t('widgets.outputProgress')}{data?.unit ? ` · ${data.unit}` : ''}</span>
              <span className="font-semibold text-foreground">
                {data?.output?.toLocaleString() ?? 0} / {data?.target != null ? data.target.toLocaleString() : '—'}
                {(data?.inProcess ?? 0) > 0 && <span className="text-sky-400 font-normal"> · +{data!.inProcess!.toLocaleString()} {t('widgets.wip')}</span>}
              </span>
            </div>
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-700',
                  outputPct >= 90 ? 'bg-success-500' : outputPct >= 75 ? 'bg-warning-500' : 'bg-danger-500',
                )}
                style={{ width: `${Math.min(outputPct, 100)}%` }}
              />
            </div>
            <div className="text-[10px] text-muted-foreground mt-1 text-right">
              {data?.target ? t('widgets.ofTarget', { value: formatPercent(outputPct) }) : t('widgets.noTargetSet')}
            </div>
          </div>

          {/* Stats grid */}
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: t('charts.oee'), value: data?.oee != null ? formatPercent(data.oee) : '—', color: (data?.oee ?? 0) >= 85 ? 'text-success-400' : 'text-warning-400' },
              { label: t('widgets.downtime'), value: formatDuration(data?.downtime ?? 0), color: 'text-warning-400' },
              { label: t('widgets.defects'), value: String(data?.defects ?? 0), color: (data?.defects ?? 0) > 0 ? 'text-danger-400' : 'text-success-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="text-center p-2 rounded-lg bg-muted/20">
                <div className={cn('text-sm font-bold', color)}>{value}</div>
                <div className="text-[10px] text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
