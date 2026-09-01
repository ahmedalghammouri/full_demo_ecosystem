'use client';
import { useTranslation } from 'react-i18next';
import { toFactoryDayKey } from '@/lib/datetime';

import React, { useState, useMemo } from 'react';
import {
  Calendar,
  Clock,
  AlertTriangle,
  Wrench,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Filter,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SelectMenu } from '@/components/ui/select-menu';
import { api } from '@/services/api.client';
import { cn, formatDate } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

type WOType = 'PREVENTIVE' | 'CORRECTIVE' | 'PREDICTIVE' | 'CONDITION_BASED';
type WOStatus = 'PLANNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
type WOPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type ViewMode = 'list' | 'calendar';
type FilterTab = 'ALL' | 'TODAY' | 'THIS_WEEK' | 'OVERDUE' | 'PREVENTIVE' | 'CORRECTIVE';

interface Machine {
  name: string;
  code: string;
}

interface AssignedTo {
  firstName: string;
  lastName: string;
}

interface WorkOrder {
  id: string;
  woNumber: string;
  type: WOType;
  status: WOStatus;
  priority: WOPriority;
  title: string;
  machine: Machine;
  assignedTo: AssignedTo | null;
  scheduledDate: string | null;
  dueDate: string | null;
  estimatedDuration: number | null;
  completedAt: string | null;
  createdAt: string;
}

interface WorkOrdersResponse {
  data: WorkOrder[];
  total: number;
}

interface MaintenanceKPIs {
  openWOs: number;
  overdueWOs: number;
  completionRate: number;
  mttr: number;
  mtbf: number;
  availabilityRate: number;
  pmCompliance: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TYPE_CONFIG: Record<WOType, { labelKey: string; color: string; bgClass: string; chipClass: string }> = {
  PREVENTIVE:      { labelKey: 'schedView.type.PREVENTIVE',      color: 'text-blue-400',   bgClass: 'bg-blue-400/10 border-blue-400/30',   chipClass: 'bg-blue-500' },
  CORRECTIVE:      { labelKey: 'schedView.type.CORRECTIVE',      color: 'text-red-400',    bgClass: 'bg-red-400/10 border-red-400/30',     chipClass: 'bg-red-500' },
  PREDICTIVE:      { labelKey: 'schedView.type.PREDICTIVE',      color: 'text-purple-400', bgClass: 'bg-purple-400/10 border-purple-400/30', chipClass: 'bg-purple-500' },
  CONDITION_BASED: { labelKey: 'schedView.type.CONDITION_BASED', color: 'text-green-400',  bgClass: 'bg-green-400/10 border-green-400/30',  chipClass: 'bg-green-500' },
};

const PRIORITY_CONFIG: Record<WOPriority, { labelKey: string; color: string; badgeClass: string }> = {
  CRITICAL: { labelKey: 'schedView.priority.CRITICAL', color: 'text-red-400',    badgeClass: 'bg-red-500/15 text-red-400 border-red-400/30' },
  HIGH:     { labelKey: 'schedView.priority.HIGH',     color: 'text-orange-400', badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-400/30' },
  MEDIUM:   { labelKey: 'schedView.priority.MEDIUM',   color: 'text-yellow-400', badgeClass: 'bg-yellow-500/15 text-yellow-400 border-yellow-400/30' },
  LOW:      { labelKey: 'schedView.priority.LOW',      color: 'text-gray-400',   badgeClass: 'bg-gray-500/15 text-gray-400 border-gray-400/30' },
};

const STATUS_CONFIG: Record<WOStatus, { labelKey: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  PLANNED:     { labelKey: 'schedView.status.PLANNED',     variant: 'outline' },
  ASSIGNED:    { labelKey: 'schedView.status.ASSIGNED',    variant: 'secondary' },
  IN_PROGRESS: { labelKey: 'schedView.status.IN_PROGRESS', variant: 'default' },
  ON_HOLD:     { labelKey: 'schedView.status.ON_HOLD',     variant: 'outline' },
  COMPLETED:   { labelKey: 'schedView.status.COMPLETED',   variant: 'default' },
  CANCELLED:   { labelKey: 'schedView.status.CANCELLED',   variant: 'destructive' },
};

const DONE_STATUSES: WOStatus[] = ['COMPLETED', 'CANCELLED'];

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function toDateStr(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

function todayStr(): string {
  return toFactoryDayKey(new Date());
}

function isOverdue(wo: WorkOrder): boolean {
  if (DONE_STATUSES.includes(wo.status)) return false;
  const scheduled = toDateStr(wo.scheduledDate);
  if (!scheduled) return false;
  return scheduled < todayStr();
}

function isTodayWO(wo: WorkOrder): boolean {
  return toDateStr(wo.scheduledDate) === todayStr();
}

function isThisWeekWO(wo: WorkOrder): boolean {
  const scheduled = toDateStr(wo.scheduledDate);
  if (!scheduled) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(today.getDate() + 6);
  const d = new Date(scheduled);
  return d >= today && d <= end;
}

function isNext7DaysWO(wo: WorkOrder): boolean {
  const scheduled = toDateStr(wo.scheduledDate);
  if (!scheduled) return false;
  const t = todayStr();
  const end = new Date();
  end.setDate(end.getDate() + 7);
  const endStr = toFactoryDayKey(end);
  return scheduled >= t && scheduled <= endStr && !DONE_STATUSES.includes(wo.status);
}

function durationLabel(minutes: number | null): string {
  if (!minutes) return '—';
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: WOType }) {
  const { t } = useTranslation(['maintenance', 'common']);
  const cfg = TYPE_CONFIG[type];
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium', cfg.color, cfg.bgClass)}>
      {t(`schedView.type.${type}`, { defaultValue: t(cfg.labelKey) })}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: WOPriority }) {
  const { t } = useTranslation(['maintenance', 'common']);
  const cfg = PRIORITY_CONFIG[priority];
  return (
    <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold', cfg.badgeClass)}>
      {t(`common:priority.${priority}`, { defaultValue: t(cfg.labelKey) })}
    </span>
  );
}

// ── KPI Card ──────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label: string;
  value: string | number;
  icon: React.ElementType;
  iconClass?: string;
  badge?: React.ReactNode;
}

