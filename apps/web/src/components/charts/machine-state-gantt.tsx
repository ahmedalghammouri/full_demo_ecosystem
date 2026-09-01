'use client';
/**
 * Machine state timeline — a zoomable Gantt of what every machine was doing.
 *
 * ── Form ────────────────────────────────────────────────────────────────────
 * The data's job is IDENTITY OVER TIME: which state, for how long, on which
 * machine. That is a state-band chart, not a bar or a line — duration is the
 * mark's length and the category is its fill.
 *
 * ── Colour ──────────────────────────────────────────────────────────────────
 * These are STATUS colours, not a categorical series: they encode what a state
 * MEANS, so eleven machine states fold into five roles the plant actually acts
 * on. Folding is deliberate — a reader needs "was it producing / whose fault
 * was it" at a glance, and the exact state is one hover away.
 *
 *   producing   green    RUNNING
 *   own loss    red      BREAKDOWN, STOPPED
 *   external    amber    STARVED, BLOCKED          (someone else's constraint)
 *   planned     blue     PLANNED_STOP, MAINTENANCE, SETUP, CHANGEOVER
 *   idle        neutral  IDLE, OFFLINE
 *
 * Both modes were validated with the palette checker at `--pairs all`, because
 * any two states can end up adjacent on a row:
 *
 *   light  #008300 #e34948 #eda100 #2a78d6 → PASS (CVD ΔE 7.2, normal 20.8)
 *   dark   #008300 #d9534f #c08a00 #3987e5 → PASS (CVD ΔE 7.1, normal 15.5)
 *
 * Both sit in the 6–8 CVD band, which is legal ONLY with secondary encoding, so
 * this chart ships all of it and not as decoration: a permanent legend, 2px
 * surface gaps between touching bands, direct labels inside bands wide enough to
 * hold them, and a texture toggle for colour-vision-deficient and print readers.
 * Remove those and the palette is no longer defensible.
 *
 * ── Zoom ────────────────────────────────────────────────────────────────────
 * Zoom narrows the visible WINDOW and re-renders against it, rather than CSS-
 * scaling the drawn result. Scaling would blur the labels and thicken the 2px
 * gaps into blobs; recomputing keeps every mark and every tick crisp at any
 * depth, and lets the axis change granularity as the span shrinks.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomIn, ZoomOut, RotateCcw, ChevronLeft, ChevronRight, Baseline } from 'lucide-react';

import { cn } from '@/lib/utils';
import { followingEdge, nowMarkerPct } from './now-marker';

// ── Status roles ────────────────────────────────────────────────────────────

export type StateRole = 'producing' | 'ownLoss' | 'external' | 'planned' | 'idle';

const STATE_ROLE: Record<string, StateRole> = {
  RUNNING: 'producing',
  // What the SCHEDULE calls a producing block. The plan track has no sensor
  // behind it, so it says PRODUCTION where the machine says RUNNING; without
  // this line every scheduled production block fell through to `idle` and the
  // plan track drew a plant that intended to do nothing all day.
  PRODUCTION: 'producing',
  BREAKDOWN: 'ownLoss',
  STOPPED: 'ownLoss',
  STARVED: 'external',
  BLOCKED: 'external',
  PLANNED_STOP: 'planned',
  MAINTENANCE: 'planned',
  SETUP: 'planned',
  CHANGEOVER: 'planned',
  IDLE: 'idle',
  OFFLINE: 'idle',
};

export const roleOf = (state: string): StateRole => STATE_ROLE[state] ?? 'idle';

/** Role → CSS custom property. Values live in the style block below. */
const ROLE_VAR: Record<StateRole, string> = {
  producing: 'var(--st-producing)',
  ownLoss: 'var(--st-own-loss)',
  external: 'var(--st-external)',
  planned: 'var(--st-planned)',
  idle: 'var(--st-idle)',
};

