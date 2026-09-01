'use client';

/**
 * ScopePanel — the unified analysis control panel (beside the main nav). It is the
 * SINGLE place every dashboard/KPI/OEE/report page is filtered from, replacing the
 * per-page toolbars. Sections:
 *   • Scope   — plant hierarchy tree (Factory→Area→Line→Machine) → scope-store
 *   • Period  — Today/Shift/Week/Month/Custom → time-range-store
 *   • Orders  — Production Order / Work Order (production & manufacturing routes)
 *   • View    — trend style (Area/Line/Bar) + OEE mode (schedule vs OEE-TB)
 * plus a Live indicator and a global Refresh. Every page reads these via the
 * matching store/hook, so one control surface drives the whole Industry360° web app.
 */

import React, { useState } from 'react';
import { toFactoryDayKey } from '@/lib/datetime';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname } from 'next/navigation';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import {
  ChevronRight, ChevronDown, Factory, LayoutGrid, GitBranch, Cpu, PanelLeftClose, PanelLeftOpen,
  Filter, Check, Info, CalendarRange, RefreshCw, Package, Boxes,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { useScopeStore, type ScopeType } from '@/store/scope-store';
import { useTimeRangeStore, type TimePreset } from '@/store/time-range-store';
import { useDashboardPrefsStore, type TrendType } from '@/store/dashboard-prefs-store';
import { useOrderFilterStore } from '@/store/order-filter-store';
import { useViewModeStore } from '@/store/view-mode-store';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { useLineBasis } from '@/hooks/use-line-basis';
import { useLineBasisStore } from '@/store/line-basis-store';
import { SelectMenu } from '@/components/ui/select-menu';

interface TreeNode {
  id: string;
  code: string;
  name: string;
  type: 'FACTORY' | 'AREA' | 'PRODUCTION_LINE' | 'MACHINE';
  children?: TreeNode[];
}

const TYPE_ICON: Record<string, React.ElementType> = {
  FACTORY: Factory, AREA: LayoutGrid, PRODUCTION_LINE: GitBranch, MACHINE: Cpu,
};
const TYPE_COLOR: Record<string, string> = {
  FACTORY: 'text-blue-400', AREA: 'text-violet-400', PRODUCTION_LINE: 'text-orange-400', MACHINE: 'text-green-400',
};
const toScopeType = (t: TreeNode['type']): ScopeType =>
  t === 'PRODUCTION_LINE' ? 'LINE' : (t as ScopeType);

// Routes where filtering by Production Order / Work Order has a real effect.
const ORDER_ROUTES = [
  '/oee-analysis', '/live-shift', '/oee-breakdown',
  '/production/kpi', '/production/oee', '/manufacturing/kpi', '/manufacturing/oee',
  '/quality/spc', '/quality/inspections', '/quality/records', '/quality/ncr',
  '/energy', '/energy/dashboard',
];

function Node({ node, depth }: { node: TreeNode; depth: number }) {
  const [open, setOpen] = useState(depth < 2);
  const { scope, setScope } = useScopeStore();
  const Icon = TYPE_ICON[node.type] ?? Cpu;
  const hasChildren = (node.children?.length ?? 0) > 0;
  const selected = scope?.id === node.id;

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 pr-1.5 py-1 rounded-md text-xs cursor-pointer transition-colors group',
          selected ? 'bg-primary/15 text-primary' : 'hover:bg-muted/50',
        )}
        style={{ paddingLeft: `${4 + depth * 12}px` }}
        onClick={() => setScope({ type: toScopeType(node.type), id: node.id, name: node.name, code: node.code })}
      >
        <button
          onClick={(e) => { e.stopPropagation(); if (hasChildren) setOpen(o => !o); }}
          className={cn('w-3.5 shrink-0 text-muted-foreground', !hasChildren && 'opacity-0 pointer-events-none')}
        >
          {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        </button>
        <Icon size={12} className={cn('shrink-0', selected ? 'text-primary' : TYPE_COLOR[node.type])} />
        <span className="flex-1 truncate">{node.name}</span>
        {selected && <Check size={11} className="shrink-0" />}
      </div>
      {open && hasChildren && (
        <div>{node.children!.map(c => <Node key={c.id} node={c} depth={depth + 1} />)}</div>
      )}
    </div>
  );
}

/** Small uppercase section label. */
function SectionLabel({ icon: Icon, children }: { icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/80">
      <Icon size={11} className="text-primary/70" />
      {children}
    </div>
  );
}

