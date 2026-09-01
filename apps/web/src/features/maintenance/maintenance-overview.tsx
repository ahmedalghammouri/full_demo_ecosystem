'use client';
import { DashboardInfo } from '@/components/ui/dashboard-info';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useTranslation } from 'react-i18next';

import React, { useState } from 'react';
import {
  Plus, Search, Filter, Download, Wrench, Clock,
  Calendar, CheckCircle2, AlertTriangle, MoreHorizontal,
  User, ChevronRight, Activity, Boxes, TrendingDown,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { KPICard } from '@/components/widgets/kpi-card';
import { MTTRMTBFChart } from '@/components/charts/mttr-mtbf-chart';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { cn, formatDate, timeAgo, formatDuration, getPriorityStyle } from '@/lib/utils';

interface MaintenanceWorkOrder {
  id: string;
  woNumber: string;
  title: string;
  type: 'PREVENTIVE' | 'CORRECTIVE' | 'PREDICTIVE' | 'EMERGENCY';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: 'OPEN' | 'ASSIGNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
  asset: string;
  assetCode: string;
  assignedTo?: string;
  createdAt: string;
  dueDate: string;
  estimatedHours: number;
  actualHours?: number;
  description: string;
}

const WO_TYPE_CONFIG = {
  PREVENTIVE: { label: 'PM', color: 'text-brand-400', bg: 'bg-brand-500/10' },
  CORRECTIVE: { label: 'CM', color: 'text-warning-400', bg: 'bg-warning-500/10' },
  PREDICTIVE: { label: 'PdM', color: 'text-success-400', bg: 'bg-success-500/10' },
  EMERGENCY: { label: 'EM', color: 'text-danger-400', bg: 'bg-danger-500/10' },
};

const WO_STATUS = {
  OPEN: 'destructive',
  ASSIGNED: 'secondary',
  IN_PROGRESS: 'default',
  COMPLETED: 'default',
  CANCELLED: 'secondary',
} as const;

export function MaintenanceOverview() {
  const { t } = useTranslation(['maintenance', 'common']);
  const [activeTab, setActiveTab] = useState('work-orders');
  const [search, setSearch] = useState('');
  // Respect the global analysis scope (factory/area/line/machine).
  const { filter: scopeFilter, key: scopeKey } = useScope();

  const { data: kpis, isLoading: kpisLoading } = useQuery({
    queryKey: ['maintenance', 'kpis', scopeKey],
    queryFn: () => api.get<{
      openWOs: number; overdueWOs: number; completionRate: number;
      mttr: number; mtbf: number; availabilityRate: number;
      pmCompliance: number;
    }>('/maintenance/kpis', { params: { ...scopeFilter } }),
    refetchInterval: 60_000,
  });

  const { data: workOrders, isLoading: woLoading } = useQuery({
    queryKey: ['maintenance', 'work-orders', { search }, scopeKey],
    queryFn: () => api.get<{ data: MaintenanceWorkOrder[] }>('/maintenance/work-orders', {
      params: { search, limit: 20, ...scopeFilter },
    }),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <div className="flex items-center gap-2"><h1 className="text-lg font-bold">{t('headers.overview.title')}</h1><DashboardInfo id="maintenance-overview" /><DataModeBadge mode="period" /></div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t('headers.overview.subtitle')}
          </p>
        </div>
        {/* <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs">
            <Calendar size={13} />
            {t('ov.schedule')}
          </Button>
          <Button size="sm" className="gap-1.5 h-8 text-xs">
            <Plus size={13} />
            {t('ov.newWorkOrder')}
          </Button>
        </div> */}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <KPICard title={t('ov.kpiOpenWOs')} value={kpis?.openWOs ?? 0} colorMode="alarm" isLoading={kpisLoading} icon={<Wrench size={16} />} />
          <KPICard title={t('ov.kpiOverdue')} value={kpis?.overdueWOs ?? 0} colorMode="alarm" isLoading={kpisLoading} icon={<AlertTriangle size={16} />} />
          <KPICard title={t('ov.kpiCompletion')} value={kpis?.completionRate ?? 0} unit="%" target={95} colorMode="oee" isLoading={kpisLoading} icon={<CheckCircle2 size={16} />} />
          <KPICard title={t('ov.kpiMttr')} value={kpis?.mttr ?? 0} unit="h" isLoading={kpisLoading} icon={<Clock size={16} />} />
          <KPICard title={t('ov.kpiMtbf')} value={kpis?.mtbf ?? 0} unit="h" isLoading={kpisLoading} icon={<Activity size={16} />} />
          <KPICard title={t('ov.kpiAvailability')} value={kpis?.availabilityRate ?? 0} unit="%" target={98} colorMode="oee" isLoading={kpisLoading} />
          <KPICard title={t('ov.kpiPmCompliance')} value={kpis?.pmCompliance ?? 0} unit="%" target={90} colorMode="oee" isLoading={kpisLoading} />
        </div>

        {/* MTTR/MTBF Chart — scoped like the KPI cards */}
        <MTTRMTBFChart isLoading={kpisLoading} scopeParams={scopeFilter} scopeKey={scopeKey} />

        {/* Work Orders */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between mb-3">
            <TabsList>
              <TabsTrigger value="work-orders" className="text-xs gap-1.5">
                <Wrench size={12} />
                {t('ov.tabWorkOrders')}
              </TabsTrigger>
              <TabsTrigger value="assets" className="text-xs gap-1.5">
                <Boxes size={12} />
                {t('ov.tabAssets')}
              </TabsTrigger>
              <TabsTrigger value="calendar" className="text-xs gap-1.5">
                <Calendar size={12} />
                {t('ov.tabCalendar')}
              </TabsTrigger>
            </TabsList>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('search')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-7 w-44 text-xs"
              />
            </div>
          </div>

          <TabsContent value="work-orders">
            <div className="industrial-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-border/30">
                    <TableHead className="text-[11px]">{t('ov.col.wo')}</TableHead>
                    <TableHead className="text-[11px]">{t('ov.col.title')}</TableHead>
                    <TableHead className="text-[11px]">{t('ov.col.type')}</TableHead>
                    <TableHead className="text-[11px]">{t('ov.col.priority')}</TableHead>
                    <TableHead className="text-[11px]">{t('ov.col.status')}</TableHead>
                    <TableHead className="text-[11px]">{t('ov.col.asset')}</TableHead>
                    <TableHead className="text-[11px]">{t('ov.col.assignedTo')}</TableHead>
                    <TableHead className="text-[11px]">{t('ov.col.dueDate')}</TableHead>
                    <TableHead className="text-[11px]">{t('ov.col.estHours')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {woLoading ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <TableRow key={i} className="border-border/20">
                        {Array.from({ length: 10 }).map((_, j) => (
                          <TableCell key={j}><div className="shimmer h-3.5 rounded w-20" /></TableCell>
                        ))}
                      </TableRow>
                    ))
                  ) : (workOrders?.data ?? []).map((wo) => {
                    const typeConf = WO_TYPE_CONFIG[wo.type];
                    const priorityStyle = getPriorityStyle(wo.priority);
                    const isOverdue = new Date(wo.dueDate) < new Date() && wo.status !== 'COMPLETED';
                    return (
                      <TableRow key={wo.id} className="border-border/20 hover:bg-muted/20 cursor-pointer">
                        <TableCell className="font-mono text-xs font-semibold text-primary">{wo.woNumber}</TableCell>
                        <TableCell className="text-xs max-w-[150px]">
                          <span className="truncate block">{wo.title}</span>
                        </TableCell>
                        <TableCell>
                          <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold', typeConf.bg, typeConf.color)}>
                            {typeConf.label}
                          </span>
                        </TableCell>
                        <TableCell>
                          <span className={cn('text-xs font-semibold', priorityStyle.color)}>{priorityStyle.label}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={WO_STATUS[wo.status]} className="text-[10px] h-5">
                            {t(`woStatus.${wo.status}`, { defaultValue: wo.status.replace('_', ' ') })}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="text-xs font-medium">{wo.asset}</div>
                          <div className="text-[10px] text-muted-foreground">{wo.assetCode}</div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {wo.assignedTo || <span className="italic text-warning-400">{t('unassigned')}</span>}
                        </TableCell>
                        <TableCell className={cn('text-xs', isOverdue && 'text-danger-400 font-medium')}>
                          {formatDate(wo.dueDate)}
                          {isOverdue && ' ⚠'}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {wo.actualHours !== undefined ? (
                            <span>{wo.actualHours}h / {wo.estimatedHours}h</span>
                          ) : (
                            <span>{wo.estimatedHours}h</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <ChevronRight size={13} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="assets">
            <div className="flex items-center justify-center h-40 industrial-card rounded-lg">
              <div className="text-center">
                <Boxes size={32} className="text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{t('ov.assetRegistry')}</p>
                <p className="text-xs text-muted-foreground/60">{t('ov.assetRegistryDesc')}</p>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="calendar">
            <div className="flex items-center justify-center h-40 industrial-card rounded-lg">
              <div className="text-center">
                <Calendar size={32} className="text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{t('ov.pmCalendar')}</p>
                <p className="text-xs text-muted-foreground/60">{t('ov.pmCalendarDesc')}</p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
