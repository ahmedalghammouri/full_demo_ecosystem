'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Package, Search, AlertTriangle, Plus, TrendingDown, Edit3, ArrowUpDown, Trash2, MoreHorizontal, Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { Checkbox } from '@/components/ui/checkbox';
import { useRowSelection } from '@/hooks/use-row-selection';
import { useArchive } from '@/hooks/use-archive';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';

interface StorageLocationOption {
  id: string;
  code: string;
  name: string;
  zone: string;
}

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
  storageLocationId: string | null;
  binNumber: string | null;
  isLowStock: boolean;
  stockValue: number;
  lastUsed: string | null;
}

function timeAgo(iso: string | null) {
  if (!iso) return 'Never';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return `${days}d ago`;
}

const EMPTY_PART_FORM = { partNumber: '', name: '', description: '', category: '', manufacturer: '', supplier: '', unitCost: '', minStockQty: '', maxStockQty: '', storageLocationId: '', binNumber: '' };

export function SparePartsView() {
  const { t } = useTranslation(['inventory', 'common']);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [archived, setArchived] = useState<ArchiveScope>('active');
  const [page, setPage] = useState(1);
  const [adjustTarget, setAdjustTarget] = useState<SparePart | null>(null);
  const [adjustQty, setAdjustQty] = useState('');
  const [adjustType, setAdjustType] = useState<'ADD' | 'REMOVE' | 'SET'>('ADD');
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SparePart | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);
  const [createForm, setCreateForm] = useState(EMPTY_PART_FORM);

  const { data: storageLocData } = useQuery({
    queryKey: ['inventory', 'storage-locations'],
    queryFn: () => api.get<{ data: StorageLocationOption[] }>('/inventory/storage-locations'),
    staleTime: 300_000,
  });
  const storageLocations: StorageLocationOption[] = (storageLocData as any)?.data ?? (storageLocData as any) ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'spare-parts', search, category, lowStockOnly, archived, page],
    queryFn: () => api.get<{ data: SparePart[]; total: number }>('/inventory/spare-parts', {
      params: {
        search: search || undefined,
        category: category || undefined,
        lowStock: lowStockOnly ? 'true' : undefined,
        archived: archived !== 'active' ? archived : undefined,
        page,
        limit: 20,
      },
    }),
    staleTime: 30_000,
  });

  const adjustMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) =>
      api.post(`/inventory/spare-parts/${id}/adjust`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      setAdjustTarget(null);
      setAdjustQty('');
    },
  });

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/inventory/spare-parts', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      toast({ title: 'Spare part created' });
      setCreateOpen(false);
      setCreateForm(EMPTY_PART_FORM);
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to create', variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/inventory/spare-parts/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      toast({ title: 'Spare part updated' });
      setEditTarget(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to update', variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/spare-parts/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      toast({ title: 'Spare part deleted' });
      setDeleteDialog(null);
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed to delete', variant: 'destructive' }),
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, restore }: { id: string; restore: boolean }) =>
      api.patch(`/archive/spare-parts/${id}/${restore ? 'restore' : 'archive'}`, {}),
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['archive'] });
      toast({ title: v.restore ? 'Spare part restored' : 'Spare part archived' });
    },
    onError: (e: any) => toast({ title: 'Error', description: e?.response?.data?.message ?? 'Failed', variant: 'destructive' }),
  });

  const parts: SparePart[] = (data as any)?.data ?? [];
  const total: number = (data as any)?.total ?? 0;
  const sel = useRowSelection(parts);
  const { bulkArchive, bulkRestore } = useArchive('spare-parts', [['inventory']], 'Spare part');
  const lowCount = parts.filter(p => p.isLowStock).length;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('headers.spareParts.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('partsTotal', { count: total })} {lowCount > 0 && <span className="text-red-400 font-semibold">• {t('lowStock', { count: lowCount })}</span>}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />Add Part
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder={t('spareParts.search')}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="ps-8 h-9 w-64"
          />
        </div>
        <Input
          placeholder={t('spareParts.category')}
          value={category}
          onChange={e => { setCategory(e.target.value); setPage(1); }}
          className="h-9 w-40"
        />
        <Button
          variant={lowStockOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => { setLowStockOnly(v => !v); setPage(1); }}
        >
          <AlertTriangle className="w-3.5 h-3.5 mr-1.5" />
          Low Stock Only
        </Button>
        <ArchiveFilter value={archived} onChange={(v) => { setArchived(v); setPage(1); }} className="h-9 w-36 text-xs" />
      </div>

      <InlineFormSlot />

      {/* Table */}
      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/60">
              <tr className="border-b border-border">
                <th className="p-3 w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('spareParts.selectAll')} /></th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.part')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.name')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.category')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.supplier')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.stock')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.min')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.unitCost')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.value')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.location')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.lastUsed')}</th>
                <th className="text-center p-3 text-muted-foreground font-medium text-xs">{t('spareParts.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={12} className="p-3"><div className="shimmer h-5 rounded" /></td></tr>
                ))
              ) : parts.length === 0 ? (
                <tr><td colSpan={12} className="p-12 text-center text-muted-foreground">{t('spareParts.noParts')}</td></tr>
              ) : (
                parts.map((p, i) => (
                  <motion.tr
                    key={p.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className={cn('border-b border-border/30 hover:bg-foreground/5', p.isLowStock && 'bg-red-500/5', sel.isSelected(p.id) && 'bg-primary/5')}
                  >
                    <td className="p-3"><Checkbox checked={sel.isSelected(p.id)} onCheckedChange={() => sel.toggle(p.id)} aria-label="Select row" /></td>
                    <td className="p-3 text-xs font-mono text-muted-foreground">{p.partNumber}</td>
                    <td className="p-3 text-xs font-medium">
                      {p.name}
                      {p.description && <div className="text-[10px] text-muted-foreground mt-0.5 max-w-[200px] truncate">{p.description}</div>}
                    </td>
                    <td className="p-3 text-xs">
                      {p.category && <Badge variant="outline" className="text-[10px]">{p.category}</Badge>}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{p.supplier ?? '—'}</td>
                    <td className={cn('p-3 text-xs text-right font-bold', p.isLowStock ? 'text-red-400' : 'text-green-400')}>
                      {p.isLowStock && <TrendingDown className="w-3 h-3 inline mr-0.5" />}
                      {p.stockQty}
                    </td>
                    <td className="p-3 text-xs text-right text-muted-foreground">{p.minStockQty}</td>
                    <td className="p-3 text-xs text-right">{p.unitCost != null ? p.unitCost.toFixed(2) : '—'}</td>
                    <td className="p-3 text-xs text-right font-semibold">{p.stockValue.toLocaleString()}</td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {p.storageLocation ?? '—'}
                      {p.binNumber && <span className="ml-1 text-[10px]">({p.binNumber})</span>}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{timeAgo(p.lastUsed)}</td>
                    <td className="p-3 text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem className="gap-2 text-xs" onClick={() => { setAdjustTarget(p); setAdjustQty(''); setAdjustType('ADD'); }}>
                            <ArrowUpDown className="w-3 h-3" /> Adjust Stock
                          </DropdownMenuItem>
                          <DropdownMenuItem className="gap-2 text-xs" onClick={() => {
                            setEditTarget(p);
                            setCreateForm({
                              partNumber: p.partNumber,
                              name: p.name,
                              description: p.description ?? '',
                              category: p.category ?? '',
                              manufacturer: p.manufacturer ?? '',
                              supplier: p.supplier ?? '',
                              unitCost: p.unitCost?.toString() ?? '',
                              minStockQty: p.minStockQty.toString(),
                              maxStockQty: p.maxStockQty?.toString() ?? '',
                              storageLocationId: p.storageLocationId ?? '',
                              binNumber: p.binNumber ?? '',
                            });
                          }}>
                            <Edit3 className="w-3 h-3" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuSeparator />
                          {(p as any).archivedAt ? (
                            <DropdownMenuItem className="gap-2 text-xs" onClick={() => archiveMutation.mutate({ id: p.id, restore: true })}>
                              <RotateCcw className="w-3 h-3" /> Restore
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem className="gap-2 text-xs" onClick={() => archiveMutation.mutate({ id: p.id, restore: false })}>
                              <ArchiveIcon className="w-3 h-3" /> Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem className="gap-2 text-xs text-destructive" onClick={() => setDeleteDialog({ id: p.id, name: p.name })}>
                            <Trash2 className="w-3 h-3" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <TablePagination page={page} total={total} limit={20} onPageChange={setPage} isLoading={isLoading} />
      </div>

      {/* Adjust stock modal */}
      {adjustTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-card rounded-xl p-6 w-full max-w-md space-y-4"
          >
            <h3 className="font-semibold">Adjust Stock — {adjustTarget.name}</h3>
            <p className="text-sm text-muted-foreground">Current: <span className="font-bold text-foreground">{adjustTarget.stockQty}</span></p>
            <div className="flex gap-2">
              {(['ADD', 'REMOVE', 'SET'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setAdjustType(t)}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors',
                    adjustType === t ? 'bg-brand-600 border-brand-600 text-white' : 'border-border text-muted-foreground hover:bg-foreground/5',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <Input
              type="number"
              placeholder="Quantity"
              value={adjustQty}
              onChange={e => setAdjustQty(e.target.value)}
              className="h-9"
              min={0}
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" onClick={() => setAdjustTarget(null)}>Cancel</Button>
              <Button
                size="sm"
                disabled={!adjustQty || adjustMutation.isPending}
                onClick={() => adjustMutation.mutate({
                  id: adjustTarget.id,
                  dto: { quantity: parseFloat(adjustQty), type: adjustType },
                })}
              >
                {adjustMutation.isPending ? 'Saving…' : 'Apply'}
              </Button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Edit Spare Part — inline form */}
      <InlineFormPanel
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={t('spform.editTitle')}
        description={editTarget?.name}
        icon={Edit3}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setEditTarget(null)}>{t('spform.cancel')}</Button>
            <Button
              size="sm"
              disabled={!createForm.name || !createForm.minStockQty || updateMutation.isPending}
              onClick={() => editTarget && updateMutation.mutate({
                id: editTarget.id,
                dto: {
                  name: createForm.name,
                  description: createForm.description || null,
                  category: createForm.category || null,
                  manufacturer: createForm.manufacturer || null,
                  supplier: createForm.supplier || null,
                  unitCost: createForm.unitCost ? parseFloat(createForm.unitCost) : null,
                  minStockQty: parseInt(createForm.minStockQty),
                  maxStockQty: createForm.maxStockQty ? parseInt(createForm.maxStockQty) : null,
                  storageLocationId: createForm.storageLocationId || null,
                  binNumber: createForm.binNumber || null,
                },
              })}
            >
              {updateMutation.isPending ? t('spform.saving') : t('spform.saveChanges')}
            </Button>
          </>
        )}
      >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('spform.partNumber')}</Label>
              <Input value={createForm.partNumber} disabled className="h-9 mt-1 opacity-60" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.category')}</Label>
              <Input value={createForm.category} onChange={e => setCreateForm(v => ({ ...v, category: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t('spform.name')}*</Label>
              <Input value={createForm.name} onChange={e => setCreateForm(v => ({ ...v, name: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t('spform.description')}</Label>
              <Input value={createForm.description} onChange={e => setCreateForm(v => ({ ...v, description: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.manufacturer')}</Label>
              <Input value={createForm.manufacturer} onChange={e => setCreateForm(v => ({ ...v, manufacturer: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.supplier')}</Label>
              <Input value={createForm.supplier} onChange={e => setCreateForm(v => ({ ...v, supplier: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.unitCost')}</Label>
              <Input type="number" step="0.01" value={createForm.unitCost} onChange={e => setCreateForm(v => ({ ...v, unitCost: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.minStock')}*</Label>
              <Input type="number" value={createForm.minStockQty} onChange={e => setCreateForm(v => ({ ...v, minStockQty: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.maxStock')}</Label>
              <Input type="number" value={createForm.maxStockQty} onChange={e => setCreateForm(v => ({ ...v, maxStockQty: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.storageLocation')}</Label>
              <EntityPicker
                items={storageLocations}
                value={createForm.storageLocationId || null}
                onChange={id => setCreateForm(p => ({ ...p, storageLocationId: id ?? '' }))}
                getId={loc => loc.id}
                getPrimary={loc => loc.name}
                getSecondary={loc => loc.code}
                placeholder={t('spform.selectLocation')}
                searchPlaceholder={t('spform.searchLocation')}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">{t('spform.binNumber')}</Label>
              <Input value={createForm.binNumber} onChange={e => setCreateForm(v => ({ ...v, binNumber: e.target.value }))} className="h-9 mt-1" />
            </div>
          </div>
      </InlineFormPanel>

      {/* Create Spare Part — inline form */}
      <InlineFormPanel
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('spform.createTitle')}
        description={t('spform.createDesc')}
        icon={Plus}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>{t('spform.cancel')}</Button>
            <Button size="sm" disabled={!createForm.partNumber || !createForm.name || !createForm.minStockQty || createMutation.isPending} onClick={() => createMutation.mutate({
              partNumber: createForm.partNumber,
              name: createForm.name,
              description: createForm.description || null,
              category: createForm.category || null,
              manufacturer: createForm.manufacturer || null,
              supplier: createForm.supplier || null,
              unitCost: createForm.unitCost ? parseFloat(createForm.unitCost) : null,
              minStockQty: parseInt(createForm.minStockQty),
              maxStockQty: createForm.maxStockQty ? parseInt(createForm.maxStockQty) : null,
              storageLocationId: createForm.storageLocationId || null,
              binNumber: createForm.binNumber || null,
              stockQty: 0,
            })}>
              {createMutation.isPending ? t('spform.creating') : t('spform.createPart')}
            </Button>
          </>
        )}
      >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('spform.partNumber')}*</Label>
              <Input value={createForm.partNumber} onChange={e => setCreateForm(v => ({ ...v, partNumber: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.category')}</Label>
              <Input value={createForm.category} onChange={e => setCreateForm(v => ({ ...v, category: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t('spform.name')}*</Label>
              <Input value={createForm.name} onChange={e => setCreateForm(v => ({ ...v, name: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t('spform.description')}</Label>
              <Input value={createForm.description} onChange={e => setCreateForm(v => ({ ...v, description: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.manufacturer')}</Label>
              <Input value={createForm.manufacturer} onChange={e => setCreateForm(v => ({ ...v, manufacturer: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.supplier')}</Label>
              <Input value={createForm.supplier} onChange={e => setCreateForm(v => ({ ...v, supplier: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.unitCost')}</Label>
              <Input type="number" step="0.01" value={createForm.unitCost} onChange={e => setCreateForm(v => ({ ...v, unitCost: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.minStock')}*</Label>
              <Input type="number" value={createForm.minStockQty} onChange={e => setCreateForm(v => ({ ...v, minStockQty: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.maxStock')}</Label>
              <Input type="number" value={createForm.maxStockQty} onChange={e => setCreateForm(v => ({ ...v, maxStockQty: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('spform.storageLocation')}</Label>
              <EntityPicker
                items={storageLocations}
                value={createForm.storageLocationId || null}
                onChange={id => setCreateForm(p => ({ ...p, storageLocationId: id ?? '' }))}
                getId={loc => loc.id}
                getPrimary={loc => loc.name}
                getSecondary={loc => loc.code}
                placeholder={t('spform.selectLocation')}
                searchPlaceholder={t('spform.searchLocation')}
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">{t('spform.binNumber')}</Label>
              <Input value={createForm.binNumber} onChange={e => setCreateForm(v => ({ ...v, binNumber: e.target.value }))} className="h-9 mt-1" />
            </div>
          </div>
      </InlineFormPanel>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('spform.deleteTitle', { name: deleteDialog?.name })}
        description={t('spform.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('spform.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('spform.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  );
}
