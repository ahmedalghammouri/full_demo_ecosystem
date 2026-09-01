'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import {
  Plus, Search, AlertTriangle, Pencil, Trash2, MoreHorizontal, Archive as ArchiveIcon, RotateCcw,
  Layers3, TrendingDown, DollarSign, Package, SlidersHorizontal,
  History, Boxes, ArrowUp, ArrowDown,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { Checkbox } from '@/components/ui/checkbox';
import { useRowSelection } from '@/hooks/use-row-selection';
import { useArchive } from '@/hooks/use-archive';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';

// ── Types ────────────────────────────────────────────────────

interface StorageLocationOption {
  id: string;
  code: string;
  name: string;
  zone: string;
}

interface RawMaterial {
  id: string;
  code: string;
  name: string;
  category: string | null;
  unit: string;
  unitCost: number | null;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
  minStock: number;
  reorderPoint: number | null;
  storageLocation: string | null;
  storageLocationId: string | null;
  supplierName: string | null;
  isLowStock: boolean;
  stockValue: number | null;
  isActive: boolean;
  archivedAt: string | null;
}

interface RawMaterialsResponse {
  data: RawMaterial[];
  total: number;
  page: number;
}

interface StockMovement {
  id: string;
  movementType: string;
  quantity: number;
  stockBefore: number | null;
  stockAfter: number | null;
  referenceType: string | null;
  referenceNumber: string | null;
  notes: string | null;
  createdAt: string;
  performedBy?: { name: string | null } | null;
}

interface LinkedLot {
  id: string;
  lotNumber: string;
  supplierName: string | null;
  quantity: number;
  remainingQty: number;
  unit: string;
  status: string;
  receivedAt: string;
  expiryDate: string | null;
  storageLocation: string | null;
  utilizationPct: number;
  isExpired: boolean;
}

type RawMaterialCategory = 'RAW' | 'PACKAGING' | 'CONSUMABLE' | 'CHEMICAL' | 'LABEL';

interface MaterialFormState {
  code: string;
  name: string;
  category: string;
  unit: string;
  unitCost: string;
  minStock: string;
  maxStock: string;
  reorderPoint: string;
  storageLocationId: string;
  supplierName: string;
  leadTimeDays: string;
}

// ── Constants ────────────────────────────────────────────────

const CATEGORIES: RawMaterialCategory[] = ['RAW', 'PACKAGING', 'CONSUMABLE', 'CHEMICAL', 'LABEL'];

const CATEGORY_COLORS: Record<string, string> = {
  RAW:        'text-green-400 border-green-400/30 bg-green-400/10',
  PACKAGING:  'text-blue-400 border-blue-400/30 bg-blue-400/10',
  CONSUMABLE: 'text-amber-400 border-amber-400/30 bg-amber-400/10',
  CHEMICAL:   'text-red-400 border-red-400/30 bg-red-400/10',
  LABEL:      'text-purple-400 border-purple-400/30 bg-purple-400/10',
};

const MOVEMENT_COLORS: Record<string, string> = {
  RECEIPT:     'text-green-400 border-green-400/40',
  RETURN:      'text-green-400 border-green-400/40',
  ISSUE:       'text-red-400 border-red-400/40',
  CONSUMPTION: 'text-red-400 border-red-400/40',
  ADJUSTMENT:  'text-amber-400 border-amber-400/40',
  RESERVATION: 'text-blue-400 border-blue-400/40',
  RELEASE:     'text-blue-400 border-blue-400/40',
};

const LOT_STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'text-green-400 border-green-400/40',
  COMPLETED: 'text-muted-foreground border-border',
  RELEASED: 'text-blue-400 border-blue-400/40',
  REJECTED: 'text-red-400 border-red-400/40',
  ON_HOLD: 'text-amber-400 border-amber-400/40',
  QUARANTINE: 'text-orange-400 border-orange-400/40',
};

const EMPTY_FORM: MaterialFormState = {
  code: '', name: '', category: '', unit: 'KG', unitCost: '',
  minStock: '', maxStock: '', reorderPoint: '', storageLocationId: '',
  supplierName: '', leadTimeDays: '',
};

