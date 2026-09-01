'use client';

import React from 'react';

import { cn } from '@/lib/utils';

/**
 * The tab strip every analytical page uses.
 *
 * ── Why one component ───────────────────────────────────────────────────────
 * Three surfaces had three different tab treatments: pill buttons on the
 * analysis page, a shadcn segmented control on the breakdown, and a third strip
 * inside the tabbed page shell. Same gesture, three looks, and none of them
 * carried the keyboard behaviour a tab strip is supposed to have — arrow keys
 * did nothing, so the whole navigation of a nine-tab page was mouse-only.
 *
 * ── What "professional" means here, concretely ──────────────────────────────
 * A tab is a *selector*, not a button: it should read as a position in a set,
 * not as an action. So the active tab is marked by an underline continuous with
 * the strip's own rule rather than by a filled box — the eye follows one line
 * and finds the current position on it. Weight carries the state as well as
 * colour, so it survives a colourblind reader and a bad projector.
 *
 * The strip scrolls horizontally rather than wrapping: nine wrapped tabs become
 * two ragged rows that move when the labels change, and a reader loses their
 * place between visits. Scrolling keeps one row and one order, and the selected
 * tab is scrolled back into view whenever it changes.
 *
 * Keyboard follows the WAI-ARIA tabs pattern: arrows move between tabs, Home
 * and End jump to the ends, disabled tabs are skipped. Focus is visible.
 */

export interface PageTab {
  key: string;
  label: string;
  /** Long-form explanation. Shown as the native tooltip. */
  blurb?: string;
  icon?: React.ElementType;
  /** A count shown after the label — rows behind the tab, usually. */
  count?: number;
  /** A tab that exists but is not built yet reads as present-and-pending. */
  disabled?: boolean;
}

export interface PageTabsProps {
  tabs: readonly PageTab[];
  value: string;
  onChange: (key: string) => void;
  /** Names the strip for a screen reader. */
  label?: string;
  className?: string;
}

export function PageTabs({ tabs, value, onChange, label = 'Views', className }: PageTabsProps) {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});

  // Keep the selected tab visible. With nine tabs on a narrow window the active
  // one is often scrolled off, and a strip whose current position is invisible
  // is worse than no strip at all.
  React.useEffect(() => {
    refs.current[value]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [value]);

  const enabled = tabs.filter((t) => !t.disabled);

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = enabled.findIndex((t) => t.key === value);
    if (i === -1) return;
    let next: PageTab | undefined;
    if (e.key === 'ArrowRight') next = enabled[(i + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    else return;
    e.preventDefault();
    if (next) {
      onChange(next.key);
      refs.current[next.key]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        'flex items-stretch gap-1 overflow-x-auto border-b border-border/60',
        // The strip scrolls; the page must not.
        '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {tabs.map((t) => {
        const active = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            ref={(el) => { refs.current[t.key] = el; }}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={t.disabled}
            // Only the selected tab is in the tab order; arrows move within the
            // strip. Otherwise a nine-tab page costs nine tabs to walk past.
            tabIndex={active ? 0 : -1}
            title={t.blurb ? (t.disabled ? `${t.blurb} — not built yet` : t.blurb) : undefined}
            onClick={() => !t.disabled && onChange(t.key)}
            className={cn(
              'relative inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3 py-2 text-xs',
              'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              'focus-visible:rounded-sm focus-visible:ring-offset-1 focus-visible:ring-offset-background',
              // The underline sits ON the strip's rule, so the two read as one line.
              'after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full',
              t.disabled
                ? 'cursor-not-allowed text-muted-foreground/40 after:bg-transparent'
                : active
                  ? 'font-semibold text-foreground after:bg-primary'
                  : 'text-muted-foreground after:bg-transparent hover:text-foreground hover:after:bg-border',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />}
            {t.label}
            {t.count != null && (
              <span
                className={cn(
                  'ms-0.5 rounded px-1 text-[10px] tabular-nums',
                  active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
