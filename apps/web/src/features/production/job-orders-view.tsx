'use client';
import { useTranslation } from 'react-i18next';

import React, { useState, useMemo, useEffect } from 'react';
import {
  Layers, Search, Play, Pause, CheckSquare, Circle,
  Clock, Cpu, ChevronRight, RefreshCw,
  AlertCircle, XCircle, Loader2, ClipboardList,
  Filter, ChevronLeft, GitMerge, ArrowDownCircle,
  GitBranch, Shuffle, Check, X, Package, Box, Boxes,
  User, BarChart2, Monitor, AlertTriangle,
  MoreVertical, Ban, Workflow, List, UserPlus, Trash2, Archive,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { api } from '@/services/api.client';
import { formatDate, formatDateTime } from '@/lib/utils';
import { useSortedData } from '@/lib/use-sorted-data';
import { TablePagination } from '@/components/ui/table-pagination';

// ─────────────────────────────────────────────────────────────
// Types & constants
// ─────────────────────────────────────────────────────────────

type JOStatus = 'SCHEDULED' | 'READY' | 'EXECUTING' | 'PAUSED' | 'COMPLETE' | 'CANCELLED';
type DepType  = 'FINISH_TO_START' | 'START_TO_START' | 'START_TO_FINISH' | 'FINISH_TO_FINISH' | null;

interface Operator { id: string; name: string; nameAr?: string; role?: string }

interface JobOrder {
  id: string;
  sequenceOrder: number;
  operationName: string;
  status: JOStatus;
  depType: DepType;
  plannedStart?: string;
  plannedEnd?: string;
  actualStart?: string;
  actualEnd?: string;
  plannedQtyIn?: number;
  plannedQtyOut?: number;
  outputUnit?: string;
  actualQtyGood: number;
  actualQtyRejected: number;
  scrapReason?: string;
  operatorId?: string;
  operator?: Operator;
  notes?: string;
  workOrder?: {
    id: string;
    orderNumber: string;
    sku?: { name: string; code: string };
    productionOrder?: { orderNumber: string };
  };
  machine?: { name: string; code: string };
  workCenter?: { name: string; code: string };
  predecessor?: {
    id: string;
    operationName: string;
    status: JOStatus;
    actualStart?: string;
  };
  joQuality?: number;
  joPerformance?: number;
  joAvailability?: number;
  joOEE?: number;
}

const JO_STATUS: Record<JOStatus, { labelKey: string; color: string; dot: string }> = {
  SCHEDULED: { labelKey: 'jo.status.SCHEDULED', color: 'text-slate-400 bg-slate-400/10 border-slate-400/30', dot: 'bg-slate-400' },
  READY:     { labelKey: 'jo.status.READY',     color: 'text-blue-400  bg-blue-400/10  border-blue-400/30',  dot: 'bg-blue-400' },
  EXECUTING: { labelKey: 'jo.status.EXECUTING', color: 'text-green-400 bg-green-400/10 border-green-400/30', dot: 'bg-green-400' },
  PAUSED:    { labelKey: 'jo.status.PAUSED',    color: 'text-amber-400 bg-amber-400/10 border-amber-400/30', dot: 'bg-amber-400' },
  COMPLETE:  { labelKey: 'jo.status.COMPLETE',  color: 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30', dot: 'bg-emerald-400' },
  CANCELLED: { labelKey: 'jo.status.CANCELLED', color: 'text-red-400   bg-red-400/10   border-red-400/30',   dot: 'bg-red-400' },
};

const DEP_CONFIG: Record<string, { short: string; labelKey: string; color: string; icon: React.ReactNode; descKey: string }> = {
  FINISH_TO_START:  { short: 'FS', labelKey: 'jo.dep.FINISH_TO_START.label',  color: 'text-slate-400 bg-slate-400/10 border-slate-400/20', icon: <ArrowDownCircle className="w-2.5 h-2.5" />, descKey: 'jo.dep.FINISH_TO_START.desc' },
  START_TO_START:   { short: 'SS', labelKey: 'jo.dep.START_TO_START.label',   color: 'text-cyan-400  bg-cyan-400/10  border-cyan-400/20',   icon: <GitBranch     className="w-2.5 h-2.5" />, descKey: 'jo.dep.START_TO_START.desc' },
  START_TO_FINISH:  { short: 'SF', labelKey: 'jo.dep.START_TO_FINISH.label',  color: 'text-orange-400 bg-orange-400/10 border-orange-400/20', icon: <Shuffle      className="w-2.5 h-2.5" />, descKey: 'jo.dep.START_TO_FINISH.desc' },
  FINISH_TO_FINISH: { short: 'FF', labelKey: 'jo.dep.FINISH_TO_FINISH.label', color: 'text-purple-400 bg-purple-400/10 border-purple-400/20', icon: <GitMerge    className="w-2.5 h-2.5" />, descKey: 'jo.dep.FINISH_TO_FINISH.desc' },
};

const VALID_NEXT: Record<JOStatus, JOStatus[]> = {
  SCHEDULED: ['CANCELLED'],
  READY:     ['EXECUTING', 'CANCELLED'],
  EXECUTING: ['PAUSED', 'COMPLETE', 'CANCELLED'],
  PAUSED:    ['EXECUTING', 'CANCELLED'],
  COMPLETE:  [],
  CANCELLED: [],
};

const PAGE_SIZE = 6; // 3 columns × 2 rows

const UNIT_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  PIECE:  { color: 'text-sky-400  bg-sky-400/10  border-sky-400/20',     icon: <Package className="w-2.5 h-2.5" />, label: 'PCS'    },
  CARTON: { color: 'text-amber-400 bg-amber-400/10 border-amber-400/20', icon: <Box     className="w-2.5 h-2.5" />, label: 'CTN'    },
  PALLET: { color: 'text-purple-400 bg-purple-400/10 border-purple-400/20', icon: <Boxes  className="w-2.5 h-2.5" />, label: 'PLT'  },
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: JOStatus }) {
  const { t } = useTranslation(['production', 'common']);
  const c = JO_STATUS[status];
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${c.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {t(c.labelKey)}
    </span>
  );
}

