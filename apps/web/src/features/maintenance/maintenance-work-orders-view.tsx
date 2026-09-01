'use client';
import { useTranslation } from 'react-i18next';

import React, { useState, useMemo } from 'react';
import {
  Plus, Search, Filter, ChevronDown, Wrench, AlertTriangle, Clock,
  User, CheckCircle, Trash2, Package, X, PackageCheck, PackageMinus,
  PackageX, ChevronRight, Info, Play, Ban, FileText, Settings2,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Attachments } from '@/components/ui/attachments';
import { TableRowActions } from '@/components/ui/table-row-actions';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { ExportMenu } from '@/components/ui/export-menu';
import { exportRecordToPDF } from '@/lib/export-utils';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { MachinePicker } from '@/components/ui/machine-picker';
import { FailureModeManager } from '@/components/maintenance/failure-mode-manager';
import { FailureModeMultiSelect } from '@/components/maintenance/failure-mode-multi-select';
import { TablePagination } from '@/components/ui/table-pagination';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';
import { api } from '@/services/api.client';
import { cn, formatDate } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  OPEN: 'secondary', AWAITING_PARTS: 'outline', ASSIGNED: 'outline',
  IN_PROGRESS: 'default', ON_HOLD: 'outline', COMPLETED: 'default', CANCELLED: 'destructive',
};
const STATUS_EXTRA_CLS: Record<string, string> = {
  AWAITING_PARTS: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
};
const PRIORITY_CONFIG: Record<string, { labelKey: string; color: string }> = {
  LOW: { labelKey: 'common:priority.LOW', color: 'text-muted-foreground' },
  MEDIUM: { labelKey: 'common:priority.MEDIUM', color: 'text-brand-400' },
  HIGH: { labelKey: 'common:priority.HIGH', color: 'text-amber-400' },
  CRITICAL: { labelKey: 'common:priority.CRITICAL', color: 'text-red-400' },
};
const TYPE_KEYS = ['CORRECTIVE', 'PREVENTIVE', 'PREDICTIVE', 'EMERGENCY', 'INSPECTION', 'LUBRICATION'];

const SPARE_STATUS_CONFIG: Record<string, { labelKey: string; icon: React.ElementType; cls: string }> = {
  PENDING:   { labelKey: 'woView.spareStatus.PENDING',   icon: Clock,         cls: 'text-amber-400 border-amber-400/30 bg-amber-400/10' },
  ISSUED:    { labelKey: 'woView.spareStatus.ISSUED',    icon: PackageCheck,  cls: 'text-green-400 border-green-400/30 bg-green-400/10' },
  PARTIAL:   { labelKey: 'woView.spareStatus.PARTIAL',   icon: PackageMinus,  cls: 'text-blue-400  border-blue-400/30  bg-blue-400/10'  },
  CANCELLED: { labelKey: 'woView.spareStatus.CANCELLED', icon: PackageX,      cls: 'text-muted-foreground border-border bg-muted/20'   },
};

interface MaintWO {
  id: string; woNumber: string; title: string; type: string; priority: string;
  status: string; asset: string; assetCode: string; machineId?: string;
  assignedTo: string | null; assignedToId: string | null; requestedBy: string | null;
  createdAt: string; dueDate: string | null; startedAt: string | null; completedAt: string | null;
  estimatedHours: number | null; actualHours: number | null; totalCost: number | null;
  description: string | null; notes: string | null; isOverdue: boolean; hasPendingParts: boolean;
  sparePartsCount?: number;
  productionWOId: string | null;
  productionWO: { id: string; orderNumber: string; status: string } | null;
}

interface SparePart {
  id: string; partNumber: string; name: string; category: string | null;
  stockQty: number; minStockQty: number; unitCost: number | null; storageLocation: string | null;
}

interface SparePartRequest {
  id: string; sparePartId: string; quantityRequested: number; quantityIssued: number;
  unitCost: number | null; status: string; notes: string | null;
  requestedAt: string; issuedAt: string | null;
  sparePart: { partNumber: string; name: string; unitCost: number | null; stockQty: number; storageLocation: string | null };
  issuedBy: { name: string } | null;
}

interface SpareLineItem {
  sparePartId: string;
  partNumber: string;
  name: string;
  stockQty: number;
  unitCost: number | null;
  quantityRequested: number;
}

const SUMMARY_CARDS = [
  { labelKey: 'woView.summary.open',       key: 'OPEN',        icon: AlertTriangle, color: 'text-amber-400' },
  { labelKey: 'woView.summary.inProgress', key: 'IN_PROGRESS',  icon: Wrench,        color: 'text-brand-400' },
  { labelKey: 'woView.summary.completed',  key: 'COMPLETED',    icon: CheckCircle,   color: 'text-green-400' },
];

const EMPTY_FORM = {
  title: '', type: 'CORRECTIVE', priority: 'MEDIUM',
  machineId: '', machineName: '',
  description: '', dueDate: '', estimatedHours: '',
  assignedToId: '',
  notes: '',
  productionWOId: '',
  failureModeIds: [] as string[],
};

// ── Component ────────────────────────────────────────────────

