'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Factory, ClipboardList, CheckCircle2, Activity } from 'lucide-react';
import type { ProductionStatus } from '@/features/dashboard/use-dashboard-data';
import { cn, formatPercent } from '@/lib/utils';

interface ProductionStatusBarProps {
  data?: ProductionStatus;
  isLoading?: boolean;
}

export function ProductionStatusBar({ data, isLoading }: ProductionStatusBarProps) {
  const { t } = useTranslation('common');
  const efficiency = data?.plannedOutput
    ? (data.actualOutput / data.plannedOutput) * 100
    : 0;

  const items = [
    {
      icon: Factory,
      label: t('widgets.runningLines'),
      value: isLoading ? '—' : `${data?.runningLines ?? 0} / ${data?.totalLines ?? 0}`,
      color: 'text-success-400',
      bg: 'bg-success-500/10',
    },
    {
      icon: ClipboardList,
      label: t('widgets.activeOrders'),
      value: isLoading ? '—' : String(data?.activeOrders ?? 0),
      color: 'text-brand-400',
      bg: 'bg-brand-500/10',
    },
    {
      icon: CheckCircle2,
      label: t('widgets.completedToday'),
      value: isLoading ? '—' : String(data?.completedToday ?? 0),
      color: 'text-success-400',
      bg: 'bg-success-500/10',
    },
    {
      icon: Activity,
      label: t('widgets.outputEfficiency'),
      value: isLoading ? '—' : formatPercent(efficiency),
      color: efficiency >= 90 ? 'text-success-400' : efficiency >= 75 ? 'text-warning-400' : 'text-danger-400',
      bg: 'bg-primary/5',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex items-center gap-3 p-3.5 rounded-xl border border-border/30 bg-card/40"
        >
          <div className={cn('p-2 rounded-lg shrink-0', item.bg)}>
            <item.icon size={15} className={item.color} />
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
              {item.label}
            </div>
            <div className={cn('text-base font-bold tabular-nums', item.color)}>
              {item.value}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
