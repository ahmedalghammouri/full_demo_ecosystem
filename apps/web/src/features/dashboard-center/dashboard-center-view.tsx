'use client';
import { useTranslation } from 'react-i18next';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, LayoutGrid, Star, Copy, SlidersHorizontal, Building2, RefreshCw, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { SelectMenu } from '@/components/ui/select-menu';
import { cn } from '@/lib/utils';
import { useFactoryStore } from '@/store/factory-store';
import { toast } from '@/components/ui/use-toast';
import {
  useDashboards, useDashboardCategories, useToggleFavorite, useCloneDashboard,
  type DashboardCatalogItem, type DashboardSource, type DashboardFilters,
} from './use-dashboard-center';
import { DashboardCard, resolveIcon } from './dashboard-card';

type Tab = 'all' | 'favorites' | 'templates';

const SOURCE_FILTERS: { value: DashboardSource | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All Sources' },
  { value: 'Industry360_NATIVE', label: 'Industry360°' },
  // 'Custom' (Grafana) is gone. It filtered a source the catalogue no longer
  // surfaces, so it was a control that could only ever return nothing — and it
  // is removed at build time rather than hidden behind a flag, because a flag
  // is a thing that gets switched back on by accident in a deployed image.
  { value: 'REPORT', label: 'Reports' },
  { value: 'EXTERNAL', label: 'External' },
];

export function DashboardCenterView() {
  const { t } = useTranslation('modules');
  const router = useRouter();
  const { selectedFactory } = useFactoryStore();

  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [source, setSource] = useState<DashboardSource | 'ALL'>('ALL');

  const filters: DashboardFilters = useMemo(() => ({
    search: search.trim() || undefined,
    category: activeCategory || undefined,
    source: source === 'ALL' ? undefined : source,
    favorites: tab === 'favorites' || undefined,
    templates: tab === 'templates' || undefined,
  }), [search, activeCategory, source, tab]);

  const { data: categories } = useDashboardCategories();
  const { data: dashboards, isLoading, refetch, isFetching } = useDashboards(filters);
  const toggleFavorite = useToggleFavorite();
  const cloneDashboard = useCloneDashboard();

  const items = dashboards ?? [];

  function launch(d: DashboardCatalogItem) {
    if (d.isTemplate) {
      handleClone(d);
      return;
    }
    if ((d.source === 'Industry360_NATIVE' || d.source === 'REPORT') && d.route) {
      router.push(d.route);
      return;
    }
    // External → embedded viewer (preserves Industry360° chrome)
    router.push(`/dashboard-center/${d.id}`);
  }

  async function handleClone(d: DashboardCatalogItem) {
    try {
      const created = await cloneDashboard.mutateAsync(d.id);
      toast({ title: t('dashboardCenter.toastCreated'), description: t('dashboardCenter.toastCreatedDesc', { title: d.title }) });
      if (created?.id) router.push(`/dashboard-center/${created.id}`);
    } catch {
      toast({ title: t('dashboardCenter.toastCloneFailed'), variant: 'destructive' });
    }
  }

  const hasFilters = !!search || !!activeCategory || source !== 'ALL';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0 flex-wrap gap-3">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <LayoutGrid size={18} className="text-primary" />
            {t('dashboardCenter.title')}
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('dashboardCenter.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selectedFactory && (
            <Badge variant="outline" className="h-8 gap-1.5 text-xs">
              <Building2 size={13} className="text-cyan-400" />
              {selectedFactory.code}
            </Badge>
          )}
          {/* The Grafana connectivity badge went with the Custom source: a status
              light for a backend the catalogue no longer surfaces. */}
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={13} className={cn(isFetching && 'animate-spin')} />
            {t('dashboardCenter.refresh')}
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-6 py-3 border-b border-border/40 shrink-0 flex items-center gap-3 flex-wrap">
        {/* Tabs */}
        <div className="flex items-center gap-1 rounded-lg bg-foreground/5 p-0.5">
          {([['all', 'tabAll', LayoutGrid], ['favorites', 'tabFavorites', Star], ['templates', 'tabTemplates', Copy]] as const).map(
            ([key, labelKey, Icon]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                  tab === key ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon size={13} />
                {t(`dashboardCenter.${labelKey}`)}
              </button>
            ),
          )}
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('dashboardCenter.searchDashboards')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Source filter */}
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal size={13} className="text-muted-foreground" />
          <SelectMenu
            value={source}
            onValueChange={(v) => setSource(v as DashboardSource | 'ALL')}
            menuLabel={t('dashboardCenter.source')}
            options={SOURCE_FILTERS.map((s) => ({ value: s.value, label: t(`dashboardCenter.src.${s.value}`, { defaultValue: s.label }) }))}
          />
        </div>

        {hasFilters && (
          <Button
            variant="ghost" size="sm"
            className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => { setSearch(''); setActiveCategory(null); setSource('ALL'); }}
          >
            <X size={12} /> {t('dashboardCenter.clear')}
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        <div className="flex">
          {/* Category rail */}
          <aside className="w-52 shrink-0 border-r border-border/40 p-3 hidden lg:block">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-2">
              {t('dashboardCenter.categories')}
            </div>
            <button
              onClick={() => setActiveCategory(null)}
              className={cn(
                'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs transition-colors',
                !activeCategory ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-foreground/5',
              )}
            >
              <span className="flex items-center gap-2"><LayoutGrid size={13} /> {t('dashboardCenter.allDashboards')}</span>
            </button>
            {(categories ?? []).map((c) => {
              const Icon = resolveIcon(c.icon);
              const active = activeCategory === c.key;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveCategory(active ? null : c.key)}
                  className={cn(
                    'w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-xs transition-colors mt-0.5',
                    active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-foreground/5',
                  )}
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon size={13} style={{ color: c.color ?? undefined }} />
                    <span className="truncate">{c.name}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground/70">{c.dashboardCount}</span>
                </button>
              );
            })}
          </aside>

          {/* Grid */}
          <div className="flex-1 p-5">
            {isLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="industrial-card rounded-xl p-4">
                    <div className="shimmer h-28 rounded-lg" />
                  </div>
                ))}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-12 h-12 rounded-xl bg-foreground/5 flex items-center justify-center mb-3">
                  {tab === 'favorites' ? <Star size={20} className="text-muted-foreground" />
                    : tab === 'templates' ? <Copy size={20} className="text-muted-foreground" />
                    : <Search size={20} className="text-muted-foreground" />}
                </div>
                <p className="text-sm font-medium">{t('dashboardCenter.noDashboards')}</p>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  {tab === 'favorites' ? t('dashboardCenter.emptyFavorites')
                    : tab === 'templates' ? t('dashboardCenter.emptyTemplates')
                    : t('dashboardCenter.emptyDefault')}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
                {items.map((d, i) => (
                  <DashboardCard
                    key={d.id}
                    dashboard={d}
                    index={i}
                    onLaunch={launch}
                    onToggleFavorite={(x) => toggleFavorite.mutate(x.id)}
                    onClone={handleClone}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
