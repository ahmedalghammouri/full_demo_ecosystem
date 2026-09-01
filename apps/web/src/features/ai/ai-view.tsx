'use client';
import { useTranslation } from 'react-i18next';

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import {
  Brain,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  BarChart3,
  Zap,
  ChevronRight,
  Sparkles,
  Target,
  Activity,
  Gauge as GaugeIcon,
  BookOpen,
  Layers,
  Crosshair,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn } from '@/lib/utils';
import { api } from '@/services/api.client';
import {
  IndustryBenchmarks,
  SixLossesPanel,
  AvailabilityMetricsPanel,
  SectionCard,
  InsightCard,
  buildScopeInsights,
  type ScopeInsight,
  type ParetoItem,
  type PlantLosses,
} from './ai-analysis-panels';

interface AiInsight {
  id: string;
  type: 'anomaly' | 'optimization' | 'prediction' | 'energy';
  severity: 'high' | 'medium' | 'low';
  title: string;
  description: string;
  recommendation: string;
  confidence: number;
  impact: string;
  equipmentId: string;
  detectedAt: string;
}

interface EquipmentHealth {
  machineId: string;
  name: string;
  health: number;
  trend: 'improving' | 'declining' | 'stable';
  risk: 'High' | 'Medium' | 'Low';
}

interface AiDetector {
  name: string;
  type: string;
  coverage: string;
  status: 'active' | 'idle';
}

interface AiInsightsResponse {
  metrics: { label: string; value: string; sub: string }[];
  insights: AiInsight[];
  equipmentHealth: EquipmentHealth[];
  detectors: AiDetector[];
}

interface OeeAnalyticsResponse {
  current: { oee: number; availability: number; performance: number; quality: number; oeeTb?: number; availabilityTb?: number };
  trend: { period: string; oee: number; oeeTb?: number }[];
  byEquipment: { name: string; oee: number; availability: number; performance: number; quality: number }[];
}

interface HierarchyResponse {
  plant: { oee: number; availability: number; performance: number; quality: number; output: number; good: number; losses?: PlantLosses };
  pareto: ParetoItem[];
  range: { from: string; to: string };
}

interface MaintKpis {
  mttr: number;
  mtbf: number;
  availabilityRate: number;
}