/** Period (time range) controls — presets grid + custom range popover. */
function PeriodSection() {
  const { t } = useTranslation('common');
  const { preset, from, to, setPreset, setCustom } = useTimeRangeStore();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from ?? toFactoryDayKey(Date.now() - 7 * 86_400_000));
  const [draftTo, setDraftTo] = useState(to ?? toFactoryDayKey(new Date()));

  const presets: { value: Exclude<TimePreset, 'custom'>; key: string }[] = [
    { value: 'today', key: 'timeRange.today' },
    { value: 'shift', key: 'timeRange.shift' },
    { value: 'week', key: 'timeRange.week' },
    { value: 'month', key: 'timeRange.month' },
  ];

  return (
    <div className="px-2">
      <div className="grid grid-cols-2 gap-1">
        {presets.map((p) => (
          <button
            key={p.value}
            onClick={() => setPreset(p.value)}
            className={cn(
              'px-2 py-1.5 text-xs rounded-md border transition-colors',
              preset === p.value ? 'border-primary/40 bg-primary/15 text-primary font-semibold' : 'border-border/60 text-muted-foreground hover:bg-muted/50',
            )}
          >
            {t(p.key)}
          </button>
        ))}
      </div>
      <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
        <PopoverPrimitive.Trigger asChild>
          <button
            className={cn(
              'mt-1 w-full px-2 py-1.5 text-xs rounded-md border flex items-center justify-center gap-1.5 transition-colors',
              preset === 'custom' ? 'border-primary/40 bg-primary/15 text-primary font-semibold' : 'border-border/60 text-muted-foreground hover:bg-muted/50',
            )}
          >
            <CalendarRange size={12} />
            {preset === 'custom' && from && to ? `${from.slice(5)} – ${to.slice(5)}` : t('timeRange.custom')}
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content align="start" side="right" sideOffset={8}
            className="z-50 w-60 rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl">
            <div className="space-y-2.5">
              <div>
                <label className="text-[10px] uppercase text-muted-foreground">{t('timeRange.from')}</label>
                <input type="date" value={draftFrom} max={draftTo} onChange={(e) => setDraftFrom(e.target.value)}
                  className="w-full h-8 px-2 text-sm rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <div>
                <label className="text-[10px] uppercase text-muted-foreground">{t('timeRange.to')}</label>
                <input type="date" value={draftTo} min={draftFrom} max={toFactoryDayKey(new Date())} onChange={(e) => setDraftTo(e.target.value)}
                  className="w-full h-8 px-2 text-sm rounded-md border border-input bg-background outline-none focus:ring-1 focus:ring-ring" />
              </div>
              <button className="w-full h-8 rounded-md bg-primary text-primary-foreground text-sm font-medium"
                onClick={() => { setCustom(draftFrom, draftTo); setOpen(false); }}>
                {t('timeRange.applyRange')}
              </button>
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}

/** Orders (PO → WO) cascading filter — only mounted on order-applicable routes. */
function OrdersSection() {
  const { t } = useTranslation(['common', 'production']);
  const { filter, key } = useScope();
  const { poNumber, woId, setPoNumber, setWoId } = useOrderFilterStore();

  const { data: poResp } = useQuery({
    queryKey: ['production', 'production-orders', 'panel-filter'],
    // 100 is the API's documented maximum — 200 is rejected with a 400.
    queryFn: () => api.get<any>('/production/production-orders', { params: { limit: 100 } }),
    staleTime: 60_000,
  });
  const productionOrders: any[] = Array.isArray(poResp) ? poResp : (poResp?.data ?? []);

  const { data: woResp } = useQuery({
    queryKey: ['production', 'work-orders', 'panel-filter', key],
    queryFn: () => api.get<any>('/production/work-orders', { params: { limit: 200, ...filter } }),
    staleTime: 60_000,
  });
  const allWorkOrders: any[] = woResp?.data ?? [];
  const woOptions = allWorkOrders
    .filter((w) => !poNumber || (w.productionOrder?.orderNumber ?? w.poNumber) === poNumber)
    .map((w) => ({ value: w.id, label: w.orderNumber ?? w.woNumber ?? w.id.slice(0, 8) }));

  return (
    <div className="px-2 space-y-1.5">
      <SelectMenu
        size="sm" fullWidth
        value={poNumber}
        onValueChange={setPoNumber}
        options={[{ value: '', label: t('production:sf.allPos') }, ...productionOrders.map((p: any) => ({ value: p.orderNumber, label: p.orderNumber }))]}
      />
      <SelectMenu
        size="sm" fullWidth
        value={woId}
        onValueChange={setWoId}
        options={[{ value: '', label: t('production:sf.allWos') }, ...woOptions]}
      />
      {(poNumber || woId) && (
        <button onClick={() => { setPoNumber(''); setWoId(''); }}
          className="w-full text-[11px] text-muted-foreground hover:text-foreground py-0.5">
          {t('actions.clear')}
        </button>
      )}
    </div>
  );
}

