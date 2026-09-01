'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Search, Factory, Cpu, Activity, Layers, Shield, Calendar, Link2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { TableRowActions } from '@/components/ui/table-row-actions';
import { Checkbox } from '@/components/ui/checkbox';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';
import { TablePagination } from '@/components/ui/table-pagination';

interface Area { id: string; name: string; code: string }
interface Line { id: string; name: string; code: string; areaId: string }

interface Asset {
  id: string;
  code: string;
  name: string;
  machineType: string;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  criticality: string;
  installDate: string | null;
  warrantyExpiry: string | null;
  area: Area | null;
  line: Line | null;
  status: string;
  isActive: boolean;
}

const STATUS_CONFIG: Record<string, { labelKey: string; cls: string }> = {
  RUNNING:     { labelKey: 'assetStatus.RUNNING',     cls: 'text-green-400 border-green-400/30 bg-green-400/10' },
  IDLE:        { labelKey: 'assetStatus.IDLE',        cls: 'text-yellow-400 border-yellow-400/30 bg-yellow-400/10' },
  MAINTENANCE: { labelKey: 'assetStatus.MAINTENANCE', cls: 'text-orange-400 border-orange-400/30 bg-orange-400/10' },
  BREAKDOWN:   { labelKey: 'assetStatus.BREAKDOWN',   cls: 'text-red-400 border-red-400/30 bg-red-400/10' },
  OFFLINE:     { labelKey: 'assetStatus.OFFLINE',     cls: 'text-gray-400 border-gray-400/30 bg-gray-400/10' },
};

const CRITICALITY_CONFIG: Record<string, { labelKey: string; cls: string }> = {
  LOW:      { labelKey: 'common:priority.LOW',      cls: 'text-muted-foreground' },
  MEDIUM:   { labelKey: 'common:priority.MEDIUM',   cls: 'text-brand-400' },
  HIGH:     { labelKey: 'common:priority.HIGH',     cls: 'text-amber-400' },
  CRITICAL: { labelKey: 'common:priority.CRITICAL', cls: 'text-red-400 font-semibold' },
};

const MACHINE_TYPES = [
  'MACHINE', 'CONVEYOR', 'ROBOT', 'PALLETIZER', 'CHECKWEIGHER',
  'FILLING_MACHINE', 'CARTONING_MACHINE', 'COMPRESSOR', 'BOILER',
  'PUMP', 'MIXER', 'CHILLER', 'TRANSFORMER',
];

const EMPTY_FORM = {
  code: '', name: '', machineType: 'MACHINE', manufacturer: '', model: '',
  serialNumber: '', areaId: '', lineId: '', criticality: 'MEDIUM',
  installDate: '', warrantyExpiry: '',
};

