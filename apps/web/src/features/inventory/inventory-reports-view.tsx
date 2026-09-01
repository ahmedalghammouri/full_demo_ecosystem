'use client';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';
import {
  Package,
  FlaskConical,
  BoxesIcon,
  PackageSearch,
  TrendingUp,
  GitMerge,
  MapPin,
  AlertTriangle,
  ChevronRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────

interface InventoryOverview {
  totalSkus: number;
  totalRawMaterials: number;
  totalSpareparts: number;
  lowStockItems: number;
  totalLocations: number;
  stockValue: number;
}

interface LowStockMaterial {
  id: string;
  code: string;
  name: string;
  currentStock: number;
  minStock: number;
  unit: string;
}

interface LowStockResponse {
  data: LowStockMaterial[];
  total: number;
}

// ── Report card config ───────────────────────────────────────

const reportCards = [
  {
    key: 'stockLevels',
    href: '/inventory/raw-materials',
    icon: FlaskConical,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/20',
  },
  {
    key: 'productInventory',
    href: '/inventory/products',
    icon: BoxesIcon,
    color: 'text-blue-400',
    bg: 'bg-blue-500/20',
  },
  {
    key: 'spareParts',
    href: '/inventory/spare-parts',
    icon: PackageSearch,
    color: 'text-purple-400',
    bg: 'bg-purple-500/20',
  },
  {
    key: 'stockMovements',
    href: '/inventory/materials',
    icon: TrendingUp,
    color: 'text-green-400',
    bg: 'bg-green-500/20',
  },
  {
    key: 'bomRequirements',
    href: '/inventory/bom',
    icon: GitMerge,
    color: 'text-orange-400',
    bg: 'bg-orange-500/20',
  },
  {
    key: 'storageUtilization',
    href: '/inventory/storage-locations',
    icon: MapPin,
    color: 'text-pink-400',
    bg: 'bg-pink-500/20',
  },
];

// ── Component ────────────────────────────────────────────────

export default function InventoryReportsView() {
  const { t } = useTranslation(['inventory', 'common']);
  const { data: overviewData, isLoading: overviewLoading } = useQuery({
    queryKey: ['inventory', 'overview'],
    queryFn: () => api.get<InventoryOverview>('/inventory/overview'),
    staleTime: 60_000,
  });

  const ov = (overviewData as any) as InventoryOverview | undefined;
  const overview: InventoryOverview = {
    totalSkus: ov?.totalSkus ?? 0,
    totalRawMaterials: ov?.totalRawMaterials ?? 0,
    totalSpareparts: ov?.totalSpareparts ?? 0,
    lowStockItems: ov?.lowStockItems ?? 0,
    totalLocations: ov?.totalLocations ?? 0,
    stockValue: ov?.stockValue ?? 0,
  };

  const { data: lowStockData, isLoading: lowStockLoading } = useQuery({
    queryKey: ['inventory', 'raw-materials', 'lowStock'],
    queryFn: () =>
      api.get<LowStockResponse>('/inventory/raw-materials', {
        params: { lowStock: 'true', limit: 10 },
      }),
    staleTime: 60_000,
    enabled: overview.lowStockItems > 0,
  });

  const lowStockMaterials: LowStockMaterial[] =
    ((lowStockData as any) as LowStockResponse | undefined)?.data ?? [];

  const kpis = [
    {
      key: 'totalSkus',
      value: overview.totalSkus,
      icon: BoxesIcon,
      color: 'text-blue-400',
      bg: 'bg-blue-500/20',
      alert: false,
    },
    {
      key: 'rawMaterials',
      value: overview.totalRawMaterials,
      icon: FlaskConical,
      color: 'text-cyan-400',
      bg: 'bg-cyan-500/20',
      alert: false,
    },
    {
      key: 'lowStockAlerts',
      value: overview.lowStockItems,
      icon: AlertTriangle,
      color: overview.lowStockItems > 0 ? 'text-red-400' : 'text-muted-foreground',
      bg: overview.lowStockItems > 0 ? 'bg-red-500/20' : 'bg-muted/20',
      alert: overview.lowStockItems > 0,
    },
    {
      key: 'storageLocations',
      value: overview.totalLocations,
      icon: MapPin,
      color: 'text-pink-400',
      bg: 'bg-pink-500/20',
      alert: false,
    },
  ];

  return (
    <div className="p-6 space-y-8">
      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-brand-500/20 flex items-center justify-center shrink-0">
          <Package className="w-5 h-5 text-brand-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{t('headers.reports.title')}</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {t('headers.reports.subtitle')}
          </p>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <motion.div
              key={kpi.key}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className={cn(
                'glass-card rounded-xl p-4 flex items-center gap-3',
                kpi.alert && 'ring-1 ring-red-500/40',
              )}
            >
              {overviewLoading ? (
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
                    <div className="text-[11px] text-muted-foreground">{t(`reports.kpi.${kpi.key}`)}</div>
                    <div
                      className={cn(
                        'text-xl font-bold',
                        kpi.alert ? 'text-red-400' : '',
                      )}
                    >
                      {kpi.value}
                    </div>
                  </div>
                </>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* ── Report Cards Grid ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4">
          {t('reports.section')}
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {reportCards.map((card, i) => {
            const Icon = card.icon;
            return (
              <motion.div
                key={card.key}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 + i * 0.05 }}
              >
                <Link
                  href={card.href}
                  className="glass-card rounded-xl p-5 flex items-center gap-4 hover:ring-1 hover:ring-border/60 transition-all group block"
                >
                  <div
                    className={cn(
                      'w-11 h-11 rounded-xl flex items-center justify-center shrink-0',
                      card.bg,
                    )}
                  >
                    <Icon className={cn('w-5 h-5', card.color)} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-sm">{t(`reports.cards.${card.key}.title`)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {t(`reports.cards.${card.key}.desc`)}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* ── Low Stock Alerts ── */}
      {overview.lowStockItems > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h2 className="text-sm font-semibold text-red-400 uppercase tracking-wider">
              Low Stock Alerts
            </h2>
            <Badge variant="destructive" className="text-[10px] ml-1">
              {overview.lowStockItems}
            </Badge>
          </div>

          <div className="glass-card rounded-xl border border-red-500/20 overflow-hidden">
            {lowStockLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="shimmer h-5 rounded" />
                ))}
              </div>
            ) : lowStockMaterials.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                No low-stock material details available.
              </div>
            ) : (
              <ul className="divide-y divide-border/30">
                {lowStockMaterials.map((item) => {
                  const pct = item.minStock > 0
                    ? Math.min(100, Math.round((item.currentStock / item.minStock) * 100))
                    : 100;
                  return (
                    <li
                      key={item.id}
                      className="flex items-center gap-4 px-5 py-3 hover:bg-foreground/5 transition-colors"
                    >
                      <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">{item.name}</div>
                        <div className="text-xs text-muted-foreground font-mono">{item.code}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-sm font-semibold text-red-400">
                          {item.currentStock}{' '}
                          <span className="text-muted-foreground font-normal text-xs">
                            / {item.minStock} {item.unit}
                          </span>
                        </div>
                        <div className="text-[10px] text-muted-foreground">
                          {pct}% of minimum
                        </div>
                      </div>
                      <Badge
                        variant="destructive"
                        className="text-[10px] shrink-0"
                      >
                        Low
                      </Badge>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="px-5 py-3 border-t border-border/30 flex justify-end">
              <Button size="sm" variant="outline" asChild>
                <Link href="/inventory/raw-materials?lowStock=true">
                  View All Low Stock
                  <ChevronRight className="w-3.5 h-3.5 ml-1" />
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
