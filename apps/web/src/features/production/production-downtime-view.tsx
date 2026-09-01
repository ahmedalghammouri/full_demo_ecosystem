'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { toFactoryDayKey } from '@/lib/datetime';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  AlertTriangle, Clock, Wrench, Zap, RefreshCw, TrendingDown,
  Plus, CheckCircle2, X, ChevronDown, ChevronRight, ChevronUp, MoreVertical,
  Pencil, Trash2, Network, Info, BarChart3, ListFilter, Eye,
  CheckCheck, AlertCircle, Search, Calendar, ChevronsUpDown,
  Tag, GitBranch, CircleDot, Cpu, AlignLeft, Lock,
  FileText, Link2, Timer, ShieldAlert, Activity, CalendarClock,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MachinePicker } from '@/components/ui/machine-picker';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { WorkCenterPicker, WorkCenterNode } from '@/components/ui/workcenter-picker';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { cn, formatDateTime } from '@/lib/utils';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';
import { TablePagination } from '@/components/ui/table-pagination';
import { PlannedDowntimeManager } from '@/features/shifts/planned-downtime-manager';

// ── Types ─────────────────────────────────────────────────────────────────────

type DowntimeReasonCode = 'PLANNED_MAINTENANCE' | 'CHANGEOVER' | 'UNPLANNED_BREAKDOWN' | 'MICRO_STOP' | 'STARVED' | 'BLOCKED' | 'EXTERNAL';
type DowntimeCategory = 'MECHANICAL' | 'ELECTRICAL' | 'PROCESS' | 'MATERIAL' | 'OPERATOR' | 'CHANGEOVER' | 'UTILITY' | 'QUALITY' | 'PLANNED_MAINTENANCE' | 'PLANNED_CLEANING' | 'PLANNED_BREAK' | 'STARTUP' | 'EXTERNAL' | 'OTHER';

