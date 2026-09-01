'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Plus, Search, Download, Filter, FlaskConical, Clock, CheckCircle2, AlertTriangle, Edit3, Trash2, Hash, Package, Eye } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'; // still used for status filter
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { TableRowActions } from '@/components/ui/table-row-actions';
import { api } from '@/services/api.client';
import { cn, formatDate } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';

type BatchStatus = 'ACTIVE' | 'COMPLETED' | 'RELEASED' | 'REJECTED' | 'ON_HOLD' | 'QUARANTINE';

interface Batch {
  id: string;
  batchNumber: string;
  sku?: { name: string; code: string };
  workOrder?: { orderNumber: string; machine?: { name: string } };
  workOrderIds?: string[];
  linkedWorkOrders?: { id: string; orderNumber: string }[];
  quantitySource?: 'AUTO' | 'MANUAL';
  status: BatchStatus;
  quantity: number;
  goodQuantity: number;
  scrapQuantity: number;
  lotNumber?: string | null;
  notes?: string | null;
  createdAt?: string;
  yieldPct?: number;
  scrapPct?: number;
}

interface SKU { id: string; name: string; code: string; itemNumber?: string; brand?: string; }
interface WorkOrder { id: string; orderNumber: string; status: string; plannedQty?: number; sku?: { name: string } }

const STATUS_CONFIG: Record<BatchStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  ACTIVE:     { label: 'Active',      variant: 'default' },
  COMPLETED:  { label: 'Completed',   variant: 'secondary' },
  RELEASED:   { label: 'Released',    variant: 'secondary' },
  REJECTED:   { label: 'Rejected',    variant: 'destructive' },
  ON_HOLD:    { label: 'On Hold',     variant: 'outline' },
  QUARANTINE: { label: 'Quarantine',  variant: 'outline' },
};

const EMPTY_FORM = {
  batchNumber: '', skuId: '', plannedQty: '',
  workOrderIds: [] as string[],
  quantitySource: 'MANUAL' as 'MANUAL' | 'AUTO',
};