function DepBadge({ type }: { type: DepType }) {
  const { t } = useTranslation(['production', 'common']);
  if (!type) return null;
  const d = DEP_CONFIG[type];
  if (!d) return null;
  return (
    <span
      title={`${t(d.labelKey)}: ${t(d.descKey)}`}
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold border tracking-wide ${d.color}`}
    >
      {d.icon}{d.short}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────
// PDM (Precedence Diagram Method) — job orders as nodes, typed
// dependency arrows (FS advances a column, SS/FF share a column),
// status-coloured borders, qty flow + OEE on each node.
// ─────────────────────────────────────────────────────────────

const PDM_BOX_W = 158;
const PDM_BOX_H = 72;
const PDM_COL_GAP = 56;
const PDM_ROW_GAP = 18;
const PDM_PAD = 12;

const PDM_STATUS_STROKE: Record<JOStatus, string> = {
  SCHEDULED: '#475569',
  READY:     '#3b82f6',
  EXECUTING: '#22c55e',
  PAUSED:    '#f59e0b',
  COMPLETE:  '#10b981',
  CANCELLED: '#ef4444',
};

const PDM_DEP_STROKE: Record<string, string> = {
  FINISH_TO_START:  '#94a3b8',
  START_TO_START:   '#22d3ee',
  START_TO_FINISH:  '#fb923c',
  FINISH_TO_FINISH: '#c084fc',
};

function JoPdmDiagram({ jobs, onStart, onComplete, pending }: {
  jobs: JobOrder[];
  onStart: (id: string) => void;
  onComplete: (jo: JobOrder) => void;
  pending: boolean;
}) {
  const { t } = useTranslation(['production', 'common']);
  const sorted = [...jobs].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const byId = new Map(sorted.map(j => [j.id, j]));

  // Column layout: FS advances, SS/SF/FF share the predecessor's column
  const cols = new Map<string, number>();
  for (const jo of sorted) {
    const pred = jo.predecessor ? byId.get(jo.predecessor.id) : undefined;
    if (!pred) { cols.set(jo.id, 0); continue; }
    const predCol = cols.get(pred.id) ?? 0;
    cols.set(jo.id, predCol + (jo.depType === 'FINISH_TO_START' || jo.depType == null ? 1 : 0));
  }
  const colGroups = new Map<number, JobOrder[]>();
  for (const jo of sorted) {
    const c = cols.get(jo.id) ?? 0;
    if (!colGroups.has(c)) colGroups.set(c, []);
    colGroups.get(c)!.push(jo);
  }
  const positions = new Map<string, { x: number; y: number }>();
  const maxCol = Math.max(0, ...cols.values());
  let maxRow = 0;
  for (let c = 0; c <= maxCol; c++) {
    (colGroups.get(c) ?? []).forEach((jo, row) => {
      positions.set(jo.id, { x: PDM_PAD + c * (PDM_BOX_W + PDM_COL_GAP), y: PDM_PAD + row * (PDM_BOX_H + PDM_ROW_GAP) });
      maxRow = Math.max(maxRow, row);
    });
  }
  const svgW = PDM_PAD * 2 + (maxCol + 1) * PDM_BOX_W + maxCol * PDM_COL_GAP;
  const svgH = PDM_PAD * 2 + (maxRow + 1) * PDM_BOX_H + maxRow * PDM_ROW_GAP;

  return (
    <div className="overflow-x-auto px-2 py-3">
      <svg width={Math.max(svgW, 280)} height={svgH} className="block">
        <defs>
          {Object.entries(PDM_DEP_STROKE).map(([k, color]) => (
            <marker key={k} id={`jo-arrow-${k}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
              <path d="M0,0 L0,6 L8,3 z" fill={color} />
            </marker>
          ))}
        </defs>

        {/* Dependency arrows */}
        {sorted.map(jo => {
          if (!jo.predecessor) return null;
          const from = positions.get(jo.predecessor.id);
          const to = positions.get(jo.id);
          if (!from || !to) return null;
          const dep = jo.depType ?? 'FINISH_TO_START';
          const color = PDM_DEP_STROKE[dep] ?? '#94a3b8';
          const fs = dep === 'FINISH_TO_START';
          const fx = fs ? from.x + PDM_BOX_W : from.x + PDM_BOX_W / 2;
          const fy = fs ? from.y + PDM_BOX_H / 2 : from.y + PDM_BOX_H;
          const tx = fs ? to.x : to.x + PDM_BOX_W / 2;
          const ty = fs ? to.y + PDM_BOX_H / 2 : to.y;
          const cx = (fx + tx) / 2;
          const d = fs
            ? `M ${fx} ${fy} C ${cx} ${fy}, ${cx} ${ty}, ${tx} ${ty}`
            : `M ${fx} ${fy} C ${fx} ${fy + 16}, ${tx} ${ty - 16}, ${tx} ${ty}`;
          const short = DEP_CONFIG[dep]?.short ?? 'FS';
          return (
            <g key={`dep-${jo.id}`}>
              <path d={d} fill="none" stroke={color} strokeWidth="1.5"
                strokeDasharray={dep === 'START_TO_START' || dep === 'FINISH_TO_FINISH' ? '5 3' : undefined}
                markerEnd={`url(#jo-arrow-${dep})`} opacity="0.9" />
              <rect x={(fx + tx) / 2 - 11} y={(fy + ty) / 2 - 8} width="22" height="14" rx="3" fill="#0f1117" opacity="0.9" />
              <text x={(fx + tx) / 2} y={(fy + ty) / 2 + 3} textAnchor="middle" fontSize="9" fontWeight="700" fill={color} fontFamily="monospace">
                {short}
              </text>
            </g>
          );
        })}

        {/* Nodes */}
        {sorted.map(jo => {
          const pos = positions.get(jo.id);
          if (!pos) return null;
          const stroke = PDM_STATUS_STROKE[jo.status] ?? '#475569';
          const executing = jo.status === 'EXECUTING';
          const pct = (jo.plannedQtyOut ?? 0) > 0 ? Math.min(1, jo.actualQtyGood / (jo.plannedQtyOut ?? 1)) : 0;
          return (
            <g key={jo.id}>
              <rect x={pos.x + 2} y={pos.y + 2} width={PDM_BOX_W} height={PDM_BOX_H} rx="8" fill="rgba(0,0,0,0.35)" />
              <rect x={pos.x} y={pos.y} width={PDM_BOX_W} height={PDM_BOX_H} rx="8"
                fill={executing ? 'rgba(34,197,94,0.08)' : '#171a28'} stroke={stroke} strokeWidth="1.5" />
              {/* status dot + seq + operation */}
              <circle cx={pos.x + 13} cy={pos.y + 14} r="4" fill={stroke}>
                {executing && <animate attributeName="opacity" values="1;0.3;1" dur="1.6s" repeatCount="indefinite" />}
              </circle>
              <text x={pos.x + 23} y={pos.y + 18} fontSize="10.5" fontWeight="700" fill="#e2e8f0">
                {jo.sequenceOrder}. {jo.operationName.length > 14 ? jo.operationName.slice(0, 13) + '…' : jo.operationName}
              </text>
              {/* machine */}
              <text x={pos.x + 10} y={pos.y + 33} fontSize="9" fill="#94a3b8">
                {(jo.machine?.name ?? jo.workCenter?.name ?? '—').slice(0, 24)}
              </text>
              {/* qty + unit */}
              <text x={pos.x + 10} y={pos.y + 47} fontSize="9" fill="#64748b" fontFamily="monospace">
                {jo.actualQtyGood}/{jo.plannedQtyOut ?? '—'} {jo.outputUnit ?? ''}
                {jo.joOEE != null ? `  OEE ${Math.round(jo.joOEE)}%` : ''}
              </text>
              {/* progress bar */}
              <rect x={pos.x + 10} y={pos.y + 56} width={PDM_BOX_W - 50} height="4" rx="2" fill="#1e2235" />
              <rect x={pos.x + 10} y={pos.y + 56} width={(PDM_BOX_W - 50) * pct} height="4" rx="2"
                fill={jo.status === 'COMPLETE' ? '#10b981' : '#4c7571'} />
              {/* quick action on node */}
              {['READY', 'PAUSED'].includes(jo.status) && (
                <g className="cursor-pointer" opacity={pending ? 0.4 : 1} onClick={() => !pending && onStart(jo.id)}>
                  <circle cx={pos.x + PDM_BOX_W - 18} cy={pos.y + PDM_BOX_H - 16} r="10" fill="rgba(34,197,94,0.15)" stroke="#22c55e" strokeWidth="1" />
                  <path d={`M ${pos.x + PDM_BOX_W - 21.5} ${pos.y + PDM_BOX_H - 21} L ${pos.x + PDM_BOX_W - 21.5} ${pos.y + PDM_BOX_H - 11} L ${pos.x + PDM_BOX_W - 12.5} ${pos.y + PDM_BOX_H - 16} Z`} fill="#22c55e" />
                  <title>{t('jo.startStep')}</title>
                </g>
              )}
              {jo.status === 'EXECUTING' && (
                <g className="cursor-pointer" opacity={pending ? 0.4 : 1} onClick={() => !pending && onComplete(jo)}>
                  <circle cx={pos.x + PDM_BOX_W - 18} cy={pos.y + PDM_BOX_H - 16} r="10" fill="rgba(16,185,129,0.15)" stroke="#10b981" strokeWidth="1" />
                  <path d={`M ${pos.x + PDM_BOX_W - 23} ${pos.y + PDM_BOX_H - 16} l 3.5 3.5 l 6 -7`} fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <title>{t('jo.completeStepNode')}</title>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Single WO card (compact)
// ─────────────────────────────────────────────────────────────

function UnitBadge({ unit }: { unit: string | undefined }) {
  if (!unit) return null;
  const cfg = UNIT_CONFIG[unit];
  if (!cfg) return <span className="text-[9px] text-muted-foreground">{unit}</span>;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded border text-[9px] font-bold tracking-wide ${cfg.color}`}>
      {cfg.icon}{cfg.label}
    </span>
  );
}

function WOCard({
  wo, jobs, onTransition, onCount, onAssignOperator, users, pending, mode,
}: {
  wo: JobOrder['workOrder'];
  jobs: JobOrder[];
  onTransition: (id: string, status: JOStatus, qty?: number) => void;
  onCount: (id: string, good: number, scrap: number, reason: string, category?: string) => void;
  onAssignOperator: (id: string, operatorId: string | null) => void;
  users: Operator[];
  pending: boolean;
  mode: 'list' | 'pdm';
}) {
  const { t } = useTranslation(['production', 'common']);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [completingId,   setCompletingId]   = useState<string | null>(null);
  const [completeQty,    setCompleteQty]    = useState<string>('');
  const [loggingId,      setLoggingId]      = useState<string | null>(null);
  const [logGood,        setLogGood]        = useState<string>('');
  const [logScrap,       setLogScrap]       = useState<string>('');
  const [logReason,      setLogReason]      = useState<string>('');
  const [logCategory,    setLogCategory]    = useState<string>('OTHER');
  const [assigningOpId,  setAssigningOpId]  = useState<string | null>(null);

  // WO-level delete / archive from the dispatch card. Delete auto-routes on the
  // backend: a not-started WO is deleted (its job orders go with it), a started
  // one is archived (history preserved). Archive always preserves.
  const refreshLists = () => {
    qc.invalidateQueries({ queryKey: ['job-orders'] });
    qc.invalidateQueries({ queryKey: ['production', 'work-orders'] });
    qc.invalidateQueries({ queryKey: ['production-orders'] });
  };
  const deleteWO = useMutation({
    mutationFn: () => api.delete(`/production/work-orders/${wo!.id}`),
    onSuccess: (res: any) => {
      refreshLists();
      toast({ title: res?.action === 'archived' ? t('joWoActions.archivedToast', { defaultValue: 'Work order archived (had started)' }) : t('joWoActions.deletedToast', { defaultValue: 'Work order deleted' }), variant: 'success' });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: t('joWoActions.failed', { defaultValue: 'Action failed' }), description: e?.response?.data?.message }),
  });
  const archiveWO = useMutation({
    mutationFn: () => api.patch(`/archive/work-orders/${wo!.id}/archive`, {}),
    onSuccess: () => { refreshLists(); toast({ title: t('joWoActions.archivedToast', { defaultValue: 'Work order archived' }), variant: 'success' }); },
    onError: (e: any) => toast({ variant: 'destructive', title: t('joWoActions.failed', { defaultValue: 'Action failed' }), description: e?.response?.data?.message }),
  });

  const sorted   = [...jobs].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
  const done     = jobs.filter((j) => j.status === 'COMPLETE').length;
  const running  = jobs.filter((j) => j.status === 'EXECUTING').length;
  const progress = jobs.length > 0 ? Math.round((done / jobs.length) * 100) : 0;

  const openLog = (jo: JobOrder) => {
    setLoggingId(jo.id);
    setLogGood(String(jo.actualQtyGood || ''));
    setLogScrap(String(jo.actualQtyRejected || ''));
    setLogReason(jo.scrapReason || '');
    setCompletingId(null);
  };

  return (
    <div className="glass-card rounded-2xl overflow-hidden flex flex-col">
      {/* Card header */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <ClipboardList className="w-3.5 h-3.5 text-brand-400 shrink-0" />
            <span className="font-semibold text-sm truncate">{wo?.orderNumber ?? '—'}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {running > 0 && (
              <span className="flex items-center gap-0.5 text-[10px] text-green-400">
                <Play className="w-2.5 h-2.5 fill-current" />{running}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground">{done}/{jobs.length}</span>
            <div className="w-12 h-1 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[10px] text-muted-foreground w-6 text-right">{progress}%</span>
            {/* WO-level actions: archive / delete (delete auto-archives a started WO) */}
            {wo?.id && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="p-1 rounded hover:bg-muted/40 text-muted-foreground" aria-label={t('joWoActions.menu', { defaultValue: 'Work order actions' })}>
                  <MoreVertical className="w-3.5 h-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuLabel className="text-[10px] font-mono text-muted-foreground">{wo?.orderNumber}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={archiveWO.isPending} onClick={() => archiveWO.mutate()}>
                  <Archive className="w-3.5 h-3.5 mr-2" />{t('joWoActions.archive', { defaultValue: 'Archive' })}
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-400 focus:text-red-400"
                  disabled={deleteWO.isPending}
                  onClick={() => { if (window.confirm(t('joWoActions.confirmDelete', { defaultValue: 'Delete this work order? A not-started WO and its job orders are removed; a started WO is archived instead.' }))) deleteWO.mutate(); }}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-2" />{t('joWoActions.delete', { defaultValue: 'Delete' })}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </div>
        </div>
        {wo?.sku && (
          <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{wo.sku.name}</p>
        )}
        {wo?.productionOrder && (
          <p className="text-[10px] text-muted-foreground flex items-center gap-0.5">
            <ChevronRight className="w-2.5 h-2.5" />{wo.productionOrder.orderNumber}
          </p>
        )}
      </div>

      {/* PDM flow mode — precedence diagram with typed dependency arrows */}
      {mode === 'pdm' ? (
        <JoPdmDiagram
          jobs={jobs}
          pending={pending}
          onStart={(id) => onTransition(id, 'EXECUTING')}
          onComplete={(jo) => onTransition(jo.id, 'COMPLETE', jo.plannedQtyOut ?? 0)}
        />
      ) : (
      <div className="divide-y divide-border/20 flex-1">
        {sorted.map((jo, idx) => {
          const next      = VALID_NEXT[jo.status] ?? [];
          const isBlocked = jo.status === 'SCHEDULED';
          const isActive  = jo.status === 'EXECUTING';
          const canLog    = ['EXECUTING', 'PAUSED'].includes(jo.status);

          return (
            <div key={jo.id}>
              {/* Main row */}
              <div
                className={`px-4 py-2.5 flex items-center gap-2 transition-colors
                  ${isActive ? 'bg-green-500/5' : ''}
                  ${isBlocked ? 'opacity-60' : ''}
                `}
              >
                {/* Sequence + dep connector */}
                <div className="flex flex-col items-center w-8 shrink-0">
                  {idx > 0 && <DepBadge type={jo.depType} />}
                  <span className="text-[10px] font-mono text-brand-400 mt-0.5">{jo.sequenceOrder}</span>
                </div>

                {/* Operation + machine + qty + operator */}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{jo.operationName}</p>
                  <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                    {jo.machine ? (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Cpu className="w-2.5 h-2.5" />{jo.machine.name}
                      </span>
                    ) : jo.workCenter ? (
                      <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Layers className="w-2.5 h-2.5" />{jo.workCenter.name}
                      </span>
                    ) : null}
                    {isBlocked && jo.predecessor && (
                      <span className="text-[10px] text-amber-400/70 ml-1">
                        ⏳ {jo.predecessor.operationName}
                      </span>
                    )}
                  </div>

                  {/* Qty progress */}
                  {(jo.plannedQtyOut ?? 0) > 0 && (
                    <div className="flex items-center gap-1.5 mt-1">
                      <div className="w-14 h-0.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${jo.status === 'COMPLETE' ? 'bg-emerald-500' : 'bg-brand-500'}`}
                          style={{ width: `${Math.min(100, (jo.actualQtyGood / (jo.plannedQtyOut ?? 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] tabular-nums text-muted-foreground whitespace-nowrap">
                        {jo.actualQtyGood}
                        {jo.actualQtyRejected > 0 && (
                          <span className="text-red-400/70"> +{jo.actualQtyRejected}✗</span>
                        )}
                        {' / '}{jo.plannedQtyOut}
                      </span>
                      <UnitBadge unit={jo.outputUnit} />
                      {jo.joOEE != null && (
                        <span className={`text-[9px] font-bold px-1 py-0.5 rounded border tabular-nums ${
                          jo.joOEE >= 85
                            ? 'text-green-400 bg-green-400/10 border-green-400/30'
                            : jo.joOEE >= 60
                            ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30'
                            : 'text-red-400 bg-red-400/10 border-red-400/30'
                        }`}>
                          OEE {Math.round(jo.joOEE)}%
                        </span>
                      )}
                    </div>
                  )}

                  {/* Operator chip */}
                  <div className="flex items-center gap-1 mt-0.5">
                    <User className="w-2.5 h-2.5 text-muted-foreground/50 shrink-0" />
                    {assigningOpId === jo.id ? (
                      <select
                        autoFocus
                        defaultValue={jo.operatorId ?? ''}
                        onChange={(e) => {
                          onAssignOperator(jo.id, e.target.value || null);
                          setAssigningOpId(null);
                        }}
                        onBlur={() => setAssigningOpId(null)}
                        className="text-[10px] bg-background border border-brand-400/40 rounded px-1 py-0.5 focus:outline-none min-w-[150px] max-w-[220px]"
                      >
                        <option value="">{t('jo.unassign')}</option>
                        {users.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}{u.role ? ` · ${u.role.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}` : ''}
                          </option>
                        ))}
                      </select>
                    ) : jo.operator ? (
                      <button
                        onClick={() => setAssigningOpId(jo.id)}
                        className="text-[10px] text-muted-foreground hover:text-brand-400 transition-colors truncate max-w-[120px]"
                        title={t('jo.changeOperatorTitle')}
                      >
                        {jo.operator.name}
                      </button>
                    ) : (
                      <button
                        onClick={() => setAssigningOpId(jo.id)}
                        className="text-[10px] text-muted-foreground/40 hover:text-brand-400 transition-colors italic"
                      >
                        {t('jo.assignOperator')}
                      </button>
                    )}
                  </div>
                </div>

                {/* Status */}
                <StatusBadge status={jo.status} />

                {/* Action buttons */}
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Log count button */}
                  {canLog && (
                    <button
                      onClick={() => loggingId === jo.id ? setLoggingId(null) : openLog(jo)}
                      title={t('jo.logCountTitle')}
                      className={`w-5 h-5 rounded flex items-center justify-center transition-colors
                        ${loggingId === jo.id ? 'text-brand-400 bg-brand-400/15' : 'text-muted-foreground hover:text-brand-400 hover:bg-brand-400/10'}`}
                    >
                      <BarChart2 className="w-3 h-3" />
                    </button>
                  )}
                  {next.includes('EXECUTING') && (
                    <button
                      disabled={pending}
                      onClick={() => onTransition(jo.id, 'EXECUTING')}
                      title={t('jo.startTitle')}
                      className="w-5 h-5 rounded flex items-center justify-center text-green-400 hover:bg-green-400/15 disabled:opacity-40 transition-colors"
                    >
                      <Play className="w-3 h-3 fill-current" />
                    </button>
                  )}
                  {next.includes('PAUSED') && (
                    <button
                      disabled={pending}
                      onClick={() => onTransition(jo.id, 'PAUSED')}
                      title={t('jo.pauseTitle')}
                      className="w-5 h-5 rounded flex items-center justify-center text-amber-400 hover:bg-amber-400/15 disabled:opacity-40 transition-colors"
                    >
                      <Pause className="w-3 h-3" />
                    </button>
                  )}
                  {/* Complete: inline qty input → confirm */}
                  {next.includes('COMPLETE') && completingId === jo.id ? (
                    <>
                      <input
                        type="number"
                        autoFocus
                        min={0}
                        value={completeQty}
                        placeholder={String(Math.round(jo.plannedQtyOut ?? 0) || '')}
                        onChange={(e) => setCompleteQty(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const qty = parseFloat(completeQty) || jo.plannedQtyOut || 0;
                            onTransition(jo.id, 'COMPLETE', qty);
                            setCompletingId(null); setCompleteQty('');
                          }
                          if (e.key === 'Escape') { setCompletingId(null); setCompleteQty(''); }
                        }}
                        className="w-14 h-5 text-[10px] bg-background/60 border border-border rounded px-1 text-center focus:outline-none focus:border-brand-400"
                      />
                      <button
                        disabled={pending}
                        onClick={() => {
                          const qty = parseFloat(completeQty) || jo.plannedQtyOut || 0;
                          onTransition(jo.id, 'COMPLETE', qty);
                          setCompletingId(null); setCompleteQty('');
                        }}
                        className="w-5 h-5 rounded flex items-center justify-center text-emerald-400 hover:bg-emerald-400/15 disabled:opacity-40"
                      >
                        <Check className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => { setCompletingId(null); setCompleteQty(''); }}
                        className="w-5 h-5 rounded flex items-center justify-center text-slate-400 hover:bg-slate-400/15"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  ) : next.includes('COMPLETE') ? (
                    <button
                      disabled={pending}
                      onClick={() => {
                        setCompletingId(jo.id);
                        setCompleteQty(String(Math.round(jo.plannedQtyOut ?? jo.plannedQtyIn ?? 0) || ''));
                        setLoggingId(null);
                      }}
                      title={t('jo.completeTitle', { unit: jo.outputUnit ?? '' })}
                      className="w-5 h-5 rounded flex items-center justify-center text-emerald-400 hover:bg-emerald-400/15 disabled:opacity-40 transition-colors"
                    >
                      <CheckSquare className="w-3 h-3" />
                    </button>
                  ) : null}

                  {/* Options menu — every action in one place */}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="w-5 h-5 rounded flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors">
                        <MoreVertical className="w-3 h-3" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel className="text-[10px] font-mono text-muted-foreground">
                        {jo.sequenceOrder}. {jo.operationName} · {t(JO_STATUS[jo.status].labelKey)}
                      </DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {next.includes('EXECUTING') && (
                        <DropdownMenuItem disabled={pending} onClick={() => onTransition(jo.id, 'EXECUTING')}>
                          <Play size={13} className="mr-2 text-green-400" />{jo.status === 'PAUSED' ? t('jo.resumeStep') : t('jo.startStepMenu')} {t('jo.stepSuffix')}
                        </DropdownMenuItem>
                      )}
                      {next.includes('PAUSED') && (
                        <DropdownMenuItem disabled={pending} onClick={() => onTransition(jo.id, 'PAUSED')}>
                          <Pause size={13} className="mr-2 text-amber-400" />{t('jo.pauseStep')}
                        </DropdownMenuItem>
                      )}
                      {next.includes('COMPLETE') && (
                        <DropdownMenuItem
                          disabled={pending}
                          onClick={() => {
                            setCompletingId(jo.id);
                            setCompleteQty(String(Math.round(jo.plannedQtyOut ?? jo.plannedQtyIn ?? 0) || ''));
                            setLoggingId(null);
                          }}
                        >
                          <CheckSquare size={13} className="mr-2 text-emerald-400" />{t('jo.completeMenu')}
                        </DropdownMenuItem>
                      )}
                      {canLog && (
                        <DropdownMenuItem onClick={() => openLog(jo)}>
                          <BarChart2 size={13} className="mr-2 text-brand-400" />{t('jo.logMenu')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setAssigningOpId(jo.id)}>
                        <UserPlus size={13} className="mr-2 text-sky-400" />{jo.operator ? t('jo.changeOperator') : t('jo.assignOperatorMenu')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => window.open('/shop-floor', '_blank')}>
                        <Monitor size={13} className="mr-2 text-muted-foreground" />{t('jo.openShopFloor')}
                      </DropdownMenuItem>
                      {jo.actualQtyRejected > 0 && (
                        <DropdownMenuItem onClick={() => window.open('/production/scrap-log', '_blank')}>
                          <AlertTriangle size={13} className="mr-2 text-red-400" />{t('jo.viewScrapLog')}
                        </DropdownMenuItem>
                      )}
                      {next.includes('CANCELLED') && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            disabled={pending}
                            className="text-destructive focus:text-destructive"
                            onClick={() => onTransition(jo.id, 'CANCELLED')}
                          >
                            <Ban size={13} className="mr-2" />{t('jo.cancelStep')}
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              {/* Inline count log form */}
              {loggingId === jo.id && (
                <div className="px-4 py-3 bg-brand-500/5 border-t border-brand-400/20 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-green-400 font-medium flex items-center gap-0.5">
                        <Check className="w-2.5 h-2.5" />{t('jo.goodCount')}
                      </label>
                      <input
                        type="number" min={0}
                        value={logGood}
                        onChange={(e) => setLogGood(e.target.value)}
                        className="w-full h-7 text-xs bg-background/60 border border-green-500/30 rounded px-2 focus:outline-none focus:border-green-400 text-center tabular-nums"
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <label className="text-[10px] text-red-400 font-medium flex items-center gap-0.5">
                        <X className="w-2.5 h-2.5" />{t('jo.scrapCount')}
                      </label>
                      <input
                        type="number" min={0}
                        value={logScrap}
                        onChange={(e) => setLogScrap(e.target.value)}
                        className="w-full h-7 text-xs bg-background/60 border border-red-500/30 rounded px-2 focus:outline-none focus:border-red-400 text-center tabular-nums"
                      />
                    </div>
                  </div>
                  {parseFloat(logScrap) > 0 && (
                    <div className="space-y-1.5">
                      <select
                        value={logCategory}
                        onChange={(e) => setLogCategory(e.target.value)}
                        className="w-full h-7 text-xs bg-background/60 border border-border rounded px-2 focus:outline-none focus:border-red-400 text-muted-foreground"
                      >
                        {['QUALITY','SETUP','DAMAGE','OVERRUN','MATERIAL','MACHINE','OPERATOR','OTHER'].map(c => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                      <input
                        type="text"
                        placeholder={t('jo.scrapReason')}
                        value={logReason}
                        onChange={(e) => setLogReason(e.target.value)}
                        className="w-full h-7 text-xs bg-background/60 border border-border rounded px-2 focus:outline-none focus:border-brand-400 placeholder:text-muted-foreground/40"
                      />
                    </div>
                  )}
                  <div className="flex gap-1.5">
                    <button
                      disabled={pending}
                      onClick={() => {
                        onCount(jo.id, parseFloat(logGood) || 0, parseFloat(logScrap) || 0, logReason, logCategory);
                        setLoggingId(null);
                      }}
                      className="flex-1 h-7 text-xs font-medium rounded bg-brand-500/20 hover:bg-brand-500/30 border border-brand-400/30 text-brand-400 flex items-center justify-center gap-1 disabled:opacity-40 transition-colors"
                    >
                      <Check className="w-3 h-3" />{t('jo.save')}
                    </button>
                    <button
                      onClick={() => setLoggingId(null)}
                      className="h-7 px-3 text-xs text-muted-foreground hover:text-foreground rounded border border-border transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Pagination
// ─────────────────────────────────────────────────────────────

function Pagination({
  page, total, onChange,
}: { page: number; total: number; onChange: (p: number) => void }) {
  if (total <= 1) return null;

  const pages = Array.from({ length: total }, (_, i) => i + 1);
  const visible = pages.filter((p) => p === 1 || p === total || Math.abs(p - page) <= 1);

  let prev: number | null = null;
  const items: (number | '…')[] = [];
  for (const p of visible) {
    if (prev !== null && p - prev > 1) items.push('…');
    items.push(p);
    prev = p;
  }

  return (
    <div className="flex items-center justify-center gap-1 pt-4">
      <button
        onClick={() => onChange(page - 1)}
        disabled={page === 1}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
      >
        <ChevronLeft className="w-4 h-4" />
      </button>

      {items.map((item, i) =>
        item === '…' ? (
          <span key={`e${i}`} className="w-8 h-8 flex items-center justify-center text-muted-foreground text-xs">…</span>
        ) : (
          <button
            key={item}
            onClick={() => onChange(item as number)}
            className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium transition-colors
              ${page === item
                ? 'bg-brand-500 text-white'
                : 'text-muted-foreground hover:bg-muted'
              }`}
          >
            {item}
          </button>
        ),
      )}

      <button
        onClick={() => onChange(page + 1)}
        disabled={page === total}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
      >
        <ChevronRight className="w-4 h-4" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Dep legend
// ─────────────────────────────────────────────────────────────

function DepLegend() {
  const { t } = useTranslation(['production', 'common']);
  return (
    <div className="flex items-center gap-3 flex-wrap text-[10px]">
      <span className="text-muted-foreground">{t('jo.dependencyTypes')}</span>
      {Object.entries(DEP_CONFIG).map(([, d]) => (
        <span
          key={d.short}
          title={`${t(d.labelKey)}: ${t(d.descKey)}`}
          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded border font-bold tracking-wide cursor-help ${d.color}`}
        >
          {d.icon}{d.short}
        </span>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────

export function JobOrdersView() {
  const { t } = useTranslation(['production', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search,       setSearch]  = useState('');
  const [statusFilter, setStatus]  = useState<string>('ALL');
  const [page,         setPage]    = useState(1);
  const [viewMode,     setViewMode] = useState<'list' | 'pdm'>('list');

  // Sorting state — declared before useQuery so sortCol/sortDir are in queryKey
  const { sortedData: _sortedForKey, sortCol, sortDir, handleSort } = useSortedData(
    [] as JobOrder[],
    'createdAt',
    'desc',
  );

  // Reset to page 1 whenever sort, search, or status filter changes
  useEffect(() => { setPage(1); }, [sortCol, sortDir]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const { data: rawData, isLoading } = useQuery({
    queryKey: ['job-orders', statusFilter, sortCol, sortDir],
    queryFn: () => api.get('/production/job-orders', {
      params: {
        status: statusFilter === 'ALL' ? undefined : statusFilter,
        sortBy: sortCol,
        sortOrder: sortDir,
      },
    }),
    refetchInterval: 15_000,
  });

  // Assignable users = everyone below the caller's role in their factory. Uses the
  // dedicated endpoint so Production Managers/Supervisors can (re)assign job orders
  // without full user-management access.
  const { data: usersData } = useQuery({
    queryKey: ['assignable-users'],
    queryFn: () => api.get('/users/assignable'),
    staleTime: 300_000,
  });
  const users: Operator[] = ((usersData as any) ?? []).map((u: any) => ({ id: u.id, name: u.name, nameAr: u.nameAr, role: u.role }));

  const jobOrdersRaw: JobOrder[] = (rawData as any) ?? [];
  const { sortedData: jobOrders } = useSortedData(jobOrdersRaw, 'createdAt', 'desc');

  const transitionMut = useMutation({
    mutationFn: ({ id, status, qty }: { id: string; status: JOStatus; qty?: number }) =>
      api.patch(`/production/job-orders/${id}/status`, {
        status,
        ...(qty !== undefined && { actualQtyGood: qty }),
      }),
    onSuccess: (_res, { status }) => {
      qc.invalidateQueries({ queryKey: ['job-orders'] });
      qc.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      qc.invalidateQueries({ queryKey: ['production', 'kpis'] });
      toast({ title: t('jo.toast.joArrow', { status: JO_STATUS[status] ? t(JO_STATUS[status].labelKey) : status }) });
    },
    onError: (e: any) => toast({
      variant: 'destructive',
      title: t('jo.toast.transitionFailed'),
      description: e?.response?.data?.message ?? t('jo.toast.depNotMet'),
    }),
  });

  const countMut = useMutation({
    mutationFn: ({ id, good, scrap, reason, category }: { id: string; good: number; scrap: number; reason: string; category?: string }) =>
      api.patch(`/production/job-orders/${id}/output`, {
        actualQtyGood: good,
        actualQtyRejected: scrap,
        scrapReason: reason,
        scrapCategory: category ?? 'OTHER',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['job-orders'] });
      qc.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      qc.invalidateQueries({ queryKey: ['production', 'kpis'] });
      toast({ title: t('jo.toast.countSaved') });
    },
    onError: (e: any) => toast({
      variant: 'destructive',
      title: t('jo.toast.failedSaveCount'),
      description: e?.response?.data?.message,
    }),
  });

  const operatorMut = useMutation({
    mutationFn: ({ id, operatorId }: { id: string; operatorId: string | null }) =>
      api.patch(`/production/job-orders/${id}/operator`, { operatorId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['job-orders'] }),
    onError: (e: any) => toast({
      variant: 'destructive',
      title: t('jo.toast.failedAssign'),
      description: e?.response?.data?.message,
    }),
  });

  const isPending = transitionMut.isPending || countMut.isPending || operatorMut.isPending;

  // Filter
  const filtered = jobOrders.filter((jo) => {
    const q = search.toLowerCase();
    return !q
      || jo.operationName.toLowerCase().includes(q)
      || (jo.workOrder?.orderNumber ?? '').toLowerCase().includes(q)
      || (jo.workOrder?.sku?.name ?? '').toLowerCase().includes(q)
      || (jo.machine?.name ?? '').toLowerCase().includes(q);
  });

  // Group by Work Order
  const groups = filtered.reduce<Record<string, { wo: JobOrder['workOrder']; jobs: JobOrder[] }>>(
    (acc, jo) => {
      const key = jo.workOrder?.id ?? 'unknown';
      if (!acc[key]) acc[key] = { wo: jo.workOrder, jobs: [] };
      acc[key].jobs.push(jo);
      return acc;
    },
    {},
  );

  const entries    = Object.entries(groups);
  const totalPages = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  const paginated  = entries.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // KPI
  const executing = jobOrders.filter((j) => j.status === 'EXECUTING').length;
  const ready     = jobOrders.filter((j) => j.status === 'READY').length;
  const complete  = jobOrders.filter((j) => j.status === 'COMPLETE').length;

  return (
    <div className="space-y-5 p-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Layers className="w-5 h-5 text-brand-400" />
            {t('headers.dispatch.title')}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.dispatch.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open('/shop-floor', '_blank')}
            className="text-brand-400 border-brand-400/30 hover:bg-brand-400/10"
          >
            <Monitor className="w-3.5 h-3.5 mr-1.5" />{t('jo.shopFloor')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="text-red-400 border-red-400/30 hover:bg-red-400/10"
          >
            <a href="/production/scrap-log">
              <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />{t('jo.scrapLog')}
            </a>
          </Button>
          <Button variant="outline" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['job-orders'] })}>
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" />{t('jo.refresh')}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { labelKey: 'jo.kpi.executing', value: executing, color: 'text-green-400',   icon: <Play className="w-4 h-4 fill-current" /> },
          { labelKey: 'jo.kpi.ready',     value: ready,     color: 'text-blue-400',    icon: <Clock className="w-4 h-4" /> },
          { labelKey: 'jo.kpi.completed', value: complete,  color: 'text-emerald-400', icon: <CheckSquare className="w-4 h-4" /> },
        ].map((k) => (
          <div key={k.labelKey} className="glass-card rounded-xl p-3 flex items-center gap-3">
            <div className={`${k.color} opacity-80`}>{k.icon}</div>
            <div>
              <div className={`text-2xl font-bold ${k.color}`}>{k.value}</div>
              <div className="text-xs text-muted-foreground">{t(k.labelKey)}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder={t('jobOrders.search')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 h-9 text-sm"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatus(v); setPage(1); }}>
          <SelectTrigger className="w-36 h-9 text-sm">
            <Filter className="w-3.5 h-3.5 mr-1.5 text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('jo.allStatuses')}</SelectItem>
            {Object.entries(JO_STATUS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{t(v.labelKey)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* View mode: operational list ⇄ PDM precedence diagram */}
        <div className="flex items-center rounded-lg border border-border overflow-hidden">
          <button
            onClick={() => setViewMode('list')}
            className={`h-9 px-3 text-xs font-medium flex items-center gap-1.5 transition-colors ${
              viewMode === 'list' ? 'bg-brand-500/15 text-brand-400' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <List className="w-3.5 h-3.5" />{t('jo.list')}
          </button>
          <button
            onClick={() => setViewMode('pdm')}
            title={t('jo.pdmTitle')}
            className={`h-9 px-3 text-xs font-medium flex items-center gap-1.5 border-l border-border transition-colors ${
              viewMode === 'pdm' ? 'bg-brand-500/15 text-brand-400' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Workflow className="w-3.5 h-3.5" />{t('jo.pdmFlow')}
          </button>
        </div>
        <DepLegend />
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="shimmer h-64 rounded-2xl" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="glass-card rounded-2xl p-16 text-center">
          <ClipboardList className="w-10 h-10 text-muted-foreground mx-auto mb-3 opacity-40" />
          <p className="text-sm text-muted-foreground">{t('jobOrders.noJobOrders')}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t('jo.generateHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {paginated.map(([woId, { wo, jobs }]) => (
              <WOCard
                key={woId}
                wo={wo}
                jobs={jobs}
                users={users}
                mode={viewMode}
                onTransition={(id, status, qty) => transitionMut.mutate({ id, status, qty })}
                onCount={(id, good, scrap, reason, category) => countMut.mutate({ id, good, scrap, reason, category })}
                onAssignOperator={(id, operatorId) => operatorMut.mutate({ id, operatorId })}
                pending={isPending}
              />
            ))}
          </div>

          {/* Summary + pagination */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs text-muted-foreground">
              {t('jo.showingPre')} <span className="font-medium text-foreground">{paginated.length}</span> {t('common:of', { defaultValue: 'of' })}{' '}
              <span className="font-medium text-foreground">{entries.length}</span> {t('jo.ofWos')}
              {' '}·{' '}
              <span className="font-medium text-foreground">{filtered.length}</span> {t('jo.joTotal')}
            </p>
            <TablePagination
              page={page}
              total={entries.length}
              limit={PAGE_SIZE}
              onPageChange={setPage}
              isLoading={isLoading}
            />
          </div>
        </>
      )}
    </div>
  );
}