/** Texture angle per role — the accessibility channel, off unless asked for. */
const ROLE_TEXTURE: Record<StateRole, string> = {
  producing: 'none',
  ownLoss: '45deg',
  external: '135deg',
  planned: '45deg',
  idle: 'none',
};

export interface GanttSegment {
  id?: string;
  state: string;
  startTime: string | Date;
  endTime?: string | Date | null;
  cause?: string | null;
  /**
   * What the block IS, when the plant named it.
   *
   * Cleaning, a meal break and a shift handover are all PLANNED_STOP, so
   * drawing the state made three different activities one indistinguishable
   * band that answered no question a reader had. When the schedule supplied a
   * name, it is shown instead; the state is still in the tooltip.
   */
  label?: string;
}

/** What the tooltip shows about one band, including WHICH track it came from. */
interface Hover {
  x: number; y: number;
  state: string;
  /** The plant's name for the block, when it had one. */
  title?: string;
  cause?: string | null;
  from: number; to: number;
  row: string;
  /** Schedule or Machine — the two accounts a stacked row invites comparing. */
  track?: string;
}

export interface GanttRow {
  id: string;
  label: string;
  sublabel?: string;
  segments: GanttSegment[];
  /**
   * The SCHEDULE for the same machine and the same window — what the plant
   * intended, drawn as a second band directly above the state band.
   *
   * Two tracks rather than one, because they answer different questions and
   * merging them would settle by force an argument the reader is here to have:
   * "we planned to run until ten and clean until eleven" over "the line was
   * down from half seven" is the comparison a shift review is FOR. One merged
   * band would have to pick which account wins per minute, and the picking is
   * the very thing being examined.
   *
   * Absent for a row with no schedule, and then only one band draws — an empty
   * second track would imply the plant planned nothing.
   */
  planSegments?: GanttSegment[];
  /** Optional right-aligned summary, e.g. "99.7% · 13h 34m". */
  meta?: string;
}

// ── Time helpers ────────────────────────────────────────────────────────────

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const fmtClock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const fmtDate = (t: number) =>
  new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

const fmtDur = (ms: number) => {
  const m = ms / MIN;
  if (m < 1) return `${Math.round(ms / 1000)}s`;
  if (m < 60) return `${Math.round(m)}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${Math.round(m % 60)}m`;
};

/**
 * Axis ticks at a round interval for the visible span.
 *
 * Stepping through round units rather than dividing the span into n parts is
 * what makes a zoomed axis readable: labels land on 10:00 and 10:15, never on
 * 10:07:23.
 */
function ticksFor(from: number, to: number, width: number) {
  const span = to - from;
  const target = Math.max(3, Math.floor(width / 110)); // ~110px per label
  const steps = [
    MIN, 2 * MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN,
    HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
    DAY, 2 * DAY, 7 * DAY,
  ];
  const step = steps.find((s) => span / s <= target) ?? DAY * 30;

  // Anchor to the local calendar so ticks fall on real clock boundaries.
  const first = new Date(from);
  if (step >= DAY) first.setHours(0, 0, 0, 0);
  else if (step >= HOUR) first.setMinutes(0, 0, 0);
  else first.setSeconds(0, 0);

  const out: Array<{ t: number; label: string; major: boolean }> = [];
  for (let t = first.getTime(); t <= to; t += step) {
    if (t < from) continue;
    const d = new Date(t);
    const midnight = d.getHours() === 0 && d.getMinutes() === 0;
    out.push({
      t,
      label: step >= DAY || midnight ? fmtDate(t) : fmtClock(t),
      major: midnight || step >= DAY,
    });
  }
  return out;
}

// ── Component ───────────────────────────────────────────────────────────────

