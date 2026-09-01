'use client';
import { useTranslation } from 'react-i18next';

import React, { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import {
  Workflow,
  GitMerge,
  FlaskConical,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Plus,
  CheckCircle2,
  AlertCircle,
  Search,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectMenu } from '@/components/ui/select-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Product {
  id: string;
  code: string;
  name: string;
  category?: string;
  categoryId?: string | null;
  baseWeightId?: string | null;
}

interface BOMSummary {
  id: string;
  skuId: string;
  version: string;
  isActive: boolean;
  status: string;
  _count?: { items: number };
}

interface RecipeSummary {
  id: string;
  skuId: string;
  version: string;
  status: string;
  _count?: { ingredients: number };
}

interface ProcessStep {
  stepNumber: number;
  name: string;
  outputUnit: string;
}

interface ProcessSummary {
  id: string;
  skuId: string | null;
  version: string;
  isActive: boolean;
  status: string;
  steps?: ProcessStep[];
  // Scope — a process can cover many products (not just a single skuId)
  scopeType?: 'PRODUCT' | 'CATEGORY' | 'BASE_WEIGHT' | 'PRODUCT_LIST';
  categoryId?: string | null;
  baseWeightId?: string | null;
  skuLinks?: Array<{ skuId: string }>;
  routingSteps?: Array<{ stepNumber: number; operationName?: string; name?: string; outUnit?: string; outputUnit?: string }>;
}

type CoverageLevel = 'Complete' | 'Partial' | 'Missing';

