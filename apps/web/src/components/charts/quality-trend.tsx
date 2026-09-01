'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';

interface QualityTrendProps {
  data?: Array<{ time: string; fpy: number; rework: number; scrap: number }>;
  isLoading?: boolean;
  /** Render style for the primary (FPY) series, driven by the toolbar. */
  trendType?: 'area' | 'line' | 'bar';
}

export function QualityTrendChart({ data, isLoading, trendType = 'area' }: QualityTrendProps) {
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
        backgroundColor: isDark ? '#1a1f2e' : '#ffffff',
        borderColor: isDark ? '#ffffff10' : '#00000010',
        textStyle: { color: isDark ? '#ffffff90' : '#000000', fontSize: 11 },
      },
      legend: {
        data: [t('charts.qualityTrendSeries.fpy'), t('charts.qualityTrendSeries.rework'), t('charts.qualityTrendSeries.scrap')],
        textStyle: { color: textColor, fontSize: 10 },
        right: 0, top: 0,
        icon: 'circle',
        itemWidth: 8, itemHeight: 8,
      },
      grid: { top: 36, left: 10, right: 10, bottom: 20, containLabel: true },
      xAxis: {
        type: 'category',
        data: data?.map((d) => d.time) ?? [],
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: gridColor } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        min: 80,
        max: 100,
        axisLabel: { color: textColor, fontSize: 10, formatter: '{value}%' },
        splitLine: { lineStyle: { color: gridColor } },
        axisLine: { show: false },
      },
      series: [
        trendType === 'bar'
          ? {
              name: t('charts.qualityTrendSeries.fpy'),
              type: 'bar',
              data: data?.map((d) => d.fpy) ?? [],
              itemStyle: { color: '#22c55e', borderRadius: [3, 3, 0, 0] },
              barMaxWidth: 24,
            }
          : {
              name: t('charts.qualityTrendSeries.fpy'),
              type: 'line',
              data: data?.map((d) => d.fpy) ?? [],
              lineStyle: { color: '#22c55e', width: 2 },
              symbol: 'circle', symbolSize: 4,
              smooth: true,
              ...(trendType === 'area'
                ? { areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#22c55e25' }, { offset: 1, color: 'transparent' }] } } }
                : {}),
            },
        {
          name: t('charts.qualityTrendSeries.rework'),
          type: 'line',
          data: data?.map((d) => d.rework) ?? [],
          lineStyle: { color: '#f59e0b', width: 2, type: 'dashed' },
          symbol: 'none', smooth: true,
        },
        {
          name: t('charts.qualityTrendSeries.scrap'),
          type: 'line',
          data: data?.map((d) => d.scrap) ?? [],
          lineStyle: { color: '#f43f5e', width: 2, type: 'dashed' },
          symbol: 'none', smooth: true,
        },
      ],
    };
  }, [data, isDark, t, trendType]);

  return (
    <div className="industrial-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">{t('charts.qualityTrend')}</h3>
        <p className="text-xs text-muted-foreground">{t('charts.fpyDefects')}</p>
      </div>
      {isLoading ? (
        <div className="shimmer h-48 rounded-lg" />
      ) : (
        <ReactECharts option={option} style={{ height: '200px' }} notMerge />
      )}
    </div>
  );
}
