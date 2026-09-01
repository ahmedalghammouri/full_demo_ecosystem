'use client';

/**
 * Scope-level AI Analysis panels — reproduces the JO-live dashboard's
 * "AI Analysis & Benchmarks" panels (rule-based insights, OEE Industry Benchmarks,
 * The Six Big Losses, Availability Metrics) but driven by scope+time-range data
 * from /production/oee/* and /maintenance/kpis instead of a single job order.
 *
 * Same visual language as the shop-floor panels (glass surfaces, BENCH tokens,
 * the AI_SEV severity cards) so the two surfaces read identically.
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
import { Sparkles } from 'lucide-react';

// ── shared formatting ──
export const fmtMins = (m: number | null | undefined) => {
  if (m == null) return '—';
  if (m < 1) return `${Math.round(m * 60)}s`;
  const h = Math.floor(m / 60);
  const mm = Math.round(m % 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
};

// OEE benchmark classes (industry standard levels) — mirrors the shop-floor BENCH map.
export const BENCH: Record<string, { labelKey: string; color: string; bg: string }> = {
  WORLD_CLASS: { labelKey: 'ai.bench.worldClass', color: '#22c55e', bg: 'bg-green-500/10 border-green-500/30 text-green-400' },
  GOOD:        { labelKey: 'ai.bench.good',        color: '#3b82f6', bg: 'bg-blue-500/10 border-blue-500/30 text-blue-400' },
  FAIR:        { labelKey: 'ai.bench.fair',        color: '#eab308', bg: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400' },
  POOR:        { labelKey: 'ai.bench.poor',        color: '#ef4444', bg: 'bg-red-500/10 border-red-500/30 text-red-400' },
};

export function classify(v: number | null | undefined): string | null {
  return v == null ? null : v >= 85 ? 'WORLD_CLASS' : v >= 70 ? 'GOOD' : v >= 60 ? 'FAIR' : 'POOR';
}

function BenchBadge({ cls }: { cls: string | null }) {
  const { t } = useTranslation('modules');
  if (!cls || !BENCH[cls]) return null;
  const b = BENCH[cls];
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${b.bg}`}>{t(b.labelKey)}</span>;
}

// ── AI insight cards (rule-based, scope-level) ──
export type ScopeInsight = {
  sev: 'high' | 'medium' | 'low' | 'good';
  title: string;
  detail: string;
  rec: string;
  confidence: number;
};

export const AI_SEV: Record<string, { cls: string; labelKey: string }> = {
  high: { cls: 'border-red-500/40 bg-red-500/5 text-red-400', labelKey: 'ai.sev.high' },
  medium: { cls: 'border-amber-500/40 bg-amber-500/5 text-amber-400', labelKey: 'ai.sev.medium' },
  low: { cls: 'border-blue-500/40 bg-blue-500/5 text-blue-400', labelKey: 'ai.sev.info' },
  good: { cls: 'border-green-500/40 bg-green-500/5 text-green-400', labelKey: 'ai.sev.healthy' },
};

export function InsightCard({ it }: { it: ScopeInsight }) {
  const { t } = useTranslation('modules');
  const s = AI_SEV[it.sev];
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${s.cls}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-foreground">{it.title}</p>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-[10px] px-1.5 py-0.5 rounded border border-current font-bold">{t(s.labelKey)}</span>
          <span className="text-[10px] text-muted-foreground">{it.confidence}%</span>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">{it.detail}</p>
      <p className="text-[11px] mt-1 flex items-start gap-1.5">
        <Sparkles className="w-3 h-3 mt-0.5 shrink-0 text-brand-400" />
        <span className="text-foreground/90">{it.rec}</span>
      </p>
    </div>
  );
}

// ── OEE Industry Benchmarks & Standards (schedule vs time-based) ──
export function IndustryBenchmarks({ oeeValue, oeeTimeBasedValue }: { oeeValue: number | null; oeeTimeBasedValue: number | null }) {
  const { t } = useTranslation('modules');
  const levels = [
    { name: t('ai.bench.worldClass'), range: '85%+', desc: t('ai.bench.worldClassDesc'), key: 'WORLD_CLASS' },
    { name: t('ai.bench.good'), range: '70–85%', desc: t('ai.bench.goodDesc'), key: 'GOOD' },
    { name: t('ai.bench.fair'), range: '60–70%', desc: t('ai.bench.fairDesc'), key: 'FAIR' },
    { name: t('ai.bench.poor'), range: '<60%', desc: t('ai.bench.poorDesc'), key: 'POOR' },
  ];
  const industries = [
    [t('ai.ind.automotive'), '60–75%'], [t('ai.ind.foodBeverage'), '50–65%'], [t('ai.ind.pharmaceuticals'), '65–80%'],
    [t('ai.ind.electronics'), '70–85%'], [t('ai.ind.packaging'), '55–70%'], [t('ai.ind.textiles'), '45–60%'],
  ];
  const schedLevel = classify(oeeValue);
  const tbLevel = classify(oeeTimeBasedValue);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-muted-foreground">{t('ai.oeePerformanceLevels')}</p>
          <div className="flex items-center gap-2 text-[10px]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-sky-400" />{t('ai.schedule')} {oeeValue != null ? `${oeeValue}%` : '—'}</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" />{t('ai.timeBased')} {oeeTimeBasedValue != null ? `${oeeTimeBasedValue}%` : '—'}</span>
          </div>
        </div>
        <div className="space-y-2">
          {levels.map((l) => {
            const isSched = schedLevel === l.key;
            const isTb = tbLevel === l.key;
            return (
              <div key={l.key} className={`rounded-lg border px-3 py-2 flex items-center justify-between ${BENCH[l.key].bg} ${isSched || isTb ? 'ring-2 ring-current' : ''}`}>
                <div>
                  <div className="text-sm font-bold flex items-center gap-1.5 flex-wrap">
                    {l.name}
                    {isSched && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/40 font-semibold">{t('ai.schedule')}</span>}
                    {isTb && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40 font-semibold">{t('ai.timeBased')}</span>}
                  </div>
                  <div className="text-[10px] opacity-80">{l.desc}</div>
                </div>
                <span className="text-sm font-bold">{l.range}</span>
              </div>
            );
          })}
        </div>
        {schedLevel && tbLevel && schedLevel !== tbLevel && (
          <p className="text-[10px] text-muted-foreground mt-2">{t('ai.benchTiersNote')}</p>
        )}
      </div>
      <div>
        <p className="text-xs font-bold text-muted-foreground mb-2">{t('ai.industryTypicalOee')}</p>
        <div className="space-y-1.5">
          {industries.map(([name, range]) => (
            <div key={name} className="rounded-lg border border-border/40 bg-background/40 px-3 py-2 flex items-center justify-between">
              <span className="text-sm">{name}</span>
              <span className="text-sm font-bold tabular-nums">{range}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── The Six Big Losses (scope-level, from plant.losses + pareto for failures) ──
export type PlantLosses = { availabilityLossMin: number; performanceLossMin: number; qualityLossMin: number } | null | undefined;
export type ParetoItem = { reasonCode: string; minutes: number; events: number };

export function SixLossesPanel({ losses, pareto }: { losses: PlantLosses; pareto: ParetoItem[] }) {
  const { t } = useTranslation('modules');
  // Top equipment-failure reason from the Pareto (the biggest availability-loss driver).
  const topReason = pareto?.[0];
  const reasonEvents = pareto?.reduce((s, p) => s + p.events, 0) ?? 0;

  const groups = [
    {
      title: t('ai.sl.availabilityLosses'), cls: 'border-blue-500/30 bg-blue-500/5', titleCls: 'text-blue-400',
      items: [
        {
          n: 1, name: t('ai.sl.equipmentFailures'), desc: t('ai.sl.equipmentFailuresDesc'),
          v: topReason ? `${topReason.reasonCode} · ${fmtMins(topReason.minutes)} · ${topReason.events}×` : fmtMins(losses?.availabilityLossMin),
        },
        {
          n: 2, name: t('ai.sl.setupAdjustments'), desc: t('ai.sl.setupAdjustmentsDesc'),
          v: `${fmtMins(losses?.availabilityLossMin)}${reasonEvents ? ` · ${reasonEvents}×` : ''}`,
        },
      ],
    },
    {
      title: t('ai.sl.performanceLosses'), cls: 'border-green-500/30 bg-green-500/5', titleCls: 'text-green-400',
      items: [
        { n: 3, name: t('ai.sl.idlingMinorStops'), desc: t('ai.sl.idlingMinorStopsDesc'), v: fmtMins(losses?.performanceLossMin) },
        { n: 4, name: t('ai.sl.reducedSpeed'), desc: t('ai.sl.reducedSpeedDesc'), v: fmtMins(losses?.performanceLossMin) },
      ],
    },
    {
      title: t('ai.sl.qualityLosses'), cls: 'border-red-500/30 bg-red-500/5', titleCls: 'text-red-400',
      items: [
        { n: 5, name: t('ai.sl.processDefects'), desc: t('ai.sl.processDefectsDesc'), v: fmtMins(losses?.qualityLossMin) },
        { n: 6, name: t('ai.sl.startupRejects'), desc: t('ai.sl.startupRejectsDesc'), v: fmtMins(losses?.qualityLossMin) },
      ],
    },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {groups.map((g) => (
        <div key={g.title} className={`rounded-xl border p-3 ${g.cls}`}>
          <p className={`text-xs font-bold mb-2 ${g.titleCls}`}>{g.title}</p>
          <div className="space-y-2">
            {g.items.map((it) => (
              <div key={it.n} className="rounded-lg bg-background/60 border border-border/40 px-3 py-2">
                <p className="text-xs font-semibold">{it.n}. {it.name}</p>
                <p className="text-[10px] text-muted-foreground">{it.desc}</p>
                <p className="text-sm font-bold tabular-nums mt-1">{it.v}</p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Availability Metrics (MTTR · MTBF · Availability) from /maintenance/kpis ──
// kpis: mttr (hours), mtbf (hours), availabilityRate (percent).
export function AvailabilityMetricsPanel({ kpis }: { kpis: { mttr: number; mtbf: number; availabilityRate: number } | undefined }) {
  const { t } = useTranslation('modules');
  const mttrMins = kpis ? kpis.mttr * 60 : null;
  const mtbfMins = kpis ? kpis.mtbf * 60 : null;
  const avail = kpis?.availabilityRate ?? null;
  const tiles = [
    { label: 'MTTR', v: fmtMins(mttrMins), sub: t('ai.am.meanTimeToRepair'), cls: 'border-amber-500/30 bg-amber-500/5', lc: 'text-amber-400' },
    { label: 'MTBF', v: fmtMins(mtbfMins), sub: t('ai.am.betweenFailures'), cls: 'border-blue-500/30 bg-blue-500/5', lc: 'text-blue-400' },
    { label: t('ai.am.availability'), v: avail != null ? `${avail}%` : '—', sub: t('ai.am.reliabilityFormula'), cls: 'border-emerald-500/30 bg-emerald-500/5', lc: 'text-emerald-400' },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
        {tiles.map((tile) => (
          <div key={tile.label} className={`rounded-lg border px-2 py-3 ${tile.cls}`}>
            <div className={`text-[10px] uppercase ${tile.lc}`}>{tile.label}</div>
            <div className="text-lg font-bold tabular-nums">{tile.v}</div>
            <div className="text-[9px] text-muted-foreground">{tile.sub}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-muted-foreground text-center">{t('ai.am.computedFromMonth')}</p>
    </div>
  );
}

// ── Section wrapper matching the shop-floor SectionCard ──
export function SectionCard({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border/40 bg-gradient-to-r from-muted/40 via-muted/10 to-transparent">
        <h3 className="text-sm font-bold flex items-center gap-2.5 min-w-0">
          {icon && (
            <span className="w-7 h-7 rounded-lg bg-brand-500/15 flex items-center justify-center shrink-0 [&>svg]:text-brand-400">
              {icon}
            </span>
          )}
          <span className="truncate">{title}</span>
        </h3>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// ── derive scope-level rule-based insights from OEE/hierarchy/maintenance data ──
export function buildScopeInsights(
  oee: { oee: number; availability: number; performance: number; quality: number; oeeTb?: number; availabilityTb?: number } | undefined,
  plant: { oee: number; availability: number; performance: number; quality: number; losses?: PlantLosses } | undefined,
  pareto: ParetoItem[],
  kpis: { mttr: number; mtbf: number; availabilityRate: number } | undefined,
  t: (k: string, o?: any) => string,
): ScopeInsight[] {
  const out: ScopeInsight[] = [];
  const cur = oee;

  // 1. Limiting OEE factor (lowest of A/P/Q).
  if (cur) {
    const factors = [
      { k: 'Availability', label: t('ai.availability'), v: cur.availability },
      { k: 'Performance', label: t('ai.performance'), v: cur.performance },
      { k: 'Quality', label: t('ai.quality'), v: cur.quality },
    ].filter((f) => f.v != null).sort((a, b) => a.v - b.v);
    if (factors.length) {
      const worst = factors[0];
      out.push({
        sev: worst.v < 60 ? 'high' : worst.v < 75 ? 'medium' : 'good',
        title: t('ai.scope.limitingFactor', { factor: worst.label, value: worst.v.toFixed(1) }),
        detail: t('ai.scope.limitingFactorDetail', { factor: worst.label, oee: cur.oee.toFixed(1) }),
        rec: worst.k === 'Availability' ? t('ai.scope.recAvailability')
          : worst.k === 'Performance' ? t('ai.scope.recPerformance')
          : t('ai.scope.recQuality'),
        confidence: 92,
      });
    }
  }

  // 2. Largest loss — top Pareto reason, else biggest of plant.losses.
  const topReason = pareto?.[0];
  if (topReason && topReason.minutes > 0) {
    out.push({
      sev: 'high',
      title: t('ai.scope.largestLoss', { loss: topReason.reasonCode, value: fmtMins(topReason.minutes) }),
      detail: t('ai.scope.largestLossDetail', { events: topReason.events }),
      rec: t('ai.scope.recLargestLoss'),
      confidence: 85,
    });
  } else if (plant?.losses) {
    const ls = [
      { k: t('ai.sl.availabilityLosses'), v: plant.losses.availabilityLossMin },
      { k: t('ai.sl.performanceLosses'), v: plant.losses.performanceLossMin },
      { k: t('ai.sl.qualityLosses'), v: plant.losses.qualityLossMin },
    ].sort((a, b) => b.v - a.v);
    if (ls[0]?.v > 0) {
      out.push({
        sev: 'medium',
        title: t('ai.scope.largestLoss', { loss: ls[0].k, value: fmtMins(ls[0].v) }),
        detail: t('ai.scope.largestLossDetailGeneric'),
        rec: t('ai.scope.recLargestLoss'),
        confidence: 80,
      });
    }
  }

  // 3. Availability method divergence (schedule vs time-based).
  if (cur && cur.availability != null && cur.availabilityTb != null) {
    const gap = Math.round((cur.availabilityTb - cur.availability) * 10) / 10;
    if (Math.abs(gap) >= 5) {
      out.push({
        sev: 'low',
        title: t('ai.scope.methodsDiverge', { gap: `${gap > 0 ? '+' : ''}${gap}` }),
        detail: t('ai.scope.methodsDivergeDetail', { tb: cur.availabilityTb.toFixed(1), sched: cur.availability.toFixed(1) }),
        rec: t('ai.scope.recMethods'),
        confidence: 88,
      });
    }
  }

  // 4. Reliability (MTBF / MTTR from maintenance kpis) — hours.
  if (kpis && (kpis.mtbf > 0 || kpis.mttr > 0)) {
    const mtbfMins = kpis.mtbf * 60;
    const mttrMins = kpis.mttr * 60;
    out.push({
      sev: mtbfMins < 60 ? 'high' : mtbfMins < 180 ? 'medium' : 'good',
      title: t('ai.scope.reliability', { mtbf: fmtMins(mtbfMins), mttr: fmtMins(mttrMins) }),
      detail: t('ai.scope.reliabilityDetail', { mtbf: fmtMins(mtbfMins), mttr: fmtMins(mttrMins) }),
      rec: mtbfMins < 120 ? t('ai.scope.recReliabilityBad') : t('ai.scope.recReliabilityGood'),
      confidence: 80,
    });
  }

  // 5. OEE vs benchmark verdict.
  if (cur) {
    const cls = classify(cur.oee);
    out.push({
      sev: cls === 'WORLD_CLASS' ? 'good' : cls === 'GOOD' ? 'low' : cls === 'FAIR' ? 'medium' : 'high',
      title: t('ai.scope.benchVerdict', { oee: cur.oee.toFixed(1) }),
      detail: cur.oee >= 85
        ? t('ai.scope.benchVerdictWorldClass')
        : t('ai.scope.benchVerdictBelow', { gap: (85 - cur.oee).toFixed(1) }),
      rec: cur.oee >= 85 ? t('ai.scope.recBenchGood') : t('ai.scope.recBenchBad'),
      confidence: 90,
    });
  }

  const sevRank = { high: 0, medium: 1, low: 2, good: 3 };
  return out.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || b.confidence - a.confidence);
}
