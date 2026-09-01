'use client';
/**
 * The pieces every analysis on this page shares.
 *
 * Six analyses draw the same gauge and colour the same five kinds of time. Six
 * copies of that would drift the moment one was corrected — the same reason the
 * two engines share their minute classifier rather than each keeping one.
 *
 * What lives here is only what is genuinely common. A chart that appears once
 * stays in the panel that owns it.
 */
import React from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';

import { useDashboardPrefsStore } from '@/store/dashboard-prefs-store';
import { toDate, formatDateTime } from '@/lib/datetime';
import type { GanttRow, GanttSegment } from '@/components/charts/machine-state-gantt';

export type SegmentKind = 'running' | 'planned' | 'external' | 'downtime' | 'unmeasured';

/**
 * One block of a machine's timeline, as every timeline endpoint reports it.
 *
 * Declared once. Two panels had kept private copies of this interface with the
 * same fields, which is how a field added on the server reaches one chart and
 * not the other -- and the schedule track is exactly such a field.
 */
export interface TimelineSegment {
  machineId: string; machineCode: string; state: string;
  /** The plant's own name for the block, when the schedule supplied one. */
  label?: string;
  kind: SegmentKind; from: string; to: string; minutes: number;
}

/**
 * Timeline segments -> Gantt rows, with the schedule stacked above each machine.
 *
 * Both OEE panels draw the same rows from the same payload and differ only in
 * the one-line summary beside the machine name, so that difference is the only
 * thing they pass in. When they each built the rows themselves, one of them
 * gained the schedule track and the other did not.
 *
 * A machine present ONLY in the schedule still gets a row. Dropping it would
 * hide the case worth looking at hardest: time was booked, and nothing was
 * measured against it.
 */
