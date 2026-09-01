'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Default DOM id of the in-page slot where inline forms are rendered. */
export const INLINE_FORM_SLOT_ID = 'inline-form-slot';

/**
 * Placeholder rendered near the top of a page (right below the toolbar) into
 * which any open {@link InlineFormPanel} on that page portals itself. Keeping
 * the markup of the form where it logically lives while displaying it at the
 * top of the page avoids relocating large form blocks.
 */
export function InlineFormSlot({ id = INLINE_FORM_SLOT_ID, className }: { id?: string; className?: string }) {
  return <div id={id} className={className} />;
}

export interface InlineFormPanelProps {
  /** Whether the inline form is visible. */
  open: boolean;
  /** Called when the user dismisses the form (close button). */
  onClose: () => void;
  /** Header title. */
  title: string;
  /** Optional muted sub-title shown under the title. */
  description?: string;
  /** Optional leading icon shown in the header badge. */
  icon?: LucideIcon;
  /** Tailwind classes for the icon glyph color (e.g. "text-primary"). */
  iconClassName?: string;
  /** Tailwind classes for the icon badge background (e.g. "bg-primary/15"). */
  iconWrapClassName?: string;
  /** Optional footer node (typically action buttons). Rendered in a bordered footer bar. */
  footer?: React.ReactNode;
  /** Optional max-width / layout utility class for the panel wrapper. */
  className?: string;
  /** Body container className override. */
  bodyClassName?: string;
  /** Target slot id to portal into (defaults to the page's InlineFormSlot). */
  slotId?: string;
  children: React.ReactNode;
}

/**
 * InlineFormPanel — a centered MODAL popup create/edit form.
 *
 * (Name kept for backward compatibility — it is used by ~19 views across every
 * module.) Renders as a centered dialog over a dimmed backdrop, portalled to
 * <body>, so every add/edit form across the platform opens as a pop-up instead
 * of expanding inline in the page. Closes on backdrop click or Escape.
 *
 * The legacy `slotId` prop is accepted but ignored, and {@link InlineFormSlot}
 * is now a harmless no-op, so existing callers keep working unchanged.
 */
export function InlineFormPanel({
  open,
  onClose,
  title,
  description,
  icon: Icon,
  iconClassName = 'text-primary',
  iconWrapClassName = 'bg-primary/15',
  footer,
  className,
  bodyClassName,
  children,
}: InlineFormPanelProps) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  // Close on Escape while open.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const modal = (
    <AnimatePresence>
      {open && (
        <motion.div
          data-inline-form-panel
          // `pointer-events-auto` is essential: when this panel opens over a modal
          // Radix Dialog/Sheet, that dialog sets `pointer-events: none` on <body>.
          // Since this panel portals to <body> (outside the dialog's layer), it would
          // otherwise inherit `none`, making the whole form un-clickable — clicks would
          // fall through to the dialog's overlay and dismiss it, taking this form away.
          className="pointer-events-auto fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto p-4 sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />
          {/* Centered dialog card */}
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            onClick={(e) => e.stopPropagation()}
            // Uniform large, near-full-window size for EVERY add/edit form across the app.
            // The trailing `max-w-6xl` wins over any per-call width so all popups match.
            className={cn('relative z-10 my-auto w-[95vw]', className, 'max-w-6xl')}
          >
            <div className="border rounded-2xl bg-card shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/20">
                <div className="flex items-center gap-2">
                  {Icon && (
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', iconWrapClassName)}>
                      <Icon size={14} className={iconClassName} />
                    </div>
                  )}
                  <div>
                    <p className="text-sm font-semibold">{title}</p>
                    {description && <p className="text-[11px] text-muted-foreground">{description}</p>}
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                  <X size={14} />
                </Button>
              </div>

              {/* Body */}
              <div className={cn('p-5 sm:p-6 flex flex-col gap-5 max-h-[82vh] overflow-y-auto', bodyClassName)}>
                {children}
              </div>

              {/* Footer */}
              {footer && (
                <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t bg-muted/20">
                  {footer}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (!mounted) return null;
  return createPortal(modal, document.body);
}
