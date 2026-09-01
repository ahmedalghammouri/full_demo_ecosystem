'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';

const UTILITY_COLOR: Record<string, string> = {
  ELECTRICAL: '#eab308',
  NATURAL_GAS: '#f97316',
  COMPRESSED_AIR: '#06b6d4',
  WATER: '#0ea5e9',
  STEAM: '#a855f7',
  CHILLED_WATER: '#14b8a6',
};

/** Multi-utility daily consumption — one line per utility type present in the data. */
export function ConsumptionTrend({ chart, type = 'line' }: { chart: Array<Record<string, string | number>>; type?: 'area' | 'line' | 'bar' }) {
  const { t } = useTranslation('dashboard');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const types = useMemo(() => {
    const set = new Set<string>();
    for (const row of chart) for (const k of Object.keys(row)) if (k !== 'date') set.add(k);
    return [...set];
  }, [chart]);

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
    grid: { top: 30, right: 14, bottom: 24, left: 44 },
    tooltip: { trigger: 'axis' },
    legend: {
      data: types.map((ty) => t(`commandCenter.types.${ty}`, { defaultValue: ty })),
      textStyle: { color: isDark ? '#ffffff80' : '#00000080', fontSize: 10 }, top: 0,
    },
    xAxis: {
      type: 'category', data: chart.map((r) => r.date),
      axisLine: { lineStyle: { color: isDark ? '#ffffff20' : '#00000020' } },
      axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } },
      axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
    },
    series: types.map((ty) => {
      const color = UTILITY_COLOR[ty] ?? '#64748b';
      const name = t(`commandCenter.types.${ty}`, { defaultValue: ty });
      const series = chart.map((r) => (r[ty] as number) ?? 0);
      if (type === 'bar') {
        return { name, type: 'bar', stack: 'util', data: series, itemStyle: { color }, barMaxWidth: 26 };
      }
      return {
        name, type: 'line', smooth: true, showSymbol: false, data: series,
        lineStyle: { color, width: 2 }, itemStyle: { color },
        ...(type === 'area' ? { areaStyle: { color: `${color}26` } } : {}),
      };
    }),
  }), [chart, types, isDark, t, type]);

  if (chart.length === 0) {
    return <div className="flex h-56 items-center justify-center text-xs text-muted-foreground">{t('energyCenter.noConsumption')}</div>;
  }
  return <ReactECharts option={option} style={{ height: '260px', width: '100%' }} notMerge />;
}

/** Production-energy waste donut — running vs idle vs downtime kWh. */
export function WasteSplit({ waste }: { waste: { runningKwh: number; idleKwh: number; downtimeKwh: number } }) {
  const { t } = useTranslation('dashboard');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const total = waste.runningKwh + waste.idleKwh + waste.downtimeKwh;

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    tooltip: { trigger: 'item', formatter: '{b}: {c} kWh ({d}%)' },
    legend: { orient: 'vertical', right: 0, top: 'center', textStyle: { color: isDark ? '#ffffff90' : '#000000', fontSize: 10 }, itemWidth: 8, itemHeight: 8 },
    series: [
      {
        type: 'pie', radius: ['52%', '78%'], center: ['34%', '50%'],
        itemStyle: { borderColor: isDark ? '#0b0f1a' : '#ffffff', borderWidth: 2 },
        label: { show: false }, labelLine: { show: false },
        data: [
          { name: t('energyCenter.waste.running'), value: waste.runningKwh, itemStyle: { color: '#22c55e' } },
          { name: t('energyCenter.waste.idle'), value: waste.idleKwh, itemStyle: { color: '#f59e0b' } },
          { name: t('energyCenter.waste.downtime'), value: waste.downtimeKwh, itemStyle: { color: '#f43f5e' } },
        ],
      },
    ],
  }), [waste, isDark, t]);

  if (total === 0) {
    return <div className="flex h-44 items-center justify-center text-xs text-muted-foreground">{t('energyCenter.waste.noData')}</div>;
  }
  return <ReactECharts option={option} style={{ height: '180px', width: '100%' }} notMerge />;
}

export { UTILITY_COLOR };
