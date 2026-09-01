'use client';

import React from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, AlertCircle, Info, CheckCircle, Bell, ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { cn, timeAgo } from '@/lib/utils';
import type { Alarm } from '@/features/dashboard/use-dashboard-data';

const severityConfig = {
  CRITICAL: {
    icon: AlertCircle,
    color: 'text-danger-400',
    bg: 'bg-danger-500/10',
    border: 'border-l-danger-500',
    dot: 'bg-danger-400',
  },
  HIGH: {
    icon: AlertTriangle,
    color: 'text-warning-400',
    bg: 'bg-warning-500/10',
    border: 'border-l-warning-500',
    dot: 'bg-warning-400',
  },
  MEDIUM: {
    icon: Info,
    color: 'text-brand-400',
    bg: 'bg-brand-500/10',
    border: 'border-l-brand-500',
    dot: 'bg-brand-400',
  },
  LOW: {
    icon: Info,
    color: 'text-muted-foreground',
    bg: 'bg-muted/50',
    border: 'border-l-muted',
    dot: 'bg-muted-foreground',
  },
};

interface AlarmListProps {
  alarms?: Alarm[];
  isLoading?: boolean;
}

export function AlarmList({ alarms, isLoading }: AlarmListProps) {
  const { t } = useTranslation('common');
  const activeAlarms = alarms?.filter((a) => !a.acknowledged) ?? [];

  return (
    <div className="industrial-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Bell size={14} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">{t('charts.activeAlarms')}</h3>
          {activeAlarms.length > 0 && (
            <span className="w-4.5 h-4.5 rounded-full bg-danger-500 text-[10px] font-bold text-white flex items-center justify-center">
              {activeAlarms.length > 9 ? '9+' : activeAlarms.length}
            </span>
          )}
        </div>
        <Link href="/alarms" className="text-[11px] text-primary hover:text-primary/80 flex items-center gap-0.5">
          View all <ArrowRight size={11} />
        </Link>
      </div>

      <div className="space-y-1.5 max-h-48 overflow-y-auto no-scrollbar">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="shimmer h-12 rounded-lg" />
          ))
        ) : activeAlarms.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CheckCircle size={24} className="text-success-400 mb-2" />
            <div className="text-xs font-medium text-foreground">{t('charts.noActiveAlarms')}</div>
            <div className="text-[10px] text-muted-foreground">{t('charts.allNormal')}</div>
          </div>
        ) : (
          <AnimatePresence>
            {activeAlarms.slice(0, 6).map((alarm) => {
              const config = severityConfig[alarm.severity] || severityConfig.LOW;
              const Icon = config.icon;
              return (
                <motion.div
                  key={alarm.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  className={cn(
                    'flex items-start gap-2.5 p-2.5 rounded-lg border-l-2 cursor-pointer hover:brightness-110 transition-all',
                    config.bg, config.border,
                  )}
                >
                  <Icon size={13} className={cn('shrink-0 mt-0.5', config.color)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className={cn('text-[11px] font-semibold', config.color)}>
                        {alarm.code}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0">
                        {timeAgo(alarm.triggeredAt)}
                      </span>
                    </div>
                    <div className="text-[11px] text-foreground/80 truncate">{alarm.description}</div>
                    <div className="text-[10px] text-muted-foreground">{alarm.machine}</div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
