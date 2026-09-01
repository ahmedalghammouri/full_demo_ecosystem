'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';

interface SPCChartProps {
  title?: string;
  data?: Array<{ sample: number; value: number; time: string }>;
  ucl?: number;
  lcl?: number;
  mean?: number;
  usl?: number;
  lsl?: number;
  isLoading?: boolean;
}

export function SPCChart({
  title,
  data,
  ucl,
  lcl,
  mean,
  usl,
  lsl,
  isLoading,
}: SPCChartProps) {
  const { t } = useTranslation('common');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const resolvedTitle = title ?? t('charts.spc.title');

  const chartData = data ?? [];
  const hasData = chartData.length > 0;

  const option = useMemo(() => {
    const textColor = isDark ? '#ffffff50' : '#00000050';
    const gridColor = isDark ? '#ffffff10' : '#00000010';
    const values = chartData.map((d) => d.value);

    const markLines = [
      mean != null && { yAxis: mean, name: t('charts.spc.mean'), lineStyle: { color: '#22c55e', type: 'solid' } },
      ucl != null && { yAxis: ucl, name: 'UCL', lineStyle: { color: '#f59e0b', type: 'dashed' } },
      lcl != null && { yAxis: lcl, name: 'LCL', lineStyle: { color: '#f59e0b', type: 'dashed' } },
      usl != null && { yAxis: usl, name: 'USL', lineStyle: { color: '#f43f5e', type: 'dotted' } },
      lsl != null && { yAxis: lsl, name: 'LSL', lineStyle: { color: '#f43f5e', type: 'dotted' } },
    ].filter(Boolean);

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
        formatter: (params: Array<{ name: string; value: number }>) => {
          const pt = params[0];
          const isOOC = (ucl != null && pt.value > ucl) || (lcl != null && pt.value < lcl);
          return `${pt.name}<br/>${t('charts.spc.value')}: <b>${pt.value.toFixed(3)}</b>${isOOC ? ' ⚠️ OOC' : ''}`;
        },
        backgroundColor: isDark ? '#1a1f2e' : '#ffffff',
        borderColor: isDark ? '#ffffff10' : '#00000010',
        textStyle: { color: isDark ? '#ffffff90' : '#000000', fontSize: 11 },
      },
      grid: { top: 36, left: 50, right: 40, bottom: 30 },
      xAxis: {
        type: 'category',
        data: chartData.map((d) => d.time),
        axisLabel: { color: textColor, fontSize: 9, rotate: 30 },
        axisLine: { lineStyle: { color: gridColor } },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: textColor, fontSize: 10 },
        splitLine: { lineStyle: { color: gridColor } },
        min: Math.floor(Math.min(...values, lsl ?? lcl ?? Infinity) - 5),
        max: Math.ceil(Math.max(...values, usl ?? ucl ?? -Infinity) + 5),
      },
      series: [
        // Data line
        {
          type: 'line',
          data: values,
          lineStyle: { color: '#4c7571', width: 2 },
          symbol: 'circle',
          symbolSize: (val: number) =>
            (ucl != null && val > ucl) || (lcl != null && val < lcl) ? 8 : 4,
          itemStyle: {
            color: (params: { data: number }) =>
              (ucl != null && params.data > ucl) || (lcl != null && params.data < lcl)
                ? '#f43f5e'
                : '#4c7571',
          },
          smooth: false,
          markLine: {
            silent: true,
            lineStyle: { width: 1.5 },
            data: markLines,
            label: {
              formatter: (p: { name: string; value: number }) => `${p.name}: ${p.value.toFixed(1)}`,
              fontSize: 9,
              color: textColor,
            },
          },
        },
      ],
    };
  }, [chartData, ucl, lcl, mean, usl, lsl, isDark, t]);

  return (
    <div className="industrial-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{resolvedTitle}</h3>
          <p className="text-xs text-muted-foreground">
            {ucl != null ? `UCL: ${ucl.toFixed(1)}` : 'UCL: —'}
            {' | '}
            {mean != null ? `${t('charts.spc.mean')}: ${mean.toFixed(1)}` : `${t('charts.spc.mean')}: —`}
            {' | '}
            {lcl != null ? `LCL: ${lcl.toFixed(1)}` : 'LCL: —'}
          </p>
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-success-400 inline-block" />{t('charts.spc.mean')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-warning-400 border-dashed inline-block" />{t('charts.spc.controlLimits')}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-danger-400 inline-block" />{t('charts.spc.specLimits')}
          </span>
        </div>
      </div>
      {isLoading ? (
        <div className="shimmer h-48 rounded-lg" />
      ) : !hasData ? (
        <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
          {t('charts.spc.noData')}
        </div>
      ) : (
        <ReactECharts option={option} style={{ height: '200px' }} notMerge />
      )}
    </div>
  );
}
