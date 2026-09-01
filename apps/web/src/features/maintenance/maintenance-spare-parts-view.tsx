'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo } from 'react';
import { Plus, Download, Search, AlertTriangle, Pencil, Trash2, MoreHorizontal, ArrowUpDown } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { KPICard } from '@/components/widgets/kpi-card';
import { TablePagination } from '@/components/ui/table-pagination';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

interface SparePart {
  id: string;
  partNumber: string;
  name: string;
  description: string | null;
  category: string | null;
  manufacturer: string | null;
  supplier: string | null;
  unitCost: number | null;
  stockQty: number;
  minStockQty: number;
  maxStockQty: number | null;
  storageLocation: string | null;
  binNumber: string | null;
  isLowStock: boolean;
}

const EMPTY_FORM = {
  partNumber: '', name: '', description: '', category: '',
  manufacturer: '', supplier: '', unitCost: '', minStockQty: '',
  maxStockQty: '', storageLocation: '', binNumber: '',
};

export function MaintenanceSparePartsView() {
  const { t } = useTranslation(['maintenance', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SparePart | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<SparePart | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustType, setAdjustType] = useState<'ADD' | 'REMOVE' | 'SET'>('ADD');
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: partsData, isLoading } = useQuery({
    queryKey: ['maintenance', 'spare-parts', { search, page }],
    queryFn: () => api.get('/maintenance/spare-parts', { params: { search: search || undefined, limit: 20, page } }),
    staleTime: 30_000,
  });

  const { data: kpis } = useQuery({
    queryKey: ['maintenance', 'spare-parts-kpis'],
    queryFn: () => api.get('/maintenance/spare-parts/kpis'),
    staleTime: 60_000,
  });

  const parts: SparePart[] = (partsData as any)?.data ?? [];
  const total: number = (partsData as any)?.total ?? 0;
  const outOfStock = parts.filter(p => p.stockQty === 0).length;

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/inventory/spare-parts', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'spare-parts'] });
      qc.invalidateQueries({ queryKey: ['maintenance', 'spare-parts-kpis'] });
      toast({ title: 'Spare part created' });
      setFormOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to create', variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/inventory/spare-parts/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'spare-parts'] });
      toast({ title: 'Spare part updated' });
      setEditTarget(null);
      setFormOpen(false);
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to update', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/spare-parts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'spare-parts'] });
      qc.invalidateQueries({ queryKey: ['maintenance', 'spare-parts-kpis'] });
      toast({ title: 'Spare part deleted' });
      setDeleteDialog(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to delete', variant: 'destructive' }),
  });

  const adjustMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.post(`/inventory/spare-parts/${id}/adjust`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'spare-parts'] });
      qc.invalidateQueries({ queryKey: ['maintenance', 'spare-parts-kpis'] });
      toast({ title: 'Stock adjusted' });
      setAdjustTarget(null);
      setAdjustQty('');
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to adjust', variant: 'destructive' }),
  });

  const handleOpenCreate = () => {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const handleOpenEdit = (part: SparePart) => {
    setEditTarget(part);
    setForm({
      partNumber: part.partNumber,
      name: part.name,
      description: part.description ?? '',
      category: part.category ?? '',
      manufacturer: part.manufacturer ?? '',
      supplier: part.supplier ?? '',
      unitCost: part.unitCost?.toString() ?? '',
      minStockQty: part.minStockQty.toString(),
      maxStockQty: part.maxStockQty?.toString() ?? '',
      storageLocation: part.storageLocation ?? '',
      binNumber: part.binNumber ?? '',
    });
    setFormOpen(true);
  };

  const handleSubmit = () => {
    const dto = {
      name: form.name,
      description: form.description || undefined,
      category: form.category || undefined,
      manufacturer: form.manufacturer || undefined,
      supplier: form.supplier || undefined,
      unitCost: form.unitCost ? parseFloat(form.unitCost) : undefined,
      minStockQty: form.minStockQty ? parseInt(form.minStockQty) : undefined,
      maxStockQty: form.maxStockQty ? parseInt(form.maxStockQty) : undefined,
      storageLocation: form.storageLocation || undefined,
      binNumber: form.binNumber || undefined,
    };

    if (editTarget) {
      updateMutation.mutate({ id: editTarget.id, dto });
    } else {
      createMutation.mutate({ ...dto, partNumber: form.partNumber, stockQty: 0 });
    }
  };

  const isValid = !!form.name && !!form.partNumber && !!form.minStockQty;
  const isPending = editTarget ? updateMutation.isPending : createMutation.isPending;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.spareParts.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('headers.spareParts.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Download size={13} />Export
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}>
            <Plus size={13} />Add Part
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <InlineFormSlot />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title="Total Parts" value={(kpis as any)?.total ?? 0} isLoading={isLoading} />
          <KPICard title="Low Stock" value={(kpis as any)?.lowStock ?? 0} colorMode="alarm" isLoading={isLoading} />
          <KPICard title="Out of Stock" value={outOfStock} colorMode="alarm" isLoading={isLoading} />
          <KPICard title="Total Value" value={(kpis as any)?.totalValue ?? 0} unit="SAR" isLoading={isLoading} />
        </div>

        <div className="industrial-card p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">{t('spares.title')}</h3>
            <div className="relative">
              <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('spares.search')}
                value={search}
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                className="h-8 ps-7 w-48 text-xs"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/30 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent border-border/30">
                  <TableHead className="text-[11px] font-semibold">{t('spares.col.partNumber')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('spares.col.nameDesc')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('spares.col.category')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('spares.col.quantity')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('spares.col.minStock')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('spares.col.unitCost')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('spares.col.location')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('spares.col.status')}</TableHead>
                  <TableHead className="text-[11px] font-semibold">{t('spares.col.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i} className="border-border/20">
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><div className="shimmer h-3.5 rounded w-20" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : parts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground text-sm">
                      {t('spares.noParts')}
                    </TableCell>
                  </TableRow>
                ) : (
                  parts.map((part) => {
                    const isOut = part.stockQty === 0;
                    const isLow = part.isLowStock;
                    return (
                      <TableRow key={part.id} className={cn('border-border/20 hover:bg-muted/20', isOut && 'bg-red-500/5', isLow && !isOut && 'bg-amber-500/5')}>
                        <TableCell className="font-mono text-xs font-semibold text-primary">{part.partNumber}</TableCell>
                        <TableCell className="text-xs">
                          <div className="font-medium">{part.name}</div>
                          {part.description && <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{part.description}</div>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{part.category ?? '—'}</TableCell>
                        <TableCell className={cn('text-xs font-bold', isOut ? 'text-red-400' : isLow ? 'text-amber-400' : 'text-green-400')}>
                          {isLow && <AlertTriangle size={11} className="inline mr-0.5" />}
                          {part.stockQty}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">{part.minStockQty}</TableCell>
                        <TableCell className="text-xs">{part.unitCost != null ? `${part.unitCost.toFixed(2)} SAR` : '—'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {part.storageLocation ?? '—'}
                          {part.binNumber && <span className="ml-1 text-[10px]">({part.binNumber})</span>}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={isOut ? 'destructive' : isLow ? 'outline' : 'secondary'}
                            className="text-[10px] h-5"
                          >
                            {isOut ? 'Out of Stock' : isLow ? 'Low Stock' : 'In Stock'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-7 w-7">
                                <MoreHorizontal size={13} />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem className="gap-2 text-xs" onClick={() => {
                                setAdjustTarget(part);
                                setAdjustQty('');
                                setAdjustType('ADD');
                              }}>
                                <ArrowUpDown size={12} /> Adjust Stock
                              </DropdownMenuItem>
                              <DropdownMenuItem className="gap-2 text-xs" onClick={() => handleOpenEdit(part)}>
                                <Pencil size={12} /> Edit
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="gap-2 text-xs text-destructive"
                                onClick={() => setDeleteDialog({ id: part.id, name: part.name })}
                              >
                                <Trash2 size={12} /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
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

      {/* Create / Edit Dialog */}
      <FormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null); }}
        title={editTarget ? t('spform.editTitle') : t('spform.createTitle')}
        onSubmit={handleSubmit}
        isSubmitting={isPending}
        isValid={isValid}
      >
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t('spform.partNumber')} *</Label>
            <Input
              value={form.partNumber}
              onChange={e => setForm(v => ({ ...v, partNumber: e.target.value }))}
              className="mt-1"
              disabled={!!editTarget}
            />
          </div>
          <div>
            <Label>{t('spform.category')}</Label>
            <Input value={form.category} onChange={e => setForm(v => ({ ...v, category: e.target.value }))} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>{t('spform.name')} *</Label>
            <Input value={form.name} onChange={e => setForm(v => ({ ...v, name: e.target.value }))} className="mt-1" />
          </div>
          <div className="col-span-2">
            <Label>{t('spform.description')}</Label>
            <Input value={form.description} onChange={e => setForm(v => ({ ...v, description: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('spform.manufacturer')}</Label>
            <Input value={form.manufacturer} onChange={e => setForm(v => ({ ...v, manufacturer: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('spform.supplier')}</Label>
            <Input value={form.supplier} onChange={e => setForm(v => ({ ...v, supplier: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('spform.unitCost')}</Label>
            <Input type="number" step="0.01" value={form.unitCost} onChange={e => setForm(v => ({ ...v, unitCost: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('spform.minStock')} *</Label>
            <Input type="number" value={form.minStockQty} onChange={e => setForm(v => ({ ...v, minStockQty: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('spform.maxStock')}</Label>
            <Input type="number" value={form.maxStockQty} onChange={e => setForm(v => ({ ...v, maxStockQty: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('spform.storageLocation')}</Label>
            <Input value={form.storageLocation} onChange={e => setForm(v => ({ ...v, storageLocation: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('spform.binNumber')}</Label>
            <Input value={form.binNumber} onChange={e => setForm(v => ({ ...v, binNumber: e.target.value }))} className="mt-1" />
          </div>
        </div>
      </FormDialog>

      {/* Adjust Stock */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="industrial-card rounded-xl p-6 w-full max-w-sm space-y-4">
            <h3 className="font-semibold text-sm">{t('spform.adjustTitle', { name: adjustTarget.name })}</h3>
            <p className="text-xs text-muted-foreground">{t('spform.current')} <span className="font-bold text-foreground">{adjustTarget.stockQty}</span></p>
            <div className="flex gap-2">
              {(['ADD', 'REMOVE', 'SET'] as const).map(ty => (
                <button
                  key={ty}
                  onClick={() => setAdjustType(ty)}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    adjustType === ty ? 'bg-brand-600 border-brand-600 text-white' : 'border-border text-muted-foreground hover:bg-foreground/5',
                  )}
                >
                  {t(`spform.${ty.toLowerCase()}`, { defaultValue: ty })}
                </button>
              ))}
            </div>
            <Input
              type="number"
              placeholder={t('spform.quantity')}
              value={adjustQty}
              onChange={e => setAdjustQty(e.target.value)}
              min={0}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setAdjustTarget(null)}>{t('spform.cancel')}</Button>
              <Button
                size="sm"
                disabled={!adjustQty || adjustMutation.isPending}
                onClick={() => adjustMutation.mutate({
                  id: adjustTarget.id,
                  dto: { quantity: parseFloat(adjustQty), type: adjustType },
                })}
              >
                {adjustMutation.isPending ? t('spform.saving') : t('spform.apply')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('spform.deleteTitle', { name: deleteDialog?.name })}
        description={t('spform.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}