interface DesignRow {
  product: Product;
  bom: BOMSummary | null;
  recipe: RecipeSummary | null;
  process: ProcessSummary | null;
  coverage: CoverageLevel;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function bomStatusVariant(status: string): string {
  switch (status?.toUpperCase()) {
    case 'APPROVED':
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'REVIEW':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

function recipeStatusVariant(status: string): string {
  switch (status?.toUpperCase()) {
    case 'APPROVED':
      return 'bg-green-500/10 text-green-400 border-green-500/20';
    case 'REVIEW':
      return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
    default:
      return 'bg-muted text-muted-foreground border-border';
  }
}

// A process is scoped to many products (PRODUCT / PRODUCT_LIST / CATEGORY / BASE_WEIGHT),
// so resolve by scope — not just a direct skuId. Higher rank = more specific match wins.
const SCOPE_RANK: Record<string, number> = { PRODUCT: 4, PRODUCT_LIST: 3, BASE_WEIGHT: 2, CATEGORY: 1 };

function processMatchScore(p: ProcessSummary, product: Product): number {
  const scope = p.scopeType ?? (p.skuId ? 'PRODUCT' : undefined);
  switch (scope) {
    case 'PRODUCT':      return p.skuId && p.skuId === product.id ? SCOPE_RANK.PRODUCT : 0;
    case 'PRODUCT_LIST': return p.skuLinks?.some(l => l.skuId === product.id) ? SCOPE_RANK.PRODUCT_LIST : 0;
    case 'BASE_WEIGHT':  return p.baseWeightId && p.baseWeightId === product.baseWeightId ? SCOPE_RANK.BASE_WEIGHT : 0;
    case 'CATEGORY':     return p.categoryId && p.categoryId === product.categoryId ? SCOPE_RANK.CATEGORY : 0;
    default:             return 0;
  }
}

// API returns `routingSteps` ({operationName, outUnit}); the card reads `steps` ({name, outputUnit}).
function normalizeSteps(p: ProcessSummary): ProcessStep[] {
  if (p.steps && p.steps.length) return [...p.steps].sort((a, b) => a.stepNumber - b.stepNumber);
  return (p.routingSteps ?? [])
    .map(s => ({ stepNumber: s.stepNumber, name: s.name ?? s.operationName ?? `Step ${s.stepNumber}`, outputUnit: s.outputUnit ?? s.outUnit ?? '' }))
    .sort((a, b) => a.stepNumber - b.stepNumber);
}

function computeCoverage(bom: BOMSummary | null, recipe: RecipeSummary | null, process: ProcessSummary | null): CoverageLevel {
  const bomOk = bom !== null && (bom.isActive || bom.status?.toUpperCase() === 'APPROVED');
  const recipeOk = recipe !== null && recipe.status?.toUpperCase() === 'APPROVED';
  const processOk = process !== null && process.isActive;

  const count = [bomOk, recipeOk, processOk].filter(Boolean).length;
  if (count === 3) return 'Complete';
  if (count === 0) return 'Missing';
  return 'Partial';
}

function CoverageBadge({ level }: { level: CoverageLevel }) {
  const styles: Record<CoverageLevel, string> = {
    Complete: 'bg-green-500/10 text-green-400 border-green-500/20',
    Partial: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    Missing: 'bg-red-500/10 text-red-400 border-red-500/20',
  };
  const icons: Record<CoverageLevel, React.ReactNode> = {
    Complete: <CheckCircle2 size={10} className="mr-1" />,
    Partial: <AlertCircle size={10} className="mr-1" />,
    Missing: <AlertCircle size={10} className="mr-1" />,
  };
  return (
    <span className={cn('inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border', styles[level])}>
      {icons[level]}
      {level}
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function PlmDesignView() {
  const { t } = useTranslation('modules');
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: ['plm-products'],
    queryFn: () => api.get('/inventory/products?limit=100'),
    staleTime: 60_000,
  });

  const { data: bomData, isLoading: loadingBom } = useQuery({
    queryKey: ['plm-bom'],
    queryFn: () => api.get('/inventory/bom?limit=200'),
    staleTime: 60_000,
  });

  const { data: processData, isLoading: loadingProcess } = useQuery({
    queryKey: ['plm-processes'],
    queryFn: () => api.get('/inventory/manufacturing-processes?limit=200'),
    staleTime: 60_000,
  });

  const { data: recipeData, isLoading: loadingRecipes } = useQuery({
    queryKey: ['plm-recipes'],
    queryFn: () => api.get('/production/recipes?limit=200'),
    staleTime: 60_000,
  });

  const isLoading = loadingProducts || loadingBom || loadingProcess || loadingRecipes;

  // ── Data Assembly ─────────────────────────────────────────────────────────

  const products: Product[] = useMemo(() => (productsData as any)?.data ?? [], [productsData]);
  const boms: BOMSummary[] = useMemo(() => (bomData as any)?.data ?? [], [bomData]);
  const processes: ProcessSummary[] = useMemo(() => (processData as any)?.data ?? [], [processData]);
  const recipes: RecipeSummary[] = useMemo(() => (recipeData as any)?.data ?? [], [recipeData]);

  // Index by skuId (latest / first match per product)
  const bomByProduct = useMemo(() => {
    const map = new Map<string, BOMSummary>();
    for (const b of boms) {
      if (!map.has(b.skuId)) map.set(b.skuId, b);
    }
    return map;
  }, [boms]);

  const recipeByProduct = useMemo(() => {
    const map = new Map<string, RecipeSummary>();
    for (const r of recipes) {
      if (!map.has(r.skuId)) map.set(r.skuId, r);
    }
    return map;
  }, [recipes]);

  // Resolve the best-matching process per product by scope (PRODUCT > PRODUCT_LIST >
  // BASE_WEIGHT > CATEGORY); tie-break active first, then latest version.
  const resolveProcess = useCallback((product: Product): ProcessSummary | null => {
    let best: ProcessSummary | null = null;
    let bestScore = 0;
    for (const p of processes) {
      const score = processMatchScore(p, product);
      if (score === 0) continue;
      const isBetter =
        score > bestScore ||
        (score === bestScore && best != null &&
          ((p.isActive && !best.isActive) ||
            (p.isActive === best.isActive && (p.version ?? '') > (best.version ?? ''))));
      if (best == null || isBetter) { best = p; bestScore = score; }
    }
    return best ? { ...best, steps: normalizeSteps(best) } : null;
  }, [processes]);

  const rows: DesignRow[] = useMemo(() => products.map(product => {
    const bom = bomByProduct.get(product.id) ?? null;
    const recipe = recipeByProduct.get(product.id) ?? null;
    const process = resolveProcess(product);
    return { product, bom, recipe, process, coverage: computeCoverage(bom, recipe, process) };
  }), [products, bomByProduct, recipeByProduct, resolveProcess]);

  // ── Filtering ─────────────────────────────────────────────────────────────

  const filteredRows = useMemo(() => {
    const q = search.toLowerCase();
    return rows.filter(row => {
      const matchSearch = !q ||
        row.product.code.toLowerCase().includes(q) ||
        row.product.name.toLowerCase().includes(q);
      const matchCategory = !categoryFilter ||
        (row.product.category ?? '').toLowerCase().includes(categoryFilter.toLowerCase());
      return matchSearch && matchCategory;
    });
  }, [rows, search, categoryFilter]);

  // ── Categories for filter ─────────────────────────────────────────────────
  const categories = useMemo(() => {
    const cats = new Set(products.map(p => p.category).filter(Boolean) as string[]);
    return Array.from(cats).sort();
  }, [products]);

  // ── Stats ─────────────────────────────────────────────────────────────────
  const stats = useMemo(() => ({
    total: rows.length,
    withBom: rows.filter(r => r.bom !== null).length,
    withRecipe: rows.filter(r => r.recipe !== null).length,
    withProcess: rows.filter(r => r.process !== null).length,
  }), [rows]);

  // ── Row toggle ────────────────────────────────────────────────────────────
  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Workflow size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t('plm.design.title')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('plm.design.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t('plm.design.searchProducts')}
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm w-56"
            />
          </div>
          {categories.length > 0 && (
            <SelectMenu
              value={categoryFilter}
              onValueChange={setCategoryFilter}
              menuLabel="Category"
              options={[
                { value: '', label: 'All categories' },
                ...categories.map(cat => ({ value: cat, label: cat })),
              ]}
            />
          )}
        </div>
      </div>

      {/* Stats Bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatChip label="Total Products" value={stats.total} color="default" />
        <StatChip label="With BOM" value={stats.withBom} color="blue" />
        <StatChip label="With Recipe" value={stats.withRecipe} color="purple" />
        <StatChip label="With Process" value={stats.withProcess} color="cyan" />
      </div>

      {/* Table */}
      <div className="border rounded-xl overflow-hidden bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="w-8 p-3" />
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">Product</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">BOM</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">Recipe</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">Process</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">Coverage</th>
                <th className="text-left p-3 text-xs font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b">
                    <td colSpan={7} className="p-3">
                      <div className="h-4 bg-muted/50 rounded animate-pulse" />
                    </td>
                  </tr>
                ))
              ) : filteredRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-12 text-center text-muted-foreground">
                    <Workflow size={36} className="mx-auto mb-3 opacity-20" />
                    <p className="text-sm">No products found</p>
                  </td>
                </tr>
              ) : (
                filteredRows.map(row => (
                  <DesignMatrixRow
                    key={row.product.id}
                    row={row}
                    expanded={expandedRows.has(row.product.id)}
                    onToggle={() => toggleRow(row.product.id)}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Row Component ─────────────────────────────────────────────────────────────

function DesignMatrixRow({
  row,
  expanded,
  onToggle,
}: {
  row: DesignRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { product, bom, recipe, process } = row;

  return (
    <>
      <motion.tr
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className={cn(
          'border-b cursor-pointer hover:bg-muted/20 transition-colors',
          expanded && 'bg-muted/10',
        )}
        onClick={onToggle}
      >
        {/* Expand toggle */}
        <td className="p-3 text-muted-foreground">
          {expanded
            ? <ChevronDown size={14} />
            : <ChevronRight size={14} />}
        </td>

        {/* Product */}
        <td className="p-3">
          <div className="font-medium text-sm">{product.name}</div>
          <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{product.code}</div>
          {product.category && (
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">{product.category}</div>
          )}
        </td>

        {/* BOM */}
        <td className="p-3" onClick={e => e.stopPropagation()}>
          {bom ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">v{bom.version}</span>
              <span className={cn('inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border w-fit', bomStatusVariant(bom.status))}>
                {bom.status ?? 'DRAFT'}
              </span>
              <span className="text-[10px] text-muted-foreground">{bom._count?.items ?? 0} item{(bom._count?.items ?? 0) !== 1 ? 's' : ''}</span>
            </div>
          ) : (
            <NoBadge label="No BOM" />
          )}
        </td>

        {/* Recipe */}
        <td className="p-3" onClick={e => e.stopPropagation()}>
          {recipe ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">v{recipe.version}</span>
              <span className={cn('inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border w-fit', recipeStatusVariant(recipe.status))}>
                {recipe.status ?? 'DRAFT'}
              </span>
              <span className="text-[10px] text-muted-foreground">{recipe._count?.ingredients ?? 0} ingredient{(recipe._count?.ingredients ?? 0) !== 1 ? 's' : ''}</span>
            </div>
          ) : (
            <NoBadge label="No Recipe" />
          )}
        </td>

        {/* Process */}
        <td className="p-3" onClick={e => e.stopPropagation()}>
          {process ? (
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium">v{process.version}</span>
              <span className={cn(
                'inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border w-fit',
                process.isActive
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : 'bg-muted text-muted-foreground border-border',
              )}>
                {process.isActive ? 'Active' : 'Draft'}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {process.steps?.length ?? 0} step{(process.steps?.length ?? 0) !== 1 ? 's' : ''}
              </span>
            </div>
          ) : (
            <NoBadge label="No Process" />
          )}
        </td>

        {/* Coverage */}
        <td className="p-3">
          <CoverageBadge level={row.coverage} />
        </td>

        {/* Actions */}
        <td className="p-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1 flex-wrap">
            <ActionButton href="/inventory/bom" label="BOM" icon={<GitMerge size={10} />} />
            <ActionButton href="/production/recipes" label="Recipe" icon={<FlaskConical size={10} />} />
            <ActionButton href="/production/processes" label="Process" icon={<Workflow size={10} />} />
          </div>
        </td>
      </motion.tr>

      {/* Expanded Detail Row */}
      <AnimatePresence>
        {expanded && (
          <tr className="border-b bg-muted/5">
            <td colSpan={7} className="px-4 pb-4 pt-0">
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="pt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* BOM Items Preview */}
                  <ExpandedSection
                    title="BOM Items"
                    icon={<GitMerge size={12} className="text-blue-400" />}
                    empty={!bom}
                    emptyLabel="No BOM defined"
                  >
                    {bom && (
                      <BomPreview bomId={bom.id} itemCount={bom._count?.items ?? 0} />
                    )}
                  </ExpandedSection>

                  {/* Recipe Ingredients Preview */}
                  <ExpandedSection
                    title="Recipe Ingredients"
                    icon={<FlaskConical size={12} className="text-purple-400" />}
                    empty={!recipe}
                    emptyLabel="No recipe defined"
                  >
                    {recipe && (
                      <RecipePreview recipeId={recipe.id} ingredientCount={recipe._count?.ingredients ?? 0} />
                    )}
                  </ExpandedSection>

                  {/* Process Steps Preview */}
                  <ExpandedSection
                    title="Process Steps"
                    icon={<Workflow size={12} className="text-cyan-400" />}
                    empty={!process}
                    emptyLabel="No process defined"
                  >
                    {process && process.steps && process.steps.length > 0 && (
                      <ProcessPreview steps={process.steps} />
                    )}
                    {process && (!process.steps || process.steps.length === 0) && (
                      <p className="text-[11px] text-muted-foreground italic">No steps in process definition</p>
                    )}
                  </ExpandedSection>
                </div>
              </motion.div>
            </td>
          </tr>
        )}
      </AnimatePresence>
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NoBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-muted/50 text-muted-foreground border-border">
      <Plus size={9} />
      {label}
    </span>
  );
}

function ActionButton({
  href,
  label,
  icon,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded border border-border bg-background hover:bg-muted/60 text-foreground transition-colors"
      onClick={e => e.stopPropagation()}
    >
      {icon}
      {label}
      <ExternalLink size={8} className="text-muted-foreground" />
    </Link>
  );
}

function ExpandedSection({
  title,
  icon,
  empty,
  emptyLabel,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  empty: boolean;
  emptyLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <div className="flex items-center gap-1.5 mb-2">
        {icon}
        <span className="text-xs font-semibold text-foreground">{title}</span>
      </div>
      {empty ? (
        <p className="text-[11px] text-muted-foreground italic">{emptyLabel}</p>
      ) : (
        children
      )}
    </div>
  );
}

// ── BOM Preview — fetches items on demand ─────────────────────────────────────

function BomPreview({ bomId, itemCount }: { bomId: string; itemCount: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['plm-bom-detail', bomId],
    queryFn: () => api.get(`/inventory/bom/${bomId}`),
    staleTime: 120_000,
  });

  const items: Array<{ id: string; rawMaterial?: { name: string }; quantityPer: number; unit: string }> =
    (data as any)?.items ?? [];

  if (isLoading) {
    return <p className="text-[11px] text-muted-foreground italic">Loading items...</p>;
  }

  if (items.length === 0) {
    return <p className="text-[11px] text-muted-foreground italic">No items in BOM</p>;
  }

  const visible = items.slice(0, 4);
  const remaining = items.length - visible.length;

  return (
    <ul className="space-y-0.5">
      {visible.map(item => (
        <li key={item.id} className="text-[11px] text-foreground/80">
          &bull; {item.rawMaterial?.name ?? 'Unknown'}{' '}
          <span className="text-muted-foreground">({item.quantityPer} {item.unit})</span>
        </li>
      ))}
      {remaining > 0 && (
        <li className="text-[11px] text-muted-foreground italic">...{remaining} more</li>
      )}
    </ul>
  );
}

// ── Recipe Preview — fetches ingredients on demand ────────────────────────────

function RecipePreview({ recipeId, ingredientCount }: { recipeId: string; ingredientCount: number }) {
  const { data, isLoading } = useQuery({
    queryKey: ['plm-recipe-detail', recipeId],
    queryFn: () => api.get(`/production/recipes/${recipeId}`),
    staleTime: 120_000,
  });

  const ingredients: Array<{ id: string; name?: string; rawMaterial?: { name: string }; quantity: number; unit: string }> =
    (data as any)?.ingredients ?? [];

  if (isLoading) {
    return <p className="text-[11px] text-muted-foreground italic">Loading ingredients...</p>;
  }

  if (ingredients.length === 0) {
    return <p className="text-[11px] text-muted-foreground italic">No ingredients defined</p>;
  }

  const visible = ingredients.slice(0, 4);
  const remaining = ingredients.length - visible.length;

  return (
    <ul className="space-y-0.5">
      {visible.map(ing => (
        <li key={ing.id} className="text-[11px] text-foreground/80">
          &bull; {ing.name ?? ing.rawMaterial?.name ?? 'Unknown'}{' '}
          <span className="text-muted-foreground">({ing.quantity} {ing.unit})</span>
        </li>
      ))}
      {remaining > 0 && (
        <li className="text-[11px] text-muted-foreground italic">...{remaining} more</li>
      )}
    </ul>
  );
}

// ── Process Steps Preview — steps are embedded in the summary ─────────────────

function ProcessPreview({ steps }: { steps: ProcessStep[] }) {
  const visible = steps.slice(0, 4);
  const remaining = steps.length - visible.length;

  return (
    <ol className="space-y-0.5">
      {visible.map(step => (
        <li key={step.stepNumber} className="text-[11px] text-foreground/80">
          Step {step.stepNumber}: {step.name}
          {step.outputUnit && (
            <span className="text-muted-foreground"> &rarr; {step.outputUnit}</span>
          )}
        </li>
      ))}
      {remaining > 0 && (
        <li className="text-[11px] text-muted-foreground italic">...{remaining} more</li>
      )}
    </ol>
  );
}

// ── Stat Chip ─────────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: 'default' | 'blue' | 'purple' | 'cyan';
}) {
  const colorMap: Record<string, string> = {
    default: 'bg-muted/60 text-foreground border-border',
    blue: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    purple: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  };
  return (
    <div className={cn('inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium', colorMap[color])}>
      <span className="font-bold text-sm">{value}</span>
      <span className="opacity-80">{label}</span>
    </div>
  );
}
