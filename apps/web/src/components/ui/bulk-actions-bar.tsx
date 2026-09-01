'use client';

import { X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface BulkAction {
  label: string;
  icon?: React.ComponentType<any>;
  onClick: () => void;
  /** Tailwind classes for the button (tone). */
  className?: string;
  disabled?: boolean;
}

/**
 * Floating action bar shown when ≥1 rows are selected. Pairs with useRowSelection.
 * Renders centered at the bottom of the viewport with a count + the supplied actions.
 */
export function BulkActionsBar({ count, onClear, actions }: { count: number; onClear: () => void; actions: BulkAction[] }) {
  const { t } = useTranslation('common');
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-2 rounded-xl border border-border bg-card/95 backdrop-blur px-3 py-2 shadow-2xl"
        >
          <span className="text-xs font-semibold px-2 py-1 rounded-lg bg-primary/15 text-primary">{t('common.selected', { count })}</span>
          <div className="h-5 w-px bg-border/60 mx-0.5" />
          {actions.map((a) => (
            <Button
              key={a.label}
              size="sm"
              variant="outline"
              className={cn('h-8 text-xs gap-1.5', a.className)}
              disabled={a.disabled}
              onClick={a.onClick}
            >
              {a.icon && <a.icon size={13} />} {a.label}
            </Button>
          ))}
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClear} title={t('common.clearSelection')}>
            <X size={14} />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
