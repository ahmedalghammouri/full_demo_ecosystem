'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import { motion } from 'framer-motion';
import {
  Package, AlertTriangle, BoxesIcon, Layers3, DollarSign, TrendingDown,
  FlaskConical, ArrowLeftRight, Clock, XCircle, ArrowRight, Boxes,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

interface Overview {
  totalStockValue: number;
  spareParts: { total: number; lowStock: number; value: number };
  rawMaterials: { total: number; lowStock: number; value: number };
  products: { total: number };
  materialLots: { active: number; byStatus: Record<string, number>; expiringSoon: number; expired: number };
  movementsLast7d: number;
}

const money = (v?: number) => (v ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });

export function InventoryOverview() {
  const { t } = useTranslation(['inventory', 'common']);
  const { data: ov, isLoading } = useQuery({
    queryKey: ['inventory', 'overview'],
    queryFn: () => api.get<Overview>('/inventory/overview'),
    staleTime: 30_000,
  });

  // Actionable lists — low-stock spare parts & raw materials, recent movements.
  const { data: lowParts } = useQuery({
    queryKey: ['inventory', 'spare-parts', 'low'],
    queryFn: () => api.get<any>('/inventory/spare-parts', { params: { lowStock: true, limit: 6 } }),
    staleTime: 30_000,
  });
  const { data: lowRaw } = useQuery({
    queryKey: ['inventory', 'raw-materials', 'low'],
    queryFn: () => api.get<any>('/inventory/raw-materials', { params: { lowStock: true, limit: 6 } }),
    staleTime: 30_000,
  });
  const { data: movements } = useQuery({
    queryKey: ['inventory', 'stock-movements', 'recent'],
    queryFn: () => api.get<any>('/inventory/stock-movements', { params: { limit: 8 } }),
    staleTime: 30_000,
  });

  const o = ov as Overview | undefined;
  const lowPartsList: any[] = (lowParts as any)?.data ?? [];
  const lowRawList: any[] = (lowRaw as any)?.data ?? [];
  const movementsList: any[] = (movements as any)?.data ?? [];

  const kpis = [
    { label: t('overview.kpi.totalValue'), value: `${money(o?.totalStockValue)} SAR`, icon: DollarSign, color: 'text-green-400', bg: 'bg-green-500/15', href: '/inventory/spare-parts' },
    { label: t('overview.kpi.lowStockAlerts'), value: (o?.spareParts.lowStock ?? 0) + (o?.rawMaterials.lowStock ?? 0), icon: AlertTriangle, color: 'text-red-400', bg: 'bg-red-500/15', href: '/inventory/raw-materials' },
    { label: t('overview.kpi.lotsExpiring'), value: (o?.materialLots.expiringSoon ?? 0) + (o?.materialLots.expired ?? 0), icon: Clock, color: 'text-amber-400', bg: 'bg-amber-500/15', href: '/inventory/materials' },
    { label: t('overview.kpi.movements7d'), value: o?.movementsLast7d ?? 0, icon: ArrowLeftRight, color: 'text-blue-400', bg: 'bg-blue-500/15', href: '/inventory/stock-movements' },
  ];

  const categories = [
    { label: t('overview.cat.rawMaterials'), total: o?.rawMaterials.total ?? 0, low: o?.rawMaterials.lowStock ?? 0, value: o?.rawMaterials.value ?? 0, icon: FlaskConical, color: 'text-cyan-400', href: '/inventory/raw-materials', kind: 'rm' },
    { label: t('overview.cat.spareParts'), total: o?.spareParts.total ?? 0, low: o?.spareParts.lowStock ?? 0, value: o?.spareParts.value ?? 0, icon: Package, color: 'text-brand-400', href: '/inventory/spare-parts', kind: 'sp' },
    { label: t('overview.cat.products'), total: o?.products.total ?? 0, low: null, value: null, icon: BoxesIcon, color: 'text-blue-400', href: '/inventory/products', kind: 'pd' },
    { label: t('overview.cat.materialLots'), total: o?.materialLots.active ?? 0, low: o?.materialLots.expired ?? 0, value: null, icon: Layers3, color: 'text-purple-400', href: '/inventory/materials', kind: 'lot' },
  ];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Boxes size={22} className="text-primary" /> {t('headers.overview.title')}<DashboardInfo id="inventory-overview" /><DataModeBadge mode="live" /></h1>
          <p className="text-muted-foreground text-sm mt-1">{t('headers.overview.subtitle')}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" asChild><Link href="/inventory/raw-materials">{t('overview.rawMaterials')}</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href="/inventory/materials">{t('overview.materialLots')}</Link></Button>
          <Button variant="outline" size="sm" asChild><Link href="/inventory/products">{t('overview.products')}</Link></Button>
          <Button size="sm" asChild><Link href="/inventory/spare-parts">{t('overview.spareParts')}</Link></Button>
        </div>
      </div>

      {/* Headline KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <motion.div key={kpi.label} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Link href={kpi.href} className="glass-card rounded-xl p-4 flex items-center gap-3 hover:bg-foreground/5 transition-colors">
                {isLoading ? <div className="shimmer h-12 w-full rounded" /> : (
                  <>
                    <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center shrink-0', kpi.bg)}>
                      <Icon className={cn('w-5 h-5', kpi.color)} />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[11px] text-muted-foreground">{kpi.label}</div>
                      <div className={cn('text-xl font-bold truncate', kpi.color)}>{kpi.value}</div>
                    </div>
                  </>
                )}
              </Link>
            </motion.div>
          );
        })}
      </div>

      {/* Category breakdown */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {categories.map((c) => {
          const Icon = c.icon;
          return (
            <Link key={c.label} href={c.href} className="glass-card rounded-xl p-4 hover:bg-foreground/5 transition-colors group">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2"><Icon className={cn('w-4 h-4', c.color)} /><span className="text-sm font-medium">{c.label}</span></div>
                <ArrowRight size={14} className="text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
              <div className="text-2xl font-bold mt-2">{c.total}</div>
              <div className="flex items-center gap-3 mt-1 text-[11px]">
                {c.low != null && c.low > 0 && <span className="text-red-400 flex items-center gap-1"><TrendingDown size={11} /> {c.low} {c.kind === 'lot' ? t('overview.expired') : t('overview.low')}</span>}
                {c.value != null && <span className="text-muted-foreground">{money(c.value)} SAR</span>}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Low-stock alerts */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-1.5"><AlertTriangle size={14} className="text-red-400" /> {t('overview.reorderAlerts')}</h2>
            <Badge variant="outline" className="text-[10px]">{lowRawList.length + lowPartsList.length}</Badge>
          </div>
          <div className="divide-y divide-border/30 max-h-[340px] overflow-auto">
            {lowRawList.length + lowPartsList.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">{t('overview.allHealthy')}</div>
            ) : (
              <>
                {lowRawList.map((r) => (
                  <ReorderRow key={`rm-${r.id}`} href="/inventory/raw-materials" code={r.code} name={r.name}
                    stock={r.currentStock} min={r.reorderPoint ?? r.minStock} unit={r.unit} kind={t('overview.kind.raw')} minLabel={t('overview.min')} />
                ))}
                {lowPartsList.map((p) => (
                  <ReorderRow key={`sp-${p.id}`} href="/inventory/spare-parts" code={p.partNumber} name={p.name}
                    stock={p.stockQty} min={p.minStockQty} unit="" kind={t('overview.kind.spare')} minLabel={t('overview.min')} />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Recent movements */}
        <div className="glass-card rounded-xl overflow-hidden">
          <div className="p-4 border-b border-border/50 flex items-center justify-between">
            <h2 className="font-semibold text-sm flex items-center gap-1.5"><ArrowLeftRight size={14} className="text-blue-400" /> {t('overview.recentMovements')}</h2>
            <Button size="sm" variant="outline" asChild className="h-7 text-xs"><Link href="/inventory/stock-movements">{t('overview.viewAll')}</Link></Button>
          </div>
          <div className="divide-y divide-border/30 max-h-[340px] overflow-auto">
            {movementsList.length === 0 ? (
              <div className="p-6 text-center text-sm text-muted-foreground">{t('overview.noRecentMovements')}</div>
            ) : movementsList.map((m: any) => (
              <div key={m.id} className="px-4 py-2.5 flex items-center gap-3 text-xs">
                <MovementIcon type={m.movementType} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{m.entityName ?? m.entityType ?? t('overview.item')}</div>
                  <div className="text-[10px] text-muted-foreground">{m.movementType}{m.reference ? ` · ${m.reference}` : ''}</div>
                </div>
                <div className={cn('font-mono font-semibold', (m.quantity ?? 0) >= 0 ? 'text-green-400' : 'text-red-400')}>
                  {(m.quantity ?? 0) >= 0 ? '+' : ''}{m.quantity}
                </div>
                <div className="text-[10px] text-muted-foreground w-20 text-right">{m.createdAt ? new Date(m.createdAt).toLocaleDateString() : ''}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ReorderRow({ href, code, name, stock, min, unit, kind, minLabel }: { href: string; code: string; name: string; stock: number; min: number; unit: string; kind: string; minLabel: string }) {
  return (
    <Link href={href} className="px-4 py-2.5 flex items-center gap-3 hover:bg-foreground/5">
      <span className="text-[9px] px-1.5 py-0.5 rounded border border-border/50 text-muted-foreground shrink-0">{kind}</span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{name}</div>
        <div className="text-[10px] font-mono text-muted-foreground">{code}</div>
      </div>
      <div className="text-right">
        <div className="text-xs font-semibold text-red-400">{stock}{unit ? ` ${unit}` : ''}</div>
        <div className="text-[10px] text-muted-foreground">{minLabel} {min}</div>
      </div>
    </Link>
  );
}

function MovementIcon({ type }: { type?: string }) {
  const inbound = ['RECEIPT', 'RETURN', 'RELEASE'].includes(type ?? '');
  const cls = inbound ? 'text-green-400' : type === 'ADJUSTMENT' ? 'text-amber-400' : 'text-red-400';
  const Icon = type === 'ADJUSTMENT' ? ArrowLeftRight : inbound ? Package : XCircle;
  return <Icon size={14} className={cls} />;
}
