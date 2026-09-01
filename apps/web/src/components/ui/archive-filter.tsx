'use client';

import { Archive } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export type ArchiveScope = 'active' | 'archived' | 'all';

/**
 * Odoo-style archive scope filter for any table.
 * Active = non-archived (default) · Archived = only archived · All = both.
 */
export function ArchiveFilter({ value, onChange, className }: { value: ArchiveScope; onChange: (v: ArchiveScope) => void; className?: string }) {
  const { t } = useTranslation('common');
  return (
    <Select value={value} onValueChange={(v) => onChange(v as ArchiveScope)}>
      <SelectTrigger className={className ?? 'h-8 w-36 text-xs'}>
        <Archive size={12} className="me-1 opacity-70" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="active">{t('status.active')}</SelectItem>
        <SelectItem value="archived">{t('status.archived')}</SelectItem>
        <SelectItem value="all">{t('common.all')}</SelectItem>
      </SelectContent>
    </Select>
  );
}
