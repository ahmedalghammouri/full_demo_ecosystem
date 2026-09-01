'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { BarChart3 } from 'lucide-react';

interface ProductionTrendProps {
  data?: Array<{ time: string; actual: number; target: number; efficiency: number }>;
  isLoading?: boolean;
  /** Render style for the primary (actual output) series, driven by the toolbar. */
  trendType?: 'area' | 'line' | 'bar';
}

export function ProductionTrendChart({ data, isLoading, trendType = 'bar' }: ProductionTrendProps) {
  const { t } = useTranslation('common');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const option = useMemo(() => {
    const textColor = isDark ? '#ffffff50' : '#00000050';
    const gridColor = isDark ? '#ffffff10' : '#00000010';

    const times = data?.map((d) => d.time) ?? [];
    const actual = data?.map((d) => d.actual) ?? [];
    const target = data?.map((d) => d.target) ?? [];
    const efficiency = data?.map((d) => d.efficiency) ?? [];

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
        axisPointer: { type: 'cross' },
        backgroundColor: isDark ? '#1a1f2e' : '#ffffff',
        borderColor: isDark ? '#ffffff10' : '#00000010',
        textStyle: { color: isDark ? '#ffffff90' : '#000000' },
      },
      legend: {
        data: [t('charts.production.actualOutput'), t('charts.production.target'), t('charts.production.efficiencyPct')],
        textStyle: { color: textColor, fontSize: 11 },
        icon: 'circle',
        itemWidth: 8,
        itemHeight: 8,
        right: 0,
        top: 0,
      },
      grid: {
        top: 36,
        left: 10,
        right: 10,
        bottom: 20,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: times,
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: gridColor } },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: t('charts.production.units'),
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor } },
          axisLine: { show: false },
        },
        {
          type: 'value',
          name: '%',
          nameTextStyle: { color: textColor, fontSize: 10 },
          min: 0,
          max: 100,
          axisLabel: { color: textColor, fontSize: 10, formatter: '{value}%' },
          splitLine: { show: false },
          axisLine: { show: false },
        },
      ],
      series: [
        trendType === 'bar'
          ? {
              name: t('charts.production.actualOutput'),
              type: 'bar',
              data: actual,
              itemStyle: {
                color: {
                  type: 'linear',
                  x: 0, y: 0, x2: 0, y2: 1,
                  colorStops: [
                    { offset: 0, color: '#4c7571' },
                    { offset: 1, color: '#4c757130' },
                  ],
                },
                borderRadius: [3, 3, 0, 0],
              },
              barMaxWidth: 32,
            }
          : {
              name: t('charts.production.actualOutput'),
              type: 'line',
              data: actual,
              lineStyle: { color: '#4c7571', width: 2 },
              symbol: 'circle', symbolSize: 4, smooth: true,
              ...(trendType === 'area'
                ? { areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: '#4c757140' }, { offset: 1, color: 'transparent' }] } } }
                : {}),
            },
        {
          name: t('charts.production.target'),
          type: 'line',
          data: target,
          lineStyle: { color: '#f59e0b', width: 2, type: 'dashed' },
          symbol: 'none',
          smooth: true,
        },
        {
          name: t('charts.production.efficiencyPct'),
          type: 'line',
          yAxisIndex: 1,
          data: efficiency,
          lineStyle: { color: '#22c55e', width: 2 },
          symbol: 'circle',
          symbolSize: 4,
          smooth: true,
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: '#22c55e30' }, { offset: 1, color: 'transparent' }] },
          },
        },
      ],
    };
  }, [data, isDark, t, trendType]);

  return (
    <div className="industrial-card p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('charts.productionOutput')}</h3>
          <p className="text-xs text-muted-foreground">{t('charts.actualVsTarget')}</p>
        </div>
        <BarChart3 size={16} className="text-muted-foreground" />
      </div>
      {isLoading ? (
        <div className="shimmer h-48 rounded-lg" />
      ) : (
        <ReactECharts option={option} style={{ height: '200px' }} notMerge />
      )}
    </div>
  );
}
