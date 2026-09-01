'use client';
/**
 * The Downtime analysis: which stops cost the most, when they happened, and what
 * sits underneath them.
 *
 * ── Why the colours matter more here than anywhere else ─────────────────────
 * The Pareto bar and the blocks in the timeline beneath it are the SAME reason,
 * and the colour is what says so. That makes the hue an identity, not a
 * decoration — so it is fixed per state in chart-kit and never assigned by rank.
 * If it moved with the ranking, changing the filter would repaint both charts
 * and the link between them would quietly start pointing somewhere else.
 *
 * Duration or occurrence is a real question rather than a display preference:
 * one four-hour breakdown and forty two-minute stops are different problems with
 * different fixes, and a page that only ranks by one of them hides the other.
 *
 * ── Why ECharts ──────────────────────────────────────────────────────────────
 * Same engine as every other chart in the OEE family now — see chart-kit.tsx's
 * TrendChart for the fuller reasoning. `stateColour()` returns `var(--viz-N)`,
 * a CSS custom property reference that a canvas 2D context cannot resolve, so
 * both charts here go through `resolveChartColour` before a hue reaches the
 * canvas — exactly the same fix TrendChart needed, because it is the same
 * function producing the same reference.
 */
import React from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';

import {
  dur, stateColour, SEGMENT_COLOUR, toGanttRows,
  type SegmentKind, type TimelineSegment,
  echartsAxisColours, resolveChartColour,
} from './chart-kit';
import { MachineStateGantt, type GanttRow } from '@/components/charts/machine-state-gantt';

export interface ReasonSlice {
  key: string; label: string; kind: SegmentKind;
  minutes: number; occurrence: number; medianMin: number; averageMin: number;
  children?: ReasonSlice[];
}
export interface Distribution {
  occurrence: number; totalMin: number; medianMin: number; averageMin: number;
  reasons: ReasonSlice[];
}

type RankBy = 'duration' | 'occurrence';

