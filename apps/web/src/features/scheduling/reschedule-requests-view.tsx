'use client';
import { useTranslation } from 'react-i18next';

/**
 * RescheduleRequestsView — monitor, review and manage every reschedule request
 * raised when an auto-generated work order's smart finish overruns its production
 * order due date. Approve/reject here; approval unlocks WO generation with the
 * proposed dates. Backed by GET/PATCH /production/reschedule-requests.
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CalendarClock, Clock, AlertTriangle, CheckCircle2, XCircle, Hourglass,
  RefreshCw, User, GitCommit, ArrowRight, Gauge,
} from 'lucide-react';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';

type Status = 'PENDING' | 'APPROVED' | 'REJECTED';

interface RescheduleRequest {
  id: string;
  status: Status;
  source: string;
  reason: string | null;
  proposedStart: string;
  proposedEnd: string;
  dueDate: string | null;
  workContentMins: number | null;
  plannedStoppageMins: number | null;
  details: any;
  reviewedAt: string | null;
  createdAt: string;
  productionOrder: { orderNumber: string; plannedEnd: string | null } | null;
  workOrder: { orderNumber: string } | null;
  requestedBy: { id: string; name: string } | null;
  reviewedBy: { id: string; name: string } | null;
}

type TFunc = (key: string, opts?: Record<string, unknown>) => string;

const SOURCE_CFG: Record<string, { labelKey: string; cls: string }> = {
  AUTO_GENERATE:    { labelKey: 'scheduling.reschedule.source.AUTO_GENERATE', cls: 'text-sky-400 bg-sky-500/15 border-sky-500/30' },
  APS_RECALC:       { labelKey: 'scheduling.reschedule.source.APS_RECALC', cls: 'text-violet-400 bg-violet-500/15 border-violet-500/30' },
  MATERIAL_DELIVERY:{ labelKey: 'scheduling.reschedule.source.MATERIAL_DELIVERY', cls: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
};
const sourceCfg = (t: TFunc, s: string) => {
  const cfg = SOURCE_CFG[s];
  return cfg
    ? { label: t(cfg.labelKey), cls: cfg.cls }
    : { label: s || '—', cls: 'text-muted-foreground bg-muted/40 border-border' };
};

const STATUS_CFG: Record<Status, { labelKey: string; cls: string; icon: React.ElementType }> = {
  PENDING:  { labelKey: 'scheduling.reschedule.status.PENDING',  cls: 'text-amber-400 bg-amber-500/15 border-amber-500/30',  icon: Hourglass },
  APPROVED: { labelKey: 'scheduling.reschedule.status.APPROVED', cls: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30', icon: CheckCircle2 },
  REJECTED: { labelKey: 'scheduling.reschedule.status.REJECTED', cls: 'text-red-400 bg-red-500/15 border-red-500/30', icon: XCircle },
};

const fmtDateTime = (iso?: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
function fmtDur(mins?: number | null) {
  if (mins == null) return '—';
  const h = Math.floor(mins / 60), m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
/** Overrun of the proposed finish past the due date, in ms (≤0 = on time). */
function overrunMs(r: RescheduleRequest): number {
  if (!r.dueDate) return 0;
  return new Date(r.proposedEnd).getTime() - new Date(r.dueDate).getTime();
}
function fmtSpan(t: TFunc, ms: number): string {
  if (ms <= 0) return t('scheduling.reschedule.onTime');
  const mins = Math.round(ms / 60_000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d > 0) return t('scheduling.reschedule.lateDHM', { d, h });
  if (h > 0) return t('scheduling.reschedule.lateHM', { h, m });
  return t('scheduling.reschedule.lateM', { m });
}

function KpiTile({ icon: Icon, label, value, color }: { icon: React.ElementType; label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <Icon size={16} style={{ color }} />
      </div>
      <div className="mt-1.5 text-2xl font-bold tabular-nums" style={{ color }}>{value}</div>
    </div>
  );
}

