'use client';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';
import Link from 'next/link';
import {
  BookOpen,
  Package,
  GitMerge,
  FlaskConical,
  Workflow,
  GitPullRequest,
  ChevronRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface PaginatedResponse {
  data: unknown[];
  total: number;
}

// ── Report card definitions ───────────────────────────────────────────────────

const REPORT_CARDS = [
  {
    id: 'product-catalog',
    title: 'Product Catalog',
    href: '/inventory/products',
    icon: Package,
    iconColor: 'text-brand-400',
    iconBg: 'bg-brand-500/20',
    description: 'Full SKU catalog with specs and status',
  },
  {
    id: 'bom-analysis',
    title: 'BOM Analysis',
    href: '/inventory/bom',
    icon: GitMerge,
    iconColor: 'text-blue-400',
    iconBg: 'bg-blue-500/20',
    description: 'Bill of materials coverage and version history',
  },
  {
    id: 'recipe-status',
    title: 'Recipe Status',
    href: '/production/recipes',
    icon: FlaskConical,
    iconColor: 'text-purple-400',
    iconBg: 'bg-purple-500/20',
    description: 'Recipe versions, ingredients, approval status',
  },
  {
    id: 'process-routings',
    title: 'Process Routings',
    href: '/production/processes',
    icon: Workflow,
    iconColor: 'text-cyan-400',
    iconBg: 'bg-cyan-500/20',
    description: 'Routing steps, cycle times, bottlenecks',
  },
  {
    id: 'change-request-log',
    title: 'Change Request Log',
    href: '/plm/change-requests',
    icon: GitPullRequest,
    iconColor: 'text-amber-400',
    iconBg: 'bg-amber-500/20',
    description: 'Engineering change history and impact',
  },
] as const;

// ── Stat chip ─────────────────────────────────────────────────────────────────

function StatChip({
  label,
  value,
  loading,
}: {
  label: string;
  value: number | string;
  loading?: boolean;
}) {
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-muted/50 text-xs font-medium">
      {loading ? (
        <span className="inline-block w-6 h-3 rounded bg-muted-foreground/20 animate-pulse" />
      ) : (
        <span className="font-bold text-sm text-foreground">{value}</span>
      )}
      <span className="text-muted-foreground">{label}</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PlmReportsView() {
  const { t } = useTranslation('modules');
  const { data: productsData, isLoading: loadingProducts } = useQuery({
    queryKey: ['plm-reports-products-count'],
    queryFn: () => api.get<PaginatedResponse>('/inventory/products?limit=1'),
    staleTime: 60_000,
  });

  const { data: recipesData, isLoading: loadingRecipes } = useQuery({
    queryKey: ['plm-reports-recipes-count'],
    queryFn: () => api.get<PaginatedResponse>('/production/recipes?limit=1'),
    staleTime: 60_000,
  });

  const totalProducts = (productsData as any)?.total ?? 0;
  const totalRecipes = (recipesData as any)?.total ?? 0;

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <BookOpen size={18} className="text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold">{t('plm.reports.title')}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('plm.reports.subtitle')}
          </p>
        </div>
      </div>

      {/* Quick stats row */}
      <div className="flex items-center gap-3 flex-wrap">
        <StatChip
          label="Total Products"
          value={totalProducts}
          loading={loadingProducts}
        />
        <StatChip
          label="Active Recipes"
          value={totalRecipes}
          loading={loadingRecipes}
        />
        <Badge variant="outline" className="text-xs px-3 py-1.5 h-auto">
          {REPORT_CARDS.length} Report Types
        </Badge>
      </div>

      {/* Report cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {REPORT_CARDS.map((card, i) => {
          const Icon = card.icon;
          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.06 }}
              className="glass-card rounded-xl p-5 flex flex-col gap-4"
            >
              {/* Icon + title */}
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    card.iconBg,
                  )}
                >
                  <Icon className={cn('w-5 h-5', card.iconColor)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm leading-snug">{card.title}</div>
                  <Badge variant="outline" className="text-[10px] mt-1">
                    PLM
                  </Badge>
                </div>
              </div>

              {/* Description */}
              <p className="text-xs text-muted-foreground leading-relaxed flex-1">
                {card.description}
              </p>

              {/* View button */}
              <Link href={card.href} className="mt-auto">
                <Button size="sm" className="w-full gap-1.5">
                  View
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
