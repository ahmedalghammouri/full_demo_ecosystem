'use client';

/**
 * QualityFloorView — tablet board for shop-floor quality checks. Lets an
 * inspector/operator record an inspection against a quality plan (measurements +
 * pass/fail), read the plan's instruction files, and attach evidence photos.
 * Split out from the Maintenance Floor so each role has its own focused screen.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardCheck } from 'lucide-react';

import { useAuthStore } from '@/store/auth-store';
import { QualityChecksPanel } from './quality-checks-panel';

export function QualityFloorView() {
  const { t } = useTranslation(['maintenance', 'common']);
  const userName = useAuthStore((s) => s.user?.name);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-border/50 shrink-0">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center shrink-0">
          <ClipboardCheck className="text-emerald-400" size={20} />
        </div>
        <div>
          <h1 className="text-lg font-bold">{t('qfloor.title')}</h1>
          <p className="text-xs text-muted-foreground">{userName ? t('qfloor.subtitleUser', { name: userName }) : t('qfloor.subtitle')}</p>
        </div>
      </div>
      <QualityChecksPanel />
    </div>
  );
}
