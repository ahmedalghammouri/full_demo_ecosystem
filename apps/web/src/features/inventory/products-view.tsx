'use client';
import { useTranslation } from 'react-i18next';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { TablePagination } from '@/components/ui/table-pagination';
import { motion } from 'framer-motion';
import { Search, BoxesIcon, ChevronDown, ChevronRight, Plus, Edit3, Trash2, MoreHorizontal, Ruler, Weight, Archive as ArchiveIcon, RotateCcw } from 'lucide-react';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { Checkbox } from '@/components/ui/checkbox';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { Label } from '@/components/ui/label';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { MasterDataSelect, type MasterItem } from '@/components/ui/master-data-select';

interface StorageLocationOption {
  id: string;
  code: string;
  name: string;
  zone: string;
}

interface BOMComponent {
  componentCode: string;
  componentName: string;
  quantity: number;
  unit: string;
  type: string;
}

interface SKU {
  id: string;
  itemNumber: string;
  code: string;
  name: string;
  nameAr: string | null;
  shortName: string | null;
  brand: string | null;
  category: string | null;
  packagingType: string | null;
  unitsPerInner: number;
  innersPerCarton: number;
  cartonsPerPallet: number;
  baseUnit: string;
  weight: number | null;
  weightUnit: string;
  length: number | null;
  width: number | null;
  height: number | null;
  dimensionUnit: string;
  storageLocationId: string | null;
  storageLocationRef: { id: string; code: string; name: string } | null;
  family: { name: string; brand: string | null } | null;
  bomComponents: BOMComponent[];
  // Master-data FK ids (preferred over the legacy text columns)
  categoryId: string | null;
  brandId: string | null;
  packagingTypeId: string | null;
  baseUnitId: string | null;
  baseWeightId: string | null;
}

const BOM_COLORS: Record<string, string> = {
  RAW: 'text-amber-400',
  PACKAGING: 'text-blue-400',
  CONSUMABLE: 'text-purple-400',
};

const WEIGHT_UNITS = ['kg', 'g', 'lb', 'oz'];
const DIM_UNITS = ['cm', 'mm', 'm', 'in'];

function formatDimensions(sku: SKU): string {
  if (!sku.length && !sku.width && !sku.height) return '—';
  const parts = [sku.length, sku.width, sku.height].map(v => v != null ? v.toString() : '?');
  return `${parts.join(' × ')} ${sku.dimensionUnit}`;
}

