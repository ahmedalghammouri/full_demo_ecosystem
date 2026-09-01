'use client';
import { useTranslation, Trans } from 'react-i18next';

import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Search, X, Edit2, Trash2, CheckCircle2, RefreshCw,
  ClipboardList, ShieldCheck, Package, Settings, Cpu,
  AlertTriangle, MoreHorizontal, ChevronDown, ChevronUp,
  Target, TrendingUp, FlaskConical, Star, Copy,
  BarChart3, Eye, EyeOff, ToggleLeft, Archive as ArchiveIcon, RotateCcw,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Attachments } from '@/components/ui/attachments';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { ArchiveFilter, type ArchiveScope } from '@/components/ui/archive-filter';
import { useArchive } from '@/hooks/use-archive';
import { useRowSelection } from '@/hooks/use-row-selection';
import { BulkActionsBar } from '@/components/ui/bulk-actions-bar';

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const PLAN_TYPE_CFG = {
  INCOMING:   { label: 'Incoming',   cls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',   icon: Package,      desc: 'Inspect materials on receipt' },
  IN_PROCESS: { label: 'In-Process', cls: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: Settings, desc: 'Inspect during manufacturing' },
  FINAL:      { label: 'Final',      cls: 'bg-green-500/10 text-green-400 border-green-500/20',  icon: ShieldCheck,  desc: 'Final inspection before dispatch' },
} as const;

const FREQ_OPTIONS = ['EVERY_BATCH', 'HOURLY', 'SHIFT', 'DAILY', 'WEEKLY'];
const FREQ_LABELS: Record<string, string> = {
  EVERY_BATCH: 'Every Batch', HOURLY: 'Hourly', SHIFT: 'Per Shift', DAILY: 'Daily', WEEKLY: 'Weekly',
};

/* ------------------------------------------------------------------ */
/*  Interfaces                                                          */
/* ------------------------------------------------------------------ */

interface QualityParameter {
  id: string;
  name: string;
  unit?: string | null;
  nominalValue?: number | null;
  ucl?: number | null;
  lcl?: number | null;
  usl?: number | null;
  lsl?: number | null;
  checkMethod?: string | null;
  isKPI: boolean;
  sortOrder: number;
}

interface QualityPlan {
  id: string;
  code: string;
  name: string;
  type: string;
  skuId?: string | null;
  machineId?: string | null;
  samplingFrequency?: string | null;
  samplingQty: number;
  version: string;
  isActive: boolean;
  approvedAt?: string | null;
  parameters: QualityParameter[];
  _count?: { results: number };
}

const EMPTY_PLAN = { code: '', name: '', type: 'IN_PROCESS', skuId: '', machineId: '', samplingFrequency: '', samplingQty: '1', version: '1' };
const EMPTY_PARAM = { name: '', unit: '', nominalValue: '', ucl: '', lcl: '', usl: '', lsl: '', checkMethod: '', isKPI: false };

/* ------------------------------------------------------------------ */
/*  Main view                                                           */
/* ------------------------------------------------------------------ */

export function QualityPlansView() {
  const { t } = useTranslation(['quality', 'common']);
  const queryClient = useQueryClient();
  const { filter, key: scopeKey } = useScope();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [archived, setArchived] = useState<ArchiveScope>('active');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [editPlan, setEditPlan] = useState<QualityPlan | null>(null);
  const [planForm, setPlanForm] = useState({ ...EMPTY_PLAN });
  const [deleteTarget, setDeleteTarget] = useState<QualityPlan | null>(null);

  const { archive: archivePlan, restore: restorePlan, bulkArchive, bulkRestore } = useArchive('quality-plans', [['quality-plans']], 'Quality plan');

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['quality-plans', typeFilter, showInactive, archived, scopeKey],
    queryFn: () => api.get('/quality/plans', {
      params: {
        isActive: showInactive ? 'false' : 'true',
        ...(typeFilter ? { type: typeFilter } : {}),
        ...(archived !== 'active' ? { archived } : {}),
        ...filter, // scope: machineId / areaId / lineId
        limit: 200,
      },
    }),
  });

  const plans: QualityPlan[] = Array.isArray(data) ? data : [];

  const filtered = plans.filter(p =>
    !search ||
    p.code.toLowerCase().includes(search.toLowerCase()) ||
    p.name.toLowerCase().includes(search.toLowerCase()),
  );
  const sel = useRowSelection(filtered);

  const createMutation = useMutation({
    mutationFn: (dto: any) => api.post('/quality/plans', dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-plans'] });
      setPlanFormOpen(false); setPlanForm({ ...EMPTY_PLAN });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, dto }: { id: string; dto: any }) => api.patch(`/quality/plans/${id}`, dto),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-plans'] });
      queryClient.invalidateQueries({ queryKey: ['quality-plan', selectedId] });
      setEditPlan(null); setPlanFormOpen(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/quality/plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-plans'] });
      setDeleteTarget(null);
      if (selectedId === deleteTarget?.id) setSelectedId(null);
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/quality/plans/${id}/approve`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-plans'] });
      queryClient.invalidateQueries({ queryKey: ['quality-plan', selectedId] });
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/quality/plans/${id}`, { isActive: false }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quality-plans'] });
      queryClient.invalidateQueries({ queryKey: ['quality-plan', selectedId] });
    },
  });

  const handleSavePlan = () => {
    if (!planForm.code || !planForm.name || !planForm.type) return;
    const dto = {
      code: planForm.code.toUpperCase(),
      name: planForm.name,
      type: planForm.type,
      skuId: planForm.skuId || undefined,
      machineId: planForm.machineId || undefined,
      samplingFrequency: planForm.samplingFrequency || undefined,
      samplingQty: parseInt(planForm.samplingQty) || 1,
      version: planForm.version || '1',
    };
    if (editPlan) {
      updateMutation.mutate({ id: editPlan.id, dto });
    } else {
      createMutation.mutate(dto);
    }
  };

  const openEditPlan = (plan: QualityPlan) => {
    setEditPlan(plan);
    setPlanForm({
      code: plan.code, name: plan.name, type: plan.type,
      skuId: plan.skuId ?? '', machineId: plan.machineId ?? '',
      samplingFrequency: plan.samplingFrequency ?? '',
      samplingQty: plan.samplingQty.toString(),
      version: plan.version,
    });
    setPlanFormOpen(true);
  };

  // Stats
  const total = plans.length;
  const approved = plans.filter(p => p.approvedAt).length;
  const byType = Object.keys(PLAN_TYPE_CFG).reduce((acc, t) => ({ ...acc, [t]: plans.filter(p => p.type === t).length }), {} as Record<string, number>);

  return (
    <div className="flex flex-col gap-5 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">{t('headers.plans.title')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('headers.plans.subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw size={13} className="mr-1.5" /> {t('common.refresh')}
          </Button>
          <Button size="sm" onClick={() => { setEditPlan(null); setPlanForm({ ...EMPTY_PLAN }); setPlanFormOpen(true); }}>
            <Plus size={14} className="mr-1.5" /> {t('plansView.newPlan')}
          </Button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KPICard icon={ClipboardList} label={t('plansView.totalPlans')} value={total} />
        <KPICard icon={CheckCircle2} label={t('plansView.approved')} value={approved} valueClass="text-green-400" />
        <KPICard icon={AlertTriangle} label={t('plansView.draftPending')} value={total - approved} valueClass={total - approved > 0 ? 'text-amber-400' : undefined} />
        {Object.entries(byType).map(([k, c]) => {
          const cfg = PLAN_TYPE_CFG[k as keyof typeof PLAN_TYPE_CFG];
          return <KPICard key={k} icon={cfg.icon} label={t(`plansView.type.${k}`)} value={c} valueClass={cfg.cls.split(' ').find(s => s.startsWith('text-'))} />;
        })}
      </div>

      <InlineFormSlot />

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search size={13} className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder={t('plans.search')} value={search} onChange={e => setSearch(e.target.value)} className="ps-8 h-8 text-sm" />
        </div>
        <Select value={typeFilter || '_all'} onValueChange={v => setTypeFilter(v === '_all' ? '' : v)}>
          <SelectTrigger className="h-8 w-44 text-sm">
            <SelectValue placeholder={t('plans.allTypes')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all">{t('plans.allTypes')}</SelectItem>
            {Object.keys(PLAN_TYPE_CFG).map((k) => (
              <SelectItem key={k} value={k}>{t(`plansView.type.${k}`)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant={showInactive ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setShowInactive(s => !s)}
          className="h-8 text-xs"
        >
          {showInactive ? <Eye size={12} className="mr-1.5" /> : <EyeOff size={12} className="mr-1.5" />}
          {showInactive ? t('plansView.showingInactive') : t('plansView.activeOnly')}
        </Button>
        <ArchiveFilter value={archived} onChange={setArchived} />
      </div>

      {/* Plans grid */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground p-10 text-center">{t('plans.loading')}</div>
      ) : filtered.length === 0 ? (
        <div className="border rounded-xl p-16 text-center text-sm text-muted-foreground">
          <ClipboardList size={36} className="mx-auto mb-3 opacity-20" />
          <p className="font-medium">{t('plans.noPlans')}</p>
          <p className="text-xs mt-1">{t('plans.createHint')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              isSelected={selectedId === plan.id}
              onView={() => setSelectedId(plan.id === selectedId ? null : plan.id)}
              onEdit={() => openEditPlan(plan)}
              onDelete={() => setDeleteTarget(plan)}
              onApprove={() => approveMutation.mutate(plan.id)}
              onDeactivate={() => deactivateMutation.mutate(plan.id)}
              onArchive={() => archivePlan.mutate(plan.id)}
              onRestore={() => restorePlan.mutate(plan.id)}
              selected={sel.isSelected(plan.id)}
              onToggle={() => sel.toggle(plan.id)}
            />
          ))}
        </div>
      )}

      {/* Plan Detail Sheet */}
      <PlanDetailSheet
        planId={selectedId}
        onClose={() => setSelectedId(null)}
        onEdit={(plan) => { openEditPlan(plan); }}
      />

      {/* Create / Edit Plan — inline form */}
      <InlineFormPanel
        open={planFormOpen}
        onClose={() => { setPlanFormOpen(false); setEditPlan(null); }}
        icon={ClipboardList}
        title={editPlan ? t('pform.editTitle') : t('pform.createTitle')}
        description={t('pform.description')}
        footer={(
          <>
            <Button variant="outline" size="sm" onClick={() => { setPlanFormOpen(false); setEditPlan(null); }}>{t('pform.cancel')}</Button>
            <Button
              size="sm"
              disabled={!planForm.code || !planForm.name || !planForm.type || createMutation.isPending || updateMutation.isPending}
              onClick={handleSavePlan}
            >
              {createMutation.isPending || updateMutation.isPending ? t('pform.saving') : editPlan ? t('pform.saveChanges') : t('pform.createPlan')}
            </Button>
          </>
        )}
      >
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('pform.planCode')} *</Label>
                    <Input
                      value={planForm.code}
                      onChange={e => setPlanForm(p => ({ ...p, code: e.target.value.toUpperCase() }))}
                      placeholder="QP-INSP-001"
                      className="h-8 text-sm font-mono"
                      disabled={!!editPlan}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('pform.checkType')} *</Label>
                    <Select value={planForm.type} onValueChange={v => setPlanForm(p => ({ ...p, type: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.keys(PLAN_TYPE_CFG).map((k) => (
                          <SelectItem key={k} value={k}>{t(`plansView.type.${k}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('pform.planName')} *</Label>
                  <Input value={planForm.name} onChange={e => setPlanForm(p => ({ ...p, name: e.target.value }))} placeholder={t('pform.namePlaceholder')} className="h-8 text-sm" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('pform.samplingFrequency')}</Label>
                    <Select value={planForm.samplingFrequency || '_none'} onValueChange={v => setPlanForm(p => ({ ...p, samplingFrequency: v === '_none' ? '' : v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue placeholder={t('pform.selectPlaceholder')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="_none">{t('pform.notSet')}</SelectItem>
                        {FREQ_OPTIONS.map(f => <SelectItem key={f} value={f}>{t(`plans.freq.${f}`, { defaultValue: FREQ_LABELS[f] })}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label>{t('pform.sampleQty')}</Label>
                    <Input type="number" min="1" value={planForm.samplingQty} onChange={e => setPlanForm(p => ({ ...p, samplingQty: e.target.value }))} className="h-8 text-sm" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('pform.version')}</Label>
                  <Input value={planForm.version} onChange={e => setPlanForm(p => ({ ...p, version: e.target.value }))} placeholder="1.0" className="h-8 text-sm w-32" />
                </div>
                {PLAN_TYPE_CFG[planForm.type as keyof typeof PLAN_TYPE_CFG] && (
                  <div className={cn('flex items-start gap-2 p-3 rounded-lg border text-xs', PLAN_TYPE_CFG[planForm.type as keyof typeof PLAN_TYPE_CFG].cls)}>
                    <AlertTriangle size={12} className="mt-0.5 shrink-0" />
                    {t(`plansView.typeDesc.${planForm.type}`)}
                  </div>
                )}
              </div>
      </InlineFormPanel>

      {/* Delete confirm */}
      <AnimatePresence>
        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
              className="bg-background border rounded-xl shadow-2xl w-full max-w-sm p-6"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-full bg-destructive/10 border border-destructive/20 flex items-center justify-center">
                  <Trash2 size={16} className="text-destructive" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{t('plansView.deletePlanTitle')}</h3>
                  <p className="text-xs text-muted-foreground">{deleteTarget.code} — {deleteTarget.name}</p>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mb-2">
                {t('plansView.deletePlanDescription')}
              </p>
              {(deleteTarget._count?.results ?? 0) > 0 && (
                <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs mb-3">
                  <AlertTriangle size={12} />
                  {t('plansView.hasRecordsWarning', { count: deleteTarget._count!.results })}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
                <Button
                  size="sm" variant="destructive"
                  disabled={deleteMutation.isPending || (deleteTarget._count?.results ?? 0) > 0}
                  onClick={() => deleteMutation.mutate(deleteTarget.id)}
                >
                  {deleteMutation.isPending ? t('common.deleting') : t('common.delete')}
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <BulkActionsBar
        count={sel.count}
        onClear={sel.clear}
        actions={archived === 'archived'
          ? [{ label: t('common.restore'), icon: RotateCcw, onClick: () => { bulkRestore.mutate(sel.selectedIds); sel.clear(); } }]
          : [{ label: t('common.archive'), icon: ArchiveIcon, onClick: () => { bulkArchive.mutate(sel.selectedIds); sel.clear(); } }]}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  KPI Card                                                            */
/* ------------------------------------------------------------------ */

function KPICard({ icon: Icon, label, value, valueClass }: { icon: React.ElementType; label: string; value: number; valueClass?: string }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-xl border bg-card">
      <Icon size={16} className="text-muted-foreground shrink-0" />
      <div>
        <div className={cn('text-lg font-bold leading-none', valueClass ?? 'text-foreground')}>{value}</div>
        <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Plan Card                                                           */
/* ------------------------------------------------------------------ */

function PlanCard({ plan, isSelected, onView, onEdit, onDelete, onApprove, onDeactivate, onArchive, onRestore, selected, onToggle }: {
  plan: QualityPlan; isSelected: boolean;
  onView: () => void; onEdit: () => void; onDelete: () => void;
  onApprove: () => void; onDeactivate: () => void;
  onArchive: () => void; onRestore: () => void; selected: boolean; onToggle: () => void;
}) {
  const { t } = useTranslation('quality');
  const [menuOpen, setMenuOpen] = useState(false);
  const cfg = PLAN_TYPE_CFG[plan.type as keyof typeof PLAN_TYPE_CFG] ?? PLAN_TYPE_CFG.IN_PROCESS;
  const TypeIcon = cfg.icon;

  return (
    <div
      className={cn(
        'relative border rounded-xl p-4 bg-card transition-all cursor-pointer group',
        'hover:shadow-md hover:border-foreground/20',
        isSelected && 'border-primary/60 bg-primary/5 shadow-md',
        selected && 'ring-1 ring-primary/50',
        !plan.isActive && 'opacity-50',
      )}
      onClick={onView}
    >
      <div className="absolute top-3 left-3 z-10" onClick={(e) => e.stopPropagation()}>
        <Checkbox checked={selected} onCheckedChange={onToggle} aria-label={t('plansView.selectPlan')} />
      </div>
      {/* Type badge */}
      <div className="flex items-center justify-between mb-3 pl-7">
        <span className={cn('inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border', cfg.cls)}>
          <TypeIcon size={9} />
          {t(`plansView.type.${plan.type}`, { defaultValue: cfg.label })}
        </span>
        <div className="relative" onClick={e => e.stopPropagation()}>
          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={() => setMenuOpen(o => !o)}>
            <MoreHorizontal size={12} />
          </Button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95 }}
                className="absolute right-0 top-7 z-30 bg-background border rounded-lg shadow-xl w-44 py-1 text-sm"
                onMouseLeave={() => setMenuOpen(false)}
              >
                <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left" onClick={() => { onView(); setMenuOpen(false); }}>
                  <Eye size={12} /> {t('plansView.viewEditPoints')}
                </button>
                <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left" onClick={() => { onEdit(); setMenuOpen(false); }}>
                  <Edit2 size={12} /> {t('plansView.editPlan')}
                </button>
                {!plan.approvedAt && (
                  <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left text-green-400" onClick={() => { onApprove(); setMenuOpen(false); }}>
                    <CheckCircle2 size={12} /> {t('plansView.approvePlan')}
                  </button>
                )}
                {plan.isActive && (
                  <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left text-amber-400" onClick={() => { onDeactivate(); setMenuOpen(false); }}>
                    <ToggleLeft size={12} /> {t('plansView.deactivate')}
                  </button>
                )}
                <div className="border-t my-1" />
                {(plan as any).archivedAt ? (
                  <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left" onClick={() => { onRestore(); setMenuOpen(false); }}>
                    <RotateCcw size={12} /> {t('common.restore')}
                  </button>
                ) : (
                  <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left" onClick={() => { onArchive(); setMenuOpen(false); }}>
                    <ArchiveIcon size={12} /> {t('common.archive')}
                  </button>
                )}
                <button className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-muted text-left text-destructive" onClick={() => { onDelete(); setMenuOpen(false); }}>
                  <Trash2 size={12} /> {t('common.delete')}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Code + Name */}
      <div className="mb-3">
        <div className="font-mono text-sm font-bold leading-tight">{plan.code}</div>
        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{plan.name}</div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Target size={10} />
          <span className="font-medium text-foreground">{plan.parameters.length}</span> {t('plansView.points')}
        </span>
        {plan.samplingFrequency && (
          <span className="flex items-center gap-1">
            <BarChart3 size={10} />
            {t(`plans.freq.${plan.samplingFrequency}`, { defaultValue: plan.samplingFrequency })}
          </span>
        )}
        <span className="ml-auto text-[10px]">v{plan.version}</span>
      </div>

      {/* KPI count */}
      {plan.parameters.filter(p => p.isKPI).length > 0 && (
        <div className="flex items-center gap-1 mt-2 text-[10px] text-amber-400">
          <Star size={9} fill="currentColor" />
          {t('plansView.kpiParamCount', { count: plan.parameters.filter(p => p.isKPI).length })}
        </div>
      )}

      {/* Approval status */}
      <div className="mt-3 pt-2.5 border-t flex items-center justify-between">
        {plan.approvedAt ? (
          <span className="flex items-center gap-1 text-[10px] text-green-400">
            <CheckCircle2 size={9} /> {t('plansView.approvedStatus')}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-[10px] text-amber-400">
            <AlertTriangle size={9} /> {t('plansView.pendingApproval')}
          </span>
        )}
        {(plan._count?.results ?? 0) > 0 && (
          <span className="text-[10px] text-muted-foreground">{t('plansView.inspectionsCount', { count: plan._count!.results })}</span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Plan Detail Sheet                                                   */
/* ------------------------------------------------------------------ */

function PlanDetailSheet({ planId, onClose, onEdit }: {
  planId: string | null;
  onClose: () => void;
  onEdit: (plan: QualityPlan) => void;
}) {
  const { t } = useTranslation('quality');
  const queryClient = useQueryClient();
  const [addingParam, setAddingParam] = useState(false);
  const [editParam, setEditParam] = useState<QualityParameter | null>(null);
  const [paramForm, setParamForm] = useState({ ...EMPTY_PARAM });
  const [deleteParam, setDeleteParam] = useState<QualityParameter | null>(null);

  const { data: plan, isLoading } = useQuery<QualityPlan>({
    queryKey: ['quality-plan', planId],
    queryFn: () => api.get(`/quality/plans/${planId}`),
    enabled: !!planId,
    staleTime: 10_000,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['quality-plan', planId] });
    queryClient.invalidateQueries({ queryKey: ['quality-plans'] });
  };

  const addParamMutation = useMutation({
    mutationFn: (dto: any) => api.post(`/quality/plans/${planId}/parameters`, dto),
    onSuccess: () => { invalidate(); setAddingParam(false); setParamForm({ ...EMPTY_PARAM }); },
  });

  const updateParamMutation = useMutation({
    mutationFn: ({ paramId, dto }: { paramId: string; dto: any }) =>
      api.patch(`/quality/plans/${planId}/parameters/${paramId}`, dto),
    onSuccess: () => { invalidate(); setEditParam(null); setParamForm({ ...EMPTY_PARAM }); },
  });

  const deleteParamMutation = useMutation({
    mutationFn: (paramId: string) => api.delete(`/quality/plans/${planId}/parameters/${paramId}`),
    onSuccess: () => { invalidate(); setDeleteParam(null); },
  });

  const approveMutation = useMutation({
    mutationFn: () => api.patch(`/quality/plans/${planId}/approve`, {}),
    onSuccess: invalidate,
  });

  const handleSaveParam = () => {
    if (!paramForm.name) return;
    const dto = {
      name: paramForm.name,
      unit: paramForm.unit || undefined,
      nominalValue: paramForm.nominalValue ? parseFloat(paramForm.nominalValue) : undefined,
      ucl: paramForm.ucl ? parseFloat(paramForm.ucl) : undefined,
      lcl: paramForm.lcl ? parseFloat(paramForm.lcl) : undefined,
      usl: paramForm.usl ? parseFloat(paramForm.usl) : undefined,
      lsl: paramForm.lsl ? parseFloat(paramForm.lsl) : undefined,
      checkMethod: paramForm.checkMethod || undefined,
      isKPI: paramForm.isKPI,
    };
    if (editParam) {
      updateParamMutation.mutate({ paramId: editParam.id, dto });
    } else {
      addParamMutation.mutate(dto);
    }
  };

  const openEditParam = (param: QualityParameter) => {
    setEditParam(param);
    setParamForm({
      name: param.name,
      unit: param.unit ?? '',
      nominalValue: param.nominalValue?.toString() ?? '',
      ucl: param.ucl?.toString() ?? '',
      lcl: param.lcl?.toString() ?? '',
      usl: param.usl?.toString() ?? '',
      lsl: param.lsl?.toString() ?? '',
      checkMethod: param.checkMethod ?? '',
      isKPI: param.isKPI,
    });
    setAddingParam(true);
  };

  const cfg = plan ? (PLAN_TYPE_CFG[plan.type as keyof typeof PLAN_TYPE_CFG] ?? PLAN_TYPE_CFG.IN_PROCESS) : PLAN_TYPE_CFG.IN_PROCESS;

  return (
    <Sheet open={!!planId} onOpenChange={open => { if (!open) { onClose(); setAddingParam(false); setEditParam(null); } }}>
      <SheetContent side="right" className="w-full sm:max-w-3xl p-0 flex flex-col">
        {/* Header */}
        <SheetHeader className="p-5 border-b shrink-0">
          {isLoading || !plan ? (
            <SheetTitle className="text-sm">{t('common.loading')}</SheetTitle>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center border', cfg.cls.replace('text-', 'text-').replace('bg-', 'bg-'))}>
                  <cfg.icon size={18} className={cfg.cls.split(' ').find(s => s.startsWith('text-'))} />
                </div>
                <div>
                  <SheetTitle className="text-base font-bold font-mono">{plan.code}</SheetTitle>
                  <p className="text-sm text-muted-foreground">{plan.name}</p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className={cn('text-[10px] font-medium px-2 py-0.5 rounded-full border', cfg.cls)}>{t(`plansView.type.${plan.type}`, { defaultValue: cfg.label })}</span>
                    <span className="text-[10px] text-muted-foreground">v{plan.version}</span>
                    {plan.samplingFrequency && (
                      <span className="text-[10px] text-muted-foreground">
                        {t(`plans.freq.${plan.samplingFrequency}`, { defaultValue: plan.samplingFrequency })} · qty {plan.samplingQty}
                      </span>
                    )}
                    {plan.approvedAt ? (
                      <span className="flex items-center gap-0.5 text-[10px] text-green-400">
                        <CheckCircle2 size={9} /> {t('plansView.approvedStatus')}
                      </span>
                    ) : (
                      <span className="flex items-center gap-0.5 text-[10px] text-amber-400">
                        <AlertTriangle size={9} /> {t('plansView.pendingApproval')}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!plan.approvedAt && (
                  <Button size="sm" variant="outline" className="text-green-400 border-green-500/30 hover:bg-green-500/10"
                    onClick={() => approveMutation.mutate()}
                    disabled={approveMutation.isPending}
                  >
                    <CheckCircle2 size={12} className="mr-1.5" />
                    {approveMutation.isPending ? t('plansView.approving') : t('plansView.approve')}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => onEdit(plan)}>
                  <Edit2 size={12} className="mr-1.5" /> {t('common.edit')}
                </Button>
              </div>
            </div>
          )}
        </SheetHeader>

        {/* Info bar */}
        {plan && (
          <div className="grid grid-cols-3 gap-px bg-border shrink-0">
            {[
              { label: t('plansView.checkPoints'), value: plan.parameters.length.toString() },
              { label: t('plansView.kpiParameters'), value: plan.parameters.filter(p => p.isKPI).length.toString() },
              { label: t('plansView.inspections'), value: (plan._count?.results ?? 0).toString() },
            ].map(k => (
              <div key={k.label} className="bg-background px-3 py-2 text-center">
                <div className="text-sm font-bold">{k.value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{k.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Data flow legend */}
        {plan && (
          <div className="px-5 py-3 bg-muted/20 border-b shrink-0">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{t('plansView.dataFlow')}</span>
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-medium border', cfg.cls)}>{t(`plansView.type.${plan.type}`, { defaultValue: cfg.label })}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-[10px] bg-muted rounded px-1.5 py-0.5">{t('plansView.qualityPlanNode')}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-[10px] bg-muted rounded px-1.5 py-0.5">{t('plansView.checkPointsNode')}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-[10px] bg-muted rounded px-1.5 py-0.5">{t('plansView.workOrderInspection')}</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-[10px] bg-muted rounded px-1.5 py-0.5">{t('plansView.resultNcr')}</span>
            </div>
          </div>
        )}

        {/* Parameters section */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : plan ? (
            <div className="flex flex-col gap-4">
              {/* Plan instruction files / test-setup guides (shown to inspectors on the tablet) */}
              <Attachments entityType="QUALITY_PLAN" entityId={plan.id} category="INSTRUCTION" title={t('common:attach.instructions')} />

              {/* Section header */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{t('plansView.checkPointsTitle')}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('plansView.checkPointsDesc')}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant={addingParam ? 'secondary' : 'default'}
                  onClick={() => { setAddingParam(a => !a); setEditParam(null); setParamForm({ ...EMPTY_PARAM }); }}
                >
                  {addingParam ? <X size={12} className="mr-1.5" /> : <Plus size={12} className="mr-1.5" />}
                  {addingParam ? t('common.cancel') : t('plansView.addParameter')}
                </Button>
              </div>

              {/* Add / Edit parameter form */}
              <AnimatePresence>
                {addingParam && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="border rounded-xl p-4 bg-muted/20">
                      <div className="text-xs font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
                        {editParam ? t('paramf.editTitle') : t('paramf.createTitle')}
                      </div>
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div className="col-span-2 flex gap-3">
                          <div className="flex-1 flex flex-col gap-1">
                            <Label className="text-xs">{t('paramf.paramName')} *</Label>
                            <Input value={paramForm.name} onChange={e => setParamForm(p => ({ ...p, name: e.target.value }))} placeholder={t('paramf.paramPlaceholder')} className="h-8 text-xs" />
                          </div>
                          <div className="w-24 flex flex-col gap-1">
                            <Label className="text-xs">{t('paramf.unit')}</Label>
                            <Input value={paramForm.unit} onChange={e => setParamForm(p => ({ ...p, unit: e.target.value }))} placeholder="g, N, mm" className="h-8 text-xs" />
                          </div>
                          <div className="w-28 flex flex-col gap-1">
                            <Label className="text-xs">{t('paramf.nominalValue')}</Label>
                            <Input type="number" value={paramForm.nominalValue} onChange={e => setParamForm(p => ({ ...p, nominalValue: e.target.value }))} placeholder="500" className="h-8 text-xs" />
                          </div>
                        </div>
                        {/* SPC Limits */}
                        <div className="col-span-2">
                          <div className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide mb-2">{t('paramf.spcLimits')}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <Label className="text-xs text-muted-foreground">{t('paramf.ucl')}</Label>
                              <Input type="number" value={paramForm.ucl} onChange={e => setParamForm(p => ({ ...p, ucl: e.target.value }))} placeholder="510" className="h-8 text-xs" />
                            </div>
                            <div className="flex flex-col gap-1">
                              <Label className="text-xs text-muted-foreground">{t('paramf.lcl')}</Label>
                              <Input type="number" value={paramForm.lcl} onChange={e => setParamForm(p => ({ ...p, lcl: e.target.value }))} placeholder="490" className="h-8 text-xs" />
                            </div>
                          </div>
                        </div>
                        {/* Spec Limits */}
                        <div className="col-span-2">
                          <div className="text-[10px] font-semibold text-amber-400 uppercase tracking-wide mb-2">{t('paramf.specLimits')}</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="flex flex-col gap-1">
                              <Label className="text-xs text-muted-foreground">{t('paramf.usl')}</Label>
                              <Input type="number" value={paramForm.usl} onChange={e => setParamForm(p => ({ ...p, usl: e.target.value }))} placeholder="515" className="h-8 text-xs" />
                            </div>
                            <div className="flex flex-col gap-1">
                              <Label className="text-xs text-muted-foreground">{t('paramf.lsl')}</Label>
                              <Input type="number" value={paramForm.lsl} onChange={e => setParamForm(p => ({ ...p, lsl: e.target.value }))} placeholder="485" className="h-8 text-xs" />
                            </div>
                          </div>
                        </div>
                        <div className="col-span-2 flex gap-3 items-end">
                          <div className="flex-1 flex flex-col gap-1">
                            <Label className="text-xs">{t('paramf.checkMethod')}</Label>
                            <Input value={paramForm.checkMethod} onChange={e => setParamForm(p => ({ ...p, checkMethod: e.target.value }))} placeholder={t('paramf.checkMethodPlaceholder')} className="h-8 text-xs" />
                          </div>
                          <label className="flex items-center gap-2 text-xs cursor-pointer pb-1.5">
                            <input type="checkbox" checked={paramForm.isKPI} onChange={e => setParamForm(p => ({ ...p, isKPI: e.target.checked }))} className="rounded" />
                            <Star size={11} className="text-amber-400" /> {t('paramf.kpiParam')}
                          </label>
                        </div>
                      </div>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => { setAddingParam(false); setEditParam(null); setParamForm({ ...EMPTY_PARAM }); }}>{t('paramf.cancel')}</Button>
                        <Button size="sm" disabled={!paramForm.name || addParamMutation.isPending || updateParamMutation.isPending} onClick={handleSaveParam}>
                          {addParamMutation.isPending || updateParamMutation.isPending ? t('paramf.saving') : editParam ? t('paramf.update') : t('paramf.addParameter')}
                        </Button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Parameters table */}
              {plan.parameters.length === 0 ? (
                <div className="border rounded-xl p-10 text-center text-sm text-muted-foreground">
                  <Target size={28} className="mx-auto mb-3 opacity-20" />
                  <p>{t('plansView.noCheckPoints')}</p>
                  <p className="text-xs mt-1">{t('plansView.noCheckPointsHint')}</p>
                </div>
              ) : (
                <div className="border rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/30 border-b">
                      <tr>
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground w-6">#</th>
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">{t('plansView.colParameter')}</th>
                        <th className="text-center px-2 py-2.5 font-medium text-muted-foreground w-20">{t('plansView.colNominal')}</th>
                        <th className="text-center px-2 py-2.5 font-medium text-blue-400 w-28">UCL / LCL</th>
                        <th className="text-center px-2 py-2.5 font-medium text-amber-400 w-28">USL / LSL</th>
                        <th className="text-left px-3 py-2.5 font-medium text-muted-foreground">{t('plansView.colCheckMethod')}</th>
                        <th className="text-center px-2 py-2.5 font-medium text-muted-foreground w-12">KPI</th>
                        <th className="w-16" />
                      </tr>
                    </thead>
                    <tbody>
                      {plan.parameters.map((param, i) => (
                        <ParameterRow
                          key={param.id}
                          param={param}
                          index={i + 1}
                          onEdit={() => openEditParam(param)}
                          onDelete={() => setDeleteParam(param)}
                          isDeleting={deleteParamMutation.isPending && deleteParam?.id === param.id}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Limits legend */}
              {plan.parameters.length > 0 && (
                <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />{t('plansView.legendControl')}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />{t('plansView.legendSpec')}</span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Delete parameter confirm */}
        <AnimatePresence>
          {deleteParam && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}
                className="bg-background border rounded-xl shadow-2xl w-80 p-5"
              >
                <h3 className="font-semibold text-sm mb-2">{t('plansView.deleteParamTitle')}</h3>
                <p className="text-xs text-muted-foreground mb-4">
                  <Trans i18nKey="quality:plansView.deleteParamDescription" values={{ name: deleteParam.name }} components={[<strong key="0" />]} />
                </p>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => setDeleteParam(null)}>{t('common.cancel')}</Button>
                  <Button size="sm" variant="destructive" disabled={deleteParamMutation.isPending}
                    onClick={() => deleteParamMutation.mutate(deleteParam.id)}>
                    {deleteParamMutation.isPending ? t('common.deleting') : t('common.delete')}
                  </Button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </SheetContent>
    </Sheet>
  );
}

/* ------------------------------------------------------------------ */
/*  Parameter Row                                                       */
/* ------------------------------------------------------------------ */

function ParameterRow({ param, index, onEdit, onDelete, isDeleting }: {
  param: QualityParameter; index: number;
  onEdit: () => void; onDelete: () => void; isDeleting: boolean;
}) {
  const hasControlLimits = param.ucl != null || param.lcl != null;
  const hasSpecLimits = param.usl != null || param.lsl != null;

  return (
    <tr className={cn('border-b last:border-0 hover:bg-muted/20 transition-colors group', index % 2 === 0 ? 'bg-background' : 'bg-muted/5')}>
      <td className="px-3 py-2.5 text-muted-foreground font-mono">{index}</td>
      <td className="px-3 py-2.5">
        <div className="font-medium">{param.name}</div>
        {param.unit && <div className="text-[10px] text-muted-foreground">{param.unit}</div>}
      </td>
      <td className="px-2 py-2.5 text-center">
        {param.nominalValue != null ? (
          <span className="font-medium">{param.nominalValue}</span>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-2.5 text-center">
        {hasControlLimits ? (
          <div className="text-blue-400 leading-none">
            <div className="font-medium">{param.ucl ?? '—'}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{param.lcl ?? '—'}</div>
          </div>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-2 py-2.5 text-center">
        {hasSpecLimits ? (
          <div className="text-amber-400 leading-none">
            <div className="font-medium">{param.usl ?? '—'}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{param.lsl ?? '—'}</div>
          </div>
        ) : <span className="text-muted-foreground">—</span>}
      </td>
      <td className="px-3 py-2.5 text-muted-foreground max-w-[150px] truncate">{param.checkMethod ?? '—'}</td>
      <td className="px-2 py-2.5 text-center">
        {param.isKPI && <Star size={11} className="text-amber-400 mx-auto" fill="currentColor" />}
      </td>
      <td className="px-2 py-2.5">
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity justify-end pr-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onEdit}>
            <Edit2 size={10} />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive" onClick={onDelete} disabled={isDeleting}>
            <Trash2 size={10} />
          </Button>
        </div>
      </td>
    </tr>
  );
}
