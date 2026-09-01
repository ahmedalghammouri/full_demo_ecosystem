'use client';
import { useTranslation } from 'react-i18next';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  GitPullRequest,
  Plus,
  CheckCircle2,
  XCircle,
  Clock,
  AlertTriangle,
  ChevronRight,
  Eye,
} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/services/api.client';
import { cn, generateId, formatDate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SelectMenu } from '@/components/ui/select-menu';
import { EntityPicker } from '@/components/ui/entity-picker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { InlineFormPanel, InlineFormSlot } from '@/components/ui/inline-form-panel';

// ── Types ────────────────────────────────────────────────────────

interface ChangeRequest {
  id: string;
  crNumber: string;
  title: string;
  description: string;
  type: 'BOM_CHANGE' | 'RECIPE_CHANGE' | 'PROCESS_CHANGE' | 'DESIGN_CHANGE';
  status: 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'IMPLEMENTED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  affectedProduct: string;
  requestedBy: string;
  reviewedBy?: string;
  createdAt: string;
  targetDate: string;
  reason: string;
}

// API row → view model (real data from /plm/change-requests)
interface ApiChangeRequest {
  id: string;
  crNumber: string;
  title: string;
  description: string | null;
  type: ChangeRequest['type'];
  status: ChangeRequest['status'];
  priority: ChangeRequest['priority'];
  reason: string | null;
  targetDate: string | null;
  createdAt: string;
  sku: { id: string; itemNumber: string; name: string } | null;
  requestedBy: { id: string; name: string } | null;
  reviewedBy: { id: string; name: string } | null;
}

function apiToCr(r: ApiChangeRequest): ChangeRequest {
  return {
    id: r.id,
    crNumber: r.crNumber,
    title: r.title,
    description: r.description ?? '',
    type: r.type,
    status: r.status,
    priority: r.priority,
    affectedProduct: r.sku ? `${r.sku.itemNumber} — ${r.sku.name}` : '—',
    requestedBy: r.requestedBy?.name ?? '—',
    reviewedBy: r.reviewedBy?.name ?? undefined,
    createdAt: r.createdAt,
    targetDate: r.targetDate ?? '',
    reason: r.reason ?? '',
  };
}

// ── Config ───────────────────────────────────────────────────────

const TYPE_COLORS: Record<ChangeRequest['type'], string> = {
  BOM_CHANGE: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  RECIPE_CHANGE: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  PROCESS_CHANGE: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  DESIGN_CHANGE: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
};

const PRIORITY_COLORS: Record<ChangeRequest['priority'], string> = {
  CRITICAL: 'bg-red-500/20 text-red-400 border-red-500/30',
  HIGH: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  MEDIUM: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  LOW: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
};

