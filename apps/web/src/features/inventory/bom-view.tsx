'use client';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, ChevronDown, ChevronRight, CheckCircle2,
  Trash2, X, GitBranch, FlaskConical, FileCheck2, Info,
  Edit2, AlertTriangle, Package, Layers, Workflow, Sparkles, RefreshCcw,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { cn } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';

interface BOMItem {
  id: string;
  rawMaterialId: string;
  quantityPer: number;
  unit: string;
  scrapFactor: number;
  isOptional: boolean;
  notes?: string;
  rawMaterial: { id: string; code: string; name: string; unit: string; unitCost?: number };
  routingStepRef?: { stepNumber: number; operationName: string } | null;
}

type BomSource = 'MANUAL' | 'DERIVED_FROM_PROCESS' | 'DRAFT_FOR_PROCESS';

interface BOM {
  id: string;
  skuId: string;
  version: string;
  isActive: boolean;
  approvedAt?: string;
  notes?: string;
  processId?: string | null;
  sourceType?: BomSource;
  isStale?: boolean;
  process?: { id: string; name: string; version: string; scopeType: string } | null;
  sku: { id: string; code: string; name: string; itemNumber: string; category?: string };
  items: BOMItem[];
}

interface ResolvedProcess {
  found: boolean;
  process: {
    id: string; name: string; version: string; scopeType: string;
    steps: Array<{ stepNumber: number; operationName: string; outUnit: string | null; materials: number }>;
    totalMaterials: number;
  } | null;
}

interface RawMaterial {
  id: string;
  code: string;
  name: string;
  unit: string;
  unitCost?: number;
}

interface MaterialLotSummary {
  rawMaterialId: string;
  activeLots: number;
  totalRemaining: number;
  unit: string;
}

const UNITS = ['KG', 'G', 'L', 'ML', 'PCS', 'BOX', 'ROLL', 'M', 'CM', 'BAG', 'DRUM', 'PALLET'];

