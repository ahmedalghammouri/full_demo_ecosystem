'use client';
import { useTranslation } from 'react-i18next';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Search, Plus, Layers3, AlertTriangle, Pencil, Trash2, MoreHorizontal, Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { Checkbox } from '@/components/ui/checkbox';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SelectMenu } from '@/components/ui/select-menu';
import { EntityPicker } from '@/components/ui/entity-picker';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { useToast } from '@/components/ui/use-toast';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';

interface StorageLocationOption {
  id: string;
  code: string;
  name: string;
  zone: string;
}

interface MaterialLot {
  id: string;
  materialCode: string;
  materialName: string;
  lotNumber: string;
  supplierLot: string | null;
  supplierName: string | null;
  quantity: number;
  remainingQty: number;
  unit: string;
  status: string;
  receivedAt: string;
  expiryDate: string | null;
  storageLocation: string | null;
  storageLocationId: string | null;
  utilizationPct: number;
  isExpired: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'text-green-400 border-green-400/40',
  COMPLETED: 'text-muted-foreground border-border',
  RELEASED: 'text-blue-400 border-blue-400/40',
  REJECTED: 'text-red-400 border-red-400/40',
  ON_HOLD: 'text-amber-400 border-amber-400/40',
  QUARANTINE: 'text-orange-400 border-orange-400/40',
};

