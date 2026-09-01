'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';

interface ReliabilityPoint {
  month: string;
  mttr: number;
  mtbf: number;
}

interface MTTRMTBFChartProps {
  isLoading?: boolean;
  /** Analysis scope (area/line/machine) — keeps the trend in sync with the KPI cards. */
  scopeParams?: Record<string, string | undefined>;
  scopeKey?: string;
}

export function MTTRMTBFChart({ isLoading, scopeParams, scopeKey }: MTTRMTBFChartProps) {
  const { t } = useTranslation('common');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const { data, isLoading: trendLoading } = useQuery({
    queryKey: ['maintenance', 'reliability-trend', scopeKey ?? 'all'],
    queryFn: () => api.get<ReliabilityPoint[]>('/maintenance/reliability-trend', {
      params: { months: 6, ...(scopeParams ?? {}) },
    }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const points = data ?? [];
  const loading = isLoading || trendLoading;

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
        axisPointer: { type: 'cross' },
        backgroundColor: isDark ? '#1a1f2e' : '#ffffff',
        borderColor: isDark ? '#ffffff10' : '#00000010',
        textStyle: { color: isDark ? '#ffffff90' : '#000000', fontSize: 11 },
      },
      legend: {
        data: [t('charts.mttr.mttrHours'), t('charts.mttr.mtbfHours')],
        textStyle: { color: textColor, fontSize: 10 },
        right: 0, top: 0,
        icon: 'circle',
        itemWidth: 8, itemHeight: 8,
      },
      grid: { top: 36, left: 10, right: 50, bottom: 20, containLabel: true },
      xAxis: {
        type: 'category',
        data: points.map((d) => d.month),
        axisLabel: { color: textColor, fontSize: 10 },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: [
        {
          type: 'value',
          name: t('charts.mttr.mttrAxis'),
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { lineStyle: { color: gridColor } },
          axisLine: { show: false },
        },
        {
          type: 'value',
          name: t('charts.mttr.mtbfAxis'),
          nameTextStyle: { color: textColor, fontSize: 10 },
          axisLabel: { color: textColor, fontSize: 10 },
          splitLine: { show: false },
          axisLine: { show: false },
        },
      ],
      series: [
        {
          name: t('charts.mttr.mttrHours'),
          type: 'bar',
          data: points.map((d) => d.mttr),
          itemStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: '#f43f5e' }, { offset: 1, color: '#f43f5e40' }] },
            borderRadius: [3, 3, 0, 0],
          },
          barMaxWidth: 28,
        },
        {
          name: t('charts.mttr.mtbfHours'),
          type: 'line',
          yAxisIndex: 1,
          data: points.map((d) => d.mtbf),
          lineStyle: { color: '#22c55e', width: 2 },
          symbol: 'circle',
          symbolSize: 5,
          smooth: true,
          areaStyle: {
            color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [{ offset: 0, color: '#22c55e20' }, { offset: 1, color: 'transparent' }] },
          },
        },
      ],
    };
  }, [isDark, points, t]);

  return (
    <div className="industrial-card p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold">{t('charts.mttrMtbfTitle')}</h3>
        <p className="text-xs text-muted-foreground">{t('charts.mttrMtbf')}</p>
      </div>
      {loading ? (
        <div className="shimmer h-40 rounded-lg" />
      ) : points.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
          {t('charts.mttr.noData')}
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: '160px' }} notMerge />
      )}
    </div>
  );
}
