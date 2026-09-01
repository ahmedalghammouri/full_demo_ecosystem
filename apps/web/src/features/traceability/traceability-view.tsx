'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import {
  Wrench, Factory, Package, Layers3, Cpu, Settings, Tag,
  Activity, Calendar, ChevronRight, Search, Filter, ChevronDown,
  ArrowRight, User, FileText, Eye, X as XIcon, History,
  GitBranch, ArrowUpRight, ArrowDownRight, FlaskConical,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api } from '@/services/api.client';
import { cn, timeAgo, formatDateTime } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';

// ── Types ────────────────────────────────────────────────────

interface TraceEvent {
  id: string;
  entityType: string;
  entityId: string;
  entityCode: string | null;
  eventType: string;
  fromValue: string | null;
  toValue: string | null;
  quantity: number | null;
  eventData: Record<string, unknown> | null;
  performedAt: string;
  notes: string | null;
  relatedType: string | null;
  relatedId: string | null;
  performedBy: { name: string } | null;
  factory: { name: string; code: string } | null;
}

interface TraceResponse {
  data: TraceEvent[];
  total: number;
  page: number;
}

interface TraceStats {
  totalEvents: number;
  events24h: number;
  events7d: number;
  byEntityType: Array<{ entityType: string; count: number }>;
  byEventType: Array<{ eventType: string; count: number }>;
  [key: string]: unknown;
}

interface DrilldownEntity {
  type: string;
  id: string;
  code?: string;
}

// ── Constants ────────────────────────────────────────────────

type EntityType = 'MAINT_WO' | 'PROD_WO' | 'BATCH' | 'SPARE_PART' | 'RAW_MATERIAL' | 'MACHINE' | 'PRODUCT';

const ENTITY_CONFIG: Record<string, {
  labelKey: string;
  icon: React.ElementType;
  dot: string;
  badge: string;
  iconCls: string;
}> = {
  MAINT_WO:     { labelKey: 'traceability.entity.MAINT_WO',     icon: Wrench,  dot: 'bg-amber-500',  badge: 'text-amber-400 border-amber-400/30 bg-amber-400/10',   iconCls: 'text-amber-400'  },
  PROD_WO:      { labelKey: 'traceability.entity.PROD_WO',      icon: Factory, dot: 'bg-blue-500',   badge: 'text-blue-400 border-blue-400/30 bg-blue-400/10',       iconCls: 'text-blue-400'   },
  BATCH:        { labelKey: 'traceability.entity.BATCH',        icon: Layers3, dot: 'bg-green-500',  badge: 'text-green-400 border-green-400/30 bg-green-400/10',    iconCls: 'text-green-400'  },
  SPARE_PART:   { labelKey: 'traceability.entity.SPARE_PART',   icon: Package, dot: 'bg-purple-500', badge: 'text-purple-400 border-purple-400/30 bg-purple-400/10', iconCls: 'text-purple-400' },
  RAW_MATERIAL: { labelKey: 'traceability.entity.RAW_MATERIAL', icon: Layers3, dot: 'bg-cyan-500',   badge: 'text-cyan-400 border-cyan-400/30 bg-cyan-400/10',       iconCls: 'text-cyan-400'   },
  MACHINE:      { labelKey: 'traceability.entity.MACHINE',      icon: Settings,dot: 'bg-orange-500', badge: 'text-orange-400 border-orange-400/30 bg-orange-400/10', iconCls: 'text-orange-400' },
  PRODUCT:      { labelKey: 'traceability.entity.PRODUCT',      icon: Tag,     dot: 'bg-pink-500',   badge: 'text-pink-400 border-pink-400/30 bg-pink-400/10',       iconCls: 'text-pink-400'   },
};

const FALLBACK_ENTITY = {
  labelKey: 'traceability.entity.fallback',
  icon: Cpu,
  dot: 'bg-muted',
  badge: 'text-muted-foreground border-border',
  iconCls: 'text-muted-foreground',
};

