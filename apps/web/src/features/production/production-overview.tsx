'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { DataModeBadge } from '@/components/ui/data-mode-badge';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  Plus, Download, Filter, RefreshCw, Search,
  Factory, ClipboardList, Boxes, TrendingUp,
  Play, Pause, Square, Eye, MoreHorizontal,
  ChevronDown, Calendar, Clock, Gauge,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { KPICard } from '@/components/widgets/kpi-card';
import { OEEGauge } from '@/components/charts/oee-gauge';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { cn, getStatusVariant, formatDate, formatDuration, formatPercent } from '@/lib/utils';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';

interface WorkOrder {
  id: string;
  orderNumber: string;
  productName: string;
  productCode: string;
  status: 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'ON_HOLD' | 'CANCELLED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  plannedQty: number;
  actualQty: number;
  plannedStart: string;
  actualStart?: string;
  plannedEnd: string;
  actualEnd?: string;
  machine: string;
  operator: string;
  oee?: number;
  progress: number;
}

const STATUS_COLORS = {
  PLANNED: 'secondary',
  IN_PROGRESS: 'default',
  COMPLETED: 'default',
  ON_HOLD: 'outline',
  CANCELLED: 'destructive',
} as const;

const STATUS_KEYS = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'ON_HOLD', 'CANCELLED'] as const;