function KpiCard({ label, value, icon: Icon, iconClass, badge }: KpiCardProps) {
  return (
    <div className="industrial-card p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1">
          {badge}
          <Icon size={14} className={iconClass ?? 'text-muted-foreground'} />
        </div>
      </div>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function MaintenanceSchedulingView() {
  const { t } = useTranslation(['maintenance', 'common']);
  const today = new Date();

  // State
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [filterTab, setFilterTab] = useState<FilterTab>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [currentMonth, setCurrentMonth] = useState<number>(today.getMonth());
  const [currentYear, setCurrentYear] = useState<number>(today.getFullYear());
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  // Queries
  const { data: woData, isLoading: woLoading } = useQuery<WorkOrdersResponse>({
    queryKey: ['maintenance', 'scheduling', 'work-orders'],
    queryFn: () => api.get('/maintenance/work-orders', { params: { limit: 100 } }) as Promise<WorkOrdersResponse>,
    refetchInterval: 60_000,
  });

  const { data: kpiData, isLoading: kpiLoading } = useQuery<MaintenanceKPIs>({
    queryKey: ['maintenance', 'scheduling', 'kpis'],
    queryFn: () => api.get('/maintenance/kpis') as Promise<MaintenanceKPIs>,
    refetchInterval: 60_000,
  });

  const allWOs: WorkOrder[] = woData?.data ?? [];
  const kpis: MaintenanceKPIs | undefined = kpiData;

  // Compute overdue list (client-side)
  const overdueWOs = useMemo(() => allWOs.filter(isOverdue), [allWOs]);
  const overdueCount = kpis?.overdueWOs ?? overdueWOs.length;

  // Filtered list
  const filteredWOs = useMemo(() => {
    let list = [...allWOs];

    // Tab filter
    if (filterTab === 'TODAY')      list = list.filter(isTodayWO);
    else if (filterTab === 'THIS_WEEK') list = list.filter(isThisWeekWO);
    else if (filterTab === 'OVERDUE')   list = list.filter(isOverdue);
    else if (filterTab === 'PREVENTIVE') list = list.filter(wo => wo.type === 'PREVENTIVE');
    else if (filterTab === 'CORRECTIVE') list = list.filter(wo => wo.type === 'CORRECTIVE');

    // Priority filter
    if (priorityFilter !== 'ALL') list = list.filter(wo => wo.priority === priorityFilter);

    // Status filter
    if (statusFilter !== 'ALL') list = list.filter(wo => wo.status === statusFilter);

    // Sort by scheduledDate ascending, nulls last
    list.sort((a, b) => {
      const da = toDateStr(a.scheduledDate) || '9999';
      const db = toDateStr(b.scheduledDate) || '9999';
      return da.localeCompare(db);
    });

    return list;
  }, [allWOs, filterTab, priorityFilter, statusFilter]);

  // Next 7 days
  const next7WOs = useMemo(() => {
    return allWOs
      .filter(isNext7DaysWO)
      .sort((a, b) => (toDateStr(a.scheduledDate) || '').localeCompare(toDateStr(b.scheduledDate) || ''));
  }, [allWOs]);

  // Calendar helpers
  const calendarWOs = useMemo(() => {
    const map: Record<number, WorkOrder[]> = {};
    allWOs.forEach(wo => {
      const s = toDateStr(wo.scheduledDate);
      if (!s) return;
      const d = new Date(s);
      if (d.getFullYear() === currentYear && d.getMonth() === currentMonth) {
        const day = d.getDate();
        if (!map[day]) map[day] = [];
        map[day].push(wo);
      }
    });
    return map;
  }, [allWOs, currentMonth, currentYear]);

  const firstWeekday = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const monthName = new Date(currentYear, currentMonth, 1).toLocaleString('default', { month: 'long' });

  const handlePrevMonth = () => {
    if (currentMonth === 0) { setCurrentMonth(11); setCurrentYear(y => y - 1); }
    else setCurrentMonth(m => m - 1);
    setSelectedDay(null);
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) { setCurrentMonth(0); setCurrentYear(y => y + 1); }
    else setCurrentMonth(m => m + 1);
    setSelectedDay(null);
  };

  const selectedDayWOs = selectedDay !== null ? (calendarWOs[selectedDay] ?? []) : [];

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0 flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-brand-400" />
          <div>
            <h1 className="text-lg font-bold">{t('headers.scheduling.title')}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{t('headers.scheduling.subtitle')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex items-center rounded-md border border-border/50 overflow-hidden">
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                viewMode === 'list'
                  ? 'bg-brand-500/20 text-brand-400'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
            >
              <Filter size={12} />{t('schedView.list')}
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={cn(
                'px-3 py-1.5 text-xs font-medium flex items-center gap-1.5 transition-colors',
                viewMode === 'calendar'
                  ? 'bg-brand-500/20 text-brand-400'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
              )}
            >
              <Calendar size={12} />{t('schedView.calendar')}
            </button>
          </div>
          <Button size="sm" className="h-8 text-xs gap-1.5" asChild>
            <Link href="/maintenance/work-orders">
              <Wrench size={12} />{t('schedView.newWorkOrder')}
            </Link>
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* ── KPI Strip ────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard
            label={t('schedView.kpiOpenWOs')}
            value={kpiLoading ? '—' : (kpis?.openWOs ?? 0)}
            icon={Wrench}
            iconClass="text-brand-400"
          />
          <KpiCard
            label={t('schedView.kpiOverdue')}
            value={kpiLoading ? '—' : overdueCount}
            icon={AlertTriangle}
            iconClass={overdueCount > 0 ? 'text-red-400' : 'text-muted-foreground'}
            badge={
              overdueCount > 0
                ? <span className="inline-flex items-center justify-center rounded-full bg-red-500 text-white text-[9px] font-bold w-4 h-4">{overdueCount}</span>
                : undefined
            }
          />
          <KpiCard
            label={t('schedView.kpiMttr')}
            value={kpiLoading ? '—' : kpis?.mttr != null ? Number(kpis.mttr).toFixed(1) : '—'}
            icon={Clock}
            iconClass="text-amber-400"
          />
          <KpiCard
            label={t('schedView.kpiMtbf')}
            value={kpiLoading ? '—' : kpis?.mtbf != null ? Number(kpis.mtbf).toFixed(1) : '—'}
            icon={CheckCircle2}
            iconClass="text-green-400"
          />
          <KpiCard
            label={t('schedView.kpiPmCompliance')}
            value={kpiLoading ? '—' : kpis?.pmCompliance != null ? `${Number(kpis.pmCompliance).toFixed(1)}%` : '—'}
            icon={Calendar}
            iconClass="text-purple-400"
          />
        </div>

        {/* ── Overdue Alert ─────────────────────────────────────── */}
        {overdueCount > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3"
          >
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle size={14} className="text-red-400 shrink-0" />
              <span className="text-sm font-semibold text-red-400">{t('schedView.overdueCount', { count: overdueCount })}</span>
            </div>
            <div className="space-y-1.5">
              {overdueWOs.slice(0, 5).map(wo => (
                <div key={wo.id} className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-semibold text-red-300">{wo.woNumber}</span>
                  <span className="text-muted-foreground truncate flex-1">{wo.title}</span>
                  <span className="text-red-400 shrink-0">{wo.machine?.name ?? '—'}</span>
                  <span className="text-muted-foreground shrink-0">{formatDate(wo.scheduledDate)}</span>
                </div>
              ))}
              {overdueWOs.length > 5 && (
                <p className="text-xs text-red-400/70 mt-1">{t('schedView.moreOverdue', { count: overdueWOs.length - 5 })}</p>
              )}
            </div>
          </motion.div>
        )}

        {/* ── List View ─────────────────────────────────────────── */}
        {viewMode === 'list' && (
          <motion.div
            key="list"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            {/* Filter tabs */}
            <div className="flex items-center gap-1 flex-wrap">
              {(
                [
                  { key: 'ALL',        labelKey: 'schedView.tabs.all' },
                  { key: 'TODAY',      labelKey: 'schedView.tabs.today' },
                  { key: 'THIS_WEEK',  labelKey: 'schedView.tabs.thisWeek' },
                  { key: 'OVERDUE',    labelKey: 'schedView.tabs.overdue' },
                  { key: 'PREVENTIVE', labelKey: 'schedView.tabs.preventive' },
                  { key: 'CORRECTIVE', labelKey: 'schedView.tabs.corrective' },
                ] as { key: FilterTab; labelKey: string }[]
              ).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setFilterTab(tab.key)}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded-md font-medium transition-colors',
                    filterTab === tab.key
                      ? 'bg-brand-500/20 text-brand-400 border border-brand-400/30'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent'
                  )}
                >
                  {t(tab.labelKey)}
                </button>
              ))}

              {/* Priority & Status selects */}
              <div className="ml-auto flex items-center gap-2">
                <SelectMenu
                  value={priorityFilter}
                  onValueChange={setPriorityFilter}
                  menuLabel={t('schedView.priorityMenu')}
                  options={[
                    { value: 'ALL', label: t('schedView.allPriority') },
                    { value: 'CRITICAL', label: t('schedView.priority.CRITICAL') },
                    { value: 'HIGH', label: t('schedView.priority.HIGH') },
                    { value: 'MEDIUM', label: t('schedView.priority.MEDIUM') },
                    { value: 'LOW', label: t('schedView.priority.LOW') },
                  ]}
                />
                <SelectMenu
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                  menuLabel={t('schedView.statusMenu')}
                  options={[
                    { value: 'ALL', label: t('schedView.allStatus') },
                    { value: 'PLANNED', label: t('schedView.status.PLANNED') },
                    { value: 'ASSIGNED', label: t('schedView.status.ASSIGNED') },
                    { value: 'IN_PROGRESS', label: t('schedView.status.IN_PROGRESS') },
                    { value: 'ON_HOLD', label: t('schedView.status.ON_HOLD') },
                    { value: 'COMPLETED', label: t('schedView.status.COMPLETED') },
                    { value: 'CANCELLED', label: t('schedView.status.CANCELLED') },
                  ]}
                />
              </div>
            </div>

            {/* Table */}
            <div className="industrial-card rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30 bg-muted/30">
                      {[
                        t('schedView.col.wo'), t('schedView.col.title'), t('schedView.col.type'), t('schedView.col.priority'), t('schedView.col.machine'),
                        t('schedView.col.assignedTo'), t('schedView.col.scheduled'), t('schedView.col.dueDate'), t('schedView.col.status'), t('schedView.col.duration'), t('schedView.col.actions'),
                      ].map((h, i) => (
                        <th key={i} className="text-left px-3 py-2.5 text-[11px] font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {woLoading
                      ? Array.from({ length: 8 }).map((_, i) => (
                          <tr key={i} className="border-b border-border/20">
                            {Array.from({ length: 11 }).map((_, j) => (
                              <td key={j} className="px-3 py-2.5">
                                <div className="shimmer h-3.5 rounded w-16" />
                              </td>
                            ))}
                          </tr>
                        ))
                      : filteredWOs.length === 0
                        ? (
                          <tr>
                            <td colSpan={11} className="px-3 py-10 text-center text-muted-foreground">
                              {t('schedView.noWOsForFilter')}
                            </td>
                          </tr>
                        )
                        : filteredWOs.map(wo => {
                            const overdue = isOverdue(wo);
                            const todayRow = isTodayWO(wo);
                            return (
                              <tr
                                key={wo.id}
                                className={cn(
                                  'border-b border-border/20 hover:bg-muted/20 transition-colors',
                                  overdue && 'bg-red-500/5',
                                  !overdue && todayRow && 'bg-yellow-500/5'
                                )}
                              >
                                <td className="px-3 py-2.5 font-mono font-semibold text-primary whitespace-nowrap">
                                  {wo.woNumber}
                                </td>
                                <td className="px-3 py-2.5 max-w-[180px]">
                                  <div className="font-medium truncate">{wo.title}</div>
                                  {overdue && (
                                    <span className="text-[10px] text-red-400 flex items-center gap-0.5">
                                      <AlertTriangle size={9} />{t('schedView.overdueTag')}
                                    </span>
                                  )}
                                  {todayRow && !overdue && (
                                    <span className="text-[10px] text-yellow-400">{t('schedView.todayTag')}</span>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <TypeBadge type={wo.type} />
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <PriorityBadge priority={wo.priority} />
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <div className="font-medium">{wo.machine?.name ?? '—'}</div>
                                  {wo.machine?.code && (
                                    <div className="text-[10px] text-muted-foreground font-mono">{wo.machine.code}</div>
                                  )}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  {wo.assignedTo
                                    ? <span>{wo.assignedTo.firstName} {wo.assignedTo.lastName}</span>
                                    : <span className="text-muted-foreground">{t('schedView.unassigned')}</span>
                                  }
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                                  {formatDate(wo.scheduledDate)}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                                  {formatDate(wo.dueDate)}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <Badge variant={STATUS_CONFIG[wo.status]?.variant ?? 'outline'} className="text-[10px] h-5">
                                    {t(`schedView.status.${wo.status}`, { defaultValue: wo.status })}
                                  </Badge>
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap text-muted-foreground">
                                  {durationLabel(wo.estimatedDuration)}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2" asChild>
                                    <Link href="/maintenance/work-orders">{t('schedView.view')}</Link>
                                  </Button>
                                </td>
                              </tr>
                            );
                          })
                    }
                  </tbody>
                </table>
              </div>
              {!woLoading && filteredWOs.length > 0 && (
                <div className="px-3 py-2 border-t border-border/20 text-[11px] text-muted-foreground">
                  {t('schedView.woCount', { count: filteredWOs.length })}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ── Calendar View ─────────────────────────────────────── */}
        {viewMode === 'calendar' && (
          <motion.div
            key="calendar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-4"
          >
            <div className="industrial-card rounded-lg p-4">
              {/* Month navigation */}
              <div className="flex items-center justify-between mb-4">
                <button
                  onClick={handlePrevMonth}
                  className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft size={16} />
                </button>
                <h2 className="text-sm font-semibold">
                  {monthName} {currentYear}
                </h2>
                <button
                  onClick={handleNextMonth}
                  className="p-1.5 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight size={16} />
                </button>
              </div>

              {/* Weekday headers */}
              <div className="grid grid-cols-7 gap-1 mb-1">
                {WEEKDAY_KEYS.map(d => (
                  <div key={d} className="text-center text-[11px] font-semibold text-muted-foreground py-1">
                    {t(`schedView.weekdays.${d}`)}
                  </div>
                ))}
              </div>

              {/* Calendar grid */}
              <div className="grid grid-cols-7 gap-1">
                {/* Empty cells for first weekday offset */}
                {Array.from({ length: firstWeekday }).map((_, i) => (
                  <div key={`empty-${i}`} className="h-20" />
                ))}

                {/* Day cells */}
                {Array.from({ length: daysInMonth }).map((_, idx) => {
                  const day = idx + 1;
                  const dayWOs = calendarWOs[day] ?? [];
                  const isToday =
                    day === today.getDate() &&
                    currentMonth === today.getMonth() &&
                    currentYear === today.getFullYear();
                  const isSelected = selectedDay === day;

                  return (
                    <button
                      key={day}
                      onClick={() => setSelectedDay(isSelected ? null : day)}
                      className={cn(
                        'h-20 rounded-md border p-1 text-left flex flex-col transition-colors overflow-hidden',
                        isSelected
                          ? 'border-brand-400/60 bg-brand-500/10'
                          : 'border-border/30 hover:border-border/60 hover:bg-muted/20',
                        isToday && !isSelected && 'border-brand-400/40 bg-brand-500/5'
                      )}
                    >
                      <span className={cn(
                        'text-[11px] font-semibold mb-0.5 leading-none',
                        isToday ? 'text-brand-400' : 'text-foreground'
                      )}>
                        {day}
                      </span>
                      <div className="flex flex-col gap-0.5 overflow-hidden flex-1">
                        {dayWOs.slice(0, 3).map(wo => (
                          <div
                            key={wo.id}
                            className={cn(
                              'rounded-sm px-1 py-0.5 text-[9px] font-medium truncate text-white leading-none',
                              TYPE_CONFIG[wo.type]?.chipClass ?? 'bg-gray-500'
                            )}
                          >
                            {wo.woNumber}
                          </div>
                        ))}
                        {dayWOs.length > 3 && (
                          <span className="text-[9px] text-muted-foreground px-1">{t('schedView.moreItems', { count: dayWOs.length - 3 })}</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected day panel */}
            {selectedDay !== null && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="industrial-card rounded-lg p-4"
              >
                <h3 className="text-sm font-semibold mb-3">
                  {t('schedView.selectedDayTitle', { month: monthName, day: selectedDay, year: currentYear })}
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    {t('schedView.selectedDayWOs', { count: selectedDayWOs.length })}
                  </span>
                </h3>
                {selectedDayWOs.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">{t('schedView.noWOsForDay')}</p>
                ) : (
                  <div className="space-y-2">
                    {selectedDayWOs.map(wo => (
                      <div
                        key={wo.id}
                        className="flex items-start gap-3 rounded-lg border border-border/30 bg-muted/20 px-3 py-2.5"
                      >
                        <div className={cn('w-1 self-stretch rounded-full shrink-0 mt-0.5', TYPE_CONFIG[wo.type]?.chipClass ?? 'bg-gray-500')} />
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-xs font-semibold text-primary">{wo.woNumber}</span>
                            <TypeBadge type={wo.type} />
                            <PriorityBadge priority={wo.priority} />
                            <Badge variant={STATUS_CONFIG[wo.status]?.variant ?? 'outline'} className="text-[10px] h-5">
                              {t(`schedView.status.${wo.status}`, { defaultValue: wo.status })}
                            </Badge>
                          </div>
                          <div className="text-xs font-medium truncate">{wo.title}</div>
                          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                            <span>{wo.machine?.name ?? '—'}</span>
                            {wo.assignedTo && (
                              <span>{wo.assignedTo.firstName} {wo.assignedTo.lastName}</span>
                            )}
                            {wo.estimatedDuration && (
                              <span className="flex items-center gap-0.5">
                                <Clock size={9} />{durationLabel(wo.estimatedDuration)}
                              </span>
                            )}
                          </div>
                        </div>
                        <Button variant="outline" size="sm" className="h-6 text-[10px] px-2 shrink-0" asChild>
                          <Link href="/maintenance/work-orders">{t('schedView.view')}</Link>
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </motion.div>
        )}

        {/* ── Next 7 Days ───────────────────────────────────────── */}
        {next7WOs.length > 0 && (
          <div className="industrial-card rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <Calendar size={14} className="text-brand-400" />
              <h3 className="text-sm font-semibold">{t('schedView.next7Days')}</h3>
              <span className="text-xs text-muted-foreground">{t('schedView.next7Count', { count: next7WOs.length })}</span>
            </div>
            <div className="space-y-1.5">
              {next7WOs.map(wo => (
                <div
                  key={wo.id}
                  className="flex items-center gap-3 rounded-md px-3 py-2 border border-border/20 hover:bg-muted/20 transition-colors"
                >
                  <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', TYPE_CONFIG[wo.type]?.chipClass ?? 'bg-gray-500')} />
                  <span className="font-mono text-xs font-semibold text-primary w-24 shrink-0">{wo.woNumber}</span>
                  <span className="text-xs text-muted-foreground w-24 shrink-0">{formatDate(wo.scheduledDate)}</span>
                  <span className="text-xs font-medium flex-1 truncate">{wo.title}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{wo.machine?.name ?? '—'}</span>
                  <TypeBadge type={wo.type} />
                  <PriorityBadge priority={wo.priority} />
                  <Badge variant={STATUS_CONFIG[wo.status]?.variant ?? 'outline'} className="text-[10px] h-5 shrink-0">
                    {t(`schedView.status.${wo.status}`, { defaultValue: wo.status })}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
