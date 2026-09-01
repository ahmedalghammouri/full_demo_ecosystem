'use client';
/**
 * The Performance analysis: the reading, its trend, output against the goal, and
 * two ways of watching that gap open.
 *
 * ── Why the two tabs are not the same chart twice ───────────────────────────
 * Production over time shows each bucket on its own, so a slow hour is a short
 * bar next to a tall goal and you can point at it. Target trending accumulates
 * from zero, so the gap between the two lines is the shortfall to date and a
 * FLAT stretch is a stop — the shape says "nothing was made here" in a way a
 * per-bucket chart, where a stop is just a missing bar, does not.
 *
 * Both plot parts against parts on one axis. Neither has a second y-scale,
 * which is the one thing that would make the gap between the lines a lie.
 */
import React from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';

import { Gauge, pctText, TrendChart, echartsAxisColours, resolveChartColour } from './chart-kit';
import { bucketLabels } from '@/lib/datetime';

export interface PerformanceTrendPoint {
  at: string;
  performance: number | null;
  counts: { good: number; rejected: number; total: number; theoretical: number };
  time: Record<string, number>;
}

/**
 * The three series, fixed. Good parts is off by default because it sits between
 * the other two and, on a line that scraps little, hugs Total closely enough to
 * read as noise until you go looking for it.
 */
const SERIES = [
  { key: 'total', name: 'Total parts', colour: 'var(--viz-1)', onByDefault: true },
  { key: 'goal', name: 'Production goal', colour: 'var(--viz-2)', onByDefault: true },
  { key: 'good', name: 'Good parts', colour: 'var(--viz-3)', onByDefault: false },
] as const;

// The axis label is not a fixed HH:mm any more. `trend()` buckets by hour or
// day, so on a multi-day window every bucket is midnight and every tick on
// the axis read `00:00`. `bucketLabels` picks the format from the bucket
// spacing, and formats in FACTORY time -- the old copy called getHours(),
// which is the browser's clock, three hours out for anyone not in +03.
// 'en-US' pinned, not the runtime default: `.toLocaleString()` with no
// locale follows Node's ICU default on the server and the visitor's OWN
// BROWSER LANGUAGE on the client — an Arabic-language browser renders
// different digit grouping than the server, which is a hydration text
// mismatch (React error #418) on every number this formats.
const num = (n: number) => Math.round(n).toLocaleString('en-US');

/** Parts per minute, or null when there were no minutes to spread them over. */
const perMinute = (parts: number, minutes: number) => (minutes > 0 ? parts / minutes : null);