export function DowntimePanel({
  distribution, timeline, plannedTimeline, machines, windowStart, windowEnd,
}: {
  distribution: Distribution;
  timeline: TimelineSegment[];
  /** The schedule for the same window, drawn above each machine's own row. */
  plannedTimeline?: TimelineSegment[];
  machines: Array<{ key: string; label: string; sublabel?: string | null; availability: number | null }>;
  windowStart: string;
  windowEnd: string;
}) {
  const [rankBy, setRankBy] = React.useState<RankBy>('duration');
  const [drill, setDrill] = React.useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const c = echartsAxisColours(isDark);

  // Only stops charged to the machine. A break is not a downtime reason, and
  // ranking it alongside breakdowns puts the canteen at the top of a Pareto
  // meant to send somebody to a machine.
  const downtime = distribution.reasons.find((r) => r.kind === 'downtime');
  const leaves = React.useMemo(() => {
    const rows = [...(downtime?.children ?? [])];
    rows.sort((a, b) => (rankBy === 'duration' ? b.minutes - a.minutes : b.occurrence - a.occurrence));
    const total = rows.reduce((a, r) => a + (rankBy === 'duration' ? r.minutes : r.occurrence), 0);
    let running = 0;
    return rows.map((r, i) => {
      const v = rankBy === 'duration' ? r.minutes : r.occurrence;
      running += v;
      return {
        ...r, rank: i + 1, value: v,
        sharePct: total > 0 ? (v / total) * 100 : 0,
        cumulativePct: total > 0 ? (running / total) * 100 : 0,
        colour: resolveChartColour(stateColour(r.label), isDark),
      };
    });
  }, [downtime, rankBy, isDark]);

  // The drilldown starts at the time model, exactly as the reference does, so
  // the reader can see planned and external time beside the unplanned before
  // going into it.
  const level = drill ? distribution.reasons.find((r) => r.key === drill) : null;
  const drillRows = level?.children ?? distribution.reasons;
  const shown = level
    ? { occurrence: level.occurrence, totalMin: level.minutes, medianMin: level.medianMin, averageMin: level.averageMin }
    : distribution;

  /**
   * The same rows the Overview draws, from the same component.
   *
   * The reference colours this band by the top downtime reasons so a bar and a
   * block match. That link is worth having, but not at the price of a second,
   * weaker timeline — this one keeps gaps honest, re-renders on zoom instead of
   * scaling, and ships a validated palette with texture for CVD and print. The
   * ranking above carries NUMBERS as well as colour, so a reader can still match
   * a bar to a stop without either chart agreeing on hue.
   */
  const ganttRows: GanttRow[] = React.useMemo(
    () => toGanttRows(timeline, plannedTimeline, machines, (segs) => {
      const down = segs.filter((x) => x.kind === 'downtime');
      return `${down.length} stops · ${dur(down.reduce((a, x) => a + x.minutes, 0))}`;
    }),
    [timeline, plannedTimeline, machines],
  );

  if (!downtime || leaves.length === 0) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-border/60 bg-card p-4 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <span className="font-medium">No unplanned downtime in this window</span>
          <span className="text-muted-foreground">
            Nothing was charged to the machines&rsquo; own availability. Planned stops and time the
            line could not feed are on the Availability page, under Distribution.
          </span>
        </div>
      </div>
    );
  }

  // ── Pareto: ranked bars + cumulative % line, on a shared rank axis ─────────
  const paretoOption = {
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
    grid: { top: 8, right: 44, bottom: 8, left: 8, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter: (params: any[]) => {
        const r = leaves[params[0]?.dataIndex ?? 0];
        if (!r) return '';
        const measure = rankBy === 'duration'
          ? `${dur(r.minutes)} · ×${r.occurrence}`
          : `×${r.occurrence} · ${dur(r.minutes)}`;
        return `<div style="font-weight:600;margin-bottom:2px">${r.label}</div>`
          + `<div>${measure}</div>`
          + `<div style="opacity:.65">${r.sharePct.toFixed(1)}% · cumulative ${r.cumulativePct.toFixed(1)}%</div>`;
      },
    },
    xAxis: {
      type: 'category', data: leaves.map((r) => r.rank),
      axisLabel: { color: c.text, fontSize: 11 }, axisLine: { lineStyle: { color: c.line } },
    },
    yAxis: [
      {
        type: 'value',
        axisLabel: { color: c.text, fontSize: 11 },
        splitLine: { lineStyle: { color: c.grid } }, axisLine: { show: false },
      },
      {
        // The cumulative line is a percentage OF the bars beside it, fixed
        // 0–100 and derived from the same numbers — the one second axis that
        // is not a second measure competing for the space.
        type: 'value', min: 0, max: 100,
        axisLabel: { color: c.text, fontSize: 11, formatter: '{value}%' },
        splitLine: { show: false }, axisLine: { show: false },
      },
    ],
    series: [
      {
        type: 'bar', barMaxWidth: 28,
        data: leaves.map((r) => ({ value: r.value, itemStyle: { color: r.colour, borderRadius: [3, 3, 0, 0] } })),
      },
      {
        type: 'line', yAxisIndex: 1, smooth: true,
        data: leaves.map((r) => r.cumulativePct),
        lineStyle: { color: c.text, width: 2 },
        itemStyle: { color: c.text },
        symbolSize: 6,
      },
    ],
  };

  // ── Time-model tree: donut + drill list ─────────────────────────────────
  const donutOption = {
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    tooltip: {
      trigger: 'item',
      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
      textStyle: { color: c.tooltipText, fontSize: 12 },
      formatter: (p: any) => `<div style="font-weight:600">${p.name}</div><div>${dur(p.value)}</div>`,
    },
    series: [{
      type: 'pie', radius: ['52%', '78%'],
      itemStyle: { borderColor: isDark ? '#0b0f1a' : '#ffffff', borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      data: drillRows.map((r) => ({
        name: r.label, value: r.minutes,
        itemStyle: { color: resolveChartColour(level ? stateColour(r.label) : SEGMENT_COLOUR[r.kind], isDark) },
      })),
    }],
  };

  return (
    <div className="flex flex-col gap-5">
      {/* ── The ranking ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Top downtime reasons by</h2>
          <div className="inline-flex rounded-md border border-border/60 p-0.5">
            {(['duration', 'occurrence'] as const).map((k) => (
              <button key={k} onClick={() => setRankBy(k)}
                className={`rounded px-2 py-0.5 text-[11px] capitalize transition-colors ${
                  rankBy === k ? 'bg-primary/15 font-semibold text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}>
                {k}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            {downtime.occurrence} stops · {dur(downtime.minutes)} lost
          </span>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          <div className="h-[280px]">
            <ReactECharts option={paretoOption} notMerge style={{ height: '100%', width: '100%' }} />
          </div>

          {/* The list carries the names. The bars are numbered, so a reader can
              match them without relying on colour at all. */}
          <div className="flex flex-col gap-2">
            {leaves.map((r) => (
              <div key={r.key}
                className="flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-xs">
                <span className="w-4 shrink-0 font-mono tabular-nums text-muted-foreground">{r.rank}.</span>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: r.colour }} />
                <span className="truncate font-medium">{r.label}</span>
                <span className="ml-auto shrink-0 text-end font-mono tabular-nums">
                  <span className="block">{dur(r.minutes)}</span>
                  <span className="block text-[10px] text-muted-foreground">×{r.occurrence}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── When they happened ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-1 text-sm font-semibold">Downtime timeline</h2>
        <p className="mb-4 text-[11px] text-muted-foreground">
          The same bands as Overview, with each machine&rsquo;s stop count beside it. Red is the
          machine&rsquo;s own loss, amber is the line waiting on something else — the exact state is
          one hover away, and the ranking above is numbered so a bar can be matched to a stop
          without relying on colour.
        </p>
        <MachineStateGantt rows={ganttRows} windowStart={windowStart} windowEnd={windowEnd} />
      </section>

      {/* ── The tree ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          {level ? (
            <button onClick={() => setDrill(null)}
              className="flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-xs hover:bg-muted">
              <ChevronLeft className="h-3 w-3" /> Time model
            </button>
          ) : (
            <span className="rounded border border-border/60 px-2 py-1 text-xs font-medium">Time model</span>
          )}
          <span className="text-xs text-muted-foreground">
            {level ? `states inside ${level.label}` : 'all categories — drill into one'}
          </span>
          <div className="ml-auto flex flex-wrap gap-5">
            <Mini label="Occurrence" value={String(shown.occurrence)} />
            <Mini label="Total" value={dur(shown.totalMin)} />
            <Mini label="Median" value={dur(shown.medianMin)} />
            <Mini label="Average" value={dur(shown.averageMin)} />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <div className="h-[200px]">
            <ReactECharts option={donutOption} notMerge style={{ height: '100%', width: '100%' }} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {drillRows.map((r) => (
              <button key={r.key}
                onClick={() => r.children?.length && setDrill(r.key)}
                disabled={!r.children?.length}
                className={`flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-start text-xs ${
                  r.children?.length ? 'hover:bg-muted' : 'cursor-default'
                }`}>
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: level ? stateColour(r.label) : SEGMENT_COLOUR[r.kind] }} />
                <span className="truncate font-medium">{r.label}</span>
                <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">{dur(r.minutes)}</span>
                <span className="shrink-0 font-mono tabular-nums text-muted-foreground">×{r.occurrence}</span>
                {!!r.children?.length && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
              </button>
            ))}
          </div>
        </div>

        <p className="mt-3 text-[11px] text-muted-foreground">
          The tree stops at the machine state. Going deeper — a cause per stop, not per state —
          needs a reason recorded against each downtime event; until that happens this is the last
          level there is, and saying so beats inventing a leaf.
        </p>
      </section>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-sm tabular-nums">{value}</span>
    </div>
  );
}
