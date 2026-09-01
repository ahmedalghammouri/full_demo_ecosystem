'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, BookOpen, FlaskConical, CheckCircle2, Clock3,
  ChevronDown, ChevronRight, Copy, Trash2, Pencil, X, MoreHorizontal,
  Package, Beaker, Send, ShieldCheck, Archive, Info, DollarSign,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EntityPicker } from '@/components/ui/entity-picker';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { TablePagination } from '@/components/ui/table-pagination';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { SortableHeader } from '@/components/ui/sortable-header';
import { useSortedData } from '@/lib/use-sorted-data';

// ── Types ─────────────────────────────────────────────────────

type RecipeStatus = 'DRAFT' | 'REVIEW' | 'APPROVED' | 'OBSOLETE';

interface RecipeIngredient {
  id: string;
  recipeId: string;
  rawMaterialId: string;
  phase?: string;
  quantityPer: number;
  unit: string;
  scrapFactor: number;
  isOptional: boolean;
  notes?: string;
  sortOrder: number;
  rawMaterial: { id: string; code: string; name: string; unit: string; unitCost?: number };
}

interface Recipe {
  id: string;
  code: string;
  version: string;
  name: string;
  description?: string;
  status: RecipeStatus;
  skuId: string;
  processId?: string;
  batchSize?: number;
  batchUnit?: string;
  yieldPct?: number;
  cycleTimeSecs?: number;
  shelfLifeDays?: number;
  storageConditions?: string;
  approvedAt?: string;
  approvedById?: string;
  effectiveFrom?: string;
  effectiveTo?: string;
  notes?: string;
  estimatedMaterialCost?: number;
  sku: { id: string; code: string; name: string; itemNumber?: string; brand?: string };
  process?: { id: string; name: string; version: string };
  approvedBy?: { id: string; name: string };
  ingredients: RecipeIngredient[];
  _count: { workOrders: number; ingredients: number };
}

// ── Status config ─────────────────────────────────────────────

const STATUS: Record<RecipeStatus, { labelKey: string; color: string; bg: string; border: string }> = {
  DRAFT:    { labelKey: 'rec.status.DRAFT',    color: 'text-amber-400',  bg: 'bg-amber-500/10',  border: 'border-amber-500/20' },
  REVIEW:   { labelKey: 'rec.status.REVIEW',   color: 'text-blue-400',   bg: 'bg-blue-500/10',   border: 'border-blue-500/20' },
  APPROVED: { labelKey: 'rec.status.APPROVED', color: 'text-green-400',  bg: 'bg-green-500/10',  border: 'border-green-500/20' },
  OBSOLETE: { labelKey: 'rec.status.OBSOLETE', color: 'text-slate-400',  bg: 'bg-slate-500/10',  border: 'border-slate-500/20' },
};

// ── Empty forms ───────────────────────────────────────────────

const EMPTY_RECIPE_FORM = () => ({
  skuId: '', processId: '', code: '', version: '1.0',
  name: '', description: '',
  batchSize: '', batchUnit: 'kg', yieldPct: '', cycleTimeSecs: '',
  shelfLifeDays: '', storageConditions: '', notes: '',
});

const EMPTY_ING_FORM = () => ({
  rawMaterialId: '', phase: '', quantityPer: '', unit: '', scrapFactor: '0', isOptional: false, notes: '', sortOrder: '0',
});

// ── Main view ─────────────────────────────────────────────────