export function RescheduleRequestsView() {
  const { t } = useTranslation('modules');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState<'ALL' | Status>('PENDING');
  const [detail, setDetail] = useState<RescheduleRequest | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['reschedule-requests'],
    queryFn: () => api.get<RescheduleRequest[]>('/production/reschedule-requests'),
    refetchInterval: 60_000,
    staleTime: 20_000,
  });
  const all = useMemo(() => (data ?? []) as RescheduleRequest[], [data]);

  const counts = useMemo(() => ({
    ALL: all.length,
    PENDING: all.filter(r => r.status === 'PENDING').length,
    APPROVED: all.filter(r => r.status === 'APPROVED').length,
    REJECTED: all.filter(r => r.status === 'REJECTED').length,
  }), [all]);

  const avgOverrunH = useMemo(() => {
    const late = all.filter(r => overrunMs(r) > 0);
    if (!late.length) return 0;
    return Math.round((late.reduce((s, r) => s + overrunMs(r), 0) / late.length) / 3_600_000 * 10) / 10;
  }, [all]);

  const rows = useMemo(
    () => (filter === 'ALL' ? all : all.filter(r => r.status === filter))
      .slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [all, filter],
  );

  const review = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) =>
      api.patch(`/production/reschedule-requests/${id}/review`, { approve }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['reschedule-requests'] });
      qc.invalidateQueries({ queryKey: ['sidebar-counts'] });
      qc.invalidateQueries({ queryKey: ['po-reschedule-requests'] });
      toast({ title: vars.approve ? t('scheduling.reschedule.toastApproved') : t('scheduling.reschedule.toastRejected') });
      setDetail(null);
    },
    onError: (e: any) => {
      // A 400 here usually means the request was already reviewed (stale view).
      // Re-sync so the buttons reflect the true state instead of staying stuck.
      qc.invalidateQueries({ queryKey: ['reschedule-requests'] });
      qc.invalidateQueries({ queryKey: ['sidebar-counts'] });
      toast({ variant: 'destructive', title: t('scheduling.reschedule.toastError'), description: e?.response?.data?.message ?? t('scheduling.reschedule.toastFailed') });
    },
  });

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarClock size={22} className="text-primary" /> {t('scheduling.reschedule.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('scheduling.reschedule.subtitle')}
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={15} className={cn('mr-2', isFetching && 'animate-spin')} /> {t('scheduling.reschedule.refresh')}
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiTile icon={Hourglass} label={t('scheduling.reschedule.kpiActionRequired')} value={counts.PENDING} color="#f59e0b" />
        <KpiTile icon={CheckCircle2} label={t('scheduling.reschedule.kpiApproved')} value={counts.APPROVED} color="#22c55e" />
        <KpiTile icon={XCircle} label={t('scheduling.reschedule.kpiRejected')} value={counts.REJECTED} color="#ef4444" />
        <KpiTile icon={Clock} label={t('scheduling.reschedule.kpiAvgOverrun')} value={`${avgOverrunH}h`} color="#a855f7" />
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1 border-b border-border/60">
        {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={cn('px-3.5 py-2 text-sm rounded-t-md -mb-px border-b-2 transition-colors',
              filter === tab ? 'border-primary text-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground')}
          >
            {tab === 'ALL' ? t('scheduling.reschedule.filterAll') : t(STATUS_CFG[tab].labelKey)}
            <span className="ml-1.5 text-xs text-muted-foreground">{counts[tab]}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        {isLoading ? (
          <div className="p-4 space-y-2">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer h-10 rounded" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <CheckCircle2 size={28} className="mx-auto mb-2 text-emerald-500/60" />
            {filter === 'ALL'
              ? t('scheduling.reschedule.emptyNone')
              : t('scheduling.reschedule.emptyFiltered', { status: t(STATUS_CFG[filter as Status].labelKey).toLowerCase() })}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="px-4 py-2.5 font-medium">{t('scheduling.reschedule.col.productionOrder')}</th>
                <th className="px-4 py-2.5 font-medium">{t('scheduling.reschedule.col.source')}</th>
                <th className="px-4 py-2.5 font-medium">{t('scheduling.reschedule.col.requestedBy')}</th>
                <th className="px-4 py-2.5 font-medium">{t('scheduling.reschedule.col.proposedWindow')}</th>
                <th className="px-4 py-2.5 font-medium">{t('scheduling.reschedule.col.due')}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t('scheduling.reschedule.col.overrun')}</th>
                <th className="px-4 py-2.5 font-medium">{t('scheduling.reschedule.col.status')}</th>
                <th className="px-4 py-2.5 font-medium text-right">{t('scheduling.reschedule.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const cfg = STATUS_CFG[r.status];
                const SIcon = cfg.icon;
                const over = overrunMs(r);
                return (
                  <tr
                    key={r.id}
                    className="border-t border-border/50 hover:bg-muted/20 cursor-pointer"
                    onClick={() => setDetail(r)}
                  >
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs flex items-center gap-1.5"><GitCommit size={12} className="text-muted-foreground" />{r.productionOrder?.orderNumber ?? '—'}</div>
                      {r.workOrder?.orderNumber && <div className="text-[10px] text-muted-foreground font-mono mt-0.5">{r.workOrder.orderNumber}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full border', sourceCfg(t, r.source).cls)}>
                        {sourceCfg(t, r.source).label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5"><User size={12} />{r.requestedBy?.name ?? '—'}</span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {fmtDateTime(r.proposedStart)} <ArrowRight size={10} className="inline mx-0.5 text-muted-foreground" /> {fmtDateTime(r.proposedEnd)}
                    </td>
                    <td className="px-4 py-3 text-xs">{fmtDateTime(r.dueDate)}</td>
                    <td className={cn('px-4 py-3 text-right text-xs font-medium tabular-nums', over > 0 ? 'text-red-400' : 'text-emerald-400')}>
                      {fmtSpan(t, over)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border', cfg.cls)}>
                        <SIcon size={11} /> {t(cfg.labelKey)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                      {r.status === 'PENDING' ? (
                        <div className="flex items-center gap-1.5 justify-end">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => review.mutate({ id: r.id, approve: false })} disabled={review.isPending}>{t('scheduling.reschedule.reject')}</Button>
                          <Button size="sm" className="h-7" onClick={() => review.mutate({ id: r.id, approve: true })} disabled={review.isPending}>{t('scheduling.reschedule.approve')}</Button>
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">{r.reviewedBy?.name ? t('scheduling.reschedule.byReviewer', { name: r.reviewedBy.name }) : '—'}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Detail dialog — render from the LIVE list row so an approval/rejection
          made elsewhere (or a moment ago) collapses the action buttons instead
          of letting a second click hit an already-reviewed request (HTTP 400). */}
      {(() => {
        const liveDetail = detail ? (all.find(r => r.id === detail.id) ?? detail) : null;
        return (
      <Dialog open={!!liveDetail} onOpenChange={v => !v && setDetail(null)}>
        <DialogContent className="max-w-lg">
          {liveDetail && (() => {
            const detail = liveDetail;
            const cfg = STATUS_CFG[detail.status];
            const over = overrunMs(detail);
            return (
              <>
                <DialogHeader>
                  <DialogTitle className="flex items-center gap-2">
                    <CalendarClock size={18} className="text-primary" />
                    {t('scheduling.reschedule.dialogTitle', { order: detail.productionOrder?.orderNumber ?? 'PO' })}
                  </DialogTitle>
                  <DialogDescription className="flex items-center gap-2 flex-wrap">
                    <span className={cn('inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border', cfg.cls)}>
                      <cfg.icon size={11} /> {t(cfg.labelKey)}
                    </span>
                    <span className={cn('inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border', sourceCfg(t, detail.source).cls)}>
                      {sourceCfg(t, detail.source).label}
                    </span>
                    <span className={cn('text-xs font-medium', over > 0 ? 'text-red-400' : 'text-emerald-400')}>{fmtSpan(t, over)}</span>
                  </DialogDescription>
                </DialogHeader>

                <div className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Proposed start" value={fmtDateTime(detail.proposedStart)} />
                    <Field label="Proposed finish" value={fmtDateTime(detail.proposedEnd)} highlight={over > 0 ? 'red' : 'green'} />
                    <Field label="Due date" value={fmtDateTime(detail.dueDate)} />
                    <Field label="Requested" value={`${fmtDate(detail.createdAt)} · ${detail.requestedBy?.name ?? '—'}`} />
                  </div>

                  <div className="rounded-lg border border-border/60 p-3 grid grid-cols-3 gap-2 text-xs">
                    <div className="flex flex-col">
                      <span className="text-muted-foreground flex items-center gap-1"><Gauge size={11} /> Actual time work</span>
                      <span className="font-medium">{fmtDur(detail.workContentMins)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground flex items-center gap-1"><Clock size={11} /> Planned stoppage</span>
                      <span className="font-medium">+{fmtDur(detail.plannedStoppageMins)}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-medium">{fmtDur((detail.workContentMins ?? 0) + (detail.plannedStoppageMins ?? 0))}</span>
                    </div>
                  </div>

                  {/* Source-specific details */}
                  {detail.details && (
                    <div className="rounded-lg border border-border/60 p-3 text-xs space-y-1">
                      <div className="font-medium text-foreground flex items-center gap-1.5"><GitCommit size={12} /> Request details</div>
                      {detail.details.origin && <div className="text-muted-foreground">Origin: <span className="text-foreground">{detail.details.origin}</span></div>}
                      {detail.workOrder?.orderNumber && <div className="text-muted-foreground">Work order: <span className="text-foreground font-mono">{detail.workOrder.orderNumber}</span></div>}
                      {detail.details.makespanHours != null && <div className="text-muted-foreground">Run makespan: <span className="text-foreground">{detail.details.makespanHours}h</span></div>}
                      {Array.isArray(detail.details.updates) && (
                        <div className="text-muted-foreground">Plan covers <span className="text-foreground font-medium">{detail.details.updates.length}</span> operation(s) — approving applies these exact times.</div>
                      )}
                      {detail.details.deliveryEta && (
                        <div className="text-muted-foreground">Material delivery ETA: <span className="text-foreground">{fmtDateTime(detail.details.deliveryEta)}</span>{detail.details.delayDays != null ? <span className="text-amber-400"> (+{detail.details.delayDays}d)</span> : null}</div>
                      )}
                      {Array.isArray(detail.details.materials) && detail.details.materials.length > 0 && (
                        <div className="mt-1.5 space-y-1">
                          <div className="text-muted-foreground">Short materials ({detail.details.materials.length}):</div>
                          {detail.details.materials.map((m: any, i: number) => (
                            <div key={i} className="flex justify-between gap-2 text-[11px] pl-2 border-l border-amber-500/30">
                              <span className="text-foreground truncate">{m.name ?? m.code} <span className="font-mono text-muted-foreground">{m.code}</span></span>
                              <span className="text-amber-400 whitespace-nowrap">short {m.shortBy} {m.unit}{m.eta ? ` · ${fmtDateTime(m.eta).slice(0, 10)}` : ''}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {detail.reason && (
                    <div className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Reason: </span>{detail.reason}</div>
                  )}
                  {detail.reviewedAt && (
                    <div className="text-xs text-muted-foreground">
                      Reviewed {fmtDateTime(detail.reviewedAt)}{detail.reviewedBy?.name ? ` by ${detail.reviewedBy.name}` : ''}.
                    </div>
                  )}
                  {detail.status === 'PENDING' && (
                    <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300">
                      <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                      Approving accepts the proposed finish as the new work-order window; generation can then proceed with these dates.
                    </div>
                  )}
                </div>

                <DialogFooter>
                  {detail.status === 'PENDING' ? (
                    <>
                      <Button variant="outline" onClick={() => review.mutate({ id: detail.id, approve: false })} disabled={review.isPending}>
                        <XCircle size={15} className="mr-1.5" /> Reject
                      </Button>
                      <Button onClick={() => review.mutate({ id: detail.id, approve: true })} disabled={review.isPending}>
                        <CheckCircle2 size={15} className="mr-1.5" /> Approve reschedule
                      </Button>
                    </>
                  ) : (
                    <Button variant="outline" onClick={() => setDetail(null)}>Close</Button>
                  )}
                </DialogFooter>
              </>
            );
          })()}
        </DialogContent>
      </Dialog>
        );
      })()}
    </div>
  );
}

function Field({ label, value, highlight }: { label: string; value: string; highlight?: 'red' | 'green' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-medium', highlight === 'red' && 'text-red-400', highlight === 'green' && 'text-emerald-400')}>{value}</span>
    </div>
  );
}
