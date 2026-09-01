'use client';

import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './button';
import { InlineFormPanel } from './inline-form-panel';

interface FormDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  onSubmit: () => void;
  submitLabel?: string;
  isSubmitting?: boolean;
  isValid?: boolean;
}

/**
 * FormDialog — backed by {@link InlineFormPanel}.
 *
 * Historically this rendered a centered modal overlay. It now expands inline
 * within the page (into the page's `InlineFormSlot`, falling back to in-place)
 * so add/edit forms stay in the same scroll context instead of popping up.
 * The public props are unchanged, so existing call sites keep working.
 */
export function FormDialog({
  open,
  onClose,
  title,
  children,
  onSubmit,
  submitLabel,
  isSubmitting = false,
  isValid = true,
}: FormDialogProps) {
  const { t } = useTranslation('common');
  return (
    <InlineFormPanel
      open={open}
      onClose={onClose}
      title={title}
      footer={(
        <>
          <Button variant="outline" onClick={onClose} disabled={isSubmitting}>
            {t('actions.cancel')}
          </Button>
          <Button onClick={onSubmit} disabled={!isValid || isSubmitting}>
            {isSubmitting ? t('actions.saving') : (submitLabel ?? t('actions.save'))}
          </Button>
        </>
      )}
    >
      {children}
    </InlineFormPanel>
  );
}
