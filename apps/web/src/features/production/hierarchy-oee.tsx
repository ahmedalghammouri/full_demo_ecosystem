'use client';

/**
 * HierarchyOEE — weighted OEE rolled up Factory→Area→Line→Machine, with a six-loss
 * waterfall and a downtime Pareto by ISA-95 reason code. Consumes
 * GET /production/oee/hierarchy (KpiService). See docs/DESIGN-oee-kpi-engine.md.
 */

import React, { useState } from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { LayoutGrid, GitBranch, Cpu, ChevronRight, ChevronDown, Layers } from 'lucide-react';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { useOeeMode } from '@/hooks/use-oee-mode';

interface OeeNode {
  id: string; name: string; code: string | null; type: 'AREA' | 'LINE' | 'MACHINE';
  oee: number; availability: number; performance: number; quality: number;
  // Time-based twin, emitted per node so the toggle governs the tree too.
  oeeTb?: number; availabilityTb?: number;
  output: number; good: number;
  losses: { availabilityLossMin: number; performanceLossMin: number; qualityLossMin: number };
  /** LINE nodes only — which basis produced this figure. */
  oeeMethod?: 'ROLLUP' | 'BOTTLENECK';
  oeeBasis?: {
    method: string;
    formula: string;
    bottleneckMachineName?: string;
    outfeedMachineNames?: string[];
    bottleneckResolvedBy?: string;
    outfeedResolvedBy?: string;
    fallbackFrom?: string;
    fallbackReason?: string;
  };
  children: OeeNode[];
}
interface HierResp {
  range: { from: string; to: string };
  plant: { oee: number; availability: number; performance: number; quality: number; oeeTb?: number; availabilityTb?: number; output: number; good: number; losses: OeeNode['losses'] };
  pareto: { reasonCode: string; minutes: number; events: number }[];
  tree: OeeNode[];
}

const TYPE_ICON: Record<string, React.ElementType> = { AREA: LayoutGrid, LINE: GitBranch, MACHINE: Cpu };
const oeeText = (v: number) => v >= 85 ? 'text-green-400' : v >= 65 ? 'text-brand-400' : v >= 45 ? 'text-amber-400' : 'text-red-400';
const oeeBar = (v: number) => v >= 85 ? 'bg-green-500' : v >= 65 ? 'bg-brand-500' : v >= 45 ? 'bg-amber-500' : 'bg-red-500';
const prettyReason = (c: string) => c.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-foreground/5 px-2 py-1 text-center min-w-[58px]">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('text-xs font-semibold tabular-nums', oeeText(value))}>{value}%</div>
    </div>
  );
}

