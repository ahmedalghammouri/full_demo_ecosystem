'use client';
/**
 * The three charts every breakdown tab draws, written once.
 *
 * Machines, job orders and shifts are the same SHAPE of question asked of three
 * different groupings — who scored what, where their time went, and what came
 * out. Three copies of that would drift the moment one was corrected, which is
 * the reason the engines share a minute classifier and the analyses share a
 * chart kit. These take rows and know nothing about which grouping produced
 * them.
 *
 * ── Why ECharts ──────────────────────────────────────────────────────────────
 * `components/charts/production-trend.tsx` (Command Center) and
 * `features/downtime-center/downtime-charts.tsx` (Downtime Command Center)
 * already establish this app's chart language, and both are built on ECharts.
 * These three draw with the same engine, the same axis palette
 * (`echartsAxisColours`), and the same theme-aware colour resolution
 * (`resolveChartColour`) as the OEE Analysis trend charts — one chart system,
 * not a second one wearing the first one's CSS.
 *
 * ── On colour ───────────────────────────────────────────────────────────────
 * None of these charts colours by IDENTITY, so none of them needs a categorical
 * ramp and none can run out of hues when a twentieth job order appears:
 *
 *   Ranked OEE      → status. The bar's colour is the band the reading falls in,
 *                     and the number is printed on every bar, so the colour is
 *                     the second encoding and never the only one.
 *   Time composition→ the segment palette the whole OEE family already uses, so
 *                     "starved" is the same amber here as on the timeline.
 *   Output          → good/bad status, again with a legend and printed values.
 *
 * Status colours are reserved for state everywhere in this project; they are not
 * reused here as "series 1 and 2" — good and rejected genuinely ARE good and bad.
 */
import React from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';

import {
  STATUS, BANDS, SEGMENT_COLOUR, SEGMENT_LABEL, bandOf, dur, pctText,
  echartsAxisColours,
} from '@/features/oee-analysis/chart-kit';
import type { SegmentKind } from '@/features/oee-analysis/chart-kit';

export interface Slice {
  key: string;
  label: string;
  sublabel?: string | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  teep: number | null;
  slotElapsedPct?: number | null;
  time: Record<string, number>;
  counts: { good: number; rejected: number; total: number; theoretical: number };
}

const num = (n: number | null | undefined) =>
  n == null ? '—' : Math.round(n).toLocaleString('en-US');

/**
 * How many bars before a chart stops being readable.
 *
 * A job-order breakdown can run to dozens of rows. Beyond this the bars are
 * thinner than their own labels, so the chart shows the worst performers and
 * says how many it left out — the table below carries the rest, paginated.
 * Silently truncating would be the same chart telling a different story than
 * the table under it.
 */
const MAX_BARS = 12;

function topBy<T extends Slice>(rows: T[], pick: (r: T) => number | null): { shown: T[]; hidden: number } {
  const usable = rows.filter((r) => pick(r) != null);
  const sorted = [...usable].sort((a, b) => (pick(a) ?? 0) - (pick(b) ?? 0)); // worst first
  return { shown: sorted.slice(0, MAX_BARS), hidden: Math.max(0, sorted.length - MAX_BARS) };
}

/** A frame with a title, a one-line reason it exists, and a note when rows were dropped. */
function Figure({
  title, blurb, hidden, height, children,
}: {
  title: string; blurb: string; hidden?: number; height: number; children: React.ReactNode;
}) {
  return (
    <figure className="m-0 rounded-lg border border-border/60 bg-card p-3">
      <figcaption className="mb-2">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <p className="text-[11px] text-muted-foreground">
          {blurb}
          {hidden ? ` Showing the ${MAX_BARS} lowest; ${hidden} more are in the table below.` : ''}
        </p>
      </figcaption>
      <div style={{ height }}>{children}</div>
    </figure>
  );
}

/** Chart height that grows with the rows, so bars stay a readable thickness. */
const rowsHeight = (n: number, min = 140) => Math.max(min, n * 30 + 46);

/** A two-line name + sub-label, the way every ranked bar here identifies its row. */
function rowName(label: string, sub: string): string {
  return sub ? `${label}\n${sub}` : label;
}

// ── 1. Who scored what ──────────────────────────────────────────────────────