interface Machine { id: string; name: string; code: string; }
interface WorkOrderRef { id: string; orderNumber: string; status: string; }
export interface ReasonNode {
  id: string;
  code: string;
  name: string;
  nameAr?: string;
  category: DowntimeCategory;
  level: number;
  parentId: string | null;
  machineId?: string | null;
  machine?: Machine | null;
  isPlanned: boolean;
  isActive: boolean;
  sortOrder: number;
  children?: ReasonNode[];
}
interface DowntimeEvent {
  id: string;
  machineId?: string | null;
  startTime: string;
  endTime: string | null;
  durationMinutes?: number | null;
  reasonCode: DowntimeReasonCode;
  category: DowntimeCategory;
  reason?: string | null;
  notes?: string | null;
  affectsOEE: boolean;
  isPlanned: boolean;
  acknowledged: boolean;
  schedulingImpactMins?: number | null;
  machine?: Machine | null;
  workCenter?: { id: string; code: string; name: string } | null;
  workOrder?: WorkOrderRef | null;
  cause?: { id: string; name: string; code: string; level: number; parent?: { name: string; parent?: { name: string } | null } | null } | null;
  operator?: { id: string; name: string } | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

export const REASON_CODE_CFG: Record<DowntimeReasonCode, { labelKey: string; color: string; bg: string; icon: React.ElementType }> = {
  PLANNED_MAINTENANCE:  { labelKey: 'event.reasonCfg.PLANNED_MAINTENANCE', color: 'text-blue-400',   bg: 'bg-blue-500/15 border-blue-500/30',   icon: Wrench },
  CHANGEOVER:           { labelKey: 'event.reasonCfg.CHANGEOVER',          color: 'text-violet-400', bg: 'bg-violet-500/15 border-violet-500/30', icon: RefreshCw },
  UNPLANNED_BREAKDOWN:  { labelKey: 'event.reasonCfg.UNPLANNED_BREAKDOWN',  color: 'text-red-400',    bg: 'bg-red-500/15 border-red-500/30',     icon: AlertTriangle },
  MICRO_STOP:           { labelKey: 'event.reasonCfg.MICRO_STOP',          color: 'text-orange-400', bg: 'bg-orange-500/15 border-orange-500/30', icon: Clock },
  STARVED:              { labelKey: 'event.reasonCfg.STARVED',             color: 'text-amber-400',  bg: 'bg-amber-500/15 border-amber-500/30', icon: TrendingDown },
  BLOCKED:              { labelKey: 'event.reasonCfg.BLOCKED',             color: 'text-yellow-400', bg: 'bg-yellow-500/15 border-yellow-500/30', icon: AlertCircle },
  EXTERNAL:             { labelKey: 'event.reasonCfg.EXTERNAL',            color: 'text-slate-400',  bg: 'bg-slate-500/15 border-slate-500/30', icon: Zap },
};

const CATEGORY_OPTIONS: { value: DowntimeCategory; labelKey: string }[] = [
  { value: 'MECHANICAL',          labelKey: 'dtree.cat.MECHANICAL' },
  { value: 'ELECTRICAL',          labelKey: 'dtree.cat.ELECTRICAL' },
  { value: 'PROCESS',             labelKey: 'dtree.cat.PROCESS' },
  { value: 'MATERIAL',            labelKey: 'dtree.cat.MATERIAL' },
  { value: 'OPERATOR',            labelKey: 'dtree.cat.OPERATOR' },
  { value: 'CHANGEOVER',          labelKey: 'dtree.cat.CHANGEOVER' },
  { value: 'UTILITY',             labelKey: 'dtree.cat.UTILITY' },
  { value: 'QUALITY',             labelKey: 'dtree.cat.QUALITY' },
  { value: 'PLANNED_MAINTENANCE', labelKey: 'dtree.cat.PLANNED_MAINTENANCE' },
  { value: 'PLANNED_CLEANING',    labelKey: 'dtree.cat.PLANNED_CLEANING' },
  { value: 'PLANNED_BREAK',       labelKey: 'dtree.cat.PLANNED_BREAK' },
  { value: 'STARTUP',             labelKey: 'dtree.cat.STARTUP' },
  { value: 'EXTERNAL',            labelKey: 'dtree.cat.EXTERNAL' },
  { value: 'OTHER',               labelKey: 'dtree.cat.OTHER' },
];

const LEVEL_COLORS = ['', 'text-primary', 'text-violet-400', 'text-emerald-400'];
const LEVEL_BG     = ['', 'bg-primary/10 border-primary/20', 'bg-violet-500/10 border-violet-500/20', 'bg-emerald-500/10 border-emerald-500/20'];

function fmtDur(mins: number | null | undefined): string {
  if (mins == null) return '—';
  const m = Math.max(0, mins);
  if (m === 0) return '< 1 min';
  if (m < 60) return `${m.toFixed(0)} min`;
  return `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
}

// ── CauseTreeSelect ────────────────────────────────────────────────────────────

const L1_ICON = Network;
const L2_ICON = GitBranch;
const L3_ICON = CircleDot;

export interface CauseSelection {
  id: string;
  l1Name: string;
  l2Name: string;
  l3Name: string;
  category: DowntimeCategory;
  isPlanned: boolean;
  machineId?: string | null;
}

function flattenTree(tree: ReasonNode[], machineId?: string): CauseSelection[] {
  const out: CauseSelection[] = [];
  for (const l1 of tree) {
    for (const l2 of l1.children ?? []) {
      for (const l3 of l2.children ?? []) {
        if (!l3.isActive) continue;
        if (machineId && l3.machineId && l3.machineId !== machineId) continue;
        out.push({
          id: l3.id,
          l1Name: l1.name,
          l2Name: l2.name,
          l3Name: l3.name,
          category: l3.category,
          isPlanned: l3.isPlanned,
          machineId: l3.machineId,
        });
      }
    }
  }
  return out;
}

export function CauseTreeSelect({
  reasonTree,
  value,
  machineId,
  onChange,
  placeholder,
  className,
}: {
  reasonTree: ReasonNode[];
  value: string;
  machineId?: string;
  onChange: (id: string, sel: CauseSelection | null) => void;
  placeholder?: string;
  className?: string;
}) {
  const { t } = useTranslation(['production', 'common']);
  const ph = placeholder ?? t('dcause.placeholder');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [expandedL1, setExpandedL1] = useState<Set<string>>(() => new Set());
  const [expandedL2, setExpandedL2] = useState<Set<string>>(() => new Set());
  const ref = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    // On touch devices (tablets), auto-focusing the search box pops the on-screen
    // keyboard, which covers the options list and blocks scrolling/selection. Only
    // auto-focus on fine-pointer (mouse) devices so operators can scroll the tree.
    const coarse = typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: coarse)').matches;
    if (!coarse) setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const flatLeaves = useMemo(() => flattenTree(reasonTree, machineId), [reasonTree, machineId]);
  const selected = flatLeaves.find(l => l.id === value) ?? null;

  const q = search.toLowerCase().trim();
  const searchMatches = useMemo(() => {
    if (!q) return null;
    return flatLeaves.filter(l =>
      l.l3Name.toLowerCase().includes(q) ||
      l.l2Name.toLowerCase().includes(q) ||
      l.l1Name.toLowerCase().includes(q),
    );
  }, [q, flatLeaves]);

  const toggleL1 = useCallback((id: string) => {
    setExpandedL1(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const toggleL2 = useCallback((id: string) => {
    setExpandedL2(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);

  const select = (leaf: CauseSelection) => {
    onChange(leaf.id, leaf);
    setOpen(false);
    setSearch('');
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('', null);
  };

  return (
    <div ref={ref} className={cn('relative', className)}>
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'w-full flex items-center gap-2 h-10 px-3 rounded-lg border text-sm transition-colors text-left',
          open ? 'border-primary ring-2 ring-primary/20 bg-background' : 'border-border bg-background hover:border-primary/50',
          !selected && 'text-muted-foreground',
        )}
      >
        {selected ? (
          <div className="flex-1 flex items-center gap-2 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{selected.l1Name}</span>
              <ChevronRight size={10} className="text-muted-foreground shrink-0" />
              <span className="text-[10px] text-muted-foreground shrink-0 font-mono">{selected.l2Name}</span>
              <ChevronRight size={10} className="text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-foreground truncate">{selected.l3Name}</span>
            </div>
            {selected.machineId && (
              <Badge variant="outline" className="text-[9px] h-4 shrink-0 text-primary border-primary/30">
                <Cpu size={8} className="mr-0.5" />{t('dcause.machineSpecific')}
              </Badge>
            )}
          </div>
        ) : (
          <span className="flex-1 text-muted-foreground">{ph}</span>
        )}
        <div className="flex items-center gap-1 shrink-0">
          {selected && (
            <span
              role="button"
              onClick={clear}
              className="text-muted-foreground hover:text-foreground p-0.5 rounded transition-colors"
            >
              <X size={13} />
            </span>
          )}
          <ChevronsUpDown size={13} className="text-muted-foreground" />
        </div>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-[calc(100%+4px)] left-0 right-0 bg-background border border-border rounded-xl shadow-2xl overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-border">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t('dcause.searchCauses')}
                className="w-full h-8 pl-8 pr-3 text-sm bg-muted/30 border border-border rounded-lg outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Tree / Search results */}
          <div className="overflow-y-auto max-h-72 py-1">
            {searchMatches !== null ? (
              /* Search results: flat list with breadcrumb */
              searchMatches.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-6">{t('dcause.noCauses')}</p>
              ) : (
                searchMatches.map(leaf => (
                  <button
                    key={leaf.id}
                    type="button"
                    onClick={() => select(leaf)}
                    className={cn(
                      'w-full flex flex-col items-start px-3 py-2 hover:bg-muted/40 transition-colors text-left',
                      value === leaf.id && 'bg-primary/10 border-l-2 border-primary',
                    )}
                  >
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <L3_ICON size={11} className="text-emerald-400 shrink-0" />
                      <span className="text-sm font-medium">{leaf.l3Name}</span>
                      {leaf.machineId && <Badge variant="outline" className="text-[9px] h-3.5 text-primary border-primary/30"><Cpu size={7} className="mr-0.5" />{t('dcause.specific')}</Badge>}
                    </div>
                    <span className="text-[10px] text-muted-foreground ml-5">{leaf.l1Name} › {leaf.l2Name}</span>
                  </button>
                ))
              )
            ) : (
              /* Full tree */
              reasonTree.map(l1 => {
                const l1Leaves = flatLeaves.filter(l => l.l1Name === l1.name);
                if (l1Leaves.length === 0) return null;
                const l1Open = expandedL1.has(l1.id);
                return (
                  <div key={l1.id}>
                    {/* L1 header */}
                    <button
                      type="button"
                      onClick={() => toggleL1(l1.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/30 transition-colors text-left"
                    >
                      {l1Open ? <ChevronDown size={13} className="text-primary shrink-0" /> : <ChevronRight size={13} className="text-muted-foreground shrink-0" />}
                      <L1_ICON size={13} className="text-primary shrink-0" />
                      <span className="text-xs font-bold text-primary flex-1">{l1.name}</span>
                      <span className="text-[10px] text-muted-foreground">{l1Leaves.length}</span>
                    </button>

                    {l1Open && (l1.children ?? []).map(l2 => {
                      const l2Leaves = l1Leaves.filter(l => l.l2Name === l2.name);
                      if (l2Leaves.length === 0) return null;
                      const l2Open = expandedL2.has(l2.id);
                      return (
                        <div key={l2.id}>
                          {/* L2 header */}
                          <button
                            type="button"
                            onClick={() => toggleL2(l2.id)}
                            className="w-full flex items-center gap-2 pl-8 pr-3 py-1.5 hover:bg-muted/20 transition-colors text-left"
                          >
                            {l2Open ? <ChevronDown size={11} className="text-violet-400 shrink-0" /> : <ChevronRight size={11} className="text-muted-foreground shrink-0" />}
                            <L2_ICON size={11} className="text-violet-400 shrink-0" />
                            <span className="text-[11px] font-semibold text-violet-400 flex-1">{l2.name}</span>
                            <span className="text-[10px] text-muted-foreground">{l2Leaves.length}</span>
                          </button>

                          {/* L3 leaves */}
                          {l2Open && l2Leaves.map(leaf => (
                            <button
                              key={leaf.id}
                              type="button"
                              onClick={() => select(leaf)}
                              className={cn(
                                'w-full flex items-center gap-2 pl-14 pr-3 py-1.5 hover:bg-muted/40 transition-colors text-left',
                                value === leaf.id && 'bg-primary/10 border-l-2 border-l-primary',
                              )}
                            >
                              <L3_ICON size={10} className={cn('shrink-0', value === leaf.id ? 'text-primary' : 'text-emerald-400')} />
                              <span className={cn('text-sm flex-1', value === leaf.id ? 'text-primary font-medium' : '')}>{leaf.l3Name}</span>
                              {leaf.machineId && <Badge variant="outline" className="text-[9px] h-3.5 text-primary border-primary/30 shrink-0"><Cpu size={7} className="mr-0.5" />{t('dcause.specific')}</Badge>}
                              {value === leaf.id && <CheckCircle2 size={12} className="text-primary shrink-0" />}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer hint */}
          <div className="border-t border-border px-3 py-1.5 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">{t('dcause.causesAvailable', { count: flatLeaves.length })}{machineId ? t('dcause.forSelectedMachine') : ''}</span>
            {value && (
              <button type="button" onClick={clear} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors flex items-center gap-0.5">
                <X size={10} />{t('dcause.clearSelection')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab nav ──────────────────────────────────────────────────────────────────

type Tab = 'live' | 'history' | 'planned' | 'tree' | 'analytics';

// ═══════════════════════════════════════════════════════════════════════════
// REASON TREE TAB
// ═══════════════════════════════════════════════════════════════════════════

function NodeForm({
  title,
  parentId,
  parentLevel,
  machines,
  initial,
  onSubmit,
  onCancel,
  isPending,
}: {
  title: string;
  parentId?: string | null;
  parentLevel?: number;
  machines: Machine[];
  initial?: Partial<ReasonNode>;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation(['production', 'common']);
  const nextLevel = parentLevel != null ? parentLevel + 1 : 1;
  const [form, setForm] = useState({
    code:     initial?.code     ?? '',
    name:     initial?.name     ?? '',
    nameAr:   initial?.nameAr   ?? '',
    category: (initial?.category ?? 'MECHANICAL') as DowntimeCategory,
    machineId: initial?.machineId ?? '',
    isPlanned: initial?.isPlanned ?? false,
    sortOrder: String(initial?.sortOrder ?? 0),
  });

  const set = (k: string, v: unknown) => setForm(p => ({ ...p, [k]: v }));

  return (
    <div className="border rounded-xl p-4 bg-muted/10 flex flex-col gap-3 mt-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title} ({t('dtree.level')} {nextLevel})</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('dtree.code')} *</Label>
          <Input value={form.code} onChange={e => set('code', e.target.value)} placeholder={t('dtree.codePlaceholder')} className="h-7 text-xs" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('dtree.sortOrder')}</Label>
          <Input type="number" value={form.sortOrder} onChange={e => set('sortOrder', e.target.value)} className="h-7 text-xs" />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{t('dtree.nameEn')} *</Label>
        <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder={t('dtree.reasonNamePlaceholder')} className="h-7 text-xs" />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs">{t('dtree.nameAr')}</Label>
        <Input dir="rtl" value={form.nameAr} onChange={e => set('nameAr', e.target.value)} placeholder="اسم السبب..." className="h-7 text-xs" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs">{t('dtree.category')}</Label>
          <Select value={form.category} onValueChange={v => set('category', v)}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {nextLevel === 3 && (
          <div className="flex flex-col gap-1">
            <Label className="text-xs">{t('dtree.machineScope')}</Label>
            <Select value={form.machineId || '__all__'} onValueChange={v => set('machineId', v === '__all__' ? '' : v)}>
              <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">{t('dtree.allMachines')}</SelectItem>
                {machines.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 text-xs">
        <input type="checkbox" id="ip-planned" checked={form.isPlanned} onChange={e => set('isPlanned', e.target.checked)} />
        <label htmlFor="ip-planned" className="text-muted-foreground cursor-pointer">{t('dtree.plannedStop')}</label>
      </div>
      <div className="flex justify-end gap-2 mt-1">
        <Button variant="outline" size="sm" onClick={onCancel} className="h-7 text-xs">{t('dtree.cancel')}</Button>
        <Button size="sm" disabled={!form.code || !form.name || isPending} onClick={() => onSubmit({
          ...form,
          parentId: parentId ?? null,
          level: nextLevel,
          machineId: form.machineId || null,
          sortOrder: parseInt(form.sortOrder, 10) || 0,
        })} className="h-7 text-xs">
          {isPending ? t('dtree.saving') : t('dtree.save')}
        </Button>
      </div>
    </div>
  );
}

function L3Node({ node, machines, onEdit, onDelete }: { node: ReasonNode; machines: Machine[]; onEdit: () => void; onDelete: () => void }) {
  const { t } = useTranslation(['production', 'common']);
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2 rounded-lg border text-xs', node.isActive ? 'bg-muted/10' : 'opacity-40 bg-muted/5')}>
      <span className="font-mono text-[10px] text-muted-foreground w-24 shrink-0">{node.code}</span>
      <span className="flex-1 font-medium">{node.name}</span>
      {node.nameAr && <span className="text-[10px] text-muted-foreground" dir="rtl">{node.nameAr}</span>}
      {node.machine && (
        <Badge variant="outline" className="text-[10px] h-4 shrink-0">{node.machine.name}</Badge>
      )}
      {!node.isActive && <Badge variant="outline" className="text-[10px] h-4 text-muted-foreground shrink-0">{t('dtree.inactive')}</Badge>}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0"><MoreVertical size={11} /></Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem onClick={onEdit}><Pencil size={11} className="me-2" />{t('dtree.edit')}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive"><Trash2 size={11} className="me-2" />{t('dtree.delete')}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function TreeTab({ machines }: { machines: Machine[] }) {
  const { t } = useTranslation(['production', 'common']);
  const qc = useQueryClient();
  const { data: tree = [], isLoading } = useQuery<ReasonNode[]>({
    queryKey: ['downtime-reason-tree'],
    queryFn: () => api.get('/production/downtime/reasons/tree'),
  });

  const createMut = useMutation({
    mutationFn: (dto: any) => api.post('/production/downtime/reasons', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-reason-tree'] }); setAdding(null); },
  });
  const updateMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/production/downtime/reasons/${id}`, dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-reason-tree'] }); setEditing(null); },
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/production/downtime/reasons/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downtime-reason-tree'] }),
  });

  const [expandedL1, setExpandedL1] = useState<Set<string>>(new Set());
  const [expandedL2, setExpandedL2] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<{ parentId: string | null; parentLevel: number } | null>(null);
  const [editing, setEditing] = useState<ReasonNode | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReasonNode | null>(null);

  const toggleL1 = (id: string) => setExpandedL1(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleL2 = (id: string) => setExpandedL2(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (isLoading) return <div className="text-sm text-muted-foreground p-10 text-center">{t('dtree.loadingTree')}</div>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{t('dtree.treeTitle')}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('dtree.treeDesc')}
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding({ parentId: null, parentLevel: 0 })} className="h-7 text-xs">
          <Plus size={12} className="me-1" />{t('dtree.addL1')}
        </Button>
      </div>

      {adding?.parentId === null && (
        <NodeForm
          title={t('dtree.newL1')}
          parentId={null}
          parentLevel={0}
          machines={machines}
          onSubmit={dto => createMut.mutate(dto)}
          onCancel={() => setAdding(null)}
          isPending={createMut.isPending}
        />
      )}

      <div className="flex flex-col gap-2">
        {(tree as ReasonNode[]).map(l1 => (
          <div key={l1.id} className={cn('border rounded-xl overflow-hidden', LEVEL_BG[1])}>
            {/* L1 header */}
            <div className="flex items-center gap-2 px-4 py-2.5 cursor-pointer" onClick={() => toggleL1(l1.id)}>
              {expandedL1.has(l1.id) ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
              <Network size={14} className={cn('shrink-0', LEVEL_COLORS[1])} />
              <span className={cn('font-bold text-sm flex-1', LEVEL_COLORS[1])}>{l1.name}</span>
              {l1.nameAr && <span className="text-xs text-muted-foreground" dir="rtl">{l1.nameAr}</span>}
              <Badge variant="outline" className="text-[10px] h-4">{t('dtree.subCategories', { count: l1.children?.length ?? 0 })}</Badge>
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={() => setAdding({ parentId: l1.id, parentLevel: 1 })}>
                  <Plus size={10} className="me-0.5" />{t('dtree.subCategoryBtn')}
                </Button>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(l1)}><Pencil size={11} /></Button>
              </div>
            </div>

            {/* L1 edit form */}
            {editing?.id === l1.id && (
              <div className="px-4 pb-3">
                <NodeForm
                  title={t('dtree.editL1')}
                  parentId={l1.parentId}
                  parentLevel={0}
                  machines={machines}
                  initial={l1}
                  onSubmit={dto => updateMut.mutate({ id: l1.id, dto })}
                  onCancel={() => setEditing(null)}
                  isPending={updateMut.isPending}
                />
              </div>
            )}

            {/* L2 children */}
            {expandedL1.has(l1.id) && (
              <div className="flex flex-col gap-2 px-4 pb-3">
                {adding?.parentId === l1.id && (
                  <NodeForm
                    title={t('dtree.newSub')}
                    parentId={l1.id}
                    parentLevel={1}
                    machines={machines}
                    onSubmit={dto => createMut.mutate(dto)}
                    onCancel={() => setAdding(null)}
                    isPending={createMut.isPending}
                  />
                )}

                {(l1.children ?? []).map(l2 => (
                  <div key={l2.id} className={cn('border rounded-lg overflow-hidden', LEVEL_BG[2])}>
                    {/* L2 header */}
                    <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => toggleL2(l2.id)}>
                      {expandedL2.has(l2.id) ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
                      <span className={cn('font-semibold text-xs flex-1', LEVEL_COLORS[2])}>{l2.name}</span>
                      {l2.nameAr && <span className="text-[10px] text-muted-foreground" dir="rtl">{l2.nameAr}</span>}
                      <Badge variant="outline" className="text-[10px] h-4">{t('dtree.reasonsCount', { count: l2.children?.length ?? 0 })}</Badge>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => setAdding({ parentId: l2.id, parentLevel: 2 })}>
                          <Plus size={9} className="me-0.5" />{t('dtree.reasonBtn')}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setEditing(l2)}><Pencil size={10} /></Button>
                        <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive" onClick={() => setDeleteTarget(l2)}><Trash2 size={10} /></Button>
                      </div>
                    </div>

                    {/* L2 edit form */}
                    {editing?.id === l2.id && (
                      <div className="px-3 pb-2">
                        <NodeForm
                          title={t('dtree.editSub')}
                          parentId={l2.parentId}
                          parentLevel={1}
                          machines={machines}
                          initial={l2}
                          onSubmit={dto => updateMut.mutate({ id: l2.id, dto })}
                          onCancel={() => setEditing(null)}
                          isPending={updateMut.isPending}
                        />
                      </div>
                    )}

                    {/* L3 leaves */}
                    {expandedL2.has(l2.id) && (
                      <div className="flex flex-col gap-1 px-3 pb-2">
                        {adding?.parentId === l2.id && (
                          <NodeForm
                            title={t('dtree.newReason')}
                            parentId={l2.id}
                            parentLevel={2}
                            machines={machines}
                            onSubmit={dto => createMut.mutate(dto)}
                            onCancel={() => setAdding(null)}
                            isPending={createMut.isPending}
                          />
                        )}
                        {editing && editing.parentId === l2.id && editing.level === 3 && (
                          <NodeForm
                            title={t('dtree.editReason')}
                            parentId={l2.id}
                            parentLevel={2}
                            machines={machines}
                            initial={editing}
                            onSubmit={dto => updateMut.mutate({ id: editing.id, dto })}
                            onCancel={() => setEditing(null)}
                            isPending={updateMut.isPending}
                          />
                        )}
                        {(l2.children ?? []).map(l3 => (
                          <L3Node
                            key={l3.id}
                            node={l3}
                            machines={machines}
                            onEdit={() => setEditing(l3)}
                            onDelete={() => setDeleteTarget(l3)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border rounded-xl shadow-2xl w-full max-w-sm p-6">
              <h3 className="font-semibold mb-2">{t('dnode.deleteTitle')}</h3>
              <p className="text-sm text-muted-foreground mb-4">
                <strong>"{deleteTarget.name}"</strong> {t('dnode.deletePre')}
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>{t('dnode.cancel')}</Button>
                <Button variant="destructive" size="sm" disabled={deleteMut.isPending}
                  onClick={() => deleteMut.mutate(deleteTarget.id)}>
                  {deleteMut.isPending ? t('dnode.deleting') : t('dnode.delete')}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Live elapsed timer ────────────────────────────────────────────────────────

function LiveElapsed({ startTime }: { startTime: string }) {
  const { t } = useTranslation('production');
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(n => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);
  const mins = Math.max(0, Math.floor((Date.now() - new Date(startTime).getTime()) / 60_000));
  if (mins < 60) return <span className="font-mono text-red-400 font-bold animate-pulse">{mins}m {t('downtime.openSuffix')}</span>;
  return <span className="font-mono text-red-400 font-bold animate-pulse">{Math.floor(mins / 60)}h {mins % 60}m {t('downtime.openSuffix')}</span>;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVENTS TABLE (shared by Live + History)
// ═══════════════════════════════════════════════════════════════════════════

function EventRow({ event, onAck, onClose, onEdit, onDelete, liveMode }: {
  event: DowntimeEvent;
  onAck?: () => void;
  onClose?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  liveMode?: boolean;
}) {
  const { t } = useTranslation(['production', 'common']);
  const [expanded, setExpanded] = useState(false);
  const cfg = REASON_CODE_CFG[event.reasonCode] ?? REASON_CODE_CFG.UNPLANNED_BREAKDOWN;
  const Icon = cfg.icon;
  const isOpen = !event.endTime;

  const causeLabel = event.cause
    ? [event.cause.parent?.parent?.name, event.cause.parent?.name, event.cause.name].filter(Boolean).join(' › ')
    : event.reason ?? '—';

  const WO_STATUS_COLOR: Record<string, string> = {
    IN_PROGRESS: 'text-blue-400 border-blue-500/30',
    PLANNED:     'text-muted-foreground',
    COMPLETED:   'text-emerald-400 border-emerald-500/30',
    ON_HOLD:     'text-amber-400 border-amber-500/30',
    CANCELLED:   'text-destructive',
  };

  return (
    <>
      <tr
        className={cn(
          'border-b border-border/50 transition-colors text-xs cursor-pointer',
          expanded ? 'bg-muted/30' : 'hover:bg-muted/20',
        )}
        onClick={() => setExpanded(e => !e)}
      >
        {/* Expand toggle */}
        <td className="pl-2 pr-1 py-2.5 w-6">
          {expanded
            ? <ChevronUp size={12} className="text-muted-foreground" />
            : <ChevronDown size={12} className="text-muted-foreground" />}
        </td>

        <td className="px-2 py-2.5">
          <div className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-medium', cfg.bg, cfg.color)}>
            <Icon size={10} />
            {t(`event.reasonCfg.${event.reasonCode}`)}
          </div>
        </td>

        <td className="px-2 py-2.5 max-w-[200px]">
          <p className="text-xs leading-tight truncate">{causeLabel}</p>
          {event.cause?.code && <span className="font-mono text-[10px] text-muted-foreground">{event.cause.code}</span>}
        </td>

        <td className="px-2 py-2.5">
          {event.machine ? (
            <div>
              <p className="text-xs font-medium">{event.machine.name}</p>
              <p className="font-mono text-[10px] text-muted-foreground">{event.machine.code}</p>
            </div>
          ) : <span className="text-muted-foreground">—</span>}
        </td>

        <td className="px-2 py-2.5 text-muted-foreground text-xs">{event.workCenter?.name ?? '—'}</td>

        <td className="px-2 py-2.5">
          <div className="text-[11px]">{formatDateTime(event.startTime)}</div>
          {event.endTime && <div className="text-[10px] text-muted-foreground">{formatDateTime(event.endTime)}</div>}
        </td>

        <td className="px-2 py-2.5">
          {isOpen
            ? <LiveElapsed startTime={event.startTime} />
            : <span className="font-mono text-xs">{fmtDur(event.durationMinutes)}</span>}
        </td>

        <td className="px-2 py-2.5">
          {event.affectsOEE
            ? <span className="text-red-400 text-[10px] font-medium">{t('event.row.oeeDown')}</span>
            : <span className="text-muted-foreground text-[10px]">{t('event.row.noImpact')}</span>}
          {(event.schedulingImpactMins ?? 0) > 0 && (
            <div className="text-[10px] text-amber-400 flex items-center gap-0.5 mt-0.5">
              <ShieldAlert size={9} />{t('event.row.delay', { count: Math.round(event.schedulingImpactMins!) })}
            </div>
          )}
        </td>

        <td className="px-2 py-2.5" onClick={e => e.stopPropagation()}>
          <div className="flex gap-1 items-center flex-wrap">
            {isOpen && onClose && (
              <Button size="sm" variant="outline" className="h-6 text-[10px] border-red-500/40 text-red-400 hover:bg-red-500/10" onClick={onClose}>
                <CheckCheck size={10} className="me-1" />{t('event.row.close')}
              </Button>
            )}
            {liveMode && onEdit && (
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onEdit}>
                <Pencil size={10} className="me-1" />{t('event.row.edit')}
              </Button>
            )}
            {!event.acknowledged && onAck && (
              <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onAck}>
                <Eye size={10} className="me-1" />{t('event.row.ack')}
              </Button>
            )}
            {event.acknowledged && (
              <Badge variant="outline" className="text-[10px] h-5 text-emerald-400 border-emerald-500/30">
                <CheckCircle2 size={9} className="me-0.5" />{t('event.row.ackd')}
              </Badge>
            )}
            {onDelete && (
              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDelete}>
                <Trash2 size={10} className="me-1" />{t('event.row.delete')}
              </Button>
            )}
          </div>
        </td>
      </tr>

      {/* ── Expanded detail row ── */}
      {expanded && (
        <tr className="bg-muted/20 border-b border-border/50">
          <td colSpan={9} className="px-4 py-3">
            <div className="grid grid-cols-4 gap-4 text-xs">
              {/* Work Order */}
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Link2 size={9} />{t('event.row.workOrder')}
                </p>
                {event.workOrder ? (
                  <div className="flex items-center gap-1.5">
                    <Badge variant="outline" className={cn('text-[10px] h-4 font-mono', WO_STATUS_COLOR[event.workOrder.status] ?? '')}>
                      {event.workOrder.orderNumber}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">{t(`podetail.woStatus.${event.workOrder.status}`)}</span>
                  </div>
                ) : <span className="text-muted-foreground">{t('event.row.noLinkedWo')}</span>}
              </div>

              {/* Cause + Category */}
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Tag size={9} />{t('event.row.category')}
                </p>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] h-4">{t(`dtree.cat.${event.category}`)}</Badge>
                  {event.isPlanned && <Badge variant="outline" className="text-[10px] h-4 text-blue-400 border-blue-500/30">{t('event.row.planned')}</Badge>}
                </div>
              </div>

              {/* Duration + OEE */}
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <Timer size={9} />{t('event.row.durationOee')}
                </p>
                <div className="text-xs">
                  <span className="font-mono">{isOpen ? t('event.row.stillRunning') : fmtDur(event.durationMinutes)}</span>
                  {(event.schedulingImpactMins ?? 0) > 0 && (
                    <span className="ms-2 text-amber-400 text-[10px]">
                      {t('event.row.woDelay', { count: Math.round(event.schedulingImpactMins!) })}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {event.affectsOEE ? t('event.row.countsOee') : t('event.row.excludedOee')}
                </span>
              </div>

              {/* Notes */}
              <div className="flex flex-col gap-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                  <FileText size={9} />{t('event.row.notesResolution')}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {event.notes || event.reason || <span className="italic">{t('event.row.noNotes')}</span>}
                </p>
                {event.operator && (
                  <p className="text-[10px] text-muted-foreground">{t('event.row.operator', { name: event.operator.name })}</p>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// LIVE EVENTS TAB
// ═══════════════════════════════════════════════════════════════════════════

// ── Edit Event Modal ──────────────────────────────────────────────────────────

function EditEventModal({
  event,
  reasonTree,
  machines,
  onClose,
  onSave,
  isPending,
}: {
  event: DowntimeEvent;
  reasonTree: ReasonNode[];
  machines: Machine[];
  onClose: () => void;
  onSave: (dto: any) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation(['production', 'common']);
  const [form, setForm] = useState({
    causeId: event.cause?.id ?? '',
    causeCategory: event.cause ? event.category : event.category,
    causeIsPlanned: event.isPlanned,
    notes: event.notes ?? event.reason ?? '',
    reasonCode: event.reasonCode,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        className="bg-background border rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/20">
          <div className="flex items-center gap-2">
            <Pencil size={14} className="text-primary" />
            <p className="text-sm font-semibold">{t('event.editTitle')}</p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}><X size={14} /></Button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          {/* Reason Code */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">{t('event.reasonCode')}</Label>
            <Select value={form.reasonCode} onValueChange={v => setForm(p => ({ ...p, reasonCode: v as DowntimeReasonCode }))}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_CODE_CFG).map(([k, v]) => {
                  const Ic = v.icon;
                  return (
                    <SelectItem key={k} value={k}>
                      <div className="flex items-center gap-2"><Ic size={12} className={v.color} />{t(`event.reasonCfg.${k}`)}</div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Cause tree */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">{t('event.specificCause')}</Label>
            <CauseTreeSelect
              reasonTree={reasonTree}
              value={form.causeId}
              machineId={event.machineId ?? undefined}
              onChange={(id, sel) => setForm(p => ({
                ...p,
                causeId: id,
                causeCategory: sel?.category ?? p.causeCategory,
                causeIsPlanned: sel?.isPlanned ?? p.causeIsPlanned,
              }))}
            />
          </div>

          {/* Notes */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">{t('event.notesResolution')}</Label>
            <Input
              value={form.notes}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              placeholder={t('event.notesPlaceholder')}
              className="h-9"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 px-5 py-3.5 border-t bg-muted/10">
          <Button variant="outline" size="sm" onClick={onClose}>{t('event.cancel')}</Button>
          <Button size="sm" disabled={isPending} onClick={() => onSave({
            reasonCode: form.reasonCode,
            causeId: form.causeId || undefined,
            category: form.causeCategory,
            reason: form.notes || undefined,
          })}>
            {isPending ? <><RefreshCw size={12} className="animate-spin me-1.5" />{t('event.saving')}</> : t('event.saveChanges')}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Delete confirmation dialog ────────────────────────────────────────────────

function DeleteEventDialog({
  event,
  onCancel,
  onConfirm,
  isPending,
}: {
  event: DowntimeEvent;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation(['production', 'common']);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        className="bg-background border border-destructive/30 rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-destructive/15 flex items-center justify-center shrink-0">
            <Trash2 size={16} className="text-destructive" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{t('event.deleteTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('event.cannotUndo')}</p>
          </div>
        </div>

        <div className="p-3 rounded-lg bg-muted/20 border text-xs space-y-1 mb-4">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('event.machine')}</span>
            <span>{event.machine?.name ?? '—'}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('event.reason')}</span>
            <span>{t(`event.reasonCfg.${event.reasonCode}`)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('event.started')}</span>
            <span className="font-mono">{formatDateTime(event.startTime)}</span>
          </div>
          {event.endTime && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('event.duration')}</span>
              <span className="font-mono">{fmtDur(event.durationMinutes)}</span>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          {t('event.deleteWarn')}
        </p>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>{t('event.cancel')}</Button>
          <Button variant="destructive" size="sm" disabled={isPending} onClick={onConfirm}>
            {isPending ? <><RefreshCw size={12} className="animate-spin me-1.5" />{t('event.deleting')}</> : <><Trash2 size={12} className="me-1.5" />{t('event.deleteEvent')}</>}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

// ── Close with resolution dialog ──────────────────────────────────────────────

function CloseEventDialog({
  event,
  onCancel,
  onClose,
  isPending,
}: {
  event: DowntimeEvent;
  onCancel: () => void;
  onClose: (resolution: string) => void;
  isPending: boolean;
}) {
  const { t } = useTranslation(['production', 'common']);
  const [resolution, setResolution] = useState('');
  const elapsedMins = Math.max(0, Math.floor((Date.now() - new Date(event.startTime).getTime()) / 60_000));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
        className="bg-background border rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <CheckCheck size={16} className="text-emerald-400" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">{t('event.closeTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('event.machineRunning', { name: event.machine?.name ?? '—', dur: fmtDur(elapsedMins) })}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <div className="p-3 rounded-lg bg-muted/20 border text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('event.cause')}</span>
              <span>{event.cause?.name ?? event.reason ?? '—'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('event.durationSoFar')}</span>
              <span className="font-mono text-red-400">{fmtDur(elapsedMins)}</span>
            </div>
            {event.workOrder && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('event.linkedWo')}</span>
                <span className="font-mono">{event.workOrder.orderNumber}</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs font-medium">{t('event.resolutionNotes')}</Label>
            <Input
              value={resolution}
              onChange={e => setResolution(e.target.value)}
              placeholder={t('event.resolutionPlaceholder')}
              className="h-9 text-sm"
              autoFocus
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" size="sm" onClick={onCancel}>{t('event.cancel')}</Button>
          <Button size="sm" disabled={isPending}
            className="bg-emerald-600 hover:bg-emerald-700 text-white"
            onClick={() => onClose(resolution)}>
            {isPending ? <><RefreshCw size={12} className="animate-spin me-1.5" />{t('event.closing')}</> : <><CheckCheck size={12} className="me-1.5" />{t('event.closeEvent')}</>}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

function LiveTab({ machines, reasonTree }: { machines: Machine[]; reasonTree: ReasonNode[] }) {
  const { t } = useTranslation(['production', 'common']);
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [machineLocked, setMachineLocked] = useState(false);
  const [editTarget, setEditTarget] = useState<DowntimeEvent | null>(null);
  const [closeTarget, setCloseTarget] = useState<DowntimeEvent | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DowntimeEvent | null>(null);
  const [form, setForm] = useState({
    machineId: '',
    workCenterId: '',
    reasonCode: 'UNPLANNED_BREAKDOWN' as DowntimeReasonCode,
    causeId: '',
    causeCategory: 'MECHANICAL' as DowntimeCategory,
    causeIsPlanned: false,
    reason: '',
    startTime: '',
  });

  const resetForm = () => {
    setForm({ machineId: '', workCenterId: '', reasonCode: 'UNPLANNED_BREAKDOWN', causeId: '', causeCategory: 'MECHANICAL', causeIsPlanned: false, reason: '', startTime: '' });
    setMachineLocked(false);
    setApiError(null);
  };

  const handleWCChange = (id: string | null, node: WorkCenterNode | null) => {
    let newMachineId = form.machineId;
    let locked = false;

    if (node) {
      // For CELL-level work centers, try to find a machine with matching code or name
      const match = machines.find(m =>
        m.code.toLowerCase() === node.code.toLowerCase() ||
        m.name.toLowerCase() === node.name.toLowerCase(),
      );
      if (match) {
        newMachineId = match.id;
        locked = true;
      }
    } else {
      // Work center cleared — unlock machine selection
      locked = false;
    }

    setMachineLocked(locked);
    setForm(p => ({
      ...p,
      workCenterId: id ?? '',
      machineId: locked ? newMachineId : p.machineId,
      causeId: locked && newMachineId !== p.machineId ? '' : p.causeId,
    }));
  };

  const { data: eventsData, isLoading } = useQuery({
    queryKey: ['downtime-live'],
    queryFn: () => api.get('/production/downtime/events?isOpen=true&limit=50'),
    refetchInterval: 15_000,
  });

  const createMut = useMutation({
    mutationFn: (dto: any) => api.post('/production/downtime/events', dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-live'] }); setCreateOpen(false); resetForm(); },
    onError: (err: any) => {
      const msg = err?.response?.data?.message ?? err?.message ?? t('dlogfail');
      setApiError(Array.isArray(msg) ? msg.join(', ') : String(msg));
    },
  });
  const closeMut = useMutation({
    mutationFn: ({ id, resolution }: { id: string; resolution: string }) =>
      api.patch(`/production/downtime/events/${id}/end`, {
        endTime: new Date().toISOString(),
        ...(resolution && { resolution }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-live'] }); setCloseTarget(null); },
  });
  const editMut = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/production/downtime/events/${id}`, dto),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-live'] }); setEditTarget(null); },
  });
  const ackMut = useMutation({
    mutationFn: (id: string) => api.patch(`/production/downtime/events/${id}/acknowledge`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['downtime-live'] }),
  });
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/production/downtime/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['downtime-live'] }); setDeleteTarget(null); },
  });

  const events: DowntimeEvent[] = (eventsData as any)?.data ?? (Array.isArray(eventsData) ? eventsData : []);

  const handleCauseChange = (id: string, sel: CauseSelection | null) => {
    setForm(p => ({
      ...p,
      causeId: id,
      causeCategory: sel?.category ?? p.causeCategory,
      causeIsPlanned: sel?.isPlanned ?? p.causeIsPlanned,
    }));
  };

  const handleSubmit = () => {
    setApiError(null);
    createMut.mutate({
      machineId: form.machineId || undefined,
      reasonCode: form.reasonCode,
      causeId: form.causeId || undefined,
      workCenterId: form.workCenterId || undefined,
      category: form.causeCategory,
      description: form.reason || undefined,
      startTime: form.startTime || undefined,
      isPlanned: form.causeIsPlanned,
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          <span className="text-sm font-medium">{t('dlive.openEvents', { count: events.length })}</span>
        </div>
        <Button size="sm" onClick={() => { setCreateOpen(true); setApiError(null); }}>
          <Plus size={13} className="me-1.5" />{t('dlive.logDowntime')}
        </Button>
      </div>

      {/* Create form */}
      <AnimatePresence>
        {createOpen && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.18 }}>
            <div className="border rounded-2xl bg-card shadow-lg overflow-hidden">
              {/* Form header */}
              <div className="flex items-center justify-between px-5 py-3.5 border-b bg-muted/20">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-red-500/15 flex items-center justify-center">
                    <AlertTriangle size={14} className="text-red-400" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold">{t('dlive.formTitle')}</p>
                    <p className="text-[11px] text-muted-foreground">{t('dlive.formSubtitle')}</p>
                  </div>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setCreateOpen(false); resetForm(); }}>
                  <X size={14} />
                </Button>
              </div>

              <div className="p-5 flex flex-col gap-5">
                {/* Error banner */}
                {apiError && (
                  <div className="flex items-start gap-2.5 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
                    <AlertCircle size={15} className="mt-0.5 shrink-0" />
                    <span>{apiError}</span>
                  </div>
                )}

                {/* Row 1: Machine + Reason Code */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium flex items-center gap-1.5">
                      {t('dlive.machine')} *
                      {machineLocked && (
                        <Badge variant="outline" className="text-[9px] h-4 text-blue-400 border-blue-400/30 font-normal">
                          <Lock size={8} className="me-0.5" />{t('dlive.autoSelected')}
                        </Badge>
                      )}
                    </Label>
                    <MachinePicker
                      value={form.machineId || null}
                      onChange={id => { if (!machineLocked) setForm(p => ({ ...p, machineId: id ?? '', causeId: '' })); }}
                      placeholder={t('dlive.selectMachine')}
                      disabled={machineLocked}
                      className={cn('h-10', machineLocked && 'opacity-70 cursor-not-allowed')}
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium">{t('dlive.reasonCode')}</Label>
                    <Select value={form.reasonCode} onValueChange={v => setForm(p => ({ ...p, reasonCode: v as DowntimeReasonCode }))}>
                      <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(REASON_CODE_CFG).map(([k, v]) => {
                          const Icon = v.icon;
                          return (
                            <SelectItem key={k} value={k}>
                              <div className="flex items-center gap-2">
                                <Icon size={12} className={v.color} />
                                <span>{t(`event.reasonCfg.${k}`)}</span>
                              </div>
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Row 2: Specific Cause tree picker (full width) */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium">{t('dlive.specificCause')}</Label>
                    <span className="text-[10px] text-muted-foreground">{t('dlive.causePath')}</span>
                  </div>
                  <CauseTreeSelect
                    reasonTree={reasonTree}
                    value={form.causeId}
                    machineId={form.machineId || undefined}
                    onChange={handleCauseChange}
                  />
                  {form.causeId && (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <Tag size={10} className="text-muted-foreground" />
                      <span className="text-[10px] text-muted-foreground">{t('dlive.categoryAutoSet')}</span>
                      <Badge variant="outline" className="text-[10px] h-4">{t(`dtree.cat.${form.causeCategory}`)}</Badge>
                      {form.causeIsPlanned && <Badge variant="outline" className="text-[10px] h-4 text-blue-400 border-blue-500/30">{t('dlive.plannedStop')}</Badge>}
                    </div>
                  )}
                </div>

                {/* Row 3: Start Time */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium">{t('dlive.startTime')}</Label>
                  <Input
                    type="datetime-local"
                    value={form.startTime}
                    onChange={e => setForm(p => ({ ...p, startTime: e.target.value }))}
                    className="h-10 text-sm"
                  />
                </div>

                {/* Row 4: Notes */}
                <div className="flex flex-col gap-1.5">
                  <Label className="text-xs font-medium">
                    <AlignLeft size={12} className="inline me-1 text-muted-foreground" />
                    {t('dlive.additionalNotes')}
                  </Label>
                  <Input
                    value={form.reason}
                    onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                    placeholder={t('dlive.notesPlaceholder')}
                    className="h-10"
                  />
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between px-5 py-3.5 border-t bg-muted/10">
                <p className="text-[11px] text-muted-foreground">
                  {t('dlive.footerHint')}
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setCreateOpen(false); resetForm(); }}>{t('dlive.cancel')}</Button>
                  <Button
                    size="sm"
                    disabled={!form.machineId || createMut.isPending}
                    onClick={handleSubmit}
                    className="min-w-[100px]"
                  >
                    {createMut.isPending ? (
                      <span className="flex items-center gap-1.5"><RefreshCw size={12} className="animate-spin" />{t('dlive.logging')}</span>
                    ) : (
                      <span className="flex items-center gap-1.5"><Plus size={12} />{t('dlive.logEvent')}</span>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {isLoading ? (
        <div className="text-sm text-muted-foreground p-10 text-center">{t('dlive.loading')}</div>
      ) : events.length === 0 ? (
        <div className="border rounded-xl p-12 text-center text-sm text-muted-foreground">
          <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-400 opacity-60" />
          {t('dlive.noEvents')}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr className="text-muted-foreground text-[11px]">
                <th className="w-6" />
                {[t('dlive.col.reasonCode'), t('dlive.col.cause'), t('dlive.col.machine'), t('dlive.col.workCenter'), t('dlive.col.start'), t('dlive.col.duration'), t('dlive.col.oeeImpact'), t('dlive.col.actions')].map(h => (
                  <th key={h} className="px-2 py-2 text-start font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {events.map(ev => (
                <EventRow key={ev.id} event={ev} liveMode
                  onClose={() => setCloseTarget(ev)}
                  onEdit={() => setEditTarget(ev)}
                  onAck={() => ackMut.mutate(ev.id)}
                  onDelete={() => setDeleteTarget(ev)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit modal */}
      <AnimatePresence>
        {editTarget && (
          <EditEventModal
            event={editTarget}
            reasonTree={reasonTree as ReasonNode[]}
            machines={machines}
            onClose={() => setEditTarget(null)}
            onSave={dto => editMut.mutate({ id: editTarget.id, dto })}
            isPending={editMut.isPending}
          />
        )}
      </AnimatePresence>

      {/* Close dialog */}
      <AnimatePresence>
        {closeTarget && (
          <CloseEventDialog
            event={closeTarget}
            onCancel={() => setCloseTarget(null)}
            onClose={resolution => closeMut.mutate({ id: closeTarget.id, resolution })}
            isPending={closeMut.isPending}
          />
        )}
      </AnimatePresence>

      {/* Delete confirmation dialog */}
      <AnimatePresence>
        {deleteTarget && (
          <DeleteEventDialog
            event={deleteTarget}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => deleteMut.mutate(deleteTarget.id)}
            isPending={deleteMut.isPending}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// HISTORY TAB
// ═══════════════════════════════════════════════════════════════════════════

function HistoryTab({ machines }: { machines: Machine[] }) {
  const { t } = useTranslation(['production', 'common']);
  const [filters, setFilters] = useState({ machineId: '', dateFrom: '', dateTo: '', search: '' });
  const [page, setPage] = useState(1);
  const LIMIT = 30;

  const [sortCol, setSortCol] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const handleSort = useCallback((col: string) => {
    if (col === sortCol) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
  }, [sortCol]);

  const { data, isLoading } = useQuery({
    queryKey: ['downtime-history', filters, page, sortCol, sortDir],
    queryFn: () => {
      const p = new URLSearchParams({ isOpen: 'false', limit: String(LIMIT), page: String(page), sortBy: sortCol, sortOrder: sortDir });
      if (filters.machineId) p.set('machineId', filters.machineId);
      if (filters.dateFrom) p.set('dateFrom', filters.dateFrom);
      if (filters.dateTo) p.set('dateTo', filters.dateTo);
      return api.get(`/production/downtime/events?${p}`);
    },
  });

  const events: DowntimeEvent[] = (data as any)?.data ?? (Array.isArray(data) ? data : []);
  const total: number = (data as any)?.total ?? events.length;

  const { sortedData } = useSortedData(events, 'createdAt', 'desc');

  const filtered = filters.search
    ? sortedData.filter(e => e.machine?.name.toLowerCase().includes(filters.search.toLowerCase())
        || e.cause?.name.toLowerCase().includes(filters.search.toLowerCase())
        || e.reason?.toLowerCase().includes(filters.search.toLowerCase()))
    : sortedData;

  useEffect(() => { setPage(1); }, [sortCol, sortDir]);
  useEffect(() => { setPage(1); }, [filters.search, filters.machineId, filters.dateFrom, filters.dateTo]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-52">
          <Search size={12} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t('downtime.search')} value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} className="ps-7 h-8 text-xs" />
        </div>
        <Select value={filters.machineId || '__all__'} onValueChange={v => setFilters(p => ({ ...p, machineId: v === '__all__' ? '' : v }))}>
          <SelectTrigger className="h-8 text-xs w-40"><SelectValue placeholder={t('downtime.allMachines')} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__all__">{t('downtime.allMachines')}</SelectItem>
            {machines.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Calendar size={12} className="text-muted-foreground" />
          <Input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} className="h-8 text-xs w-36" />
          <span className="text-muted-foreground text-xs">—</span>
          <Input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} className="h-8 text-xs w-36" />
        </div>
        <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setFilters({ machineId: '', dateFrom: '', dateTo: '', search: '' }); setPage(1); }}>
          <X size={12} className="mr-1" />{t('downtime.clear')}
        </Button>
        <span className="ml-auto text-xs text-muted-foreground">{t('downtime.recordsCount', { count: total })}</span>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground p-10 text-center">{t('downtime.loadingHistory')}</div>
      ) : filtered.length === 0 ? (
        <div className="border rounded-xl p-12 text-center text-sm text-muted-foreground">{t('downtime.noRecords')}</div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-xs">
            <thead className="bg-muted/30">
              <tr className="text-muted-foreground text-[11px]">
                <th className="w-6" />
                <SortableHeader column="reasonCode" label={t('downtime.col.reasonCode')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="reason" label={t('downtime.col.cause')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="machine" label={t('downtime.col.machine')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th className="px-2 py-2 text-start font-medium">{t('downtime.col.workCenter')}</th>
                <SortableHeader column="startTime" label={t('downtime.col.startEnd')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="durationMinutes" label={t('downtime.col.duration')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th className="px-2 py-2 text-start font-medium">{t('downtime.col.oeeImpact')}</th>
                <th className="px-2 py-2 text-start font-medium">{t('downtime.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(ev => <EventRow key={ev.id} event={ev} />)}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      <TablePagination page={page} total={total} limit={LIMIT} onPageChange={setPage} isLoading={isLoading} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB
// ═══════════════════════════════════════════════════════════════════════════

function AnalyticsTab() {
  const { t } = useTranslation(['production', 'common']);
  const { filter, key } = useScope();
  const [range, setRange] = useState({ from: toFactoryDayKey(Date.now() - 7 * 86400_000), to: toFactoryDayKey(new Date()) });

  const { data: summary, isLoading } = useQuery({
    queryKey: ['downtime-summary', range, key],
    queryFn: () => api.get('/production/downtime/summary', { params: { dateFrom: range.from, dateTo: range.to, ...filter } }),
  });

  const sum = summary as any;

  const byMachineData = sum?.byMachine
    ? Object.entries(sum.byMachine as Record<string, number>).map(([name, mins]) => ({ name, mins: Math.round(mins as number) }))
    : [];

  const byCategoryData = sum?.byCategory
    ? Object.entries(sum.byCategory as Record<string, number>).map(([cat, mins]) => ({ name: cat, mins: Math.round(mins as number) })).sort((a, b) => b.mins - a.mins)
    : [];

  const paretoData = sum?.topCauses
    ? (sum.topCauses as [string, number][]).map(([cause, mins]) => ({ name: cause, mins: Math.round(mins) }))
    : [];

  const CHART_COLORS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6'];

  if (isLoading) return <div className="text-sm text-muted-foreground p-10 text-center">{t('danalytics.loading')}</div>;

  return (
    <div className="flex flex-col gap-6">
      {/* Range picker */}
      <div className="flex items-center gap-3">
        <Calendar size={14} className="text-muted-foreground" />
        <Input type="date" value={range.from} onChange={e => setRange(p => ({ ...p, from: e.target.value }))} className="h-8 text-xs w-36" />
        <span className="text-muted-foreground text-xs">—</span>
        <Input type="date" value={range.to} onChange={e => setRange(p => ({ ...p, to: e.target.value }))} className="h-8 text-xs w-36" />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { labelKey: 'danalytics.kpi.totalEvents',   value: sum?.totalEvents ?? 0,         subKey: 'danalytics.kpi.events',    color: 'text-foreground' },
          { labelKey: 'danalytics.kpi.totalDowntime', value: fmtDur(sum?.totalMinutes),     subKey: 'danalytics.kpi.duration',  color: 'text-red-400' },
          { labelKey: 'danalytics.kpi.oeeImpact',     value: fmtDur(sum?.oeeImpactMinutes), subKey: 'danalytics.kpi.availLoss', color: 'text-orange-400' },
          { labelKey: 'danalytics.kpi.plannedStops',  value: fmtDur(sum?.plannedMinutes),   subKey: 'danalytics.kpi.planned',   color: 'text-blue-400' },
        ].map(k => (
          <div key={k.labelKey} className="border rounded-xl p-4 bg-card">
            <p className="text-xs text-muted-foreground">{t(k.labelKey)}</p>
            <p className={cn('text-2xl font-bold mt-1', k.color)}>{k.value}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t(k.subKey)}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Downtime by Machine */}
        <div className="border rounded-xl p-4">
          <p className="text-sm font-semibold mb-3">{t('danalytics.byMachine')}</p>
          {byMachineData.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">{t('danalytics.noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byMachineData} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={80} />
                <Tooltip formatter={(v: number) => [t('danalytics.minSuffix', { count: v })]} contentStyle={{ fontSize: 11, background: '#0f1117', border: '1px solid #1e2030' }} />
                <Bar dataKey="mins" radius={3}>
                  {byMachineData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Downtime by Category (Pareto) */}
        <div className="border rounded-xl p-4">
          <p className="text-sm font-semibold mb-3">{t('danalytics.byCategoryPareto')}</p>
          {byCategoryData.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">{t('danalytics.noData')}</p>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={byCategoryData} margin={{ left: 8, right: 16, top: 4, bottom: 40 }}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" interval={0} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => [t('danalytics.minSuffix', { count: v })]} contentStyle={{ fontSize: 11, background: '#0f1117', border: '1px solid #1e2030' }} />
                <Bar dataKey="mins" radius={3}>
                  {byCategoryData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Top 5 Causes */}
      {paretoData.length > 0 && (
        <div className="border rounded-xl p-4">
          <p className="text-sm font-semibold mb-3">{t('danalytics.topCauses')}</p>
          <div className="flex flex-col gap-2">
            {paretoData.map((item, i) => {
              const maxMins = paretoData[0]?.mins ?? 1;
              const pct = Math.round((item.mins / maxMins) * 100);
              return (
                <div key={i} className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-4 shrink-0">{i + 1}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between text-xs mb-0.5">
                      <span>{item.name}</span>
                      <span className="font-mono text-muted-foreground">{t('danalytics.minSuffix', { count: item.mins })}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: CHART_COLORS[i] }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ROOT VIEW
// ═══════════════════════════════════════════════════════════════════════════

export function ProductionDowntimeView() {
  const { t } = useTranslation(['production', 'common']);
  const [tab, setTab] = useState<Tab>('live');

  const { data: machinesData } = useQuery({
    queryKey: ['machines-list'],
    queryFn: () => api.get('/hierarchy/machines?limit=50'),
    staleTime: 60_000,
  });

  const { data: reasonTree = [] } = useQuery<ReasonNode[]>({
    queryKey: ['downtime-reason-tree'],
    queryFn: () => api.get('/production/downtime/reasons/tree'),
    staleTime: 60_000,
  });

  const machines: Machine[] = (machinesData as any)?.data ?? (Array.isArray(machinesData) ? machinesData : []);

  const TABS: { id: Tab; labelKey: string; icon: React.ElementType }[] = [
    { id: 'live',      labelKey: 'dtabs.live',      icon: AlertTriangle },
    { id: 'history',   labelKey: 'dtabs.history',   icon: ListFilter },
    { id: 'planned',   labelKey: 'dtabs.planned',   icon: CalendarClock },
    { id: 'tree',      labelKey: 'dtabs.tree',      icon: Network },
    { id: 'analytics', labelKey: 'dtabs.analytics', icon: BarChart3 },
  ];

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2"><h1 className="text-xl font-bold">{t('headers.downtime.title')}</h1><DashboardInfo id="production-downtime" /><DataModeBadge mode="period" /></div>
        <p className="text-sm text-muted-foreground mt-0.5">
          {t('headers.downtime.subtitle')}
        </p>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
        <Info size={14} className="mt-0.5 text-primary shrink-0" />
        <span>
          {t('dinfo.thresholdPre')}<strong className="text-foreground">{t('dinfo.thresholdValue')}</strong>{t('dinfo.thresholdMid')}<strong className="text-foreground">{t('dinfo.plannedMaintenance')}</strong>{t('dinfo.andExternal')}<strong className="text-foreground">{t('dinfo.external')}</strong>{t('dinfo.stopsMid')}<strong className="text-foreground">{t('dinfo.reasonTree')}</strong>{t('dinfo.tabPost')}
        </span>
      </div>

      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b pb-0">
        {TABS.map(tabItem => {
          const Icon = tabItem.icon;
          return (
            <button
              key={tabItem.id}
              onClick={() => setTab(tabItem.id)}
              className={cn(
                'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
                tab === tabItem.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon size={14} />
              {t(tabItem.labelKey)}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
          {tab === 'live'      && <LiveTab machines={machines} reasonTree={reasonTree as ReasonNode[]} />}
          {tab === 'history'   && <HistoryTab machines={machines} />}
          {tab === 'planned'   && <PlannedDowntimeManager />}
          {tab === 'tree'      && <TreeTab machines={machines} />}
          {tab === 'analytics' && <AnalyticsTab />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