function NodeRow({ node, depth }: { node: OeeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 1);
  // Every node follows the basis chosen in the filter panel. Performance and Quality
  // are the same under both bases — only Availability, and therefore OEE, differ.
  const oeeMode = useOeeMode();
  const oee = oeeMode.pick(node.oee, node.oeeTb);
  const availability = oeeMode.pick(node.availability, node.availabilityTb);
  const Icon = TYPE_ICON[node.type] ?? Cpu;
  const hasChildren = node.children?.length > 0;
  return (
    <>
      <div
        className={cn('flex items-center gap-2 py-1.5 pr-2 rounded-md hover:bg-muted/30 transition-colors', hasChildren && 'cursor-pointer')}
        style={{ paddingLeft: `${8 + depth * 18}px` }}
        onClick={() => hasChildren && setOpen(o => !o)}
      >
        <span className="w-4 shrink-0 text-muted-foreground">
          {hasChildren ? (open ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : null}
        </span>
        <Icon size={14} className={cn('shrink-0', node.type === 'AREA' ? 'text-violet-400' : node.type === 'LINE' ? 'text-orange-400' : 'text-green-400')} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium truncate">{node.name}</span>
            {/* A line's OEE can come from two different bases, so the basis is named
                next to the number rather than left to be guessed. */}
            {node.type === 'LINE' && node.oeeMethod && (
              <span
                title={[
                  node.oeeBasis?.formula,
                  node.oeeBasis?.bottleneckMachineName && `Bottleneck: ${node.oeeBasis.bottleneckMachineName}`,
                  node.oeeBasis?.outfeedMachineNames?.length
                    && `Outfeed: ${node.oeeBasis.outfeedMachineNames.join(' + ')}`,
                  node.oeeBasis?.fallbackReason,
                ].filter(Boolean).join('\n')}
                className={cn(
                  'shrink-0 rounded px-1 py-px text-[9px] font-semibold uppercase tracking-wide',
                  node.oeeBasis?.fallbackFrom
                    ? 'bg-amber-500/15 text-amber-400'
                    : node.oeeMethod === 'BOTTLENECK'
                      ? 'bg-brand-500/15 text-brand-400'
                      : 'bg-foreground/10 text-muted-foreground',
                )}
              >
                {node.oeeBasis?.fallbackFrom
                  ? 'roll-up*'
                  : node.oeeMethod === 'BOTTLENECK' ? 'bottleneck' : 'roll-up'}
              </span>
            )}
          </div>
          {node.code && <div className="text-[10px] text-muted-foreground font-mono">{node.code}</div>}
        </div>
        {/* OEE bar */}
        <div className="hidden sm:flex items-center gap-2 w-40 shrink-0">
          <div className="flex-1 h-1.5 rounded-full bg-foreground/10 overflow-hidden">
            <div className={cn('h-full rounded-full', oeeBar(oee))} style={{ width: `${oee}%` }} />
          </div>
          <span className={cn('text-xs font-bold tabular-nums w-11 text-right', oeeText(oee))}>{oee}%</span>
        </div>
        <div className="hidden md:flex items-center gap-1">
          <Metric label="A" value={availability} />
          <Metric label="P" value={node.performance} />
          <Metric label="Q" value={node.quality} />
        </div>
      </div>
      {open && hasChildren && node.children.map(c => <NodeRow key={c.id} node={c} depth={depth + 1} />)}
    </>
  );
}

export function HierarchyOEE() {
  const { t } = useTranslation('production');
  const { filter, key } = useScope();
  const { params: timeParams, key: timeKey } = useTimeRange();
  const oeeMode = useOeeMode();
  const { data, isLoading } = useQuery({
    queryKey: ['production', 'oee-hierarchy', key, timeKey],
    queryFn: () => api.get<HierResp>('/production/oee/hierarchy', {
      // The whole period: Today and Shift share dateFrom/dateTo, and only
      // `timeframe` tells them apart — the shift is resolved server-side.
      params: { ...filter, ...timeParams },
    }),
    staleTime: 30_000,
    // Keep the previous window on screen while the next is fetched, so a
    // filter change updates the figures instead of unmounting the view.
    placeholderData: keepPreviousData,
  });

  if (isLoading) {
    return <div className="industrial-card rounded-xl p-4"><div className="shimmer h-40 rounded" /></div>;
  }
  if (!data) return null;

  const { plant, pareto, tree } = data;
  // The plant headline follows the same basis as the nodes beneath it.
  const plantOee = oeeMode.pick(plant.oee, plant.oeeTb);
  const losses = plant.losses;
  const lossMax = Math.max(losses.availabilityLossMin, losses.performanceLossMin, losses.qualityLossMin, 1);
  const paretoMax = pareto[0]?.minutes || 1;

  return (
    <div className="grid grid-cols-12 gap-4">
      {/* Hierarchy tree */}
      <div className="col-span-12 lg:col-span-7">
        <div className="industrial-card rounded-xl p-4 h-full">
          <div className="flex items-center gap-2 mb-3">
            <Layers size={14} className="text-brand-400" />
            <span className="text-sm font-semibold">{t('hierOee.byHierarchy')}</span>
            <span className="ml-auto text-[11px] text-muted-foreground">{t('hierOee.plant')} <span className={cn('font-bold', oeeText(plantOee))}>{plantOee}%</span></span>
          </div>
          {tree.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-8">{t('hierOee.noRecords')}</div>
          ) : (
            <div className="space-y-0.5">{tree.map(n => <NodeRow key={n.id} node={n} depth={0} />)}</div>
          )}
        </div>
      </div>

      {/* Six-loss waterfall + Pareto */}
      <div className="col-span-12 lg:col-span-5 space-y-4">
        <div className="industrial-card rounded-xl p-4">
          <span className="text-sm font-semibold">{t('hierOee.lossBreakdown')}</span>
          <div className="mt-3 space-y-2.5">
            {([
              ['hierOee.availabilityLoss', losses.availabilityLossMin, 'bg-red-500'],
              ['hierOee.performanceLoss', losses.performanceLossMin, 'bg-amber-500'],
              ['hierOee.qualityLoss', losses.qualityLossMin, 'bg-violet-500'],
            ] as const).map(([labelKey, min, bar]) => (
              <div key={labelKey}>
                <div className="flex items-center justify-between text-[11px] mb-0.5">
                  <span className="text-muted-foreground">{t(labelKey)}</span>
                  <span className="font-semibold tabular-nums">{t('hierOee.minSuffix', { count: min })}</span>
                </div>
                <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                  <div className={cn('h-full rounded-full', bar)} style={{ width: `${(min / lossMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="industrial-card rounded-xl p-4">
          <span className="text-sm font-semibold">{t('hierOee.downtimePareto')}</span>
          {pareto.length === 0 ? (
            <div className="text-xs text-muted-foreground text-center py-6">{t('hierOee.noUnplanned')}</div>
          ) : (
            <div className="mt-3 space-y-2">
              {pareto.slice(0, 7).map(p => (
                <div key={p.reasonCode}>
                  <div className="flex items-center justify-between text-[11px] mb-0.5">
                    <span className="text-muted-foreground truncate">{prettyReason(p.reasonCode)} <span className="opacity-60">· {t('hierOee.eventsSuffix', { count: p.events })}</span></span>
                    <span className="font-semibold tabular-nums shrink-0 ml-2">{t('hierOee.minSuffix', { count: p.minutes })}</span>
                  </div>
                  <div className="h-2 rounded-full bg-foreground/10 overflow-hidden">
                    <div className="h-full rounded-full bg-red-500/70" style={{ width: `${(p.minutes / paretoMax) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