/**
 * Product and shift — offered only where they actually have rows.
 *
 * ── Why the options come from the data, not the master data ─────────────────
 * A product list built from the SKU table names every product the plant has ever
 * defined, so most of its options select nothing and a reader cannot tell "we
 * did not make that this week" from "I picked the wrong one". These options come
 * from `/oee-standard/dimensions`, which reads the same minutes the page reads,
 * so every option returns something and a MISSING option is itself the answer.
 *
 * Each list is built server-side with its own dimension excluded from the scope,
 * so choosing a product does not shrink the shift list to that product's shifts
 * and strand the reader with no way back.
 */
function DimensionsSection({ showShift }: { showShift: boolean }) {
  const { t } = useTranslation(['common', 'production']);
  const { filter, key } = useScope();
  const { params, key: timeKey } = useTimeRange();
  const { skuId, shiftTemplateId, setSkuId, setShiftTemplateId } = useOrderFilterStore();

  const { data } = useQuery({
    queryKey: ['oee-standard', 'dimensions', timeKey, key],
    queryFn: () => api.get<any>('/oee-standard/dimensions', {
      // The whole period, `timeframe` included. Picking the two date fields out
      // of it dropped the only thing that distinguishes Shift from Today, so
      // the filter lists covered a different window from the page they filter.
      params: { ...params, ...filter },
    }),
    staleTime: 60_000,
  });
  const dims = (data as any)?.data ?? data ?? {};
  const skus: any[] = dims.skus ?? [];
  const shifts: any[] = dims.shifts ?? [];

  // A selection that no longer has rows is kept in the list rather than dropped,
  // so the control still shows what is filtering the page. Silently falling back
  // to "all" would change the numbers without the reader touching anything.
  const withCurrent = (list: any[], id: string, label: string) =>
    id && !list.some((x) => x.id === id) ? [{ id, code: label, name: label }, ...list] : list;

  return (
    <div className="px-2 space-y-1.5">
      <SelectMenu
        size="sm" fullWidth
        value={skuId}
        onValueChange={setSkuId}
        options={[
          { value: '', label: skus.length ? `All products (${skus.length})` : 'All products' },
          ...withCurrent(skus, skuId, 'Selected product').map((k: any) => ({
            value: k.id, label: k.code ? `${k.code} · ${k.name}` : k.name,
          })),
        ]}
      />
      {showShift && (
        <SelectMenu
          size="sm" fullWidth
          value={shiftTemplateId}
          onValueChange={setShiftTemplateId}
          options={[
            { value: '', label: shifts.length ? `All shifts (${shifts.length})` : 'All shifts' },
            ...withCurrent(shifts, shiftTemplateId, 'Selected shift').map((x: any) => ({
              value: x.id, label: x.code ? `${x.code} · ${x.name}` : x.name,
            })),
          ]}
        />
      )}
      {(skuId || shiftTemplateId) && (
        <button onClick={() => { setSkuId(''); setShiftTemplateId(''); }}
          className="w-full text-[11px] text-muted-foreground hover:text-foreground py-0.5">
          {t('actions.clear')}
        </button>
      )}
      {skus.length === 0 && (
        <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">
          Nothing produced in this window, so there is nothing to filter by.
        </p>
      )}
    </div>
  );
}

/**
 * How a LINE is scored — shown only where the question exists.
 *
 * A line runs at the speed of its constraint, so a line's OEE is not a property
 * of its machines taken together: three machines idling because the fourth is
 * down did not each have a bad day. The two answers are genuinely different
 * questions, which is why this is a control and not a constant.
 *
 * Hidden for a single machine, because a machine has no constraint to be
 * measured by. Above a line it still applies: each line is scored on its own
 * method first, and the area or the factory averages those.
 */
