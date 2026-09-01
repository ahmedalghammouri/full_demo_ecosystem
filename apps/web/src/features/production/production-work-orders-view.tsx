'use client';
import { useTranslation } from 'react-i18next';
import { dateTimeLocalToIso, toDateTimeLocal, formatDateTimeWithZone } from '@/lib/datetime';

import React, { useState, useMemo } from 'react';
import {
  Plus, Download, Filter, Search, Play, Pause,
  CheckCircle, Pencil, Trash2, XCircle, ChevronDown,
  Factory, Cpu, User, Clock, BarChart3, Package,
  ClipboardCheck, CheckCircle2, AlertCircle, Layers,
  CheckSquare, Circle, GitBranch, Zap, ZapOff,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { useScope } from '@/hooks/use-scope';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { FormDialog } from '@/components/ui/form-dialog';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { TableRowActions } from '@/components/ui/table-row-actions';
import { api } from '@/services/api.client';
import { cn, formatDate, formatPercent } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { autoStartState, type AutoState } from './auto-start-state';

const STATUS_COLORS: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  PLANNED: 'secondary', RELEASED: 'secondary', IN_PROGRESS: 'default',
  COMPLETED: 'default', ON_HOLD: 'outline', CANCELLED: 'destructive',
};
const STATUS_LABELS: Record<string, string> = {
  PLANNED: 'Planned', RELEASED: 'Released', IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed', ON_HOLD: 'On Hold', CANCELLED: 'Cancelled',
};
/**
 * Quantities are grouped, never raw. A packaging line's figures run to six digits —
 * "24000" and "240000" are one glance apart on a dense card, and the screenshots that
 * prompted this fix showed exactly that ambiguity. Fractions are dropped: a count of
 * physical units has no meaningful decimal.
 */
const fmtQty = (n: number | null | undefined) => Math.round(n ?? 0).toLocaleString();

const PRIORITY_CLS: Record<string, string> = {
  CRITICAL: 'border-red-500 text-red-400', HIGH: 'border-orange-500 text-orange-400',
  MEDIUM: 'border-yellow-500 text-yellow-400', LOW: 'border-slate-500 text-slate-400',
};

interface WorkOrder {
  id: string; orderNumber: string; status: string; priority: string;
  productName: string; productCode: string;
  // A WO spans every machine in its routing — derived from its job-order steps.
  machine: string; machineCode: string; machines?: { id: string; name: string; code: string }[];
  line: string; operator: string; supervisor: string;
  plannedQty: number; actualQty: number; goodQty: number; scrapQty: number; reworkQty?: number;
  progress: number; oee?: number; availability?: number; performance?: number; quality?: number;
  plannedStart: string; plannedEnd: string; actualStart?: string; actualEnd?: string;
  /** Armed to start itself when its planned time arrives. */
  autoStart?: boolean;
  /** Which line it would contend for — two lines can share a name. */
  lineId?: string | null;
  materialStatus?: 'OK' | 'AWAITING_MATERIALS' | 'SCHEDULED_FOR_DELIVERY'; materialReadyDate?: string | null;
}

/**
 * The auto-start indicator: state, and a click to arm or disarm.
 *
 * Colour is never the only signal — each state carries its own icon and a title
 * that says what will happen next, because "is this going to start itself" is a
 * question an operator asks at a glance and must not have to decode.
 *
 * `held` and `stale` pulse. Nothing else does: a row that draws attention when
 * nothing is wrong teaches people to ignore it.
 */
function AutoStartPill({
  state, pending, onToggle,
}: { state: AutoState; pending: boolean; onToggle: () => void }) {
  const look: Record<AutoState, { cls: string; icon: React.ReactNode; title: string }> = {
    off:   { cls: 'text-muted-foreground/40 hover:text-muted-foreground',
             icon: <ZapOff size={14} />, title: 'Auto-start off — click to arm' },
    armed: { cls: 'text-primary/70 hover:text-primary',
             icon: <Zap size={14} />, title: 'Auto-start armed — will start at its planned time' },
    soon:  { cls: 'text-primary',
             icon: <Zap size={14} />, title: 'Auto-start due shortly — the line is free' },
    held:  { cls: 'text-amber-500 animate-pulse',
             icon: <Zap size={14} />, title: 'Due, but another order is running on this line — auto-start is holding it back' },
    stale: { cls: 'text-red-500 animate-pulse',
             icon: <ZapOff size={14} />, title: 'Overdue past the auto-start window — it will NOT start on its own' },
  };
  const v = look[state];
  return (
    <button
      type="button"
      disabled={pending}
      onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={v.title}
      aria-label={v.title}
      className={cn('inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors disabled:opacity-40', v.cls)}
    >
      {v.icon}
    </button>
  );
}

interface WorkOrderDetail extends WorkOrder {
  sku?: { name: string; code: string; itemNumber?: string };
  machine_obj?: { name: string; code: string; area?: { name: string }; line?: { name: string } };
  operator_obj?: { name: string; email: string };
  supervisor_obj?: { name: string; email: string };
  productionOrder?: { orderNumber: string; sapOrderNumber?: string };
  batchRecords?: { id: string; batchNumber: string; status: string }[];
  downtimeMinutes?: number; notes?: string;
}

const EMPTY_FORM = {
  skuId: '__none__', operatorId: '__none__',
  plannedQty: '', plannedStart: '', plannedEnd: '', priority: 'MEDIUM', notes: '',
  autoStart: false,
};

/** ISO → value for a <input type="datetime-local"> (local timezone). */
function toLocalDatetime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function MetricCard({ label, value, color }: { label: string; value: string | number; color?: string }) {
  return (
    <div className="industrial-card rounded-lg p-3 text-center">
      <div className={cn('text-xl font-bold tabular-nums', color)}>{value}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-2 border-b border-border/20 last:border-0">
      <span className="text-[11px] text-muted-foreground w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs font-medium flex-1">{value ?? <span className="text-muted-foreground">—</span>}</span>
    </div>
  );
}

const INSP_RESULT: Record<string, { labelKey: string; cls: string; Icon: any }> = {
  PASS:        { labelKey: 'wo.insp.pass',        cls: 'text-green-400', Icon: CheckCircle2 },
  FAIL:        { labelKey: 'wo.insp.fail',        cls: 'text-red-400',   Icon: XCircle      },
  CONDITIONAL: { labelKey: 'wo.insp.conditional', cls: 'text-amber-400', Icon: AlertCircle  },
};

