'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion } from 'framer-motion';
import { useRouter } from 'next/navigation';
import { Activity, Zap, Clock, BarChart3 } from 'lucide-react';

import { cn, getMachineStateStyle, formatPercent, formatDuration, timeAgo } from '@/lib/utils';
import { useScopeStore } from '@/store/scope-store';
import { useOeeMode } from '@/hooks/use-oee-mode';
import type { Machine } from '@/features/dashboard/use-dashboard-data';

interface MachineCardProps {
  machine: Machine;
}

function MachineCard({ machine }: MachineCardProps) {
  const { t } = useTranslation('common');
  const stateStyle = getMachineStateStyle(machine.state);
  // The grid follows the OEE basis chosen in the filter panel, like every other card.
  const oeeMode = useOeeMode();
  const oee = oeeMode.pick(machine.oee, machine.oeeTb);
  const router = useRouter();
  const setScope = useScopeStore((s) => s.setScope);

  // Drill-down: scope the global filters to this machine and open Factory Analytics.
  const openAnalytics = () => {
    setScope({ type: 'MACHINE', id: machine.id, name: machine.name, code: machine.code });
    router.push('/analytics');
  };

  return (
    <motion.div
      layout
      onClick={openAnalytics}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') openAnalytics(); }}
      title={t('widgets.openAnalytics')}
      className="p-3 rounded-xl border border-border/30 bg-card/60 hover:border-primary/40 hover:bg-card transition-all duration-200 group cursor-pointer"
    >
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="min-w-0 flex items-center gap-1">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground truncate">{machine.name}</div>
            <div className="text-[10px] text-muted-foreground">{machine.code}</div>
          </div>
          <BarChart3 size={11} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
        </div>
        <div className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold shrink-0',
          stateStyle.bg, stateStyle.color,
        )}>
          {machine.state === 'RUNNING' && (
            <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
          )}
          {stateStyle.label}
        </div>
      </div>

      {/* OEE bar */}
      <div className="mb-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-muted-foreground">{t('charts.oee')}</span>
          <span className={cn('text-[11px] font-bold tabular-nums', oee >= 85 ? 'text-success-400' : oee >= 65 ? 'text-brand-400' : 'text-warning-400')}>
            {formatPercent(oee)}
          </span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-700',
              oee >= 85 ? 'bg-success-500' : oee >= 65 ? 'bg-brand-500' : 'bg-warning-500',
            )}
            style={{ width: `${oee}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
        <div className="flex items-center gap-1">
          <Zap size={10} />
          <span>{machine.throughput}/h</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock size={10} />
          <span>{formatDuration(machine.runtime)}</span>
        </div>
      </div>

      {machine.currentOrder && (
        <div className="mt-2 text-[10px] text-muted-foreground truncate">
          {t('widgets.order')}: <span className="text-foreground font-medium">{machine.currentOrder}</span>
        </div>
      )}

      {/* Live freshness — these are real-time values, NOT affected by the date-range filter */}
      <div className="mt-2 flex items-center gap-1 text-[9px] text-muted-foreground">
        <span className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse" />
        <span className="font-medium text-success-400">{t('charts.live')}</span>
        {machine.lastUpdate && <span>· {timeAgo(machine.lastUpdate)}</span>}
      </div>
    </motion.div>
  );
}

interface MachineStatusGridProps {
  machines?: Machine[];
  isLoading?: boolean;
}

export function MachineStatusGrid({ machines, isLoading }: MachineStatusGridProps) {
  const { t } = useTranslation('common');
  const stateCount = machines?.reduce(
    (acc, m) => {
      acc[m.state] = (acc[m.state] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return (
    <div className="industrial-card p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('charts.machineStatusGrid')}</h3>
          <p className="text-xs text-muted-foreground">{t('charts.realtimeOverview')}</p>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          {stateCount && Object.entries(stateCount).map(([state, count]) => {
            const style = getMachineStateStyle(state);
            return (
              <div key={state} className={cn('flex items-center gap-1 px-1.5 py-0.5 rounded-full', style.bg, style.color)}>
                <span className="w-1 h-1 rounded-full bg-current" />
                {count} {style.label}
              </div>
            );
          })}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="shimmer h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {(machines ?? []).map((machine) => (
            <MachineCard key={machine.id} machine={machine} />
          ))}
        </div>
      )}
    </div>
  );
}