export function MachineStateGantt({
  rows,
  windowStart,
  windowEnd,
  follow = false,
  className,
}: {
  rows: GanttRow[];
  windowStart: string | Date | number;
  windowEnd: string | Date | number;
  /**
   * The chart is showing a window that ENDS AT NOW, so the right edge should
   * track the clock rather than the instant the data was fetched.
   *
   * Without this the "now" marker is unreachable on a live screen: `windowEnd`
   * is frozen at fetch time, real time walks past it within seconds, and the
   * marker -- which only draws inside the view -- silently stops being drawn.
   * A ticking clock ALONE makes that worse, not better, because it moves `now`
   * past the fixed edge sooner. Both halves are needed or neither works.
   */
  follow?: boolean;
  className?: string;
}) {
  const { t } = useTranslation(['production', 'common']);

  const rawFrom = new Date(windowStart).getTime();
  const rawTo = new Date(windowEnd).getTime();

  /**
   * The clock this chart draws its "now" marker against.
   *
   * Zero until mounted, deliberately: reading a clock during a server render
   * and again on the client is a hydration mismatch by construction, and this
   * component has paid for that before. The marker simply does not draw until
   * the first tick, which is a frame away.
   */
  const [nowTs, setNowTs] = useState(0);
  useEffect(() => {
    setNowTs(Date.now());
    // Thirty seconds. The bands are minute-grained, so a faster tick would
    // re-render the whole chart to move a line by less than a pixel.
    const id = setInterval(() => setNowTs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const fullFrom = rawFrom;
  const fullTo = followingEdge(rawTo, nowTs, follow);
  const fullSpan = Math.max(MIN, fullTo - fullFrom);

  // The visible window. Zoom and pan move THIS, and everything re-renders
  // against it — no transform, so text and the 2px gaps stay exact.
  const [view, setView] = useState({ from: rawFrom, to: rawTo });

  /**
   * Whether the reader has taken hold of the view.
   *
   * Following the clock must never yank a window somebody is reading. Once
   * they zoom or pan, the right edge stops advancing until they press reset or
   * change the date filter.
   */
  const [pinned, setPinned] = useState(false);
  const [textured, setTextured] = useState(false);
  const [hover, setHover] = useState<Hover | null>(null);

  const plotRef = useRef<HTMLDivElement>(null);
  const [plotWidth, setPlotWidth] = useState(800);

  // Re-fit when the caller's window changes (a new date filter, say). Keyed on
  // the RAW window: keying it on fullTo would re-fit every tick and undo a zoom.
  useEffect(() => {
    setView({ from: rawFrom, to: rawTo });
    setPinned(false);
  }, [rawFrom, rawTo]);

  // While following and untouched, the right edge walks with the clock.
  useEffect(() => {
    if (!follow || pinned) return;
    setView((v) => (v.to === fullTo && v.from === fullFrom ? v : { from: fullFrom, to: fullTo }));
  }, [follow, pinned, fullFrom, fullTo]);

  useEffect(() => {
    const el = plotRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setPlotWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const span = Math.max(MIN, view.to - view.from);
  const zoomed = span < fullSpan - 1000;

  /** Clamp any proposed window to the data and to a one-minute floor. */
  const clamp = useCallback((from: number, to: number) => {
    let s = Math.max(MIN, to - from);
    if (s > fullSpan) s = fullSpan;
    let f = from;
    if (f < fullFrom) f = fullFrom;
    if (f + s > fullTo) f = fullTo - s;
    return { from: f, to: f + s };
  }, [fullFrom, fullTo, fullSpan]);

  /** Zoom about a fixed point so what is under the pointer stays under it. */
  const zoomAt = useCallback((factor: number, anchorRatio = 0.5) => {
    setPinned(true);
    setView((v) => {
      const s = v.to - v.from;
      const anchor = v.from + s * anchorRatio;
      const next = s * factor;
      return clamp(anchor - next * anchorRatio, anchor + next * (1 - anchorRatio));
    });
  }, [clamp]);

  const pan = useCallback((fraction: number) => {
    setPinned(true);
    setView((v) => {
      const s = v.to - v.from;
      return clamp(v.from + s * fraction, v.to + s * fraction);
    });
  }, [clamp]);

  const reset = useCallback(() => {
    setPinned(false);
    setView({ from: fullFrom, to: fullTo });
  }, [fullFrom, fullTo]);

  // Wheel zoom, anchored at the pointer. Non-passive so the page does not
  // scroll away underneath the gesture.
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      zoomAt(e.deltaY > 0 ? 1.25 : 0.8, ratio);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // Drag to pan.
  const drag = useRef<{ x: number; from: number; to: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    setPinned(true);
    drag.current = { x: e.clientX, from: view.from, to: view.to };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !plotRef.current) return;
    const w = plotRef.current.getBoundingClientRect().width || 1;
    const shift = ((d.x - e.clientX) / w) * (d.to - d.from);
    setView(clamp(d.from + shift, d.to + shift));
  };
  const endDrag = () => { drag.current = null; };

  const ticks = useMemo(() => ticksFor(view.from, view.to, plotWidth), [view.from, view.to, plotWidth]);

  const nowPct = nowMarkerPct(nowTs, view.from, view.to);

  const rolesPresent = useMemo(() => {
    const set = new Set<StateRole>();
    // Both tracks, because both are drawn. A legend built from the state track
    // alone would omit the one role the plan track can introduce on its own --
    // a scheduled stop on a machine whose sensor never reported one.
    for (const r of rows) {
      for (const s of r.segments) set.add(roleOf(s.state));
      for (const s of r.planSegments ?? []) set.add(roleOf(s.state));
    }
    return [...set];
  }, [rows]);

  /** Any row carrying a schedule — decides whether the legend explains stacking. */
  const anyPlan = useMemo(() => rows.some((r) => (r.planSegments?.length ?? 0) > 0), [rows]);

  return (
    <div className={cn('viz-gantt', className)}>
      <style jsx>{`
        .viz-gantt {
          --st-producing: #008300;
          --st-own-loss: #e34948;
          --st-external: #eda100;
          --st-planned: #2a78d6;
          --st-idle: #8a8a85;
          --st-surface: hsl(var(--card));
          --st-grid: hsl(var(--border));
        }
        @media (prefers-color-scheme: dark) {
          :global(:root:not([data-theme='light'])) .viz-gantt {
            --st-own-loss: #d9534f;
            --st-external: #c08a00;
            --st-planned: #3987e5;
            --st-idle: #6f6f6a;
          }
        }
        :global(:root[data-theme='dark']) .viz-gantt {
          --st-own-loss: #d9534f;
          --st-external: #c08a00;
          --st-planned: #3987e5;
          --st-idle: #6f6f6a;
        }
      `}</style>

      {/* Controls — one row, above the plot. */}
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="text-[11px] text-muted-foreground font-mono">
          {fmtDate(view.from)} {fmtClock(view.from)} → {fmtDate(view.to)} {fmtClock(view.to)}
          {zoomed && <span className="ms-2 text-primary">{t('gantt.zoomed')}</span>}
        </div>
        <div className="flex items-center gap-1">
          <IconBtn onClick={() => pan(-0.25)} label={t('gantt.panLeft')}><ChevronLeft size={15} /></IconBtn>
          <IconBtn onClick={() => zoomAt(0.6)} label={t('gantt.zoomIn')}><ZoomIn size={15} /></IconBtn>
          <IconBtn onClick={() => zoomAt(1.7)} label={t('gantt.zoomOut')} disabled={!zoomed}><ZoomOut size={15} /></IconBtn>
          <IconBtn onClick={() => pan(0.25)} label={t('gantt.panRight')}><ChevronRight size={15} /></IconBtn>
          <IconBtn onClick={reset} label={t('gantt.reset')} disabled={!zoomed}><RotateCcw size={15} /></IconBtn>
          <IconBtn onClick={() => setTextured((v) => !v)} label={t('gantt.texture')} active={textured}>
            <Baseline size={15} />
          </IconBtn>
        </div>
      </div>

      <div className="flex">
        {/* Row labels — outside the pan area so they never scroll away.
            The per-machine summary lives HERE rather than floating over the
            plot: sitting inside the row it landed on top of the band above it,
            which a visual check caught immediately. */}
        <div className="w-44 shrink-0 pe-3">
          <div className="h-5" />
          {rows.map((r) => (
            <div
              key={r.id}
              // Matches the plot side exactly. The label column and the bands
              // are two separate scroll areas, so a height computed differently
              // on each side makes the names drift out of step with the rows —
              // caught once already when a legend sat inside the plot.
              className={cn(
                'flex items-center justify-between gap-2',
                r.planSegments && r.planSegments.length > 0 ? 'h-16' : 'h-9',
              )}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{r.label}</div>
                {r.sublabel && <div className="text-[10px] text-muted-foreground truncate">{r.sublabel}</div>}
              </div>
              {r.meta && (
                <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
                  {r.meta}
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Plot */}
        <div className="flex-1 min-w-0">
          {/* Axis */}
          <div className="relative h-5 text-[10px] text-muted-foreground font-mono select-none">
            {ticks.map((tk) => (
              <span
                key={tk.t}
                className={cn('absolute -translate-x-1/2 whitespace-nowrap', tk.major && 'font-semibold text-foreground/70')}
                style={{ left: `${((tk.t - view.from) / span) * 100}%` }}
              >
                {tk.label}
              </span>
            ))}
          </div>

          <div
            ref={plotRef}
            className="relative cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onPointerLeave={() => { endDrag(); setHover(null); }}
          >
            {/* Recessive grid, drawn behind the marks. */}
            {ticks.map((tk) => (
              <div
                key={`g-${tk.t}`}
                className="absolute top-0 bottom-0 w-px pointer-events-none"
                style={{
                  left: `${((tk.t - view.from) / span) * 100}%`,
                  background: 'var(--st-grid)',
                  opacity: tk.major ? 0.5 : 0.25,
                }}
              />
            ))}

            {rows.map((r) => (
              <GanttRowBands
                key={r.id}
                row={r}
                from={view.from}
                to={view.to}
                span={span}
                textured={textured}
                onHover={setHover}
              />
            ))}

            {nowPct !== null && (
              <div
                className="absolute top-0 bottom-0 w-px pointer-events-none z-10"
                style={{ left: `${nowPct}%`, background: 'hsl(var(--primary))' }}
              >
                <span className="absolute -top-0.5 -translate-x-1/2 text-[9px] px-1 rounded bg-primary text-primary-foreground">
                  {t('gantt.now')}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Legend — always present, so identity is never colour alone. */}
      <div className="flex items-center gap-4 flex-wrap mt-4 pt-3 border-t border-border/40">
        {(['producing', 'ownLoss', 'external', 'planned', 'idle'] as StateRole[])
          .filter((role) => rolesPresent.includes(role))
          .map((role) => (
            <span key={role} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span
                className="w-3 h-3 rounded-sm"
                style={{
                  background: ROLE_VAR[role],
                  backgroundImage: textured && ROLE_TEXTURE[role] !== 'none'
                    ? `repeating-linear-gradient(${ROLE_TEXTURE[role]}, rgba(0,0,0,.35) 0 2px, transparent 2px 5px)`
                    : undefined,
                }}
              />
              {t(`gantt.role.${role}`)}
            </span>
          ))}
        {anyPlan && (
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="flex flex-col gap-0.5 shrink-0" aria-hidden>
              <span className="w-3 h-1 rounded-[1px] bg-foreground/30" />
              <span className="w-3 h-1.5 rounded-[1px] bg-foreground/60" />
            </span>
            {t('gantt.track.legend')}
          </span>
        )}
        <span className="text-[11px] text-muted-foreground/70 ms-auto">{t('gantt.hint')}</span>
      </div>

      {hover && (
        <div
          className="fixed z-50 pointer-events-none rounded-lg border border-border bg-card px-3 py-2 shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          {/* Value leads, label follows. */}
          <div className="text-sm font-semibold">{fmtDur(hover.to - hover.from)}</div>
          <div className="flex items-center gap-1.5 text-xs mt-0.5">
            <span className="w-4 h-0.5 rounded" style={{ background: ROLE_VAR[roleOf(hover.state)] }} />
            {/* The named activity leads; the raw state follows only when it
                adds something, so a block called Cleaning does not read
                "Cleaning · PLANNED_STOP". */}
            <span className="font-medium">{hover.title || hover.state}</span>
            {hover.title && hover.title !== hover.state && (
              <span className="text-muted-foreground font-mono text-[10px]">{hover.state}</span>
            )}
            {hover.cause && <span className="text-muted-foreground">· {hover.cause}</span>}
          </div>
          <div className="text-[11px] text-muted-foreground font-mono mt-1">
            {fmtClock(hover.from)} → {fmtClock(hover.to)}
          </div>
          {/* WHICH account this block is. Without it, a planned stop on the
              schedule and a planned stop the machine actually took produce an
              identical tooltip, which is exactly the confusion the two tracks
              exist to remove. */}
          <div className="text-[11px] text-muted-foreground">
            {hover.row}{hover.track ? ` · ${hover.track}` : ''}
          </div>
        </div>
      )}
    </div>
  );
}

interface Band {
  key: string;
  leftPct: number;
  widthPct: number;
  state: string;
  title: string;
  role: StateRole;
  cause: string | null;
  from: number;
  to: number;
  showLabel: boolean;
}

/**
 * Segments to drawable bands, clipped to the visible window.
 *
 * Shared by both tracks so the plan and the state are laid out by ONE piece of
 * geometry. Two copies would drift, and the whole point of stacking the tracks
 * is that a reader can drop a vertical line through them: 09:40 on the plan has
 * to be 09:40 on the machine, to the pixel.
 */
function toBands(
  segments: GanttSegment[], rowId: string, from: number, to: number, span: number, prefix: string,
): Band[] {
  const out: Band[] = [];
  segments.forEach((s, i) => {
    const rawFrom = new Date(s.startTime).getTime();
    const rawTo = s.endTime ? new Date(s.endTime).getTime() : to;
    const a = Math.max(from, rawFrom);
    const b = Math.min(to, rawTo);
    if (!(b > a)) return;
    const widthPct = ((b - a) / span) * 100;
    out.push({
      key: s.id ?? `${prefix}${rowId}-${i}`,
      leftPct: ((a - from) / span) * 100,
      widthPct,
      state: s.state,
      // Prefer the plant's own name for the block; fall back to the machine's
      // word for it when nothing named it.
      title: s.label || s.state,
      role: roleOf(s.state),
      cause: s.cause ?? null,
      from: a,
      to: b,
      // Direct-label the EXCEPTIONS only, and only where the text genuinely
      // fits. Repeating RUNNING across a row is noise, while the stops are what
      // a reader is actually hunting for — and labelling them is where the
      // palette's required secondary encoding does real work.
      showLabel: widthPct > 7 && roleOf(s.state) !== 'producing',
    });
  });
  return out;
}

/**
 * One machine's row: the schedule on top, what the machine actually did below.
 *
 * Two tracks over ONE time axis is the comparison the row exists to make. It is
 * left as a comparison rather than resolved into a single merged band, because
 * resolving it means choosing per minute whose account of that minute is true —
 * and when the plan says cleaning and the sensor says breakdown, that choice is
 * the finding, not a rendering detail.
 */
function GanttRowBands({
  row, from, to, span, textured, onHover,
}: {
  row: GanttRow;
  from: number; to: number; span: number;
  textured: boolean;
  onHover: (h: Hover | null) => void;
}) {
  const { t } = useTranslation('production');

  const bands = useMemo(
    () => toBands(row.segments, row.id, from, to, span, 's-'),
    [row.segments, row.id, from, to, span],
  );
  const planBands = useMemo(
    () => toBands(row.planSegments ?? [], row.id, from, to, span, 'p-'),
    [row.planSegments, row.id, from, to, span],
  );
  // Presence of a SCHEDULE decides the shape, not presence of bands inside the
  // current zoom: a row that keeps its second track only while something is
  // visible would change height as the reader pans, and the label column --
  // which sizes itself from the same test -- would fall out of step.
  const twoTrack = (row.planSegments?.length ?? 0) > 0;

  const track = (
    list: Band[], height: string, trackLabel: string, emptyMessage: string | null,
  ) => (
    <div className={cn('relative w-full rounded-md overflow-hidden bg-muted/25', height)}>
      {list.length === 0 && emptyMessage && (
        <span className="absolute inset-0 flex items-center justify-center text-[10px] text-muted-foreground">
          {emptyMessage}
        </span>
      )}
      {list.map((b) => (
        <div
          key={b.key}
          role="img"
          aria-label={`${row.label} ${trackLabel} ${b.title} ${fmtClock(b.from)} ${fmtDur(b.to - b.from)}`}
          tabIndex={0}
          className="absolute top-0 h-full transition-[filter] hover:brightness-110 focus:brightness-110 focus:outline-none"
          style={{
            left: `${b.leftPct}%`,
            // The 2px surface gap that separates touching marks. Taken off the
            // width rather than drawn as a border — a border would be ink the
            // reader has to discount.
            width: `calc(${b.widthPct}% - 2px)`,
            minWidth: 2,
            background: ROLE_VAR[b.role],
            backgroundImage: textured && ROLE_TEXTURE[b.role] !== 'none'
              ? `repeating-linear-gradient(${ROLE_TEXTURE[b.role]}, rgba(0,0,0,.35) 0 3px, transparent 3px 7px)`
              : undefined,
          }}
          onPointerMove={(e) => onHover({
            x: e.clientX, y: e.clientY, state: b.state, title: b.title, cause: b.cause,
            from: b.from, to: b.to, row: row.label, track: trackLabel,
          })}
          onFocus={(e) => {
            const r = (e.target as HTMLElement).getBoundingClientRect();
            onHover({
              x: r.left, y: r.top, state: b.state, title: b.title, cause: b.cause,
              from: b.from, to: b.to, row: row.label, track: trackLabel,
            });
          }}
          onBlur={() => onHover(null)}
        >
          {b.showLabel && (
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-medium text-white/95 pointer-events-none px-1 truncate">
              {/* The activity, not the state. Three PLANNED_STOP bands that
                  are cleaning, lunch and a handover read as one thing until
                  they carry their own names. */}
              {b.title}
            </span>
          )}
        </div>
      ))}
    </div>
  );

  if (!twoTrack) {
    return (
      <div className="relative h-9 flex items-center">
        {track(bands, 'h-6', t('gantt.track.actual'), t('gantt.noData'))}
      </div>
    );
  }

  return (
    // h-16 here and in the label column, from the same test. The two are
    // separate stacking contexts, so a height decided differently on each side
    // slides the machine names off their rows.
    <div className="relative h-16 flex flex-col justify-center gap-1">
      {/* The plan sits above the machine, because it comes first in time and in
          the argument: this is what we said we would do. Thinner, so the eye
          reads it as the annotation and the sensor's record as the subject.
          
          A GAP here means nothing was scheduled — an absence of intention, not
          an absence of data. That is why it stays blank and carries no
          empty-state text: the plan track used to fill every manned hour with
          green and so claimed the plant intended to run all week, which is an
          opening time rather than a schedule. */}
      {track(planBands, 'h-4', t('gantt.track.plan'), null)}
      {track(bands, 'h-6', t('gantt.track.actual'), t('gantt.noData'))}
    </div>
  );
}

function IconBtn({
  onClick, label, children, disabled, active,
}: {
  onClick: () => void; label: string; children: React.ReactNode; disabled?: boolean; active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'h-7 w-7 grid place-items-center rounded-md border transition-colors',
        active
          ? 'border-primary/50 bg-primary/10 text-primary'
          : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-border',
        disabled && 'opacity-40 pointer-events-none',
      )}
    >
      {children}
    </button>
  );
}
