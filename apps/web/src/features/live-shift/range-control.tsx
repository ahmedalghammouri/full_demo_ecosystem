'use client';
/**
 * The per-widget range control, and the frame every widget on the live page wears.
 *
 * ── Why the control is per widget rather than per page ──────────────────────
 * A live screen is read at two ranges at once. "Is the line healthy?" is a whole
 * shift question; "why did it just drop?" is a last-fifteen-minutes question. A
 * single page-level control forces the reader to keep flipping and to hold the
 * other view in their head. Each widget carries its own, and each says which
 * range it is on, so two panels showing different numbers is never a mystery —
 * the range is printed on both.
 *
 * ── Why the range is a closed set ───────────────────────────────────────────
 * Every option is a TAIL of the current shift. This page is about now; an
 * arbitrary date pair turns it into the analysis page, which already exists and
 * does that job with a proper filter. The server clamps each tail to the shift
 * start, so no widget here can show a minute belonging to the previous shift.
 */
import React from 'react';

import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/datetime';

/** The keys the API accepts. Order is longest → shortest, as a reader scans. */
export const RANGES = [
  { key: 'shift', short: 'Shift', label: 'Whole shift' },
  { key: '120', short: '2h', label: 'Last 2 hours' },
  { key: '60', short: '1h', label: 'Last hour' },
  { key: '30', short: '30m', label: 'Last 30 min' },
  { key: '15', short: '15m', label: 'Last 15 min' },
] as const;

export type RangeKey = (typeof RANGES)[number]['key'];

export function RangeControl({
  value, onChange, disabled,
}: { value: RangeKey; onChange: (v: RangeKey) => void; disabled?: boolean }) {
  return (
    <div
      role="group"
      aria-label="Time range for this panel"
      className="inline-flex shrink-0 rounded-md border border-border/60 p-0.5"
    >
      {RANGES.map((r) => {
        const active = r.key === value;
        return (
          <button
            key={r.key}
            type="button"
            disabled={disabled}
            onClick={() => onChange(r.key)}
            title={r.label}
            aria-pressed={active}
            className={cn(
              'px-2 py-0.5 text-[11px] font-medium rounded transition-colors tabular-nums',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              active
                ? 'bg-primary/15 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            )}
          >
            {r.short}
          </button>
        );
      })}
    </div>
  );
}

export interface WindowInfo {
  from: string;
  to: string;
  minutes: number;
  label: string;
  /** The shift is younger than the tail asked for, so the window was truncated. */
  clamped: boolean;
}

// Factory time, via lib/datetime — not `.toLocaleTimeString([], ...)`, which
// reads both the runtime's default locale AND the runtime's local timezone,
// two different clocks on the server and the browser for the same instant
// (React error #418).
const clock = (iso: string | undefined) => (iso ? formatTime(iso) : '—');

/**
 * A widget: title, its own range control, and — always — the window it is
 * actually showing.
 *
 * The window line is not decoration. Two panels side by side on different ranges
 * will disagree, and they are SUPPOSED to; printing the span under each is what
 * turns that from a bug report into a comparison. When the server truncated the
 * request because the shift is young, it says so rather than quietly showing 20
 * minutes under a heading that says "last hour".
 */
export function Panel({
  title, hint, range, onRange, window: win, loading, right, children, className,
}: {
  title: string;
  hint?: string;
  range: RangeKey;
  onRange: (v: RangeKey) => void;
  window?: WindowInfo | null;
  loading?: boolean;
  right?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-lg border border-border/60 bg-card', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-3 py-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {win ? (
              <>
                <span className="tabular-nums">{clock(win.from)} → {clock(win.to)}</span>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{win.minutes} min</span>
                {win.clamped && (
                  <span
                    className="rounded bg-amber-500/15 px-1 text-amber-600 dark:text-amber-400"
                    title={`The shift is only ${win.minutes} minutes old, so "${win.label}" was truncated to the shift start rather than reaching into the previous shift.`}
                  >
                    truncated to shift start
                  </span>
                )}
              </>
            ) : (
              <span>{hint ?? '—'}</span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {right}
          <RangeControl value={range} onChange={onRange} disabled={loading} />
        </div>
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}