export function MaterialsView() {
  const { t } = useTranslation(['inventory', 'common']);
  const { toast } = useToast()
  const qc = useQueryClient()
  const { archive: archiveLot, restore: restoreLot, bulkArchive, bulkRestore } = useArchive('material-lots', [['inventory', 'materials']], 'Lot')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [archived, setArchived] = useState<ArchiveScope>('active')
  const [page, setPage] = useState(1)
  const [formOpen, setFormOpen] = useState(false)
  const [editLot, setEditLot] = useState<MaterialLot | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; lotNumber: string } | null>(null)
  const [form, setForm] = useState({
    rawMaterialId: '', materialCode: '', materialName: '', lotNumber: '',
    supplierName: '', quantity: '', unit: 'KG', expiryDate: '', storageLocationId: '',
  })

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'materials', search, status, archived, page],
    queryFn: () => api.get<{ data: MaterialLot[]; total: number }>('/inventory/materials', {
      params: { search: search || undefined, status: status || undefined, archived: archived !== 'active' ? archived : undefined, page, limit: 20 },
    }),
    staleTime: 30_000,
  })

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/inventory/materials', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory', 'materials'] })
      toast({ title: t('lotsView.createdSuccess') })
      handleCloseForm()
    },
    onError: (e: any) => toast({ title: t('rawMaterialsView.toast.error'), description: e?.response?.data?.message ?? t('lotsView.createError'), variant: 'destructive' }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/materials/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory', 'materials'] })
      toast({ title: t('lotsView.deletedSuccess') })
      setDeleteDialog(null)
    },
    onError: (e: any) => toast({ title: t('rawMaterialsView.toast.error'), description: e?.response?.data?.message ?? t('lotsView.deleteError'), variant: 'destructive' }),
  })

  const lots: MaterialLot[] = (data as any)?.data ?? [];
  const sel = useRowSelection(lots);
  const total: number = (data as any)?.total ?? 0;
  const expiredCount = lots.filter(l => l.isExpired).length;

  const { data: rawMatsData } = useQuery({
    queryKey: ['raw-materials-list'],
    queryFn: () => api.get('/inventory/raw-materials?limit=500'),
    staleTime: 60_000,
    enabled: formOpen,
  });
  const rawMaterials: any[] = (rawMatsData as any)?.data ?? [];

  const handleOpenCreate = () => {
    setEditLot(null)
    setForm({ rawMaterialId: '', materialCode: '', materialName: '', lotNumber: '', supplierName: '', quantity: '', unit: 'KG', expiryDate: '', storageLocationId: '' })
    setFormOpen(true)
  };

  const handleCloseForm = () => {
    setFormOpen(false)
    setEditLot(null)
  };

  const { data: storageLocData } = useQuery({
    queryKey: ['inventory', 'storage-locations'],
    queryFn: () => api.get<{ data: StorageLocationOption[] }>('/inventory/storage-locations'),
    staleTime: 300_000,
  });
  const storageLocations: StorageLocationOption[] = (storageLocData as any)?.data ?? (storageLocData as any) ?? [];

  const handleSubmit = () => {
    createMutation.mutate({
      rawMaterialId: form.rawMaterialId || undefined,
      materialCode: form.materialCode,
      materialName: form.materialName,
      lotNumber: form.lotNumber,
      supplierName: form.supplierName || undefined,
      quantity: parseFloat(form.quantity),
      unit: form.unit,
      expiryDate: form.expiryDate || undefined,
      storageLocationId: form.storageLocationId || null,
    })
  };

  const isValid = !!(form.rawMaterialId && form.lotNumber && form.quantity)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('headers.materials.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t('materialsCount', { count: total })}
            {expiredCount > 0 && <span className="text-red-400 font-semibold ms-2">• {t('expired', { count: expiredCount })}</span>}
          </p>
        </div>
        <Button size="sm" onClick={handleOpenCreate}>
          <Plus className="w-4 h-4 mr-1" />{t('lotsView.receiveLot')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder={t('lots.search')}
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="ps-8 h-9 w-64"
          />
        </div>
        <SelectMenu
          value={status}
          onValueChange={v => { setStatus(v); setPage(1); }}
          menuLabel={t('lotsView.statusLabel')}
          options={[
            { value: '', label: t('lotsView.allStatus') },
            ...['ACTIVE', 'COMPLETED', 'RELEASED', 'REJECTED', 'ON_HOLD', 'QUARANTINE'].map(s => ({ value: s, label: s })),
          ]}
        />
        <ArchiveFilter value={archived} onChange={(v) => { setArchived(v); setPage(1); }} className="h-9 w-36 text-xs" />
      </div>

      <InlineFormSlot />

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/60">
              <tr className="border-b border-border">
                <th className="p-3 w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('lots.selectAll')} /></th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('lots.col.material')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('lots.col.lot')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('lots.col.supplier')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('lots.col.qty')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('lots.col.remaining')}</th>
                <th className="text-center p-3 text-muted-foreground font-medium text-xs">{t('lots.col.usedPct')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('lots.col.location')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('lots.col.received')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('lots.col.expiry')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('lots.col.status')}</th>
                <th className="text-center p-3 text-muted-foreground font-medium text-xs">{t('lots.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i}><td colSpan={11} className="p-3"><div className="shimmer h-5 rounded" /></td></tr>
                ))
              ) : lots.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-12 text-center text-muted-foreground">
                    <Layers3 className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    {t('lots.noLots')}
                  </td>
                </tr>
              ) : (
                lots.map((lot, i) => (
                  <motion.tr
                    key={lot.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className={cn('border-b border-border/30 hover:bg-foreground/5', lot.isExpired && 'bg-red-500/5', sel.isSelected(lot.id) && 'bg-primary/5')}
                  >
                    <td className="p-3"><Checkbox checked={sel.isSelected(lot.id)} onCheckedChange={() => sel.toggle(lot.id)} aria-label={t('lotsView.selectRow')} /></td>
                    <td className="p-3 text-xs">
                      <div className="font-medium">{lot.materialName}</div>
                      <div className="text-[10px] font-mono text-muted-foreground">{lot.materialCode}</div>
                    </td>
                    <td className="p-3 text-xs font-mono">
                      {lot.lotNumber}
                      {lot.supplierLot && <div className="text-[10px] text-muted-foreground">{lot.supplierLot}</div>}
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{lot.supplierName ?? '—'}</td>
                    <td className="p-3 text-xs text-right">{lot.quantity.toLocaleString()} {lot.unit}</td>
                    <td className="p-3 text-xs text-right font-semibold">{lot.remainingQty.toLocaleString()} {lot.unit}</td>
                    <td className="p-3 text-xs text-center">
                      <div className="flex items-center gap-1.5 justify-center">
                        <div className="w-16 h-1.5 bg-foreground/10 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-brand-500 rounded-full"
                            style={{ width: `${lot.utilizationPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] text-muted-foreground">{lot.utilizationPct}%</span>
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">{lot.storageLocation ?? '—'}</td>
                    <td className="p-3 text-xs text-muted-foreground">{lot.receivedAt.slice(0, 10)}</td>
                    <td className="p-3 text-xs">
                      {lot.expiryDate ? (
                        <span className={lot.isExpired ? 'text-red-400 font-semibold' : 'text-muted-foreground'}>
                          {lot.isExpired && <AlertTriangle className="w-3 h-3 inline mr-0.5" />}
                          {lot.expiryDate.slice(0, 10)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="p-3 text-center">
                      <Badge variant="outline" className={cn('text-[10px]', STATUS_COLORS[lot.status] ?? '')}>
                        {lot.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-center">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {(lot as any).archivedAt ? (
                            <DropdownMenuItem onClick={() => restoreLot.mutate(lot.id)}>
                              <RotateCcw className="w-3.5 h-3.5 mr-2" />{t('lotsView.restore')}
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onClick={() => archiveLot.mutate(lot.id)}>
                              <ArchiveIcon className="w-3.5 h-3.5 mr-2" />{t('lotsView.archive')}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => setDeleteDialog({ id: lot.id, lotNumber: lot.lotNumber })} className="text-destructive">
                            <Trash2 className="w-3.5 h-3.5 mr-2" />{t('lotsView.delete')}
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

      <FormDialog
        open={formOpen}
        onClose={handleCloseForm}
        title={t('lotsView.formTitle')}
        onSubmit={handleSubmit}
        submitLabel={t('lotsView.receive')}
        isSubmitting={createMutation.isPending}
        isValid={isValid}
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>{t('lotsView.rawMaterialMaster')} *</Label>
            <EntityPicker
              items={rawMaterials}
              value={form.rawMaterialId || null}
              onChange={(id, mat) => {
                if (!id) {
                  setForm(f => ({ ...f, rawMaterialId: '', materialCode: '', materialName: '', unit: 'KG' }));
                  return;
                }
                setForm(f => ({
                  ...f,
                  rawMaterialId: id,
                  materialCode: (mat as any)?.code ?? '',
                  materialName: (mat as any)?.name ?? '',
                  unit: (mat as any)?.unit ?? f.unit,
                }));
              }}
              getId={(m: any) => m.id}
              getPrimary={(m: any) => m.name}
              getSecondary={(m: any) => m.code}
              getMeta={(m: any) => <span className="text-muted-foreground">{m.unit}</span>}
              placeholder={t('lotsView.selectRawMaterial')}
              searchPlaceholder={t('lotsView.searchByCodeName')}
              className="mt-1"
            />
          </div>
          <div>
            <Label>{t('lotsView.lotNumber')} *</Label>
            <Input value={form.lotNumber} onChange={e => setForm(v => ({ ...v, lotNumber: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('lotsView.supplier')}</Label>
            <Input value={form.supplierName} onChange={e => setForm(v => ({ ...v, supplierName: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('lotsView.quantity')} *</Label>
            <Input type="number" value={form.quantity} onChange={e => setForm(v => ({ ...v, quantity: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('lotsView.unit')}</Label>
            <Input value={form.unit} onChange={e => setForm(v => ({ ...v, unit: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('lotsView.expiryDate')}</Label>
            <Input type="date" value={form.expiryDate} onChange={e => setForm(v => ({ ...v, expiryDate: e.target.value }))} className="mt-1" />
          </div>
          <div>
            <Label>{t('lotsView.storageLocation')}</Label>
            <EntityPicker
              items={storageLocations}
              value={form.storageLocationId || null}
              onChange={id => setForm(p => ({ ...p, storageLocationId: id ?? '' }))}
              getId={loc => loc.id}
              getPrimary={loc => loc.name}
              getSecondary={loc => loc.code}
              placeholder={t('lotsView.selectLocation')}
              searchPlaceholder={t('lotsView.searchByCodeName')}
              className="mt-1"
            />
          </div>
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('lotsView.deleteTitle', { lot: deleteDialog?.lotNumber })}
        description={t('lotsView.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('lotsView.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('lotsView.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  )
}