export function RankedOee({ rows }: { rows: Slice[] }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const c = echartsAxisColours(isDark);
  const { shown, hidden } = topBy(rows, (r) => r.oee);
  const data = shown.map((r) => ({
    name: r.label, sub: r.sublabel ?? '',
    oee: r.oee ?? 0,
    availability: r.availability, performance: r.performance, quality: r.quality,
  }));
  if (data.length === 0) return null;

  const option = {
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
    // restored.
    animation: false,
    grid: { top: 6, right: 54, bottom: 6, left: 8, containLabel: true },
    tooltip: {
      trigger: 'item',
      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter: (p: any) => {
        const d = data[p.dataIndex];
        const row = (label: string, v: number | null) =>
          `<div style="display:flex;gap:12px;justify-content:space-between"><span style="opacity:.65">${label}</span><b>${pctText(v)}</b></div>`;
        return `<div style="font-weight:600;margin-bottom:2px">${d.name}</div>`
          + (d.sub ? `<div style="opacity:.6;font-size:11px;margin-bottom:4px">${d.sub}</div>` : '')
          + row('OEE', d.oee) + row('Availability', d.availability) + row('Performance', d.performance) + row('Quality', d.quality);
      },
    },
    xAxis: {
      type: 'value', min: 0, max: 100,
      axisLabel: { color: c.text, fontSize: 10, formatter: '{value}%' },
      splitLine: { lineStyle: { color: c.grid } }, axisLine: { show: false },
    },
    yAxis: {
      type: 'category', data: data.map((d) => rowName(d.name, d.sub)), inverse: false,
      axisLabel: { color: c.text, fontSize: 11 }, axisLine: { lineStyle: { color: c.line } },
    },
    series: [{
      type: 'bar', barMaxWidth: 18,
      data: data.map((d) => ({ value: d.oee, itemStyle: { color: STATUS[bandOf('OEE', d.oee)], borderRadius: [0, 3, 3, 0] } })),
      label: {
        show: true, position: 'right', color: c.text, fontSize: 11,
        formatter: (p: any) => `${Number(p.value).toFixed(1)}%`,
      },
      markLine: {
        silent: true, symbol: 'none', animation: false,
        lineStyle: { color: STATUS.good, type: 'dashed', width: 1.5 },
        label: { formatter: `target ${BANDS.OEE.good}%`, color: STATUS.good, fontSize: 10, position: 'insideEndTop' },
        data: [{ xAxis: BANDS.OEE.good }],
      },
    }],
  };

  return (
    <Figure
      title="OEE, worst first"
      blurb={`The colour is the band the reading falls in — under ${BANDS.OEE.warn}% red, under ${BANDS.OEE.good}% amber. The dashed line is the target.`}
      hidden={hidden}
      height={rowsHeight(data.length)}
    >
      <ReactECharts option={option} notMerge style={{ height: '100%', width: '100%' }} />
    </Figure>
  );
}

// ── 2. Where the time went ──────────────────────────────────────────────────

/**
 * The segments, in the order the time model spends them.
 *
 * Stacked left to right in that same order so the bar reads as the model does:
 * running first, then the three kinds of stop, then the silence. A reader
 * comparing two rows is comparing the same thing at the same offset.
 */
const SEGMENTS: Array<{ key: string; kind: SegmentKind }> = [
  { key: 'netProductionMin', kind: 'running' },
  { key: 'availabilityLossMin', kind: 'downtime' },
  { key: 'externalLossMin', kind: 'external' },
  { key: 'plannedStopMin', kind: 'planned' },
  { key: 'unmeasuredMin', kind: 'unmeasured' },
];

export function TimeComposition({ rows }: { rows: Slice[] }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const c = echartsAxisColours(isDark);
  // Ranked by how much of the time was NOT production — the chart's own subject.
  const { shown, hidden } = topBy(rows, (r) => -(r.time?.netProductionMin ?? 0));
  const data = shown.map((r) => {
    const out: Record<string, string | number> = { name: r.label, sub: r.sublabel ?? '' };
    for (const s of SEGMENTS) out[s.key] = Math.max(0, r.time?.[s.key] ?? 0);
    return out;
  });
  if (data.length === 0) return null;

  const names = data.map((d) => rowName(String(d.name), String(d.sub)));

  const option = {
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    grid: { top: 30, right: 12, bottom: 6, left: 8, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter: (params: any[]) => {
        const total = params.reduce((a, p) => a + (Number(p.value) || 0), 0);
        const rows2 = params
          .filter((p) => Number(p.value) > 0)
          .map((p) => `<div style="display:flex;gap:12px;justify-content:space-between">`
            + `<span style="opacity:.75">${p.marker}${p.seriesName}</span><b>${dur(Number(p.value))}</b></div>`)
          .join('');
        return `<div style="font-weight:600;margin-bottom:4px">${params[0]?.name?.split('\n')[0] ?? ''}</div>${rows2}`
          + `<div style="margin-top:4px;padding-top:4px;border-top:1px solid ${c.tooltipBorder};font-weight:600">${dur(total)} total</div>`;
      },
    },
    legend: {
      top: 0, textStyle: { color: c.text, fontSize: 10 }, icon: 'circle', itemWidth: 8, itemHeight: 8,
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: c.text, fontSize: 10, formatter: (v: number) => (v >= 60 ? `${Math.round(v / 60)}h` : `${v}m`) },
      splitLine: { lineStyle: { color: c.grid } }, axisLine: { show: false },
    },
    yAxis: {
      type: 'category', data: names,
      axisLabel: { color: c.text, fontSize: 11 }, axisLine: { lineStyle: { color: c.line } },
    },
    series: SEGMENTS.map((s) => ({
      name: SEGMENT_LABEL[s.kind], type: 'bar', stack: 'time',
      data: data.map((d) => d[s.key]),
      itemStyle: { color: SEGMENT_COLOUR[s.kind] },
      barMaxWidth: 18,
    })),
  };

  return (
    <Figure
      title="Where the time went"
      blurb="Minutes, stacked in the order the time model spends them. Same colours as the machine-status timeline."
      hidden={hidden}
      height={rowsHeight(data.length)}
    >
      <ReactECharts option={option} notMerge style={{ height: '100%', width: '100%' }} />
    </Figure>
  );
}

