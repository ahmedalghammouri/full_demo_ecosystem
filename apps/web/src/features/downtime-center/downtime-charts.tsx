'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import type { TrendType } from '@/store/dashboard-prefs-store';

const axis = (isDark: boolean) => ({
  axisLine: { lineStyle: { color: isDark ? '#ffffff20' : '#00000020' } },
  axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
});

/** Planned vs unplanned downtime over the window — render style from the toolbar. */
export function DowntimeTrend({ data, type = 'bar' }: { data: Array<{ date: string; planned: number; unplanned: number }>; type?: TrendType }) {
  const { t } = useTranslation('downtime');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const option = useMemo(() => {
    const series = (name: string, key: 'planned' | 'unplanned', color: string) =>
      type === 'bar'
        ? { name, type: 'bar', stack: 'dt', data: data.map((d) => d[key]), itemStyle: { color }, barMaxWidth: 26 }
        : {
            name, type: 'line', smooth: true, showSymbol: false, stack: type === 'area' ? 'dt' : undefined,
            data: data.map((d) => d[key]), lineStyle: { color, width: 2 }, itemStyle: { color },
            ...(type === 'area' ? { areaStyle: { color: `${color}33` } } : {}),
          };
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
      grid: { top: 28, right: 10, bottom: 22, left: 38 },
      tooltip: { trigger: 'axis' },
      legend: { top: 0, textStyle: { color: isDark ? '#ffffff80' : '#00000080', fontSize: 10 } },
      xAxis: { type: 'category', data: data.map((d) => d.date), ...axis(isDark) },
      yAxis: { type: 'value', name: 'min', splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } }, ...axis(isDark) },
      series: [
        series(t('cockpit.unplanned'), 'unplanned', '#f43f5e'),
        series(t('cockpit.planned'), 'planned', '#4c7571'),
      ],
    };
  }, [data, isDark, type, t]);
  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />;
}

/** Downtime minutes by machine — horizontal bars. */
export function DowntimeByMachine({ data }: { data: Array<{ name: string; minutes: number }> }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const rows = [...data].reverse();
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    grid: { top: 8, right: 16, bottom: 18, left: 8, containLabel: true },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } }, ...axis(isDark) },
    yAxis: { type: 'category', data: rows.map((d) => d.name), ...axis(isDark) },
    series: [{
      type: 'bar', data: rows.map((d) => d.minutes),
      itemStyle: { color: '#f59e0b', borderRadius: [0, 3, 3, 0] }, barMaxWidth: 18,
    }],
  }), [rows, isDark]);
  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />;
}

/** Category Pareto — minutes bars + cumulative % line. */
export function CategoryPareto({ data }: { data: Array<{ category: string; minutes: number; cumulativePct: number }> }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    grid: { top: 16, right: 36, bottom: 40, left: 38 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'category', data: data.map((d) => d.category), axisLine: { lineStyle: { color: isDark ? '#ffffff20' : '#00000020' } }, axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9, interval: 0, rotate: data.length > 4 ? 24 : 0 } },
    yAxis: [
      { type: 'value', name: 'min', splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } }, ...axis(isDark) },
      { type: 'value', max: 100, axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9, formatter: '{value}%' }, splitLine: { show: false } },
    ],
    series: [
      { type: 'bar', data: data.map((d) => d.minutes), itemStyle: { color: '#f43f5e', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 36 },
      { type: 'line', yAxisIndex: 1, data: data.map((d) => d.cumulativePct), smooth: true, lineStyle: { color: '#eab308', width: 2 }, itemStyle: { color: '#eab308' }, symbolSize: 5 },
    ],
  }), [data, isDark]);
  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />;
}

/** Planned vs unplanned split donut. */
export function PlannedSplit({ planned, unplanned }: { planned: number; unplanned: number }) {
  const { t } = useTranslation('downtime');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const total = planned + unplanned;
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    tooltip: { trigger: 'item', formatter: '{b}: {c} min ({d}%)' },
    legend: { orient: 'vertical', right: 0, top: 'center', textStyle: { color: isDark ? '#ffffff90' : '#000000', fontSize: 10 }, itemWidth: 8, itemHeight: 8 },
    series: [{
      type: 'pie', radius: ['52%', '78%'], center: ['36%', '50%'],
      itemStyle: { borderColor: isDark ? '#0b0f1a' : '#ffffff', borderWidth: 2 },
      label: { show: false }, labelLine: { show: false },
      data: [
        { name: t('cockpit.unplanned'), value: unplanned, itemStyle: { color: '#f43f5e' } },
        { name: t('cockpit.planned'), value: planned, itemStyle: { color: '#4c7571' } },
      ],
    }],
  }), [planned, unplanned, isDark, t]);
  if (total === 0) return <div className="flex h-full items-center justify-center text-xs text-muted-foreground">{t('cockpit.noData')}</div>;
  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />;
}
