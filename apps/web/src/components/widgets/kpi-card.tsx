'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn, getOEEColor, formatNumber, formatPercent } from '@/lib/utils';

interface KPICardProps {
  title: string;
  value: number | string | null | undefined;
  unit?: string;
  trend?: number;
  target?: number;
  colorMode?: 'oee' | 'alarm' | 'default';
  isLoading?: boolean;
  icon?: React.ReactNode;
  subtitle?: string;
  className?: string;
}

export function KPICard({
  title,
  value,
  unit,
  trend,
  target,
  colorMode = 'default',
  isLoading,
  icon,
  subtitle,
  className,
}: KPICardProps) {
  /**
   * A caller that passes a STRING has already formatted it, and the card must
   * print it as given.
   *
   * `formatNumber` runs `Number(value)` and returns an em-dash for anything it
   * cannot parse. So the Downtime Command Center, which passes "265h 0m" from
   * its own `fmtMin`, showed four empty cards over a chart full of data -- an
   * em-dash means "nothing recorded", and the plant had 15,900 minutes of it.
   *
   * Numbers still go through `formatNumber` for its thousands separators and
   * its guard against a small non-zero value printing as 0.
   */
  const preformatted = typeof value === 'string' && Number.isNaN(Number(value));
  const numValue = preformatted ? NaN : Number(value ?? 0);
  const valueColor =
    colorMode === 'oee'
      ? getOEEColor(numValue)
      : colorMode === 'alarm' && numValue > 0
        ? 'text-danger-400'
        : 'text-foreground';

  const atTarget = target !== undefined && !preformatted && numValue >= target;
  // A preformatted value has no scale to draw a bar against.
  const progressPct = target && !preformatted
    ? Math.min((numValue / target) * 100, 100)
    : null;

  const trendIcon =
    trend === undefined || trend === 0 ? (
      <Minus size={11} className="text-muted-foreground" />
    ) : trend > 0 ? (
      <TrendingUp size={11} className="text-success-400" />
    ) : (
      <TrendingDown size={11} className="text-danger-400" />
    );

  if (isLoading) {
    return (
      <div className={cn('kpi-card', className)}>
        <div className="shimmer h-3 w-24 rounded mb-3" />
        <div className="shimmer h-7 w-16 rounded mb-2" />
        <div className="shimmer h-1.5 w-full rounded-full" />
      </div>
    );
  }

  return (
    <div className={cn('kpi-card group', className)}>
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
          {title}
        </span>
        {icon && (
          <div className="p-1.5 rounded-md bg-primary/10 text-primary">
            {icon}
          </div>
        )}
      </div>

      {/* Value */}
      <motion.div
        key={value}
        initial={{ opacity: 0.7 }}
        animate={{ opacity: 1 }}
        className="flex items-baseline gap-1.5 mb-2"
      >
        <span className={cn('text-2xl font-bold tabular-nums', valueColor)}>
          {preformatted ? value : formatNumber(value, unit === '%' ? 1 : 0)}
        </span>
        {unit && (
          <span className="text-sm text-muted-foreground font-medium">{unit}</span>
        )}
      </motion.div>

      {/* Progress bar */}
      {progressPct !== null && (
        <div className="h-1 bg-muted rounded-full overflow-hidden mb-2">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
            className={cn(
              'h-full rounded-full',
              atTarget ? 'bg-success-500' : progressPct >= 75 ? 'bg-warning-500' : 'bg-danger-500',
            )}
          />
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between">
        {trend !== undefined && (
          <div className={cn(
            'flex items-center gap-1 text-[11px] font-medium',
            trend > 0 ? 'text-success-400' : trend < 0 ? 'text-danger-400' : 'text-muted-foreground',
          )}>
            {trendIcon}
            {trend !== 0 && (
              <span>{trend > 0 ? '+' : ''}{trend.toFixed(1)}%</span>
            )}
            <span className="text-muted-foreground">vs prev</span>
          </div>
        )}
        {target !== undefined && (
          <span className="text-[10px] text-muted-foreground ml-auto">
            Target: {formatNumber(target)}{unit}
          </span>
        )}
        {subtitle && !target && (
          <span className="text-[10px] text-muted-foreground">{subtitle}</span>
        )}
      </div>
    </div>
  );
}