export function PerformancePanel({
  performance, trend, counts, netProductionMin,
}: {
  performance: number | null;
  trend: PerformanceTrendPoint[];
  counts: { good: number; rejected: number; total: number; theoretical: number };
  netProductionMin: number;
}) {
  const [tab, setTab] = React.useState<'overTime' | 'target'>('overTime');
  const [hidden, setHidden] = React.useState<Set<string>>(
    () => new Set(SERIES.filter((s) => !s.onByDefault).map((s) => s.key)),
  );
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const c = echartsAxisColours(isDark);
  const vizColour = (v: string) => resolveChartColour(v, isDark);

  const tickLabels = bucketLabels(trend.map((p) => p.at));

  const overTime = trend.map((p, i) => ({
    t: tickLabels[i],
    produced: p.counts?.total ?? 0,
    goal: p.counts?.theoretical ?? 0,
  }));

  // Accumulated from zero, in order. A flat stretch is time nothing was made in.
  const cumulative = React.useMemo(() => {
    let total = 0, goal = 0, good = 0;
    return trend.map((p, i) => {
      total += p.counts?.total ?? 0;
      goal += p.counts?.theoretical ?? 0;
      good += p.counts?.good ?? 0;
      return { t: tickLabels[i], total, goal, good };
    });
  }, [trend, tickLabels]);

  const produced = overTime.map((p) => p.produced);
  const avg = produced.length ? produced.reduce((a, b) => a + b, 0) / produced.length : 0;

  // The gap to the goal, as the reference states it: how far short of the
  // theoretical output the line came, as a share of that output.
  const shortfall = counts.theoretical > 0
    ? (1 - counts.total / counts.theoretical) * 100
    : null;

  const actualPerMin = perMinute(counts.total, netProductionMin);
  const goalPerMin = perMinute(counts.theoretical, netProductionMin);

  const toggle = (key: string) =>
    setHidden((h) => {
      const next = new Set(h);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col gap-5">
      {/* ── The reading, and the same reading over time ── */}
      <div className="grid gap-3 lg:grid-cols-[200px_1fr]">
        <Gauge label="Performance" value={performance} />
        <section className="rounded-lg border border-border/60 bg-card p-4">
          {/* One series, so no legend box — the heading names it. */}
          <h2 className="mb-3 text-sm font-semibold">Performance over time</h2>
          {trend.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No buckets in this window yet.</p>
          ) : (
            <TrendChart
              data={trend.map((p, i) => ({ at: p.at, t: tickLabels[i], performance: p.performance }))}
              height={220}
              series={[{ key: 'performance', name: 'Performance', colour: 'var(--viz-2)', emphasis: true }]}
              exportName="performance"
            />
          )}
        </section>
      </div>

      {/* ── Output against the goal: totals, then rate ── */}
      <div className="grid gap-3 lg:grid-cols-2">
        <GoalCard title="Total production" produced={counts.total} goal={counts.theoretical}
          shortfall={shortfall} unit="pcs" />
        <GoalCard title="Production per minute" produced={actualPerMin} goal={goalPerMin}
          shortfall={shortfall} unit="pcs/min" decimals={1}
          note="The same ratio as the totals — both are output over theoretical output, so the gap cannot differ between them." />
      </div>

      {/* ── The two ways of watching the gap ── */}
      <section className="rounded-lg border border-border/60 bg-card">
        <div className="flex gap-1 border-b border-border/60 px-3 pt-3">
          {([['overTime', 'Production over time'], ['target', 'Target trending']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`rounded-t-md px-3 py-1.5 text-xs transition-colors ${
                tab === k ? 'bg-muted font-semibold text-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {trend.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No buckets in this window yet.</p>
        ) : tab === 'overTime' ? (
          <div className="p-4">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
              <Mini label="Avg" value={`${num(avg)} pcs`} />
              <Mini label="Min" value={`${num(Math.min(...produced))} pcs`} />
              <Mini label="Max" value={`${num(Math.max(...produced))} pcs`} />
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              Parts made in each bucket against what the design speed says the machine could have
              made in the minutes it was actually running. A bar short of its point is an hour the
              line ran slow; a bar over it is an hour it caught up.
            </p>
            <div className="h-[280px] w-full">
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
                grid: { top: 8, right: 12, bottom: 32, left: 8, containLabel: true },
                tooltip: {
                  trigger: 'axis', axisPointer: { type: 'shadow' },
                  backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
                  textStyle: { color: c.tooltipText, fontSize: 12 },
                  formatter: (params: any[]) => {
                    const rows2 = params.map((p) => `<div style="display:flex;gap:12px;justify-content:space-between">`
                      + `<span style="opacity:.75">${p.marker}${p.seriesName}</span><b>${num(Number(p.value))} pcs</b></div>`)
                      .join('');
                    return `<div style="font-weight:600;margin-bottom:4px">${params[0]?.name ?? ''}</div>${rows2}`;
                  },
                },
                legend: {
                  bottom: 0, textStyle: { color: c.text, fontSize: 11 }, icon: 'circle', itemWidth: 8, itemHeight: 8,
                  data: ['Current produced', 'Production goal'],
                },
                xAxis: {
                  type: 'category', data: overTime.map((p) => p.t),
                  axisLabel: { color: c.text, fontSize: 11 }, axisLine: { lineStyle: { color: c.line } },
                },
                // One axis. Both series are parts; a second scale would make the
                // distance between bar and line mean nothing.
                yAxis: {
                  type: 'value',
                  axisLabel: { color: c.text, fontSize: 11 },
                  splitLine: { lineStyle: { color: c.grid } }, axisLine: { show: false },
                },
                series: [
                  {
                    name: 'Current produced', type: 'bar',
                    data: overTime.map((p) => p.produced),
                    itemStyle: { color: vizColour('var(--viz-1)'), borderRadius: [3, 3, 0, 0] },
                    barMaxWidth: 28,
                  },
                  {
                    name: 'Production goal', type: 'line',
                    data: overTime.map((p) => p.goal),
                    lineStyle: { color: vizColour('var(--viz-2)'), width: 2 },
                    itemStyle: { color: vizColour('var(--viz-2)') },
                    symbol: 'circle', symbolSize: 8, showSymbol: true,
                  },
                ],
              }} notMerge style={{ height: '100%', width: '100%' }} />
            </div>
          </div>
        ) : (
          <div className="p-4">
            <p className="mb-3 text-xs text-muted-foreground">
              Both counters from zero. The distance between the lines is the shortfall to date, and a
              <b> flat stretch is a stop</b> — nothing was made while it lasted. Click a name to show
              or hide a line.
            </p>
            <div className="h-[300px] w-full">
              <ReactECharts option={{
                backgroundColor: 'transparent',
                // Animation off — see the note on the first chart in this file.
                animation: false,
                grid: { top: 8, right: 12, bottom: 8, left: 8, containLabel: true },
                tooltip: {
                  trigger: 'axis', axisPointer: { type: 'line' },
                  backgroundColor: c.tooltipBg, borderColor: c.tooltipBorder,
                  textStyle: { color: c.tooltipText, fontSize: 12 },
                  formatter: (params: any[]) => {
                    const rows2 = params.map((p) => `<div style="display:flex;gap:12px;justify-content:space-between">`
                      + `<span style="opacity:.75">${p.marker}${p.seriesName}</span><b>${num(Number(p.value))}</b></div>`)
                      .join('');
                    return `<div style="font-weight:600;margin-bottom:4px">${params[0]?.name ?? ''}</div>${rows2}`;
                  },
                },
                xAxis: {
                  type: 'category', data: cumulative.map((p) => p.t),
                  axisLabel: { color: c.text, fontSize: 11 }, axisLine: { lineStyle: { color: c.line } },
                },
                yAxis: {
                  type: 'value',
                  axisLabel: { color: c.text, fontSize: 11 },
                  splitLine: { lineStyle: { color: c.grid } }, axisLine: { show: false },
                },
                series: SERIES.filter((s) => !hidden.has(s.key)).map((s) => ({
                  name: s.name, type: 'line',
                  data: cumulative.map((p: any) => p[s.key]),
                  lineStyle: { color: vizColour(s.colour), width: 2 },
                  itemStyle: { color: vizColour(s.colour) },
                  showSymbol: false, symbol: 'circle',
                })),
              }} notMerge style={{ height: '100%', width: '100%' }} />
            </div>
            {/* The legend is a control, so it is a real one — colour never carries
                identity alone, and a hidden series stays visibly available. */}
            <div className="mt-3 flex flex-wrap gap-3">
              {SERIES.map((s) => (
                <button key={s.key} onClick={() => toggle(s.key)}
                  className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px] transition-opacity hover:bg-muted ${
                    hidden.has(s.key) ? 'opacity-40' : ''
                  }`}>
                  <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.colour }} />
                  <span className={hidden.has(s.key) ? 'line-through' : ''}>{s.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Produced against the goal, with the gap named.
 *
 * The bar is the ratio and the numbers beside it are the ratio too — the bar is
 * there for the glance, not instead of the figures.
 */
function GoalCard({
  title, produced, goal, shortfall, unit, decimals = 0, note,
}: {
  title: string; produced: number | null; goal: number | null;
  shortfall: number | null; unit: string; decimals?: number; note?: string;
}) {
  const fmt = (n: number | null) =>
    // 'en-US', not undefined — see num() above for why.
    n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: decimals, minimumFractionDigits: decimals });
  const ratio = produced != null && goal != null && goal > 0 ? Math.min(1, produced / goal) : 0;
  const over = shortfall != null && shortfall < 0;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">{title}</span>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Produced</span>
          <span className="font-mono text-lg tabular-nums">
            {fmt(produced)} <span className="text-xs text-muted-foreground">of {fmt(goal)} {unit}</span>
          </span>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {over ? 'Ahead of goal' : 'Difference to goal'}
          </span>
          <span className={`font-mono text-lg tabular-nums ${over ? 'text-emerald-600' : 'text-destructive'}`}>
            {shortfall == null ? '—' : `${Math.abs(shortfall).toFixed(2)}%`}
          </span>
        </div>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-[var(--viz-1)]" style={{ width: `${ratio * 100}%` }} />
      </div>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="font-mono text-lg tabular-nums">{value}</span>
    </div>
  );
}
