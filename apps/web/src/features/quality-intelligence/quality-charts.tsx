'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';

const SEVERITY_COLOR: Record<string, string> = { CRITICAL: '#f43f5e', MAJOR: '#f59e0b', MINOR: '#eab308' };
const RESULT_COLOR: Record<string, string> = { PASS: '#22c55e', CONDITIONAL: '#f59e0b', FAIL: '#f43f5e', PENDING: '#64748b' };
const CAPA_COLOR: Record<string, string> = { OPEN: '#4c7571', IN_PROGRESS: '#f59e0b', VERIFIED: '#06b6d4', CLOSED: '#22c55e' };
const NCR_STATUS_COLOR: Record<string, string> = { OPEN: '#f43f5e', IN_REVIEW: '#f59e0b', CAPA_PENDING: '#a855f7', RESOLVED: '#06b6d4', CLOSED: '#22c55e' };

/** First-pass-yield trend (line, 0–100%). */
export function FpyTrend({ data, type = 'area' }: { data: Array<{ time: string; fpy: number }>; type?: 'area' | 'line' | 'bar' }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const option = useMemo(() => ({
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
    grid: { top: 12, right: 14, bottom: 22, left: 38 },
    tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}%` },
    xAxis: {
      type: 'category', data: data.map((d) => d.time),
      axisLine: { lineStyle: { color: isDark ? '#ffffff20' : '#00000020' } },
      axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
    },
    yAxis: {
      type: 'value', min: 0, max: 100,
      splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } },
      axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9, formatter: '{value}%' },
    },
    series: [
      type === 'bar'
        ? {
            type: 'bar', data: data.map((d) => d.fpy),
            itemStyle: { color: '#22c55e', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22,
            markLine: { silent: true, symbol: 'none', lineStyle: { color: '#f59e0b80', type: 'dashed' }, data: [{ yAxis: 95 }] },
          }
        : {
            type: 'line', smooth: true, showSymbol: false, data: data.map((d) => d.fpy),
            lineStyle: { color: '#22c55e', width: 2 },
            ...(type === 'area' ? { areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#22c55e30' }, { offset: 1, color: 'transparent' }] } } } : {}),
            markLine: { silent: true, symbol: 'none', lineStyle: { color: '#f59e0b80', type: 'dashed' }, data: [{ yAxis: 95 }] },
          },
    ],
  }), [data, isDark, type]);
  return <ReactECharts option={option} style={{ height: '180px', width: '100%' }} notMerge />;
}

/** Defect Pareto — NCR quantity bars + cumulative % line. */
export function DefectPareto({ data }: { data: Array<{ category: string; quantity: number; count: number; cumulative: number }> }) {
  const { t } = useTranslation('quality');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  if (data.length === 0) return <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">{t('cockpit.noDefects')}</div>;

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    grid: { top: 20, right: 44, bottom: 40, left: 40 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'category', data: data.map((d) => d.category),
      axisLine: { lineStyle: { color: isDark ? '#ffffff20' : '#00000020' } },
      axisLabel: { color: isDark ? '#ffffff80' : '#00000080', fontSize: 9, interval: 0, rotate: data.length > 4 ? 22 : 0 },
    },
    yAxis: [
      { type: 'value', splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } }, axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 } },
      { type: 'value', max: 100, splitLine: { show: false }, axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9, formatter: '{value}%' } },
    ],
    series: [
      {
        type: 'bar', barMaxWidth: 38, data: data.map((d) => d.quantity),
        itemStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#a855f7' }, { offset: 1, color: '#a855f740' }] }, borderRadius: [4, 4, 0, 0] },
      },
      {
        type: 'line', yAxisIndex: 1, smooth: true, data: data.map((d) => d.cumulative),
        lineStyle: { color: '#f43f5e', width: 2 }, itemStyle: { color: '#f43f5e' }, symbolSize: 5,
      },
    ],
  }), [data, isDark]);
  return <ReactECharts option={option} style={{ height: '240px', width: '100%' }} notMerge />;
}

/** Generic labelled bar list (severity, CAPA, inspection results). */
export function CategoryBars({
  rows, palette, labelNs,
}: {
  rows: Array<{ key: string; count: number }>;
  palette: Record<string, string>;
  labelNs: string;
}) {
  const { t } = useTranslation('quality');
  const peak = Math.max(...rows.map((r) => r.count), 1);
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return <div className="flex h-32 items-center justify-center text-xs text-muted-foreground">—</div>;
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const color = palette[r.key] ?? '#64748b';
        return (
          <div key={r.key}>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span style={{ color }}>{t(`${labelNs}.${r.key}`, { defaultValue: r.key })}</span>
              <span className="font-semibold tabular-nums text-foreground">{r.count}</span>
            </div>
            <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(r.count / peak) * 100}%`, backgroundColor: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { SEVERITY_COLOR, RESULT_COLOR, CAPA_COLOR, NCR_STATUS_COLOR };