export function MaintenanceWorkOrdersView() {
  const { t } = useTranslation(['maintenance', 'common']);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [archived, setArchived] = useState<ArchiveScope>('active');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editWO, setEditWO] = useState<MaintWO | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; woNumber: string } | null>(null);
  const [viewWO, setViewWO] = useState<MaintWO | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [spareLines, setSpareLines] = useState<SpareLineItem[]>([]);
  const [spareSearch, setSpareSearch] = useState('');
  const [showPartPicker, setShowPartPicker] = useState(false);
  const [fmManagerOpen, setFmManagerOpen] = useState(false);

  // Issue dialog state
  const [issueDialog, setIssueDialog] = useState<{ request: SparePartRequest } | null>(null);
  const [issueQty, setIssueQty] = useState('');
  const [issueNotes, setIssueNotes] = useState('');

  // Lifecycle dialog state
  const [assignDialog, setAssignDialog] = useState<{ wo: MaintWO } | null>(null);
  const [assignUserId, setAssignUserId] = useState('');
  const [assignNotes, setAssignNotes] = useState('');

  const [completeDialog, setCompleteDialog] = useState<{ wo: MaintWO } | null>(null);
  const [completeForm, setCompleteForm] = useState({ actualHours: '', laborCost: '', partsCost: '', runtimeHoursAtService: '', notes: '' });

  const [holdDialog, setHoldDialog] = useState<{ wo: MaintWO } | null>(null);
  const [holdReason, setHoldReason] = useState('');

  const [cancelDialog, setCancelDialog] = useState<{ wo: MaintWO } | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  const queryClient = useQueryClient();
  const { archive: archiveWO, restore: restoreWO, bulkArchive, bulkRestore } = useArchive('maintenance-orders', [['maintenance', 'work-orders']], 'Maintenance order');
  const { toast } = useToast();

  // ── Queries ─────────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', 'work-orders', { search, status: statusFilter, archived, page, sortBy: 'createdAt', sortOrder: 'desc' }],
    queryFn: () => api.get('/maintenance/work-orders', {
      params: { search: search || undefined, status: statusFilter || undefined, archived: archived !== 'active' ? archived : undefined, limit: 20, page, sortBy: 'createdAt', sortOrder: 'desc' },
    }),
    staleTime: 15_000,
  });

  const total: number = (data as any)?.total ?? 0;

  const { data: sparePartsData } = useQuery({
    queryKey: ['maintenance', 'spare-parts', 'all'],
    queryFn: () => api.get('/maintenance/spare-parts', { params: { limit: 200 } }),
    staleTime: 60_000,
    enabled: formOpen || !!viewWO, // needed for both the create form and the detail "add parts" flow
  });

  const { data: woSparePartsData, refetch: refetchSpareParts } = useQuery({
    queryKey: ['maintenance', 'wo-spare-parts', viewWO?.id],
    queryFn: () => api.get(`/maintenance/work-orders/${viewWO!.id}/spare-parts`),
    staleTime: 10_000,
    enabled: !!viewWO,
  });

  const { data: usersData } = useQuery({
    queryKey: ['users', 'maintenance-dropdown'],
    queryFn: () => api.get('/users', { params: { limit: 100 } }),
    staleTime: 120_000,
    enabled: formOpen || !!assignDialog,
  });
  const technicianOptions: Array<{ id: string; name: string; role: string }> = (usersData as any)?.data ?? [];

  const { data: prodWOsData } = useQuery({
    queryKey: ['production', 'work-orders', 'maint-dropdown'],
    queryFn: () => api.get('/production/work-orders', { params: { limit: 100, status: 'IN_PROGRESS,PLANNED,RELEASED' } }),
    staleTime: 60_000,
    enabled: formOpen,
  });
  const prodWOOptions: Array<{ id: string; orderNumber: string; status: string }> =
    (prodWOsData as any)?.data ?? [];

  const { data: failureModesData } = useQuery({
    queryKey: ['maintenance', 'failure-modes', form.machineId],
    queryFn: () => api.get('/maintenance/failure-modes', { params: { machineId: form.machineId || undefined } }),
    staleTime: 120_000,
    enabled: formOpen && !!form.machineId,
  });
  const failureModeOptions: Array<{ id: string; code: string; description: string; category: string; rpn: number }> =
    (failureModesData as any) ?? [];

  const orders: MaintWO[] = (data as any)?.data ?? [];
  const sel = useRowSelection(orders);
  const allParts: SparePart[] = (sparePartsData as any)?.data ?? [];
  const woSpareParts: SparePartRequest[] = Array.isArray(woSparePartsData) ? woSparePartsData : [];

  const counts = orders.reduce<Record<string, number>>((acc, wo) => {
    acc[wo.status] = (acc[wo.status] ?? 0) + 1;
    return acc;
  }, {});

  // Filter parts not already added
  const availableParts = useMemo(() => {
    const q = spareSearch.toLowerCase();
    const usedIds = new Set(spareLines.map(l => l.sparePartId));
    return allParts.filter(p =>
      !usedIds.has(p.id) &&
      (p.name.toLowerCase().includes(q) || p.partNumber.toLowerCase().includes(q))
    );
  }, [allParts, spareLines, spareSearch]);

  // ── Mutations ────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/maintenance/work-orders', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.woCreated'), variant: 'success' });
      handleCloseForm();
    },
    onError: (e: any) => toast({ title: t('toast.woCreateFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/maintenance/work-orders/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.woUpdated'), variant: 'success' });
      handleCloseForm();
    },
    onError: (e: any) => toast({ title: t('toast.woUpdateFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/maintenance/work-orders/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.woDeleted') });
      setDeleteDialog(null);
    },
    onError: (e: any) => toast({ title: t('toast.woDeleteFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const startMutation = useMutation({
    mutationFn: (woId: string) => api.patch(`/maintenance/work-orders/${woId}/start`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.woStarted'), variant: 'success' });
    },
    onError: (e: any) => toast({ title: t('toast.woStartFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const assignMutation = useMutation({
    mutationFn: ({ woId, dto }: { woId: string; dto: any }) =>
      api.patch(`/maintenance/work-orders/${woId}/assign`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.woAssigned'), variant: 'success' });
      setAssignDialog(null); setAssignUserId(''); setAssignNotes('');
      setViewWO(null);
    },
    onError: (e: any) => toast({ title: t('toast.woAssignFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const completeMutation = useMutation({
    mutationFn: ({ woId, dto }: { woId: string; dto: any }) =>
      api.patch(`/maintenance/work-orders/${woId}/complete`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.woCompleted'), variant: 'success' });
      setCompleteDialog(null); setCompleteForm({ actualHours: '', laborCost: '', partsCost: '', runtimeHoursAtService: '', notes: '' });
      setViewWO(null);
    },
    onError: (e: any) => toast({ title: t('toast.woCompleteFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const holdMutation = useMutation({
    mutationFn: ({ woId, dto }: { woId: string; dto: any }) =>
      api.patch(`/maintenance/work-orders/${woId}/hold`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.woHeld') });
      setHoldDialog(null); setHoldReason('');
    },
    onError: (e: any) => toast({ title: t('toast.woActionFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const resumeMutation = useMutation({
    mutationFn: (woId: string) => api.patch(`/maintenance/work-orders/${woId}/resume`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.woResumed'), variant: 'success' });
    },
    onError: (e: any) => toast({ title: t('toast.woActionFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const cancelMutation = useMutation({
    mutationFn: ({ woId, reason }: { woId: string; reason: string }) =>
      api.patch(`/maintenance/work-orders/${woId}/cancel`, { reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.woCancelled') });
      setCancelDialog(null); setCancelReason('');
      setViewWO(null);
    },
    onError: (e: any) => toast({ title: t('toast.woCancelFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const issueMutation = useMutation({
    mutationFn: ({ woId, requestId, dto }: { woId: string; requestId: string; dto: any }) =>
      api.patch(`/maintenance/work-orders/${woId}/spare-parts/${requestId}/issue`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'wo-spare-parts', viewWO?.id] });
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'spare-parts', 'all'] });
      toast({ title: t('toast.partsIssued'), variant: 'success' });
      setIssueDialog(null);
      setIssueQty('');
      setIssueNotes('');
    },
    onError: (e: any) => toast({ title: t('toast.partsIssueFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const cancelPartMutation = useMutation({
    mutationFn: ({ woId, requestId }: { woId: string; requestId: string }) =>
      api.patch(`/maintenance/work-orders/${woId}/spare-parts/${requestId}/cancel`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'wo-spare-parts', viewWO?.id] });
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      toast({ title: t('toast.partRequestCancelled') });
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  // Request more spare parts on an already-open maintenance order (any time before
  // it is completed/cancelled). Mirrors the create-form picker but posts directly.
  const addSpareMutation = useMutation({
    mutationFn: ({ woId, parts }: { woId: string; parts: Array<{ sparePartId: string; quantityRequested: number }> }) =>
      api.post(`/maintenance/work-orders/${woId}/spare-parts`, { parts }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'wo-spare-parts', viewWO?.id] });
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'work-orders'] });
      queryClient.invalidateQueries({ queryKey: ['maintenance', 'spare-parts', 'all'] });
      setSpareLines([]);
      setShowPartPicker(false);
      toast({ title: t('toast.sparesRequested'), variant: 'success' });
    },
    onError: (e: any) => toast({ title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.sparesRequestFailed'), variant: 'destructive' }),
  });

  const submitAddSpares = () => {
    if (!viewWO || spareLines.length === 0) return;
    addSpareMutation.mutate({
      woId: viewWO.id,
      parts: spareLines.map(l => ({ sparePartId: l.sparePartId, quantityRequested: l.quantityRequested })),
    });
  };

  // ── Handlers ─────────────────────────────────────────────────

  const handleOpenCreate = () => {
    setEditWO(null);
    setForm(EMPTY_FORM);
    setSpareLines([]);
    setFormOpen(true);
  };

  const exportWoPdf = (wo: MaintWO) => {
    const money = (v?: number | null) => (v != null ? `$${v.toLocaleString()}` : '—');
    const dt = (v?: string | null) => (v ? new Date(v).toLocaleString() : '—');
    exportRecordToPDF(`${t('woView.exportTitle')} ${wo.woNumber}`, wo.title ?? '', [
      { heading: t('detail2.summary'), fields: [
        { label: t('col.mo'), value: wo.woNumber }, { label: t('col.title'), value: wo.title },
        { label: t('detail.type'), value: t(`type.${wo.type}`, { defaultValue: wo.type }) }, { label: t('detail.priority'), value: t(`common:priority.${wo.priority}`, { defaultValue: wo.priority }) },
        { label: t('col.status'), value: t(`woStatus.${wo.status}`, { defaultValue: wo.status }) }, { label: t('detail2.description'), value: wo.description ?? '—' },
      ]},
      { heading: t('detail2.context'), fields: [
        { label: t('detail.machine'), value: wo.asset ?? '—' }, { label: t('detail2.requestedBy'), value: wo.requestedBy ?? '—' },
        { label: t('detail.assignedTo'), value: wo.assignedTo ?? '—' },
      ]},
      { heading: t('detail2.timeline'), fields: [
        { label: t('detail.created'), value: dt(wo.createdAt) }, { label: t('detail2.due'), value: dt(wo.dueDate) },
        { label: t('detail.started'), value: dt(wo.startedAt) }, { label: t('detail.completed'), value: dt(wo.completedAt) },
      ]},
      { heading: t('detail2.effortCost'), fields: [
        { label: t('detail.estHours'), value: wo.estimatedHours != null ? String(wo.estimatedHours) : '—' },
        { label: t('detail.actualHours'), value: wo.actualHours != null ? String(wo.actualHours) : '—' },
        { label: t('detail.totalCost'), value: money(wo.totalCost) },
      ]},
      { heading: t('detail2.spareParts'), fields: woSpareParts.length
        ? woSpareParts.map((s, i) => ({ label: t('detail2.partLabel', { n: i + 1 }), value: `${s.sparePart?.name ?? '—'} — ${t('woView.requested')} ${s.quantityRequested}, ${t('woView.issued')} ${s.quantityIssued} (${t(`woView.spareStatus.${s.status}`, { defaultValue: s.status })})` }))
        : [{ label: t('col.parts'), value: t('detail2.partsNone') }] },
      ...(wo.notes ? [{ heading: t('detail2.notes'), fields: [{ label: t('detail2.notes'), value: wo.notes }] }] : []),
    ]);
  };

  const handleOpenEdit = (wo: MaintWO) => {
    setEditWO(wo);
    setForm({
      title: wo.title,
      type: wo.type,
      priority: wo.priority,
      machineId: wo.machineId ?? '',
      machineName: wo.asset ?? '',
      description: wo.description ?? '',
      dueDate: wo.dueDate?.slice(0, 10) ?? '',
      estimatedHours: wo.estimatedHours?.toString() ?? '',
      assignedToId: wo.assignedToId ?? '',
      notes: wo.notes ?? '',
      productionWOId: wo.productionWOId ?? '',
      failureModeIds: (wo as any).failureModeIds ?? ((wo as any).failureModeId ? [(wo as any).failureModeId] : []),
    });
    setSpareLines([]);
    setFormOpen(true);
  };

  const handleCloseForm = () => {
    setFormOpen(false);
    setEditWO(null);
    setForm(EMPTY_FORM);
    setSpareLines([]);
    setSpareSearch('');
    setShowPartPicker(false);
  };

  const handleSubmit = () => {
    const dto: any = {
      title: form.title,
      type: form.type,
      priority: form.priority,
      machineId: form.machineId || undefined,
      description: form.description || undefined,
      dueDate: form.dueDate || undefined,
      estimatedHours: form.estimatedHours ? parseFloat(form.estimatedHours) : undefined,
      assignedToId: form.assignedToId || undefined,
      notes: form.notes || undefined,
      productionWOId: form.productionWOId || undefined,
      failureModeIds: form.failureModeIds,
    };
    if (!editWO && spareLines.length > 0) {
      dto.spareParts = spareLines.map(l => ({
        sparePartId: l.sparePartId,
        quantityRequested: l.quantityRequested,
      }));
    }
    if (editWO) updateMutation.mutate({ id: editWO.id, dto });
    else createMutation.mutate(dto);
  };

  const addSpareLine = (part: SparePart) => {
    setSpareLines(prev => [...prev, {
      sparePartId: part.id,
      partNumber: part.partNumber,
      name: part.name,
      stockQty: part.stockQty,
      unitCost: part.unitCost,
      quantityRequested: 1,
    }]);
    setSpareSearch('');
    setShowPartPicker(false);
  };

  const removeSpareLine = (sparePartId: string) => {
    setSpareLines(prev => prev.filter(l => l.sparePartId !== sparePartId));
  };

  const updateSpareQty = (sparePartId: string, qty: number) => {
    setSpareLines(prev => prev.map(l => l.sparePartId === sparePartId ? { ...l, quantityRequested: qty } : l));
  };

  const isValid = !!(form.title && form.type && form.priority && form.machineId);
  const pendingParts = woSpareParts.filter(p => p.status === 'PENDING');
  const allIssued = woSpareParts.length > 0 && woSpareParts.every(p => p.status === 'ISSUED' || p.status === 'CANCELLED');

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.workOrders.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.workOrders.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            filename="maintenance-orders"
            title={t('woView.exportTitle')}
            rows={orders}
            columns={[
              { key: 'woNumber', label: t('col.mo') },
              { key: 'title', label: t('col.title') },
              { key: 'type', label: t('col.type') },
              { key: 'priority', label: t('col.priority') },
              { key: 'status', label: t('col.status') },
              { key: 'asset', label: t('col.machine'), value: (r: any) => r.asset ?? r.machine?.name ?? '' },
              { key: 'assignedTo', label: t('col.assignedTo'), value: (r: any) => r.assignedTo ?? '' },
              { key: 'dueDate', label: t('col.due'), value: (r: any) => r.dueDate ? new Date(r.dueDate).toLocaleDateString() : '' },
            ]}
          />
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}>
            <Plus size={13} />{t('woView.newOrder')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <InlineFormSlot />

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3">
          {SUMMARY_CARDS.map(({ labelKey, key, icon: Icon, color }) => (
            <div key={key} className="industrial-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">{t(labelKey)}</span>
                <Icon size={14} className={color} />
              </div>
              <p className={cn('text-2xl font-bold mt-1', color)}>{counts[key] ?? 0}</p>
            </div>
          ))}
        </div>

        {/* Table */}
        <div className="industrial-card p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold">{t('allOrders')}</h3>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder={t('search')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-8 ps-7 w-44 text-xs" />
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                    <Filter size={12} />
                    {statusFilter ? t(`woStatus.${statusFilter}`) : t('allStatus')}
                    <ChevronDown size={11} />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem onClick={() => { setStatusFilter(null); setPage(1); }}>{t('allStatus')}</DropdownMenuItem>
                  {Object.keys(STATUS_COLORS).map((k) => (
                    <DropdownMenuItem key={k} onClick={() => { setStatusFilter(k); setPage(1); }}>{t(`woStatus.${k}`)}</DropdownMenuItem>
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
                  {[t('col.mo'), t('col.title'), t('col.type'), t('col.priority'), t('col.status'), t('col.machine'), t('col.assignedTo'), t('col.parts'), t('col.due'), ''].map((h, i) => (
                    <TableHead key={i} className="text-[11px] font-semibold">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 11 }).map((_, j) => (
                        <TableCell key={j}><div className="shimmer h-3.5 rounded w-16" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : orders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground text-sm">
                      {t('noOrders')}
                    </TableCell>
                  </TableRow>
                ) : (
                  orders.map((wo) => {
                    const priority = PRIORITY_CONFIG[wo.priority];
                    return (
                      <TableRow key={wo.id} onClick={() => setViewWO(wo)} className={cn('border-border/20 hover:bg-muted/20 cursor-pointer', sel.isSelected(wo.id) && 'bg-primary/5')}>
                        <TableCell onClick={(e) => e.stopPropagation()}><Checkbox checked={sel.isSelected(wo.id)} onCheckedChange={() => sel.toggle(wo.id)} aria-label={t('selectRow')} /></TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-primary">{wo.woNumber}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium max-w-[140px] truncate">{wo.title}</span>
                            {(wo.sparePartsCount ?? 0) > 0 && (
                              <span
                                className={cn(
                                  'inline-flex items-center gap-0.5 text-[9px] px-1 py-0.5 rounded border',
                                  wo.hasPendingParts ? 'text-amber-400 border-amber-500/30' : 'text-muted-foreground border-border/50',
                                )}
                                title={t('woView.sparePartRequests', { count: wo.sparePartsCount })}
                              >
                                <Package size={9} /> {wo.sparePartsCount}
                              </span>
                            )}
                          </div>
                          {wo.isOverdue && (
                            <span className="text-[10px] text-red-400">{t('overdue')}</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{t(`type.${wo.type}`, { defaultValue: wo.type })}</TableCell>
                        <TableCell>
                          <span className={cn('text-xs font-semibold', priority?.color)}>{t(`common:priority.${wo.priority}`, { defaultValue: wo.priority })}</span>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={STATUS_COLORS[wo.status] ?? 'secondary'}
                            className={cn('text-[10px] h-5', STATUS_EXTRA_CLS[wo.status])}
                          >
                            {t(`woStatus.${wo.status}`, { defaultValue: wo.status })}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{wo.asset ?? '—'}</TableCell>
                        <TableCell>
                          {wo.assignedTo ? (
                            <div className="flex items-center gap-1 text-xs">
                              <User size={10} className="text-muted-foreground" />
                              {wo.assignedTo}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{t('woView.unassigned')}</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {wo.hasPendingParts && (
                            <span className="flex items-center gap-1 text-[10px] text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-1.5 py-0.5 w-fit">
                              <Package size={9} />{t('woView.pendingTag')}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {wo.dueDate ? formatDate(wo.dueDate) : '—'}
                        </TableCell>
                        <TableCell>
                          <TableRowActions
                            onView={() => setViewWO(wo)}
                            onEdit={!['COMPLETED', 'CANCELLED'].includes(wo.status) ? () => handleOpenEdit(wo) : undefined}
                            onDelete={!['COMPLETED', 'CANCELLED', 'IN_PROGRESS'].includes(wo.status)
                              ? () => setDeleteDialog({ id: wo.id, woNumber: wo.woNumber })
                              : undefined}
                            extraActions={[
                              {
                                label: t('woView.startOrder'),
                                icon: Play,
                                onClick: () => startMutation.mutate(wo.id),
                                variant: 'success',
                                hidden: wo.status !== 'ASSIGNED',
                              },
                              {
                                label: t('woView.cancelOrder'),
                                icon: Ban,
                                onClick: () => { setCancelDialog({ wo }); setCancelReason(''); },
                                variant: 'destructive',
                                separator: true,
                                hidden: !['OPEN', 'AWAITING_PARTS', 'ASSIGNED', 'ON_HOLD'].includes(wo.status),
                              },
                            ]}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      {/* ── Create / Edit — inline form ──────────────────────── */}
      <InlineFormPanel
        open={formOpen}
        onClose={handleCloseForm}
        icon={Wrench}
        title={editWO ? `${t('mform.editPrefix')} — ${editWO.woNumber}` : t('mform.createTitle')}
        description={editWO ? t('mform.editDesc', { defaultValue: 'Update maintenance order details.' }) : t('mform.createDesc', { defaultValue: 'Fill in the details and optionally pre-request spare parts from inventory.' })}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={handleCloseForm}>{t('common:actions.cancel')}</Button>
            <Button
              size="sm"
              disabled={!isValid || createMutation.isPending || updateMutation.isPending}
              onClick={handleSubmit}
            >
              {createMutation.isPending || updateMutation.isPending
                ? (editWO ? t('common:actions.saving') : t('common:actions.saving'))
                : (editWO ? t('mform.save') : t('mform.createTitle'))
              }
            </Button>
          </>
        )}
      >
          <div className="space-y-5">
            {/* Core fields */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('woView.orderDetails')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">{t('mform.title')} <span className="text-destructive">*</span></Label>
                  <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder={t('mform.titlePlaceholder')} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('mform.type')} <span className="text-destructive">*</span></Label>
                  <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TYPE_KEYS.map((k) => (
                        <SelectItem key={k} value={k}>{t(`type.${k}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('mform.priority')} <span className="text-destructive">*</span></Label>
                  <Select value={form.priority} onValueChange={v => setForm(f => ({ ...f, priority: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.keys(PRIORITY_CONFIG).map((k) => (
                        <SelectItem key={k} value={k}>{t(`common:priority.${k}`)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">{t('mform.machine')} <span className="text-destructive">*</span></Label>
                  <MachinePicker
                    value={form.machineId || null}
                    onChange={(id, node) => setForm(f => ({ ...f, machineId: id ?? '', machineName: node?.name ?? '' }))}
                    placeholder={t('mform.browseMachine')}
                    className="h-9"
                  />
                </div>
                {/* Assigned To */}
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">{t('mform.assignTo')}</Label>
                  <EntityPicker
                    items={technicianOptions}
                    value={form.assignedToId || null}
                    onChange={id => setForm(f => ({ ...f, assignedToId: id ?? '' }))}
                    getId={u => u.id}
                    getPrimary={u => u.name}
                    getMeta={u => <span className="text-muted-foreground">{u.role}</span>}
                    placeholder={t('mform.unassigned')}
                    searchPlaceholder={t('mform.searchTechnicians')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('mform.dueDate')}</Label>
                  <Input type="date" value={form.dueDate} onChange={e => setForm(f => ({ ...f, dueDate: e.target.value }))} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('mform.estHours')}</Label>
                  <Input type="number" min="0" step="0.5" value={form.estimatedHours} onChange={e => setForm(f => ({ ...f, estimatedHours: e.target.value }))} className="h-9" placeholder="0.0" />
                </div>
                {/* Failure Mode (FMEA) */}
                <div className="col-span-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">{t('mform.failureMode')} <span className="text-[10px] font-normal text-muted-foreground">({t('mform.failureModeHint')})</span></Label>
                    <button
                      type="button"
                      disabled={!form.machineId}
                      onClick={() => setFmManagerOpen(true)}
                      className="text-muted-foreground hover:text-foreground transition-colors p-0.5 rounded disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-1 text-[11px]"
                      title={form.machineId ? t('fmManager.manage') : t('mform.selectMachineFirst')}
                    >
                      <Settings2 size={13} /> {t('fmManager.manage')}
                    </button>
                  </div>
                  <FailureModeMultiSelect
                    items={failureModeOptions}
                    value={form.failureModeIds}
                    onChange={ids => setForm(f => ({ ...f, failureModeIds: ids }))}
                    disabled={!form.machineId}
                    placeholder={form.machineId ? t('mform.linkFailureMode') : t('mform.selectMachineFirst')}
                    addLabel={t('mform.addFailureMode')}
                    searchPlaceholder={t('mform.searchFailureModes')}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">{t('mform.description')}</Label>
                  <textarea
                    className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder={t('mform.descPlaceholder')}
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">{t('mform.internalNotes')}</Label>
                  <textarea
                    className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-xs resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                    value={form.notes}
                    onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    placeholder={t('mform.notesPlaceholder')}
                  />
                </div>
                {/* Production Work Order Link */}
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">{t('mform.linkPO')} <span className="text-[10px] font-normal text-muted-foreground">({t('mform.optional')})</span></Label>
                  <EntityPicker
                    items={prodWOOptions}
                    value={form.productionWOId || null}
                    onChange={id => setForm(f => ({ ...f, productionWOId: id ?? '' }))}
                    getId={wo => wo.id}
                    getPrimary={wo => wo.orderNumber}
                    getMeta={wo => <span className="text-muted-foreground">{wo.status}</span>}
                    placeholder={t('mform.notLinkedPO')}
                    searchPlaceholder={t('mform.searchProdOrders')}
                  />
                </div>
              </div>
            </div>

            {/* Spare Parts — only on create */}
            {!editWO && (
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <Package size={10} className="text-brand-400" />
                  {t('woView.sparePartsRequired')}
                  <span className="font-normal text-muted-foreground/60 normal-case tracking-normal">{t('woView.optional')}</span>
                </p>

                {spareLines.length > 0 && (
                  <div className="mb-2 border border-border/40 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/30 border-b border-border/30">
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('woView.tblPart')}</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('woView.tblInStock')}</th>
                          <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('woView.tblQtyNeeded')}</th>
                          <th className="px-3 py-2 w-8" />
                        </tr>
                      </thead>
                      <tbody>
                        {spareLines.map(line => (
                          <tr key={line.sparePartId} className="border-b border-border/20 last:border-0">
                            <td className="px-3 py-2">
                              <div className="font-medium">{line.name}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">{line.partNumber}</div>
                            </td>
                            <td className="px-3 py-2">
                              <span className={cn('font-medium', line.stockQty <= 0 ? 'text-red-400' : 'text-green-400')}>
                                {line.stockQty}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <Input
                                type="number"
                                min={1}
                                value={line.quantityRequested}
                                onChange={e => updateSpareQty(line.sparePartId, parseInt(e.target.value) || 1)}
                                className={cn('h-7 w-20', line.quantityRequested > line.stockQty && 'border-amber-400/60')}
                              />
                              {line.quantityRequested > line.stockQty && (
                                <div className="text-[10px] text-amber-400 mt-0.5">{t('woView.exceedsStock')}</div>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <button onClick={() => removeSpareLine(line.sparePartId)} className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-destructive transition-colors">
                                <X size={12} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Part picker */}
                {showPartPicker ? (
                  <div className="border border-border/50 rounded-lg p-2 space-y-2">
                    <div className="relative">
                      <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        autoFocus
                        value={spareSearch}
                        onChange={e => setSpareSearch(e.target.value)}
                        placeholder={t('woView.searchPart')}
                        className="h-8 pl-7 text-xs"
                      />
                    </div>
                    <div className="max-h-40 overflow-y-auto space-y-0.5">
                      {availableParts.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-3">
                          {spareSearch ? t('woView.noMatchingParts') : t('woView.allPartsAdded')}
                        </p>
                      ) : (
                        availableParts.slice(0, 20).map(p => (
                          <button
                            key={p.id}
                            onClick={() => addSpareLine(p)}
                            className="w-full flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-muted/60 text-left transition-colors"
                          >
                            <div>
                              <div className="text-xs font-medium">{p.name}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">{p.partNumber}</div>
                            </div>
                            <div className="text-right shrink-0 ml-4">
                              <div className={cn('text-xs font-medium', p.stockQty <= 0 ? 'text-red-400' : 'text-green-400')}>
                                {t('woView.qtyInStock', { count: p.stockQty })}
                              </div>
                              {p.unitCost && <div className="text-[10px] text-muted-foreground">{t('woView.sarPerEach', { value: p.unitCost })}</div>}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                    <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={() => setShowPartPicker(false)}>
                      {t('woView.done')}
                    </Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 w-full" onClick={() => setShowPartPicker(true)}>
                    <Plus size={12} />{t('woView.addSparePart')}
                  </Button>
                )}

                {spareLines.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-2 text-[11px] text-brand-400 bg-brand-400/5 border border-brand-400/20 rounded-md px-2.5 py-1.5">
                    <Info size={10} />
                    {t('woView.partsRequested', { count: spareLines.length })}
                  </div>
                )}
              </div>
            )}
          </div>
      </InlineFormPanel>

      {/* Failure Mode (FMEA) manager — scoped to the selected machine */}
      {form.machineId && (
        <FailureModeManager
          machineId={form.machineId}
          machineName={form.machineName}
          open={fmManagerOpen}
          onOpenChange={setFmManagerOpen}
        />
      )}

      {/* ── MO Detail Sheet ──────────────────────────────────── */}
      <Sheet open={!!viewWO} onOpenChange={o => { if (!o) { setViewWO(null); setSpareLines([]); setShowPartPicker(false); setSpareSearch(''); } }}>
        <SheetContent className="w-full max-w-xl flex flex-col">
          <SheetHeader className="pr-6 shrink-0">
            {viewWO && (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SheetTitle className="font-mono text-sm">{viewWO.woNumber}</SheetTitle>
                  <SheetDescription className="mt-0.5 text-xs line-clamp-2">{viewWO.title}</SheetDescription>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={() => exportWoPdf(viewWO)}>
                    <FileText size={12} /> PDF
                  </Button>
                  <Badge
                    variant={STATUS_COLORS[viewWO.status] ?? 'secondary'}
                    className={cn(STATUS_EXTRA_CLS[viewWO.status])}
                  >
                    {t(`woStatus.${viewWO.status}`, { defaultValue: viewWO.status })}
                  </Badge>
                </div>
              </div>
            )}
          </SheetHeader>

          {viewWO && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {/* Details grid */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('detail.title')}</p>
                <div className="industrial-card rounded-lg px-3">
                  {[
                    { label: t('detail.type'),        value: t(`type.${viewWO.type}`, { defaultValue: viewWO.type }) },
                    { label: t('detail.priority'),    value: t(`common:priority.${viewWO.priority}`, { defaultValue: viewWO.priority }) },
                    { label: t('detail.machine'),     value: viewWO.asset },
                    { label: t('detail.assignedTo'),  value: viewWO.assignedTo },
                    { label: t('detail.dueDate'),     value: viewWO.dueDate ? formatDate(viewWO.dueDate) : null },
                    { label: t('detail.estHours'),    value: viewWO.estimatedHours ? `${viewWO.estimatedHours}h` : null },
                    { label: t('detail.actualHours'), value: viewWO.actualHours ? `${viewWO.actualHours}h` : null },
                    { label: t('detail.totalCost'),   value: viewWO.totalCost ? `${viewWO.totalCost} SAR` : null },
                    { label: t('detail.created'),     value: formatDate(viewWO.createdAt) },
                    { label: t('detail.started'),     value: viewWO.startedAt ? formatDate(viewWO.startedAt) : null },
                    { label: t('detail.completed'),   value: viewWO.completedAt ? formatDate(viewWO.completedAt) : null },
                    { label: t('detail.productionOrder'), value: viewWO.productionWO ? (
                      <span className="font-mono text-xs font-semibold text-blue-400">{viewWO.productionWO.orderNumber}</span>
                    ) : null },
                  ].map(row => (
                    <div key={row.label} className="flex items-start gap-2 py-2 border-b border-border/20 last:border-0">
                      <span className="text-[11px] text-muted-foreground w-24 shrink-0 pt-0.5">{row.label}</span>
                      <span className="text-xs font-medium flex-1">{row.value ?? <span className="text-muted-foreground">—</span>}</span>
                    </div>
                  ))}
                </div>
              </div>

              {viewWO.description && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('woView.descriptionSection')}</p>
                  <div className="industrial-card rounded-lg px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">{viewWO.description}</p>
                  </div>
                </div>
              )}

              {/* Maintenance instructions/guides + work evidence photos */}
              <Attachments entityType="MAINTENANCE_WO" entityId={viewWO.id} category="INSTRUCTION" title={t('common:attach.instructions')} />
              <Attachments entityType="MAINTENANCE_WO" entityId={viewWO.id} category="EVIDENCE" title={t('common:attach.evidence')} />

              {viewWO.notes && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('woView.internalNotesSection')}</p>
                  <div className="industrial-card rounded-lg px-3 py-2.5">
                    <p className="text-xs text-muted-foreground">{viewWO.notes}</p>
                  </div>
                </div>
              )}

              {/* ── Spare Parts Section ─────────────────────── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                    <Package size={10} className="text-brand-400" />
                    {t('woView.spareParts')}
                    {woSpareParts.length > 0 && (
                      <span className="normal-case tracking-normal font-normal">
                        — {pendingParts.length > 0 ? (
                          <span className="text-amber-400">{t('woView.pendingDelivery', { count: pendingParts.length })}</span>
                        ) : allIssued ? (
                          <span className="text-green-400">{t('woView.allIssued')}</span>
                        ) : (
                          <span>{t('woView.partsCount', { count: woSpareParts.length })}</span>
                        )}
                      </span>
                    )}
                  </p>
                </div>

                {/* Request more parts at any time while the order is still open */}
                {!['COMPLETED', 'CANCELLED'].includes(viewWO.status) && (
                  <div className="mb-2">
                    {(showPartPicker || spareLines.length > 0) ? (
                      <div className="border border-border/50 rounded-lg p-2 space-y-2">
                        {spareLines.length > 0 && (
                          <div className="border border-border/40 rounded-lg overflow-hidden">
                            <table className="w-full text-xs">
                              <tbody>
                                {spareLines.map(line => (
                                  <tr key={line.sparePartId} className="border-b border-border/20 last:border-0">
                                    <td className="px-3 py-2">
                                      <div className="font-medium">{line.name}</div>
                                      <div className="text-[10px] text-muted-foreground font-mono">{line.partNumber}</div>
                                    </td>
                                    <td className="px-3 py-2">
                                      <Input type="number" min={1} value={line.quantityRequested}
                                        onChange={e => updateSpareQty(line.sparePartId, parseInt(e.target.value) || 1)}
                                        className={cn('h-7 w-20', line.quantityRequested > line.stockQty && 'border-amber-400/60')} />
                                    </td>
                                    <td className="px-2 py-2 w-8">
                                      <button onClick={() => removeSpareLine(line.sparePartId)} className="p-1 rounded hover:bg-muted/60 text-muted-foreground hover:text-destructive transition-colors"><X size={12} /></button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {showPartPicker ? (
                          <>
                            <div className="relative">
                              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                              <Input autoFocus value={spareSearch} onChange={e => setSpareSearch(e.target.value)} placeholder={t('woView.searchPart')} className="h-8 pl-7 text-xs" />
                            </div>
                            <div className="max-h-40 overflow-y-auto space-y-0.5">
                              {availableParts.length === 0 ? (
                                <p className="text-xs text-muted-foreground text-center py-3">{spareSearch ? t('woView.noMatchingParts') : t('woView.allPartsAdded')}</p>
                              ) : (
                                availableParts.slice(0, 20).map(p => (
                                  <button key={p.id} onClick={() => addSpareLine(p)} className="w-full flex items-center justify-between px-2.5 py-2 rounded-md hover:bg-muted/60 text-left transition-colors">
                                    <div><div className="text-xs font-medium">{p.name}</div><div className="text-[10px] text-muted-foreground font-mono">{p.partNumber}</div></div>
                                    <div className={cn('text-xs font-medium shrink-0 ml-4', p.stockQty <= 0 ? 'text-red-400' : 'text-green-400')}>{t('woView.qtyInStock', { count: p.stockQty })}</div>
                                  </button>
                                ))
                              )}
                            </div>
                          </>
                        ) : (
                          <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 w-full" onClick={() => setShowPartPicker(true)}><Plus size={12} />{t('woView.addAnotherPart')}</Button>
                        )}
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs flex-1 gap-1.5" disabled={spareLines.length === 0 || addSpareMutation.isPending} onClick={submitAddSpares}>
                            <Package size={11} />{addSpareMutation.isPending ? t('woView.requesting') : t('woView.requestNParts', { count: spareLines.length })}
                          </Button>
                          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setSpareLines([]); setShowPartPicker(false); setSpareSearch(''); }}>{t('woView.cancel')}</Button>
                        </div>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 w-full" onClick={() => setShowPartPicker(true)}>
                        <Plus size={12} />{t('woView.requestSpareParts')}
                      </Button>
                    )}
                  </div>
                )}

                {woSpareParts.length === 0 ? (
                  <div className="industrial-card rounded-lg px-3 py-4 text-center">
                    <Package size={20} className="mx-auto mb-1.5 text-muted-foreground/30" />
                    <p className="text-xs text-muted-foreground">{t('woView.noSparesRequested')}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {woSpareParts.map(req => {
                      const cfg = SPARE_STATUS_CONFIG[req.status] ?? SPARE_STATUS_CONFIG.PENDING;
                      const Icon = cfg.icon;
                      const remaining = req.quantityRequested - req.quantityIssued;
                      return (
                        <div key={req.id} className="industrial-card rounded-lg p-3 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-medium truncate">{req.sparePart.name}</div>
                              <div className="text-[10px] text-muted-foreground font-mono">{req.sparePart.partNumber}</div>
                              {req.sparePart.storageLocation && (
                                <div className="text-[10px] text-muted-foreground mt-0.5">📍 {req.sparePart.storageLocation}</div>
                              )}
                            </div>
                            <span className={cn('flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border shrink-0', cfg.cls)}>
                              <Icon size={9} />{t(`woView.spareStatus.${req.status}`, { defaultValue: t(cfg.labelKey) })}
                            </span>
                          </div>

                          <div className="grid grid-cols-3 gap-2 text-[11px]">
                            <div className="industrial-card rounded px-2 py-1 text-center">
                              <div className="text-muted-foreground">{t('woView.requested')}</div>
                              <div className="font-bold tabular-nums">{req.quantityRequested}</div>
                            </div>
                            <div className="industrial-card rounded px-2 py-1 text-center">
                              <div className="text-muted-foreground">{t('woView.issued')}</div>
                              <div className={cn('font-bold tabular-nums', req.quantityIssued > 0 ? 'text-green-400' : '')}>
                                {req.quantityIssued}
                              </div>
                            </div>
                            <div className="industrial-card rounded px-2 py-1 text-center">
                              <div className="text-muted-foreground">{t('woView.inStock')}</div>
                              <div className={cn('font-bold tabular-nums', req.sparePart.stockQty <= 0 ? 'text-red-400' : 'text-green-400')}>
                                {req.sparePart.stockQty}
                              </div>
                            </div>
                          </div>

                          {req.issuedBy && (
                            <div className="text-[10px] text-muted-foreground flex items-center gap-1">
                              <User size={9} />{t('woView.issuedBy', { name: req.issuedBy.name })}
                              {req.issuedAt && ` · ${formatDate(req.issuedAt)}`}
                            </div>
                          )}
                          {req.notes && (
                            <div className="text-[10px] text-muted-foreground italic">{req.notes}</div>
                          )}

                          {/* Actions */}
                          {req.status === 'PENDING' && (
                            <div className="flex gap-2 pt-1">
                              <Button
                                size="sm"
                                className="h-7 text-xs flex-1 gap-1.5"
                                onClick={() => {
                                  setIssueDialog({ request: req });
                                  setIssueQty(remaining.toString());
                                  setIssueNotes('');
                                }}
                              >
                                <PackageCheck size={11} />{t('woView.issueParts')}
                              </Button>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => cancelPartMutation.mutate({ woId: viewWO.id, requestId: req.id })}
                                disabled={cancelPartMutation.isPending}
                              >
                                <X size={11} />{t('woView.cancel')}
                              </Button>
                            </div>
                          )}
                          {req.status === 'PARTIAL' && (
                            <Button
                              size="sm"
                              className="h-7 text-xs w-full gap-1.5"
                              onClick={() => {
                                setIssueDialog({ request: req });
                                setIssueQty(remaining.toString());
                                setIssueNotes('');
                              }}
                            >
                              <PackageMinus size={11} />{t('woView.issueRemaining', { count: remaining })}
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {viewWO && (
            <div className="px-6 py-3 border-t border-border/50 shrink-0 space-y-2">
              {/* AWAITING_PARTS banner */}
              {viewWO.status === 'AWAITING_PARTS' && (
                <div className="flex items-center gap-2 rounded-lg px-3 py-2 bg-amber-400/10 border border-amber-400/30 text-amber-400 text-xs">
                  <Package size={12} className="shrink-0" />
                  <span>{t('woView.awaitingPartsBanner')}</span>
                </div>
              )}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Edit — not for COMPLETED/CANCELLED */}
                {!['COMPLETED', 'CANCELLED'].includes(viewWO.status) && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => { setViewWO(null); handleOpenEdit(viewWO); }}>
                    {t('woView.editOrder')}
                  </Button>
                )}
                {/* Assign — for OPEN or AWAITING_PARTS */}
                {['OPEN', 'AWAITING_PARTS'].includes(viewWO.status) && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-blue-400 border-blue-400/30 hover:bg-blue-400/10"
                    onClick={() => { setAssignDialog({ wo: viewWO }); setAssignUserId(''); setAssignNotes(''); }}>
                    <User size={11} />{t('woView.assignTechnician')}
                  </Button>
                )}
                {/* Start — for ASSIGNED */}
                {viewWO.status === 'ASSIGNED' && (
                  <Button size="sm" className="h-7 text-xs gap-1.5"
                    onClick={() => { startMutation.mutate(viewWO.id); }}>
                    <Play size={11} />{t('woView.startWork')}
                  </Button>
                )}
                {/* Complete — for IN_PROGRESS */}
                {viewWO.status === 'IN_PROGRESS' && (
                  <Button size="sm" className="h-7 text-xs gap-1.5 bg-green-500 hover:bg-green-600 text-white"
                    onClick={() => { setCompleteDialog({ wo: viewWO }); setCompleteForm({ actualHours: '', laborCost: '', partsCost: '', runtimeHoursAtService: '', notes: '' }); }}>
                    <CheckCircle size={11} />{t('woView.completeOrder')}
                  </Button>
                )}
                {/* Hold — for IN_PROGRESS */}
                {viewWO.status === 'IN_PROGRESS' && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                    onClick={() => { setHoldDialog({ wo: viewWO }); setHoldReason(''); }}>
                    <Clock size={11} />{t('woView.putOnHold')}
                  </Button>
                )}
                {/* Resume — for ON_HOLD */}
                {viewWO.status === 'ON_HOLD' && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => { resumeMutation.mutate(viewWO.id); }}>
                    <Play size={11} />{t('woView.resume')}
                  </Button>
                )}
                {/* Cancel — not for COMPLETED/CANCELLED */}
                {!['COMPLETED', 'CANCELLED'].includes(viewWO.status) && (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 ml-auto"
                    onClick={() => { setCancelDialog({ wo: viewWO }); setCancelReason(''); }}>
                    <Ban size={11} />{t('woView.cancelOrder')}
                  </Button>
                )}
                {/* Archive / Restore */}
                {(viewWO as any).archivedAt ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => { restoreWO.mutate(viewWO.id); setViewWO(null); }}>
                    <RotateCcw size={11} />{t('woView.restore')}
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                    onClick={() => { archiveWO.mutate(viewWO.id); setViewWO(null); }}>
                    <ArchiveIcon size={11} />{t('woView.archive')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Issue Parts Dialog ───────────────────────────────── */}
      {issueDialog && (
        <Dialog open onOpenChange={o => !o && setIssueDialog(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <PackageCheck size={14} className="text-green-400" />
                {t('woView.issueDialogTitle')}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {t('woView.issueDialogDescPre', { defaultValue: 'Confirm delivery of' })} <span className="font-medium text-foreground">{issueDialog.request.sparePart.name}</span> {t('woView.issueDialogDescPost', { defaultValue: 'to the maintenance team.' })}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-1">
              {/* Summary */}
              <div className="industrial-card rounded-lg px-3 py-2 space-y-1.5">
                {[
                  { label: t('woView.issuePartNumber'),  value: issueDialog.request.sparePart.partNumber },
                  { label: t('woView.issueRequested'),   value: t('woView.unitsSuffix', { count: issueDialog.request.quantityRequested }) },
                  { label: t('woView.issuePrevIssued'),  value: t('woView.unitsSuffix', { count: issueDialog.request.quantityIssued }) },
                  { label: t('woView.issueAvailable'),   value: t('woView.unitsSuffix', { count: issueDialog.request.sparePart.stockQty }) },
                ].map(r => (
                  <div key={r.label} className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{r.label}</span>
                    <span className="font-medium">{r.value}</span>
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{t('woView.qtyToIssue')} <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min={1}
                  max={issueDialog.request.sparePart.stockQty}
                  value={issueQty}
                  onChange={e => setIssueQty(e.target.value)}
                  className={cn('h-9', parseInt(issueQty) > issueDialog.request.sparePart.stockQty && 'border-red-500/60')}
                  autoFocus
                />
                {parseInt(issueQty) > issueDialog.request.sparePart.stockQty && (
                  <p className="text-[11px] text-red-400">{t('woView.exceedsAvailable', { count: issueDialog.request.sparePart.stockQty })}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{t('woView.notesOptional')}</Label>
                <Input
                  value={issueNotes}
                  onChange={e => setIssueNotes(e.target.value)}
                  placeholder={t('woView.issueNotesPlaceholder')}
                  className="h-9"
                />
              </div>
            </div>

            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setIssueDialog(null)}>{t('woView.cancel')}</Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={
                  !issueQty ||
                  parseInt(issueQty) <= 0 ||
                  parseInt(issueQty) > issueDialog.request.sparePart.stockQty ||
                  issueMutation.isPending
                }
                onClick={() => {
                  if (!viewWO) return;
                  issueMutation.mutate({
                    woId: viewWO.id,
                    requestId: issueDialog.request.id,
                    dto: {
                      quantityIssued: parseInt(issueQty),
                      notes: issueNotes || undefined,
                    },
                  });
                }}
              >
                <PackageCheck size={12} />
                {issueMutation.isPending ? t('woView.issuing') : t('woView.confirmIssue')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Assign Technician Dialog ─────────────────────────── */}
      {assignDialog && (
        <Dialog open onOpenChange={o => !o && setAssignDialog(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <User size={14} className="text-blue-400" />{t('woView.assignDialogTitle')}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {t('woView.assigningWO', { wo: assignDialog.wo.woNumber })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('woView.technician')} <span className="text-destructive">*</span></Label>
                <EntityPicker
                  items={technicianOptions}
                  value={assignUserId || null}
                  onChange={id => setAssignUserId(id ?? '')}
                  getId={u => u.id}
                  getPrimary={u => u.name}
                  getMeta={u => <span className="text-muted-foreground">{u.role}</span>}
                  placeholder={t('mform.selectTechnician')}
                  searchPlaceholder={t('mform.searchTechnicians')}
                  clearable={false}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('woView.notesOptional')}</Label>
                <Input value={assignNotes} onChange={e => setAssignNotes(e.target.value)} placeholder={t('woView.assignNotesPlaceholder')} className="h-9" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setAssignDialog(null)}>{t('woView.cancel')}</Button>
              <Button size="sm" disabled={!assignUserId || assignMutation.isPending}
                onClick={() => assignMutation.mutate({ woId: assignDialog.wo.id, dto: { assignedToId: assignUserId, notes: assignNotes || undefined } })}>
                {assignMutation.isPending ? t('woView.assigning') : t('woView.assign')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Complete Order Dialog ────────────────────────────── */}
      {completeDialog && (
        <Dialog open onOpenChange={o => !o && setCompleteDialog(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <CheckCircle size={14} className="text-green-400" />{t('woView.completeDialogTitle')}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {t('woView.completingWO', { wo: completeDialog.wo.woNumber })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('woView.actualHoursWorked')} <span className="text-destructive">*</span></Label>
                <Input type="number" min="0" step="0.5" value={completeForm.actualHours}
                  onChange={e => setCompleteForm(f => ({ ...f, actualHours: e.target.value }))} placeholder="0.0" className="h-9" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('woView.laborCostSar')}</Label>
                  <Input type="number" min="0" step="0.01" value={completeForm.laborCost}
                    onChange={e => setCompleteForm(f => ({ ...f, laborCost: e.target.value }))} placeholder="0.00" className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('woView.partsCostSar')}</Label>
                  <Input type="number" min="0" step="0.01" value={completeForm.partsCost}
                    onChange={e => setCompleteForm(f => ({ ...f, partsCost: e.target.value }))} placeholder="0.00" className="h-9" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('woView.runtimeAtService')} <span className="text-[10px] font-normal text-muted-foreground">{t('woView.machineMeter')}</span></Label>
                <Input type="number" min="0" step="1" value={completeForm.runtimeHoursAtService}
                  onChange={e => setCompleteForm(f => ({ ...f, runtimeHoursAtService: e.target.value }))} placeholder="e.g. 4200" className="h-9" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">{t('woView.completionNotes')}</Label>
                <Input value={completeForm.notes} onChange={e => setCompleteForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder={t('woView.completionNotesPlaceholder')} className="h-9" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setCompleteDialog(null)}>{t('woView.cancel')}</Button>
              <Button size="sm" className="bg-green-500 hover:bg-green-600 text-white gap-1.5"
                disabled={!completeForm.actualHours || completeMutation.isPending}
                onClick={() => completeMutation.mutate({
                  woId: completeDialog.wo.id,
                  dto: {
                    actualHours: parseFloat(completeForm.actualHours),
                    laborCost: completeForm.laborCost ? parseFloat(completeForm.laborCost) : undefined,
                    partsCost: completeForm.partsCost ? parseFloat(completeForm.partsCost) : undefined,
                    runtimeHoursAtService: completeForm.runtimeHoursAtService ? parseFloat(completeForm.runtimeHoursAtService) : undefined,
                    notes: completeForm.notes || undefined,
                  },
                })}>
                <CheckCircle size={12} />{completeMutation.isPending ? t('woView.completing') : t('woView.markComplete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Hold Dialog ──────────────────────────────────────── */}
      {holdDialog && (
        <Dialog open onOpenChange={o => !o && setHoldDialog(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2">
                <Clock size={14} className="text-amber-400" />{t('woView.holdDialogTitle')}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {t('woView.pausingWO', { wo: holdDialog.wo.woNumber })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('woView.reasonOptional')}</Label>
                <Input value={holdReason} onChange={e => setHoldReason(e.target.value)}
                  placeholder={t('woView.holdReasonPlaceholder')} className="h-9" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setHoldDialog(null)}>{t('woView.cancel')}</Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-amber-400 border-amber-400/30 hover:bg-amber-400/10"
                disabled={holdMutation.isPending}
                onClick={() => holdMutation.mutate({ woId: holdDialog.wo.id, dto: { reason: holdReason || undefined } })}>
                <Clock size={12} />{holdMutation.isPending ? t('woView.holding') : t('woView.confirmHold')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* ── Cancel Dialog ────────────────────────────────────── */}
      {cancelDialog && (
        <Dialog open onOpenChange={o => !o && setCancelDialog(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm flex items-center gap-2 text-destructive">
                <Ban size={14} />{t('woView.cancelDialogTitle')}
              </DialogTitle>
              <DialogDescription className="text-xs">
                {t('woView.cancellingWO', { wo: cancelDialog.wo.woNumber })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-1">
              <div className="space-y-1.5">
                <Label className="text-xs">{t('woView.reason')} <span className="text-destructive">*</span></Label>
                <Input value={cancelReason} onChange={e => setCancelReason(e.target.value)}
                  placeholder={t('woView.cancelReasonPlaceholder')} className="h-9" />
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" size="sm" onClick={() => setCancelDialog(null)}>{t('woView.back')}</Button>
              <Button size="sm" variant="destructive" className="gap-1.5"
                disabled={cancelReason.trim().length < 5 || cancelMutation.isPending}
                onClick={() => cancelMutation.mutate({ woId: cancelDialog.wo.id, reason: cancelReason.trim() })}>
                <Ban size={12} />{cancelMutation.isPending ? t('woView.cancelling') : t('woView.confirmCancel')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('woView.deleteTitle', { wo: deleteDialog?.woNumber })}
        description={t('woView.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('woView.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('woView.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  );
}