function LineBasisSection() {
  const { basis, applies } = useLineBasis();
  const setBasis = useLineBasisStore((s) => s.setBasis);
  const { scope } = useScope();
  if (!applies) return null;

  const level = scope && scope.type !== 'FACTORY' ? scope.type : 'FACTORY';
  const options: Array<{ key: 'bottleneck' | 'rollup'; label: string; hint: string }> = [
    {
      key: 'bottleneck', label: 'Bottleneck',
      hint: 'The constraint sets the rate. A and P come from that machine alone; Quality counts '
        + 'good units where they leave the line and scrap at every machine. Answers: how did the '
        + 'LINE perform?',
    },
    {
      key: 'rollup', label: 'Roll-up',
      hint: 'Re-derived from the summed minutes and counts of every machine — not an average of '
        + 'their percentages. Answers: how did the ASSETS perform?',
    },
  ];

  return (
    <div className="px-2 space-y-1.5">
      <div className="inline-flex w-full rounded-md border border-border/60 p-0.5">
        {options.map((o) => (
          <button
            key={o.key}
            onClick={() => setBasis(o.key)}
            title={o.hint}
            aria-pressed={basis === o.key}
            className={cn(
              'flex-1 px-2 py-1 text-[11px] rounded transition-colors',
              basis === o.key
                ? 'bg-primary/15 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
      <p className="px-0.5 text-[10px] leading-snug text-muted-foreground">
        {level === 'LINE'
          ? 'Applies to the selected line.'
          : `Each line is scored this way first, then ${level === 'AREA' ? 'the area' : 'the factory'} averages its lines by occupancy.`}
        {' '}Which machine is the constraint stays set on the line itself.
      </p>
    </div>
  );
}

/** View prefs — trend render style + OEE mode (schedule vs time-based). */
function ViewSection() {
  const { t } = useTranslation('common');
  const { trendType, setTrendType, atOee, setAtOee } = useDashboardPrefsStore();
  const trends: TrendType[] = ['area', 'line', 'bar'];

  return (
    <div className="px-2 space-y-1.5">
      <div className="inline-flex w-full rounded-md border border-border/60 p-0.5">
        {trends.map((o) => (
          <button
            key={o}
            onClick={() => setTrendType(o)}
            className={cn(
              'flex-1 px-2 py-1 text-[11px] rounded capitalize transition-colors',
              trendType === o ? 'bg-primary/15 text-primary font-semibold' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`trend.${o}`)}
          </button>
        ))}
      </div>
      <button
        onClick={() => setAtOee(!atOee)}
        title={t('atOee.hint')}
        className={cn(
          'w-full h-7 rounded-md border px-2 text-[11px] font-semibold transition-colors',
          atOee ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border/60 text-muted-foreground hover:text-foreground',
        )}
      >
        {atOee ? t('atOee.tb') : t('atOee.schedule')}
      </button>
    </div>
  );
}

export function ScopePanel({ passive = false }: { passive?: boolean }) {
  const { t } = useTranslation('common');
  // Which half of the page is showing. The period control belongs to the
  // analytics half only — see where it is rendered below.
  const viewMode = useViewModeStore((s) => s.mode);
  const pathname = usePathname() ?? '';
  const queryClient = useQueryClient();
  const { scope, setScope, collapsed, toggleCollapsed } = useScopeStore();
  const [refreshing, setRefreshing] = useState(false);

  const { data } = useQuery({
    queryKey: ['hierarchy-tree'],
    queryFn: () => api.get('/hierarchy/tree'),
    staleTime: 60_000,
  });
  const tree: TreeNode[] = (() => {
    const d = (data as any)?.data ?? data;
    return Array.isArray(d) ? d : d ? [d] : [];
  })();

  const showOrders = ORDER_ROUTES.includes(pathname);
  // Only the two pages whose engines actually accept these filters.
  const showDimensions = pathname === '/oee-analysis' || pathname === '/live-shift'
    || pathname === '/oee-breakdown';
  // The basis question only exists from a LINE upwards. Gated here rather than
  // inside the section so the heading does not sit above nothing.
  const { applies: lineBasisApplies } = useLineBasis();

  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries();
    setTimeout(() => setRefreshing(false), 600);
  };

  if (collapsed) {
    return (
      <div className="shrink-0 border-r border-border/60 bg-card/40 flex flex-col items-center py-3 w-9">
        <button onClick={toggleCollapsed} title={t('scope.showScope')} className="p-1.5 rounded-md hover:bg-muted/60 text-muted-foreground">
          <PanelLeftOpen size={16} />
        </button>
        <Filter size={14} className="text-muted-foreground mt-2" />
      </div>
    );
  }

  return (
    <div className="shrink-0 w-60 border-r border-border/60 bg-card/40 flex flex-col">
      {/* Header — title + live + collapse */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 border-b border-border/60">
        <Filter size={13} className="text-primary" />
        <span className="text-xs font-semibold flex-1">{t('filters.title')}</span>
        <span className="inline-flex items-center gap-1 text-[10px] text-success-400">
          <span className="w-1.5 h-1.5 rounded-full bg-success-400 animate-pulse" />
          {t('status.live')}
        </span>
        <button onClick={toggleCollapsed} title={t('scope.collapse')} className="p-1 rounded-md hover:bg-muted/60 text-muted-foreground">
          <PanelLeftClose size={15} />
        </button>
      </div>

      {passive && (
        <div className="mx-2 mt-2 flex items-start gap-1.5 rounded-md bg-muted/40 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
          <Info size={12} className="mt-px shrink-0 text-primary/70" />
          <span>{t('scope.appliesOnAnalytics')}</span>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-3">
        {/* Scope */}
        <SectionLabel icon={Factory}>{t('scope.title')}</SectionLabel>
        <button
          onClick={() => setScope(null)}
          className={cn(
            'mx-2 mb-1 px-2 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors w-[calc(100%-1rem)]',
            !scope || scope.type === 'FACTORY' ? 'bg-primary/15 text-primary' : 'hover:bg-muted/50 text-muted-foreground',
          )}
        >
          <Factory size={12} /> {t('scope.wholeFactory')}
          {(!scope || scope.type === 'FACTORY') && <Check size={11} className="ml-auto" />}
        </button>
        <div className="px-2 space-y-0.5">
          {tree.length === 0 ? (
            <div className="text-[11px] text-muted-foreground text-center py-4">{t('scope.noHierarchy')}</div>
          ) : tree.map(root => <Node key={root.id} node={root} depth={0} />)}
        </div>

        {/* Period — analytics only.
            On a live view the window is the shift that is running and the browser
            has no say in it. Leaving the control visible there invites a reader to
            change it and then wonder why nothing moved, which is precisely the
            confusion the live/analytics split exists to end. */}
        {viewMode === 'analytics' && (
          <>
            <SectionLabel icon={CalendarRange}>{t('filters.period')}</SectionLabel>
            <PeriodSection />
          </>
        )}

        {/* Orders — production / manufacturing analysis routes only */}
        {showOrders && (
          <>
            <SectionLabel icon={Package}>{t('filters.orders')}</SectionLabel>
            <OrdersSection />
          </>
        )}

        {/* Line OEE basis — only where a line is in scope, and only on the pages
            whose engines return a line figure. */}
        {showDimensions && lineBasisApplies && (
          <>
            <SectionLabel icon={GitBranch}>Line OEE basis</SectionLabel>
            <LineBasisSection />
          </>
        )}

        {/* Product and shift. The shift picker is analytics-only: on a live view
            the shift is the one the clock says we are in, and offering a choice
            there would be offering to change something the page cannot honour. */}
        {showDimensions && (
          <>
            <SectionLabel icon={Boxes}>Product &amp; shift</SectionLabel>
            <DimensionsSection showShift={viewMode === 'analytics'} />
          </>
        )}

        {/* View */}
        <SectionLabel icon={Filter}>{t('filters.view')}</SectionLabel>
        <ViewSection />
      </div>

      {/* Footer — scoped-to + refresh */}
      <div className="border-t border-border/60 px-2 py-2 space-y-2">
        {scope && scope.type !== 'FACTORY' && (
          <div className="px-1 text-[10px] text-muted-foreground">
            {t('scope.scopedTo')} <span className="font-semibold text-foreground">{scope.name}</span> <span className="uppercase opacity-70">({scope.type})</span>
          </div>
        )}
        <button onClick={handleRefresh}
          className="w-full h-7 rounded-md border border-border/60 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted/50 flex items-center justify-center gap-1.5 transition-colors">
          <RefreshCw size={12} className={cn(refreshing && 'animate-spin')} />
          {t('actions.refresh')}
        </button>
      </div>
    </div>
  );
}
