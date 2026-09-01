'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';

interface DowntimeParetoProps {
  data?: Array<{ reason: string; duration: number; frequency: number; cumulative: number }>;
  isLoading?: boolean;
}

export function DowntimePareto({ data, isLoading }: DowntimeParetoProps) {
  const { t } = useTranslation('common');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo(() => {
    const textColor = isDark ? '#ffffff50' : '#00000050';
    const gridColor = isDark ? '#ffffff10' : '#00000010';

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
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: isDark ? '#1a1f2e' : '#ffffff',
        borderColor: isDark ? '#ffffff10' : '#00000010',
        textStyle: { color: isDark ? '#ffffff90' : '#000000', fontSize: 11 },
      },
      legend: {
        data: [t('charts.pareto.downtimeMin'), t('charts.pareto.cumulativePct')],
        textStyle: { color: textColor, fontSize: 10 },
        right: 0, top: 0,
        icon: 'circle',
        itemWidth: 8, itemHeight: 8,
      },
      grid: { top: 36, left: 10, right: 10, bottom: 30, containLabel: true },
      xAxis: {
        type: 'category',
        data: data?.map((d) => d.reason) ?? [],
        axisLabel: { color: textColor, fontSize: 9, rotate: 20 },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: [
        {
          type: 'value',
          name: t('charts.pareto.min'),
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor } },
          axisLine: { show: false },
        },
        {
          type: 'value',
          name: '%',
          min: 0, max: 100,
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10, formatter: '{value}%' },
          splitLine: { show: false },
          axisLine: { show: false },
        },
      ],
      series: [
        {
          name: t('charts.pareto.downtimeMin'),
          type: 'bar',
          data: data?.map((d) => d.duration) ?? [],
          itemStyle: {
            color: {
              type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: '#f59e0b' }, { offset: 1, color: '#f59e0b40' }],
            },
            borderRadius: [3, 3, 0, 0],
          },
          barMaxWidth: 28,
        },
        {
          name: t('charts.pareto.cumulativePct'),
          type: 'line',
          yAxisIndex: 1,
          data: data?.map((d) => d.cumulative) ?? [],
          lineStyle: { color: '#f43f5e', width: 2 },
          symbol: 'circle',
          symbolSize: 5,
          smooth: false,
          itemStyle: { color: '#f43f5e' },
        },
      ],
    };
  }, [data, isDark, t]);

  return (
    <div className="industrial-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{t('charts.downtimePareto')}</h3>
        <p className="text-xs text-muted-foreground">{t('charts.downtimeParetoSub')}</p>
      </div>
      {isLoading ? (
        <div className="shimmer h-48 rounded-lg" />
      ) : (
        <ReactECharts option={option} style={{ height: '200px' }} notMerge />
      )}
    </div>
  );
}
