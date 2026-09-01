'use client';
/**
 * A machine's state history as a horizontal strip.
 *
 * Shared by the Machine Status page and the shop-floor job-order view so the two
 * cannot drift apart — they are drawing the same records and must agree.
 *
 * ── Why segments are positioned absolutely ──────────────────────────────────
 * The first version laid the bands out in a flex row, each sized as a
 * percentage of the window. That silently CLOSES gaps: a machine that reported
 * nothing for an hour had its neighbouring bands stretch across the hole, so a
 * signal outage looked exactly like uninterrupted running. Positioning each
 * band at its real offset leaves the gap visible, which is the honest picture —
 * "no data" is a fact worth seeing, not something to paper over.
 *
 * A period still open is drawn to the end of the window; the tooltip says "now"
 * rather than inventing an end time.
 */
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/** One colour per machine state. Kept here so every strip matches. */
export const STATE_COLORS: Record<string, string> = {
  RUNNING: '#22c55e',
  IDLE: '#64748b',
  STOPPED: '#94a3b8',
  BREAKDOWN: '#ef4444',
  PLANNED_STOP: '#3b82f6',
  MAINTENANCE: '#6366f1',
  SETUP: '#a855f7',
  CHANGEOVER: '#a855f7',
  STARVED: '#f59e0b',
  BLOCKED: '#fb923c',
  OFFLINE: '#475569',
};

export interface StateSegmentLike {
  id?: string;
  state: string;
  startTime: string | Date;
  /** null / undefined = still open. */
  endTime?: string | Date | null;
  cause?: string | null;
  downtimeCause?: { name?: string } | null;
}

const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const fmtMins = (m: number) => {
  if (m < 1) return '<1m';
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  return h > 0 ? `${h}h ${r}m` : `${r}m`;
};

export function StateTimelineStrip({
  segments,
  windowStart,
  windowEnd,
  height = 'h-7',
  showAxis = true,
  showLegend = true,
}: {
  segments: StateSegmentLike[];
  windowStart: string | Date;
  windowEnd?: string | Date | null;
  height?: string;
  showAxis?: boolean;
  showLegend?: boolean;
}) {
  const { t } = useTranslation('production');

  const start = new Date(windowStart).getTime();
  const end = windowEnd ? new Date(windowEnd).getTime() : Date.now();
  const span = Math.max(1, end - start);

  const bands = useMemo(() => (segments ?? [])
    .map((s, i) => {
      const rawStart = new Date(s.startTime).getTime();
      const rawEnd = s.endTime ? new Date(s.endTime).getTime() : end;
      const from = Math.max(start, rawStart);
      const to = Math.min(end, rawEnd);
      if (!(to > from)) return null; // wholly outside the window

      const minutes = (to - from) / 60_000;
      const cause = s.cause ?? s.downtimeCause?.name ?? null;
      return {
        key: s.id ?? `seg-${i}`,
        left: ((from - start) / span) * 100,
        // A floor so a very short state is still visible; without it a
        // one-second breakdown renders as nothing at all.
        width: Math.max(0.25, ((to - from) / span) * 100),
        state: s.state,
        title:
          `${s.state}${cause ? ` — ${cause}` : ''}\n` +
          `${fmtTime(new Date(from))} → ${s.endTime ? fmtTime(new Date(to)) : t('jolive.now')}` +
          ` (${fmtMins(minutes)})`,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b !== null),
  [segments, start, end, span, t]);

  const statesPresent = useMemo(
    () => [...new Set(bands.map((b) => b.state))],
    [bands],
  );

  return (
    <div>
      <div className={`relative ${height} rounded-lg overflow-hidden border border-border/40 bg-muted/30`}>
        {bands.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
            {t('jolive.noStateRecords')}
          </div>
        )}
        {bands.map((b) => (
          <div
            key={b.key}
            className="absolute top-0 h-full"
            style={{
              left: `${b.left}%`,
              width: `${b.width}%`,
              backgroundColor: STATE_COLORS[b.state] ?? '#64748b',
            }}
            title={b.title}
          />
        ))}
      </div>

      {showAxis && (
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 font-mono">
          <span>{fmtTime(new Date(start))}</span>
          <span>{windowEnd ? fmtTime(new Date(end)) : t('jolive.now')}</span>
        </div>
      )}

      {showLegend && statesPresent.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap mt-2">
          {statesPresent.map((state) => (
            <span key={state} className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: STATE_COLORS[state] ?? '#64748b' }} />
              {state}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