// ── 3. What came out ────────────────────────────────────────────────────────

export function OutputBars({ rows }: { rows: Slice[] }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const c = echartsAxisColours(isDark);
  const { shown, hidden } = topBy(rows, (r) => -(r.counts?.total ?? 0));
  const data = shown
    .map((r) => ({
      name: r.label, sub: r.sublabel ?? '',
      good: Math.max(0, r.counts?.good ?? 0),
      rejected: Math.max(0, r.counts?.rejected ?? 0),
      theoretical: Math.max(0, r.counts?.theoretical ?? 0),
    }))
    .filter((d) => d.good + d.rejected + d.theoretical > 0);
  if (data.length === 0) return null;

  const names = data.map((d) => rowName(d.name, d.sub));

  const option = {
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    grid: { top: 30, right: 12, bottom: 6, left: 8, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter: (params: any[]) => {
        const d = data[params[0]?.dataIndex ?? 0];
        const total = d.good + d.rejected;
        const q = total > 0 ? `${((d.good / total) * 100).toFixed(1)}%` : '—';
        const row = (label: string, v: string, colour?: string) =>
          `<div style="display:flex;gap:12px;justify-content:space-between">`
          + `<span style="opacity:.75">${label}</span>`
          + `<b${colour ? ` style="color:${colour}"` : ''}>${v}</b></div>`;
        return `<div style="font-weight:600;margin-bottom:4px">${d.name}</div>`
          + row('Good', num(d.good), STATUS.good)
          + row('Rejected', num(d.rejected), d.rejected > 0 ? STATUS.bad : undefined)
          + row('Theoretical', num(d.theoretical))
          + row('Quality', q);
      },
    },
    legend: {
      top: 0, textStyle: { color: c.text, fontSize: 10 }, icon: 'circle', itemWidth: 8, itemHeight: 8,
      data: ['Good', 'Rejected', 'Theoretical'],
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: c.text, fontSize: 10, formatter: (v: number) => num(v) },
      splitLine: { lineStyle: { color: c.grid } }, axisLine: { show: false },
    },
    yAxis: {
      type: 'category', data: names,
      axisLabel: { color: c.text, fontSize: 11 }, axisLine: { lineStyle: { color: c.line } },
    },
    series: [
      {
        name: 'Good', type: 'bar', stack: 'out', data: data.map((d) => d.good),
        itemStyle: { color: STATUS.good }, barMaxWidth: 16,
      },
      {
        name: 'Rejected', type: 'bar', stack: 'out', data: data.map((d) => d.rejected),
        itemStyle: { color: STATUS.bad }, barMaxWidth: 16,
      },
      // Theoretical rides beside the good/rejected stack rather than behind
      // it — an outlined, unfilled bar reading as the envelope the actual is
      // measured against, not a third quantity competing with it.
      {
        name: 'Theoretical', type: 'bar', data: data.map((d) => d.theoretical),
        itemStyle: { color: 'transparent', borderColor: STATUS.none, borderType: 'dashed', borderWidth: 1.5 },
        barMaxWidth: 16,
      },
    ],
  };

  return (
    <Figure
      title="What came out"
      blurb="Pieces, so the stations are comparable — a pallet is 160 of them. The outlined bar is what the design speed allowed in the same time; the gap to it is the performance loss."
      hidden={hidden}
      height={rowsHeight(data.length)}
    >
      <ReactECharts option={option} notMerge style={{ height: '100%', width: '100%' }} />
    </Figure>
  );
}