export function toGanttRows(
  timeline: TimelineSegment[],
  plannedTimeline: TimelineSegment[] | undefined,
  machines: Array<{ key: string; label: string; sublabel?: string | null }>,
  meta: (segments: TimelineSegment[], machineId: string) => string,
): GanttRow[] {
  const rows = new Map<string, { code: string; segments: TimelineSegment[]; plan: TimelineSegment[] }>();
  const at = (id: string, code: string) => {
    let hit = rows.get(id);
    if (!hit) { hit = { code, segments: [], plan: [] }; rows.set(id, hit); }
    return hit;
  };
  for (const s of timeline) at(s.machineId, s.machineCode).segments.push(s);
  for (const s of plannedTimeline ?? []) at(s.machineId, s.machineCode).plan.push(s);

  const draw = (x: TimelineSegment): GanttSegment =>
    ({ state: x.state, label: x.label, startTime: x.from, endTime: x.to });

  return [...rows.entries()]
    .map(([id, v]) => {
      const m = machines.find((x) => x.key === id);
      return {
        id,
        label: m?.label ?? v.code,
        sublabel: m?.sublabel ?? undefined,
        meta: meta(v.segments, id),
        segments: v.segments.map(draw),
        // Undefined rather than an empty array: the chart reads the PRESENCE of
        // this field to decide the row's height, and an empty second track
        // would claim the plant scheduled nothing.
        planSegments: v.plan.length > 0 ? v.plan.map(draw) : undefined,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Status colours, reserved for state and never reused as a series hue.
 *
 * Every place these are used also prints a label, so state is never carried by
 * colour alone — which is what makes the chart readable to a colour-blind reader
 * and in print.
 */
export const STATUS = {
  good: 'hsl(142 62% 38%)',
  warn: 'hsl(38 92% 46%)',
  bad: 'hsl(0 72% 51%)',
  none: 'hsl(215 16% 60%)',
};

export const SEGMENT_COLOUR: Record<SegmentKind, string> = {
  running: STATUS.good,
  downtime: STATUS.bad,
  planned: 'hsl(215 20% 55%)',
  external: STATUS.warn,
  unmeasured: 'hsl(215 14% 78%)',
};

export const SEGMENT_LABEL: Record<SegmentKind, string> = {
  running: 'Running',
  downtime: 'Unplanned downtime',
  planned: 'Planned stop',
  external: 'Starved / blocked',
  unmeasured: 'Not reported',
};

/**
 * Where a reading turns from good to warning to bad.
 *
 * Constants for now, and deliberately printed under the gauge rather than
 * implied by its colour: a band nobody can read is a band nobody agreed to.
 * These belong in factory configuration — the reference sets them per machine —
 * and until they are, every plant is graded against somebody else's targets.
 */
export const BANDS: Record<string, { warn: number; good: number }> = {
  OEE: { warn: 60, good: 70 },
  Availability: { warn: 80, good: 90 },
  Performance: { warn: 80, good: 95 },
  Quality: { warn: 95, good: 99 },
  // TEEP is OEE against the whole calendar, so it is always the smaller number
  // and its bands have to be lower — grading it against OEE's would paint every
  // plant on earth red.
  TEEP: { warn: 25, good: 40 },
};

/**
 * A colour per machine state, fixed by the state itself.
 *
 * Assigned by IDENTITY, never by rank. On the downtime page the same colour ties
 * a Pareto bar to the blocks in the timeline beneath it, so if the colour moved
 * with the ranking, changing the filter would repaint both charts and the link
 * between them would silently point somewhere else.
 *
 * The plant's states are a closed set, so they are written out. Anything unknown
 * falls to a stable hash rather than to "the next colour", which would depend on
 * what else happened to be in the window.
 */
const STATE_SLOT: Record<string, number> = {
  BREAKDOWN: 8, IDLE: 4, STARVED: 2, BLOCKED: 5,
  SETUP: 7, CHANGEOVER: 1, PLANNED_STOP: 3, MAINTENANCE: 6,
  OFFLINE: 5, RUNNING: 6,
};

export function stateColour(state: string): string {
  const slot = STATE_SLOT[state];
  if (slot) return `var(--viz-${slot})`;
  // Stable across windows and filters: the same name always lands on the same
  // slot, which is the whole point.
  let h = 0;
  for (let i = 0; i < state.length; i++) h = (h * 31 + state.charCodeAt(i)) >>> 0;
  return `var(--viz-${(h % 8) + 1})`;
}

export function bandOf(label: string, v: number | null): keyof typeof STATUS {
  if (v == null) return 'none';
  const b = BANDS[label];
  if (!b) return 'none';
  if (v >= b.good) return 'good';
  if (v >= b.warn) return 'warn';
  return 'bad';
}

/** Minutes as a duration a shop floor reads: days, hours, minutes. */
export const dur = (m: number | null | undefined) => {
  if (m == null) return '—';
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), min = Math.round(m % 60);
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${min}m`].filter(Boolean).join(' ');
};

export const pctText = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);

/**
 * A semi-donut gauge.
 *
 * Two arcs and a label rather than a charting library: the shape is one sweep,
 * and a library would bring an axis system it has no use for. The value is
 * printed inside — the colour is the second encoding, never the only one.
 */
export function Gauge({
  label, value, onOpen,
}: { label: string; value: number | null; onOpen?: () => void }) {
  const colour = STATUS[bandOf(label, value)];
  const b = BANDS[label];

  // 180° sweep, 0% on the left.
  const R = 52, CX = 70, CY = 68, W = 13;
  const arc = (p: number) => {
    const a = Math.PI * (1 - Math.min(1, Math.max(0, p / 100)));
    return `${CX - R},${CY} A ${R} ${R} 0 0 1 ${CX + R * Math.cos(a)},${CY - R * Math.sin(a)}`;
  };

  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-3">
      <div className="flex items-start justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
        {onOpen && (
          <button onClick={onOpen} title={`Open the ${label} analysis`}
            className="rounded px-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">↗</button>
        )}
      </div>
      <svg viewBox="0 0 140 82" className="w-full" role="img"
        aria-label={`${label} ${value == null ? 'not available' : `${value.toFixed(1)} percent`}`}>
        <path d={`M ${arc(100)}`} fill="none" stroke="hsl(var(--muted))" strokeWidth={W} strokeLinecap="round" />
        {value != null && (
          <path d={`M ${arc(value)}`} fill="none" stroke={colour} strokeWidth={W} strokeLinecap="round" />
        )}
        <text x={CX} y={CY - 8} textAnchor="middle" className="fill-foreground"
          style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
          {value == null ? '—' : `${value.toFixed(1)}%`}
        </text>
      </svg>
      <span className="text-center text-[10px] text-muted-foreground">
        {b ? `warn ${b.warn}% · good ${b.good}%` : 'no band configured'}
      </span>
    </div>
  );
}

export interface TimeModelBar {
  key: string;
  minutes: number;
  pct: number;
  kind: 'base' | 'loss' | 'result';
}

/**
 * The time model as a descending waterfall.
 *
 * Losses are drawn right-aligned so each one visually cuts into the level above
 * it. The descent is then something you see rather than something you compute,
 * which is the only reason to draw it as bars at all instead of listing the
 * numbers.
 */
export function TimeModel({
  bars, labels,
}: { bars: TimeModelBar[]; labels: Record<string, string> }) {
  return (
    <div className="flex flex-col gap-1.5">
      {bars.map((b) => {
        const colour =
          b.kind === 'result' ? 'bg-emerald-600'
          : b.kind === 'loss' ? 'bg-amber-500'
          : 'bg-muted-foreground/30';
        return (
          <div key={b.key} className="grid grid-cols-[minmax(120px,240px)_1fr] items-center gap-3">
            <span className={`truncate text-xs ${b.kind === 'loss' ? 'text-muted-foreground' : 'font-medium'}`}
              title={labels[b.key] ?? b.key}>
              {labels[b.key] ?? b.key}
            </span>
            <div className={`flex items-center gap-2 ${b.kind === 'loss' ? 'flex-row-reverse' : ''}`}>
              <div className="h-5 min-w-[2px] rounded-sm transition-all" style={{ width: `${Math.max(b.pct, 0)}%` }}>
                <div className={`h-full w-full rounded-sm ${colour}`} />
              </div>
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                {b.pct.toFixed(2)}% · {dur(b.minutes)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ── The trend chart every analytical page draws ─────────────────────────── */

export interface TrendSeries {
  key: string;
  name: string;
  colour: string;
  /** The headline series is drawn heavier than the factors it is made of. */
  emphasis?: boolean;
  /** Plot against the right-hand axis — for a series in different units. */
  axis?: 'left' | 'right';
}

/** A bucket size the reader can switch a chart to. */
export interface TrendBucket {
  value: string;
  label: string;
}

/** Compact axis numbers: 12.4k rather than 12400, which crowds a narrow chart. */
function axisNumber(v: number): string {
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${(v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${(v / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(v * 10) / 10);
}

/**
 * Hand the reader the numbers behind the picture.
 *
 * A trend answers "what shape was the shift". The next question is always "what
 * exactly, and can I put it in a report" — and re-typing figures off a chart is
 * where transcription errors come from. Values are written unrounded, because
 * this file is for arithmetic, not for reading.
 */
function exportCsv(
  name: string,
  data: Array<Record<string, unknown>>,
  series: readonly TrendSeries[],
  xKey: string,
): void {
  const cell = (v: unknown) => {
    if (v == null) return '';
    const t = String(v);
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };

  /*
   * The axis label alone is not a timestamp.
   *
   * "11:00" is enough to read a chart, where the row's position carries the
   * day. In a file it is not: a month of buckets exports thirty rows labelled
   * "11:00" that no longer sort, join or plot, and two of them can be a day
   * apart. So each row leads with the instant it actually covers — an ISO
   * timestamp for arithmetic and joins, then the plant-local date-time a
   * person reads, then the axis label the chart showed. All three, because a
   * file that is one of them is a file somebody has to come back and ask
   * about.
   *
   * `at` is the raw instant every panel now carries alongside its label. When
   * a caller has not supplied one the timestamp columns are simply absent,
   * rather than being faked from the label.
   */
  const hasInstant = data.some((d) => d.at != null);
  const head = [
    ...(hasInstant ? ['timestamp', 'local_time'] : []),
    'period',
    ...series.map((s) => s.name),
  ].map(cell).join(',');
  const rows = data.map((d) => [
    ...(hasInstant
      ? [cell(toDate(d.at as string)?.toISOString()), cell(formatDateTime(d.at as string))]
      : []),
    cell(d[xKey]),
    ...series.map((s) => cell(d[s.key])),
  ].join(','));
  // A BOM, so Excel opens a UTF-8 file with Arabic labels intact instead of mojibake.
  const blob = new Blob([`﻿${head}\n${rows.join('\n')}\n`], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** One segmented control, used for both the form switch and the bucket switch. */
function Segmented<T extends string>({
  value, options, onChange, label,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label}
      className="inline-flex items-center rounded-md border border-border/60 bg-muted/40 p-[2px]">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            aria-pressed={on}
            className={[
              'rounded-[4px] px-2 py-[3px] text-[11px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              on ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

const FORM_OPTIONS = [
  { value: 'area' as const, label: 'Area' },
  { value: 'line' as const, label: 'Line' },
  { value: 'bar' as const, label: 'Bar' },
];

/**
 * The muted axis/grid palette every ECharts panel in this app already draws
 * with — `components/charts/production-trend.tsx` and
 * `features/downtime-center/downtime-charts.tsx` both hand-tune this exact
 * pair of values per theme. Centralised here rather than copied a fourth
 * time.
 */
export function echartsAxisColours(isDark: boolean) {
  return {
    text: isDark ? '#ffffff60' : '#00000060',
    grid: isDark ? '#ffffff10' : '#00000010',
    line: isDark ? '#ffffff20' : '#00000020',
    tooltipBg: isDark ? '#1a1f2e' : '#ffffff',
    tooltipBorder: isDark ? '#ffffff10' : '#00000010',
    tooltipText: isDark ? '#ffffff90' : '#000000',
  };
}

/**
 * A colour + alpha → a translucent fill Canvas will actually parse.
 *
 * Series colour comes from two places: the resolved `--viz-N` hex steps, and
 * literal `hsl(...)` constants like `STATUS.good`/`SEGMENT_COLOUR` that were
 * never `var()` references for `resolveChartColour` to touch. Appending a hex
 * alpha suffix to an hsl() string produces `'hsl(142 62% 38%)47'`, which is not
 * a colour — `CanvasGradient.addColorStop` throws on it and takes the whole
 * chart down. Splice the alpha in as CSS instead, per the input's own syntax.
 */
export function withAlpha(colour: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const trimmed = colour.trim();

  const hex = /^#[0-9a-fA-F]{6}$/.exec(trimmed);
  if (hex) {
    return `${trimmed}${Math.round(a * 255).toString(16).padStart(2, '0')}`;
  }

  const hsl = /^hsl\(([^)]+)\)$/.exec(trimmed);
  if (hsl) {
    const body = hsl[1];
    return body.includes(',') ? `hsla(${body}, ${a})` : `hsl(${body} / ${a})`;
  }

  return trimmed;
}

/**
 * The eight-hue chart palette, defined once in `globals.css` and RE-STEPPED
 * per theme there (see the comment beside `--viz-1`): the same hex on both
 * cards put violet at 2.04:1 contrast on the dark surface — effectively
 * invisible — so light and dark each get their own validated step.
 *
 * Every chart in this app reads these as `var(--viz-N)` and lets the CSS
 * cascade pick the right step, which works for anything CSS paints — a div, an
 * SVG `fill`. It does NOT work for ECharts: its default renderer is a plain
 * `<canvas>`, and a canvas 2D context's `fillStyle` is never part of the
 * CSSOM — handing it the literal string `'var(--viz-1)'` resolves to nothing,
 * silently, and the series paints in whatever colour the context happened to
 * have set before it. This mirrors the same eight steps as concrete hex per
 * theme, so a caller keeps writing `colour: 'var(--viz-1)'` unchanged and it
 * still reaches a real, theme-correct colour once it hits the canvas.
 */
const VIZ_HEX: Record<string, { light: string; dark: string }> = {
  '--viz-1': { light: '#2a78d6', dark: '#3987e5' },
  '--viz-2': { light: '#eb6834', dark: '#d95926' },
  '--viz-3': { light: '#1baf7a', dark: '#199e70' },
  '--viz-4': { light: '#eda100', dark: '#c98500' },
  '--viz-5': { light: '#e87ba4', dark: '#d55181' },
  '--viz-6': { light: '#008300', dark: '#008300' },
  '--viz-7': { light: '#4a3aa7', dark: '#9085e9' },
  '--viz-8': { light: '#e34948', dark: '#e66767' },
};

/** `'var(--viz-3)'` → a concrete hex for the active theme. Anything already concrete (hex, hsl()) passes through unchanged. */
export function resolveChartColour(colour: string, isDark: boolean): string {
  const m = /^var\((--viz-\d)\)$/.exec(colour.trim());
  if (!m) return colour;
  const step = VIZ_HEX[m[1]];
  return step ? (isDark ? step.dark : step.light) : colour;
}

/**
 * One time series chart — the only one in this app.
 *
 * ── Why ECharts, not the hand-rolled SVG this replaced ──────────────────────
 * `components/charts/production-trend.tsx` (Command Center) and
 * `features/downtime-center/downtime-charts.tsx` (Downtime Command Center)
 * already establish this app's chart language, and they are built on ECharts:
 * native cross-hair tooltips, native click-to-hide legends, native gradient
 * fills, native dual axes, native zoom. A second trend component built on a
 * different library — Recharts — could match none of that by construction,
 * however much CSS it wore; it would always read as a second visual system
 * bolted onto the first. So this draws with the same engine the rest of the
 * app already trusts, the same axis palette, the same legend behaviour.
 *
 * ── What a trend has to carry ───────────────────────────────────────────────
 * A picture of a shift is not an analysis. Reading one means asking WHEN
 * something happened, HOW MUCH it was, and what it looks like at a different
 * resolution — and then taking the numbers away. So every trend in the app
 * carries the same things, and none of them is optional per page: labelled
 * axes, a crosshair reading every series at the hovered moment, a legend that
 * hides a series on click, a form switch, zoom (drag-to-select on the plot,
 * or the handles on the slider beneath it — both native to ECharts'
 * `dataZoom`, not a bolted-on approximation of it), and a CSV export.
 *
 * ── A missing reading blanks its own series, and nothing else ──────────────
 * A bucket the engine could not measure a factor for sends that factor as
 * `null`. The bucket keeps its slot on the time axis, that one series is
 * absent there, and every other series is drawn normally.
 *
 * Removing the bucket would close the hole — the surviving points slide
 * together and the chart draws a continuous, fully-measured period that never
 * happened. Blanking the whole row would throw away readings that exist: a
 * day the line ran but shipped nothing has a real Availability and no
 * Quality, and voiding all four to keep the row tidy loses the measured half.
 * `connectNulls: false` stops any line bridging its own gap.
 *
 * The consequence is deliberate and is stated under the chart: the lines do
 * not all cover the same buckets. A gap in one is that measure being absent,
 * which is not the same claim as a value of zero.
 *
 * Zero is NOT missing: a machine that genuinely produced nothing is measured,
 * and its zero belongs on the chart same as any other reading.
 *
 * ── The form switch is local, seeded globally ───────────────────────────────
 * The filter panel sets the house style and every chart follows it. Changing
 * it ON a chart changes only that chart, because the reader comparing two
 * panels wants one of them in bars and is not asking to restyle the app.
 */
export function TrendChart({
  data,
  series,
  xKey = 't',
  height = 280,
  domain = [0, 100],
  unit = '%',
  decimals = 1,
  empty = 'No buckets in this window yet.',
  title,
  bucket,
  buckets,
  onBucketChange,
  exportName,
  zoom = true,
  toolbar = true,
  rightDomain,
  rightUnit,
}: {
  data: Array<Record<string, unknown>>;
  series: readonly TrendSeries[];
  xKey?: string;
  height?: number;
  /** `'auto'` lets the values set the scale — for counts rather than percentages. */
  domain?: [number, number] | 'auto';
  unit?: string;
  decimals?: number;
  empty?: string;
  title?: string;
  /** Bucket controls appear only when the page can actually re-bucket its data. */
  bucket?: string;
  buckets?: readonly TrendBucket[];
  onBucketChange?: (b: string) => void;
  /** Enables the CSV button, and names the file. */
  exportName?: string;
  zoom?: boolean;
  toolbar?: boolean;
  rightDomain?: [number, number] | 'auto';
  rightUnit?: string;
}) {
  const globalForm = useDashboardPrefsStore((s) => s.trendType);
  const [form, setForm] = React.useState(globalForm);
  // Follow the house style when it changes, until this chart is told otherwise.
  React.useEffect(() => setForm(globalForm), [globalForm]);

  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const c = echartsAxisColours(isDark);

  const hasBuckets = !!(buckets?.length && onBucketChange);

  // ── EVERY hook runs before the early return below ──────────────────────────
  // Not a style preference: an early return placed above a hook changes the
  // NUMBER of hooks between renders, and React aborts the whole tree with
  // error #310 ("rendered fewer hooks than expected") the moment it happens.
  // This chart hits that transition routinely — a period change can take it
  // from "some complete buckets" to "none" in one render — so the rule has to
  // hold structurally rather than by nobody noticing.

  // A missing reading blanks ITS OWN series, and nothing else.
  //
  // Two rules were tried before this one and both lost information:
  //
  //   Removing the bucket closed the hole in the axis. The surviving points
  //   slid together, so a window with unmeasured stretches drew as a
  //   continuous, fully-measured period — the chart asserted more than the
  //   plant knew.
  //
  //   Blanking the whole row destroyed measurements that exist. A day where
  //   the line ran but shipped nothing has a real Availability and no
  //   Quality; voiding all four to keep the row "consistent" throws away the
  //   half that was measured. At hour granularity that damage hides in the
  //   crowd — most hours are complete — but a month grouped by day is two or
  //   thirty points, and one absent factor emptied the entire chart.
  //
  // So each series is plotted exactly where it has a reading and absent
  // everywhere else. The bucket always keeps its slot on the axis, so gaps
  // stay open at their true width, and `connectNulls: false` stops any line
  // bridging one.
  const rows = React.useMemo(
    () => data.map((d) => {
      if (series.every((s) => d[s.key] != null)) return d;
      const blank: Record<string, unknown> = { ...d };
      for (const s of series) if (blank[s.key] == null) blank[s.key] = null;
      return blank;
    }),
    [data, series],
  );
  // Buckets that are not fully measured — some series present, some absent.
  // Counted for the note under the chart, which is what tells a reader the
  // lines they are comparing do not all cover the same buckets.
  const partial = React.useMemo(
    () => data.reduce((n, d) => (series.every((s) => d[s.key] != null) ? n : n + 1), 0),
    [data, series],
  );

  // Resolved ONCE, here — every downstream read of a series' colour (the
  // palette array, the area gradients, the zoom slider's filler) uses this,
  // never `series` directly, so nothing can reach the canvas as an
  // unresolved `var(--viz-N)` reference.
  const resolved = React.useMemo(
    () => series.map((s) => ({ ...s, colour: resolveChartColour(s.colour, isDark) })),
    [series, isDark],
  );

  const hasZoom = zoom && rows.length > 6;

  const option = React.useMemo(() => {
    const yAxis: Record<string, unknown>[] = [{
      type: 'value',
      min: domain === 'auto' ? undefined : domain[0],
      max: domain === 'auto' ? undefined : domain[1],
      axisLabel: { color: c.text, fontSize: 10, formatter: (v: number) => `${axisNumber(v)}${unit}` },
      splitLine: { lineStyle: { color: c.grid } },
      axisLine: { show: false },
    }];
    if (rightUnit !== undefined) {
      yAxis.push({
        type: 'value',
        min: rightDomain === 'auto' || !rightDomain ? undefined : rightDomain[0],
        max: rightDomain === 'auto' || !rightDomain ? undefined : rightDomain[1],
        axisLabel: { color: c.text, fontSize: 10, formatter: (v: number) => `${axisNumber(v)}${rightUnit}` },
        splitLine: { show: false },
        axisLine: { show: false },
      });
    }

    return {
      backgroundColor: 'transparent',
      // Animation OFF, deliberately.
      //
      // These pages refetch on a timer, and `notMerge` replaces the option
      // wholesale on each update. An animation frame still in flight from the
      // previous update then interpolates against series data that no longer
      // exists and throws "Cannot read properties of undefined (reading
      // 'length')" out of ECharts' own onframe loop — which is a crash, not a
      // dropped frame. The pre-ECharts charts all carried
      // isAnimationActive={false} for the same reason; this is that policy
      // restored. A live plant dashboard has nothing to gain from easing
      // between two readings anyway.
      animation: false,
      color: resolved.map((s) => s.colour),
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross', label: { backgroundColor: c.tooltipBg } },
        backgroundColor: c.tooltipBg,
        borderColor: c.tooltipBorder,
        textStyle: { color: c.tooltipText, fontSize: 12 },
        // `rows` already dropped every incomplete bucket, so this is a
        // defensive fallback rather than a path a reader should ever see.
        valueFormatter: (v: unknown) =>
          v == null ? '—' : `${Number(v).toLocaleString('en-US', { maximumFractionDigits: decimals })}${unit}`,
      },
      legend: series.length > 1 ? {
        data: resolved.map((s) => s.name),
        textStyle: { color: c.text, fontSize: 11 },
        icon: 'circle', itemWidth: 8, itemHeight: 8,
        top: 0, right: 0,
      } : undefined,
      grid: {
        top: series.length > 1 ? 34 : 12,
        left: 8, right: rightUnit !== undefined ? 8 : 12,
        bottom: hasZoom ? 44 : 8,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: rows.map((d) => String(d[xKey] ?? '')),
        boundaryGap: form === 'bar',
        axisLabel: { color: c.text, fontSize: 10 },
        axisLine: { lineStyle: { color: c.line } },
        splitLine: { show: false },
      },
      yAxis,
      dataZoom: hasZoom ? [
        // Drag-to-select directly on the plot, and the scroll wheel — the
        // "zoom in" the reader reaches for first.
        { type: 'inside', throttle: 50 },
        // A visible handle for a precise range, and the only part of this
        // that needs a pixel budget of its own — hence the extra grid bottom
        // margin above.
        {
          type: 'slider', height: 18, bottom: 6,
          borderColor: c.grid, fillerColor: withAlpha(resolved[0]?.colour ?? '#4c7571', 0.12),
          handleStyle: { color: c.line },
          textStyle: { color: c.text, fontSize: 9 },
        },
      ] : undefined,
      series: resolved.map((s) => {
        const axisIndex = s.axis === 'right' && rightUnit !== undefined ? 1 : 0;
        const base = {
          name: s.name,
          // Blanked buckets arrive here as null and keep their slot on the
          // axis, so the gap is drawn at its true width.
          data: rows.map((d) => d[s.key] ?? null),
          yAxisIndex: axisIndex,
          // Load-bearing, not decorative: without it a line would be drawn
          // straight THROUGH a blanked bucket, asserting a value for a moment
          // the plant has no reading for. It is ECharts' default, and named
          // explicitly so it cannot be lost to a later refactor.
          connectNulls: false,
        };
        if (form === 'bar') {
          return { ...base, type: 'bar', barMaxWidth: 28, itemStyle: { borderRadius: [3, 3, 0, 0] } };
        }
        return {
          ...base,
          type: 'line',
          smooth: true,
          symbol: rows.length <= 60 ? 'circle' : 'none',
          symbolSize: 5,
          lineStyle: { width: s.emphasis ? 3 : 2 },
          ...(form === 'area' ? {
            areaStyle: {
              color: {
                type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: withAlpha(s.colour, 0.28) },
                  { offset: 1, color: withAlpha(s.colour, 0.02) },
                ],
              },
            },
          } : {}),
        };
      }),
    };
    // `isDark` rather than `c`: the colour table is rebuilt on every render, so
    // depending on the object itself would bust this memo every time. It is a
    // pure function of the theme, which is what actually changes.
  }, [rows, resolved, series.length, form, domain, rightDomain, unit, rightUnit, decimals, isDark, hasZoom, xKey]);

  // ── Hooks are done; from here it is safe to branch ────────────────────────
  const head = toolbar ? (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {title && <h3 className="text-sm font-semibold">{title}</h3>}
      <div className="ms-auto flex flex-wrap items-center gap-2">
        {hasBuckets && (
          <Segmented label="Bucket size" value={bucket ?? buckets![0].value}
            options={buckets!.map((b) => ({ value: b.value, label: b.label }))}
            onChange={(v) => onBucketChange!(v)} />
        )}
        <Segmented label="Chart form" value={form} options={FORM_OPTIONS} onChange={setForm} />
        {exportName && (
          <button type="button" onClick={() => exportCsv(exportName, rows, series, xKey)}
            title="Download these buckets as CSV"
            className="rounded-md border border-border/60 px-2 py-[3px] text-[11px] font-medium
                       text-muted-foreground transition-colors hover:text-foreground
                       focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            CSV
          </button>
        )}
      </div>
    </div>
  ) : null;

  if (rows.length === 0) {
    return (
      <div>
        {head}
        <p className="py-8 text-center text-sm text-muted-foreground">{empty}</p>
      </div>
    );
  }

  return (
    <div>
      {head}
      <ReactECharts option={option} notMerge style={{ height, width: '100%' }} />
      {/*
        Buckets the plant reported but could not fully measure. Stated rather
        than left for the reader to infer from the gaps: knowing HOW MUCH of
        the window is unmeasured is what says whether the shape is worth
        drawing a conclusion from.
      */}
      {partial > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {partial} of {data.length} buckets are missing at least one reading. Each series is drawn
          only where it was measured and breaks where it was not, so the lines do not all cover the
          same buckets — a gap in one is that measure being absent, not a value of zero.
        </p>
      )}
    </div>
  );
}