export function ProductionOverview() {
  /**
   * Declared, because the shell reads it -- see
   * analytics-pages-declare-their-mode.spec.ts. A page that skips this does not
   * get a default; it inherits whatever the LAST page set, so its filter bar
   * changes depending on where the reader arrived from.
   */
  useDeclareViewMode('analytics');
  const { t } = useTranslation(['production', 'common']);
  const { filter: scopeFilter, key: scopeKey } = useScope();
  // The period the reader picked. This hook was imported and never called, so
  // the KPI card below measured since midnight whatever the filter said — a
  // shift heading over a whole-day number, with nothing to reveal the gap.
  const { params: timeParams, key: timeKey } = useTimeRange();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);

  // The WO list is OPERATIONAL (current/active work orders) — it is scoped by
  // area/line/machine but NOT date-windowed, so planned/future WOs still show
  // (otherwise the KPIs count orders the table hides).
  const { data: workOrders, isLoading } = useQuery({
    queryKey: ['production', 'work-orders', { search, status: statusFilter, scope: scopeKey }],
    queryFn: () => api.get<{ data: WorkOrder[]; total: number }>('/production/work-orders', {
      params: { search, status: statusFilter, limit: 20, ...scopeFilter },
    }),
    staleTime: 15_000,
  });

  const { data: productionKPIs } = useQuery({
    queryKey: ['production', 'kpis', scopeKey, timeKey],
    queryFn: () => api.get<{
      oee: number; availability: number; performance: number; quality: number;
      oeeTb?: number; availabilityTb?: number;
      totalOrders: number; completedOrders: number; inProgressOrders: number;
    }>('/production/kpis', { params: { ...scopeFilter, ...timeParams } }),
    refetchInterval: 30_000,
  });

  const orders = workOrders?.data ?? [];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-lg font-bold">{t('mgmtTitle')}</h1><DashboardInfo id="production-overview" /><DataModeBadge mode="live" /></div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('mgmtSubtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Download size={13} />
            {t('common:actions.export')}
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs">
            <Plus size={13} />
            {t('newWorkOrder')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KPICard title={t('kpi.oee')} value={productionKPIs?.oee ?? 0} unit="%" target={85} colorMode="oee" isLoading={isLoading} />
          <KPICard title={t('kpi.totalOrders')} value={productionKPIs?.totalOrders ?? 0} isLoading={isLoading} />
          <KPICard title={t('kpi.inProgress')} value={productionKPIs?.inProgressOrders ?? 0} colorMode="default" isLoading={isLoading} />
          <KPICard title={t('kpi.completed')} value={productionKPIs?.completedOrders ?? 0} colorMode="default" isLoading={isLoading} />
        </div>

        {/* Time-Based (OEE-TB) — shown beside the schedule-based OEE above */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground px-1">
          <span>{t('atOee')}: <b className="text-foreground">{(productionKPIs?.oeeTb ?? 0).toFixed(1)}%</b></span>
          <span>{t('availabilitySchedule')}: <b className="text-foreground">{(productionKPIs?.availability ?? 0).toFixed(1)}%</b></span>
          <span>{t('availabilityTb')}: <b className="text-foreground">{(productionKPIs?.availabilityTb ?? 0).toFixed(1)}%</b></span>
        </div>

        {/* OEE + Work Orders table */}
        <div className="grid grid-cols-12 gap-4">
          {/* OEE panel */}
          <div className="col-span-12 lg:col-span-4">
            <OEEGauge
              oee={productionKPIs?.oee ?? 0}
              availability={productionKPIs?.availability ?? 0}
              performance={productionKPIs?.performance ?? 0}
              quality={productionKPIs?.quality ?? 0}
              isLoading={isLoading}
            />
          </div>

          {/* Work Orders table */}
          <div className="col-span-12 lg:col-span-8">
            <div className="industrial-card p-4">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="text-sm font-semibold text-foreground">{t('workOrders')}</h3>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={13} className="absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder={t('searchOrders')}
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="h-8 ps-7 w-48 text-xs"
                    />
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                        <Filter size={12} />
                        {statusFilter ? t(`status.${statusFilter}`) : t('allStatus')}
                        <ChevronDown size={11} />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => setStatusFilter(null)}>{t('allStatus')}</DropdownMenuItem>
                      {STATUS_KEYS.map((s) => (
                        <DropdownMenuItem key={s} onClick={() => setStatusFilter(s)}>
                          {t(`status.${s}`)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="rounded-lg border border-border/30 overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-border/30">
                      <TableHead className="text-[11px] font-semibold">{t('col.order')}</TableHead>
                      <TableHead className="text-[11px] font-semibold">{t('col.product')}</TableHead>
                      <TableHead className="text-[11px] font-semibold">{t('col.status')}</TableHead>
                      <TableHead className="text-[11px] font-semibold">{t('col.progress')}</TableHead>
                      <TableHead className="text-[11px] font-semibold">{t('col.machine')}</TableHead>
                      <TableHead className="text-[11px] font-semibold">{t('col.plannedEnd')}</TableHead>
                      <TableHead className="text-[11px] font-semibold">{t('col.oee')}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading ? (
                      Array.from({ length: 6 }).map((_, i) => (
                        <TableRow key={i} className="border-border/20">
                          {Array.from({ length: 8 }).map((_, j) => (
                            <TableCell key={j}>
                              <div className="shimmer h-3.5 rounded w-20" />
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    ) : orders.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground text-sm">
                          {t('noWorkOrders')}
                        </TableCell>
                      </TableRow>
                    ) : (
                      orders.map((order) => (
                        <TableRow key={order.id} className="border-border/20 hover:bg-muted/20 cursor-pointer">
                          <TableCell className="font-mono text-xs font-semibold text-primary">
                            {order.orderNumber}
                          </TableCell>
                          <TableCell>
                            <div className="text-xs font-medium truncate max-w-[120px]">{order.productName}</div>
                            <div className="text-[10px] text-muted-foreground">{order.productCode}</div>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={STATUS_COLORS[order.status]}
                              className="text-[10px] h-5"
                            >
                              {t(`status.${order.status}`)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 min-w-[80px]">
                              <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-primary rounded-full"
                                  style={{ width: `${order.progress}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                                {order.progress}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{order.machine}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {formatDate(order.plannedEnd)}
                          </TableCell>
                          <TableCell>
                            {order.oee != null && (
                              <span className={cn(
                                'text-xs font-semibold',
                                order.oee >= 85 ? 'text-success-400' : order.oee >= 65 ? 'text-brand-400' : 'text-warning-400',
                              )}>
                                {formatPercent(order.oee)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-7 w-7">
                                  <MoreHorizontal size={13} />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem className="gap-2 text-xs">
                                  <Eye size={12} /> {t('viewDetails')}
                                </DropdownMenuItem>
                                {order.status === 'PLANNED' && (
                                  <DropdownMenuItem className="gap-2 text-xs text-success-400">
                                    <Play size={12} /> {t('startOrder')}
                                  </DropdownMenuItem>
                                )}
                                {order.status === 'IN_PROGRESS' && (
                                  <>
                                    <DropdownMenuItem className="gap-2 text-xs text-warning-400">
                                      <Pause size={12} /> {t('hold')}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem className="gap-2 text-xs text-brand-400">
                                      <Square size={12} /> {t('complete')}
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
