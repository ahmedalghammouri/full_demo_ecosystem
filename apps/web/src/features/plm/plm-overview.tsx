'use client';
import { useTranslation } from 'react-i18next';

import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  Package,
  FlaskConical,
  Workflow,
  GitMerge,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronRight,
  Search,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api.client';
import { cn, timeAgo } from '@/lib/utils';

// ─── Interfaces ────────────────────────────────────────────────────────────

interface Product {
  id: string;
  code: string;
  name: string;
  category: string | null;
  brand: string | null;
  updatedAt: string;
}

interface BOM {
  id: string;
  skuId: string;
  version: string;
  isActive: boolean;
  status: string;
  approvedAt: string | null;
  updatedAt: string;
}

interface Recipe {
  id: string;
  skuId: string;
  version: string;
  status: string;
  sku: { name: string };
  updatedAt: string;
}

interface ManufacturingProcess {
  id: string;
  skuId: string;
  version: string;
  isActive: boolean;
  status: string;
  updatedAt: string;
}

interface ProductsResponse {
  data: Product[];
  total: number;
}

interface BOMsResponse {
  data: BOM[];
  total: number;
}

interface RecipesResponse {
  data: Recipe[];
  total: number;
}

interface ProcessesResponse {
  data: ManufacturingProcess[];
  total: number;
}

type ActivityType = 'BOM' | 'Recipe' | 'Process';

interface ActivityItem {
  id: string;
  type: ActivityType;
  productName: string;
  version: string;
  status: string;
  updatedAt: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function bomStatusBadge(hasBOM: boolean, hasActiveBOM: boolean) {
  if (hasActiveBOM)
    return (
      <Badge variant="default" className="text-[10px] h-5 bg-green-500/20 text-green-400 border-green-400/30 hover:bg-green-500/30">
        Active
      </Badge>
    );
  if (hasBOM)
    return (
      <Badge variant="outline" className="text-[10px] h-5 text-yellow-400 border-yellow-400/30">
        Draft
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">
      None
    </Badge>
  );
}

function recipeStatusBadge(status: string | null) {
  if (!status)
    return (
      <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">
        None
      </Badge>
    );
  const map: Record<string, string> = {
    APPROVED: 'bg-green-500/20 text-green-400 border-green-400/30 hover:bg-green-500/30',
    REVIEW: 'bg-blue-500/20 text-blue-400 border-blue-400/30',
    DRAFT: 'bg-yellow-500/20 text-yellow-400 border-yellow-400/30',
  };
  const cls = map[status] ?? 'text-muted-foreground';
  return (
    <Badge variant="outline" className={cn('text-[10px] h-5', cls)}>
      {status}
    </Badge>
  );
}

function processStatusBadge(hasProcess: boolean, hasActiveProcess: boolean) {
  if (hasActiveProcess)
    return (
      <Badge variant="default" className="text-[10px] h-5 bg-orange-500/20 text-orange-400 border-orange-400/30 hover:bg-orange-500/30">
        Active
      </Badge>
    );
  if (hasProcess)
    return (
      <Badge variant="outline" className="text-[10px] h-5 text-yellow-400 border-yellow-400/30">
        Draft
      </Badge>
    );
  return (
    <Badge variant="outline" className="text-[10px] h-5 text-muted-foreground">
      None
    </Badge>
  );
}

function designStatusChip(allThree: boolean, some: boolean) {
  if (allThree)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400">
        <CheckCircle2 className="w-2.5 h-2.5" />
        Complete
      </span>
    );
  if (some)
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400">
        <Clock className="w-2.5 h-2.5" />
        Partial
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
      Draft
    </span>
  );
}

function activityTypeBadge(type: ActivityType) {
  const map: Record<ActivityType, { icon: React.ReactNode; cls: string }> = {
    BOM: {
      icon: <GitMerge className="w-2.5 h-2.5" />,
      cls: 'bg-blue-500/15 text-blue-400 border-blue-400/30',
    },
    Recipe: {
      icon: <FlaskConical className="w-2.5 h-2.5" />,
      cls: 'bg-purple-500/15 text-purple-400 border-purple-400/30',
    },
    Process: {
      icon: <Workflow className="w-2.5 h-2.5" />,
      cls: 'bg-orange-500/15 text-orange-400 border-orange-400/30',
    },
  };
  const { icon, cls } = map[type];
  return (
    <Badge variant="outline" className={cn('text-[10px] h-5 gap-0.5', cls)}>
      {icon}
      {type}
    </Badge>
  );
}