function WorkOrderQualityPanel({ workOrderId, machineId }: { workOrderId: string; machineId?: string }) {
  const { t } = useTranslation(['production', 'common']);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [addForm, setAddForm] = useState({ type: 'IN_PROCESS', planId: '__none__', totalQty: '', passQty: '', notes: '' });

  const { data, isLoading } = useQuery({
    queryKey: ['quality', 'wo-inspections', workOrderId],
    queryFn: () => api.get(`/quality/work-orders/${workOrderId}/inspections`),
    staleTime: 30_000,
  });

  const { data: plansData } = useQuery({
    queryKey: ['quality', 'plans', 'selector'],
    queryFn: () => api.get('/quality/plans', { params: { isActive: 'true', limit: 100 } }),
    staleTime: 300_000,
    enabled: addOpen || !!editId,
  });

  const resetForm = () => {
    setAddOpen(false);
    setEditId(null);
    setAddForm({ type: 'IN_PROCESS', planId: '__none__', totalQty: '', passQty: '', notes: '' });
  };

  const createInspMutation = useMutation({
    mutationFn: (dto: any) => api.post('/quality/inspections', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'wo-inspections', workOrderId] });
      toast({ title: t('wo.toast.inspRecorded') });
      resetForm();
    },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message ?? t('wo.toast.inspSaveFailed'), variant: 'destructive' }),
  });

  const updateInspMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/quality/inspections/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality', 'wo-inspections', workOrderId] });
      toast({ title: t('wo.toast.inspUpdated') });
      resetForm();
    },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message ?? t('wo.toast.inspUpdateFailed'), variant: 'destructive' }),
  });

  const plans: any[] = (plansData as any) ?? [];
  const inspections: any[] = (data as any) ?? [];
  const passCount = inspections.filter(i => i.result === 'PASS').length;
  const failCount = inspections.filter(i => i.result === 'FAIL').length;
  const overallPass = inspections.length > 0 && failCount === 0;

  const totalNum = parseInt(addForm.totalQty || '0', 10);
  const passNum = parseInt(addForm.passQty || '0', 10);
  const failNum = Math.max(0, totalNum - passNum);
  const passRate = totalNum > 0 ? Math.round((passNum / totalNum) * 100) : 0;
  const predictedResult = passRate >= 95 ? 'PASS' : passRate >= 80 ? 'CONDITIONAL' : 'FAIL';
  const resultCls = predictedResult === 'PASS' ? 'text-green-400' : predictedResult === 'CONDITIONAL' ? 'text-amber-400' : 'text-red-400';
  const isAddValid = totalNum > 0 && passNum >= 0 && passNum <= totalNum;
  const isSaving = createInspMutation.isPending || updateInspMutation.isPending;

  const handleOpenEditInsp = (ins: any) => {
    setEditId(ins.id);
    setAddOpen(false);
    setAddForm({
      type: ins.type ?? 'IN_PROCESS',
      planId: ins.planId ?? ins.plan?.id ?? '__none__',
      totalQty: String(ins.totalQty ?? ''),
      passQty: String(ins.passQty ?? ''),
      notes: ins.notes ?? '',
    });
  };

  const handleAddInsp = () => {
    if (!isAddValid) return;
    if (editId) {
      const dto: any = {
        type: addForm.type,
        totalQty: totalNum,
        passQty: passNum,
        failQty: failNum,
        notes: addForm.notes || undefined,
      };
      if (addForm.planId !== '__none__') dto.planId = addForm.planId;
      updateInspMutation.mutate({ id: editId, dto });
      return;
    }
    const dto: any = {
      type: addForm.type,
      workOrderId,
      totalQty: totalNum,
      passQty: passNum,
      failQty: failNum,
      notes: addForm.notes || undefined,
    };
    if (machineId) dto.machineId = machineId;
    if (addForm.planId !== '__none__') dto.planId = addForm.planId;
    createInspMutation.mutate(dto);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          <ClipboardCheck size={12} className="text-primary" />
          {t('wo.qualityInspections')}
        </p>
        <div className="flex items-center gap-2">
          {inspections.length > 0 && (
            <Badge
              variant="outline"
              className={cn('text-[10px] h-4', overallPass ? 'text-green-400 border-green-500/30' : failCount > 0 ? 'text-red-400 border-red-500/30' : 'text-amber-400 border-amber-500/30')}
            >
              {passCount}/{inspections.length} {t('wo.insp.pass')}
            </Badge>
          )}
          <Button size="sm" variant="outline" className="h-5 text-[10px] px-2 gap-1" onClick={() => setAddOpen(true)}>
            <Plus size={10} />{t('wo.add')}
          </Button>
        </div>
      </div>
      {isLoading ? (
        <div className="shimmer h-10 rounded-lg" />
      ) : inspections.length === 0 ? (
        <div className="industrial-card rounded-lg px-3 py-2 text-xs text-muted-foreground text-center">
          {t('wo.noInspections')}{' '}
          <button className="text-primary underline underline-offset-2" onClick={() => setAddOpen(true)}>{t('wo.addOne')}</button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {inspections.map((ins: any) => {
            const r = INSP_RESULT[ins.result] ?? INSP_RESULT.CONDITIONAL;
            const RIcon = r.Icon;
            return (
              <div key={ins.id} className="industrial-card rounded-lg px-3 py-2 flex items-center gap-3">
                <RIcon size={13} className={r.cls} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-primary">{ins.inspectionNumber}</span>
                    <Badge variant="outline" className="text-[9px] h-4">{ins.type}</Badge>
                    {ins.plan && <span className="text-[10px] text-muted-foreground truncate">{ins.plan.name}</span>}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {t('wo.insp.pass')}: {ins.passQty} · {t('wo.insp.fail')}: {ins.failQty} · {t('wo.insp.total')}: {ins.totalQty}
                    {ins.inspector && ` · ${ins.inspector.name}`}
                  </div>
                </div>
                <span className={cn('text-[10px] font-semibold', r.cls)}>{t(r.labelKey)}</span>
                <Button
                  variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                  title={t('wo.editInspection')}
                  onClick={() => handleOpenEditInsp(ins)}
                >
                  <Pencil size={11} />
                </Button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Add / Edit Inspection — inline form ── */}
      <InlineFormPanel
        open={addOpen || !!editId}
        onClose={resetForm}
        icon={ClipboardCheck}
        title={editId ? t('wo.editInspTitle') : t('wo.addInspTitle')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={resetForm}>{t('common:actions.cancel')}</Button>
            <Button size="sm" disabled={!isAddValid || isSaving} onClick={handleAddInsp}>
              {isSaving ? t('bform.saving') : editId ? t('bform.saveChanges') : t('wo.recordInspection')}
            </Button>
          </>
        )}
      >
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t('wo.inspectionType')} *</Label>
              <Select value={addForm.type} onValueChange={v => setAddForm(f => ({ ...f, type: v }))}>
                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {['INCOMING', 'IN_PROCESS', 'FINAL', 'PATROL', 'AUDIT'].map(tp => (
                    <SelectItem key={tp} value={tp}>{tp.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('wo.qualityPlan')} <span className="text-muted-foreground">({t('wo.optional')})</span></Label>
              <EntityPicker
                items={plans}
                value={addForm.planId === '__none__' ? null : addForm.planId}
                onChange={id => setAddForm(f => ({ ...f, planId: id ?? '__none__' }))}
                getId={(p: any) => p.id}
                getPrimary={(p: any) => p.name}
                getSecondary={(p: any) => p.code}
                placeholder={t('wo.selectPlan')}
                searchPlaceholder={t('wo.searchPlans')}
                size="sm"
                className="mt-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t('wo.totalQtyInspected')} *</Label>
                <Input
                  type="number" min={1}
                  value={addForm.totalQty}
                  onChange={e => setAddForm(f => ({ ...f, totalQty: e.target.value }))}
                  className="mt-1 h-8 text-xs"
                  placeholder={t('wo.eg10')}
                />
              </div>
              <div>
                <Label className="text-xs">{t('wo.passedQty')} *</Label>
                <Input
                  type="number" min={0}
                  value={addForm.passQty}
                  onChange={e => setAddForm(f => ({ ...f, passQty: e.target.value }))}
                  className="mt-1 h-8 text-xs"
                  placeholder={t('wo.eg9')}
                />
              </div>
            </div>
            {addForm.totalQty && addForm.passQty && (
              <div className="industrial-card rounded-md px-3 py-2 text-[10px] flex items-center gap-3">
                <span className="text-muted-foreground">{t('wo.failed')}: <span className="font-semibold text-foreground">{failNum}</span></span>
                <span className="text-muted-foreground">{t('wo.passRate')}: <span className="font-semibold text-foreground">{passRate}%</span></span>
                <span className="text-muted-foreground">→ {t('wo.result')}: <span className={cn('font-bold', resultCls)}>{predictedResult}</span></span>
              </div>
            )}
            <div>
              <Label className="text-xs">{t('wform.notes')}</Label>
              <Input
                value={addForm.notes}
                onChange={e => setAddForm(f => ({ ...f, notes: e.target.value }))}
                placeholder={t('wform.optionalNotes')}
                className="mt-1 h-8 text-xs"
              />
            </div>
          </div>
      </InlineFormPanel>
    </div>
  );
}

export function ProductionWorkOrdersView() {
  const { t } = useTranslation(['production', 'common']);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [archived, setArchived] = useState<ArchiveScope>('active');
  const [viewId, setViewId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editWO, setEditWO] = useState<WorkOrder | null>(null);
  const [editForm, setEditForm] = useState({ plannedQty: '', priority: 'MEDIUM', notes: '' });
  const [form, setForm] = useState(EMPTY_FORM);
  const [holdDialog, setHoldDialog] = useState<{ woId: string; orderNumber: string } | null>(null);
  const [holdReason, setHoldReason] = useState('');
  const [completeDialog, setCompleteDialog] = useState<{ woId: string; orderNumber: string; plannedQty: number } | null>(null);
  const [completeForm, setCompleteForm] = useState({ actualQty: '', goodQty: '' });
  const [cancelDialog, setCancelDialog] = useState<{ woId: string; orderNumber: string } | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; orderNumber: string } | null>(null);
  // Per-routing-step operator pre-assignment for the create form (stepId → operatorId)
  const [assignments, setAssignments] = useState<Record<string, string>>({});

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { archive: archiveWO, restore: restoreWO, bulkArchive, bulkRestore } = useArchive('work-orders', [['production', 'work-orders']], 'Work order');
  const { filter: scopeFilter, key: scopeKey } = useScope();

  const [sortCol, setSortCol] = useState('createdAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const handleSort = (col: string) => {
    if (col === sortCol) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('desc');
    }
    setPage(1);
  };

  const { data: workOrdersData, isLoading } = useQuery({
    queryKey: ['production', 'work-orders', { search, status: statusFilter, archived, page, sortCol, sortDir, scope: scopeKey }],
    queryFn: () => api.get('/production/work-orders', {
      params: { search: search || undefined, status: statusFilter || undefined, archived: archived !== 'active' ? archived : undefined, limit: 20, page, sortBy: sortCol, sortOrder: sortDir, ...scopeFilter },
    }),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  const orders: WorkOrder[] = (workOrdersData as any)?.data ?? [];

  /**
   * A clock for the auto-start indicator, ticking every half minute.
   *
   * Null until after mount, and never read during render on the server: the
   * pill's state depends on "now", and a value the server computed would differ
   * from the browser's and hydrate as a mismatch. Every row simply reads as
   * armed for the first tick, which is the honest thing to show before the
   * page knows what time it is.
   */
  const [nowMs, setNowMs] = React.useState(0);
  React.useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  const total: number = (workOrdersData as any)?.total ?? 0;

  // ── Smart preview for the Create form (same intelligence as Auto-Generate):
  // resolves the routing, computes the realistic finish + material shortages. ──
  const previewFrom = dateTimeLocalToIso(form.plannedStart);
  const { data: woPreview, isFetching: previewLoading } = useQuery({
    queryKey: ['wo-create-preview', form.skuId, form.plannedQty, previewFrom],
    queryFn: () => api.get('/production/work-orders/preview', { params: { skuId: form.skuId, qty: form.plannedQty, from: previewFrom } }),
    enabled: formOpen && form.skuId !== '__none__' && !!form.plannedQty && parseInt(form.plannedQty, 10) > 0,
    staleTime: 0,
  });
  const prev = woPreview as any;
  // Auto-fill the planned end with the computed smart finish (until the user edits it).
  const smartFinish: string | undefined = prev?.smart?.computedFinish;
  React.useEffect(() => {
    if (smartFinish && formOpen) {
      const local = toLocalDatetime(smartFinish);
      setForm(f => (f.plannedEnd === local ? f : { ...f, plannedEnd: local }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [smartFinish, formOpen]);

  const { sortedData: sortedOrders } = useSortedData(orders, 'createdAt', 'desc');
  const sel = useRowSelection(sortedOrders);

  const { data: woDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['production', 'work-orders', viewId],
    queryFn: () => api.get(`/production/work-orders/${viewId}`),
    enabled: !!viewId,
    staleTime: 15_000,
    refetchInterval: viewId ? 15_000 : false,
  });
  const detail = woDetail as WorkOrderDetail | undefined;

  const { data: skusData } = useQuery({
    queryKey: ['inventory', 'products', 'wo-form'],
    queryFn: () => api.get('/inventory/products', { params: { limit: 200 } }),
    staleTime: 300_000, enabled: formOpen,
  });
  const { data: usersData } = useQuery({
    queryKey: ['users', 'wo-form'],
    queryFn: () => api.get('/users', { params: { limit: 100 } }),
    staleTime: 300_000, enabled: formOpen,
  });

  const skus: any[] = (skusData as any)?.data ?? (skusData as any) ?? [];
  const users: any[] = (usersData as any)?.data ?? (usersData as any) ?? [];

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/production/work-orders', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['production', 'kpis'] });
      queryClient.invalidateQueries({ queryKey: ['production-orders'] });
      toast({ title: t('wo.toast.created') });
      setFormOpen(false); setForm(EMPTY_FORM); setAssignments({});
    },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message ?? t('wo.toast.createFailed'), variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/production/work-orders/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      toast({ title: t('wo.toast.updated') }); setEditWO(null);
    },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const startMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/production/work-orders/${id}/start`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['production', 'work-orders'] }); toast({ title: t('wo.toast.started') }); },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const releaseMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/production/work-orders/${id}/release`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['production', 'work-orders'] }); toast({ title: t('wo.toast.resumed') }); },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const holdMutation = useMutation({
    mutationFn: ({ woId, reason }: { woId: string; reason: string }) => api.patch(`/production/work-orders/${woId}/hold`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      setHoldDialog(null); setHoldReason(''); toast({ title: t('wo.toast.held') });
    },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const completeMutation = useMutation({
    mutationFn: ({ woId, dto }: { woId: string; dto: any }) => api.patch(`/production/work-orders/${woId}/complete`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      setCompleteDialog(null); setCompleteForm({ actualQty: '', goodQty: '' });
      toast({ title: t('wo.toast.completed') });
    },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ woId, reason }: { woId: string; reason: string }) => api.patch(`/production/work-orders/${woId}/cancel`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      setCancelDialog(null); setCancelReason(''); toast({ title: t('wo.toast.cancelled') });
    },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/production/work-orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', 'work-orders'] });
      toast({ title: t('wo.toast.deleted') }); setDeleteDialog(null);
    },
    onError: (e: any) => toast({ title: t('wo.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const handleCreate = () => {
    if (form.skuId === '__none__' || !form.plannedQty) return;
    const assignmentList = Object.entries(assignments)
      .filter(([, op]) => op && op !== '__none__')
      .map(([stepId, operatorId]) => ({ stepId, operatorId }));
    createMutation.mutate({
      skuId: form.skuId,
      operatorId: form.operatorId !== '__none__' ? form.operatorId : undefined,
      plannedQty: parseInt(form.plannedQty, 10), priority: form.priority,
      plannedStart: dateTimeLocalToIso(form.plannedStart) ?? new Date().toISOString(),
      plannedEnd: dateTimeLocalToIso(form.plannedEnd) ?? new Date(Date.now() + 86400000).toISOString(),
      notes: form.notes || undefined,
      autoStart: form.autoStart,
      ...(assignmentList.length > 0 && { assignments: assignmentList }),
    });
  };

  const oeeColor = (v?: number) => v == null ? '' : v >= 85 ? 'text-green-400' : v >= 65 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.workOrders.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.workOrders.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs"><Download size={13} />{t('common:actions.export')}</Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { setForm(EMPTY_FORM); setAssignments({}); setFormOpen(true); }}>
            <Plus size={13} />{t('newWorkOrder')}
          </Button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto p-6">
        <InlineFormSlot className="mb-6 empty:mb-0" />

        <div className="industrial-card p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold">{t('allWorkOrders')}</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder={t('searchOrders')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-8 ps-7 w-48 text-xs" />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter size={12} />{statusFilter ? t(`status.${statusFilter}`) : t('allStatus')}<ChevronDown size={11} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => { setStatusFilter(null); setPage(1); }}>{t('allStatus')}</DropdownMenuItem>
                  {Object.keys(STATUS_LABELS).map(s => (
                    <DropdownMenuItem key={s} onClick={() => { setStatusFilter(s); setPage(1); }}>{t(`status.${s}`)}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <ArchiveFilter value={archived} onChange={(v) => { setArchived(v); setPage(1); }} />
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  <TableHead className="w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('selectAll')} /></TableHead>
                  <SortableHeader column="woNumber" label={t('col.order')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader column="woNumber" label={t('col.product')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader column="status" label={t('col.status')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader column="priority" label={t('col.priority')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader column="progress" label={t('col.progress')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader column="plannedQty" label={t('col.qty')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader column="plannedEnd" label={t('col.plannedEnd')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <SortableHeader column="oee" label={t('col.oee')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                  <th className="px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground" title="Auto-start">Auto</th>
                  <th className="px-4 py-3 text-end text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('col.actions')}</th>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 11 }).map((_, j) => (
                        <TableCell key={j}><div className="shimmer h-3.5 rounded w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-12 text-muted-foreground text-sm">{t('noWorkOrders')}</TableCell>
                  </TableRow>
                ) : sortedOrders.map(order => {
                  // The bar tracks QUANTITY so it agrees with the qty cell beside it.
                  // It used the API's `progress`, which is STEP completion — putting a
                  // 0% bar next to "2,240 / 400,000" and a "0/5 steps" line that already
                  // said the same thing. Step completion keeps its own line below.
                  //
                  // One decimal, because a long order spends its first hours below 1%
                  // and whole-number rounding renders real output as a flat zero.
                  const progressGood = (order as any).goodQty ?? order.actualQty ?? 0;
                  const progress = order.plannedQty > 0
                    ? Math.min(Math.round((progressGood / order.plannedQty) * 1000) / 10, 100)
                    : 0;
                  const canEdit = !['COMPLETED', 'CANCELLED'].includes(order.status);
                  const canDelete = ['PLANNED', 'RELEASED', 'ON_HOLD', 'CANCELLED'].includes(order.status);
                  return (
                    <TableRow key={order.id} onClick={() => setViewId(order.id)} className={cn('border-border/20 hover:bg-muted/20 cursor-pointer', sel.isSelected(order.id) && 'bg-primary/5')}>
                      <TableCell onClick={(e) => e.stopPropagation()}><Checkbox checked={sel.isSelected(order.id)} onCheckedChange={() => sel.toggle(order.id)} aria-label={t('selectAll')} /></TableCell>
                      <TableCell className="font-mono text-xs font-semibold text-primary">{order.orderNumber}</TableCell>
                      <TableCell>
                        <div className="text-xs font-medium truncate max-w-[120px]">{order.productName || '—'}</div>
                        <div className="text-[10px] text-muted-foreground">{order.productCode}</div>
                        {order.machines && order.machines.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1 max-w-[160px]">
                            {order.machines.slice(0, 3).map((m) => (
                              <span key={m.id} className="inline-flex items-center gap-0.5 rounded border border-border/50 bg-muted/40 px-1 py-0.5 text-[9px] text-muted-foreground">
                                <Cpu className="w-2 h-2" />{m.name}
                              </span>
                            ))}
                            {order.machines.length > 3 && (
                              <span className="text-[9px] text-muted-foreground">+{order.machines.length - 3}</span>
                            )}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_COLORS[order.status] ?? 'secondary'} className="text-[10px] h-5">
                          {t(`status.${order.status}`, { defaultValue: order.status })}
                        </Badge>
                        {order.materialStatus && order.materialStatus !== 'OK' && (
                          <div className={cn(
                            'mt-1 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold whitespace-nowrap',
                            order.materialStatus === 'AWAITING_MATERIALS'
                              ? 'text-red-400 bg-red-500/10 border-red-500/30'
                              : 'text-blue-400 bg-blue-500/10 border-blue-500/30',
                          )}>
                            {order.materialStatus === 'AWAITING_MATERIALS'
                              ? t('materialGate.awaiting', { defaultValue: 'Awaiting Materials' })
                              : t('materialGate.scheduled', { defaultValue: 'Materials ETA {{date}}', date: order.materialReadyDate ? formatDate(order.materialReadyDate) : '' })}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('text-[10px] h-5', PRIORITY_CLS[order.priority] ?? '')}>
                          {t(`common:priority.${order.priority}`, { defaultValue: order.priority })}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 min-w-[90px]">
                          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress}%` }} />
                          </div>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">{progress}%</span>
                        </div>
                        {(order as any).totalSteps > 0 && (
                          <div className="text-[9px] text-muted-foreground mt-0.5">
                            {(order as any).completedSteps}/{(order as any).totalSteps} steps
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="font-semibold">{(order as any).goodQty ?? order.actualQty}</span>
                        <span className="text-muted-foreground">/{order.plannedQty}</span>
                        {(order as any).scrapQty > 0 && (
                          <span className="text-red-400 text-[10px] ml-1">+{(order as any).scrapQty}✗</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {order.plannedEnd ? formatDate(order.plannedEnd) : '—'}
                      </TableCell>
                      <TableCell>
                        {order.oee != null && (
                          <span className={cn('text-xs font-semibold tabular-nums', oeeColor(order.oee))}>
                            {formatPercent(order.oee)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                        <AutoStartPill
                          state={autoStartState(order, orders, nowMs)}
                          pending={updateMutation.isPending}
                          onToggle={() => updateMutation.mutate({ id: order.id, dto: { autoStart: !order.autoStart } })}
                        />
                      </TableCell>
                      <TableCell>
                        <TableRowActions
                          onView={() => setViewId(order.id)}
                          onEdit={canEdit ? () => { setEditWO(order); setEditForm({ plannedQty: String(order.plannedQty), priority: order.priority, notes: '' }); } : undefined}
                          onDelete={canDelete ? () => setDeleteDialog({ id: order.id, orderNumber: order.orderNumber }) : undefined}
                          extraActions={[
                            {
                              /*
                               * Auto-start, in words, beside Edit.
                               *
                               * The pill in the Auto column shows STATE at a
                               * glance and pulses when an order is due and
                               * blocked — but an icon column is easy to miss,
                               * and it does not say what tapping it will do.
                               * Both earn their place: the column is for
                               * scanning a list, this is for acting on one row.
                               */
                              label: order.autoStart ? 'Turn auto-start off' : 'Turn auto-start on',
                              icon: order.autoStart ? ZapOff : Zap,
                              onClick: () => updateMutation.mutate({
                                id: order.id, dto: { autoStart: !order.autoStart },
                              }),
                              // Only meaningful while an order has not started.
                              // Offering it on one already running would imply
                              // it could still be made to start itself.
                              hidden: !['PLANNED', 'RELEASED'].includes(order.status),
                            },
                            {
                              label: t('startOrder'),
                              icon: Play,
                              onClick: () => startMutation.mutate(order.id),
                              variant: 'success',
                              hidden: !['PLANNED', 'RELEASED'].includes(order.status),
                            },
                            {
                              label: t('resume'),
                              icon: Play,
                              onClick: () => releaseMutation.mutate(order.id),
                              variant: 'success',
                              hidden: order.status !== 'ON_HOLD',
                            },
                            {
                              label: t('complete'),
                              icon: CheckCircle,
                              onClick: () => { setCompleteDialog({ woId: order.id, orderNumber: order.orderNumber, plannedQty: order.plannedQty }); setCompleteForm({ actualQty: String(order.plannedQty), goodQty: '' }); },
                              variant: 'success',
                              hidden: order.status !== 'IN_PROGRESS',
                            },
                            {
                              label: t('hold'),
                              icon: Pause,
                              onClick: () => setHoldDialog({ woId: order.id, orderNumber: order.orderNumber }),
                              variant: 'warning',
                              hidden: order.status !== 'IN_PROGRESS',
                            },
                            {
                              label: t('common:actions.cancel'),
                              icon: XCircle,
                              onClick: () => { setCancelDialog({ woId: order.id, orderNumber: order.orderNumber }); setCancelReason(''); },
                              variant: 'destructive',
                              separator: true,
                              hidden: !['PLANNED', 'RELEASED', 'IN_PROGRESS', 'ON_HOLD'].includes(order.status),
                            },
                          ]}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          DETAIL SHEET
      ══════════════════════════════════════════════ */}
      <Sheet open={!!viewId} onOpenChange={o => !o && setViewId(null)}>
        <SheetContent
          className="w-full max-w-xl"
          // The inline inspection form (and its Radix popovers) portal to <body>,
          // i.e. outside this sheet's DOM. Without this guard, any click inside
          // that form reads as "interact outside" and closes the whole sheet.
          onPointerDownOutside={(e) => {
            // Radix passes a synthetic event whose `target` is the layer node, not
            // the clicked element — the real target lives on the original event.
            const t = (e.detail?.originalEvent?.target ?? e.target) as HTMLElement | null;
            if (t?.closest?.('[data-inline-form-panel],[data-radix-popper-content-wrapper]')) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            const t = (e.detail?.originalEvent?.target ?? e.target) as HTMLElement | null;
            if (t?.closest?.('[data-inline-form-panel],[data-radix-popper-content-wrapper]')) e.preventDefault();
          }}
        >
          <SheetHeader>
            {detail ? (
              <>
                <div className="flex items-center gap-3 pr-6">
                  <div className="flex-1">
                    <SheetTitle className="font-mono text-sm">{detail.orderNumber}</SheetTitle>
                    <SheetDescription className="mt-0.5">{detail.productName || (detail as any).sku?.name || '—'}</SheetDescription>
                  </div>
                  <Badge variant={STATUS_COLORS[(detail as any).status] ?? 'secondary'}>
                    {t(`status.${(detail as any).status}`, { defaultValue: (detail as any).status })}
                  </Badge>
                  <Badge variant="outline" className={cn('text-[10px]', PRIORITY_CLS[(detail as any).priority] ?? '')}>
                    {(detail as any).priority}
                  </Badge>
                </div>
              </>
            ) : (
              <SheetTitle>{t('wo.detailsTitle')}</SheetTitle>
            )}
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
            {detailLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 8 }).map((_, i) => <div key={i} className="shimmer h-4 rounded w-full" />)}
              </div>
            ) : detail ? (
              <>
                {/* OEE Metrics */}
                {((detail as any).oee != null) && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('wo.oeeMetrics')}</p>
                    <div className="grid grid-cols-4 gap-2">
                      <MetricCard label={t('cards.oee')} value={`${(detail as any).oee?.toFixed(1)}%`} color={oeeColor((detail as any).oee)} />
                      <MetricCard label={t('cards.availability')} value={`${(detail as any).availability?.toFixed(1)}%`} />
                      <MetricCard label={t('cards.performance')} value={`${(detail as any).performance?.toFixed(1)}%`} />
                      <MetricCard label={t('cards.quality')} value={`${(detail as any).quality?.toFixed(1)}%`} />
                    </div>
                  </div>
                )}

                {/* Production Progress */}
                {(() => {
                  const d = detail as any;
                  const completedSteps = d.completedSteps ?? 0;
                  const totalSteps     = d.totalSteps     ?? d.jobOrders?.length ?? 0;
                  const stepPct = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
                  const good   = d.liveGoodQty  ?? d.goodQty  ?? 0;
                  const scrap  = d.liveScrapQty ?? d.scrapQty ?? 0;
                  const actual = d.liveActualQty ?? d.actualQty ?? 0;
                  // The live quantities (good/scrap/actual) are in PIECES. The
                  // commitment is stored in the ORDER's own unit — PALLET on this
                  // line — so the bar has to divide by the commitment CONVERTED to
                  // pieces (`plannedQtyBase`). Dividing by the raw 150 compared
                  // pieces with pallets: a finished order drew as 0.6%.
                  const plannedBase = d.plannedQtyBase ?? d.plannedQty ?? 0;
                  // Qty-based % for the final output vs WO planned. One decimal so the
                  // early hours of a large order read as 0.5%, not a discouraging 0%.
                  const qtyPct = plannedBase > 0
                    ? Math.min(Math.round((good / plannedBase) * 1000) / 10, 100)
                    : 0;
                  // `unit` labels the PIECES figures. The commitment keeps its own
                  // unit and its own label — showing "150 PALLET" as "150 INNER"
                  // understated the order by the whole packaging ladder.
                  const unit = d.qtyUnit ?? '';
                  const orderedQty = d.plannedQtyOrdered ?? d.plannedQty ?? 0;
                  const orderedUnit = d.plannedQtyOrderedUnit ?? unit;
                  return (
                    <div>
                      <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('wo.productionProgress')}</p>
                      <div className="industrial-card rounded-lg p-3 space-y-3">
                        {/* Step completion bar */}
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-muted-foreground">{t('wo.stepsCompleted')}</span>
                            <span className="text-[10px] font-semibold">{completedSteps} / {totalSteps}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${stepPct}%` }} />
                            </div>
                            <span className="text-xs font-bold tabular-nums w-10 text-right">{stepPct}%</span>
                          </div>
                        </div>
                        {/* Output qty bar (final step vs WO planned) */}
                        {plannedBase > 0 && (
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] text-muted-foreground">{t('wo.finalOutputVsPlanned')}</span>
                              <span className="text-[10px] font-semibold">
                                {fmtQty(good)} / {fmtQty(plannedBase)} {unit}
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-green-500/70 rounded-full transition-all" style={{ width: `${qtyPct}%` }} />
                              </div>
                              <span className="text-xs font-semibold tabular-nums text-green-400 w-10 text-right">{qtyPct}%</span>
                            </div>
                          </div>
                        )}
                        {/* KPIs */}
                        <div className="grid grid-cols-4 gap-2 text-center pt-1 border-t border-border/30">
                          {[
                            // The commitment is shown AS ORDERED — "150 PALLET" is
                            // what the planner typed and what the operator recognises.
                            // The three live figures beside it are in pieces and say so.
                            { label: t('wo.planned'),     value: fmtQty(orderedQty),  sub: orderedUnit },
                            { label: t('wo.outputLast'),  value: fmtQty(actual),      sub: unit,  color: 'text-foreground' },
                            { label: t('wo.good'),        value: fmtQty(good),        sub: unit,  color: 'text-green-400' },
                            { label: t('wo.totalScrap'),  value: fmtQty(scrap),       sub: t('wo.allSteps'), color: scrap > 0 ? 'text-red-400' : '' },
                          ].map(m => (
                            <div key={m.label}>
                              <div className={cn('text-base font-bold tabular-nums', (m as any).color)}>{m.value}</div>
                              <div className="text-[10px] text-muted-foreground">{m.label}</div>
                              {(m as any).sub && <div className="text-[9px] text-muted-foreground/60">{(m as any).sub}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* Dispatch List (Job Orders) */}
                {((detail as any).jobOrders?.length > 0) && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <Layers className="w-3 h-3" />{t('podetail.dispatchList')}
                    </p>
                    <div className="space-y-1.5">
                      {(detail as any).jobOrders.map((jo: any) => {
                        // JobOrder has no `plannedQty` column — it is `plannedQtyOut`.
                        // Reading the wrong name made every step bar sit at 0% and the
                        // quantity render as "0 / INNER" with the number missing, on
                        // every job order of every work order.
                        const joPlanned = jo.plannedQtyOut ?? 0;
                        const joProgress = joPlanned > 0 ? Math.min(Math.round((jo.actualQtyGood / joPlanned) * 100), 100) : 0;
                        const statusColor: Record<string, string> = {
                          EXECUTING: 'text-green-400', COMPLETE: 'text-blue-400',
                          PAUSED: 'text-yellow-400', READY: 'text-muted-foreground',
                          PENDING: 'text-muted-foreground/60',
                        };
                        const statusIcon: Record<string, React.ReactNode> = {
                          EXECUTING: <Circle className="w-2 h-2 fill-green-400 text-green-400" />,
                          COMPLETE:  <CheckSquare className="w-2.5 h-2.5 text-blue-400" />,
                          PAUSED:    <Circle className="w-2 h-2 fill-yellow-400 text-yellow-400" />,
                          READY:     <Circle className="w-2 h-2 text-muted-foreground" />,
                        };
                        return (
                          <div key={jo.id} className="industrial-card rounded-lg px-3 py-2.5">
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-[10px] font-mono text-muted-foreground shrink-0">#{jo.sequenceOrder}</span>
                                {jo.stepType === 'SS' && (
                                  <span className="text-[9px] font-bold bg-blue-500/20 text-blue-400 border border-blue-400/30 rounded px-1">SS</span>
                                )}
                                <span className="text-xs font-semibold truncate">{jo.operationName}</span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {statusIcon[jo.status] ?? <Circle className="w-2 h-2 text-muted-foreground/40" />}
                                <span className={cn('text-[10px] font-medium', statusColor[jo.status] ?? 'text-muted-foreground')}>
                                  {t(`podetail.joStatus.${jo.status}`, { defaultValue: jo.status })}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                                <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${joProgress}%` }} />
                              </div>
                              <span className="text-[10px] tabular-nums text-muted-foreground">
                                <span className="text-foreground font-medium">{fmtQty(jo.actualQtyGood)}</span>
                                {jo.actualQtyRejected > 0 && (
                                  <span className="text-red-400"> +{fmtQty(jo.actualQtyRejected)}✗</span>
                                )}
                                <span> / {joPlanned > 0 ? fmtQty(joPlanned) : '—'} {jo.outputUnit ?? ''}</span>
                              </span>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                              {jo.machine && (
                                <span className="flex items-center gap-1">
                                  <Cpu className="w-2.5 h-2.5" />{jo.machine.name}
                                </span>
                              )}
                              {jo.operator && (
                                <span className="flex items-center gap-1">
                                  <User className="w-2.5 h-2.5" />{jo.operator.name}
                                </span>
                              )}
                            </div>
                            {(jo.joOEE != null || jo.joQuality != null || jo.joPerformance != null || jo.joAvailability != null) && (
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                {jo.joQuality != null && (
                                  <span className="text-[9px] font-bold px-1 py-0.5 rounded border text-green-400 bg-green-400/10 border-green-400/30 tabular-nums">
                                    Q: {jo.joQuality.toFixed(1)}%
                                  </span>
                                )}
                                {jo.joPerformance != null && (
                                  <span className="text-[9px] font-bold px-1 py-0.5 rounded border text-blue-400 bg-blue-400/10 border-blue-400/30 tabular-nums">
                                    P: {jo.joPerformance.toFixed(1)}%
                                  </span>
                                )}
                                {jo.joAvailability != null && (
                                  <span className="text-[9px] font-bold px-1 py-0.5 rounded border text-yellow-400 bg-yellow-400/10 border-yellow-400/30 tabular-nums">
                                    A: {jo.joAvailability.toFixed(1)}%
                                  </span>
                                )}
                                {jo.joOEE != null && (
                                  <span className={cn('text-[9px] font-bold px-1 py-0.5 rounded border tabular-nums', jo.joOEE >= 85 ? 'text-green-400 bg-green-400/10 border-green-400/30' : jo.joOEE >= 60 ? 'text-yellow-400 bg-yellow-400/10 border-yellow-400/30' : 'text-red-400 bg-red-400/10 border-red-400/30')}>
                                    OEE: {jo.joOEE.toFixed(1)}%
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Details */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('wo.orderDetails')}</p>
                  <div className="industrial-card rounded-lg px-3">
                    <DetailRow label={t('col.product')} value={(detail as any).sku?.name ?? (detail as any).productName} />
                    <DetailRow label={t('wo.skuCode')} value={(detail as any).sku?.code ?? (detail as any).productCode} />
                    <DetailRow label={t('wo.itemNumber')} value={(detail as any).sku?.itemNumber} />
                    <DetailRow label={t('wo.productionLine')} value={(detail as any).line?.name ?? (detail as any).line} />
                    <DetailRow
                      label={t('wo.machines')}
                      value={((detail as any).machines ?? [])
                        .map((m: { name: string }) => m.name)
                        .join(', ') || '—'}
                    />
                    <DetailRow label={t('wform.operator')} value={(detail as any).operator?.name ?? (detail as any).operator} />
                    <DetailRow label={t('wo.supervisor')} value={(detail as any).supervisor?.name ?? (detail as any).supervisor} />
                  </div>
                </div>

                {/* Timeline */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('wo.timeline')}</p>
                  <div className="industrial-card rounded-lg px-3">
                    <DetailRow label={t('podetail.plannedStart')} value={(detail as any).plannedStart ? formatDateTimeWithZone((detail as any).plannedStart) : undefined} />
                    <DetailRow label={t('podetail.plannedEnd')} value={(detail as any).plannedEnd ? formatDateTimeWithZone((detail as any).plannedEnd) : undefined} />
                    <DetailRow label={t('podetail.actualStart')} value={(detail as any).actualStart ? formatDateTimeWithZone((detail as any).actualStart) : undefined} />
                    <DetailRow label={t('podetail.actualEnd')} value={(detail as any).actualEnd ? formatDateTimeWithZone((detail as any).actualEnd) : undefined} />
                    <DetailRow label={t('wo.downtime')} value={(detail as any).downtimeMinutes != null ? t('wo.minutesValue', { count: (detail as any).downtimeMinutes }) : undefined} />
                  </div>
                </div>

                {/* Linked batches */}
                {(detail as any).batchRecords?.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('wo.linkedBatches')}</p>
                    <div className="space-y-1.5">
                      {(detail as any).batchRecords.map((b: any) => (
                        <div key={b.id} className="industrial-card rounded-lg px-3 py-2 flex items-center justify-between">
                          <span className="font-mono text-xs text-primary">{b.batchNumber}</span>
                          <Badge variant="outline" className="text-[10px] h-4">{t(`batches.status.${b.status}`, { defaultValue: b.status })}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Quality Inspections */}
                <WorkOrderQualityPanel workOrderId={(detail as any).id} machineId={(detail as any).machines?.[0]?.id ?? (detail as any).jobOrders?.[0]?.machine?.id} />

                {/* Notes */}
                {(detail as any).notes && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('wform.notes')}</p>
                    <div className="industrial-card rounded-lg px-3 py-2">
                      <p className="text-xs text-muted-foreground">{(detail as any).notes}</p>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>

          {/* Quick actions */}
          {detail && (
            <div className="px-6 py-3 border-t border-border/50 flex items-center gap-2 shrink-0">
              {(detail as any).archivedAt ? (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => { restoreWO.mutate((detail as any).id); setViewId(null); }}>
                  <RotateCcw size={11} />{t('pomenu.restore')}
                </Button>
              ) : (
                <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7" onClick={() => { archiveWO.mutate((detail as any).id); setViewId(null); }}>
                  <ArchiveIcon size={11} />{t('pomenu.archive')}
                </Button>
              )}
              {['PLANNED', 'RELEASED'].includes((detail as any).status) && (
                <Button size="sm" className="gap-1.5 text-xs h-7 bg-green-600 hover:bg-green-700" onClick={() => { startMutation.mutate((detail as any).id); setViewId(null); }}>
                  <Play size={11} />{t('wo.start')}
                </Button>
              )}
              {(detail as any).status === 'ON_HOLD' && (
                <Button size="sm" className="gap-1.5 text-xs h-7 bg-green-600 hover:bg-green-700" onClick={() => { releaseMutation.mutate((detail as any).id); setViewId(null); }}>
                  <Play size={11} />{t('resume')}
                </Button>
              )}
              {(detail as any).status === 'IN_PROGRESS' && (
                <>
                  <Button size="sm" className="gap-1.5 text-xs h-7 bg-green-600 hover:bg-green-700"
                    onClick={() => { setViewId(null); setCompleteDialog({ woId: (detail as any).id, orderNumber: (detail as any).orderNumber, plannedQty: (detail as any).plannedQty }); setCompleteForm({ actualQty: String((detail as any).plannedQty), goodQty: '' }); }}>
                    <CheckCircle size={11} />{t('complete')}
                  </Button>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7"
                    onClick={() => { setViewId(null); setHoldDialog({ woId: (detail as any).id, orderNumber: (detail as any).orderNumber }); }}>
                    <Pause size={11} />{t('hold')}
                  </Button>
                </>
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ══ Create Form ══ */}
      <FormDialog open={formOpen} onClose={() => setFormOpen(false)} title={t('wform.createTitle')}
        onSubmit={handleCreate} isSubmitting={createMutation.isPending}
        isValid={form.skuId !== '__none__' && !!form.plannedQty}>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>{t('wform.product')}</Label>
            <EntityPicker
              items={skus}
              value={form.skuId === '__none__' ? null : form.skuId}
              onChange={id => setForm(f => ({ ...f, skuId: id ?? '__none__' }))}
              getId={(s: any) => s.id}
              getPrimary={(s: any) => s.name}
              getSecondary={(s: any) => s.code ?? s.sku ?? ''}
              placeholder={t('wform.selectProduct')}
              searchPlaceholder={t('wform.searchCodeName')}
              className="mt-1"
              clearable={false}
            />
          </div>
          <div className="col-span-2">
            <Label>{t('wform.operator')}</Label>
            <EntityPicker
              items={users}
              value={form.operatorId === '__none__' ? null : form.operatorId}
              onChange={id => setForm(f => ({ ...f, operatorId: id ?? '__none__' }))}
              getId={(u: any) => u.id}
              getPrimary={(u: any) => u.name}
              placeholder={t('wform.assignOperator')}
              searchPlaceholder={t('wform.searchOperators')}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{t('wform.priority')}</Label>
            <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(p => <SelectItem key={p} value={p}>{t(`common:priority.${p}`, { defaultValue: p })}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('wform.plannedQtyReq')}</Label>
            <Input type="number" min={1} value={form.plannedQty} onChange={e => setForm(v => ({ ...v, plannedQty: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('wform.plannedStart')}</Label>
            <Input type="datetime-local" value={form.plannedStart} onChange={e => setForm(v => ({ ...v, plannedStart: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('wform.plannedEnd')}</Label>
            <Input type="datetime-local" value={form.plannedEnd} onChange={e => setForm(v => ({ ...v, plannedEnd: e.target.value }))} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>{t('wform.notes')}</Label>
            <Input value={form.notes} onChange={e => setForm(v => ({ ...v, notes: e.target.value }))} placeholder={t('wform.optionalNotes')} className="mt-1" />
          </div>

          {/* ── Smart preview: routing, realistic finish, material shortages, per-step operators ── */}
          {form.skuId !== '__none__' && !!form.plannedQty && (
            <div className="col-span-2 space-y-2.5">
              {previewLoading && !prev && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground p-3 rounded-lg border border-border/40">
                  <Clock size={13} className="animate-spin" />{t('wform.preview.computing')}
                </div>
              )}
              {prev && (
                <>
                  {/* Smart finish + process summary */}
                  <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold"><BarChart3 size={13} className="text-brand-400" />{t('wform.preview.title')}</div>
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('wform.preview.process')}</span><span className="font-medium truncate ml-2">{prev.process?.name ?? prev.recipe?.name ?? '—'}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">{t('wform.preview.steps')}</span><span className="font-medium">{prev.stepCount ?? 0}</span></div>
                      {prev.smart && (
                        <>
                          <div className="flex justify-between"><span className="text-muted-foreground">{t('wform.preview.workContent')}</span><span className="font-medium">{Math.round((prev.smart.workContentMins ?? 0) / 60 * 10) / 10}h</span></div>
                          <div className="flex justify-between"><span className="text-muted-foreground">{t('wform.preview.smartFinish')}</span><span className="font-medium text-brand-300">{prev.smart.computedFinish ? formatDate(prev.smart.computedFinish) : '—'}</span></div>
                        </>
                      )}
                    </div>
                    {prev.warning && (
                      <div className="flex items-start gap-1.5 text-[11px] text-amber-400"><AlertCircle size={12} className="mt-0.5 shrink-0" />{prev.warning}</div>
                    )}
                  </div>

                  {/* Material shortages */}
                  {Array.isArray(prev.materialShortages) && prev.materialShortages.length > 0 && (
                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 space-y-1.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-red-400"><AlertCircle size={13} />{t('wform.preview.shortagesTitle', { count: prev.materialShortages.length })}</div>
                      {prev.materialShortages.map((m: any, i: number) => (
                        <div key={i} className="flex justify-between text-[11px]">
                          <span className="truncate">{m.name} <span className="font-mono text-muted-foreground">{m.code}</span></span>
                          <span className="text-red-400 whitespace-nowrap">{t('wform.preview.short')} {m.short} {m.unit}</span>
                        </div>
                      ))}
                      <p className="text-[10px] text-muted-foreground">{t('wform.preview.shortagesHint')}</p>
                    </div>
                  )}

                  {/* Per-step operator assignment */}
                  {Array.isArray(prev.jobOrdersToCreate) && prev.jobOrdersToCreate.length > 0 && (
                    <div className="rounded-lg border border-border/40 p-3 space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold"><Layers size={13} className="text-brand-400" />{t('wform.preview.assignTitle')}</div>
                      {prev.jobOrdersToCreate.map((step: any) => (
                        <div key={step.stepId} className="flex items-center gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="text-[11px] font-medium truncate">{step.stepNumber}. {step.operationName}</div>
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1"><Cpu size={9} />{step.machine?.name ?? t('wform.preview.noMachine')}</div>
                          </div>
                          <select
                            value={assignments[step.stepId] ?? '__none__'}
                            onChange={e => setAssignments(a => ({ ...a, [step.stepId]: e.target.value }))}
                            className="h-7 w-36 rounded-md border border-border bg-background px-2 text-[11px]"
                          >
                            <option value="__none__">{t('wform.preview.unassigned')}</option>
                            {users.map((u: any) => <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <label className="col-span-2 flex items-start gap-2.5 p-3 rounded-lg border border-border/60 bg-muted/20 cursor-pointer">
            <Checkbox checked={form.autoStart} onCheckedChange={v => setForm(f => ({ ...f, autoStart: !!v }))} className="mt-0.5" />
            <span className="text-xs">
              <span className="font-medium">{t('wform.autoStart')}</span>
              <span className="block text-muted-foreground mt-0.5">
                {t('wform.autoStartHelp')}
              </span>
            </span>
          </label>
        </div>
      </FormDialog>

      {/* ══ Edit — inline form ══ */}
      <InlineFormPanel
        open={!!editWO}
        onClose={() => setEditWO(null)}
        icon={Pencil}
        title={`Edit — ${editWO?.orderNumber ?? ''}`}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setEditWO(null)}>Cancel</Button>
            <Button size="sm" disabled={!editForm.plannedQty || updateMutation.isPending}
              onClick={() => editWO && updateMutation.mutate({ id: editWO.id, dto: { plannedQty: parseInt(editForm.plannedQty, 10), priority: editForm.priority, notes: editForm.notes || undefined } })}>
              {updateMutation.isPending ? 'Saving…' : 'Save Changes'}
            </Button>
          </>
        )}
      >
          <div className="space-y-4">
            <div>
              <Label>Planned Quantity</Label>
              <Input type="number" min={1} value={editForm.plannedQty} onChange={e => setEditForm(f => ({ ...f, plannedQty: e.target.value }))} className="mt-1" />
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={editForm.priority} onValueChange={v => setEditForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Input value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} placeholder="Update notes…" className="mt-1" />
            </div>
          </div>
      </InlineFormPanel>

      {/* ══ Complete Dialog ══ */}
      <Dialog open={!!completeDialog} onOpenChange={o => !o && setCompleteDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Complete — {completeDialog?.orderNumber}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Actual Quantity Produced *</Label>
              <Input type="number" min={0} value={completeForm.actualQty} onChange={e => setCompleteForm(f => ({ ...f, actualQty: e.target.value }))} placeholder={`Planned: ${completeDialog?.plannedQty}`} className="mt-1" />
            </div>
            <div>
              <Label>Acceptance Quantity <span className="text-muted-foreground text-[10px]">(defaults to actual)</span></Label>
              <Input type="number" min={0} value={completeForm.goodQty} onChange={e => setCompleteForm(f => ({ ...f, goodQty: e.target.value }))} placeholder="Leave blank = same as actual" className="mt-1" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCompleteDialog(null)}>Cancel</Button>
            <Button size="sm" disabled={!completeForm.actualQty || completeMutation.isPending} className="bg-green-600 hover:bg-green-700"
              onClick={() => completeDialog && completeMutation.mutate({ woId: completeDialog.woId, dto: { actualQty: parseInt(completeForm.actualQty, 10), goodQty: completeForm.goodQty ? parseInt(completeForm.goodQty, 10) : undefined } })}>
              {completeMutation.isPending ? 'Completing…' : 'Mark Complete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ Hold Dialog ══ */}
      <Dialog open={!!holdDialog} onOpenChange={o => !o && setHoldDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Hold — {holdDialog?.orderNumber}</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label className="text-xs">Reason for hold *</Label>
            <Input placeholder="e.g. Waiting for material…" value={holdReason} onChange={e => setHoldReason(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setHoldDialog(null)}>Cancel</Button>
            <Button size="sm" disabled={holdReason.length < 5 || holdMutation.isPending}
              onClick={() => holdDialog && holdMutation.mutate({ woId: holdDialog.woId, reason: holdReason })}>
              Confirm Hold
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ Cancel Dialog ══ */}
      <Dialog open={!!cancelDialog} onOpenChange={o => !o && setCancelDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Cancel — {cancelDialog?.orderNumber}</DialogTitle></DialogHeader>
          <div className="py-2">
            <Label className="text-xs">Reason for cancellation *</Label>
            <Input placeholder="e.g. Material shortage, schedule change…" value={cancelReason} onChange={e => setCancelReason(e.target.value)} className="mt-1" />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCancelDialog(null)}>Back</Button>
            <Button variant="destructive" size="sm" disabled={cancelReason.length < 5 || cancelMutation.isPending}
              onClick={() => cancelDialog && cancelMutation.mutate({ woId: cancelDialog.woId, reason: cancelReason })}>
              {cancelMutation.isPending ? 'Cancelling…' : 'Confirm Cancel'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ══ Delete Dialog ══ */}
      <DeleteDialog
        open={!!deleteDialog} onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={`Delete ${deleteDialog?.orderNumber}?`}
        description="This will permanently delete the work order."
        isDeleting={deleteMutation.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: 'Restore', icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: 'Archive', icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  );
}