const typeConfig = {
  anomaly: { icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/20' },
  optimization: { icon: TrendingUp, color: 'text-green-400', bg: 'bg-green-500/20' },
  prediction: { icon: Brain, color: 'text-purple-400', bg: 'bg-purple-500/20' },
  energy: { icon: Zap, color: 'text-amber-400', bg: 'bg-amber-500/20' },
};

const metricIcons = [Brain, AlertTriangle, TrendingUp, Target];

const severityColors = {
  high: 'text-red-400 border-red-500/30 bg-red-500/10',
  medium: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  low: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
};

export function AIView() {
  const { t } = useTranslation('modules');
  const { scope, filter, key } = useScope();
  const { params: timeParams, key: timeKey } = useTimeRange();
  const [activeInsight, setActiveInsight] = useState<string | null>(null);

  // ── scope + time aware fetches ──
  const { data: oeeData, isLoading: oeeLoading, refetch: refetchOee, isFetching: oeeFetching } = useQuery({
    queryKey: ['ai', 'oee', timeKey, key],
    queryFn: () => api.get<OeeAnalyticsResponse>('/production/oee/calculate', { params: { ...timeParams, ...filter } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: hierData, isLoading: hierLoading, refetch: refetchHier } = useQuery({
    queryKey: ['ai', 'hierarchy', timeKey, key],
    queryFn: () => api.get<HierarchyResponse>('/production/oee/hierarchy', {
      params: { dateFrom: timeParams.dateFrom, dateTo: timeParams.dateTo, ...filter },
    }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: maintKpis, isLoading: maintLoading, refetch: refetchMaint } = useQuery({
    queryKey: ['ai', 'maint-kpis', key],
    queryFn: () => api.get<MaintKpis>('/maintenance/kpis', { params: { ...filter } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const { data: serverData, isLoading: serverLoading, refetch: refetchServer, isFetching: serverFetching } = useQuery({
    queryKey: ['ai', 'insights', key],
    queryFn: () => api.get<AiInsightsResponse>('/ai/insights', { params: { ...filter } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const isFetching = oeeFetching || serverFetching;
  const runAnalysis = () => { refetchOee(); refetchHier(); refetchMaint(); refetchServer(); };

  const equipmentHealth = serverData?.equipmentHealth ?? [];
  const detectors = serverData?.detectors ?? [];
  const serverInsights = serverData?.insights ?? [];

  const current = oeeData?.current;
  const plant = hierData?.plant;
  const pareto = hierData?.pareto ?? [];
  const trend = oeeData?.trend ?? [];

  // Scope-level rule-based insights derived client-side, then server detectors merged in.
  const scopeInsights: ScopeInsight[] = useMemo(
    () => buildScopeInsights(current, plant, pareto, maintKpis, t),
    [current, plant, pareto, maintKpis, t],
  );

  const mergedServer: ScopeInsight[] = useMemo(
    () => serverInsights.map((i) => ({
      sev: i.severity as ScopeInsight['sev'],
      title: i.title,
      detail: i.description,
      rec: i.recommendation,
      confidence: i.confidence,
    })),
    [serverInsights],
  );

  const allInsights = useMemo(() => {
    const sevRank = { high: 0, medium: 1, low: 2, good: 3 } as const;
    return [...scopeInsights, ...mergedServer].sort(
      (a, b) => sevRank[a.sev] - sevRank[b.sev] || b.confidence - a.confidence,
    );
  }, [scopeInsights, mergedServer]);

  const highCount = allInsights.filter((i) => i.sev === 'high').length;
  const avgConfidence = allInsights.length
    ? Math.round(allInsights.reduce((s, i) => s + i.confidence, 0) / allInsights.length)
    : 0;
  const trendDelta = trend.length >= 2 ? trend[trend.length - 1].oee - trend[0].oee : null;

  // Top summary metric cards (driven by live data).
  const summaryMetrics = [
    { label: t('ai.metricActiveInsights'), value: String(allInsights.length), sub: t('ai.metricActiveInsightsSub') },
    { label: t('ai.metricHighSeverity'), value: String(highCount), sub: t('ai.metricHighSeveritySub') },
    {
      label: t('ai.metricOeeTrend'),
      value: trendDelta != null ? `${trendDelta >= 0 ? '+' : ''}${trendDelta.toFixed(1)}%` : '—',
      sub: t('ai.metricOeeTrendSub'),
    },
    { label: t('ai.metricAvgConfidence'), value: allInsights.length ? `${avgConfidence}%` : '—', sub: t('ai.metricAvgConfidenceSub') },
  ];

  const anyLoading = oeeLoading || hierLoading || maintLoading || serverLoading;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="w-6 h-6 text-brand-400" />
            {t('ai.title')}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('ai.subtitle')}
            <span className="ml-2 text-foreground/80">
              · {scope && scope.type !== 'FACTORY' ? scope.name : t('ai.wholeFactory')}
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={runAnalysis} disabled={isFetching}>
            <Brain className={cn('w-4 h-4 mr-2', isFetching && 'animate-pulse')} />
            {isFetching ? t('ai.analyzing') : t('ai.runAnalysis')}
          </Button>
        </div>
      </div>

      {/* Summary metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {anyLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass-card rounded-xl p-4"><div className="shimmer h-16 rounded-lg" /></div>
            ))
          : summaryMetrics.map((metric, i) => {
              const Icon = metricIcons[i % metricIcons.length];
              return (
                <div key={metric.label} className="glass-card rounded-xl p-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-foreground/5 flex items-center justify-center">
                      <Icon className="w-4 h-4 text-brand-400" />
                    </div>
                    <div>
                      <div className="text-2xl font-bold">{metric.value}</div>
                      <div className="text-[11px] text-muted-foreground">{metric.sub}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">{metric.label}</div>
                </div>
              );
            })}
      </div>

      <Tabs defaultValue="insights">
        <TabsList>
          <TabsTrigger value="insights">{t('ai.tabInsights')}</TabsTrigger>
          <TabsTrigger value="benchmarks">{t('ai.tabBenchmarks')}</TabsTrigger>
          <TabsTrigger value="losses">{t('ai.tabLosses')}</TabsTrigger>
          <TabsTrigger value="availability">{t('ai.tabAvailability')}</TabsTrigger>
          <TabsTrigger value="health">{t('ai.tabHealth')}</TabsTrigger>
          <TabsTrigger value="detectors">{t('ai.tabDetectors')}</TabsTrigger>
        </TabsList>

        {/* 1. AI Insights — scope-level rule-based + merged server detectors */}
        <TabsContent value="insights" className="mt-4 space-y-4">
          <SectionCard title={t('ai.scopeInsightsTitle')} icon={<Sparkles className="w-4 h-4" />}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
              <MiniTile icon={<Sparkles className="w-4 h-4" />} label={t('ai.metricActiveInsights')} value={allInsights.length} />
              <MiniTile icon={<AlertTriangle className="w-4 h-4" />} label={t('ai.metricHighSeverity')} value={highCount}
                tone={highCount > 0 ? 'bg-red-500/15 text-red-400' : 'bg-green-500/15 text-green-400'} />
              <MiniTile icon={<GaugeIcon className="w-4 h-4" />} label={t('ai.oeeSchedule')} value={current?.oee != null ? `${current.oee.toFixed(1)}%` : '—'} />
              <MiniTile icon={<GaugeIcon className="w-4 h-4" />} label={t('ai.oeeTimeBased')} value={current?.oeeTb != null ? `${current.oeeTb.toFixed(1)}%` : '—'} />
            </div>
            <div className="space-y-2">
              {anyLoading ? (
                Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer h-16 rounded-lg" />)
              ) : allInsights.length === 0 ? (
                <div className="text-xs text-muted-foreground py-6 text-center">{t('ai.noInsights')}</div>
              ) : (
                allInsights.map((it, i) => <InsightCard key={i} it={it} />)
              )}
            </div>
          </SectionCard>

          {/* Keep the rich expandable detector insights from the server */}
          {serverInsights.length > 0 && (
            <SectionCard title={t('ai.equipmentDetectorsTitle')} icon={<Brain className="w-4 h-4" />}>
              <div className="space-y-3">
                <AnimatedInsights insights={serverInsights} activeInsight={activeInsight} setActiveInsight={setActiveInsight} />
              </div>
            </SectionCard>
          )}
        </TabsContent>

        {/* 2. OEE Industry Benchmarks & Standards */}
        <TabsContent value="benchmarks" className="mt-4">
          <SectionCard title={t('ai.benchmarksTitle')} icon={<BookOpen className="w-4 h-4" />}>
            {hierLoading || oeeLoading ? (
              <div className="shimmer h-40 rounded-lg" />
            ) : (
              <IndustryBenchmarks
                oeeValue={plant?.oee ?? null}
                oeeTimeBasedValue={current?.oeeTb ?? null}
              />
            )}
          </SectionCard>
        </TabsContent>

        {/* 3. The Six Big Losses */}
        <TabsContent value="losses" className="mt-4">
          <SectionCard title={t('ai.sixLossesTitle')} icon={<Layers className="w-4 h-4" />}>
            {hierLoading ? (
              <div className="shimmer h-40 rounded-lg" />
            ) : !plant?.losses ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t('ai.noData')}</div>
            ) : (
              <SixLossesPanel losses={plant.losses} pareto={pareto} />
            )}
          </SectionCard>
        </TabsContent>

        {/* 4. Availability Metrics (MTTR · MTBF · Availability) */}
        <TabsContent value="availability" className="mt-4">
          <SectionCard title={t('ai.availabilityMetricsTitle')} icon={<Crosshair className="w-4 h-4" />}>
            {maintLoading ? (
              <div className="shimmer h-32 rounded-lg" />
            ) : !maintKpis ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t('ai.noData')}</div>
            ) : (
              <AvailabilityMetricsPanel kpis={maintKpis} />
            )}
          </SectionCard>
        </TabsContent>

        {/* Equipment Health (existing) */}
        <TabsContent value="health" className="mt-4">
          <div className="glass-card rounded-xl p-6">
            <h3 className="font-semibold mb-4 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-brand-400" />
              {t('ai.healthIndex')}
            </h3>
            {serverLoading ? (
              <div className="shimmer h-40 rounded-lg" />
            ) : equipmentHealth.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t('ai.noTelemetry')}</div>
            ) : (
              <div className="space-y-3">
                {equipmentHealth.map((eq) => (
                  <div key={eq.machineId} className="flex items-center gap-4">
                    <div className="w-40 text-sm truncate" title={eq.name}>{eq.name}</div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            eq.health >= 80 ? 'bg-green-500' : eq.health >= 60 ? 'bg-amber-500' : 'bg-red-500',
                          )}
                          style={{ width: `${eq.health}%` }}
                        />
                      </div>
                    </div>
                    <div className="w-12 text-right text-sm font-mono">{eq.health}%</div>
                    <span className="w-20 text-[11px] text-muted-foreground flex items-center gap-1">
                      <TrendingUp
                        className={cn(
                          'w-3 h-3',
                          eq.trend === 'declining' ? 'text-red-400 rotate-180' :
                          eq.trend === 'improving' ? 'text-green-400' : 'text-muted-foreground',
                        )}
                      />
                      {t(`ai.trend.${eq.trend}`)}
                    </span>
                    <Badge
                      className={cn(
                        'text-[10px] w-16 justify-center',
                        eq.risk === 'High' ? 'bg-red-500/20 text-red-400 border-red-500/30' :
                        eq.risk === 'Medium' ? 'bg-amber-500/20 text-amber-400 border-amber-500/30' :
                        'bg-green-500/20 text-green-400 border-green-500/30',
                      )}
                    >
                      {t(`ai.risk.${eq.risk}`)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Detectors (existing) */}
        <TabsContent value="detectors" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {detectors.map((detector, i) => (
              <motion.div
                key={detector.name}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="glass-card rounded-xl p-5"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="font-medium text-sm">{detector.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{detector.type}</div>
                  </div>
                  <Badge
                    className={cn(
                      'text-[10px]',
                      detector.status === 'active'
                        ? 'bg-green-500/20 text-green-400 border-green-500/30'
                        : 'bg-foreground/10 text-muted-foreground border-foreground/20',
                    )}
                  >
                    {t(`ai.detectorStatus.${detector.status}`)}
                  </Badge>
                </div>
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Activity className="w-3 h-3" />
                  {detector.coverage}
                </div>
              </motion.div>
            ))}
            {detectors.length === 0 && (
              <div className="col-span-full py-8 text-center text-sm text-muted-foreground">{t('ai.noData')}</div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function MiniTile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-background/40 px-3.5 py-3 flex items-center gap-3">
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', tone ?? 'bg-brand-500/15 text-brand-400')}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground truncate">{label}</div>
        <div className="text-lg font-bold tabular-nums leading-tight">{value}</div>
      </div>
    </div>
  );
}

function AnimatedInsights({
  insights,
  activeInsight,
  setActiveInsight,
}: {
  insights: AiInsight[];
  activeInsight: string | null;
  setActiveInsight: (id: string | null) => void;
}) {
  const { t } = useTranslation('modules');
  return (
    <>
      {insights.map((insight, i) => {
        const cfg = typeConfig[insight.type as keyof typeof typeConfig];
        const Icon = cfg.icon;
        const isActive = activeInsight === insight.id;
        return (
          <motion.div
            key={insight.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className={cn(
              'glass-card rounded-xl overflow-hidden cursor-pointer transition-all',
              isActive ? 'ring-1 ring-brand-500' : 'hover:ring-1 hover:ring-white/20',
            )}
            onClick={() => setActiveInsight(isActive ? null : insight.id)}
          >
            <div className="p-5">
              <div className="flex items-start gap-4">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', cfg.bg)}>
                  <Icon className={cn('w-5 h-5', cfg.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="font-medium text-sm leading-snug">{insight.title}</div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge className={cn('text-[10px]', severityColors[insight.severity as keyof typeof severityColors])}>
                        {t(`ai.severity.${insight.severity}`)}
                      </Badge>
                      <ChevronRight className={cn('w-4 h-4 text-muted-foreground transition-transform', isActive && 'rotate-90')} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="text-[10px]">{t(`ai.cfg.${insight.type}`)}</Badge>
                    <span>{insight.equipmentId}</span>
                    <span>{insight.detectedAt}</span>
                    <span className="flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      {t('ai.confidence', { value: insight.confidence })}
                    </span>
                  </div>
                </div>
              </div>

              {isActive && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  className="mt-4 pt-4 border-t border-border/50 space-y-3"
                >
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-1">{t('ai.analysis')}</div>
                    <p className="text-sm leading-relaxed">{insight.description}</p>
                  </div>
                  <div className="flex gap-4">
                    <div className="flex-1">
                      <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Lightbulb className="w-3 h-3" />
                        {t('ai.recommendation')}
                      </div>
                      <p className="text-sm text-brand-300">{insight.recommendation}</p>
                    </div>
                    <div className="shrink-0">
                      <div className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {t('ai.expectedImpact')}
                      </div>
                      <p className="text-sm text-green-400">{insight.impact}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <Button size="sm">{t('ai.acceptSchedule')}</Button>
                    <Button size="sm" variant="outline">{t('ai.dismiss')}</Button>
                    <Button size="sm" variant="ghost">{t('ai.viewDetails')}</Button>
                  </div>
                </motion.div>
              )}
            </div>
          </motion.div>
        );
      })}
    </>
  );
}
