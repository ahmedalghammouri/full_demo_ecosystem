'use client';
/**
 * The Availability analysis: one reading, its trend, the reliability pair, and
 * where the time actually went.
 *
 * The two tabs at the bottom answer different questions about the same minutes.
 * Distribution asks WHAT the time was spent on; Trend asks WHEN. Putting them on
 * one screen would give each half the room and neither the emphasis, which is
 * why the reference tabs them too.
 */
import React from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { bucketLabels } from '@/lib/datetime';

import {
  Gauge, STATUS, SEGMENT_COLOUR, SEGMENT_LABEL, dur, type SegmentKind, TrendChart,
  echartsAxisColours,
} from './chart-kit';

export interface AvailabilityTrendPoint {
  at: string;
  availability: number | null;
  time: Record<string, number>;
}
export interface ReasonSlice {
  key: string; label: string; kind: SegmentKind;
  minutes: number; occurrence: number; medianMin: number; averageMin: number;
  children?: ReasonSlice[];
}
export interface Distribution {
  occurrence: number; totalMin: number; medianMin: number; averageMin: number;
  reasons: ReasonSlice[];
}

/** The stack, bottom to top. Fixed order so a bar never re-sorts between buckets. */
const STACK: Array<{ key: string; kind: SegmentKind }> = [
  { key: 'netProductionMin', kind: 'running' },
  { key: 'availabilityLossMin', kind: 'downtime' },
  { key: 'externalLossMin', kind: 'external' },
  { key: 'plannedStopMin', kind: 'planned' },
  { key: 'unmeasuredMin', kind: 'unmeasured' },
];

// The axis label is not a fixed HH:mm any more. `trend()` buckets by hour or
// day, so on a multi-day window every bucket is midnight and every tick on
// the axis read `00:00`. `bucketLabels` picks the format from the bucket
// spacing, and formats in FACTORY time -- the old copy called getHours(),
// which is the browser's clock, three hours out for anyone not in +03.