export function ProductionBatchesView() {
  const { t } = useTranslation(['production', 'common']);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editBatch, setEditBatch] = useState<Batch | null>(null);
  const [viewBatch, setViewBatch] = useState<Batch | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState(EMPTY_FORM);

  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const { data, isLoading } = useQuery({
    queryKey: ['production', 'batches', { search, status: statusFilter, page, sortCol, sortDir }],
    queryFn: () => api.get('/production/batches', {
      params: { search: search || undefined, status: statusFilter || undefined, limit: 20, page, sortBy: sortCol, sortOrder: sortDir },
    }),
    staleTime: 15_000,
  });

  const { data: skusData } = useQuery({
    queryKey: ['inventory', 'products', 'dropdown'],
    queryFn: () => api.get('/inventory/products', { params: { limit: 200 } }),
    staleTime: 120_000,
  });

  const { data: workOrdersData } = useQuery({
    queryKey: ['production', 'work-orders', 'dropdown'],
    queryFn: () => api.get('/production/work-orders', { params: { limit: 100, status: 'PLANNED,IN_PROGRESS' } }),
    staleTime: 30_000,
    enabled: formOpen,
  });

  const batches: Batch[] = (data as any)?.data ?? [];
  const total: number = (data as any)?.total ?? 0;
  const skus: SKU[] = (skusData as any)?.data ?? [];
  const workOrders: WorkOrder[] = (workOrdersData as any)?.data ?? [];

  const { sortedData } = useSortedData(batches, 'createdAt', 'desc');

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/production/batches', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
      toast({ title: t('batchv.toastCreated'), description: t('batchv.toastCreatedDesc', { batch: formData.batchNumber }) });
      setFormOpen(false);
      setFormData(EMPTY_FORM);
    },
    onError: (e: any) => toast({ title: t('batchv.toastCreateFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/production/batches/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
      toast({ title: t('batchv.toastUpdated') });
      setEditBatch(null);
    },
    onError: (e: any) => toast({ title: t('batchv.toastUpdateFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/production/batches/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['production', 'batches'] });
      toast({ title: t('batchv.toastDeleted') }); setDeleteId(null);
    },
    onError: (e: any) => toast({ title: t('batchv.toastDeleteFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const activeCount = batches.filter(b => b.status === 'ACTIVE').length;
  const completedCount = batches.filter(b => b.status === 'COMPLETED' || b.status === 'RELEASED').length;
  const onHoldCount = batches.filter(b => b.status === 'ON_HOLD' || b.status === 'QUARANTINE').length;
  const totalScrap = batches.reduce((sum, b) => sum + (b.scrapQuantity ?? 0), 0);

  const SUMMARY = [
    { labelKey: 'batchv.summaryActive',    value: activeCount,    icon: FlaskConical, color: 'text-brand-400' },
    { labelKey: 'batchv.summaryCompleted', value: completedCount, icon: CheckCircle2, color: 'text-green-400' },
    { labelKey: 'batchv.summaryOnHold',    value: onHoldCount,    icon: Clock,        color: 'text-amber-400' },
    { labelKey: 'batchv.summaryScrap',     value: totalScrap,     icon: AlertTriangle,color: 'text-red-400'   },
  ];

  // Live AUTO quantity = sum of the selected work orders' planned quantities.
  const autoQty = workOrders
    .filter((w) => formData.workOrderIds.includes(w.id))
    .reduce((s, w) => s + (w.plannedQty ?? 0), 0);
  const canCreate = !!formData.batchNumber && (
    formData.quantitySource === 'AUTO' ? formData.workOrderIds.length > 0 : !!formData.plannedQty
  );

  const handleCreate = () => {
    if (!canCreate) return;
    createMutation.mutate({
      batchNumber: formData.batchNumber,
      skuId: formData.skuId || undefined,
      quantitySource: formData.quantitySource,
      workOrderIds: formData.workOrderIds,
      quantity: formData.quantitySource === 'AUTO' ? autoQty : parseFloat(formData.plannedQty || '0'),
    });
  };

  const handleUpdate = () => {
    if (!editBatch) return;
    const isAuto = editBatch.quantitySource === 'AUTO';
    updateMutation.mutate({
      id: editBatch.id,
      dto: {
        status: editBatch.status,
        // Preserve the AUTO/MANUAL mode + linked WOs so the backend recomputes correctly.
        quantitySource: editBatch.quantitySource,
        workOrderIds: editBatch.workOrderIds,
        // AUTO batches derive quantity/good/scrap live from linked WOs — don't override them.
        ...(isAuto ? {} : {
          quantity: editBatch.quantity,
          goodQuantity: editBatch.goodQuantity,
          scrapQuantity: editBatch.scrapQuantity,
        }),
        lotNumber: editBatch.lotNumber ?? undefined,
        notes: editBatch.notes ?? undefined,
      },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.batches.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.batches.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs"><Download size={13} />{t('common:actions.export')}</Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => { setFormData(EMPTY_FORM); setFormOpen(true); }}>
            <Plus size={13} />{t('newBatch')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <InlineFormSlot />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {SUMMARY.map((s, i) => {
            const Icon = s.icon;
            return (
              <motion.div key={s.labelKey} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}
                className="industrial-card rounded-xl p-4 flex items-center gap-3">
                <Icon className={cn('w-8 h-8', s.color)} />
                <div>
                  <div className="text-2xl font-bold">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{t(s.labelKey)}</div>
                </div>
              </motion.div>
            );
          })}
        </div>

        <div className="industrial-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border/30">
            <div className="relative">
              <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder={t('batches.search')} value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} className="h-8 ps-7 w-56 text-xs" />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                  <Filter size={13} />{statusFilter ? t(`batches.status.${statusFilter}`) : t('batches.allStatus')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem onClick={() => { setStatusFilter(null); setPage(1); }}>{t('batches.allStatus')}</DropdownMenuItem>
                {Object.keys(STATUS_CONFIG).map((k) => (
                  <DropdownMenuItem key={k} onClick={() => { setStatusFilter(k); setPage(1); }}>{t(`batches.status.${k}`)}</DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent border-border/30">
                <SortableHeader column="batchNumber" label={t('batches.col.batch')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="sku" label={t('batches.col.product')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="status" label={t('batches.col.status')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="quantity" label={t('batches.col.quantity')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-start text-[11px]">{t('batches.col.workOrder')}</th>
                <th className="px-4 py-3 text-start text-[11px]">{t('batches.col.lot')}</th>
                <SortableHeader column="createdAt" label={t('batches.col.created')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <th className="px-4 py-3 text-start text-[11px]">{t('batches.col.yield')}</th>
                <th className="px-4 py-3 text-start text-[11px]">{t('batches.col.scrap')}</th>
                <th className="px-4 py-3 text-end text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('batches.col.actions')}</th>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i} className="border-border/20">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <TableCell key={j}><div className="shimmer h-3.5 rounded w-16" /></TableCell>
                    ))}
                  </TableRow>
                ))
              ) : sortedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8 text-muted-foreground text-sm">{t('batches.noBatches')}</TableCell>
                </TableRow>
              ) : (
                sortedData.map(batch => {
                  const cfg = STATUS_CONFIG[batch.status] ?? { label: batch.status, variant: 'outline' as const };
                  const yieldPct = batch.yieldPct ?? (batch.quantity > 0 ? Math.round((batch.goodQuantity / batch.quantity) * 100) : 0);
                  const scrapPct = batch.scrapPct ?? (batch.quantity > 0 ? Math.round((batch.scrapQuantity / batch.quantity) * 100) : 0);
                  return (
                    <TableRow key={batch.id} onClick={() => setViewBatch(batch)} className="border-border/20 hover:bg-muted/20 cursor-pointer">
                      <TableCell className="font-mono text-xs font-semibold text-primary">{batch.batchNumber}</TableCell>
                      <TableCell>
                        <div className="text-xs font-medium">{batch.sku?.name ?? '—'}</div>
                        {batch.sku?.code && <div className="text-[10px] text-muted-foreground">{batch.sku.code}</div>}
                      </TableCell>
                      <TableCell><Badge variant={cfg.variant} className="text-[10px] h-5">{t(`batches.status.${batch.status}`, { defaultValue: cfg.label })}</Badge></TableCell>
                      <TableCell className="text-xs">
                        <div className="font-medium">{batch.goodQuantity}</div>
                        <div className="text-muted-foreground text-[10px]">/ {batch.quantity}</div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {batch.workOrder?.orderNumber ?? '—'}
                        {(() => {
                          const m = (batch.workOrder as any)?.jobOrders?.find((j: any) => j.machine)?.machine?.name;
                          return m ? <div className="text-[10px]">{m}</div> : null;
                        })()}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">{batch.lotNumber ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{batch.createdAt ? formatDate(batch.createdAt) : '—'}</TableCell>
                      <TableCell className="text-xs">
                        <span className={yieldPct >= 99 ? 'text-green-400 font-medium' : yieldPct >= 90 ? 'text-yellow-400' : 'text-red-400'}>
                          {yieldPct}%
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className={scrapPct > 5 ? 'text-red-400 font-medium' : scrapPct > 0 ? 'text-amber-400' : 'text-green-400'}>
                          {batch.scrapQuantity}
                        </span>
                      </TableCell>
                      <TableCell>
                        <TableRowActions
                          onView={() => setViewBatch(batch)}
                          onEdit={() => setEditBatch(batch)}
                          onDelete={batch.status !== 'ACTIVE' ? () => setDeleteId(batch.id) : undefined}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
        </div>
      </div>

      {/* Create Batch — inline form */}
      <InlineFormPanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        icon={FlaskConical}
        title={t('bform.createTitle')}
        description={t('bform.createDesc')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>{t('bform.cancel')}</Button>
            <Button
              size="sm"
              disabled={!canCreate || createMutation.isPending}
              onClick={handleCreate}
            >
              {createMutation.isPending ? t('bform.creating') : t('bform.createBatch')}
            </Button>
          </>
        )}
      >
          <div className="space-y-4">
            {/* Batch Number */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1.5">
                <Hash size={11} className="text-muted-foreground" />
                {t('bform.batchNumber')} <span className="text-destructive">*</span>
              </Label>
              <Input
                value={formData.batchNumber}
                onChange={e => setFormData(v => ({ ...v, batchNumber: e.target.value }))}
                placeholder={t('bform.batchNumberPlaceholder')}
                className="h-9"
              />
            </div>

            {/* Product / SKU */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium flex items-center gap-1.5">
                <Package size={11} className="text-muted-foreground" />
                {t('bform.productSku')}
              </Label>
              <EntityPicker
                items={skus}
                value={formData.skuId}
                onChange={id => setFormData(f => ({ ...f, skuId: id ?? '' }))}
                getId={sku => sku.id}
                getPrimary={sku => sku.name}
                getSecondary={sku => sku.itemNumber ?? sku.code}
                placeholder={t('bform.selectProduct')}
                searchPlaceholder={t('bform.searchCodeName')}
                emptyText={t('bform.noProducts')}
                clearable={false}
              />
            </div>

            {/* Quantity source toggle — Manual vs Auto (live sum of linked WOs) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">{t('bform.quantitySource')}</Label>
              <div className="flex gap-2">
                {(['MANUAL', 'AUTO'] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setFormData(f => ({ ...f, quantitySource: src }))}
                    className={cn(
                      'flex-1 h-9 rounded-lg border text-xs font-medium transition-colors',
                      formData.quantitySource === src
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted/40',
                    )}
                  >
                    {src === 'MANUAL' ? t('bform.manual') : t('bform.autoSum')}
                  </button>
                ))}
              </div>
            </div>

            {/* Linked Work Orders — one or more (drives Auto quantity) */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                {t('bform.linkedWos')} {formData.quantitySource === 'AUTO' && <span className="text-destructive">*</span>}
                {formData.workOrderIds.length > 0 && (
                  <span className="ms-1 text-muted-foreground">· {t('bform.selectedSuffix', { count: formData.workOrderIds.length })}</span>
                )}
              </Label>
              <div className="max-h-44 overflow-y-auto rounded-lg border border-border divide-y divide-border/40">
                {workOrders.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">{t('bform.noOpenWos')}</div>
                ) : workOrders.map((wo) => {
                  const checked = formData.workOrderIds.includes(wo.id);
                  return (
                    <label key={wo.id} className="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer hover:bg-muted/30">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setFormData(f => ({
                          ...f,
                          workOrderIds: checked ? f.workOrderIds.filter(id => id !== wo.id) : [...f.workOrderIds, wo.id],
                        }))}
                      />
                      <span className="font-medium text-foreground">{wo.orderNumber}</span>
                      <span className="text-muted-foreground truncate">{wo.sku?.name ?? ''}</span>
                      {wo.plannedQty != null && <span className="ml-auto tabular-nums text-muted-foreground">{wo.plannedQty.toLocaleString()}</span>}
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Quantity — editable when Manual; computed (live) when Auto */}
            <div className="space-y-1.5">
              <Label className="text-xs font-medium">
                {formData.quantitySource === 'AUTO' ? t('bform.qtyAuto') : t('bform.plannedQty')}
                {formData.quantitySource === 'MANUAL' && <span className="text-destructive"> *</span>}
              </Label>
              <Input
                type="number"
                min={1}
                disabled={formData.quantitySource === 'AUTO'}
                value={formData.quantitySource === 'AUTO' ? autoQty : formData.plannedQty}
                onChange={e => setFormData(v => ({ ...v, plannedQty: e.target.value }))}
                placeholder={t('bform.qtyPlaceholder')}
                className="h-9"
              />
              {formData.quantitySource === 'AUTO' && (
                <p className="text-[10px] text-muted-foreground">{t('bform.autoHelp')}</p>
              )}
            </div>
          </div>
      </InlineFormPanel>

      {/* Edit Batch — inline form */}
      {editBatch && (
        <InlineFormPanel
          open={!!editBatch}
          onClose={() => setEditBatch(null)}
          icon={Edit3}
          title={editBatch.batchNumber}
          description={t('bform.editDesc')}
          footer={(
            <>
              <Button variant="outline" size="sm" onClick={() => setEditBatch(null)}>{t('bform.cancel')}</Button>
              <Button size="sm" disabled={updateMutation.isPending} onClick={handleUpdate}>
                {updateMutation.isPending ? t('bform.saving') : t('bform.saveChanges')}
              </Button>
            </>
          )}
        >
            <div className="space-y-4">
              {/* Quantities */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('bform.quantities')}</p>
                {editBatch.quantitySource === 'AUTO' && (
                  <p className="text-[11px] text-muted-foreground mb-2">{t('bform.autoCountsHint', { defaultValue: 'Quantities are summed automatically from the linked work orders.' })}</p>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('bform.totalPlanned')}</Label>
                    <Input type="number" min={0} value={editBatch.quantity ?? ''}
                      disabled={editBatch.quantitySource === 'AUTO'}
                      onChange={e => setEditBatch({ ...editBatch, quantity: parseInt(e.target.value) || 0 })}
                      className="h-9 disabled:opacity-60" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('bform.goodQty')}</Label>
                    <Input type="number" min={0} value={editBatch.goodQuantity ?? ''}
                      disabled={editBatch.quantitySource === 'AUTO'}
                      onChange={e => setEditBatch({ ...editBatch, goodQuantity: parseInt(e.target.value) || 0 })}
                      className="h-9 border-green-500/40 focus-visible:ring-green-500/30 disabled:opacity-60" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('bform.scrapQty')}</Label>
                    <Input type="number" min={0} value={editBatch.scrapQuantity ?? ''}
                      disabled={editBatch.quantitySource === 'AUTO'}
                      onChange={e => setEditBatch({ ...editBatch, scrapQuantity: parseInt(e.target.value) || 0 })}
                      className="h-9 border-red-500/40 focus-visible:ring-red-500/30 disabled:opacity-60" />
                  </div>
                </div>
                {/* Live yield preview */}
                {editBatch.quantity > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className="h-full bg-green-500 rounded-full transition-all"
                        style={{ width: `${Math.min(Math.round((editBatch.goodQuantity / editBatch.quantity) * 100), 100)}%` }} />
                    </div>
                    <span className="text-[11px] text-green-400 font-medium tabular-nums">
                      {Math.min(Math.round((editBatch.goodQuantity / editBatch.quantity) * 100), 100)}{t('bform.yieldSuffix')}
                    </span>
                  </div>
                )}
              </div>

              {/* Status & Tracking */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('bform.statusTracking')}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('bform.batchStatus')}</Label>
                    <Select value={editBatch.status} onValueChange={v => setEditBatch({ ...editBatch, status: v as BatchStatus })}>
                      <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                          <SelectItem key={k} value={k}>{t(`batches.status.${k}`, { defaultValue: v.label })}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t('bform.lotNumber')}</Label>
                    <Input value={editBatch.lotNumber ?? ''}
                      onChange={e => setEditBatch({ ...editBatch, lotNumber: e.target.value })}
                      placeholder={t('bform.lotPlaceholder')} className="h-9" />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">{t('bform.notes')}</Label>
                <Input value={editBatch.notes ?? ''}
                  onChange={e => setEditBatch({ ...editBatch, notes: e.target.value })}
                  placeholder={t('bform.notesPlaceholder')} className="h-9" />
              </div>

              {/* Delete zone for non-ACTIVE */}
              {editBatch.status !== 'ACTIVE' && (
                <div className="border border-red-500/30 rounded-lg px-3 py-2.5 bg-red-500/5 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium text-red-400">{t('bform.deleteBatch')}</p>
                    <p className="text-[10px] text-muted-foreground">{t('bform.deleteWarn')}</p>
                  </div>
                  <Button variant="destructive" size="sm" className="h-7 text-xs"
                    onClick={() => { setEditBatch(null); setDeleteId(editBatch.id); }}>
                    {t('bform.delete')}
                  </Button>
                </div>
              )}
              {editBatch.status === 'ACTIVE' && (
                <div className="border border-muted rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
                  <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                  <p className="text-[10px] text-muted-foreground">
                    {t('bform.activeNoDelete')}
                  </p>
                </div>
              )}
            </div>
        </InlineFormPanel>
      )}

      {/* ── Batch Detail Sheet ── */}
      <Sheet open={!!viewBatch} onOpenChange={o => !o && setViewBatch(null)}>
        <SheetContent className="w-full max-w-lg">
          <SheetHeader>
            {viewBatch && (
              <div className="flex items-center gap-3 pr-6">
                <div className="flex-1">
                  <SheetTitle className="font-mono text-sm">{viewBatch.batchNumber}</SheetTitle>
                  <SheetDescription className="mt-0.5">{viewBatch.lotNumber ? t('batchv.lotPrefix', { lot: viewBatch.lotNumber }) : t('batchv.noLot')}</SheetDescription>
                </div>
                <Badge variant={STATUS_CONFIG[viewBatch.status]?.variant ?? 'outline'}>
                  {t(`batches.status.${viewBatch.status}`, { defaultValue: STATUS_CONFIG[viewBatch.status]?.label ?? viewBatch.status })}
                </Badge>
              </div>
            )}
          </SheetHeader>

          {viewBatch && (
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {/* Yield metrics */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('batchv.qualityMetrics')}</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'planned', label: t('batchv.metricPlanned'), value: viewBatch.quantity, color: '' },
                    { key: 'good', label: t('batchv.metricGood'), value: viewBatch.goodQuantity, color: 'text-green-400' },
                    { key: 'scrap', label: t('batchv.metricScrap'), value: viewBatch.scrapQuantity, color: 'text-red-400' },
                  ].map(m => (
                    <div key={m.key} className="industrial-card rounded-lg p-3 text-center">
                      <div className={cn('text-xl font-bold tabular-nums', m.color)}>{m.value ?? 0}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{m.label}</div>
                    </div>
                  ))}
                </div>
                <div className="industrial-card rounded-lg px-3 py-2 mt-2 flex items-center gap-3">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 rounded-full"
                      style={{ width: `${viewBatch.yieldPct ?? (viewBatch.quantity > 0 ? Math.round((viewBatch.goodQuantity / viewBatch.quantity) * 100) : 0)}%` }}
                    />
                  </div>
                  <span className="text-xs font-semibold text-green-400 tabular-nums">
                    {t('batchv.yieldValue', { pct: viewBatch.yieldPct ?? (viewBatch.quantity > 0 ? Math.round((viewBatch.goodQuantity / viewBatch.quantity) * 100) : 0) })}
                  </span>
                </div>
              </div>

              {/* Details */}
              <div>
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('batchv.batchDetails')}</p>
                <div className="industrial-card rounded-lg px-3">
                  {[
                    { key: 'product', label: t('batchv.detailProduct'), value: viewBatch.sku?.name },
                    { key: 'skuCode', label: t('batchv.detailSkuCode'), value: viewBatch.sku?.code },
                    { key: 'lot', label: t('batchv.detailLot'), value: viewBatch.lotNumber },
                    { key: 'workOrder', label: t('batchv.detailWorkOrder'), value: viewBatch.workOrder?.orderNumber },
                    { key: 'machine', label: t('batchv.detailMachine'), value: viewBatch.workOrder?.machine?.name },
                    { key: 'created', label: t('batchv.detailCreated'), value: viewBatch.createdAt ? formatDate(viewBatch.createdAt) : undefined },
                  ].map(row => (
                    <div key={row.key} className="flex items-start gap-2 py-2 border-b border-border/20 last:border-0">
                      <span className="text-[11px] text-muted-foreground w-24 shrink-0 pt-0.5">{row.label}</span>
                      <span className="text-xs font-medium flex-1">{row.value ?? <span className="text-muted-foreground">—</span>}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Notes */}
              {viewBatch.notes && (
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('bform.notes')}</p>
                  <div className="industrial-card rounded-lg px-3 py-2">
                    <p className="text-xs text-muted-foreground">{viewBatch.notes}</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {viewBatch && (
            <div className="px-6 py-3 border-t border-border/50 flex items-center gap-2 shrink-0">
              <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5"
                onClick={() => { setViewBatch(null); setEditBatch(viewBatch); }}>
                <Edit3 size={11} />{t('batchv.editBatch')}
              </Button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Delete Confirm ── */}
      {deleteId && (
        <Dialog open onOpenChange={o => !o && setDeleteId(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-sm">{t('batchv.deleteTitle')}</DialogTitle>
              <DialogDescription className="text-xs">{t('event.cannotUndo')}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" size="sm" onClick={() => setDeleteId(null)}>{t('bform.cancel')}</Button>
              <Button variant="destructive" size="sm" disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteId)}>
                {deleteMutation.isPending ? t('event.deleting') : t('bform.delete')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