function activityStatusBadge(status: string) {
  const map: Record<string, string> = {
    APPROVED: 'bg-green-500/15 text-green-400 border-green-400/30',
    ACTIVE: 'bg-green-500/15 text-green-400 border-green-400/30',
    REVIEW: 'bg-blue-500/15 text-blue-400 border-blue-400/30',
    DRAFT: 'bg-yellow-500/15 text-yellow-400 border-yellow-400/30',
    INACTIVE: 'bg-muted/40 text-muted-foreground',
  };
  return (
    <Badge variant="outline" className={cn('text-[10px] h-5', map[status] ?? 'text-muted-foreground')}>
      {status}
    </Badge>
  );
}

// ─── Coverage Row ──────────────────────────────────────────────────────────

interface CoverageRowProps {
  label: string;
  count: number;
  total: number;
  colorClass: string;
}

function CoverageRow({ label, count, total, colorClass }: CoverageRowProps) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted-foreground w-36 shrink-0">{label}</span>
      <div className="flex-1 h-2 bg-foreground/5 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={cn('h-full rounded-full', colorClass)}
        />
      </div>
      <span className="text-xs font-semibold w-16 text-right tabular-nums">
        {count}<span className="text-muted-foreground font-normal">/{total}</span>
      </span>
      <span className="text-xs font-bold w-10 text-right tabular-nums">{pct}%</span>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────