export function MaintenanceAssetsView() {
  const { t } = useTranslation(['maintenance', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();
  const { archive: archiveAsset, restore: restoreAsset, bulkArchive, bulkRestore } = useArchive('machines', [['maintenance', 'assets'], ['hierarchy']], 'Asset');
  const [search, setSearch] = useState('');
  const [archived, setArchived] = useState<ArchiveScope>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; name: string } | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', 'assets', search, archived],
    queryFn: () => api.get('/maintenance/assets', { params: { search: search || undefined, archived: archived !== 'active' ? archived : undefined, limit: 100 } }),
    staleTime: 30_000,
  });

  const { data: areasData } = useQuery({
    queryKey: ['hierarchy', 'areas'],
    queryFn: () => api.get('/hierarchy/areas'),
    staleTime: 120_000,
    enabled: formOpen,
  });

  const { data: linesData } = useQuery({
    queryKey: ['hierarchy', 'lines', form.areaId],
    queryFn: () => api.get('/hierarchy/lines', { params: { areaId: form.areaId || undefined } }),
    staleTime: 120_000,
    enabled: formOpen,
  });

  const areas: Area[] = (areasData as any) ?? [];
  const lines: Line[] = ((linesData as any) ?? []).filter((l: any) =>
    !form.areaId || l.areaId === form.areaId
  );
  const assets: Asset[] = (data as any)?.data ?? [];
  const sel = useRowSelection(assets);

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/maintenance/assets', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'assets'] });
      qc.invalidateQueries({ queryKey: ['hierarchy'] });
      toast({ title: t('toast.assetCreated'), variant: 'success' });
      handleClose();
    },
    onError: (e: any) => toast({ title: t('toast.assetCreateFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/maintenance/assets/${id}`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'assets'] });
      qc.invalidateQueries({ queryKey: ['hierarchy'] });
      toast({ title: t('toast.assetUpdated'), variant: 'success' });
      handleClose();
    },
    onError: (e: any) => toast({ title: t('toast.assetUpdateFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/maintenance/assets/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', 'assets'] });
      qc.invalidateQueries({ queryKey: ['hierarchy'] });
      toast({ title: t('toast.assetDeactivated') });
      setDeleteDialog(null);
    },
    onError: (e: any) => toast({ title: t('toast.assetDeleteFailed'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const handleOpenCreate = () => {
    setEditAsset(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const handleOpenEdit = (asset: Asset) => {
    setEditAsset(asset);
    setForm({
      code: asset.code,
      name: asset.name,
      machineType: asset.machineType,
      manufacturer: asset.manufacturer ?? '',
      model: asset.model ?? '',
      serialNumber: asset.serialNumber ?? '',
      areaId: asset.area?.id ?? '',
      lineId: asset.line?.id ?? '',
      criticality: asset.criticality,
      installDate: asset.installDate?.slice(0, 10) ?? '',
      warrantyExpiry: asset.warrantyExpiry?.slice(0, 10) ?? '',
    });
    setFormOpen(true);
  };

  const handleClose = () => { setFormOpen(false); setEditAsset(null); };

  const handleSubmit = () => {
    const dto = {
      ...form,
      areaId: form.areaId || undefined,
      lineId: form.lineId || undefined,
      installDate: form.installDate || undefined,
      warrantyExpiry: form.warrantyExpiry || undefined,
    };
    if (editAsset) updateMutation.mutate({ id: editAsset.id, dto });
    else createMutation.mutate(dto);
  };

  const isValid = !!(form.code && form.name && form.machineType);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.assets.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.assets.subtitle', { count: assets.length })}
          </p>
        </div>
        <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={handleOpenCreate}>
          <Plus size={13} />{t('assetsView.newAsset')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-4">
        <InlineFormSlot />

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('assetsList.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="h-8 pl-7 w-56 text-xs"
            />
          </div>
          <ArchiveFilter value={archived} onChange={setArchived} />
        </div>

        <div className="industrial-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/30">
                <th className="px-4 py-3 w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('selectAll')} /></th>
                {[t('assetsView.col.code'), t('assetsView.col.name'), t('assetsView.col.type'), t('assetsView.col.location'), t('assetsView.col.criticality'), t('assetsView.col.manufacturerModel'), t('assetsView.col.status'), t('assetsView.col.installDate'), ''].map((h, i) => (
                  <th key={i} className="text-left px-4 py-3 text-[11px] text-muted-foreground font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/20">
                    {Array.from({ length: 10 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><div className="shimmer h-3.5 rounded w-20" /></td>
                    ))}
                  </tr>
                ))
              ) : assets.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-14 text-muted-foreground">
                    <Factory className="w-10 h-10 mx-auto mb-3 opacity-20" />
                    <p className="text-sm">{t('assetsList.noAssets')}</p>
                    <p className="text-xs mt-1">{t('assetsView.createFirst')}</p>
                  </td>
                </tr>
              ) : (
                assets.map((asset, i) => {
                  const statusCfg = STATUS_CONFIG[asset.status] ?? STATUS_CONFIG.OFFLINE;
                  const critCfg = CRITICALITY_CONFIG[asset.criticality] ?? CRITICALITY_CONFIG.MEDIUM;
                  const hasHierarchy = !!(asset.area || asset.line);
                  return (
                    <motion.tr
                      key={asset.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.02 }}
                      className={cn('border-b border-border/20 hover:bg-muted/20', sel.isSelected(asset.id) && 'bg-primary/5')}
                    >
                      <td className="px-4 py-3"><Checkbox checked={sel.isSelected(asset.id)} onCheckedChange={() => sel.toggle(asset.id)} aria-label={t('selectRow')} /></td>
                      <td className="px-4 py-3 font-mono text-xs font-semibold text-primary">{asset.code}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Cpu size={12} className="text-brand-400 shrink-0" />
                          <span className="text-xs font-medium">{asset.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {asset.machineType?.replace(/_/g, ' ')}
                      </td>
                      <td className="px-4 py-3">
                        {hasHierarchy ? (
                          <div className="flex items-center gap-1 text-xs">
                            <Link2 size={10} className="text-brand-400 shrink-0" />
                            <div>
                              {asset.area && (
                                <div className="flex items-center gap-1">
                                  <Layers size={9} className="text-purple-400" />
                                  <span className="text-muted-foreground">{asset.area.name}</span>
                                </div>
                              )}
                              {asset.line && (
                                <div className="flex items-center gap-1 mt-0.5">
                                  <Activity size={9} className="text-brand-400" />
                                  <span className="font-medium">{asset.line.name}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground/50">
                            <Unlink size={10} />
                            <span>{t('assetsView.notLinked')}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-xs font-medium', critCfg.cls)}>{t(`common:priority.${asset.criticality}`, { defaultValue: t(critCfg.labelKey) })}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-xs font-medium">{asset.manufacturer ?? '—'}</div>
                        {asset.model && <div className="text-[10px] text-muted-foreground">{asset.model}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn('text-[10px] px-2 py-0.5 rounded-full border font-medium', statusCfg.cls)}>
                          {t(`assetStatus.${asset.status}`, { defaultValue: t(statusCfg.labelKey) })}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {asset.installDate?.slice(0, 10) ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <TableRowActions
                          onEdit={() => handleOpenEdit(asset)}
                          onDelete={() => setDeleteDialog({ id: asset.id, name: asset.name })}
                          extraActions={[
                            (asset as any).archivedAt
                              ? { label: t('aform.restore'), icon: RotateCcw, onClick: () => restoreAsset.mutate(asset.id), separator: true }
                              : { label: t('aform.archive'), icon: ArchiveIcon, onClick: () => archiveAsset.mutate(asset.id), separator: true },
                          ]}
                        />
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create / Edit — inline form */}
      <InlineFormPanel
        open={formOpen}
        onClose={handleClose}
        icon={Cpu}
        title={editAsset ? t('aform.editTitle', { code: editAsset.code }) : t('aform.createTitle')}
        description={t('aform.desc')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={handleClose}>{t('aform.cancel')}</Button>
            <Button
              size="sm"
              disabled={!isValid || createMutation.isPending || updateMutation.isPending}
              onClick={handleSubmit}
            >
              {createMutation.isPending || updateMutation.isPending
                ? (editAsset ? t('aform.saving') : t('aform.creating'))
                : (editAsset ? t('aform.saveChanges') : t('aform.registerAsset'))
              }
            </Button>
          </>
        )}
      >
          <div className="space-y-5">
            {/* Identity */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('aform.identity')}</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('aform.assetCode')} <span className="text-destructive">*</span></Label>
                  <Input
                    value={form.code}
                    onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
                    placeholder={t('aform.assetCodePlaceholder')}
                    className="h-9"
                    disabled={!!editAsset}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('aform.machineType')} <span className="text-destructive">*</span></Label>
                  <Select value={form.machineType} onValueChange={v => setForm(f => ({ ...f, machineType: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MACHINE_TYPES.map(mt => (
                        <SelectItem key={mt} value={mt}>{mt.replace(/_/g, ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label className="text-xs">{t('aform.assetName')} <span className="text-destructive">*</span></Label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder={t('aform.assetNamePlaceholder')}
                    className="h-9"
                  />
                </div>
              </div>
            </div>

            {/* Hierarchy Location */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Link2 size={10} className="text-brand-400" />
                {t('aform.hierarchyLocation')}
                <span className="font-normal text-muted-foreground/60 normal-case tracking-normal">{t('aform.optional')}</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <Layers size={10} className="text-purple-400" />{t('aform.area')}
                  </Label>
                  <EntityPicker
                    items={areas}
                    value={form.areaId || null}
                    onChange={id => setForm(f => ({ ...f, areaId: id ?? '', lineId: '' }))}
                    getId={(a: Area) => a.id}
                    getPrimary={(a: Area) => a.name}
                    getSecondary={(a: Area) => a.code}
                    placeholder={t('aform.selectArea')}
                    searchPlaceholder={t('aform.searchCodeName')}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1">
                    <Activity size={10} className="text-brand-400" />{t('aform.productionLine')}
                  </Label>
                  <Select
                    value={form.lineId || '__none__'}
                    onValueChange={v => setForm(f => ({ ...f, lineId: v === '__none__' ? '' : v }))}
                    disabled={!form.areaId}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder={form.areaId ? t('aform.selectLine') : t('aform.selectAreaFirst')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('aform.noLineOpt')}</SelectItem>
                      {lines.map((l: Line) => (
                        <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {(form.areaId || form.lineId) && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-brand-400 bg-brand-400/5 border border-brand-400/20 rounded-md px-2.5 py-1.5">
                  <Link2 size={10} />
                  <span>
                    {t('aform.willAppearPre')}{' '}
                    {form.lineId
                      ? lines.find(l => l.id === form.lineId)?.name ?? t('aform.selectedLine')
                      : areas.find(a => a.id === form.areaId)?.name ?? t('aform.selectedArea')
                    }
                  </span>
                </div>
              )}
            </div>

            {/* Technical Details */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('aform.technicalDetails')}</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('aform.manufacturer')}</Label>
                  <Input value={form.manufacturer} onChange={e => setForm(f => ({ ...f, manufacturer: e.target.value }))} className="h-9" placeholder="e.g. Bosch" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('aform.model')}</Label>
                  <Input value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} className="h-9" placeholder="e.g. CP700" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('aform.serialNumber')}</Label>
                  <Input value={form.serialNumber} onChange={e => setForm(f => ({ ...f, serialNumber: e.target.value }))} className="h-9" />
                </div>
              </div>
            </div>

            {/* Risk & Dates */}
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{t('aform.riskDates')}</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Shield size={10} className="text-amber-400" />{t('aform.criticality')}</Label>
                  <Select value={form.criticality} onValueChange={v => setForm(f => ({ ...f, criticality: v }))}>
                    <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map(c => (
                        <SelectItem key={c} value={c}>{t(`common:priority.${c}`, { defaultValue: c.charAt(0) + c.slice(1).toLowerCase() })}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs flex items-center gap-1"><Calendar size={10} />{t('aform.installDate')}</Label>
                  <Input type="date" value={form.installDate} onChange={e => setForm(f => ({ ...f, installDate: e.target.value }))} className="h-9" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t('aform.warrantyExpiry')}</Label>
                  <Input type="date" value={form.warrantyExpiry} onChange={e => setForm(f => ({ ...f, warrantyExpiry: e.target.value }))} className="h-9" />
                </div>
              </div>
            </div>
          </div>
      </InlineFormPanel>

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('aform.deleteTitle', { name: deleteDialog?.name })}
        description={t('aform.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('aform.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('aform.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  );
}