export function AvailabilityPanel({
  availability, trend, netProductionMin, availabilityLossMin, production, distribution,
}: {
  availability: number | null;
  trend: AvailabilityTrendPoint[];
  netProductionMin: number;
  availabilityLossMin: number;
  production: { mttrMin: number | null; mtbfMin: number | null; downtimeCount: number; microstopCount: number };
  distribution: Distribution;
}) {
  const [tab, setTab] = React.useState<'distribution' | 'trend'>('distribution');
  // Which level of the reason tree is open. Null is the top — the time model.
  const [drill, setDrill] = React.useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const c = echartsAxisColours(isDark);

  const level = drill ? distribution.reasons.find((r) => r.key === drill) : null;
  const rows = level?.children ?? distribution.reasons;
  const shown = level
    ? { occurrence: level.occurrence, totalMin: level.minutes, medianMin: level.medianMin, averageMin: level.averageMin }
    : distribution;

  const tickLabels = bucketLabels(trend.map((p) => p.at));
  const data = trend.map((p, i) => ({
    // `at` rides along unplotted so the CSV export can lead with a real
    // timestamp — "07:00" on its own is not one. See exportCsv in chart-kit.
    at: p.at,
    t: tickLabels[i],
    availability: p.availability,
    ...Object.fromEntries(STACK.map((s) => [s.key, p.time?.[s.key] ?? 0])),
  }));

  return (
    <div className="flex flex-col gap-5">
      {/* ── The reading, and the same reading over time ── */}
      <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
        <Gauge label="Availability" value={availability} />
        <section className="rounded-lg border border-border/60 bg-card p-4">
          {/* One series, so no legend box — the heading names it. */}
          <h2 className="mb-3 text-sm font-semibold">Availability over time</h2>
          {data.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No buckets in this window yet.</p>
          ) : (
            <TrendChart
              data={data}
              height={220}
              series={[{ key: 'availability', name: 'Availability', colour: 'var(--viz-1)', emphasis: true }]}
              exportName="availability"
            />
          )}
        </section>
      </div>

      {/* ── The reliability pair ── */}
      <section className="rounded-lg border border-border/60 bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold">Availability KPIs</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Net production time" value={dur(netProductionMin)} />
          <Stat label="Availability loss" value={dur(availabilityLossMin)} tone="bad" />
          <Stat label="MTTR" value={production.mttrMin == null ? '—' : dur(production.mttrMin)}
            note={`${production.downtimeCount} failures`} />
          <Stat label="MTBF" value={production.mtbfMin == null ? '—' : dur(production.mtbfMin)}
            note="running time ÷ failures" />
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">
          Only <b>unplanned</b> stops count as failures. A break is not a breakdown, and counting one
          would shorten MTTR and lengthen MTBF at the same time — both figures improving because the
          plant took a scheduled lunch. Microstops are excluded from this pair as well, and there are{' '}
          {production.microstopCount} of them because nothing measures them yet.
        </p>
      </section>

      {/* ── What the time was spent on, and when ── */}
      <section className="rounded-lg border border-border/60 bg-card">
        <div className="flex gap-1 border-b border-border/60 px-3 pt-3">
          {(['distribution', 'trend'] as const).map((k) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-t-md px-3 py-1.5 text-xs capitalize transition-colors ${
                tab === k ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {k}
            </button>
          ))}
        </div>

        {tab === 'distribution' ? (
          <div className="p-4">
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
                {level ? `states inside ${level.label}` : 'status reasons by duration'}
              </span>
              <div className="ml-auto flex flex-wrap gap-5">
                <Mini label="Occurrence" value={String(shown.occurrence)} />
                <Mini label="Total" value={dur(shown.totalMin)} />
                <Mini label="Median" value={dur(shown.medianMin)} />
                <Mini label="Average" value={dur(shown.averageMin)} />
              </div>
            </div>

            {rows.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing recorded in this window.</p>
            ) : (
              <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
                <div className="h-[200px]">
                  <ReactECharts option={{
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
                    tooltip: {
                      trigger: 'item',
                      backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
                      textStyle: { color: c.tooltipText, fontSize: 12 },
                      formatter: (p: any) => `<div style="font-weight:600">${p.name}</div><div>${dur(p.value)}</div>`,
                    },
                    series: [{
                      type: 'pie', radius: [0, '76%'],
                      itemStyle: { borderColor: isDark ? '#0b0f1a' : '#ffffff', borderWidth: 2 },
                      label: { show: false }, labelLine: { show: false },
                      data: rows.map((r) => ({ name: r.label, value: r.minutes, itemStyle: { color: SEGMENT_COLOUR[r.kind] } })),
                    }],
                  }} notMerge style={{ height: '100%', width: '100%' }} />
                </div>

                {/* The list IS the legend — every slice named, timed and counted. */}
                <div className="grid gap-2 sm:grid-cols-2">
                  {rows.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => r.children?.length && setDrill(r.key)}
                      disabled={!r.children?.length}
                      className={`flex items-center gap-2 rounded-md border border-border/60 px-3 py-2 text-start text-xs ${
                        r.children?.length ? 'hover:bg-muted' : 'cursor-default'
                      }`}
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: SEGMENT_COLOUR[r.kind] }} />
                      <span className="truncate font-medium">{r.label}</span>
                      <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">
                        {dur(r.minutes)}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">×{r.occurrence}</span>
                      {!!r.children?.length && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-3 text-[11px] text-muted-foreground">
              Median as well as average, because stopped time is not evenly spread: one long
              breakdown among many short stops drags the average to a length no single stop ever
              was. Where they disagree, the median is the typical stop.
            </p>
          </div>
        ) : (
          <div className="p-4">
            <h3 className="mb-1 text-sm font-semibold">Utilization distribution</h3>
            <p className="mb-3 text-xs text-muted-foreground">
              The same minutes as the status band on Overview, one stacked bar per bucket — how each
              slice of the period was spent.
            </p>
            {data.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No buckets in this window yet.</p>
            ) : (
              <div className="h-[260px] w-full">
                <ReactECharts option={{
                  backgroundColor: 'transparent',
                  // Animation off — see the note on the first chart in this file.
                  animation: false,
                  grid: { top: 8, right: 12, bottom: 8, left: 8, containLabel: true },
                  tooltip: {
                    trigger: 'axis', axisPointer: { type: 'shadow' },
                    backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
                    textStyle: { color: c.tooltipText, fontSize: 12 },
                    formatter: (params: any[]) => {
                      const rows2 = params
                        .filter((p) => Number(p.value) > 0)
                        .map((p) => `<div style="display:flex;gap:12px;justify-content:space-between">`
                          + `<span style="opacity:.75">${p.marker}${p.seriesName}</span><b>${dur(Number(p.value))}</b></div>`)
                        .join('');
                      return `<div style="font-weight:600;margin-bottom:4px">${params[0]?.name ?? ''}</div>${rows2}`;
                    },
                  },
                  legend: {
                    bottom: 0, textStyle: { color: c.text, fontSize: 10 }, icon: 'circle', itemWidth: 8, itemHeight: 8,
                    data: STACK.map((s) => SEGMENT_LABEL[s.kind]),
                  },
                  xAxis: {
                    type: 'category', data: data.map((d) => d.t),
                    axisLabel: { color: c.text, fontSize: 10 }, axisLine: { lineStyle: { color: c.line } },
                  },
                  yAxis: {
                    type: 'value',
                    axisLabel: { color: c.text, fontSize: 10, formatter: '{value}m' },
                    splitLine: { lineStyle: { color: c.grid } }, axisLine: { show: false },
                  },
                  series: STACK.map((s) => ({
                    name: SEGMENT_LABEL[s.kind], type: 'bar', stack: 'time',
                    data: data.map((d: any) => d[s.key] ?? 0),
                    itemStyle: { color: SEGMENT_COLOUR[s.kind] },
                    barMaxWidth: 28,
                  })),
                }} notMerge style={{ height: '100%', width: '100%' }} />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: 'bad' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-xl font-semibold tabular-nums ${tone === 'bad' ? 'text-destructive' : ''}`}
        style={tone ? undefined : { color: STATUS.none === '' ? undefined : undefined }}>
        {value}
      </span>
      {note && <span className="font-mono text-[10px] text-muted-foreground">{note}</span>}
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