const EVENT_TYPE_KEYS: Record<string, string> = {
  CREATED:             'traceability.eventType.CREATED',
  STATUS_CHANGED:      'traceability.eventType.STATUS_CHANGED',
  PARTS_REQUESTED:     'traceability.eventType.PARTS_REQUESTED',
  PARTS_ISSUED:        'traceability.eventType.PARTS_ISSUED',
  PARTS_CANCELLED:     'traceability.eventType.PARTS_CANCELLED',
  STOCK_ADJUSTED:      'traceability.eventType.STOCK_ADJUSTED',
  STOCK_RECEIVED:      'traceability.eventType.STOCK_RECEIVED',
  COMPLETED:           'traceability.eventType.COMPLETED',
  CANCELLED:           'traceability.eventType.CANCELLED',
  STARTED:             'traceability.eventType.STARTED',
  UPDATED:             'traceability.eventType.UPDATED',
  DELETED:             'traceability.eventType.DELETED',
  ASSIGNED:            'traceability.eventType.ASSIGNED',
  INSPECTION_PASSED:   'traceability.eventType.INSPECTION_PASSED',
  INSPECTION_FAILED:   'traceability.eventType.INSPECTION_FAILED',
  BATCH_RELEASED:      'traceability.eventType.BATCH_RELEASED',
  BATCH_REJECTED:      'traceability.eventType.BATCH_REJECTED',
  QUALITY_HOLD:        'traceability.eventType.QUALITY_HOLD',
};

// ── Helpers ──────────────────────────────────────────────────

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