function getStockStatus(material: RawMaterial): { labelKey: string; cls: string } {
  if (material.isLowStock) return { labelKey: 'rawMaterialsView.status.lowStock', cls: 'text-amber-400 border-amber-400/30 bg-amber-400/10' };
  if (material.reorderPoint && material.availableStock <= material.reorderPoint)
    return { labelKey: 'rawMaterialsView.status.reorder', cls: 'text-orange-400 border-orange-400/30 bg-orange-400/10' };
  return { labelKey: 'rawMaterialsView.status.normal', cls: 'text-green-400 border-green-400/30 bg-green-400/10' };
}

// ── Component ────────────────────────────────────────────────

export function RawMaterialsView() {
  const { t, i18n } = useTranslation(['inventory', 'common']);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [archived, setArchived] = useState<ArchiveScope>('active');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editMaterial, setEditMaterial] = useState<RawMaterial | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState<MaterialFormState>(EMPTY_FORM);

  // Stock adjustment + drawers
  const [adjustMaterial, setAdjustMaterial] = useState<RawMaterial | null>(null);
  const [adjustForm, setAdjustForm] = useState<{ mode: 'ADD' | 'REMOVE'; quantity: string; reason: string }>({ mode: 'ADD', quantity: '', reason: '' });
  const [historyMaterial, setHistoryMaterial] = useState<RawMaterial | null>(null);
  const [lotsMaterial, setLotsMaterial] = useState<RawMaterial | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { bulkArchive, bulkRestore } = useArchive('raw-materials', [['inventory', 'raw-materials']], 'Raw material');

  // ── Queries ─────────────────────────────────────────────────

  const { data: storageLocData } = useQuery({
    queryKey: ['inventory', 'storage-locations'],
    queryFn: () => api.get<{ data: StorageLocationOption[] }>('/inventory/storage-locations'),
    staleTime: 300_000,
  });
  const storageLocations: StorageLocationOption[] = (storageLocData as any)?.data ?? (storageLocData as any) ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'raw-materials', { search, category: categoryFilter, lowStock: lowStockOnly, archived }, page],
    queryFn: () =>
      api.get<RawMaterialsResponse>('/inventory/raw-materials', {
        params: {
          search: search || undefined,
          category: categoryFilter || undefined,
          lowStock: lowStockOnly ? 'true' : undefined,
          archived: archived !== 'active' ? archived : undefined,
          page,
          limit: 20,
        },
      }),
    staleTime: 30_000,
  });

  const materials: RawMaterial[] = (data as unknown as RawMaterialsResponse)?.data ?? [];
  const total: number = (data as unknown as RawMaterialsResponse)?.total ?? 0;
  const sel = useRowSelection(materials);
  const lowCount = materials.filter(m => m.isLowStock).length;
  const totalStockValue = materials.reduce((sum, m) => sum + (m.stockValue ?? 0), 0);

  // Movement history (drawer)
  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: ['inventory', 'raw-materials', historyMaterial?.id, 'movements'],
    queryFn: () => api.get<{ current: RawMaterial; movements: StockMovement[] }>(`/inventory/raw-materials/${historyMaterial!.id}/movements`),
    enabled: !!historyMaterial,
  });
  const movements: StockMovement[] = (historyData as any)?.movements ?? [];

  // Linked lots (drawer)
  const { data: lotsData, isLoading: lotsLoading } = useQuery({
    queryKey: ['inventory', 'raw-materials', lotsMaterial?.id, 'lots'],
    queryFn: () => api.get<LinkedLot[]>(`/inventory/raw-materials/${lotsMaterial!.id}/lots`),
    enabled: !!lotsMaterial,
  });
  const lots: LinkedLot[] = Array.isArray(lotsData) ? lotsData : ((lotsData as any)?.data ?? []);

  // ── Mutations ────────────────────────────────────────────────

  const archiveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/archive/raw-materials/${id}/archive`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'raw-materials'] });
      queryClient.invalidateQueries({ queryKey: ['archive'] });
      toast({ title: t('rawMaterialsView.toast.archived'), description: t('rawMaterialsView.toast.archivedDesc'), variant: 'success' });
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('rawMaterialsView.toast.failArchive');
      toast({ title: t('rawMaterialsView.toast.error'), description: msg, variant: 'destructive' });
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/archive/raw-materials/${id}/restore`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'raw-materials'] });
      queryClient.invalidateQueries({ queryKey: ['archive'] });
      toast({ title: t('rawMaterialsView.toast.restored'), variant: 'success' });
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('rawMaterialsView.toast.failRestore');
      toast({ title: t('rawMaterialsView.toast.error'), description: msg, variant: 'destructive' });
    },
  });

  const createMutation = useMutation({
    mutationFn: (dto: Record<string, unknown>) => api.post('/inventory/raw-materials', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'raw-materials'] });
      toast({ title: t('rawMaterialsView.toast.created'), variant: 'success' });
      handleCloseForm();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('rawMaterialsView.toast.failCreate');
      toast({ title: t('rawMaterialsView.toast.error'), description: msg, variant: 'destructive' });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: Record<string, unknown> }) =>
      api.patch(`/inventory/raw-materials/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'raw-materials'] });
      toast({ title: t('rawMaterialsView.toast.updated'), variant: 'success' });
      handleCloseForm();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('rawMaterialsView.toast.failUpdate');
      toast({ title: t('rawMaterialsView.toast.error'), description: msg, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/raw-materials/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'raw-materials'] });
      toast({ title: t('rawMaterialsView.toast.deleted') });
      setDeleteDialog(null);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('rawMaterialsView.toast.failDelete');
      toast({ title: t('rawMaterialsView.toast.error'), description: msg, variant: 'destructive' });
    },
  });

  const adjustMutation = useMutation({
    mutationFn: ({ id, quantity, reason }: { id: string; quantity: number; reason: string }) =>
      api.post(`/inventory/raw-materials/${id}/adjust`, { quantity, reason }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'raw-materials'] });
      toast({ title: t('rawMaterialsView.toast.stockAdjusted'), variant: 'success' });
      setAdjustMaterial(null);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('rawMaterialsView.toast.failAdjust');
      toast({ title: t('rawMaterialsView.toast.error'), description: msg, variant: 'destructive' });
    },
  });

  // ── Handlers ─────────────────────────────────────────────────

  const handleOpenCreate = () => {
    setEditMaterial(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const handleOpenEdit = (material: RawMaterial) => {
    setEditMaterial(material);
    setForm({
      code: material.code,
      name: material.name,
      category: material.category ?? '',
      unit: material.unit,
      unitCost: material.unitCost?.toString() ?? '',
      minStock: material.minStock.toString(),
      maxStock: '',
      reorderPoint: material.reorderPoint?.toString() ?? '',
      storageLocationId: material.storageLocationId ?? '',
      supplierName: material.supplierName ?? '',
      leadTimeDays: '',
    });
    setFormOpen(true);
  };

  const handleCloseForm = () => {
    setFormOpen(false);
    setEditMaterial(null);
    setForm(EMPTY_FORM);
  };

  const handleOpenAdjust = (material: RawMaterial) => {
    setAdjustForm({ mode: 'ADD', quantity: '', reason: '' });
    setAdjustMaterial(material);
  };

  const buildDto = (): Record<string, unknown> => ({
    code: form.code,
    name: form.name,
    category: form.category || null,
    unit: form.unit,
    unitCost: form.unitCost ? parseFloat(form.unitCost) : null,
    minStock: parseInt(form.minStock) || 0,
    maxStock: form.maxStock ? parseInt(form.maxStock) : null,
    reorderPoint: form.reorderPoint ? parseInt(form.reorderPoint) : null,
    storageLocationId: form.storageLocationId || null,
    supplierName: form.supplierName || null,
    leadTimeDays: form.leadTimeDays ? parseInt(form.leadTimeDays) : null,
  });

  const handleSubmit = () => {
    if (editMaterial) {
      const dto = buildDto();
      delete dto.code; // code is immutable after creation
      updateMutation.mutate({ id: editMaterial.id, dto });
    } else {
      createMutation.mutate(buildDto());
    }
  };

  const handleAdjustSubmit = () => {
    if (!adjustMaterial) return;
    const qty = parseFloat(adjustForm.quantity);
    if (!qty || qty <= 0) return;
    const signed = adjustForm.mode === 'REMOVE' ? -qty : qty;
    adjustMutation.mutate({ id: adjustMaterial.id, quantity: signed, reason: adjustForm.reason || `Manual ${adjustForm.mode.toLowerCase()}` });
  };

  const isValid = !!(form.code && form.name && form.unit && form.minStock);
  const isBusy = createMutation.isPending || updateMutation.isPending;

  // projected stock after a pending adjustment (for preview)
  const adjustQty = parseFloat(adjustForm.quantity) || 0;
  const projectedStock = adjustMaterial
    ? adjustMaterial.currentStock + (adjustForm.mode === 'REMOVE' ? -adjustQty : adjustQty)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.rawMaterials.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.rawMaterials.subtitle')}
          </p>
        </div>
        <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}>
          <Plus size={13} />{t('rawMaterialsView.addMaterial')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <InlineFormSlot />

        {/* KPI Cards */}
        <div className="grid grid-cols-3 gap-3">
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('rawMaterialsView.kpi.totalMaterials')}</span>
              <Layers3 size={14} className="text-brand-400" />
            </div>
            <p className="text-2xl font-bold text-brand-400">{total}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('rawMaterialsView.activeRecords')}</p>
          </div>
          <div className={cn('glass-card p-4', lowCount > 0 && 'border-amber-500/30')}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('rawMaterialsView.kpi.lowStock')}</span>
              <TrendingDown size={14} className={lowCount > 0 ? 'text-amber-400' : 'text-muted-foreground'} />
            </div>
            <p className={cn('text-2xl font-bold', lowCount > 0 ? 'text-amber-400' : 'text-muted-foreground')}>
              {lowCount}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('rawMaterialsView.belowMinimum')}</p>
          </div>
          <div className="glass-card p-4">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-muted-foreground">{t('rawMaterialsView.kpi.totalStockValue')}</span>
              <DollarSign size={14} className="text-green-400" />
            </div>
            <p className="text-2xl font-bold text-green-400">
              {totalStockValue.toLocaleString('en-SA', { maximumFractionDigits: 0 })}
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{t('rawMaterialsView.sarAcross')}</p>
          </div>
        </div>

        {/* Filters + Table */}
        <div className="glass-card p-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <h3 className="text-sm font-semibold">{t('rawMaterials.allMaterials')}</h3>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={t('rawMaterials.search')}
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  className="h-8 ps-7 w-44 text-xs"
                />
              </div>
              <Select value={categoryFilter || '__all__'} onValueChange={v => { setCategoryFilter(v === '__all__' ? '' : v); setPage(1); }}>
                <SelectTrigger className="h-8 w-36 text-xs">
                  <SelectValue placeholder={t('rawMaterials.allCategories')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">{t('rawMaterials.allCategories')}</SelectItem>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button
                variant={lowStockOnly ? 'default' : 'outline'}
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={() => { setLowStockOnly(v => !v); setPage(1); }}
              >
                <AlertTriangle size={12} />{t('rawMaterials.lowStock')}
              </Button>
              <ArchiveFilter value={archived} onChange={(v) => { setArchived(v); setPage(1); }} />
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/20">
                  <tr className="border-b border-border/30">
                    <th className="p-3 w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('rawMaterials.selectAll')} /></th>
                    {[t('rawMaterials.col.code'), t('rawMaterials.col.name'), t('rawMaterials.col.category'), t('rawMaterials.col.unit'), t('rawMaterials.col.onHand'), t('rawMaterials.col.available'), t('rawMaterials.col.reserved'), t('rawMaterials.col.minStock'), t('rawMaterials.col.unitCost'), t('rawMaterials.col.location'), t('rawMaterials.col.status'), ''].map((h, i) => (
                      <th key={i} className="text-start p-3 text-[11px] font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={13} className="p-3">
                          <div className="shimmer h-4 rounded" />
                        </td>
                      </tr>
                    ))
                  ) : materials.length === 0 ? (
                    <tr>
                      <td colSpan={13} className="p-12 text-center text-muted-foreground">
                        <Package size={32} className="mx-auto mb-2 opacity-30" />
                        <p className="text-sm">{t('rawMaterials.noMaterials')}</p>
                        <p className="text-xs mt-1">{t('rawMaterialsView.addFirstHint')}</p>
                      </td>
                    </tr>
                  ) : (
                    materials.map((m, i) => {
                      const status = getStockStatus(m);
                      return (
                        <motion.tr
                          key={m.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.02 }}
                          className={cn('border-b border-border/20 hover:bg-muted/20 transition-colors', m.isLowStock && 'bg-amber-500/5', sel.isSelected(m.id) && 'bg-primary/5')}
                        >
                          <td className="p-3"><Checkbox checked={sel.isSelected(m.id)} onCheckedChange={() => sel.toggle(m.id)} aria-label={t('rawMaterialsView.selectRow')} /></td>
                          <td className="p-3 text-xs font-mono text-muted-foreground whitespace-nowrap">{m.code}</td>
                          <td className="p-3 text-xs font-medium">
                            <div className="max-w-[160px] truncate">{m.name}</div>
                            {m.supplierName && (
                              <div className="text-[10px] text-muted-foreground">{m.supplierName}</div>
                            )}
                          </td>
                          <td className="p-3">
                            {m.category ? (
                              <span className={cn(
                                'text-[10px] font-medium px-2 py-0.5 rounded-full border',
                                CATEGORY_COLORS[m.category] ?? 'text-muted-foreground border-border',
                              )}>
                                {m.category}
                              </span>
                            ) : <span className="text-xs text-muted-foreground">—</span>}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">{m.unit}</td>
                          <td className="p-3">
                            <span className="text-xs font-semibold tabular-nums">{m.currentStock.toLocaleString()}</span>
                          </td>
                          <td className="p-3">
                            <span className={cn(
                              'text-xs font-bold tabular-nums',
                              m.isLowStock ? 'text-amber-400' : 'text-foreground',
                            )}>
                              {m.availableStock.toLocaleString()}
                            </span>
                          </td>
                          <td className="p-3 text-xs text-muted-foreground tabular-nums">
                            {m.reservedStock > 0 ? m.reservedStock.toLocaleString() : '—'}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground tabular-nums">{m.minStock.toLocaleString()}</td>
                          <td className="p-3 text-xs text-muted-foreground tabular-nums">
                            {m.unitCost != null ? `${m.unitCost.toFixed(2)} SAR` : '—'}
                          </td>
                          <td className="p-3 text-xs text-muted-foreground">
                            <span className="max-w-[100px] truncate block">{m.storageLocation ?? '—'}</span>
                          </td>
                          <td className="p-3">
                            <span className={cn(
                              'text-[10px] font-medium px-2 py-0.5 rounded-full border',
                              status.cls,
                            )}>
                              {t(status.labelKey)}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <MoreHorizontal size={14} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => handleOpenAdjust(m)}>
                                  <SlidersHorizontal size={12} />{t('rawMaterialsView.menu.adjustStock')}
                                </DropdownMenuItem>
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => setLotsMaterial(m)}>
                                  <Boxes size={12} />{t('rawMaterialsView.menu.viewLots')}
                                </DropdownMenuItem>
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => setHistoryMaterial(m)}>
                                  <History size={12} />{t('rawMaterialsView.menu.history')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="gap-2 text-xs" onClick={() => handleOpenEdit(m)}>
                                  <Pencil size={12} />{t('rawMaterialsView.menu.edit')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                {m.archivedAt ? (
                                  <DropdownMenuItem className="gap-2 text-xs" onClick={() => restoreMutation.mutate(m.id)}>
                                    <RotateCcw size={12} />{t('rawMaterialsView.menu.restore')}
                                  </DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem className="gap-2 text-xs" onClick={() => archiveMutation.mutate(m.id)}>
                                    <ArchiveIcon size={12} />{t('rawMaterialsView.menu.archive')}
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem
                                  className="gap-2 text-xs text-destructive"
                                  onClick={() => setDeleteDialog({ id: m.id, name: m.name })}
                                >
                                  <Trash2 size={12} />{t('rawMaterialsView.menu.delete')}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </motion.tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      {/* ── Create / Edit — inline form ─────────────────────── */}
      <InlineFormPanel
        open={formOpen}
        onClose={handleCloseForm}
        icon={Layers3}
        title={editMaterial ? t('rmform.editTitle', { name: editMaterial.name }) : t('rmform.createTitle')}
        description={editMaterial ? t('rmform.editDesc') : t('rmform.createDesc')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={handleCloseForm}>{t('rmform.cancel')}</Button>
            <Button
              size="sm"
              disabled={!isValid || isBusy}
              onClick={handleSubmit}
            >
              {isBusy
                ? (editMaterial ? t('rmform.saving') : t('rmform.creating'))
                : (editMaterial ? t('rmform.saveChanges') : t('rmform.addMaterial'))
              }
            </Button>
          </>
        )}
      >
            <div className="grid grid-cols-2 gap-3">
              {/* Code */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.code')} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.code}
                  onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                  placeholder={t('rmform.codePlaceholder')}
                  className="h-9"
                  disabled={!!editMaterial}
                />
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.category')}</Label>
                <Select value={form.category || '__none__'} onValueChange={v => setForm(p => ({ ...p, category: v === '__none__' ? '' : v }))}>
                  <SelectTrigger className="h-9"><SelectValue placeholder={t('rmform.selectCategory')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('rmform.none')}</SelectItem>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Name */}
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">{t('rmform.name')} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder={t('rmform.namePlaceholder')}
                  className="h-9"
                />
              </div>

              {/* Unit */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.unit')} <span className="text-destructive">*</span></Label>
                <Input
                  value={form.unit}
                  onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}
                  placeholder={t('rmform.unitPlaceholder')}
                  className="h-9"
                />
              </div>

              {/* Unit Cost */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.unitCost')}</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.unitCost}
                  onChange={e => setForm(p => ({ ...p, unitCost: e.target.value }))}
                  placeholder="0.00"
                  className="h-9"
                />
              </div>

              {/* Min Stock */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.minStock')} <span className="text-destructive">*</span></Label>
                <Input
                  type="number"
                  min="0"
                  value={form.minStock}
                  onChange={e => setForm(p => ({ ...p, minStock: e.target.value }))}
                  placeholder="0"
                  className="h-9"
                />
              </div>

              {/* Max Stock */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.maxStock')}</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.maxStock}
                  onChange={e => setForm(p => ({ ...p, maxStock: e.target.value }))}
                  placeholder={t('rmform.optional')}
                  className="h-9"
                />
              </div>

              {/* Reorder Point */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.reorderPoint')}</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.reorderPoint}
                  onChange={e => setForm(p => ({ ...p, reorderPoint: e.target.value }))}
                  placeholder={t('rmform.optional')}
                  className="h-9"
                />
              </div>

              {/* Lead Time */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.leadTime')}</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.leadTimeDays}
                  onChange={e => setForm(p => ({ ...p, leadTimeDays: e.target.value }))}
                  placeholder={t('rmform.optional')}
                  className="h-9"
                />
              </div>

              {/* Storage Location */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.storageLocation')}</Label>
                <EntityPicker
                  items={storageLocations}
                  value={form.storageLocationId || null}
                  onChange={id => setForm(p => ({ ...p, storageLocationId: id ?? '' }))}
                  getId={loc => loc.id}
                  getPrimary={loc => loc.name}
                  getSecondary={loc => loc.code}
                  getMeta={loc => <span className="text-muted-foreground">{loc.zone}</span>}
                  placeholder={t('rmform.selectLocation')}
                  searchPlaceholder={t('rmform.searchLocation')}
                />
              </div>

              {/* Supplier */}
              <div className="space-y-1.5">
                <Label className="text-xs">{t('rmform.supplierName')}</Label>
                <Input
                  value={form.supplierName}
                  onChange={e => setForm(p => ({ ...p, supplierName: e.target.value }))}
                  placeholder={t('rmform.optional')}
                  className="h-9"
                />
              </div>
            </div>
      </InlineFormPanel>

      {/* ── Adjust Stock — inline form ──────────────────────── */}
      <InlineFormPanel
        open={!!adjustMaterial}
        onClose={() => setAdjustMaterial(null)}
        icon={SlidersHorizontal}
        title={adjustMaterial ? t('adjust.titleNamed', { name: adjustMaterial.name }) : t('adjust.title')}
        description={t('adjust.desc')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setAdjustMaterial(null)}>{t('adjust.cancel')}</Button>
            <Button
              size="sm"
              disabled={!adjustQty || adjustQty <= 0 || adjustMutation.isPending || projectedStock < 0}
              onClick={handleAdjustSubmit}
            >
              {adjustMutation.isPending ? t('adjust.saving') : t('adjust.apply')}
            </Button>
          </>
        )}
      >
        {adjustMaterial && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-border/40 bg-muted/20 p-3 text-xs">
              <span className="text-muted-foreground">{t('adjust.currentOnHand')}</span>
              <span className="font-bold tabular-nums">{adjustMaterial.currentStock.toLocaleString()} {adjustMaterial.unit}</span>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant={adjustForm.mode === 'ADD' ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => setAdjustForm(p => ({ ...p, mode: 'ADD' }))}
              >
                <ArrowUp size={13} />{t('adjust.addStock')}
              </Button>
              <Button
                type="button"
                variant={adjustForm.mode === 'REMOVE' ? 'default' : 'outline'}
                size="sm"
                className="gap-1.5"
                onClick={() => setAdjustForm(p => ({ ...p, mode: 'REMOVE' }))}
              >
                <ArrowDown size={13} />{t('adjust.removeStock')}
              </Button>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('adjust.quantity', { unit: adjustMaterial.unit })} <span className="text-destructive">*</span></Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={adjustForm.quantity}
                onChange={e => setAdjustForm(p => ({ ...p, quantity: e.target.value }))}
                placeholder="0"
                className="h-9"
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t('adjust.reason')}</Label>
              <Input
                value={adjustForm.reason}
                onChange={e => setAdjustForm(p => ({ ...p, reason: e.target.value }))}
                placeholder={t('adjust.reasonPlaceholder')}
                className="h-9"
              />
            </div>

            <div className={cn(
              'flex items-center justify-between rounded-lg border p-3 text-xs',
              projectedStock < 0 ? 'border-destructive/40 bg-destructive/10' : 'border-green-400/30 bg-green-400/5',
            )}>
              <span className="text-muted-foreground">{t('adjust.newOnHand')}</span>
              <span className={cn('font-bold tabular-nums', projectedStock < 0 ? 'text-destructive' : 'text-green-400')}>
                {projectedStock.toLocaleString()} {adjustMaterial.unit}
              </span>
            </div>
            {projectedStock < 0 && (
              <p className="text-[11px] text-destructive">{t('adjust.negativeWarn')}</p>
            )}
          </div>
        )}
      </InlineFormPanel>

      {/* ── Movement History — drawer ───────────────────────── */}
      <Sheet open={!!historyMaterial} onOpenChange={(o) => !o && setHistoryMaterial(null)}>
        <SheetContent side={i18n.dir() === 'rtl' ? 'left' : 'right'} className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <History size={16} />{t('history.title')}
            </SheetTitle>
            <SheetDescription>
              {historyMaterial ? `${historyMaterial.name} (${historyMaterial.code})` : ''}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {historyLoading ? (
              Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-12 rounded" />)
            ) : movements.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <History size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('rawMaterialsView.noMovementsYet')}</p>
              </div>
            ) : (
              movements.map((mv) => {
                const isIn = mv.quantity >= 0;
                return (
                  <div key={mv.id} className="flex items-start gap-3 rounded-lg border border-border/40 p-3">
                    <div className={cn('mt-0.5 rounded-full p-1.5', isIn ? 'bg-green-400/10' : 'bg-red-400/10')}>
                      {isIn ? <ArrowUp size={13} className="text-green-400" /> : <ArrowDown size={13} className="text-red-400" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className={cn('text-[10px]', MOVEMENT_COLORS[mv.movementType] ?? '')}>
                          {mv.movementType}
                        </Badge>
                        <span className={cn('text-xs font-bold tabular-nums', isIn ? 'text-green-400' : 'text-red-400')}>
                          {isIn ? '+' : ''}{mv.quantity.toLocaleString()}
                        </span>
                        {mv.stockAfter != null && (
                          <span className="text-[10px] text-muted-foreground">→ {mv.stockAfter.toLocaleString()} {t('rawMaterialsView.onHand')}</span>
                        )}
                      </div>
                      {mv.notes && <p className="text-[11px] text-muted-foreground mt-1">{mv.notes}</p>}
                      <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-1">
                        <span>{new Date(mv.createdAt).toLocaleString()}</span>
                        {mv.referenceNumber && <span>• {mv.referenceNumber}</span>}
                        {mv.performedBy?.name && <span>• {mv.performedBy.name}</span>}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Linked Lots — drawer ────────────────────────────── */}
      <Sheet open={!!lotsMaterial} onOpenChange={(o) => !o && setLotsMaterial(null)}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-base">
              <Boxes size={16} />{t('rawMaterialsView.materialLots')}
            </SheetTitle>
            <SheetDescription>
              {lotsMaterial ? `${lotsMaterial.name} (${lotsMaterial.code})` : ''}
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {lotsLoading ? (
              Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer h-16 rounded" />)
            ) : lots.length === 0 ? (
              <div className="py-12 text-center text-muted-foreground">
                <Boxes size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">{t('rawMaterialsView.noLotsReceived')}</p>
                <p className="text-xs mt-1">{t('rawMaterialsView.receiveFromLots')}</p>
              </div>
            ) : (
              lots.map((lot) => (
                <div key={lot.id} className={cn('rounded-lg border border-border/40 p-3', lot.isExpired && 'bg-red-500/5')}>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-mono font-medium">{lot.lotNumber}</span>
                    <Badge variant="outline" className={cn('text-[10px]', LOT_STATUS_COLORS[lot.status] ?? '')}>
                      {lot.status}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-[11px] text-muted-foreground">
                    <div>{t('rawMaterialsView.lot.qty')}: <span className="text-foreground tabular-nums">{lot.quantity.toLocaleString()} {lot.unit}</span></div>
                    <div>{t('rawMaterialsView.lot.remaining')}: <span className="text-foreground font-semibold tabular-nums">{lot.remainingQty.toLocaleString()} {lot.unit}</span></div>
                    <div>{t('rawMaterialsView.lot.received')}: <span className="text-foreground">{lot.receivedAt.slice(0, 10)}</span></div>
                    <div>
                      {t('rawMaterialsView.lot.expiry')}:{' '}
                      {lot.expiryDate ? (
                        <span className={lot.isExpired ? 'text-red-400 font-semibold' : 'text-foreground'}>
                          {lot.isExpired && <AlertTriangle className="w-3 h-3 inline mr-0.5" />}
                          {lot.expiryDate.slice(0, 10)}
                        </span>
                      ) : '—'}
                    </div>
                    {lot.supplierName && <div className="col-span-2">{t('rawMaterialsView.lot.supplier')}: <span className="text-foreground">{lot.supplierName}</span></div>}
                    {lot.storageLocation && <div className="col-span-2">{t('rawMaterialsView.lot.location')}: <span className="text-foreground">{lot.storageLocation}</span></div>}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5">
                    <div className="flex-1 h-1.5 bg-foreground/10 rounded-full overflow-hidden">
                      <div className="h-full bg-brand-500 rounded-full" style={{ width: `${lot.utilizationPct}%` }} />
                    </div>
                    <span className="text-[10px] text-muted-foreground">{lot.utilizationPct}% {t('rawMaterialsView.lot.used')}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ── Delete Confirmation ──────────────────────────────── */}
      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('rawMaterialsView.deleteTitle', { name: deleteDialog?.name ?? '' })}
        description={t('rawMaterialsView.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />

      {/* ── Bulk actions ─────────────────────────────────────── */}
      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('rawMaterialsView.menu.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('rawMaterialsView.menu.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  );
}
