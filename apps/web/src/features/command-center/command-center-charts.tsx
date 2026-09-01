'use client';

import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CommandCenterExecutiveRow } from './use-command-center';

// Per-utility palette — matches the energy domain colors used elsewhere.
const UTILITY_COLOR: Record<string, string> = {
  ELECTRICAL: '#eab308',
  NATURAL_GAS: '#f97316',
  COMPRESSED_AIR: '#06b6d4',
  WATER: '#0ea5e9',
  STEAM: '#a855f7',
  CHILLED_WATER: '#14b8a6',
};

const UTILITY_UNIT: Record<string, string> = {
  ELECTRICAL: 'kWh',
  NATURAL_GAS: 'm³',
  COMPRESSED_AIR: 'm³',
  WATER: 'L',
  STEAM: 'kg',
  CHILLED_WATER: 'kWh',
};

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const target = v * 1.4;
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  return Math.ceil(target / mag) * mag;
}

/** Live power half-gauge — the energy headline (mirrors the OEE gauge style). */
export function PowerGauge({ value, isLoading }: { value: number | null; isLoading?: boolean }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const v = value ?? 0;
  const max = niceMax(v);

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
    series: [
      {
        type: 'gauge',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max,
        radius: '95%',
        center: ['50%', '62%'],
        splitNumber: 4,
        progress: { show: true, width: 14, itemStyle: { color: '#eab308' } },
        axisLine: { lineStyle: { width: 14, color: [[1, isDark ? '#ffffff14' : '#0000000f']] } },
        pointer: { length: '58%', width: 4, itemStyle: { color: '#eab308' } },
        axisTick: { show: false },
        splitLine: { length: 8, lineStyle: { color: isDark ? '#ffffff20' : '#00000020', width: 2 } },
        axisLabel: { color: isDark ? '#ffffff55' : '#00000055', fontSize: 9, distance: -16 },
        detail: {
          valueAnimation: true,
          formatter: (n: number) => `${n.toFixed(n >= 100 ? 0 : 1)}`,
          color: '#eab308',
          fontSize: 28,
          fontWeight: 'bold',
          offsetCenter: [0, '32%'],
        },
        title: { offsetCenter: [0, '70%'], color: isDark ? '#ffffff60' : '#00000060', fontSize: 11 },
        data: [{ value: isLoading ? 0 : v, name: 'kW' }],
      },
    ],
  }), [v, max, isDark, isLoading]);

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />;
}

/** Consumption-by-utility breakdown — horizontal bars per energy type. */
export function UtilityBreakdown({ byType }: { byType: Record<string, number> }) {
  const { t } = useTranslation('dashboard');
  const entries = Object.entries(byType).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const peak = Math.max(...entries.map(([, v]) => v), 1);

  if (entries.length === 0) {
    return <div className="text-xs text-muted-foreground text-center py-6">{t('commandCenter.energy.noData')}</div>;
  }

  return (
    <div className="space-y-2.5">
      {entries.map(([type, val]) => {
        const color = UTILITY_COLOR[type] ?? '#64748b';
        const unit = UTILITY_UNIT[type] ?? '';
        return (
          <div key={type}>
            <div className="flex items-center justify-between text-[11px] mb-1">
              <span className="text-muted-foreground" style={{ color }}>
                {t(`commandCenter.types.${type}`, { defaultValue: type })}
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {val.toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="text-muted-foreground font-normal">{unit}</span>
              </span>
            </div>
            <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${(val / peak) * 100}%`, backgroundColor: color }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Electricity trend — render style switchable (area | line | bar). */
export function EnergyTrend({ data, type = 'area' }: { data: Array<{ date: string; value: number }>; type?: 'area' | 'line' | 'bar' }) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    grid: { top: 8, right: 8, bottom: 18, left: 36 },
    xAxis: {
      type: 'category',
      data: data.map((d) => d.date),
      axisLine: { lineStyle: { color: isDark ? '#ffffff20' : '#00000020' } },
      axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
    },
    yAxis: {
      type: 'value',
      splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } },
      axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
    },
    tooltip: { trigger: 'axis' },
    series: [
      type === 'bar'
        ? { type: 'bar', data: data.map((d) => d.value), itemStyle: { color: '#eab308', borderRadius: [3, 3, 0, 0] }, barMaxWidth: 22 }
        : {
            type: 'line', smooth: true, showSymbol: false, data: data.map((d) => d.value),
            lineStyle: { color: '#eab308', width: 2 },
            ...(type === 'area' ? { areaStyle: { color: 'rgba(234,179,8,0.18)' } } : {}),
          },
    ],
  }), [data, isDark, type]);
  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />;
}

/** Executive comparison — OEE (bar) + output (line) across factories / areas. */
export function ExecutiveComparison({
  rows,
  locale,
}: {
  rows: CommandCenterExecutiveRow[];
  locale: string;
}) {
  const { t } = useTranslation('dashboard');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const isAr = locale === 'ar';

  const labels = rows.map((r) => (isAr && r.nameAr ? r.nameAr : r.name));

  const option = useMemo(() => ({
    backgroundColor: 'transparent',
    // Animation off — see the note on the first chart in this file.
    animation: false,
    grid: { top: 28, right: 48, bottom: 24, left: 48 },
    legend: {
      data: [t('commandCenter.executive.oee'), t('commandCenter.executive.output')],
      textStyle: { color: isDark ? '#ffffff80' : '#00000080', fontSize: 10 },
      top: 0,
    },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: {
      type: 'category',
      data: labels,
      axisLine: { lineStyle: { color: isDark ? '#ffffff20' : '#00000020' } },
      axisLabel: { color: isDark ? '#ffffff80' : '#00000080', fontSize: 10, interval: 0, rotate: labels.length > 5 ? 24 : 0 },
    },
    yAxis: [
      {
        type: 'value', max: 100, name: '%',
        splitLine: { lineStyle: { color: isDark ? '#ffffff10' : '#00000010' } },
        axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
      },
      {
        type: 'value', name: '',
        splitLine: { show: false },
        axisLabel: { color: isDark ? '#ffffff60' : '#00000060', fontSize: 9 },
      },
    ],
    series: [
      {
        name: t('commandCenter.executive.oee'),
        type: 'bar',
        yAxisIndex: 0,
        data: rows.map((r) => ({
          value: Math.round(r.oee * 10) / 10,
          itemStyle: {
            color: r.oee >= 85 ? '#22c55e' : r.oee >= 65 ? '#4c7571' : r.oee >= 45 ? '#f59e0b' : '#f43f5e',
            borderRadius: [4, 4, 0, 0],
          },
        })),
        barMaxWidth: 38,
      },
      {
        name: t('commandCenter.executive.output'),
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        data: rows.map((r) => Math.round(r.output)),
        lineStyle: { color: '#06b6d4', width: 2 },
        itemStyle: { color: '#06b6d4' },
      },
    ],
  }), [rows, labels, isDark, t]);

  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground text-center py-10">{t('commandCenter.executive.noData')}</div>;
  }

  return <ReactECharts option={option} style={{ height: '100%', width: '100%' }} notMerge />;
}

/** Small section header used inside the command center. */
export function SectionTitle({ icon: Icon, color, children }: { icon: React.ElementType; color: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className={cn('p-1.5 rounded-lg')} style={{ backgroundColor: `${color}1a` }}>
        <Icon size={14} style={{ color }} />
      </span>
      <h2 className="text-sm font-bold text-foreground">{children}</h2>
    </div>
  );
}