export function ProductionRecipesView() {
  const { t } = useTranslation(['production', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<RecipeStatus | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Create recipe dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_RECIPE_FORM());

  // Clone dialog
  const [cloneTarget, setCloneTarget] = useState<{ id: string; name: string } | null>(null);
  const [cloneVersion, setCloneVersion] = useState('');

  // Add ingredient dialog
  const [ingTarget, setIngTarget] = useState<{ recipeId: string; status: RecipeStatus } | null>(null);
  const [ingForm, setIngForm] = useState(EMPTY_ING_FORM());

  // ── Sort state ────────────────────────────────────────────

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

  // Reset page when sort changes
  useEffect(() => { setPage(1); }, [sortCol, sortDir]);

  // ── Queries ───────────────────────────────────────────────

  const { data, isLoading } = useQuery({
    queryKey: ['production', 'recipes', search, statusFilter, page, sortCol, sortDir],
    queryFn: () => api.get('/production/recipes', {
      params: {
        search: search || undefined,
        status: statusFilter !== 'ALL' ? statusFilter : undefined,
        page,
        limit: 20,
        sortBy: sortCol,
        sortOrder: sortDir,
      },
    }),
    staleTime: 30_000,
  });

  const { data: skusData } = useQuery({
    queryKey: ['products-list'],
    queryFn: () => api.get('/inventory/products?limit=200'),
    staleTime: 60_000,
    enabled: createOpen,
  });

  const { data: processesData } = useQuery({
    queryKey: ['manufacturing-processes-list'],
    queryFn: () => api.get('/inventory/manufacturing-processes?limit=200'),
    staleTime: 60_000,
    enabled: createOpen,
  });

  const { data: rawMatsData } = useQuery({
    queryKey: ['raw-materials-list'],
    queryFn: () => api.get('/inventory/raw-materials?limit=500'),
    staleTime: 60_000,
    enabled: !!ingTarget,
  });

  const recipes: Recipe[] = (data as any)?.data ?? [];
  const total: number = (data as any)?.total ?? 0;
  const skus: any[] = (skusData as any)?.data ?? [];
  const processes: any[] = (processesData as any)?.data ?? [];
  const rawMaterials: any[] = (rawMatsData as any)?.data ?? [];

  const { sortedData } = useSortedData<Recipe>(recipes, sortCol, sortDir);

  // ── Mutations ─────────────────────────────────────────────

  const createMut = useMutation({
    mutationFn: (dto: any) => api.post('/production/recipes', dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production', 'recipes'] });
      toast({ title: t('rec.toast.created') });
      setCreateOpen(false);
      setForm(EMPTY_RECIPE_FORM());
    },
    onError: (e: any) => toast({ title: t('rec.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const submitMut = useMutation({
    mutationFn: (id: string) => api.post(`/production/recipes/${id}/submit`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production', 'recipes'] }); toast({ title: t('rec.toast.submitted') }); },
    onError: (e: any) => toast({ title: t('rec.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const approveMut = useMutation({
    mutationFn: (id: string) => api.post(`/production/recipes/${id}/approve`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production', 'recipes'] }); toast({ title: t('rec.toast.approved') }); },
    onError: (e: any) => toast({ title: t('rec.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const obsoleteMut = useMutation({
    mutationFn: (id: string) => api.post(`/production/recipes/${id}/obsolete`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production', 'recipes'] }); toast({ title: t('rec.toast.obsoleted') }); },
    onError: (e: any) => toast({ title: t('rec.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const cloneMut = useMutation({
    mutationFn: ({ id, version }: { id: string; version: string }) =>
      api.post(`/production/recipes/${id}/clone`, { version }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production', 'recipes'] });
      toast({ title: t('rec.toast.cloned') });
      setCloneTarget(null);
      setCloneVersion('');
    },
    onError: (e: any) => toast({ title: t('rec.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/production/recipes/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production', 'recipes'] }); toast({ title: t('rec.toast.deleted') }); },
    onError: (e: any) => toast({ title: t('rec.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const addIngMut = useMutation({
    mutationFn: ({ recipeId, dto }: { recipeId: string; dto: any }) =>
      api.post(`/production/recipes/${recipeId}/ingredients`, dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production', 'recipes'] });
      toast({ title: t('rec.toast.ingredientAdded') });
      setIngTarget(null);
      setIngForm(EMPTY_ING_FORM());
    },
    onError: (e: any) => toast({ title: t('rec.toast.error'), description: e?.response?.data?.message, variant: 'destructive' }),
  });

  const removeIngMut = useMutation({
    mutationFn: ({ recipeId, ingredientId }: { recipeId: string; ingredientId: string }) =>
      api.delete(`/production/recipes/${recipeId}/ingredients/${ingredientId}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['production', 'recipes'] }); },
  });

  // ── Handlers ──────────────────────────────────────────────

  const handleCreate = () => {
    if (!form.skuId || !form.code || !form.name) return;
    createMut.mutate({
      skuId: form.skuId,
      processId: form.processId || undefined,
      code: form.code,
      version: form.version,
      name: form.name,
      description: form.description || undefined,
      batchSize: form.batchSize ? parseFloat(form.batchSize) : undefined,
      batchUnit: form.batchUnit || undefined,
      yieldPct: form.yieldPct ? parseFloat(form.yieldPct) : undefined,
      cycleTimeSecs: form.cycleTimeSecs ? parseFloat(form.cycleTimeSecs) : undefined,
      shelfLifeDays: form.shelfLifeDays ? parseInt(form.shelfLifeDays, 10) : undefined,
      storageConditions: form.storageConditions || undefined,
      notes: form.notes || undefined,
    });
  };

  const handleAddIngredient = () => {
    if (!ingTarget || !ingForm.rawMaterialId || !ingForm.quantityPer || !ingForm.unit) return;
    addIngMut.mutate({
      recipeId: ingTarget.recipeId,
      dto: {
        rawMaterialId: ingForm.rawMaterialId,
        phase: ingForm.phase || undefined,
        quantityPer: parseFloat(ingForm.quantityPer),
        unit: ingForm.unit,
        scrapFactor: parseFloat(ingForm.scrapFactor) || 0,
        isOptional: ingForm.isOptional,
        notes: ingForm.notes || undefined,
        sortOrder: parseInt(ingForm.sortOrder, 10) || 0,
      },
    });
  };

  // ── Stats ─────────────────────────────────────────────────

  const counts: Record<RecipeStatus, number> = { DRAFT: 0, REVIEW: 0, APPROVED: 0, OBSOLETE: 0 };
  for (const r of recipes) counts[r.status] = (counts[r.status] ?? 0) + 1;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold">{t('headers.recipes.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.recipes.subtitle')}
          </p>
        </div>
        <Button size="sm" className="gap-1.5 h-8 text-xs" onClick={() => setCreateOpen(true)}>
          <Plus size={13} />{t('rec.newRecipe')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <InlineFormSlot />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {(Object.entries(STATUS) as [RecipeStatus, (typeof STATUS)[RecipeStatus]][]).map(([s, cfg], i) => (
            <motion.button
              key={s}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              onClick={() => setStatusFilter(statusFilter === s ? 'ALL' : s)}
              className={cn(
                'industrial-card rounded-xl p-4 flex items-center gap-3 text-left transition-all',
                statusFilter === s && 'ring-2 ring-primary',
              )}
            >
              <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', cfg.bg)}>
                {s === 'APPROVED' ? <CheckCircle2 size={16} className={cfg.color} /> :
                 s === 'REVIEW'   ? <Send size={16} className={cfg.color} /> :
                 s === 'OBSOLETE' ? <Archive size={16} className={cfg.color} /> :
                 <BookOpen size={16} className={cfg.color} />}
              </div>
              <div>
                <div className="text-xl font-bold">{(data as any)?.total !== undefined && statusFilter === 'ALL' ? (counts[s] ?? 0) : '—'}</div>
                <div className="text-xs text-muted-foreground">{t(cfg.labelKey)}</div>
              </div>
            </motion.button>
          ))}
        </div>

        {/* Info */}
        <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/20 text-sm text-muted-foreground">
          <Info size={14} className="mt-0.5 text-primary shrink-0" />
          <span>
            {t('rec.infoPre')}<strong className="text-foreground">DRAFT</strong> → <strong className="text-foreground">REVIEW</strong> → <strong className="text-foreground">APPROVED</strong> → <strong className="text-foreground">OBSOLETE</strong>{t('rec.infoPost')}
          </span>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('rec.search')}
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Select value={statusFilter} onValueChange={v => { setStatusFilter(v as any); setPage(1); }}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('rec.allStatuses')}</SelectItem>
              {Object.entries(STATUS).map(([s, cfg]) => (
                <SelectItem key={s} value={s}>{t(cfg.labelKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Sort toolbar */}
        <div className="rounded-lg border bg-muted/20 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <SortableHeader column="code"      label={t('rec.col.code')}    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="name"      label={t('rec.col.name')}    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="status"    label={t('rec.col.status')}  sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="version"   label={t('rec.col.version')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="yieldPct"  label={t('rec.col.yield')}   sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="unitCost"  label={t('rec.col.cost')}    sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="updatedAt" label={t('rec.col.updated')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
                <SortableHeader column="createdAt" label={t('rec.col.created')} sortCol={sortCol} sortDir={sortDir} onSort={handleSort} />
              </tr>
            </thead>
          </table>
        </div>

        {/* Recipe list */}
        <div className="flex flex-col gap-3">
          {isLoading ? (
            <div className="text-sm text-muted-foreground p-8 text-center">{t('rec.loading')}</div>
          ) : sortedData.length === 0 ? (
            <div className="border rounded-xl p-12 text-center text-sm text-muted-foreground">
              <FlaskConical size={32} className="mx-auto mb-3 opacity-20" />
              {t('rec.noRecipes')}
            </div>
          ) : sortedData.map(recipe => (
            <RecipeCard
              key={recipe.id}
              recipe={recipe}
              isExpanded={expandedId === recipe.id}
              onToggle={() => setExpandedId(expandedId === recipe.id ? null : recipe.id)}
              onSubmit={() => submitMut.mutate(recipe.id)}
              onApprove={() => approveMut.mutate(recipe.id)}
              onObsolete={() => obsoleteMut.mutate(recipe.id)}
              onClone={() => { setCloneTarget({ id: recipe.id, name: recipe.name }); setCloneVersion(''); }}
              onDelete={() => deleteMut.mutate(recipe.id)}
              onAddIngredient={() => setIngTarget({ recipeId: recipe.id, status: recipe.status })}
              onRemoveIngredient={(ingredientId) => removeIngMut.mutate({ recipeId: recipe.id, ingredientId })}
            />
          ))}
        </div>

        <TablePagination page={page} total={total} limit={20} onPageChange={setPage} />
      </div>

      {/* Create Recipe — inline form */}
      <InlineFormPanel
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        icon={BookOpen}
        title={t('rform.createTitle')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>{t('rform.cancel')}</Button>
            <Button
              size="sm"
              onClick={handleCreate}
              disabled={createMut.isPending || !form.skuId || !form.code || !form.name}
            >
              {createMut.isPending ? t('rform.creating') : t('rform.createRecipe')}
            </Button>
          </>
        )}
      >
              <div className="grid grid-cols-2 gap-4">
                {/* SKU */}
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>{t('rform.product')} *</Label>
                  <EntityPicker
                    items={skus}
                    value={form.skuId}
                    onChange={id => setForm(f => ({ ...f, skuId: id ?? '' }))}
                    getId={(s: any) => s.id}
                    getPrimary={(s: any) => s.name}
                    getSecondary={(s: any) => s.itemNumber}
                    placeholder={t('rform.selectProduct')}
                    searchPlaceholder={t('rform.searchItem')}
                    size="sm"
                    clearable={false}
                  />
                </div>

                {/* Process */}
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>{t('rform.process')}</Label>
                  <EntityPicker
                    items={processes}
                    value={form.processId || null}
                    onChange={id => setForm(f => ({ ...f, processId: id ?? '' }))}
                    getId={(p: any) => p.id}
                    getPrimary={(p: any) => p.name}
                    getSecondary={(p: any) => `v${p.version}`}
                    placeholder={t('rform.linkProcess')}
                    searchPlaceholder={t('rform.searchProcesses')}
                    size="sm"
                  />
                </div>

                {/* Code + Version */}
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.recipeCode')} *</Label>
                  <Input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="RCP-001" className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.version')}</Label>
                  <Input value={form.version} onChange={e => setForm(f => ({ ...f, version: e.target.value }))} placeholder="1.0" className="h-8 text-sm" />
                </div>

                {/* Name */}
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>{t('rform.recipeName')} *</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t('rform.recipeNamePlaceholder')} className="h-8 text-sm" />
                </div>

                {/* Batch size + unit */}
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.batchSize')}</Label>
                  <Input type="number" min="0" value={form.batchSize} onChange={e => setForm(f => ({ ...f, batchSize: e.target.value }))} placeholder="1000" className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.batchUnit')}</Label>
                  <Select value={form.batchUnit} onValueChange={v => setForm(f => ({ ...f, batchUnit: v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {['kg', 'g', 'L', 'mL', 'unit', 'pcs', 'box'].map(u => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Yield + Cycle time */}
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.yieldPct')}</Label>
                  <Input type="number" min="0" max="100" value={form.yieldPct} onChange={e => setForm(f => ({ ...f, yieldPct: e.target.value }))} placeholder="98" className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.cycleTime')}</Label>
                  <Input type="number" min="0" value={form.cycleTimeSecs} onChange={e => setForm(f => ({ ...f, cycleTimeSecs: e.target.value }))} placeholder="3600" className="h-8 text-sm" />
                </div>

                {/* Shelf life + Storage */}
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.shelfLife')}</Label>
                  <Input type="number" min="0" value={form.shelfLifeDays} onChange={e => setForm(f => ({ ...f, shelfLifeDays: e.target.value }))} placeholder="365" className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.storageConditions')}</Label>
                  <Input value={form.storageConditions} onChange={e => setForm(f => ({ ...f, storageConditions: e.target.value }))} placeholder={t('rform.storagePlaceholder')} className="h-8 text-sm" />
                </div>

                {/* Notes */}
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>{t('rform.notes')}</Label>
                  <Input value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder={t('rform.notesPlaceholder')} className="h-8 text-sm" />
                </div>
              </div>
      </InlineFormPanel>

      {/* Add Ingredient — inline form */}
      {ingTarget && (
        <InlineFormPanel
          open={!!ingTarget}
          onClose={() => setIngTarget(null)}
          icon={Plus}
          title={t('rform.addIngredientTitle')}
          footer={(
            <>
              <Button variant="outline" size="sm" onClick={() => setIngTarget(null)}>{t('rform.cancel')}</Button>
              <Button
                size="sm"
                onClick={handleAddIngredient}
                disabled={addIngMut.isPending || !ingForm.rawMaterialId || !ingForm.quantityPer || !ingForm.unit}
              >
                {addIngMut.isPending ? t('rform.adding') : t('rform.addIngredientBtn')}
              </Button>
            </>
          )}
        >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 flex flex-col gap-1.5">
                  <Label>{t('rform.rawMaterial')} *</Label>
                  <EntityPicker
                    items={rawMaterials}
                    value={ingForm.rawMaterialId}
                    onChange={(id, mat) => setIngForm(f => ({ ...f, rawMaterialId: id ?? '', unit: (mat as any)?.unit ?? f.unit }))}
                    getId={(m: any) => m.id}
                    getPrimary={(m: any) => m.name}
                    getSecondary={(m: any) => m.code}
                    getMeta={(m: any) => <span className="text-muted-foreground">{m.unit}</span>}
                    placeholder={t('rform.selectMaterial')}
                    searchPlaceholder={t('rform.searchCodeName')}
                    size="sm"
                    clearable={false}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.phase')}</Label>
                  <Input value={ingForm.phase} onChange={e => setIngForm(f => ({ ...f, phase: e.target.value }))} placeholder={t('rform.phasePlaceholder')} className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.sortOrder')}</Label>
                  <Input type="number" min="0" value={ingForm.sortOrder} onChange={e => setIngForm(f => ({ ...f, sortOrder: e.target.value }))} className="h-8 text-sm" />
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.qtyPerBatch')} *</Label>
                  <Input type="number" min="0" step="0.001" value={ingForm.quantityPer} onChange={e => setIngForm(f => ({ ...f, quantityPer: e.target.value }))} placeholder="100" className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.unit')} *</Label>
                  <Select value={ingForm.unit || '_none'} onValueChange={v => setIngForm(f => ({ ...f, unit: v === '_none' ? '' : v }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t('rform.unitPlaceholder')} /></SelectTrigger>
                    <SelectContent>
                      {['kg', 'g', 'mg', 'L', 'mL', 'unit', 'pcs'].map(u => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.scrapFactor')}</Label>
                  <Input type="number" min="0" max="100" value={ingForm.scrapFactor} onChange={e => setIngForm(f => ({ ...f, scrapFactor: e.target.value }))} className="h-8 text-sm" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.optional')}</Label>
                  <Select value={ingForm.isOptional ? 'yes' : 'no'} onValueChange={v => setIngForm(f => ({ ...f, isOptional: v === 'yes' }))}>
                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">{t('rform.reqNo')}</SelectItem>
                      <SelectItem value="yes">{t('rform.optYes')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
        </InlineFormPanel>
      )}

      {/* Clone Recipe — inline form */}
      {cloneTarget && (
        <InlineFormPanel
          open={!!cloneTarget}
          onClose={() => setCloneTarget(null)}
          icon={Copy}
          title={t('rform.cloneTitle')}
          footer={(
            <>
              <Button variant="outline" size="sm" onClick={() => setCloneTarget(null)}>{t('rform.cancel')}</Button>
              <Button
                size="sm"
                onClick={() => cloneMut.mutate({ id: cloneTarget.id, version: cloneVersion })}
                disabled={cloneMut.isPending || !cloneVersion.trim()}
              >
                {cloneMut.isPending ? t('rform.cloning') : t('rform.clone')}
              </Button>
            </>
          )}
        >
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  {t('rform.cloneMsgPre')} <strong className="text-foreground">{cloneTarget.name}</strong> {t('rform.cloneMsgPost')}
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('rform.newVersion')} *</Label>
                  <Input
                    value={cloneVersion}
                    onChange={e => setCloneVersion(e.target.value)}
                    placeholder={t('rform.newVersionPlaceholder')}
                    className="h-8 text-sm"
                    autoFocus
                  />
                </div>
              </div>
        </InlineFormPanel>
      )}
    </div>
  );
}

// ── Recipe Card ───────────────────────────────────────────────

function RecipeCard({
  recipe, isExpanded, onToggle,
  onSubmit, onApprove, onObsolete, onClone, onDelete,
  onAddIngredient, onRemoveIngredient,
}: {
  recipe: Recipe;
  isExpanded: boolean;
  onToggle: () => void;
  onSubmit: () => void;
  onApprove: () => void;
  onObsolete: () => void;
  onClone: () => void;
  onDelete: () => void;
  onAddIngredient: () => void;
  onRemoveIngredient: (id: string) => void;
}) {
  const { t } = useTranslation(['production', 'common']);
  const cfg = STATUS[recipe.status];

  return (
    <div className="border rounded-xl overflow-hidden bg-card">
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
        onClick={onToggle}
      >
        <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
          <FlaskConical size={15} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[10px] text-muted-foreground">{recipe.code}</span>
            <span className="font-semibold text-sm">{recipe.name}</span>
            <Badge variant="outline" className="text-[10px] h-4">v{recipe.version}</Badge>
            <Badge className={cn('text-[10px] h-4 border', cfg.bg, cfg.color, cfg.border)}>
              {t(cfg.labelKey)}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
            <span><Package size={10} className="inline mr-0.5" />{recipe.sku.name}</span>
            {recipe.batchSize && <span>{recipe.batchSize} {recipe.batchUnit}</span>}
            {recipe.yieldPct != null && <span>{t('rec.yieldSuffix', { pct: recipe.yieldPct })}</span>}
            {recipe.cycleTimeSecs != null && <span><Clock3 size={10} className="inline mr-0.5" />{t('rec.minSuffix', { count: Number((recipe.cycleTimeSecs / 60).toFixed(0)) })}</span>}
            <span>{t('rec.ingredientsSuffix', { count: recipe._count.ingredients })}</span>
            {recipe.estimatedMaterialCost != null && (
              <span className="text-green-400 flex items-center gap-0.5">
                <DollarSign size={9} />{recipe.estimatedMaterialCost.toFixed(2)}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
          {recipe.status === 'DRAFT' && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onSubmit}>
              <Send size={11} className="mr-1" />{t('rec.review')}
            </Button>
          )}
          {recipe.status === 'REVIEW' && (
            <Button size="sm" variant="outline" className="h-7 text-xs text-green-500 border-green-500/30 hover:bg-green-500/10" onClick={onApprove}>
              <ShieldCheck size={11} className="mr-1" />{t('rec.approve')}
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7">
                <MoreHorizontal size={13} />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onClone}>
                <Copy size={12} className="mr-2" />{t('rec.cloneVersion')}
              </DropdownMenuItem>
              {recipe.status === 'APPROVED' && (
                <DropdownMenuItem onClick={onObsolete} className="text-amber-500">
                  <Archive size={12} className="mr-2" />{t('rec.markObsolete')}
                </DropdownMenuItem>
              )}
              {recipe.status === 'DRAFT' && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={onDelete} className="text-destructive">
                    <Trash2 size={12} className="mr-2" />{t('rec.delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {isExpanded ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        </div>
      </div>

      {/* Expanded: Ingredients */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: 0 }}
            className="overflow-hidden"
          >
            <div className="border-t p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  {t('rec.bom', { count: recipe.ingredients?.length ?? 0 })}
                </div>
                {(recipe.status === 'DRAFT' || recipe.status === 'REVIEW') && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onAddIngredient}>
                    <Plus size={11} className="mr-1" />{t('rec.addIngredient')}
                  </Button>
                )}
              </div>

              {(recipe.ingredients?.length ?? 0) === 0 ? (
                <div className="text-xs text-muted-foreground p-4 border rounded-lg border-dashed text-center">
                  {t('rec.noIngredients')}
                </div>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/40">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('rec.colMaterial')}</th>
                        <th className="text-left px-3 py-2 font-medium text-muted-foreground">{t('rec.colPhase')}</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">{t('rec.colQtyBatch')}</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">{t('rec.colScrap')}</th>
                        <th className="text-right px-3 py-2 font-medium text-muted-foreground">{t('rec.colCostUnit')}</th>
                        <th className="px-3 py-2"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(recipe.ingredients ?? []).map((ing, i) => (
                        <tr key={ing.id} className={cn('border-t', i % 2 === 0 ? '' : 'bg-muted/20')}>
                          <td className="px-3 py-2">
                            <div className="font-medium">{ing.rawMaterial.name}</div>
                            <div className="text-[10px] text-muted-foreground">{ing.rawMaterial.code}</div>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{ing.phase || '—'}</td>
                          <td className="px-3 py-2 text-right">
                            <span className="font-mono">{ing.quantityPer} {ing.unit}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {ing.scrapFactor > 0 ? `${ing.scrapFactor}%` : '—'}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {ing.rawMaterial.unitCost != null ? `$${ing.rawMaterial.unitCost}` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {(recipe.status === 'DRAFT' || recipe.status === 'REVIEW') && (
                              <Button
                                variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                                onClick={() => onRemoveIngredient(ing.id)}
                              >
                                <Trash2 size={11} />
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {recipe.estimatedMaterialCost != null && (
                      <tfoot className="border-t bg-muted/30">
                        <tr>
                          <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                            {t('rec.estCostBatch')}
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-bold text-green-400">
                            ${recipe.estimatedMaterialCost.toFixed(2)}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}

              {/* Meta */}
              <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs text-muted-foreground">
                {recipe.process && (
                  <div><span className="font-medium text-foreground">{t('rec.metaProcess')}</span> {recipe.process.name} v{recipe.process.version}</div>
                )}
                {recipe.shelfLifeDays && (
                  <div><span className="font-medium text-foreground">{t('rec.metaShelfLife')}</span> {t('rec.shelfDays', { count: recipe.shelfLifeDays })}</div>
                )}
                {recipe.storageConditions && (
                  <div><span className="font-medium text-foreground">{t('rec.metaStorage')}</span> {recipe.storageConditions}</div>
                )}
                {recipe.approvedBy && (
                  <div><span className="font-medium text-foreground">{t('rec.metaApprovedBy')}</span> {recipe.approvedBy.name}</div>
                )}
                {recipe._count.workOrders > 0 && (
                  <div><span className="font-medium text-foreground">{t('rec.metaWorkOrders')}</span> {recipe._count.workOrders}</div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
