'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';

const STATUS_COLOR: Record<string, string> = {
  OPEN: '#4c7571',
  AWAITING_PARTS: '#f59e0b',
  ASSIGNED: '#06b6d4',
  IN_PROGRESS: '#22c55e',
  ON_HOLD: '#a855f7',
  COMPLETED: '#64748b',
  CANCELLED: '#475569',
};
const TYPE_COLOR: Record<string, string> = {
  CORRECTIVE: '#f43f5e',
  EMERGENCY: '#dc2626',
  PREVENTIVE: '#22c55e',
  PREDICTIVE: '#06b6d4',
  INSPECTION: '#4c7571',
  LUBRICATION: '#eab308',
};

/** Generic donut used for status & type breakdowns. */
export function BreakdownDonut({
  data,
}: {
  data: Array<{ name: string; label: string; value: number; color: string }>;
}) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const total = data.reduce((s, d) => s + d.value, 0);

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
    tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
    legend: {
      type: 'scroll', orient: 'vertical', right: 0, top: 'center',
      textStyle: { color: isDark ? '#ffffff90' : '#000000', fontSize: 10 },
      itemWidth: 8, itemHeight: 8,
    },
    series: [
      {
        type: 'pie',
        radius: ['52%', '78%'],
        center: ['34%', '50%'],
        avoidLabelOverlap: true,
        itemStyle: { borderColor: isDark ? '#0b0f1a' : '#ffffff', borderWidth: 2 },
        label: { show: true, position: 'center', formatter: () => `${total}`, fontSize: 22, fontWeight: 'bold', color: isDark ? '#fff' : '#111' },
        labelLine: { show: false },
        data: data.map((d) => ({ name: d.label, value: d.value, itemStyle: { color: d.color } })),
      },
    ],
  }), [data, isDark, total]);

  if (total === 0) return <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">—</div>;
  return <ReactECharts option={option} style={{ height: '180px', width: '100%' }} notMerge />;
}

/** Open-WO aging buckets — vertical bars colored by severity. */
export function AgingBars({ aging }: { aging: { lt1d: number; d1to3: number; d3to7: number; gt7d: number } }) {
  const { t } = useTranslation('maintenance');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const cats = [
    { key: 'lt1d', color: '#22c55e' },
    { key: 'd1to3', color: '#4c7571' },
    { key: 'd3to7', color: '#f59e0b' },
    { key: 'gt7d', color: '#f43f5e' },
  ] as const;

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    grid: { top: 16, right: 10, bottom: 22, left: 28 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'category',
      data: cats.map((c) => t(`cockpit.agingBuckets.${c.key}`)),
      axisLine: { lineStyle: { color: isDark ? '#ffffff20' : '#00000020' } },
      axisLabel: { color: isDark ? '#ffffff80' : '#00000080', fontSize: 9 },
    },
    yAxis: {
      type: 'value', minInterval: 1,
      splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } },
      axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 40,
        data: cats.map((c) => ({ value: aging[c.key], itemStyle: { color: c.color, borderRadius: [4, 4, 0, 0] } })),
      },
    ],
  }), [aging, isDark, t]);

  return <ReactECharts option={option} style={{ height: '180px', width: '100%' }} notMerge />;
}

/** Asset reliability — horizontal bar of failures per machine. */
export function AssetReliabilityChart({
  rows,
}: {
  rows: Array<{ name: string; failures: number; mttr: number }>;
}) {
  const { t } = useTranslation('maintenance');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  if (rows.length === 0) {
    return <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">{t('cockpit.noFailures')}</div>;
  }

  // ECharts horizontal bars render bottom→top; reverse so the worst is on top.
  const ordered = [...rows].reverse();
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    grid: { top: 10, right: 48, bottom: 20, left: 8, containLabel: true },
    tooltip: {
      trigger: 'axis', axisPointer: { type: 'shadow' },
      formatter: (p: any[]) => {
        const i = p[0];
        const row = ordered[i.dataIndex];
        return `${i.name}<br/>${t('cockpit.assetCol.failures')}: <b>${row.failures}</b><br/>${t('cockpit.assetCol.mttr')}: <b>${row.mttr}</b>`;
      },
    },
    xAxis: {
      type: 'value', minInterval: 1,
      splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } },
      axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
    },
    yAxis: {
      type: 'category',
      data: ordered.map((r) => r.name),
      axisLine: { lineStyle: { color: isDark ? '#ffffff20' : '#00000020' } },
      axisLabel: { color: isDark ? '#ffffff90' : '#00000090', fontSize: 10 },
    },
    series: [
      {
        type: 'bar',
        barMaxWidth: 18,
        data: ordered.map((r) => r.failures),
        itemStyle: {
          color: { type: 'linear', x: 0, y: 0, x2: 1, y2: 0, colorStops: [{ offset: 0, color: '#f43f5e80' }, { offset: 1, color: '#f43f5e' }] },
          borderRadius: [0, 4, 4, 0],
        },
        label: { show: true, position: 'right', color: isDark ? '#ffffff90' : '#00000090', fontSize: 10, formatter: '{c}' },
      },
    ],
  }), [ordered, isDark, t]);

  return <ReactECharts option={option} style={{ height: '260px', width: '100%' }} notMerge />;
}

export { STATUS_COLOR, TYPE_COLOR };