function humanizeEventType(t: TFunc, eventType: string): string {
  const key = EVENT_TYPE_KEYS[eventType];
  if (key) return t(key);
  return eventType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// ── Component ────────────────────────────────────────────────

// ── Genealogy Tree ───────────────────────────────────────────

interface TraceNode {
  type: string;
  id: string;
  label: string;
  meta?: Record<string, unknown>;
  children?: TraceNode[];
}

const NODE_CONFIG: Record<string, { color: string; icon: React.ElementType }> = {
  MATERIAL_LOT:       { color: 'text-cyan-400',    icon: Package },
  RAW_MATERIAL:       { color: 'text-cyan-400',    icon: Package },
  WORK_ORDER:         { color: 'text-blue-400',    icon: Factory },
  STEP:               { color: 'text-amber-400',   icon: Settings },
  BATCH:              { color: 'text-green-400',    icon: Layers3 },
  FINISHED_GOODS_LOT: { color: 'text-green-400',    icon: Layers3 },
  RECIPE:             { color: 'text-violet-400',   icon: FlaskConical },
};

function GenealogyNode({ node, depth = 0 }: { node: TraceNode; depth?: number }) {
  const [expanded, setExpanded] = useState(depth < 2);
  const cfg = NODE_CONFIG[node.type] ?? { color: 'text-muted-foreground', icon: Cpu };
  const Icon = cfg.icon;
  const hasChildren = (node.children?.length ?? 0) > 0;

  return (
    <div className={cn('relative', depth > 0 && 'ml-5 pl-3 border-l border-border/30')}>
      <div
        className={cn(
          'flex items-start gap-2 py-1.5 px-2 rounded-lg hover:bg-muted/10 cursor-pointer group',
          hasChildren && 'hover:bg-muted/20',
        )}
        onClick={() => hasChildren && setExpanded(e => !e)}
      >
        <div className="flex items-center gap-1.5 shrink-0 mt-0.5">
          {hasChildren ? (
            expanded
              ? <ChevronDown size={11} className="text-muted-foreground" />
              : <ChevronRight size={11} className="text-muted-foreground" />
          ) : (
            <div className="w-3" />
          )}
          <Icon size={13} className={cfg.color} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={cn('text-xs font-medium leading-snug', cfg.color)}>{node.label}</div>
          {node.meta && (
            <div className="flex flex-wrap gap-x-3 gap-y-0 mt-0.5">
              {Object.entries(node.meta)
                .filter(([, v]) => v !== null && v !== undefined && v !== '')
                .slice(0, 4)
                .map(([k, v]) => (
                  <span key={k} className="text-[10px] text-muted-foreground">
                    {k}: <span className="text-foreground/80">{String(v)}</span>
                  </span>
                ))}
            </div>
          )}
        </div>
      </div>
      {expanded && node.children?.map((child, i) => (
        <GenealogyNode key={`${child.id}-${i}`} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

function GenealogyPanel() {
  const { t } = useTranslation('modules');
  const [traceMode, setTraceMode] = useState<'backward' | 'forward'>('backward');
  const [entityId, setEntityId] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data: traceData, isLoading, isError } = useQuery({
    queryKey: ['traceability', 'genealogy', traceMode, submitted],
    queryFn: () => submitted
      ? api.get<TraceNode>(
          traceMode === 'backward'
            ? `/production/traceability/backward/${submitted}`
            : `/production/traceability/forward/${submitted}`,
        )
      : null,
    enabled: !!submitted,
  });

  const node = traceData as TraceNode | null | undefined;

  return (
    <div className="space-y-4">
      {/* Mode + search */}
      <div className="glass-card p-4 space-y-3">
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {(['backward', 'forward'] as const).map(mode => (
            <button
              key={mode}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 transition-colors',
                traceMode === mode ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/20',
              )}
              onClick={() => { setTraceMode(mode); setSubmitted(''); }}
            >
              {mode === 'backward' ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
              {mode === 'backward' ? t('traceability.geneTraceBackward') : t('traceability.geneTraceForward')}
            </button>
          ))}
        </div>

        <div className="text-[10px] text-muted-foreground">
          {traceMode === 'backward'
            ? t('traceability.geneHintBackward')
            : t('traceability.geneHintForward')}
        </div>

        <div className="flex gap-2">
          <Input
            placeholder={traceMode === 'backward' ? t('traceability.genePlaceholderBackward') : t('traceability.genePlaceholderForward')}
            value={entityId}
            onChange={e => setEntityId(e.target.value)}
            className="h-8 text-xs font-mono"
            onKeyDown={e => { if (e.key === 'Enter' && entityId.trim()) setSubmitted(entityId.trim()); }}
          />
          <Button
            size="sm"
            className="h-8 text-xs shrink-0"
            onClick={() => setSubmitted(entityId.trim())}
            disabled={!entityId.trim() || isLoading}
          >
            <Search size={12} />
            {t('traceability.geneTrace')}
          </Button>
        </div>
      </div>

      {/* Result tree */}
      {isLoading && (
        <div className="glass-card p-8 text-center">
          <div className="shimmer h-4 w-48 rounded mx-auto mb-2" />
          <div className="shimmer h-3 w-64 rounded mx-auto" />
        </div>
      )}
      {isError && (
        <div className="glass-card p-6 text-center text-red-400 text-sm">
          {t('traceability.geneError')}
        </div>
      )}
      {node && !isLoading && (
        <div className="glass-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch size={14} className="text-primary" />
            <h3 className="text-sm font-semibold">
              {traceMode === 'backward' ? t('traceability.geneBackwardTitle') : t('traceability.geneForwardTitle')}
            </h3>
          </div>
          <GenealogyNode node={node} depth={0} />
        </div>
      )}
    </div>
  );
}

export function TraceabilityView({ fixedTab }: { fixedTab?: 'log' | 'genealogy' } = {}) {
  const { t } = useTranslation('modules');
  const [activeTab, setActiveTab] = useState<'log' | 'genealogy'>(fixedTab ?? 'log');
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('');
  const [eventSearch, setEventSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);
  const [drilldown, setDrilldown] = useState<DrilldownEntity | null>(null);
  const [drillPage, setDrillPage] = useState(1);

  // ── Queries ─────────────────────────────────────────────────

  const { data: statsData } = useQuery({
    queryKey: ['traceability', 'stats'],
    queryFn: () => api.get<TraceStats>('/traceability/stats'),
    staleTime: 60_000,
  });

  const stats = statsData as unknown as TraceStats | undefined;

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['traceability', 'events', { entityTypeFilter, eventSearch, dateFrom, dateTo, page }],
    queryFn: () =>
      api.get<TraceResponse>('/traceability', {
        params: {
          entityType: entityTypeFilter || undefined,
          eventType: eventSearch || undefined,
          dateFrom: dateFrom || undefined,
          dateTo: dateTo || undefined,
          page,
          limit: 30,
        },
      }),
    staleTime: 15_000,
  });

  const { data: drillData } = useQuery({
    queryKey: ['traceability', 'entity', drilldown?.type, drilldown?.id, drillPage],
    queryFn: () => drilldown
      ? api.get(`/traceability/entity/${drilldown.type}/${drilldown.id}?page=${drillPage}&limit=50`)
      : null,
    enabled: !!drilldown,
    staleTime: 15_000,
  });

  const response = data as unknown as TraceResponse | undefined;
  const events: TraceEvent[] = response?.data ?? [];
  const total: number = response?.total ?? 0;
  const drillEvents: TraceEvent[] = (drillData as any)?.data ?? [];
  const drillTotal: number = (drillData as any)?.total ?? 0;

  // ── Reset page when filters change ──────────────────────────

  const applyFilter = (fn: () => void) => {
    fn();
    setPage(1);
  };

  const openDrilldown = (event: TraceEvent) => {
    setDrilldown({ type: event.entityType, id: event.entityId, code: event.entityCode ?? undefined });
    setDrillPage(1);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">
              {fixedTab === 'genealogy' ? t('traceability.genealogy') : fixedTab === 'log' ? t('traceability.log') : t('traceability.title')}
            </h1>
            <DashboardInfo id="traceability" />
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {fixedTab === 'genealogy'
              ? t('traceability.genealogySubtitle')
              : t('traceability.logSubtitle')}
          </p>
        </div>
        {/* Tab switcher (hidden when the page is dedicated to one section) */}
        {!fixedTab && (
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            <button
              className={cn('px-4 py-1.5 transition-colors', activeTab === 'log' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/20')}
              onClick={() => setActiveTab('log')}
            >
              {t('traceability.tabEventLog')}
            </button>
            <button
              className={cn('px-4 py-1.5 flex items-center gap-1.5 transition-colors', activeTab === 'genealogy' ? 'bg-primary/20 text-primary' : 'text-muted-foreground hover:bg-muted/20')}
              onClick={() => setActiveTab('genealogy')}
            >
              <GitBranch size={11} />
              {t('traceability.tabGenealogy')}
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        {activeTab === 'genealogy' && <GenealogyPanel />}
        {activeTab === 'log' && (<>
        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: t('traceability.stat.totalEvents'),
              value: stats?.totalEvents,
              icon: Activity,
              color: 'text-primary',
              sub: t('traceability.stat.allTime'),
            },
            {
              label: t('traceability.stat.last24h'),
              value: stats?.events24h,
              icon: Calendar,
              color: 'text-green-400',
              sub: t('traceability.stat.newEvents'),
            },
            {
              label: t('traceability.stat.last7d'),
              value: stats?.events7d,
              icon: ChevronRight,
              color: 'text-blue-400',
              sub: t('traceability.stat.recentActivity'),
            },
          ].map(({ label, value, icon: Icon, color, sub }) => (
            <div key={label} className="glass-card p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-muted-foreground">{label}</span>
                <Icon size={14} className={color} />
              </div>
              <p className={cn('text-2xl font-bold', color)}>
                {value !== undefined ? value.toLocaleString() : <span className="shimmer inline-block h-6 w-16 rounded" />}
              </p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="glass-card p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={13} className="text-muted-foreground shrink-0" />

            {/* Entity type */}
            <Select
              value={entityTypeFilter || '__all__'}
              onValueChange={v => applyFilter(() => setEntityTypeFilter(v === '__all__' ? '' : v))}
            >
              <SelectTrigger className="h-8 w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('traceability.allEntityTypes')}</SelectItem>
                {Object.entries(ENTITY_CONFIG).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{t(v.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Event type search */}
            <div className="relative">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('traceability.searchEventType')}
                value={eventSearch}
                onChange={e => applyFilter(() => setEventSearch(e.target.value))}
                className="h-8 pl-7 w-40 text-xs"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t('traceability.from')}</span>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => applyFilter(() => setDateFrom(e.target.value))}
                className="h-8 w-36 text-xs"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t('traceability.to')}</span>
              <Input
                type="date"
                value={dateTo}
                onChange={e => applyFilter(() => setDateTo(e.target.value))}
                className="h-8 w-36 text-xs"
              />
            </div>

            {(entityTypeFilter || eventSearch || dateFrom || dateTo) && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={() => {
                  setEntityTypeFilter('');
                  setEventSearch('');
                  setDateFrom('');
                  setDateTo('');
                  setPage(1);
                }}
              >
                {t('traceability.clearFilters')}
              </Button>
            )}
          </div>
        </div>

        {/* Timeline + drilldown */}
        <div className="flex gap-4">
        <div className="flex-1 space-y-2">
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="glass-card p-4 flex gap-3 animate-pulse">
                <div className="w-8 h-8 rounded-full bg-muted/50 shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="shimmer h-3.5 rounded w-32" />
                  <div className="shimmer h-3 rounded w-64" />
                  <div className="shimmer h-3 rounded w-48" />
                </div>
              </div>
            ))
          ) : events.length === 0 ? (
            <div className="glass-card p-12 text-center text-muted-foreground">
              <Activity size={40} className="mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium">{t('traceability.noEvents')}</p>
              <p className="text-xs mt-1">
                {entityTypeFilter || eventSearch || dateFrom || dateTo
                  ? t('traceability.noEventsHintFiltered')
                  : t('traceability.noEventsHint')
                }
              </p>
            </div>
          ) : (
            <>
              {events.map(event => {
                const cfg = ENTITY_CONFIG[event.entityType] ?? FALLBACK_ENTITY;
                const EntityIcon = cfg.icon;
                const isStatusChange = event.eventType === 'STATUS_CHANGED' || (event.fromValue && event.toValue);

                return (
                  <div
                    key={event.id}
                    className="glass-card p-4 flex gap-3 hover:bg-muted/10 transition-colors"
                  >
                    {/* Colored circle icon */}
                    <div className={cn(
                      'w-9 h-9 rounded-full shrink-0 flex items-center justify-center',
                      cfg.dot.replace('bg-', 'bg-') + '/15',
                    )}>
                      <EntityIcon size={16} className={cfg.iconCls} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Top row: badges + timestamp */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          'text-[10px] font-medium px-2 py-0.5 rounded-full border',
                          cfg.badge,
                        )}>
                          {t(cfg.labelKey)}
                        </span>
                        <span className="text-xs text-muted-foreground font-medium">
                          {humanizeEventType(t, event.eventType)}
                        </span>
                        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                          {timeAgo(event.performedAt)}
                        </span>
                      </div>

                      {/* Entity code + status change */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {event.entityCode && (
                          <button
                            onClick={() => openDrilldown(event)}
                            className="font-mono text-xs font-semibold hover:text-primary transition-colors flex items-center gap-1 group/drill"
                          >
                            {event.entityCode}
                            <Eye size={10} className="opacity-0 group-hover/drill:opacity-50 transition-opacity" />
                          </button>
                        )}
                        {isStatusChange && event.fromValue && event.toValue && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <span className="text-foreground/60">{event.fromValue}</span>
                            <ArrowRight size={10} className="text-muted-foreground/60" />
                            <span className="text-foreground font-medium">{event.toValue}</span>
                          </span>
                        )}
                        {!isStatusChange && event.toValue && !event.fromValue && (
                          <span className="text-xs text-muted-foreground">
                            → <span className="text-foreground">{event.toValue}</span>
                          </span>
                        )}
                        {event.quantity !== null && (
                          <span className="text-xs text-muted-foreground">
                            {t('traceability.qty')}: <span className="font-semibold text-foreground">{event.quantity}</span>
                          </span>
                        )}
                      </div>

                      {/* Meta: performer, factory, timestamp */}
                      <div className="flex items-center gap-3 flex-wrap">
                        {event.performedBy && (
                          <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            <User size={9} />
                            {event.performedBy.name}
                          </span>
                        )}
                        {event.factory && (
                          <span className="text-[10px] text-muted-foreground">
                            {event.factory.name}
                          </span>
                        )}
                        <span className="text-[10px] text-muted-foreground/60">
                          {formatDateTime(event.performedAt)}
                        </span>
                      </div>

                      {/* Notes */}
                      {event.notes && (
                        <div className="flex items-start gap-1 text-[10px] text-muted-foreground italic">
                          <FileText size={9} className="mt-0.5 shrink-0" />
                          {event.notes}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              <TablePagination page={page} total={total} limit={30} onPageChange={setPage} />
            </>
          )}
        </div>

        {/* Entity drilldown panel */}
        {drilldown && (
          <div className="w-72 shrink-0">
            <div className="glass-card sticky top-4">
              <div className="p-3 border-b border-border/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History size={13} className="text-primary" />
                  <div>
                    <div className="text-xs font-semibold">{drilldown.code ?? drilldown.id.slice(0, 12)}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {t('traceability.entityHistory', { label: t((ENTITY_CONFIG[drilldown.type] ?? FALLBACK_ENTITY).labelKey) })}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setDrilldown(null)}>
                  <XIcon size={12} />
                </Button>
              </div>
              <div className="p-3 max-h-[calc(100vh-360px)] overflow-y-auto">
                {drillEvents.length === 0 ? (
                  <div className="text-xs text-muted-foreground text-center py-4">{t('traceability.noHistory')}</div>
                ) : (
                  <div className="space-y-2">
                    {drillEvents.map((ev, i) => {
                      const isLast = i === drillEvents.length - 1;
                      const isStatusChange = ev.eventType === 'STATUS_CHANGED' || (ev.fromValue && ev.toValue);
                      return (
                        <div key={ev.id} className="flex gap-2 text-xs">
                          <div className="flex flex-col items-center">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-1.5 shrink-0" />
                            {!isLast && <div className="w-px flex-1 bg-border/40 mt-1" />}
                          </div>
                          <div className={cn('pb-2', isLast ? '' : '')}>
                            <div className="font-medium text-[10px] leading-snug">
                              {humanizeEventType(t, ev.eventType)}
                              {isStatusChange && ev.fromValue && ev.toValue && (
                                <span className="text-muted-foreground font-normal ml-1">
                                  {ev.fromValue} → {ev.toValue}
                                </span>
                              )}
                            </div>
                            {ev.notes && <div className="text-[10px] text-muted-foreground truncate">{ev.notes}</div>}
                            <div className="text-[10px] text-muted-foreground/60">
                              {timeAgo(ev.performedAt)}{ev.performedBy ? ` · ${ev.performedBy.name}` : ''}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
              {drillTotal > 50 && (
                <div className="p-2 border-t border-border/50">
                  <TablePagination page={drillPage} total={drillTotal} limit={50} onPageChange={setDrillPage} className="text-[10px]" />
                </div>
              )}
            </div>
          </div>
        )}
        </div>
        </>)}
      </div>
    </div>
  );
}
