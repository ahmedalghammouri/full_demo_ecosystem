'use client';

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import ReactECharts from 'echarts-for-react';
import { useTheme } from 'next-themes';
import { Zap, Activity, TrendingUp, CheckCircle2 } from 'lucide-react';

import { cn, getOEEColor, getOEEBgColor } from '@/lib/utils';

interface OEEGaugeProps {
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  isLoading?: boolean;
}

function MiniGauge({ label, value, icon: Icon, isLoading }: {
  label: string;
  value: number;
  icon: React.ElementType;
  isLoading?: boolean;
}) {
  const colorClass = getOEEColor(value);
  const bgColor = getOEEBgColor(value);

  return (
    <div className="flex items-center gap-3 p-3 rounded-xl bg-muted/20 border border-border/30">
      <div className={cn('p-2 rounded-lg', `bg-${bgColor}/10`)}>
        <Icon size={14} className={colorClass} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-1">
          {label}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn('text-sm font-bold tabular-nums', colorClass)}>
            {isLoading ? '—' : `${value.toFixed(1)}%`}
          </span>
          <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
            <div
              className={cn('h-full rounded-full transition-all duration-700', bgColor)}
              style={{ width: `${Math.min(value, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export function OEEGauge({ oee, availability, performance, quality, isLoading }: OEEGaugeProps) {
  const { t } = useTranslation('common');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const gaugeOption = useMemo(() => {
    const color =
      oee >= 85 ? '#22c55e' :
      oee >= 65 ? '#4c7571' :
      oee >= 45 ? '#f59e0b' : '#f43f5e';

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
      series: [
        {
          type: 'gauge',
          startAngle: 210,
          endAngle: -30,
          min: 0,
          max: 100,
          radius: '85%',
          center: ['50%', '55%'],
          splitNumber: 5,
          axisLine: {
            lineStyle: {
              width: 14,
              color: [
                [0.45, '#f43f5e'],
                [0.65, '#f59e0b'],
                [0.85, '#4c7571'],
                [1, '#22c55e'],
              ],
            },
          },
          pointer: {
            length: '60%',
            width: 4,
            itemStyle: { color: color },
          },
          axisTick: { show: false },
          splitLine: {
            length: 8,
            lineStyle: { color: isDark ? '#ffffff20' : '#00000020', width: 2 },
          },
          axisLabel: {
            color: isDark ? '#ffffff60' : '#00000060',
            fontSize: 10,
            distance: -20,
          },
          detail: {
            valueAnimation: true,
            formatter: (v: number) => `${v.toFixed(1)}%`,
            color: color,
            fontSize: 26,
            fontWeight: 'bold',
            offsetCenter: [0, '30%'],
          },
          title: {
            offsetCenter: [0, '55%'],
            color: isDark ? '#ffffff60' : '#00000060',
            fontSize: 11,
            fontWeight: 'normal',
          },
          data: [{ value: isLoading ? 0 : oee, name: 'OEE' }],
        },
      ],
    };
  }, [oee, isLoading, isDark]);

  return (
    <div className="industrial-card p-4 h-full">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t('charts.oeeAnalysis')}</h3>
          <p className="text-xs text-muted-foreground">{t('charts.oeeFull')}</p>
        </div>
        {oee >= 85 && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-success-500/10 text-success-400 border border-success-500/20">
            {t('charts.worldClass')}
          </span>
        )}
      </div>

      {/* Main gauge */}
      <div className="h-44">
        <ReactECharts
          option={gaugeOption}
          style={{ height: '100%', width: '100%' }}
          notMerge={true}
        />
      </div>

      {/* Components */}
      <div className="space-y-2 mt-2">
        <MiniGauge label={t('charts.availability')} value={availability} icon={Activity} isLoading={isLoading} />
        <MiniGauge label={t('charts.performance')} value={performance} icon={TrendingUp} isLoading={isLoading} />
        <MiniGauge label={t('charts.quality')} value={quality} icon={CheckCircle2} isLoading={isLoading} />
      </div>
    </div>
  );
}
