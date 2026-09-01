'use client';

/**
 * MaintenanceFloorView — tablet-first board for a maintenance technician.
 * Mirrors the Shop Floor app, but for the worker's assigned maintenance work
 * orders: large touch targets, start → complete lifecycle, and per-WO access to
 * instruction files (read) + photo/file evidence upload (during/after the job).
 *
 * Fully integrated with the existing maintenance API (assignedToId filter +
 * start/hold/resume/complete) and the shared Attachments system — no new logic.
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Wrench, RefreshCw, Play, Pause, CheckCircle2, Clock, AlertTriangle, Cpu,
  Package, ChevronRight, Loader2,
} from 'lucide-react';

import { api } from '@/services/api.client';
import { useAuthStore } from '@/store/auth-store';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Attachments } from '@/components/ui/attachments';
import { useToast } from '@/components/ui/use-toast';
import { cn, formatDate } from '@/lib/utils';

interface MaintWO {
  id: string; woNumber: string; title: string; type: string; priority: string; status: string;
  asset: string; assetCode?: string; machineId?: string;
  dueDate: string | null; isOverdue: boolean; estimatedHours: number | null;
  description: string | null; failureModeIds?: string[];
}
interface SparePart {
  id: string; quantityRequested: number; quantityIssued: number; status: string;
  sparePart: { partNumber: string; name: string };
}

const STATUS_CLS: Record<string, string> = {
  ASSIGNED: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  IN_PROGRESS: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  ON_HOLD: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  AWAITING_PARTS: 'text-orange-400 border-orange-500/30 bg-orange-500/10',
  OPEN: 'text-slate-400 border-slate-500/30 bg-slate-500/10',
  COMPLETED: 'text-green-400 border-green-500/30 bg-green-500/10',
};
const PRIORITY_CLS: Record<string, string> = {
  LOW: 'text-muted-foreground', MEDIUM: 'text-brand-400', HIGH: 'text-amber-400', CRITICAL: 'text-red-400',
};
const ACTIVE = ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'AWAITING_PARTS'];

export function MaintenanceFloorView() {
  const { t } = useTranslation(['maintenance', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id);
  const userName = useAuthStore((s) => s.user?.name);

  const [tab, setTab] = useState<'active' | 'done'>('active');
  const [detail, setDetail] = useState<MaintWO | null>(null);
  const [completeFor, setCompleteFor] = useState<MaintWO | null>(null);
  const [completeForm, setCompleteForm] = useState({ actualHours: '', notes: '' });

  const listKey = ['maintenance', 'my-wos', userId];
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: listKey,
    queryFn: () => api.get<{ data: MaintWO[] }>('/maintenance/work-orders', {
      params: { assignedToId: userId, limit: 100 },
    }),
    enabled: !!userId,
    refetchInterval: 60_000,
  });
  const all: MaintWO[] = (data as any)?.data ?? [];
  const active = useMemo(() => all.filter((w) => ACTIVE.includes(w.status)), [all]);
  const done = useMemo(() => all.filter((w) => w.status === 'COMPLETED'), [all]);
  const shown = tab === 'active' ? active : done;

  const invalidate = () => { qc.invalidateQueries({ queryKey: listKey }); };
  const errMsg = (e: any) => e?.response?.data?.message ?? t('maintenance:toast.error');

  const startMut = useMutation({
    mutationFn: (id: string) => api.patch(`/maintenance/work-orders/${id}/start`, {}),
    onSuccess: () => { invalidate(); toast({ title: t('maintenance:toast.woStarted') }); },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });
  const holdMut = useMutation({
    mutationFn: (id: string) => api.patch(`/maintenance/work-orders/${id}/hold`, {}),
    onSuccess: () => { invalidate(); toast({ title: t('maintenance:toast.woHeld') }); },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });
  const resumeMut = useMutation({
    mutationFn: (id: string) => api.patch(`/maintenance/work-orders/${id}/resume`, {}),
    onSuccess: () => { invalidate(); toast({ title: t('maintenance:toast.woResumed') }); },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });
  const completeMut = useMutation({
    mutationFn: ({ id, actualHours, notes }: { id: string; actualHours: number; notes?: string }) =>
      api.patch(`/maintenance/work-orders/${id}/complete`, { actualHours, ...(notes ? { notes } : {}) }),
    onSuccess: () => {
      invalidate();
      toast({ title: t('maintenance:toast.woCompleted') });
      setCompleteFor(null); setCompleteForm({ actualHours: '', notes: '' });
      setDetail(null);
    },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-500/15 flex items-center justify-center shrink-0">
            <Wrench className="text-orange-400" size={20} />
          </div>
          <div>
            <h1 className="text-lg font-bold">{t('mfloor.title')}</h1>
            <p className="text-xs text-muted-foreground">{userName ? t('mfloor.subtitleUser', { name: userName }) : t('mfloor.subtitle')}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={14} className={cn(isFetching && 'animate-spin')} /> {t('common:actions.refresh', { defaultValue: 'Refresh' })}
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 px-4 sm:px-6 py-3 border-b border-border/40">
        {(['active', 'done'] as const).map((k) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn('px-4 py-2 rounded-lg text-sm font-semibold transition-colors',
              tab === k ? 'bg-orange-500 text-white' : 'bg-muted text-muted-foreground hover:bg-muted/70')}
          >
            {k === 'active' ? t('mfloor.tabActive', { count: active.length }) : t('mfloor.tabDone', { count: done.length })}
          </button>
        ))}
      </div>

      {/* Cards */}
      <div className="flex-1 overflow-auto p-4 sm:p-6">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-44 rounded-2xl" />)}
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center text-muted-foreground">
            <CheckCircle2 size={40} className="mb-3 text-emerald-500/50" />
            <p className="text-sm">{tab === 'active' ? t('mfloor.emptyActive') : t('mfloor.emptyDone')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {shown.map((wo) => (
              <div key={wo.id} className={cn('rounded-2xl border bg-card p-4 flex flex-col gap-3', wo.isOverdue ? 'border-red-500/40' : 'border-border/60')}>
                <div className="flex items-start justify-between gap-2">
                  <button className="text-left flex-1 min-w-0" onClick={() => setDetail(wo)}>
                    <p className="font-mono text-[11px] text-muted-foreground">{wo.woNumber}</p>
                    <p className="font-semibold text-sm leading-snug line-clamp-2">{wo.title}</p>
                  </button>
                  <Badge className={cn('shrink-0 border', STATUS_CLS[wo.status])}>{t(`woStatus.${wo.status}`, { defaultValue: wo.status })}</Badge>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                  <span className="inline-flex items-center gap-1"><Cpu size={12} />{wo.asset}</span>
                  <span className={cn('font-medium', PRIORITY_CLS[wo.priority])}>{t(`common:priority.${wo.priority}`, { defaultValue: wo.priority })}</span>
                  <span className="inline-flex items-center gap-1"><Clock size={12} />{wo.dueDate ? formatDate(wo.dueDate) : '—'}</span>
                  {wo.isOverdue && <span className="inline-flex items-center gap-1 text-red-400"><AlertTriangle size={12} />{t('overdue')}</span>}
                </div>

                {/* Big touch actions by status */}
                <div className="flex items-center gap-2 mt-auto pt-1">
                  {wo.status === 'ASSIGNED' && (
                    <Button className="flex-1 h-11 gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={startMut.isPending} onClick={() => startMut.mutate(wo.id)}>
                      <Play size={16} /> {t('mfloor.start')}
                    </Button>
                  )}
                  {wo.status === 'IN_PROGRESS' && (
                    <>
                      <Button className="flex-1 h-11 gap-1.5" disabled={completeMut.isPending} onClick={() => { setCompleteFor(wo); setCompleteForm({ actualHours: wo.estimatedHours ? String(wo.estimatedHours) : '', notes: '' }); }}>
                        <CheckCircle2 size={16} /> {t('mfloor.complete')}
                      </Button>
                      <Button variant="outline" className="h-11 gap-1.5" disabled={holdMut.isPending} onClick={() => holdMut.mutate(wo.id)}>
                        <Pause size={16} /> {t('mfloor.hold')}
                      </Button>
                    </>
                  )}
                  {wo.status === 'ON_HOLD' && (
                    <Button className="flex-1 h-11 gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={resumeMut.isPending} onClick={() => resumeMut.mutate(wo.id)}>
                      <Play size={16} /> {t('mfloor.resume')}
                    </Button>
                  )}
                  <Button variant="ghost" className="h-11 w-11 p-0 shrink-0" onClick={() => setDetail(wo)} title={t('mfloor.openDetail')}>
                    <ChevronRight size={18} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail drawer — instructions (read) + evidence upload + spare parts */}
      <Sheet open={!!detail} onOpenChange={(o) => { if (!o) setDetail(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col p-0">
          {detail && <DetailBody wo={detail} onComplete={() => { setCompleteFor(detail); setCompleteForm({ actualHours: detail.estimatedHours ? String(detail.estimatedHours) : '', notes: '' }); }} />}
        </SheetContent>
      </Sheet>

      {/* Complete dialog */}
      <Dialog open={!!completeFor} onOpenChange={(o) => { if (!o) setCompleteFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{t('mfloor.completeTitle', { wo: completeFor?.woNumber ?? '' })}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{t('mfloor.actualHours')} *</Label>
              <Input type="number" min="0" step="0.25" value={completeForm.actualHours}
                onChange={(e) => setCompleteForm((f) => ({ ...f, actualHours: e.target.value }))} className="h-10" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('mform.internalNotes')}</Label>
              <textarea className="w-full min-h-[72px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={completeForm.notes} onChange={(e) => setCompleteForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            {completeFor && (
              <div className="rounded-lg border border-border/60 p-3">
                <Attachments entityType="MAINTENANCE_WO" entityId={completeFor.id} category="EVIDENCE" title={t('common:attach.evidence')} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCompleteFor(null)}>{t('mform.cancel')}</Button>
            <Button
              disabled={!completeForm.actualHours || completeMut.isPending}
              onClick={() => completeFor && completeMut.mutate({ id: completeFor.id, actualHours: parseFloat(completeForm.actualHours), notes: completeForm.notes || undefined })}
            >
              {completeMut.isPending ? <Loader2 size={15} className="animate-spin mr-1.5" /> : <CheckCircle2 size={15} className="mr-1.5" />}
              {t('mfloor.confirmComplete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailBody({ wo, onComplete }: { wo: MaintWO; onComplete: () => void }) {
  const { t } = useTranslation(['maintenance', 'common']);
  const { data } = useQuery({
    queryKey: ['maintenance', 'wo-spare-parts', wo.id],
    queryFn: () => api.get<SparePart[]>(`/maintenance/work-orders/${wo.id}/spare-parts`),
    staleTime: 30_000,
  });
  const spares: SparePart[] = Array.isArray(data) ? data : [];

  return (
    <>
      <SheetHeader className="px-5 py-4 border-b border-border/50">
        <SheetTitle className="font-mono text-sm">{wo.woNumber}</SheetTitle>
        <SheetDescription className="text-xs">{wo.title}</SheetDescription>
      </SheetHeader>
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        <div className="flex items-center gap-2 flex-wrap text-xs">
          <Badge className={cn('border', STATUS_CLS[wo.status])}>{t(`woStatus.${wo.status}`, { defaultValue: wo.status })}</Badge>
          <span className="inline-flex items-center gap-1 text-muted-foreground"><Cpu size={12} />{wo.asset}</span>
          <span className={cn('font-medium', PRIORITY_CLS[wo.priority])}>{t(`common:priority.${wo.priority}`, { defaultValue: wo.priority })}</span>
        </div>

        {wo.description && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{wo.description}</p>}

        {/* Instructions — read-only for the worker */}
        <Attachments entityType="MAINTENANCE_WO" entityId={wo.id} category="INSTRUCTION" title={t('common:attach.instructions')} readOnly />

        {/* Evidence — the worker attaches photos during/after the job */}
        <Attachments entityType="MAINTENANCE_WO" entityId={wo.id} category="EVIDENCE" title={t('common:attach.evidence')} />

        {/* Spare parts */}
        {spares.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5"><Package size={12} />{t('detail2.spareParts')}</p>
            {spares.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs">
                <span>{s.sparePart?.name}</span>
                <span className="text-muted-foreground">{t('woView.issued')} {s.quantityIssued}/{s.quantityRequested}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {wo.status === 'IN_PROGRESS' && (
        <div className="px-5 py-3 border-t border-border/50">
          <Button className="w-full h-11 gap-1.5" onClick={onComplete}><CheckCircle2 size={16} /> {t('mfloor.complete')}</Button>
        </div>
      )}
    </>
  );
}