export function BOMView() {
  const { t } = useTranslation(['inventory', 'common']);
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editBOM, setEditBOM] = useState<BOM | null>(null);
  const [deleteBOMTarget, setDeleteBOMTarget] = useState<BOM | null>(null);
  const [addItemBOM, setAddItemBOM] = useState<BOM | null>(null);

  const [newBOM, setNewBOM] = useState({ skuId: '', version: '1.0', notes: '' });
  const [newItems, setNewItems] = useState<Array<{
    rawMaterialId: string; quantityPer: string; unit: string; scrapFactor: string; isOptional: boolean; notes: string;
  }>>([{ rawMaterialId: '', quantityPer: '', unit: 'KG', scrapFactor: '0', isOptional: false, notes: '' }]);

  const [addItem, setAddItem] = useState({ rawMaterialId: '', quantityPer: '', unit: 'KG', scrapFactor: '0', notes: '' });
  const [editForm, setEditForm] = useState({ version: '', notes: '' });

  const { data: bomData, isLoading } = useQuery({
    queryKey: ['bom', page],
    queryFn: () => api.get(`/inventory/bom?page=${page}&limit=20`),
  });

  const { data: skusData } = useQuery({
    queryKey: ['products-list'],
    queryFn: () => api.get('/inventory/products?limit=200'),
    staleTime: 60_000,
  });

  const { data: rawMatsData } = useQuery({
    queryKey: ['raw-materials-list'],
    queryFn: () => api.get('/inventory/raw-materials?limit=500'),
    staleTime: 60_000,
  });

  const { data: materialLotsData } = useQuery({
    queryKey: ['material-lots-summary'],
    queryFn: () => api.get('/inventory/materials?limit=500&status=ACTIVE'),
    staleTime: 30_000,
  });

  const boms: BOM[] = (bomData as any)?.data ?? [];
  const total: number = (bomData as any)?.total ?? 0;
  const skus: any[] = (skusData as any)?.data ?? [];
  const rawMaterials: RawMaterial[] = (rawMatsData as any)?.data ?? [];

  // Smart linking: when a product is picked, look up the process the BOM could derive from
  const { data: resolvedProcess } = useQuery<ResolvedProcess>({
    queryKey: ['bom-resolve-process', newBOM.skuId],
    queryFn: () => api.get(`/inventory/bom/resolve-process?skuId=${newBOM.skuId}`) as Promise<ResolvedProcess>,
    enabled: createOpen && !!newBOM.skuId,
    staleTime: 30_000,
  });

  const rawLots: any[] = (materialLotsData as any)?.data ?? [];
  const lotsByMaterial: Record<string, MaterialLotSummary> = rawLots.reduce((acc, lot) => {
    const key = lot.rawMaterialId;
    if (!key) return acc;
    if (!acc[key]) acc[key] = { rawMaterialId: key, activeLots: 0, totalRemaining: 0, unit: lot.unit };
    acc[key].activeLots += 1;
    acc[key].totalRemaining += lot.remainingQty ?? 0;
    return acc;
  }, {} as Record<string, MaterialLotSummary>);

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/inventory/bom', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom'] });
      setCreateOpen(false);
      setNewBOM({ skuId: '', version: '1.0', notes: '' });
      setNewItems([{ rawMaterialId: '', quantityPer: '', unit: 'KG', scrapFactor: '0', isOptional: false, notes: '' }]);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/inventory/bom/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom'] });
      setEditBOM(null);
    },
  });

  // Derive a BOM from the resolved manufacturing process (smart linking)
  const deriveMutation = useMutation({
    mutationFn: (dto: { skuId: string; processId?: string }) =>
      api.post('/inventory/bom/generate-from-process', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom'] });
      setCreateOpen(false);
      setNewBOM({ skuId: '', version: '1.0', notes: '' });
      setNewItems([{ rawMaterialId: '', quantityPer: '', unit: 'KG', scrapFactor: '0', isOptional: false, notes: '' }]);
    },
  });

  // Inverse guided flow: generate a DRAFT process from a manual BOM
  const genProcessMutation = useMutation({
    mutationFn: (bomId: string) => api.post(`/inventory/bom/${bomId}/generate-process`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom'] });
      queryClient.invalidateQueries({ queryKey: ['manufacturing-processes'] });
    },
  });

  const deleteBOMMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/bom/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom'] });
      setDeleteBOMTarget(null);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.post(`/inventory/bom/${id}/approve`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bom'] }),
  });

  const addItemMutation = useMutation({
    mutationFn: ({ bomId, dto }: { bomId: string; dto: any }) =>
      api.post(`/inventory/bom/${bomId}/items`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bom'] });
      setAddItemBOM(null);
      setAddItem({ rawMaterialId: '', quantityPer: '', unit: 'KG', scrapFactor: '0', notes: '' });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: ({ bomId, itemId }: { bomId: string; itemId: string }) =>
      api.delete(`/inventory/bom/${bomId}/items/${itemId}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bom'] }),
  });

  const filteredBOMs = boms.filter(b =>
    !search ||
    b.sku.name.toLowerCase().includes(search.toLowerCase()) ||
    b.sku.code.toLowerCase().includes(search.toLowerCase()) ||
    b.sku.itemNumber.toLowerCase().includes(search.toLowerCase()),
  );

  const addNewItemRow = () =>
    setNewItems(prev => [...prev, { rawMaterialId: '', quantityPer: '', unit: 'KG', scrapFactor: '0', isOptional: false, notes: '' }]);

  const removeItemRow = (i: number) =>
    setNewItems(prev => prev.filter((_, idx) => idx !== i));

  const handleCreate = () => {
    if (!newBOM.skuId || newItems.some(i => !i.rawMaterialId || !i.quantityPer)) return;
    createMutation.mutate({
      skuId: newBOM.skuId,
      version: newBOM.version,
      notes: newBOM.notes || undefined,
      items: newItems.map(i => ({
        rawMaterialId: i.rawMaterialId,
        quantityPer: parseFloat(i.quantityPer),
        unit: i.unit,
        scrapFactor: parseFloat(i.scrapFactor) || 0,
        isOptional: i.isOptional,
        notes: i.notes || undefined,
      })),
    });
  };

  const handleOpenEdit = (bom: BOM) => {
    setEditForm({ version: bom.version, notes: bom.notes ?? '' });
    setEditBOM(bom);
  };

  const calcBOMCost = (bom: BOM) =>
    bom.items.reduce((sum, item) => {
      const cost = item.rawMaterial.unitCost ?? 0;
      const qty = item.quantityPer * (1 + item.scrapFactor);
      return sum + cost * qty;
    }, 0);

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">{t('headers.bom.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('headers.bom.subtitle')}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus size={14} className="mr-1.5" />
          {t('bomView.newBom')}
        </Button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
        <Info size={15} className="mt-0.5 text-primary shrink-0" />
        <span>
          {t('bomView.infoBanner')}
        </span>
      </div>

      <InlineFormSlot />

      {/* Search */}
      <div className="relative w-72">
        <Search size={14} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder={t('bomView.search')}
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="ps-8 h-8 text-sm"
        />
      </div>

      {/* BOM list */}
      <div className="flex flex-col gap-3">
        {isLoading ? (
          <div className="text-sm text-muted-foreground p-8 text-center">{t('bomView.loading')}</div>
        ) : filteredBOMs.length === 0 ? (
          <div className="text-sm text-muted-foreground p-12 text-center border rounded-xl">
            <GitBranch size={32} className="mx-auto mb-3 opacity-20" />
            {t('bomView.noBoms')}
          </div>
        ) : filteredBOMs.map(bom => (
          <BOMCard
            key={bom.id}
            bom={bom}
            isExpanded={expandedId === bom.id}
            onToggle={() => setExpandedId(expandedId === bom.id ? null : bom.id)}
            onApprove={() => approveMutation.mutate(bom.id)}
            onAddItem={() => setAddItemBOM(bom)}
            onDeleteItem={(itemId) => deleteItemMutation.mutate({ bomId: bom.id, itemId })}
            onEdit={() => handleOpenEdit(bom)}
            onDelete={() => setDeleteBOMTarget(bom)}
            onGenerateProcess={() => genProcessMutation.mutate(bom.id)}
            onRederive={() => deriveMutation.mutate({ skuId: bom.skuId, processId: bom.processId ?? undefined })}
            generatePending={genProcessMutation.isPending}
            rederivePending={deriveMutation.isPending}
            bomCost={calcBOMCost(bom)}
            lotsByMaterial={lotsByMaterial}
          />
        ))}
      </div>

      <TablePagination page={page} total={total} limit={20} onPageChange={setPage} />

      {/* Create BOM — inline form */}
      <InlineFormPanel
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        icon={Layers}
        title={t('bomView.createTitle')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>{t('bomView.cancel')}</Button>
            <Button size="sm" onClick={handleCreate} disabled={createMutation.isPending || !newBOM.skuId}>
              {createMutation.isPending ? t('bomView.creating') : t('bomView.createBom')}
            </Button>
          </>
        )}
      >
                <div className="grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('bomView.product')} *</Label>
                    <EntityPicker
                      items={skus}
                      value={newBOM.skuId}
                      onChange={id => setNewBOM(p => ({ ...p, skuId: id ?? '' }))}
                      getId={(s: any) => s.id}
                      getPrimary={(s: any) => s.name}
                      getSecondary={(s: any) => s.itemNumber}
                      placeholder={t('bomView.selectProduct')}
                      searchPlaceholder={t('bomView.searchProduct')}
                      size="sm"
                      clearable={false}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('bomView.version')}</Label>
                    <Input
                      value={newBOM.version}
                      onChange={e => setNewBOM(p => ({ ...p, version: e.target.value }))}
                      placeholder={t('bomView.versionPlaceholder')}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>

                {/* Smart linking: derive the BOM from the product's manufacturing process */}
                {newBOM.skuId && resolvedProcess?.found && resolvedProcess.process && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/25">
                    <Sparkles size={15} className="mt-0.5 text-emerald-400 shrink-0" />
                    <div className="flex-1 text-xs">
                      <div className="text-foreground font-medium flex items-center flex-wrap gap-x-1">
                        <span>{t('bomView.foundProcess', { name: resolvedProcess.process.name, version: resolvedProcess.process.version })}</span>
                        <Badge variant="outline" className="text-[9px] h-4">{resolvedProcess.process.scopeType.replace('_', ' ')}</Badge>
                      </div>
                      <p className="text-muted-foreground mt-0.5">
                        {t('bomView.processSummary', { steps: resolvedProcess.process.steps.length, materials: resolvedProcess.process.totalMaterials })}
                      </p>
                      {resolvedProcess.process.totalMaterials === 0 && (
                        <p className="text-amber-400 mt-1">{t('bomView.processNoMaterials')}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="h-7 text-xs shrink-0 bg-emerald-600 hover:bg-emerald-500"
                      disabled={deriveMutation.isPending || resolvedProcess.process.totalMaterials === 0}
                      onClick={() => deriveMutation.mutate({ skuId: newBOM.skuId, processId: resolvedProcess.process!.id })}
                    >
                      <Workflow size={12} className="mr-1" />
                      {deriveMutation.isPending ? t('bomView.deriving') : t('bomView.deriveFromProcess')}
                    </Button>
                  </div>
                )}
                {newBOM.skuId && resolvedProcess && !resolvedProcess.found && (
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-sky-500/5 border border-sky-500/25 text-xs text-muted-foreground">
                    <Info size={14} className="mt-0.5 text-sky-400 shrink-0" />
                    <span>
                      {t('bomView.noProcessYet')}
                    </span>
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>{t('bomView.rawMaterialComponents')} *</Label>
                    <Button size="sm" variant="outline" onClick={addNewItemRow} className="h-7 text-xs">
                      <Plus size={12} className="mr-1" />
                      {t('bomView.addRow')}
                    </Button>
                  </div>
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left p-2 font-medium">{t('bomView.col.material')}</th>
                          <th className="text-left p-2 font-medium w-24">{t('bomView.col.qtyUnit')}</th>
                          <th className="text-left p-2 font-medium w-20">{t('bomView.col.unit')}</th>
                          <th className="text-left p-2 font-medium w-20">{t('bomView.col.scrapPct')}</th>
                          <th className="w-8 p-2" />
                        </tr>
                      </thead>
                      <tbody>
                        {newItems.map((item, i) => (
                          <tr key={i} className="border-t">
                            <td className="p-1.5">
                              <EntityPicker
                                items={rawMaterials}
                                value={item.rawMaterialId}
                                onChange={(id, rm) => {
                                  // Auto-fetch: the unit always comes from the material master (unified UoM)
                                  setNewItems(prev => prev.map((it, idx) => idx === i ? { ...it, rawMaterialId: id ?? '', unit: rm?.unit ?? it.unit } : it));
                                }}
                                getId={m => m.id}
                                getPrimary={m => m.name}
                                getSecondary={m => m.code}
                                placeholder={t('bomView.selectMaterial')}
                                searchPlaceholder={t('bomView.searchMaterial')}
                                size="sm"
                                className="h-7"
                                clearable={false}
                              />
                            </td>
                            <td className="p-1.5">
                              <Input
                                type="number" min="0" step="0.001"
                                value={item.quantityPer}
                                onChange={e => setNewItems(prev => prev.map((it, idx) => idx === i ? { ...it, quantityPer: e.target.value } : it))}
                                className="h-7 text-xs" placeholder="0.000"
                              />
                            </td>
                            <td className="p-1.5">
                              {item.rawMaterialId ? (
                                <div
                                  className="h-7 flex items-center px-2 rounded-md border border-input bg-muted/40 text-xs text-muted-foreground"
                                  title={t('bomView.unitFromMasterTip')}
                                >
                                  {item.unit}
                                </div>
                              ) : (
                                <Select
                                  value={item.unit}
                                  onValueChange={v => setNewItems(prev => prev.map((it, idx) => idx === i ? { ...it, unit: v } : it))}
                                >
                                  <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              )}
                            </td>
                            <td className="p-1.5">
                              <Input
                                type="number" min="0" max="1" step="0.01"
                                value={item.scrapFactor}
                                onChange={e => setNewItems(prev => prev.map((it, idx) => idx === i ? { ...it, scrapFactor: e.target.value } : it))}
                                className="h-7 text-xs" placeholder="0.05"
                              />
                            </td>
                            <td className="p-1.5">
                              {newItems.length > 1 && (
                                <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={() => removeItemRow(i)}>
                                  <Trash2 size={11} />
                                </Button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t('bomView.notesOptional')}</Label>
                  <Input
                    value={newBOM.notes}
                    onChange={e => setNewBOM(p => ({ ...p, notes: e.target.value }))}
                    placeholder={t('bomView.notesPlaceholder')}
                    className="h-8 text-sm"
                  />
                </div>
      </InlineFormPanel>

      {/* Edit BOM — inline form */}
      {editBOM && (
        <InlineFormPanel
          open={!!editBOM}
          onClose={() => setEditBOM(null)}
          icon={Edit2}
          title={t('bomView.editTitle')}
          description={editBOM.sku.name}
          footer={(
            <>
              <Button variant="outline" size="sm" onClick={() => setEditBOM(null)}>{t('bomView.cancel')}</Button>
              <Button
                size="sm"
                disabled={updateMutation.isPending || !editForm.version}
                onClick={() => updateMutation.mutate({ id: editBOM.id, dto: { version: editForm.version, notes: editForm.notes || undefined } })}
              >
                {updateMutation.isPending ? t('bomView.saving') : t('bomView.saveChanges')}
              </Button>
            </>
          )}
        >
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>{t('bomView.version')}</Label>
                  <Input
                    value={editForm.version}
                    onChange={e => setEditForm(p => ({ ...p, version: e.target.value }))}
                    placeholder={t('bomView.versionPlaceholder')}
                    className="h-8 text-sm"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('bomView.notes')}</Label>
                  <Input
                    value={editForm.notes}
                    onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
                    placeholder={t('bomView.notesPlaceholder')}
                    className="h-8 text-sm"
                  />
                </div>
                {editBOM.approvedAt && (
                  <p className="text-xs text-amber-500 flex items-center gap-1.5">
                    <AlertTriangle size={12} />
                    {t('bomView.approvedNote')}
                  </p>
                )}
              </div>
        </InlineFormPanel>
      )}

      {/* Delete BOM Confirmation */}
      <AnimatePresence>
        {deleteBOMTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border rounded-xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                  <AlertTriangle size={18} className="text-destructive" />
                </div>
                <div>
                  <h2 className="font-semibold text-sm">{t('bomView.deleteTitle')}</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('bomView.deleteDesc', { name: deleteBOMTarget.sku.name, version: deleteBOMTarget.version, count: deleteBOMTarget.items.length })}
                  </p>
                  {deleteBOMTarget.approvedAt && (
                    <p className="text-xs text-destructive mt-2 font-medium">{t('bomView.approvedCantDelete')}</p>
                  )}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDeleteBOMTarget(null)}>{t('bomView.cancel')}</Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={deleteBOMMutation.isPending || !!deleteBOMTarget.approvedAt}
                  onClick={() => deleteBOMMutation.mutate(deleteBOMTarget.id)}
                >
                  {deleteBOMMutation.isPending ? t('bomView.deleting') : t('bomView.deleteBom')}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Material — inline form */}
      {addItemBOM && (
        <InlineFormPanel
          open={!!addItemBOM}
          onClose={() => setAddItemBOM(null)}
          icon={Plus}
          title={t('bomView.addMaterialTitle')}
          footer={(
            <>
              <Button variant="outline" size="sm" onClick={() => setAddItemBOM(null)}>{t('bomView.cancel')}</Button>
              <Button size="sm"
                disabled={addItemMutation.isPending || !addItem.rawMaterialId || !addItem.quantityPer}
                onClick={() => addItemMutation.mutate({
                  bomId: addItemBOM.id,
                  dto: {
                    rawMaterialId: addItem.rawMaterialId,
                    quantityPer: parseFloat(addItem.quantityPer),
                    unit: addItem.unit,
                    scrapFactor: parseFloat(addItem.scrapFactor) || 0,
                  },
                })}
              >
                {addItemMutation.isPending ? t('bomView.adding') : t('bomView.addMaterial')}
              </Button>
            </>
          )}
        >
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label>{t('bomView.rawMaterial')} *</Label>
                  <EntityPicker
                    items={rawMaterials.filter(m => !addItemBOM?.items.some(i => i.rawMaterialId === m.id))}
                    value={addItem.rawMaterialId}
                    onChange={(id, rm) => setAddItem(p => ({ ...p, rawMaterialId: id ?? '', unit: rm?.unit ?? p.unit }))}
                    getId={m => m.id}
                    getPrimary={m => m.name}
                    getSecondary={m => m.code}
                    getMeta={m => {
                      const lots = lotsByMaterial[m.id];
                      return lots ? <span className="text-green-400">{t('bomView.lotsMeta', { count: lots.activeLots, remaining: lots.totalRemaining.toFixed(0), unit: lots.unit })}</span> : null;
                    }}
                    placeholder={t('bomView.selectMaterial')}
                    searchPlaceholder={t('bomView.searchMaterial')}
                    size="sm"
                    clearable={false}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('bomView.quantityPerUnit')} *</Label>
                    <Input type="number" min="0" step="0.001" value={addItem.quantityPer}
                      onChange={e => setAddItem(p => ({ ...p, quantityPer: e.target.value }))}
                      className="h-8 text-sm" placeholder="0.000" />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('bomView.unit')} {addItem.rawMaterialId && <span className="text-[10px] text-muted-foreground">{t('bomView.fromMaterialMaster')}</span>}</Label>
                    {addItem.rawMaterialId ? (
                      <div className="h-8 flex items-center px-3 rounded-md border border-input bg-muted/40 text-sm text-muted-foreground">
                        {addItem.unit}
                      </div>
                    ) : (
                      <Select value={addItem.unit} onValueChange={v => setAddItem(p => ({ ...p, unit: v }))}>
                        <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('bomView.scrapFactor')}</Label>
                  <Input type="number" min="0" max="1" step="0.01" value={addItem.scrapFactor}
                    onChange={e => setAddItem(p => ({ ...p, scrapFactor: e.target.value }))}
                    className="h-8 text-sm" placeholder="0.00" />
                </div>
              </div>
        </InlineFormPanel>
      )}
    </div>
  );
}

function BOMCard({
  bom, isExpanded, onToggle, onApprove, onAddItem, onDeleteItem, onEdit, onDelete,
  onGenerateProcess, onRederive, generatePending, rederivePending, bomCost, lotsByMaterial,
}: {
  bom: BOM;
  isExpanded: boolean;
  onToggle: () => void;
  onApprove: () => void;
  onAddItem: () => void;
  onDeleteItem: (itemId: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onGenerateProcess: () => void;
  onRederive: () => void;
  generatePending: boolean;
  rederivePending: boolean;
  bomCost: number;
  lotsByMaterial: Record<string, MaterialLotSummary>;
}) {
  const { t } = useTranslation(['inventory', 'common']);
  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        <div className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center shrink-0">
          <GitBranch size={12} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate">{bom.sku.name}</span>
            <span className="text-xs text-muted-foreground font-mono">{bom.sku.itemNumber}</span>
            <Badge variant="outline" className="text-[10px] h-4">v{bom.version}</Badge>
            {bom.isActive && bom.approvedAt && (
              <Badge className="text-[10px] h-4 bg-success-500/10 text-success-400 border-success-500/20">
                <CheckCircle2 size={8} className="mr-1" />
                {t('bomView.approved')}
              </Badge>
            )}
            {bom.isActive && !bom.approvedAt && (
              <Badge variant="outline" className="text-[10px] h-4 text-amber-500 border-amber-500/30">{t('bomView.draft')}</Badge>
            )}
            {bom.process && (
              <Badge variant="outline" className="text-[10px] h-4 text-indigo-400 border-indigo-500/30">
                <Workflow size={8} className="mr-1" />
                {bom.sourceType === 'DERIVED_FROM_PROCESS' ? t('bomView.derivedFrom') : t('bomView.linkedTo')} {bom.process.name} v{bom.process.version}
              </Badge>
            )}
            {bom.isStale && (
              <Badge className="text-[10px] h-4 bg-amber-500/10 text-amber-400 border-amber-500/30">
                <AlertTriangle size={8} className="mr-1" />
                {t('bomView.stale')}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {t('bomView.componentsCount', { count: bom.items.length })} · {bomCost > 0 ? t('bomView.estCost', { cost: t('bomView.perUnit', { cost: bomCost.toFixed(3) }) }) : t('bomView.estCostNa')}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {bom.isStale && bom.processId && (
            <Button size="sm" variant="outline" className="h-7 text-xs text-amber-400 border-amber-500/40"
              disabled={rederivePending}
              title={t('bomView.reDeriveTip')}
              onClick={e => { e.stopPropagation(); onRederive(); }}>
              <RefreshCcw size={12} className="mr-1" />{rederivePending ? t('bomView.reDeriving') : t('bomView.reDerive')}
            </Button>
          )}
          {!bom.processId && (
            <Button size="sm" variant="outline" className="h-7 text-xs text-indigo-400 border-indigo-500/40"
              disabled={generatePending}
              title={t('bomView.generateProcessTip')}
              onClick={e => { e.stopPropagation(); onGenerateProcess(); }}>
              <Workflow size={12} className="mr-1" />{generatePending ? t('bomView.generating') : t('bomView.generateProcess')}
            </Button>
          )}
          {!bom.approvedAt && (
            <Button size="sm" variant="outline" className="h-7 text-xs"
              onClick={e => { e.stopPropagation(); onApprove(); }}>
              <FileCheck2 size={12} className="mr-1" />{t('bomView.approve')}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 text-xs"
            onClick={e => { e.stopPropagation(); onAddItem(); }}>
            <Plus size={12} className="mr-1" />{t('bomView.addItem')}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
            onClick={e => { e.stopPropagation(); onEdit(); }}>
            <Edit2 size={13} className="text-muted-foreground" />
          </Button>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
            onClick={e => { e.stopPropagation(); onDelete(); }}>
            <Trash2 size={13} className="text-destructive/70 hover:text-destructive" />
          </Button>
          {isExpanded
            ? <ChevronDown size={14} className="text-muted-foreground ml-1" />
            : <ChevronRight size={14} className="text-muted-foreground ml-1" />}
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t">
              {bom.items.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">
                  {t('bomView.noMaterialsDefined')}
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left p-2.5 font-medium text-muted-foreground">{t('bomView.col.material')}</th>
                      <th className="text-left p-2.5 font-medium text-muted-foreground">{t('bomView.col.code')}</th>
                      <th className="text-left p-2.5 font-medium text-muted-foreground">{t('bomView.col.step')}</th>
                      <th className="text-right p-2.5 font-medium text-muted-foreground">{t('bomView.col.qtyUnit')}</th>
                      <th className="text-right p-2.5 font-medium text-muted-foreground">{t('bomView.col.scrap')}</th>
                      <th className="text-right p-2.5 font-medium text-muted-foreground">{t('bomView.col.totalQty')}</th>
                      <th className="text-right p-2.5 font-medium text-muted-foreground">{t('bomView.col.unitCost')}</th>
                      <th className="text-right p-2.5 font-medium text-muted-foreground">{t('bomView.col.lineCost')}</th>
                      <th className="text-center p-2.5 font-medium text-muted-foreground">{t('bomView.col.lots')}</th>
                      <th className="w-8 p-2.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {bom.items.map(item => {
                      const totalQty = item.quantityPer * (1 + item.scrapFactor);
                      const lineCost = totalQty * (item.rawMaterial.unitCost ?? 0);
                      const lots = lotsByMaterial[item.rawMaterialId];
                      const hasEnough = lots && lots.totalRemaining >= totalQty;
                      return (
                        <tr key={item.id} className="border-t hover:bg-muted/20">
                          <td className="p-2.5 font-medium">{item.rawMaterial.name}</td>
                          <td className="p-2.5 font-mono text-muted-foreground">{item.rawMaterial.code}</td>
                          <td className="p-2.5">
                            {item.routingStepRef ? (
                              <Badge variant="outline" className="text-[9px] h-4 text-indigo-300 border-indigo-500/30">
                                {item.routingStepRef.stepNumber}. {item.routingStepRef.operationName}
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground/40 text-[10px]">—</span>
                            )}
                          </td>
                          <td className="p-2.5 text-right tabular-nums">
                            {item.quantityPer.toFixed(3)} {item.unit}
                          </td>
                          <td className="p-2.5 text-right tabular-nums text-muted-foreground">
                            {item.scrapFactor > 0 ? `+${(item.scrapFactor * 100).toFixed(0)}%` : '—'}
                          </td>
                          <td className="p-2.5 text-right tabular-nums font-medium">
                            {totalQty.toFixed(3)} {item.unit}
                          </td>
                          <td className="p-2.5 text-right tabular-nums text-muted-foreground">
                            {item.rawMaterial.unitCost ? `SAR ${item.rawMaterial.unitCost.toFixed(3)}` : '—'}
                          </td>
                          <td className="p-2.5 text-right tabular-nums">
                            {lineCost > 0 ? `SAR ${lineCost.toFixed(3)}` : '—'}
                          </td>
                          <td className="p-2.5 text-center">
                            {lots ? (
                              <span className={cn(
                                'inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full',
                                hasEnough
                                  ? 'bg-green-500/10 text-green-400'
                                  : 'bg-amber-500/10 text-amber-400',
                              )}>
                                <Package size={9} />
                                {t('bomView.lotsBadge', { count: lots.activeLots, remaining: lots.totalRemaining.toFixed(0), unit: lots.unit })}
                              </span>
                            ) : (
                              <span className="text-[10px] text-muted-foreground/50">{t('bomView.noLotsBadge')}</span>
                            )}
                          </td>
                          <td className="p-2.5">
                            <Button
                              variant="ghost" size="icon"
                              className="h-6 w-6 text-destructive opacity-50 hover:opacity-100"
                              onClick={() => onDeleteItem(item.id)}
                            >
                              <Trash2 size={11} />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {bomCost > 0 && (
                    <tfoot className="bg-muted/30 border-t">
                      <tr>
                        <td colSpan={7} className="p-2.5 text-right text-xs font-medium text-muted-foreground">
                          {t('bomView.totalCostPerUnit')}
                        </td>
                        <td className="p-2.5 text-right font-bold text-sm">
                          SAR {bomCost.toFixed(3)}
                        </td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface MaterialLotSummary {
  rawMaterialId: string;
  activeLots: number;
  totalRemaining: number;
  unit: string;
}
