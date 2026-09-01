'use client';

import React, { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  SlidersHorizontal,
  Play,
  Pause,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ChevronRight,
  Layers,
  Search,
  ClipboardList,
  Zap,
  Workflow,
  X,
  ArrowRight,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { AutoGenerateWODialog } from '../production/auto-generate-wo-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectMenu } from '@/components/ui/select-menu';
import { Input } from '@/components/ui/input';
import { motion, AnimatePresence } from 'framer-motion';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type WOStatus = 'PLANNED' | 'RELEASED' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';
type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface JobOrder {
  id: string;
  operationName: string;
  sequenceOrder: number;
  status: string;
  machine?: { name: string; code?: string } | null;
  operator?: { name: string } | null;
  joOEE?: number | null;
}

interface WorkOrder {
  id: string;
  orderNumber: string;
  status: WOStatus;
  priority: Priority;
  productName: string;
  plannedQty: number;
  goodQty: number;
  scrapQty: number;
  progress: number;
  completedSteps: number;
  totalSteps: number;
  plannedStart: string;
  plannedEnd: string;
  jobOrders: JobOrder[];
}

interface WorkOrdersResponse {
  data: WorkOrder[];
  total: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<Priority, { labelKey: string; cls: string } | undefined> = {
  CRITICAL: { labelKey: 'mfgControl.priority.critical', cls: 'bg-red-500/20 text-red-400 border-red-500/40' },
  HIGH:     { labelKey: 'mfgControl.priority.high',     cls: 'bg-orange-500/20 text-orange-400 border-orange-500/40' },
  MEDIUM:   undefined,
  LOW:      undefined,
};

const JO_STATUS_CLS: Record<string, string> = {
  READY:      'text-blue-400 bg-blue-500/15 border-blue-500/30',
  EXECUTING:  'text-green-400 bg-green-500/15 border-green-500/30',
  PAUSED:     'text-amber-400 bg-amber-500/15 border-amber-500/30',
  COMPLETE:   'text-slate-400 bg-slate-500/15 border-slate-500/30',
  SCHEDULED:  'text-slate-400 bg-slate-500/10 border-slate-500/20',
  CANCELLED:  'text-red-400 bg-red-500/10 border-red-500/20',
};

const STATUS_FILTER_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'all',         labelKey: 'mfgControl.statusFilter.all' },
  { value: 'PLANNED',     labelKey: 'mfgControl.statusFilter.planned' },
  { value: 'RELEASED',    labelKey: 'mfgControl.statusFilter.released' },
  { value: 'IN_PROGRESS', labelKey: 'mfgControl.statusFilter.inProgress' },
  { value: 'ON_HOLD',     labelKey: 'mfgControl.statusFilter.onHold' },
  { value: 'COMPLETED',   labelKey: 'mfgControl.statusFilter.completed' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function isCompletedToday(wo: WorkOrder): boolean {
  if (wo.status !== 'COMPLETED') return false;
  // plannedEnd is used as proxy since completedAt isn't in the list payload
  if (!wo.plannedEnd) return false;
  const d = new Date(wo.plannedEnd);
  const today = new Date();
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

function oeeColor(v?: number | null): string {
  if (v == null) return 'text-muted-foreground';
  if (v >= 85) return 'text-green-400';
  if (v >= 65) return 'text-yellow-400';
  return 'text-red-400';
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────────────

interface StatBoxProps {
  label: string;
  value: number;
  colorCls: string;
  icon: React.ReactNode;
}

function StatBox({ label, value, colorCls, icon }: StatBoxProps) {
  return (
    <div className="industrial-card rounded-xl px-4 py-3 flex items-center gap-3 flex-1 min-w-[120px]">
      <div className={cn('shrink-0', colorCls)}>{icon}</div>
      <div>
        <div className={cn('text-2xl font-bold tabular-nums', colorCls)}>{value}</div>
        <div className="text-[11px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

interface ProgressBarProps {
  value: number;
  colorCls?: string;
  height?: string;
}

function ProgressBar({ value, colorCls = 'bg-primary', height = 'h-1.5' }: ProgressBarProps) {
  return (
    <div className={cn('w-full bg-muted/40 rounded-full overflow-hidden', height)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', colorCls)}
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

interface JOChipProps {
  jo: JobOrder;
}

function JOChip({ jo }: JOChipProps) {
  const { t } = useTranslation('modules');
  const statusCls = JO_STATUS_CLS[jo.status] ?? 'text-muted-foreground bg-muted/20 border-border/30';
  const operatorName = jo.operator?.name ?? null;
  const statusLabel = t('mfgControl.joStatus.' + jo.status, { defaultValue: jo.status });

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-md bg-background/40 border border-border/20">
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="font-mono text-[10px] text-primary shrink-0">
          {jo.sequenceOrder != null ? `${jo.sequenceOrder}. ` : ''}{jo.operationName}
        </span>
        {jo.machine && (
          <span className="text-[10px] text-muted-foreground truncate">{jo.machine.name}</span>
        )}
        {operatorName && (
          <span className="text-[10px] text-muted-foreground/70 truncate hidden sm:inline">
            · {operatorName}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded border', statusCls)}>
          {statusLabel}
        </span>
        {jo.joOEE != null && (
          <span className={cn('text-[10px] font-bold tabular-nums', oeeColor(jo.joOEE))}>
            {jo.joOEE.toFixed(0)}%
          </span>
        )}
      </div>
    </div>
  );
}

interface WOCardProps {
  wo: WorkOrder;
  onStart?: (id: string) => void;
  onHold?: (id: string) => void;
  onRelease?: (id: string) => void;
  onComplete?: (id: string) => void;
  isPending?: boolean;
}

function WOCard({ wo, onStart, onHold, onRelease, onComplete, isPending }: WOCardProps) {
  const { t } = useTranslation('modules');
  const [expanded, setExpanded] = useState(false);
  const stepPct =
    wo.totalSteps > 0
      ? Math.round((wo.completedSteps / wo.totalSteps) * 100)
      : wo.progress ?? 0;

  const priorityBadge = PRIORITY_BADGE[wo.priority];
  const canStart    = wo.status === 'RELEASED' && !!onStart;
  const canHold     = wo.status === 'IN_PROGRESS' && !!onHold;
  const canRelease  = wo.status === 'ON_HOLD' && !!onRelease;
  const canComplete = wo.status === 'IN_PROGRESS' && stepPct >= 80 && !!onComplete;

  const progressColor =
    wo.status === 'IN_PROGRESS'
      ? 'bg-green-500'
      : wo.status === 'ON_HOLD'
      ? 'bg-amber-500'
      : 'bg-blue-500';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.2 }}
      className="industrial-card rounded-xl border border-border/30 overflow-hidden"
    >
      {/* Card header */}
      <div className="px-3 pt-3 pb-2">
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-mono text-xs font-bold text-primary">{wo.orderNumber}</span>
              {priorityBadge && (
                <span
                  className={cn(
                    'text-[9px] font-bold px-1.5 py-0.5 rounded border',
                    priorityBadge.cls,
                  )}
                >
                  {t(priorityBadge.labelKey)}
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground truncate mt-0.5">{wo.productName || '—'}</div>
          </div>
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground shrink-0">
            <Clock size={10} />
            <span>{fmtDate(wo.plannedEnd)}</span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-muted-foreground">
              {t('mfgControl.stepsProgress', { completed: wo.completedSteps, total: wo.totalSteps })}
            </span>
            <span className="text-[10px] font-semibold tabular-nums">{stepPct}%</span>
          </div>
          <ProgressBar value={stepPct} colorCls={progressColor} />
        </div>

        {/* Qty row */}
        <div className="flex items-center gap-3 text-[11px] mb-2">
          <span className="text-muted-foreground">
            {t('mfgControl.planned')}: <span className="text-foreground font-medium">{wo.plannedQty}</span>
          </span>
          <span className="text-green-400 font-medium">
            {t('mfgControl.good')}: {wo.goodQty}
          </span>
          {wo.scrapQty > 0 && (
            <span className="text-red-400 font-medium">{t('mfgControl.scrap')}: {wo.scrapQty}</span>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {canStart && (
            <Button
              size="sm"
              className="h-6 px-2 text-[10px] gap-1 bg-green-600 hover:bg-green-700"
              disabled={isPending}
              onClick={() => onStart!(wo.id)}
            >
              <Play size={10} />{t('mfgControl.start')}
            </Button>
          )}
          {canHold && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px] gap-1 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
              disabled={isPending}
              onClick={() => onHold!(wo.id)}
            >
              <Pause size={10} />{t('mfgControl.hold')}
            </Button>
          )}
          {canRelease && (
            <Button
              size="sm"
              className="h-6 px-2 text-[10px] gap-1 bg-blue-600 hover:bg-blue-700"
              disabled={isPending}
              onClick={() => onRelease!(wo.id)}
            >
              <Play size={10} />{t('mfgControl.release')}
            </Button>
          )}
          {canComplete && (
            <Button
              size="sm"
              className="h-6 px-2 text-[10px] gap-1 bg-green-600 hover:bg-green-700"
              disabled={isPending}
              onClick={() => onComplete!(wo.id)}
            >
              <CheckCircle2 size={10} />{t('mfgControl.complete')}
            </Button>
          )}
        </div>
      </div>

      {/* Job orders toggle */}
      {(wo.jobOrders?.length ?? 0) > 0 && (
        <>
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-muted-foreground border-t border-border/20 hover:bg-muted/10 transition-colors"
          >
            <span className="flex items-center gap-1">
              <Layers size={10} />
              {t('mfgControl.jobOrdersCount', { count: wo.jobOrders!.length })}
            </span>
            <ChevronRight
              size={11}
              className={cn('transition-transform', expanded && 'rotate-90')}
            />
          </button>
          <AnimatePresence initial={false}>
            {expanded && (
              <motion.div
                key="jo-list"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="px-3 pb-2 space-y-1">
                  {(wo.jobOrders ?? []).map(jo => (
                    <JOChip key={jo.id} jo={jo} />
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Kanban Column
// ─────────────────────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  title: string;
  count: number;
  headerCls: string;
  accentCls: string;
  orders: WorkOrder[];
  onStart?: (id: string) => void;
  onHold?: (id: string) => void;
  onRelease?: (id: string) => void;
  onComplete?: (id: string) => void;
  isPending?: boolean;
  highlighted?: boolean;
}

function KanbanColumn({
  title,
  count,
  headerCls,
  accentCls,
  orders,
  onStart,
  onHold,
  onRelease,
  onComplete,
  isPending,
  highlighted,
}: KanbanColumnProps) {
  const { t } = useTranslation('modules');
  return (
    <div
      className={cn(
        'flex flex-col rounded-xl border min-h-0 overflow-hidden',
        highlighted
          ? 'border-green-500/40 bg-green-500/5'
          : 'border-border/40 bg-background/30',
      )}
    >
      {/* Column header */}
      <div className={cn('px-4 py-3 border-b flex items-center justify-between', headerCls)}>
        <span className="text-sm font-bold">{title}</span>
        <span
          className={cn(
            'text-xs font-bold tabular-nums px-2 py-0.5 rounded-full',
            accentCls,
          )}
        >
          {count}
        </span>
      </div>

      {/* Scrollable card list */}
      <div className="flex-1 p-3 space-y-3 min-h-[200px]">
        <AnimatePresence>
          {orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/50 text-xs gap-2">
              <Layers size={22} />
              <span>{t('mfgControl.noWorkOrders')}</span>
            </div>
          ) : (
            orders.map(wo => (
              <WOCard
                key={wo.id}
                wo={wo}
                onStart={onStart}
                onHold={onHold}
                onRelease={onRelease}
                onComplete={onComplete}
                isPending={isPending}
              />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Completed Table (last 10)
// ─────────────────────────────────────────────────────────────────────────────

interface CompletedTableProps {
  orders: WorkOrder[];
}

function CompletedTable({ orders }: CompletedTableProps) {
  const { t } = useTranslation('modules');
  const last10 = orders.filter(w => w.status === 'COMPLETED').slice(0, 10);

  if (last10.length === 0) return null;

  const headers: { key: string; label: string }[] = [
    { key: 'woNumber', label: t('mfgControl.completedCol.woNumber') },
    { key: 'product', label: t('mfgControl.completedCol.product') },
    { key: 'plannedEnd', label: t('mfgControl.completedCol.plannedEnd') },
    { key: 'goodQty', label: t('mfgControl.completedCol.goodQty') },
    { key: 'scrap', label: t('mfgControl.completedCol.scrap') },
    { key: 'oee', label: t('mfgControl.completedCol.oee') },
  ];

  return (
    <div className="industrial-card rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border/30 flex items-center gap-2">
        <CheckCircle2 size={14} className="text-slate-400" />
        <span className="text-sm font-semibold">{t('mfgControl.recentlyCompleted')}</span>
        <span className="ml-auto text-xs text-muted-foreground">{t('mfgControl.lastN', { count: last10.length })}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/20">
              {headers.map(h => (
                <th
                  key={h.key}
                  className="text-left px-4 py-2 text-[11px] font-semibold text-muted-foreground"
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {last10.map((wo, i) => {
              // Compute a rough OEE from job orders if available
              const oees = (wo.jobOrders ?? [])
                .map(j => j.joOEE)
                .filter((v): v is number => v != null);
              const avgOEE =
                oees.length > 0
                  ? oees.reduce((a, b) => a + b, 0) / oees.length
                  : null;

              return (
                <motion.tr
                  key={wo.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.03 }}
                  className="border-b border-border/10 hover:bg-muted/10 transition-colors"
                >
                  <td className="px-4 py-2 font-mono text-primary font-semibold">{wo.orderNumber}</td>
                  <td className="px-4 py-2 text-muted-foreground truncate max-w-[140px]">
                    {wo.productName || '—'}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{fmtDate(wo.plannedEnd)}</td>
                  <td className="px-4 py-2 text-green-400 font-medium">{wo.goodQty}</td>
                  <td className="px-4 py-2">
                    {wo.scrapQty > 0 ? (
                      <span className="text-red-400">{wo.scrapQty}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {avgOEE != null ? (
                      <span
                        className={cn(
                          'font-bold tabular-nums px-1.5 py-0.5 rounded border text-[10px]',
                          avgOEE >= 85
                            ? 'text-green-400 bg-green-500/10 border-green-500/30'
                            : avgOEE >= 65
                            ? 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30'
                            : 'text-red-400 bg-red-500/10 border-red-500/30',
                        )}
                      >
                        {avgOEE.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </motion.tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Production-Order Pipeline — release POs and auto-generate WOs/JOs from here,
// then the generated work orders flow straight into the kanban below.
// ─────────────────────────────────────────────────────────────────────────────

interface PipelinePO {
  id: string;
  orderNumber: string;
  status: string;
  targetQty: number;
  unit?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  sku?: { name: string; itemNumber?: string } | null;
  workOrders?: Array<{ id: string; status: string }>;
}

const PO_STATUS_CLS: Record<string, string> = {
  PLANNED:     'text-slate-300 bg-slate-500/15 border-slate-500/30',
  RELEASED:    'text-blue-400 bg-blue-500/15 border-blue-500/30',
  IN_PROGRESS: 'text-green-400 bg-green-500/15 border-green-500/30',
  ON_HOLD:     'text-amber-400 bg-amber-500/15 border-amber-500/30',
};


function POPipeline() {
  const { t } = useTranslation('modules');
  const qc = useQueryClient();
  const [autoGenPO, setAutoGenPO] = useState<PipelinePO | null>(null);
  const [open, setOpen] = useState(true);

  const { data } = useQuery({
    queryKey: ['control-pos'],
    queryFn: () => api.get('/production/production-orders', { params: { limit: 30 } }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const pos: PipelinePO[] = ((data as any)?.data ?? []).filter(
    (p: PipelinePO) => ['PLANNED', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD'].includes(p.status),
  );

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['control-pos'] });
    qc.invalidateQueries({ queryKey: ['work-orders'] });
  };

  const releaseMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/production/production-orders/${id}/release`),
    onSuccess: invalidateAll,
  });

  if (pos.length === 0) return null;

  const needsAction = pos.filter(
    p => p.status === 'PLANNED' || (['RELEASED', 'IN_PROGRESS'].includes(p.status) && (p.workOrders?.length ?? 0) === 0),
  ).length;

  return (
    <div className="industrial-card rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-muted/20 transition-colors',
          open && 'border-b border-border/30',
        )}
      >
        <ChevronRight size={14} className={cn('text-muted-foreground shrink-0 transition-transform', open && 'rotate-90')} />
        <ClipboardList size={14} className="text-primary shrink-0" />
        <span className="text-sm font-semibold">{t('mfgControl.po.header')}</span>
        <span className="text-[10px] font-medium text-muted-foreground bg-muted/40 rounded-full px-2 py-0.5 shrink-0">{pos.length}</span>
        {needsAction > 0 && (
          <span className="text-[10px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5 shrink-0">
            {t('mfgControl.po.needAction', { count: needsAction })}
          </span>
        )}
        <span className="ml-auto text-[10px] text-muted-foreground hidden lg:flex items-center">
          {t('mfgControl.po.flowReleasePo')} <ArrowRight size={9} className="inline mx-0.5" /> {t('mfgControl.po.flowAutoGen')} <ArrowRight size={9} className="inline mx-0.5" /> {t('mfgControl.po.flowControlBelow')}
        </span>
      </button>
      {open && (
      <div className="flex gap-2.5 overflow-x-auto p-3">
        {pos.map(po => {
          const woCount = po.workOrders?.length ?? 0;
          const statusCls = PO_STATUS_CLS[po.status] ?? 'text-muted-foreground bg-muted/20 border-border/30';
          return (
            <div key={po.id} className="shrink-0 w-64 rounded-lg border border-border/40 bg-background/40 p-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-[11px] font-bold text-primary truncate">{po.orderNumber}</span>
                <span className={cn('text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0', statusCls)}>
                  {t('mfgControl.po.status.' + po.status, { defaultValue: po.status.replace('_', ' ') })}
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground truncate mb-0.5">{po.sku?.name ?? '—'}</div>
              <div className="text-[10px] text-muted-foreground mb-2">
                {po.targetQty} {po.unit ?? ''} · {t('mfgControl.po.woCount', { count: woCount })} · {t('mfgControl.po.due', { date: fmtDate(po.plannedEnd) })}
              </div>
              <div className="flex items-center gap-1.5">
                {po.status === 'PLANNED' && (
                  <Button
                    size="sm" className="h-6 px-2 text-[10px] gap-1 bg-blue-600 hover:bg-blue-700"
                    disabled={releaseMutation.isPending}
                    onClick={() => releaseMutation.mutate(po.id)}
                  >
                    <Play size={10} />{t('mfgControl.po.releasePo')}
                  </Button>
                )}
                {['RELEASED', 'IN_PROGRESS'].includes(po.status) && (
                  <Button
                    size="sm"
                    variant={woCount > 0 ? 'outline' : 'default'}
                    className="h-6 px-2 text-[10px] gap-1"
                    onClick={() => setAutoGenPO(po)}
                  >
                    <Zap size={10} />{woCount > 0 ? t('mfgControl.po.generateAgain') : t('mfgControl.po.autoGenerateWo')}
                  </Button>
                )}
                {woCount > 0 && (
                  <span className="text-[10px] text-emerald-400 flex items-center gap-0.5">
                    <CheckCircle2 size={10} />{t('mfgControl.po.generated', { count: woCount })}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
      )}

      {autoGenPO && (
        <AutoGenerateWODialog
          po={autoGenPO}
          open={!!autoGenPO}
          onClose={() => setAutoGenPO(null)}
          onDone={() => { setAutoGenPO(null); invalidateAll(); }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function ManufacturingControlView() {
  const { t } = useTranslation('modules');
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // ── Data fetching ──────────────────────────────────────────────────────────

  const { data, isLoading } = useQuery<WorkOrdersResponse>({
    queryKey: ['work-orders'],
    queryFn: () =>
      api.get('/production/work-orders', { params: { limit: 50 } }) as Promise<WorkOrdersResponse>,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const allOrders: WorkOrder[] = (data as any)?.data ?? [];

  // ── Mutations ──────────────────────────────────────────────────────────────

  const invalidate = () => qc.invalidateQueries({ queryKey: ['work-orders'] });

  const startMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/production/work-orders/${id}/start`),
    onSuccess: invalidate,
  });

  const holdMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/production/work-orders/${id}/hold`),
    onSuccess: invalidate,
  });

  const releaseMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/production/work-orders/${id}/release`),
    onSuccess: invalidate,
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/production/work-orders/${id}/complete`),
    onSuccess: invalidate,
  });

  const anyPending =
    startMutation.isPending ||
    holdMutation.isPending ||
    releaseMutation.isPending ||
    completeMutation.isPending;

  // ── Filtering ──────────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return allOrders.filter(wo => {
      const matchSearch =
        !q ||
        (wo.orderNumber ?? '').toLowerCase().includes(q) ||
        (wo.productName ?? '').toLowerCase().includes(q);
      const matchStatus =
        statusFilter === 'all' || wo.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [allOrders, search, statusFilter]);

  // ── Summary counts (from all orders, not filtered) ────────────────────────

  const inProgressCount = allOrders.filter(w => w.status === 'IN_PROGRESS').length;
  const queueCount = allOrders.filter(w =>
    w.status === 'PLANNED' || w.status === 'RELEASED',
  ).length;
  const onHoldCount = allOrders.filter(w => w.status === 'ON_HOLD').length;
  const completedTodayCount = allOrders.filter(isCompletedToday).length;

  // ── Kanban columns ────────────────────────────────────────────────────────

  const plannedReleased = filtered.filter(
    w => w.status === 'PLANNED' || w.status === 'RELEASED',
  );
  const inProgress = filtered.filter(w => w.status === 'IN_PROGRESS');
  const onHold = filtered.filter(w => w.status === 'ON_HOLD');

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col min-h-full gap-4 p-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <SlidersHorizontal size={20} className="text-primary" />
          <div>
            <h1 className="text-xl font-bold leading-tight">{t('mfgControl.title')}</h1>
            <p className="text-xs text-muted-foreground">{t('mfgControl.subtitle')}</p>
          </div>
          {/* Live badge */}
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-500/10 border border-green-500/30">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-[11px] font-semibold text-green-400">{t('mfgControl.live')}</span>
          </div>
        </div>

        {/* Search + filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search
              size={13}
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              placeholder={t('mfgControl.searchPlaceholder')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-7 w-44 text-xs"
            />
          </div>
          <SelectMenu
            value={statusFilter}
            onValueChange={setStatusFilter}
            menuLabel={t('mfgControl.statusMenuLabel')}
            options={STATUS_FILTER_OPTIONS.map(o => ({ value: o.value, label: t(o.labelKey) }))}
          />
        </div>
      </div>

      {/* ── PO pipeline: release & auto-generate, the WOs land in the kanban ── */}
      <POPipeline />

      {/* ── Summary strip ── */}
      <div className="flex gap-3 flex-wrap">
        <StatBox
          label={t('mfgControl.stat.inProgress')}
          value={inProgressCount}
          colorCls="text-green-400"
          icon={<Play size={16} />}
        />
        <StatBox
          label={t('mfgControl.stat.plannedReleased')}
          value={queueCount}
          colorCls="text-blue-400"
          icon={<Clock size={16} />}
        />
        <StatBox
          label={t('mfgControl.stat.onHold')}
          value={onHoldCount}
          colorCls="text-yellow-400"
          icon={<AlertTriangle size={16} />}
        />
        <StatBox
          label={t('mfgControl.stat.completedToday')}
          value={completedTodayCount}
          colorCls="text-slate-400"
          icon={<CheckCircle2 size={16} />}
        />
      </div>

      {/* ── Loading shimmer ── */}
      {isLoading && (
        <div className="grid grid-cols-3 gap-4 flex-1">
          {[1, 2, 3].map(i => (
            <div key={i} className="space-y-3">
              <div className="shimmer h-10 rounded-xl" />
              {[1, 2, 3].map(j => (
                <div key={j} className="shimmer h-28 rounded-xl" />
              ))}
            </div>
          ))}
        </div>
      )}

      {/* ── Kanban Board ── */}
      {!isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 min-h-[480px]">
          <KanbanColumn
            title={t('mfgControl.stat.plannedReleased')}
            count={plannedReleased.length}
            headerCls="border-blue-500/20 bg-blue-500/5"
            accentCls="bg-blue-500/20 text-blue-300"
            orders={plannedReleased}
            onStart={id => startMutation.mutate(id)}
            isPending={anyPending}
          />
          <KanbanColumn
            title={t('mfgControl.stat.inProgress')}
            count={inProgress.length}
            headerCls="border-green-500/30 bg-green-500/10"
            accentCls="bg-green-500/20 text-green-300"
            orders={inProgress}
            onHold={id => holdMutation.mutate(id)}
            onComplete={id => completeMutation.mutate(id)}
            isPending={anyPending}
            highlighted
          />
          <KanbanColumn
            title={t('mfgControl.stat.onHold')}
            count={onHold.length}
            headerCls="border-amber-500/20 bg-amber-500/5"
            accentCls="bg-amber-500/20 text-amber-300"
            orders={onHold}
            onRelease={id => releaseMutation.mutate(id)}
            isPending={anyPending}
          />
        </div>
      )}

      {/* ── Completed section ── */}
      {!isLoading && <CompletedTable orders={allOrders} />}
    </div>
  );
}
