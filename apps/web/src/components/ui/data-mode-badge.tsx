'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { History } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * DataModeBadge — a small marker that tells the user whether a card/chart shows
 *   • LIVE   real-time data (current machine state / instant counters) that does
 *            NOT change with the time/PO/WO filters, or
 *   • PERIOD saved/historical data aggregated over the selected period (responds
 *            to the time range, scope and PO/WO filters).
 *
 * Place it in a card/chart header so it's always obvious which numbers are which.
 *   <DataModeBadge mode="live" />
 *   <DataModeBadge mode="period" label="Week" />
 */
export function DataModeBadge({
  mode,
  label,
  className,
}: {
  mode: 'live' | 'period';
  label?: string;
  className?: string;
}) {
  const { t } = useTranslation(['common']);
  if (mode === 'live') {
    return (
      <span
        title={t('dataMode.liveHint', { defaultValue: 'Real-time value — not affected by the time / PO / WO filters' })}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide',
          'text-emerald-400 bg-emerald-500/10 border-emerald-500/30',
          className,
        )}
      >
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
        {t('dataMode.live', { defaultValue: 'Live' })}
      </span>
    );
  }
  return (
    <span
      title={t('dataMode.periodHint', { defaultValue: 'Saved data over the selected period — responds to the time / PO / WO filters' })}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold tracking-wide',
        'text-sky-400 bg-sky-500/10 border-sky-500/30',
        className,
      )}
    >
      <History size={9} />
      {label ? `${t('dataMode.period', { defaultValue: 'Period' })} · ${label}` : t('dataMode.period', { defaultValue: 'Period' })}
    </span>
  );
}