export default function PlmOverview() {
  const { t } = useTranslation('modules');
  const [search, setSearch] = useState('');

  // ── Queries ──────────────────────────────────────────────────────────────

  const { data: productsRes, isLoading: prodLoading } = useQuery({
    queryKey: ['plm', 'products'],
    queryFn: () => api.get<ProductsResponse>('/inventory/products', { params: { limit: 100 } }),
    staleTime: 60_000,
  });

  const { data: bomsRes, isLoading: bomLoading } = useQuery({
    queryKey: ['plm', 'boms'],
    queryFn: () => api.get<BOMsResponse>('/inventory/bom', { params: { limit: 200 } }),
    staleTime: 60_000,
  });

  const { data: recipesRes, isLoading: recipeLoading } = useQuery({
    queryKey: ['plm', 'recipes'],
    queryFn: () => api.get<RecipesResponse>('/production/recipes', { params: { limit: 200 } }),
    staleTime: 60_000,
  });

  const { data: processesRes, isLoading: processLoading } = useQuery({
    queryKey: ['plm', 'processes'],
    queryFn: () =>
      api.get<ProcessesResponse>('/inventory/manufacturing-processes', { params: { limit: 200 } }),
    staleTime: 60_000,
  });

  const isLoading = prodLoading || bomLoading || recipeLoading || processLoading;

  // ── Derived data ─────────────────────────────────────────────────────────

  const products: Product[] = (productsRes as any)?.data ?? [];
  const totalProducts: number = (productsRes as any)?.total ?? 0;
  const boms: BOM[] = (bomsRes as any)?.data ?? [];
  const recipes: Recipe[] = (recipesRes as any)?.data ?? [];
  const processes: ManufacturingProcess[] = (processesRes as any)?.data ?? [];

  const activeBOMs = boms.filter((b) => b.isActive).length;
  const approvedRecipes = recipes.filter((r) => r.status === 'APPROVED').length;
  const activeProcesses = processes.filter((p) => p.isActive).length;
  const pendingReview =
    recipes.filter((r) => r.status === 'REVIEW' || r.status === 'DRAFT').length +
    boms.filter((b) => b.status === 'DRAFT' || b.status === 'REVIEW').length;

  // Per-product lookup maps
  const bomByProduct = useMemo(() => {
    const map = new Map<string, BOM[]>();
    for (const b of boms) {
      if (!map.has(b.skuId)) map.set(b.skuId, []);
      map.get(b.skuId)!.push(b);
    }
    return map;
  }, [boms]);

  const recipeByProduct = useMemo(() => {
    const map = new Map<string, Recipe[]>();
    for (const r of recipes) {
      if (!map.has(r.skuId)) map.set(r.skuId, []);
      map.get(r.skuId)!.push(r);
    }
    return map;
  }, [recipes]);

  const processByProduct = useMemo(() => {
    const map = new Map<string, ManufacturingProcess[]>();
    for (const p of processes) {
      if (!map.has(p.skuId)) map.set(p.skuId, []);
      map.get(p.skuId)!.push(p);
    }
    return map;
  }, [processes]);

  // Coverage stats
  const coverageStats = useMemo(() => {
    let withActiveBOM = 0;
    let withApprovedRecipe = 0;
    let withActiveProcess = 0;
    let withAll = 0;
    for (const prod of products) {
      const prodBOMs = bomByProduct.get(prod.id) ?? [];
      const prodRecipes = recipeByProduct.get(prod.id) ?? [];
      const prodProcesses = processByProduct.get(prod.id) ?? [];
      const hasActiveBOM = prodBOMs.some((b) => b.isActive);
      const hasApprovedRecipe = prodRecipes.some((r) => r.status === 'APPROVED');
      const hasActiveProcess = prodProcesses.some((p) => p.isActive);
      if (hasActiveBOM) withActiveBOM++;
      if (hasApprovedRecipe) withApprovedRecipe++;
      if (hasActiveProcess) withActiveProcess++;
      if (hasActiveBOM && hasApprovedRecipe && hasActiveProcess) withAll++;
    }
    return { withActiveBOM, withApprovedRecipe, withActiveProcess, withAll };
  }, [products, bomByProduct, recipeByProduct, processByProduct]);

  // Recent activity
  const recentActivity = useMemo((): ActivityItem[] => {
    const items: ActivityItem[] = [];

    for (const b of boms) {
      // Find product name via skuId
      const prod = products.find((p) => p.id === b.skuId);
      items.push({
        id: `bom-${b.id}`,
        type: 'BOM',
        productName: prod?.name ?? b.skuId,
        version: b.version,
        status: b.isActive ? 'ACTIVE' : b.status,
        updatedAt: b.updatedAt,
      });
    }

    for (const r of recipes) {
      items.push({
        id: `recipe-${r.id}`,
        type: 'Recipe',
        productName: r.sku?.name ?? r.skuId,
        version: r.version,
        status: r.status,
        updatedAt: r.updatedAt,
      });
    }

    for (const p of processes) {
      const prod = products.find((prod) => prod.id === p.skuId);
      items.push({
        id: `process-${p.id}`,
        type: 'Process',
        productName: prod?.name ?? p.skuId,
        version: p.version,
        status: p.isActive ? 'ACTIVE' : p.status,
        updatedAt: p.updatedAt,
      });
    }

    return items
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 8);
  }, [boms, recipes, processes, products]);

  // Filtered products for table
  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.category ?? '').toLowerCase().includes(q),
    );
  }, [products, search]);

  // ── KPI cards config ─────────────────────────────────────────────────────

  const kpis = [
    {
      label: 'Total Products',
      value: totalProducts,
      icon: Package,
      color: 'text-blue-400',
      bg: 'bg-blue-500/20',
      alert: false,
    },
    {
      label: 'Active BOMs',
      value: activeBOMs,
      icon: GitMerge,
      color: 'text-green-400',
      bg: 'bg-green-500/20',
      alert: false,
    },
    {
      label: 'Approved Recipes',
      value: approvedRecipes,
      icon: FlaskConical,
      color: 'text-purple-400',
      bg: 'bg-purple-500/20',
      alert: false,
    },
    {
      label: 'Active Processes',
      value: activeProcesses,
      icon: Workflow,
      color: 'text-orange-400',
      bg: 'bg-orange-500/20',
      alert: false,
    },
    {
      label: 'Pending Review',
      value: pendingReview,
      icon: pendingReview > 0 ? AlertCircle : CheckCircle2,
      color: pendingReview > 0 ? 'text-yellow-400' : 'text-green-400',
      bg: pendingReview > 0 ? 'bg-yellow-500/20' : 'bg-green-500/20',
      alert: pendingReview > 0,
    },
  ];

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <BookOpen className="w-5 h-5 text-brand-400" />
          <div>
            <h1 className="text-lg font-bold">{t('plm.overview.title')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('plm.overview.subtitle')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" asChild>
            <Link href="/plm/change-requests">
              <GitMerge className="w-3.5 h-3.5" />
              Change Requests
            </Link>
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs" asChild>
            <Link href="/inventory/products">
              <Package className="w-3.5 h-3.5" />
              New Product
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
          {kpis.map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                className="glass-card rounded-xl p-4 flex items-center gap-3"
              >
                {isLoading ? (
                  <div className="shimmer h-12 w-full rounded" />
                ) : (
                  <>
                    <div
                      className={cn(
                        'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                        kpi.bg,
                      )}
                    >
                      <Icon className={cn('w-5 h-5', kpi.color)} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-foreground">{kpi.label}</div>
                      <div className="text-lg font-bold tabular-nums">{kpi.value}</div>
                    </div>
                  </>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Product Portfolio Table */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 flex items-center justify-between">
            <h2 className="font-semibold text-sm">{t('plm.portfolioTitle')}</h2>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder={t('plm.searchProducts')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-xs w-56"
              />
            </div>
          </div>

          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-background/60">
                <tr className="border-b border-border/30">
                  <th className="text-left p-3 text-muted-foreground font-medium text-[11px]">
                    Product Code
                  </th>
                  <th className="text-left p-3 text-muted-foreground font-medium text-[11px]">
                    Product Name
                  </th>
                  <th className="text-left p-3 text-muted-foreground font-medium text-[11px]">
                    Category
                  </th>
                  <th className="text-center p-3 text-muted-foreground font-medium text-[11px]">
                    BOM
                  </th>
                  <th className="text-center p-3 text-muted-foreground font-medium text-[11px]">
                    Recipe
                  </th>
                  <th className="text-center p-3 text-muted-foreground font-medium text-[11px]">
                    Process
                  </th>
                  <th className="text-center p-3 text-muted-foreground font-medium text-[11px]">
                    Design Status
                  </th>
                  <th className="p-3" />
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={8} className="p-3">
                        <div className="shimmer h-5 rounded" />
                      </td>
                    </tr>
                  ))
                ) : filteredProducts.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="p-8 text-center text-muted-foreground text-sm"
                    >
                      No products found
                    </td>
                  </tr>
                ) : (
                  filteredProducts.map((prod) => {
                    const prodBOMs = bomByProduct.get(prod.id) ?? [];
                    const prodRecipes = recipeByProduct.get(prod.id) ?? [];
                    const prodProcesses = processByProduct.get(prod.id) ?? [];

                    const hasActiveBOM = prodBOMs.some((b) => b.isActive);
                    const hasBOM = prodBOMs.length > 0;
                    const approvedRecipe = prodRecipes.find((r) => r.status === 'APPROVED');
                    const topRecipe =
                      approvedRecipe ??
                      prodRecipes.find((r) => r.status === 'REVIEW') ??
                      prodRecipes.find((r) => r.status === 'DRAFT') ??
                      null;
                    const hasApprovedRecipe = !!approvedRecipe;
                    const hasActiveProcess = prodProcesses.some((p) => p.isActive);
                    const hasProcess = prodProcesses.length > 0;

                    const allThree = hasActiveBOM && hasApprovedRecipe && hasActiveProcess;
                    const some = hasBOM || topRecipe !== null || hasProcess;

                    return (
                      <tr
                        key={prod.id}
                        className="border-b border-border/20 hover:bg-foreground/5 cursor-pointer"
                      >
                        <td className="p-3 text-xs font-mono text-muted-foreground">
                          {prod.code}
                        </td>
                        <td className="p-3 text-xs font-medium">{prod.name}</td>
                        <td className="p-3 text-xs">
                          {prod.category ? (
                            <Badge variant="outline" className="text-[10px] h-5">
                              {prod.category}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {bomStatusBadge(hasBOM, hasActiveBOM)}
                        </td>
                        <td className="p-3 text-center">
                          {recipeStatusBadge(topRecipe?.status ?? null)}
                        </td>
                        <td className="p-3 text-center">
                          {processStatusBadge(hasProcess, hasActiveProcess)}
                        </td>
                        <td className="p-3 text-center">
                          {designStatusChip(allThree, some && !allThree)}
                        </td>
                        <td className="p-3">
                          <Link
                            href={`/plm/design?product=${prod.id}`}
                            className="inline-flex items-center justify-center w-7 h-7 rounded hover:bg-foreground/10 transition-colors"
                          >
                            <ChevronRight className="w-4 h-4 text-muted-foreground" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Bottom 2-col layout: Coverage + Activity */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Design Completeness */}
          <div className="glass-card rounded-xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 className="w-4 h-4 text-green-400" />
              <h2 className="font-semibold text-sm">{t('plm.designCompleteness')}</h2>
            </div>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="shimmer h-5 rounded" />
              ))
            ) : (
              <div className="space-y-3">
                <CoverageRow
                  label="BOM Coverage"
                  count={coverageStats.withActiveBOM}
                  total={totalProducts}
                  colorClass="bg-green-500"
                />
                <CoverageRow
                  label="Recipe Coverage"
                  count={coverageStats.withApprovedRecipe}
                  total={totalProducts}
                  colorClass="bg-purple-500"
                />
                <CoverageRow
                  label="Process Coverage"
                  count={coverageStats.withActiveProcess}
                  total={totalProducts}
                  colorClass="bg-orange-500"
                />
                <CoverageRow
                  label="Full Coverage"
                  count={coverageStats.withAll}
                  total={totalProducts}
                  colorClass="bg-blue-500"
                />
              </div>
            )}
          </div>

          {/* Recent Activity */}
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4 text-brand-400" />
              <h2 className="font-semibold text-sm">{t('plm.recentActivity')}</h2>
            </div>
            {isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="shimmer h-10 rounded" />
                ))}
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground text-sm">
                <Clock className="w-8 h-8 mb-2 opacity-30" />
                No recent activity
              </div>
            ) : (
              <div className="space-y-2">
                {recentActivity.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center gap-3 py-1.5 border-b border-border/20 last:border-0"
                  >
                    {activityTypeBadge(item.type)}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{item.productName}</div>
                      <div className="text-[10px] text-muted-foreground">v{item.version}</div>
                    </div>
                    {activityStatusBadge(item.status)}
                    <div className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                      {timeAgo(item.updatedAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