function SKURow({ sku, index, onDelete, onEdit, onArchive, onRestore, selected, onToggle }: { sku: SKU; index: number; onDelete: (id: string) => void; onEdit: (sku: SKU) => void; onArchive: (id: string) => void; onRestore: (id: string) => void; selected: boolean; onToggle: () => void }) {
  const { t } = useTranslation(['inventory', 'common']);
  const [expanded, setExpanded] = useState(false);
  const hasBOM = sku.bomComponents.length > 0;

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: index * 0.02 }}
        className={cn('border-b border-border/30 hover:bg-foreground/5 cursor-pointer', selected && 'bg-primary/5')}
        onClick={() => hasBOM && setExpanded(v => !v)}
      >
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={t('productsView.selectRow')} />
        </td>
        <td className="p-3 text-xs">
          {hasBOM ? (
            expanded ? <ChevronDown className="w-3.5 h-3.5 inline text-muted-foreground" />
                     : <ChevronRight className="w-3.5 h-3.5 inline text-muted-foreground" />
          ) : <span className="w-3.5 h-3.5 inline-block" />}
        </td>
        <td className="p-3 text-xs font-mono text-muted-foreground">{sku.itemNumber}</td>
        <td className="p-3 text-xs">
          <div className="font-medium">{sku.name}</div>
          <div className="text-[10px] text-muted-foreground">{sku.code}</div>
        </td>
        <td className="p-3 text-xs">
          {sku.family?.name && <Badge variant="outline" className="text-[10px]">{sku.family.name}</Badge>}
        </td>
        <td className="p-3 text-xs text-muted-foreground">{sku.brand ?? sku.family?.brand ?? '—'}</td>
        <td className="p-3 text-xs">
          {sku.category && <Badge variant="outline" className="text-[10px]">{sku.category}</Badge>}
        </td>
        <td className="p-3 text-xs text-muted-foreground">{sku.packagingType ?? '—'}</td>
        <td className="p-3 text-xs text-right text-muted-foreground">
          {sku.unitsPerInner} / {sku.innersPerCarton} / {sku.cartonsPerPallet}
        </td>
        <td className="p-3 text-xs text-muted-foreground tabular-nums">
          {sku.weight != null ? (
            <span className="flex items-center gap-1">
              <Weight size={10} className="text-muted-foreground/60" />
              {sku.weight} {sku.weightUnit}
            </span>
          ) : '—'}
        </td>
        <td className="p-3 text-xs text-muted-foreground tabular-nums">
          {formatDimensions(sku) !== '—' ? (
            <span className="flex items-center gap-1">
              <Ruler size={10} className="text-muted-foreground/60" />
              {formatDimensions(sku)}
            </span>
          ) : '—'}
        </td>
        <td className="p-3 text-xs text-center">
          {hasBOM ? (
            <Badge variant="secondary" className="text-[10px]">{t('productsView.items', { count: sku.bomComponents.length })}</Badge>
          ) : (
            <span className="text-muted-foreground text-[10px]">—</span>
          )}
        </td>
        <td className="p-3 text-xs text-muted-foreground">
          {sku.storageLocationRef
            ? <span className="font-mono text-[10px]">{sku.storageLocationRef.code}</span>
            : <span>—</span>
          }
        </td>
        <td className="p-3 text-center">
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal className="w-3.5 h-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem className="gap-2 text-xs" onClick={(e) => { e.stopPropagation(); onEdit(sku); }}>
                <Edit3 className="w-3 h-3" /> {t('productsView.edit')}
              </DropdownMenuItem>
              {(sku as any).archivedAt ? (
                <DropdownMenuItem className="gap-2 text-xs" onClick={(e) => { e.stopPropagation(); onRestore(sku.id); }}>
                  <RotateCcw className="w-3 h-3" /> {t('productsView.restore')}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem className="gap-2 text-xs" onClick={(e) => { e.stopPropagation(); onArchive(sku.id); }}>
                  <ArchiveIcon className="w-3 h-3" /> {t('productsView.archive')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className="gap-2 text-xs text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(sku.id); }}>
                <Trash2 className="w-3 h-3" /> {t('productsView.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </td>
      </motion.tr>
      {expanded && hasBOM && (
        <tr className="bg-foreground/2 border-b border-border/20">
          <td colSpan={14} className="px-6 py-3">
            <div className="text-xs font-semibold text-muted-foreground mb-2">{t('productsView.bomTitle')}</div>
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="text-start py-1 text-muted-foreground font-medium">{t('products.bomCol.code')}</th>
                  <th className="text-start py-1 text-muted-foreground font-medium">{t('products.bomCol.component')}</th>
                  <th className="text-end py-1 text-muted-foreground font-medium">{t('products.bomCol.qty')}</th>
                  <th className="text-start py-1 text-muted-foreground font-medium">{t('products.bomCol.unit')}</th>
                  <th className="text-start py-1 text-muted-foreground font-medium">{t('products.bomCol.type')}</th>
                </tr>
              </thead>
              <tbody>
                {sku.bomComponents.map((c, i) => (
                  <tr key={i} className="border-t border-border/20">
                    <td className="py-1 font-mono text-muted-foreground">{c.componentCode}</td>
                    <td className="py-1">{c.componentName}</td>
                    <td className="py-1 text-right">{c.quantity}</td>
                    <td className="py-1 text-muted-foreground">{c.unit}</td>
                    <td className="py-1">
                      <span className={BOM_COLORS[c.type] ?? ''}>{c.type}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

const EMPTY_CREATE = {
  code: '', name: '', nameAr: '', shortName: '', itemNumber: '',
  categoryId: '', brandId: '', packagingTypeId: '', baseUnitId: '', baseWeightId: '',
  unitsPerInner: '', innersPerCarton: '', cartonsPerPallet: '',
  storageLocationId: '',
  weight: '', weightUnit: 'kg',
  length: '', width: '', height: '', dimensionUnit: 'cm',
};

export function ProductsView() {
  const { t } = useTranslation(['inventory', 'common']);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [archived, setArchived] = useState<ArchiveScope>('active');
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SKU | null>(null);
  const [editForm, setEditForm] = useState({
    name: '', nameAr: '', shortName: '',
    categoryId: '', brandId: '', packagingTypeId: '', baseUnitId: '', baseWeightId: '',
    unitsPerInner: '', innersPerCarton: '', cartonsPerPallet: '',
    storageLocationId: '',
    weight: '', weightUnit: 'kg',
    length: '', width: '', height: '', dimensionUnit: 'cm',
  });
  const [formData, setFormData] = useState(EMPTY_CREATE);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { archive: archiveSku, restore: restoreSku, bulkArchive, bulkRestore } = useArchive('products', [['inventory', 'products']], 'Product');

  const { data: storageLocData } = useQuery({
    queryKey: ['inventory', 'storage-locations'],
    queryFn: () => api.get<{ data: StorageLocationOption[] }>('/inventory/storage-locations'),
    staleTime: 300_000,
  });
  const storageLocations: StorageLocationOption[] = (storageLocData as any)?.data ?? (storageLocData as any) ?? [];

  const [page, setPage] = useState(1);
  const PAGE_LIMIT = 25;
  const { data, isLoading } = useQuery({
    queryKey: ['inventory', 'products', search, category, brand, archived, page],
    queryFn: () => api.get<{ data: SKU[]; total: number }>('/inventory/products', {
      params: {
        search: search || undefined,
        category: category || undefined,
        brand: brand || undefined,
        archived: archived !== 'active' ? archived : undefined,
        page,
        limit: PAGE_LIMIT,
      },
    }),
    staleTime: 60_000,
  });
  useEffect(() => { setPage(1); }, [search, category, brand]);

  const skus: SKU[] = (data as any)?.data ?? [];
  const sel = useRowSelection(skus);
  const total: number = (data as any)?.total ?? 0;

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/inventory/products', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'products'] });
      toast({ title: t('productsView.createdSuccess') });
      setFormOpen(false);
      setFormData(EMPTY_CREATE);
    },
    onError: (e: any) => toast({ title: t('rawMaterialsView.toast.error'), description: e?.response?.data?.message ?? t('productsView.createError'), variant: 'destructive' }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/inventory/products/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'products'] });
      toast({ title: t('productsView.updatedSuccess') });
      setEditTarget(null);
    },
    onError: (e: any) => toast({ title: t('rawMaterialsView.toast.error'), description: e?.response?.data?.message ?? t('productsView.updateError'), variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/products/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'products'] });
      toast({ title: t('productsView.deletedSuccess') });
    },
    onError: (e: any) => toast({ title: t('rawMaterialsView.toast.error'), description: e?.response?.data?.message ?? t('productsView.deleteError'), variant: 'destructive' }),
  });

  const handleOpenEdit = (sku: SKU) => {
    setEditTarget(sku);
    setEditForm({
      name: sku.name,
      nameAr: sku.nameAr ?? '',
      shortName: sku.shortName ?? '',
      unitsPerInner: String(sku.unitsPerInner ?? 1),
      innersPerCarton: String(sku.innersPerCarton ?? 1),
      cartonsPerPallet: String(sku.cartonsPerPallet ?? 1),
      categoryId: sku.categoryId ?? '',
      brandId: sku.brandId ?? '',
      packagingTypeId: sku.packagingTypeId ?? '',
      baseUnitId: sku.baseUnitId ?? '',
      baseWeightId: sku.baseWeightId ?? '',
      storageLocationId: sku.storageLocationId ?? '',
      weight: sku.weight != null ? String(sku.weight) : '',
      weightUnit: sku.weightUnit ?? 'kg',
      length: sku.length != null ? String(sku.length) : '',
      width: sku.width != null ? String(sku.width) : '',
      height: sku.height != null ? String(sku.height) : '',
      dimensionUnit: sku.dimensionUnit ?? 'cm',
    });
  };

  const handleCreate = () => {
    if (!formData.code || !formData.name || !formData.itemNumber) return;
    createMutation.mutate({
      code: formData.code,
      name: formData.name,
      nameAr: formData.nameAr || null,
      shortName: formData.shortName || null,
      itemNumber: formData.itemNumber,
      categoryId: formData.categoryId || null,
      brandId: formData.brandId || null,
      packagingTypeId: formData.packagingTypeId || null,
      baseUnitId: formData.baseUnitId || null,
      baseWeightId: formData.baseWeightId || null,
      unitsPerInner: formData.unitsPerInner ? parseInt(formData.unitsPerInner) : 1,
      innersPerCarton: formData.innersPerCarton ? parseInt(formData.innersPerCarton) : 1,
      cartonsPerPallet: formData.cartonsPerPallet ? parseInt(formData.cartonsPerPallet) : 1,
      storageLocationId: formData.storageLocationId || null,
      weight: formData.weight ? parseFloat(formData.weight) : null,
      weightUnit: formData.weightUnit,
      length: formData.length ? parseFloat(formData.length) : null,
      width: formData.width ? parseFloat(formData.width) : null,
      height: formData.height ? parseFloat(formData.height) : null,
      dimensionUnit: formData.dimensionUnit,
    });
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('headers.products.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1">{t('productsCount', { count: total })}</p>
        </div>
        <Button size="sm" onClick={() => setFormOpen(true)}>
          <Plus className="w-4 h-4 mr-1" />{t('productsView.addProduct')}
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder={t('products.searchSku')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="ps-8 h-9 w-64"
          />
        </div>
        <Input placeholder={t('products.category')} value={category} onChange={e => setCategory(e.target.value)} className="h-9 w-36" />
        <Input placeholder={t('products.brand')} value={brand} onChange={e => setBrand(e.target.value)} className="h-9 w-32" />
        <ArchiveFilter value={archived} onChange={(v) => { setArchived(v); setPage(1); }} className="h-9 w-36 text-xs" />
      </div>

      <InlineFormSlot />

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-background/60">
              <tr className="border-b border-border">
                <th className="p-3 w-10"><Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={t('products.selectAll')} /></th>
                <th className="w-6 p-3" />
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('products.col.item')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('products.col.nameCode')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('products.col.family')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('products.col.brand')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('products.col.category')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('products.col.packaging')}</th>
                <th className="text-end p-3 text-muted-foreground font-medium text-xs">{t('products.col.unitsBreakdown')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('products.col.weight')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('products.col.dimensions')}</th>
                <th className="text-center p-3 text-muted-foreground font-medium text-xs">{t('products.col.bom')}</th>
                <th className="text-start p-3 text-muted-foreground font-medium text-xs">{t('products.col.storage')}</th>
                <th className="text-center p-3 text-muted-foreground font-medium text-xs w-16">{t('products.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i}><td colSpan={14} className="p-3"><div className="shimmer h-5 rounded" /></td></tr>
                ))
              ) : skus.length === 0 ? (
                <tr>
                  <td colSpan={14} className="p-12 text-center text-muted-foreground">
                    <BoxesIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    {t('products.noProducts')}
                  </td>
                </tr>
              ) : (
                skus.map((sku, i) => <SKURow key={sku.id} sku={sku} index={i} onDelete={(id) => deleteMutation.mutate(id)} onEdit={handleOpenEdit} onArchive={(id) => archiveSku.mutate(id)} onRestore={(id) => restoreSku.mutate(id)} selected={sel.isSelected(sku.id)} onToggle={() => sel.toggle(sku.id)} />)
              )}
            </tbody>
          </table>
        </div>
        {total > PAGE_LIMIT && (
          <div className="border-t border-border/50 px-4 py-2">
            <TablePagination page={page} total={total} limit={PAGE_LIMIT} onPageChange={setPage} isLoading={isLoading} />
          </div>
        )}
      </div>

      {/* Create Product — inline form */}
      <InlineFormPanel
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={t('pdform.createTitle')}
        description={t('pdform.createDesc')}
        icon={Plus}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setFormOpen(false)}>{t('pdform.cancel')}</Button>
            <Button size="sm" disabled={!formData.code || !formData.name || !formData.itemNumber || createMutation.isPending} onClick={handleCreate}>
              {createMutation.isPending ? t('pdform.creating') : t('pdform.createProduct')}
            </Button>
          </>
        )}
      >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t('pdform.productCode')} *</Label>
              <Input value={formData.code} onChange={e => setFormData(v => ({ ...v, code: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.itemNumber')} *</Label>
              <Input value={formData.itemNumber} onChange={e => setFormData(v => ({ ...v, itemNumber: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t('pdform.productName')} *</Label>
              <Input value={formData.name} onChange={e => setFormData(v => ({ ...v, name: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.nameAr')}</Label>
              <Input dir="rtl" value={formData.nameAr} onChange={e => setFormData(v => ({ ...v, nameAr: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.shortName')}</Label>
              <Input value={formData.shortName} onChange={e => setFormData(v => ({ ...v, shortName: e.target.value }))} className="h-9 mt-1" />
            </div>
            <MasterDataSelect
              entity="brands" label={t('pdform.brand')}
              value={formData.brandId}
              onChange={(id) => setFormData(v => ({ ...v, brandId: id ?? '' }))}
            />
            <MasterDataSelect
              entity="categories" label={t('pdform.category')}
              value={formData.categoryId}
              onChange={(id) => setFormData(v => ({ ...v, categoryId: id ?? '' }))}
            />
            <MasterDataSelect
              entity="packaging-types" label={t('pdform.packagingType')}
              value={formData.packagingTypeId}
              onChange={(id) => setFormData(v => ({ ...v, packagingTypeId: id ?? '' }))}
            />
            <MasterDataSelect
              entity="base-units" label={t('pdform.baseUnit')}
              value={formData.baseUnitId}
              onChange={(id) => setFormData(v => ({ ...v, baseUnitId: id ?? '' }))}
            />
            <MasterDataSelect
              entity="base-weights" label={t('pdform.baseWeight')}
              value={formData.baseWeightId}
              onChange={(id, item: MasterItem | null) => setFormData(v => ({
                ...v,
                baseWeightId: id ?? '',
                // auto-fill net weight from the selected base weight
                weight: item?.value != null ? String(item.value) : v.weight,
                weightUnit: item?.unit ?? v.weightUnit,
              }))}
            />
            <div>
              <Label className="text-xs">{t('pdform.unitsPerInner')}</Label>
              <Input type="number" value={formData.unitsPerInner} onChange={e => setFormData(v => ({ ...v, unitsPerInner: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.innersPerCarton')}</Label>
              <Input type="number" value={formData.innersPerCarton} onChange={e => setFormData(v => ({ ...v, innersPerCarton: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.cartonsPerPallet')}</Label>
              <Input type="number" value={formData.cartonsPerPallet} onChange={e => setFormData(v => ({ ...v, cartonsPerPallet: e.target.value }))} className="h-9 mt-1" />
            </div>

            {/* Weight */}
            <div className="col-span-2 border-t pt-3 mt-1">
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <Weight size={12} /> {t('pdform.weightDims')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">{t('pdform.netWeight')}</Label>
                    <Input type="number" step="0.001" min="0" value={formData.weight}
                      onChange={e => setFormData(v => ({ ...v, weight: e.target.value }))}
                      className="h-9 mt-1" placeholder="0.000" />
                  </div>
                  <div className="w-20">
                    <Label className="text-xs">{t('pdform.unit')}</Label>
                    <Select value={formData.weightUnit} onValueChange={v => setFormData(p => ({ ...p, weightUnit: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WEIGHT_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-xs">{t('pdform.dimUnit')}</Label>
                    <Select value={formData.dimensionUnit} onValueChange={v => setFormData(p => ({ ...p, dimensionUnit: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DIM_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">{t('pdform.length')}</Label>
                  <Input type="number" step="0.1" min="0" value={formData.length}
                    onChange={e => setFormData(v => ({ ...v, length: e.target.value }))}
                    className="h-9 mt-1" placeholder="0.0" />
                </div>
                <div>
                  <Label className="text-xs">{t('pdform.width')}</Label>
                  <Input type="number" step="0.1" min="0" value={formData.width}
                    onChange={e => setFormData(v => ({ ...v, width: e.target.value }))}
                    className="h-9 mt-1" placeholder="0.0" />
                </div>
                <div>
                  <Label className="text-xs">{t('pdform.height')}</Label>
                  <Input type="number" step="0.1" min="0" value={formData.height}
                    onChange={e => setFormData(v => ({ ...v, height: e.target.value }))}
                    className="h-9 mt-1" placeholder="0.0" />
                </div>
              </div>
            </div>

            <div className="col-span-2">
              <Label className="text-xs">{t('pdform.storageFg')}</Label>
              <EntityPicker
                items={storageLocations}
                value={formData.storageLocationId || null}
                onChange={id => setFormData(p => ({ ...p, storageLocationId: id ?? '' }))}
                getId={loc => loc.id}
                getPrimary={loc => loc.name}
                getSecondary={loc => loc.code}
                placeholder={t('pdform.selectLocation')}
                searchPlaceholder={t('pdform.searchLocation')}
                className="mt-1"
              />
            </div>
          </div>
      </InlineFormPanel>

      {/* Edit Product — inline form */}
      <InlineFormPanel
        open={!!editTarget}
        onClose={() => setEditTarget(null)}
        title={t('pdform.editTitle')}
        description={editTarget?.name}
        icon={Edit3}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setEditTarget(null)}>{t('pdform.cancel')}</Button>
            <Button
              size="sm"
              disabled={!editForm.name || updateMutation.isPending}
              onClick={() => editTarget && updateMutation.mutate({
                id: editTarget.id,
                dto: {
                  name: editForm.name,
                  nameAr: editForm.nameAr || null,
                  shortName: editForm.shortName || null,
                  unitsPerInner: editForm.unitsPerInner ? parseInt(editForm.unitsPerInner) : 1,
                  innersPerCarton: editForm.innersPerCarton ? parseInt(editForm.innersPerCarton) : 1,
                  cartonsPerPallet: editForm.cartonsPerPallet ? parseInt(editForm.cartonsPerPallet) : 1,
                  categoryId: editForm.categoryId || null,
                  brandId: editForm.brandId || null,
                  packagingTypeId: editForm.packagingTypeId || null,
                  baseUnitId: editForm.baseUnitId || null,
                  baseWeightId: editForm.baseWeightId || null,
                  storageLocationId: editForm.storageLocationId || null,
                  weight: editForm.weight ? parseFloat(editForm.weight) : null,
                  weightUnit: editForm.weightUnit,
                  length: editForm.length ? parseFloat(editForm.length) : null,
                  width: editForm.width ? parseFloat(editForm.width) : null,
                  height: editForm.height ? parseFloat(editForm.height) : null,
                  dimensionUnit: editForm.dimensionUnit,
                },
              })}
            >
              {updateMutation.isPending ? t('pdform.saving') : t('pdform.saveChanges')}
            </Button>
          </>
        )}
      >
          <div className="grid grid-cols-2 gap-3">
            {/* Identity (immutable references) */}
            <div>
              <Label className="text-xs">{t('pdform.productCode')}</Label>
              <Input value={editTarget?.code ?? ''} disabled className="h-9 mt-1 opacity-60" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.itemNumber')}</Label>
              <Input value={editTarget?.itemNumber ?? ''} disabled className="h-9 mt-1 opacity-60" />
            </div>
            <div className="col-span-2">
              <Label className="text-xs">{t('pdform.productName')} *</Label>
              <Input value={editForm.name} onChange={e => setEditForm(v => ({ ...v, name: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.nameAr')}</Label>
              <Input dir="rtl" value={editForm.nameAr} onChange={e => setEditForm(v => ({ ...v, nameAr: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.shortName')}</Label>
              <Input value={editForm.shortName} onChange={e => setEditForm(v => ({ ...v, shortName: e.target.value }))} className="h-9 mt-1" />
            </div>
            <MasterDataSelect
              entity="brands" label={t('pdform.brand')}
              value={editForm.brandId}
              onChange={(id) => setEditForm(v => ({ ...v, brandId: id ?? '' }))}
            />
            <MasterDataSelect
              entity="categories" label={t('pdform.category')}
              value={editForm.categoryId}
              onChange={(id) => setEditForm(v => ({ ...v, categoryId: id ?? '' }))}
            />
            <MasterDataSelect
              entity="packaging-types" label={t('pdform.packagingType')}
              value={editForm.packagingTypeId}
              onChange={(id) => setEditForm(v => ({ ...v, packagingTypeId: id ?? '' }))}
            />
            <MasterDataSelect
              entity="base-units" label={t('pdform.baseUnit')}
              value={editForm.baseUnitId}
              onChange={(id) => setEditForm(v => ({ ...v, baseUnitId: id ?? '' }))}
            />
            <MasterDataSelect
              entity="base-weights" label={t('pdform.baseWeight')}
              value={editForm.baseWeightId}
              onChange={(id, item: MasterItem | null) => setEditForm(v => ({
                ...v,
                baseWeightId: id ?? '',
                weight: item?.value != null ? String(item.value) : v.weight,
                weightUnit: item?.unit ?? v.weightUnit,
              }))}
            />
            <div>
              <Label className="text-xs">{t('pdform.unitsPerInner')}</Label>
              <Input type="number" min="1" value={editForm.unitsPerInner} onChange={e => setEditForm(v => ({ ...v, unitsPerInner: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.innersPerCarton')}</Label>
              <Input type="number" min="1" value={editForm.innersPerCarton} onChange={e => setEditForm(v => ({ ...v, innersPerCarton: e.target.value }))} className="h-9 mt-1" />
            </div>
            <div>
              <Label className="text-xs">{t('pdform.cartonsPerPallet')}</Label>
              <Input type="number" min="1" value={editForm.cartonsPerPallet} onChange={e => setEditForm(v => ({ ...v, cartonsPerPallet: e.target.value }))} className="h-9 mt-1" />
            </div>

            {/* Weight & Dimensions */}
            <div className="col-span-2 border-t pt-3 mt-1">
              <p className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
                <Weight size={12} /> {t('pdform.weightDims')}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs">{t('pdform.netWeight')}</Label>
                    <Input type="number" step="0.001" min="0" value={editForm.weight}
                      onChange={e => setEditForm(v => ({ ...v, weight: e.target.value }))}
                      className="h-9 mt-1" placeholder="0.000" />
                  </div>
                  <div className="w-20">
                    <Label className="text-xs">{t('pdform.unit')}</Label>
                    <Select value={editForm.weightUnit} onValueChange={v => setEditForm(p => ({ ...p, weightUnit: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {WEIGHT_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex gap-2 items-end">
                  <div className="flex-1">
                    <Label className="text-xs">{t('pdform.dimUnit')}</Label>
                    <Select value={editForm.dimensionUnit} onValueChange={v => setEditForm(p => ({ ...p, dimensionUnit: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DIM_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">{t('pdform.length')}</Label>
                  <Input type="number" step="0.1" min="0" value={editForm.length}
                    onChange={e => setEditForm(v => ({ ...v, length: e.target.value }))}
                    className="h-9 mt-1" placeholder="0.0" />
                </div>
                <div>
                  <Label className="text-xs">{t('pdform.width')}</Label>
                  <Input type="number" step="0.1" min="0" value={editForm.width}
                    onChange={e => setEditForm(v => ({ ...v, width: e.target.value }))}
                    className="h-9 mt-1" placeholder="0.0" />
                </div>
                <div>
                  <Label className="text-xs">{t('pdform.height')}</Label>
                  <Input type="number" step="0.1" min="0" value={editForm.height}
                    onChange={e => setEditForm(v => ({ ...v, height: e.target.value }))}
                    className="h-9 mt-1" placeholder="0.0" />
                </div>
              </div>
            </div>

            <div className="col-span-2">
              <Label className="text-xs">{t('pdform.storageFg')}</Label>
              <EntityPicker
                items={storageLocations}
                value={editForm.storageLocationId || null}
                onChange={id => setEditForm(p => ({ ...p, storageLocationId: id ?? '' }))}
                getId={loc => loc.id}
                getPrimary={loc => loc.name}
                getSecondary={loc => loc.code}
                placeholder={t('pdform.selectLocation')}
                searchPlaceholder={t('pdform.searchLocation')}
                className="mt-1"
              />
            </div>
          </div>
      </InlineFormPanel>

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('productsView.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('productsView.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  );
}