const STATUS_COLORS: Record<ChangeRequest['status'], string> = {
  DRAFT: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  SUBMITTED: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  UNDER_REVIEW: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  APPROVED: 'bg-green-500/20 text-green-400 border-green-500/30',
  REJECTED: 'bg-red-500/20 text-red-400 border-red-500/30',
  IMPLEMENTED: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const PIE_COLORS = ['#3b82f6', '#a855f7', '#f59e0b', '#ec4899'];

const WORKFLOW_STEPS = [
  { labelKey: 'plm.crWorkflow.draft', color: 'bg-gray-500' },
  { labelKey: 'plm.crWorkflow.submitted', color: 'bg-blue-500' },
  { labelKey: 'plm.crWorkflow.underReview', color: 'bg-yellow-500' },
  { labelKey: 'plm.crWorkflow.decided', color: 'bg-green-500' },
  { labelKey: 'plm.crWorkflow.implemented', color: 'bg-purple-500' },
];

// ── Toast ─────────────────────────────────────────────────────────

interface ToastMsg {
  id: string;
  message: string;
  variant: 'success' | 'error';
}

// ── Main Component ────────────────────────────────────────────────

export default function PlmChangeRequestsView() {
  const { t } = useTranslation('modules');
  const queryClient = useQueryClient();
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');
  const [createOpen, setCreateOpen] = useState(false);
  const [detailCr, setDetailCr] = useState<ChangeRequest | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  // Create form state (skuId = real product reference)
  const [form, setForm] = useState({
    title: '',
    type: 'BOM_CHANGE' as ChangeRequest['type'],
    priority: 'MEDIUM' as ChangeRequest['priority'],
    skuId: '',
    targetDate: '',
    reason: '',
  });

  // ── Live data ───────────────────────────────────────────────────
  const { data: crData } = useQuery({
    queryKey: ['plm', 'change-requests'],
    // 100 is the API's documented maximum — 200 is rejected with a 400.
    queryFn: () => api.get<{ data: ApiChangeRequest[] }>('/plm/change-requests', { params: { limit: 100 } }),
    staleTime: 15_000,
  });
  const crs: ChangeRequest[] = ((crData as any)?.data ?? []).map(apiToCr);

  const { data: productsData } = useQuery({
    queryKey: ['plm', 'cr-products'],
    queryFn: () => api.get<{ data: Array<{ id: string; itemNumber: string; name: string }> }>('/inventory/products', { params: { limit: 200 } }),
    staleTime: 300_000,
  });
  const products = ((productsData as any)?.data ?? []) as Array<{ id: string; itemNumber: string; name: string }>;

  // ── Toasts ──────────────────────────────────────────────────────
  const addToast = (message: string, variant: 'success' | 'error' = 'success') => {
    const id = generateId();
    setToasts((prev) => [...prev, { id, message, variant }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  };
  const errMsg = (e: unknown) =>
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('plm.crToast.opFailed');
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['plm', 'change-requests'] });

  // ── Mutations (real workflow on the server) ─────────────────────
  const transitionMut = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ChangeRequest['status'] }) =>
      api.post<ApiChangeRequest>(`/plm/change-requests/${id}/transition`, { status }),
    onSuccess: (r) => {
      invalidate();
      // A CR decision gates downstream approvals (e.g. a manufacturing process /
      // BOM / recipe can't be approved while it has an open CR). Refresh those
      // so their approve buttons enable/disable live without a manual refresh.
      queryClient.invalidateQueries({ queryKey: ['manufacturing-processes'] });
      queryClient.invalidateQueries({ queryKey: ['boms'] });
      queryClient.invalidateQueries({ queryKey: ['production-recipes'] });
      addToast(t('plm.crToast.transition', { crNumber: r.crNumber, status: t(`plm.crStatus.${r.status}`) }), r.status === 'REJECTED' ? 'error' : 'success');
    },
    onError: (e) => addToast(errMsg(e), 'error'),
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const created = await api.post<ApiChangeRequest>('/plm/change-requests', {
        title: form.title,
        description: form.reason,
        type: form.type,
        priority: form.priority,
        skuId: form.skuId || undefined,
        reason: form.reason,
        targetDate: form.targetDate || undefined,
      });
      // The dialog submits straight into the review queue
      return api.post<ApiChangeRequest>(`/plm/change-requests/${created.id}/transition`, { status: 'SUBMITTED' });
    },
    onSuccess: (r) => {
      invalidate();
      addToast(t('plm.crToast.submitted', { crNumber: r.crNumber }), 'success');
      setForm({ title: '', type: 'BOM_CHANGE', priority: 'MEDIUM', skuId: '', targetDate: '', reason: '' });
      setCreateOpen(false);
    },
    onError: (e) => addToast(errMsg(e), 'error'),
  });

  // ── Actions ─────────────────────────────────────────────────────
  const handleApprove = (cr: ChangeRequest) => transitionMut.mutate({ id: cr.id, status: 'APPROVED' });
  const handleReject = (cr: ChangeRequest) => transitionMut.mutate({ id: cr.id, status: 'REJECTED' });
  const handleStartReview = (cr: ChangeRequest) => transitionMut.mutate({ id: cr.id, status: 'UNDER_REVIEW' });
  const handleImplement = (cr: ChangeRequest) => transitionMut.mutate({ id: cr.id, status: 'IMPLEMENTED' });
  const handleCreate = () => {
    if (!form.title || !form.targetDate || !form.reason) return;
    createMut.mutate();
  };

  // ── KPIs ─────────────────────────────────────────────────────────
  const openCount = crs.filter((c) => ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(c.status)).length;
  const underReviewCount = crs.filter((c) => c.status === 'UNDER_REVIEW').length;
  const approvedThisMonth = crs.filter((c) => {
    if (c.status !== 'APPROVED') return false;
    const d = new Date(c.createdAt);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).length;
  const rejectedCount = crs.filter((c) => c.status === 'REJECTED').length;

  // ── Filtered list ─────────────────────────────────────────────
  const filtered = crs.filter((c) => {
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      c.crNumber.toLowerCase().includes(q) ||
      c.title.toLowerCase().includes(q) ||
      c.affectedProduct.toLowerCase().includes(q) ||
      c.requestedBy.toLowerCase().includes(q);
    const matchType = typeFilter === 'ALL' || c.type === typeFilter;
    const matchStatus = statusFilter === 'ALL' || c.status === statusFilter;
    const matchPriority = priorityFilter === 'ALL' || c.priority === priorityFilter;
    return matchSearch && matchType && matchStatus && matchPriority;
  });

  // Client-side pagination — keeps the table light even with hundreds of ECRs
  const PAGE_LIMIT = 15;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [search, typeFilter, statusFilter, priorityFilter]);
  const paged = filtered.slice((page - 1) * PAGE_LIMIT, page * PAGE_LIMIT);

  // ── Pie data ──────────────────────────────────────────────────
  const typeCounts = (['BOM_CHANGE', 'RECIPE_CHANGE', 'PROCESS_CHANGE', 'DESIGN_CHANGE'] as const).map((ct) => ({
    name: t(`plm.crType.${ct}`),
    value: crs.filter((c) => c.type === ct).length,
  }));

  // ── Render ────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen space-y-6 p-6">
      {/* Toast container */}
      <div className="fixed right-4 top-4 z-[100] flex flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 80, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 80, scale: 0.9 }}
              transition={{ duration: 0.25 }}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-4 py-3 text-sm font-medium shadow-xl',
                t.variant === 'success'
                  ? 'border-green-500/40 bg-green-500/10 text-green-300'
                  : 'border-red-500/40 bg-red-500/10 text-red-300',
              )}
            >
              {t.variant === 'success' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : (
                <XCircle className="h-4 w-4 shrink-0" />
              )}
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/20">
            <GitPullRequest className="h-5 w-5 text-brand-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">{t('plm.changeRequests.title')}</h1>
            <p className="text-xs text-muted-foreground">{t('plm.changeRequests.subtitle')}</p>
          </div>
        </div>

        <Button className="gap-2" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          {t('plm.newCr')}
        </Button>
      </div>

      <InlineFormSlot />

      {/* Submit New Change Request — inline form */}
      <InlineFormPanel
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        icon={Plus}
        title={t('plm.crform.title')}
        description={t('plm.crform.desc')}
        footer={(
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('plm.crform.cancel')}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!form.title || !form.targetDate || !form.reason || createMut.isPending}
            >
              {createMut.isPending ? t('plm.crform.submitting') : t('plm.crform.submit')}
            </Button>
          </>
        )}
      >
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t('plm.crform.titleField')} *</label>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder={t('plm.crform.titlePlaceholder')}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{t('plm.crform.type')} *</label>
                  <SelectMenu
                    size="md"
                    fullWidth
                    value={form.type}
                    onValueChange={(v) => setForm((f) => ({ ...f, type: v as ChangeRequest['type'] }))}
                    options={[
                      { value: 'BOM_CHANGE', label: t('plm.crform.tBom') },
                      { value: 'RECIPE_CHANGE', label: t('plm.crform.tRecipe') },
                      { value: 'PROCESS_CHANGE', label: t('plm.crform.tProcess') },
                      { value: 'DESIGN_CHANGE', label: t('plm.crform.tDesign') },
                    ]}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">{t('plm.crform.priority')} *</label>
                  <SelectMenu
                    size="md"
                    fullWidth
                    value={form.priority}
                    onValueChange={(v) => setForm((f) => ({ ...f, priority: v as ChangeRequest['priority'] }))}
                    options={[
                      { value: 'LOW', label: t('plm.crform.pLow') },
                      { value: 'MEDIUM', label: t('plm.crform.pMedium') },
                      { value: 'HIGH', label: t('plm.crform.pHigh') },
                      { value: 'CRITICAL', label: t('plm.crform.pCritical') },
                    ]}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t('plm.crform.affectedProduct')}</label>
                <EntityPicker
                  items={products}
                  value={form.skuId}
                  onChange={(id) => setForm((f) => ({ ...f, skuId: id ?? '' }))}
                  getId={(p) => p.id}
                  getPrimary={(p) => p.name}
                  getSecondary={(p) => p.itemNumber}
                  placeholder={t('plm.crform.selectProduct')}
                  searchPlaceholder={t('plm.crform.searchProduct')}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t('plm.crform.targetDate')} *</label>
                <input
                  type="date"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  value={form.targetDate}
                  onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))}
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{t('plm.crform.reason')} *</label>
                <textarea
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
                  rows={3}
                  placeholder={t('plm.crform.reasonPlaceholder')}
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
            </div>
      </InlineFormPanel>

      {/* ── KPI Row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          { label: t('plm.crkpi.open'), value: openCount, icon: GitPullRequest, color: 'text-blue-400', bg: 'bg-blue-500/10' },
          { label: t('plm.crkpi.underReview'), value: underReviewCount, icon: Clock, color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
          { label: t('plm.crkpi.approvedMonth'), value: approvedThisMonth, icon: CheckCircle2, color: 'text-green-400', bg: 'bg-green-500/10' },
          { label: t('plm.crkpi.rejected'), value: rejectedCount, icon: XCircle, color: 'text-red-400', bg: 'bg-red-500/10' },
        ].map((kpi) => (
          <motion.div
            key={kpi.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-xl border border-border bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground">{kpi.label}</p>
              <div className={cn('rounded-lg p-2', kpi.bg)}>
                <kpi.icon className={cn('h-4 w-4', kpi.color)} />
              </div>
            </div>
            <p className={cn('mt-2 text-3xl font-bold', kpi.color)}>{kpi.value}</p>
          </motion.div>
        ))}
      </div>

      {/* ── Workflow Banner ──────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card px-6 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('plm.crWorkflow.heading')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {WORKFLOW_STEPS.map((step, idx) => (
            <div key={step.labelKey} className="flex items-center gap-2">
              <div className="flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full', step.color)} />
                <span className="text-sm font-medium text-foreground">{t(step.labelKey)}</span>
              </div>
              {idx < WORKFLOW_STEPS.length - 1 && (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── Filter Bar ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          className="h-9 min-w-[220px] flex-1 rounded-md border border-border bg-background px-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand-500"
          placeholder={t('plm.crSearch')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <SelectMenu
          size="md"
          value={typeFilter}
          onValueChange={setTypeFilter}
          menuLabel={t('plm.crFilter.type')}
          options={[
            { value: 'ALL', label: t('plm.crFilter.allTypes') },
            { value: 'BOM_CHANGE', label: t('plm.crFilter.bomChange') },
            { value: 'RECIPE_CHANGE', label: t('plm.crFilter.recipeChange') },
            { value: 'PROCESS_CHANGE', label: t('plm.crFilter.processChange') },
            { value: 'DESIGN_CHANGE', label: t('plm.crFilter.designChange') },
          ]}
        />
        <SelectMenu
          size="md"
          value={statusFilter}
          onValueChange={setStatusFilter}
          menuLabel={t('plm.crFilter.status')}
          options={[
            { value: 'ALL', label: t('plm.crFilter.allStatuses') },
            { value: 'DRAFT', label: t('plm.crStatus.DRAFT') },
            { value: 'SUBMITTED', label: t('plm.crStatus.SUBMITTED') },
            { value: 'UNDER_REVIEW', label: t('plm.crStatus.UNDER_REVIEW') },
            { value: 'APPROVED', label: t('plm.crStatus.APPROVED') },
            { value: 'REJECTED', label: t('plm.crStatus.REJECTED') },
            { value: 'IMPLEMENTED', label: t('plm.crStatus.IMPLEMENTED') },
          ]}
        />
        <SelectMenu
          size="md"
          value={priorityFilter}
          onValueChange={setPriorityFilter}
          menuLabel={t('plm.crFilter.priority')}
          options={[
            { value: 'ALL', label: t('plm.crFilter.allPriorities') },
            { value: 'CRITICAL', label: t('plm.crFilter.critical') },
            { value: 'HIGH', label: t('plm.crFilter.high') },
            { value: 'MEDIUM', label: t('plm.crFilter.medium') },
            { value: 'LOW', label: t('plm.crFilter.low') },
          ]}
        />
        <span className="text-xs text-muted-foreground">{t('plm.crRecordCount', { count: filtered.length })}</span>
      </div>

      {/* ── Table ────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {[
                  { key: 'crNumber', label: t('plm.crCol.crNumber') },
                  { key: 'title', label: t('plm.crCol.title') },
                  { key: 'type', label: t('plm.crCol.type') },
                  { key: 'priority', label: t('plm.crCol.priority') },
                  { key: 'affectedProduct', label: t('plm.crCol.affectedProduct') },
                  { key: 'status', label: t('plm.crCol.status') },
                  { key: 'requestedBy', label: t('plm.crCol.requestedBy') },
                  { key: 'targetDate', label: t('plm.crCol.targetDate') },
                  { key: 'actions', label: t('plm.crCol.actions') },
                ].map((h) => (
                  <th key={h.key} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {h.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {paged.map((cr, i) => (
                  <motion.tr
                    key={cr.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="border-b border-border/50 transition-colors hover:bg-muted/20"
                  >
                    <td className="px-4 py-3 font-mono text-xs font-semibold text-brand-400">{cr.crNumber}</td>
                    <td className="max-w-[200px] px-4 py-3">
                      <p className="truncate font-medium text-foreground" title={cr.title}>
                        {cr.title}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                          TYPE_COLORS[cr.type],
                        )}
                      >
                        {t(`plm.crType.${cr.type}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold',
                          PRIORITY_COLORS[cr.priority],
                        )}
                      >
                        {cr.priority === 'CRITICAL' && <AlertTriangle className="h-3 w-3" />}
                        {t(`plm.crFilter.${cr.priority.toLowerCase()}`)}
                      </span>
                    </td>
                    <td className="max-w-[180px] px-4 py-3">
                      <p className="truncate text-muted-foreground" title={cr.affectedProduct}>
                        {cr.affectedProduct}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold',
                          STATUS_COLORS[cr.status],
                        )}
                      >
                        {t(`plm.crStatus.${cr.status}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{cr.requestedBy}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(cr.targetDate)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1 px-2 text-xs"
                          onClick={() => { setDetailCr(cr); setDetailOpen(true); }}
                        >
                          <Eye className="h-3 w-3" />
                          {t('plm.crAction.view')}
                        </Button>
                        {cr.status === 'UNDER_REVIEW' && (
                          <>
                            <Button
                              size="sm"
                              className="h-7 gap-1 bg-green-600 px-2 text-xs hover:bg-green-700"
                              onClick={() => handleApprove(cr)}
                            >
                              <CheckCircle2 className="h-3 w-3" />
                              {t('plm.crAction.approve')}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              className="h-7 gap-1 px-2 text-xs"
                              onClick={() => handleReject(cr)}
                            >
                              <XCircle className="h-3 w-3" />
                              {t('plm.crAction.reject')}
                            </Button>
                          </>
                        )}
                        {cr.status === 'SUBMITTED' && (
                          <Button
                            size="sm"
                            className="h-7 gap-1 bg-yellow-600 px-2 text-xs hover:bg-yellow-700"
                            onClick={() => handleStartReview(cr)}
                          >
                            <Clock className="h-3 w-3" />
                            {t('plm.crAction.startReview')}
                          </Button>
                        )}
                        {cr.status === 'APPROVED' && (
                          <Button
                            size="sm"
                            className="h-7 gap-1 bg-purple-600 px-2 text-xs hover:bg-purple-700"
                            onClick={() => handleImplement(cr)}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            {t('plm.crAction.implement')}
                          </Button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                ))}
              </AnimatePresence>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-sm text-muted-foreground">
                    {t('plm.crNoResults')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {filtered.length > PAGE_LIMIT && (
          <div className="border-t border-border/50 px-4 py-2">
            <TablePagination page={page} total={filtered.length} limit={PAGE_LIMIT} onPageChange={setPage} />
          </div>
        )}
      </div>

      {/* ── Type Distribution Chart ──────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-6">
        <h2 className="mb-4 text-sm font-semibold text-foreground">{t('plm.crDist')}</h2>
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie
              data={typeCounts}
              cx="50%"
              cy="50%"
              innerRadius={70}
              outerRadius={110}
              paddingAngle={3}
              dataKey="value"
            >
              {typeCounts.map((_, index) => (
                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              wrapperStyle={{ fontSize: '12px', color: 'hsl(var(--muted-foreground))' }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* ── Detail Dialog ─────────────────────────────────────────── */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-xl">
          {detailCr && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="font-mono text-brand-400">{detailCr.crNumber}</span>
                  <span className="text-foreground">{detailCr.title}</span>
                </DialogTitle>
              </DialogHeader>
              <div className="mt-2 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <span className={cn('inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold', STATUS_COLORS[detailCr.status])}>
                    {t(`plm.crStatus.${detailCr.status}`)}
                  </span>
                  <span className={cn('inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold', PRIORITY_COLORS[detailCr.priority])}>
                    {t('plm.crPriorityLabel', { priority: t(`plm.crFilter.${detailCr.priority.toLowerCase()}`) })}
                  </span>
                  <span className={cn('inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold', TYPE_COLORS[detailCr.type])}>
                    {t(`plm.crType.${detailCr.type}`)}
                  </span>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('plm.crDetail.description')}</p>
                  <p className="text-sm text-foreground">{detailCr.description}</p>
                </div>

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('plm.crDetail.reason')}</p>
                  <p className="text-sm text-foreground">{detailCr.reason}</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: t('plm.crDetail.affectedProduct'), value: detailCr.affectedProduct },
                    { label: t('plm.crDetail.requestedBy'), value: detailCr.requestedBy },
                    { label: t('plm.crDetail.reviewedBy'), value: detailCr.reviewedBy ?? '—' },
                    { label: t('plm.crDetail.created'), value: formatDate(detailCr.createdAt) },
                    { label: t('plm.crDetail.targetDate'), value: formatDate(detailCr.targetDate) },
                  ].map((row) => (
                    <div key={row.label} className="space-y-0.5">
                      <p className="text-xs font-medium text-muted-foreground">{row.label}</p>
                      <p className="text-sm font-medium text-foreground">{row.value}</p>
                    </div>
                  ))}
                </div>
              </div>
              <DialogFooter className="mt-4">
                {detailCr.status === 'UNDER_REVIEW' && (
                  <>
                    <Button
                      className="gap-1 bg-green-600 hover:bg-green-700"
                      onClick={() => { handleApprove(detailCr); setDetailOpen(false); }}
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      {t('plm.crAction.approve')}
                    </Button>
                    <Button
                      variant="destructive"
                      className="gap-1"
                      onClick={() => { handleReject(detailCr); setDetailOpen(false); }}
                    >
                      <XCircle className="h-4 w-4" />
                      {t('plm.crAction.reject')}
                    </Button>
                  </>
                )}
                <Button variant="outline" onClick={() => setDetailOpen(false)}>
                  {t('plm.crAction.close')}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
