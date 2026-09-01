'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, ShieldCheck, User, CalendarClock, FileText, Plus, CheckCircle2,
  Circle, Download, ClipboardList, AlertTriangle, Gauge,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { exportRecordToPDF } from '@/lib/export-utils';
import { Attachments } from '@/components/ui/attachments';

const STATUS_CFG: Record<string, { labelKey: string; cls: string }> = {
  OPEN: { labelKey: 'capa.status.OPEN', cls: 'text-red-400 border-red-500/30 bg-red-500/10' },
  IN_PROGRESS: { labelKey: 'capa.status.IN_PROGRESS', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  VERIFIED: { labelKey: 'capa.status.VERIFIED', cls: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  CLOSED: { labelKey: 'capa.status.CLOSED', cls: 'text-green-400 border-green-500/30 bg-green-500/10' },
};
const fmt = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString(); };

export function CapaDetailView({ capaId }: { capaId: string }) {
  const { t } = useTranslation('quality');
  const qc = useQueryClient();
  const { toast } = useToast();
  const [newAction, setNewAction] = useState('');
  const [effectiveness, setEffectiveness] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['quality', 'capa-detail', capaId],
    queryFn: () => api.get<any>(`/quality/capa/${capaId}`),
    staleTime: 15_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['quality', 'capa-detail', capaId] });
    qc.invalidateQueries({ queryKey: ['quality', 'capa'] });
  };
  const err = (e: any) => toast({ variant: 'destructive', title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.failed') });

  const addActionMut = useMutation({
    mutationFn: (description: string) => api.post(`/quality/capa/${capaId}/actions`, { description }),
    onSuccess: () => { setNewAction(''); invalidate(); toast({ title: t('toast.actionAdded') }); },
    onError: err,
  });
  const completeActionMut = useMutation({
    mutationFn: (actionId: string) => api.patch(`/quality/capa/${capaId}/actions/${actionId}/complete`, {}),
    onSuccess: () => { invalidate(); toast({ title: t('toast.actionCompleted') }); },
    onError: err,
  });
  const verifyMut = useMutation({
    mutationFn: (eff: string) => api.patch(`/quality/capa/${capaId}/verify`, { effectiveness: eff }),
    onSuccess: () => { setEffectiveness(''); invalidate(); toast({ title: t('toast.capaVerified') }); },
    onError: err,
  });
  const closeMut = useMutation({
    mutationFn: () => api.patch(`/quality/capa/${capaId}/close`, {}),
    onSuccess: () => { invalidate(); toast({ title: t('toast.capaClosed') }); },
    onError: err,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t('capaDetail.loading')}</div>;
  if (isError || !data) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/quality/capa"><Button variant="outline" size="sm"><ArrowLeft size={14} className="mr-1.5" /> {t('common.back')}</Button></Link>
        <div className="text-sm text-red-400">{t('capaDetail.notFound')}</div>
      </div>
    );
  }

  const c = data;
  const cfg = STATUS_CFG[c.status] ?? STATUS_CFG.OPEN;
  const actions: any[] = c.actions ?? [];
  const allDone = actions.length > 0 && actions.every((a) => a.status === 'COMPLETED');
  const canVerify = c.status === 'IN_PROGRESS' && allDone;
  const canClose = c.status === 'VERIFIED';

  const exportPdf = () => exportRecordToPDF(`CAPA ${c.capaNumber}`, c.title ?? '', [
    { heading: t('pdf.summary'), fields: [
      { label: t('capa.col.capa'), value: c.capaNumber }, { label: t('cform.title'), value: c.title },
      { label: t('cform.type'), value: c.type }, { label: t('cform.priority'), value: c.priority }, { label: t('capa.col.status'), value: STATUS_CFG[c.status] ? t(STATUS_CFG[c.status].labelKey) : c.status },
      { label: t('qd.relatedNcr'), value: c.ncr?.ncrNumber ?? '—' }, { label: t('cform.description'), value: c.description },
    ]},
    { heading: t('pdf.ownership'), fields: [
      { label: t('qd.owner'), value: c.assignedTo?.name ?? '—' }, { label: t('qd.dueDate'), value: fmt(c.dueDate) },
      { label: t('pdf.verifiedAt'), value: fmt(c.verifiedAt) }, { label: t('qd.effectiveness'), value: c.effectiveness ?? '—' },
    ]},
    { heading: t('pdf.actionPlan'), fields: actions.length
      ? actions.map((a, i) => ({ label: t('pdf.actionN', { n: i + 1 }), value: `[${a.status}] ${a.description}` }))
      : [{ label: t('capa.col.actions'), value: t('common.none') }] },
  ]);

  return (
    <div className="p-6 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link href="/quality/capa" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft size={13} className="mr-1" /> {t('capaDetail.backToRegister')}
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2 font-mono">
            <ShieldCheck size={20} className="text-primary" /> {c.capaNumber}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">{c.type}</Badge>
            <Badge variant="outline">{c.priority}</Badge>
            <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border', cfg.cls)}>{t(cfg.labelKey)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={exportPdf}><Download size={13} /> PDF</Button>
          {canClose && <Button size="sm" className="h-8 text-xs" disabled={closeMut.isPending} onClick={() => closeMut.mutate()}>{t('capaDetail.closeCapa')}</Button>}
        </div>
      </div>

      <div><div className="text-lg font-semibold">{c.title}</div>
        {c.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{c.description}</p>}</div>

      <div className="rounded-xl border border-border/60 p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
        <F icon={AlertTriangle} label={t('qd.relatedNcr')} node={c.ncr ? <Link className="text-primary hover:underline" href="/quality/ncr">{c.ncr.ncrNumber}</Link> : '—'} />
        <F icon={User} label={t('qd.owner')} value={c.assignedTo?.name} />
        <F icon={CalendarClock} label={t('qd.dueDate')} value={fmt(c.dueDate)} />
        <F icon={Gauge} label={t('qd.effectiveness')} value={c.effectiveness} />
      </div>

      {/* Action plan */}
      <div className="rounded-xl border border-border/60 p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold flex items-center gap-1.5"><ClipboardList size={14} className="text-primary" /> {t('capaDetail.actionPlan', { count: actions.length })}</h2>
          <span className="text-xs text-muted-foreground">{t('capaDetail.completedCount', { done: actions.filter(a => a.status === 'COMPLETED').length, total: actions.length })}</span>
        </div>

        <div className="space-y-2">
          {actions.length === 0 && <p className="text-sm text-muted-foreground">{t('qd.noActions')}</p>}
          {actions.map((a) => (
            <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2">
              {a.status === 'COMPLETED'
                ? <CheckCircle2 size={15} className="text-green-400 shrink-0" />
                : <Circle size={15} className="text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                <div className="text-sm">{a.description}</div>
                <div className="text-[10px] text-muted-foreground">{a.status === 'COMPLETED' ? t('capaDetail.completedAt', { date: fmt(a.completedAt) }) : t('capaDetail.open')}</div>
              </div>
              {a.status !== 'COMPLETED' && c.status !== 'CLOSED' && (
                <Button size="sm" variant="outline" className="h-7 text-xs" disabled={completeActionMut.isPending} onClick={() => completeActionMut.mutate(a.id)}>
                  {t('capaDetail.markDone')}
                </Button>
              )}
            </div>
          ))}
        </div>

        {c.status !== 'CLOSED' && c.status !== 'VERIFIED' && (
          <div className="flex items-end gap-2 mt-3">
            <div className="flex-1">
              <Label className="text-xs">{t('capaDetail.newAction')}</Label>
              <Input value={newAction} onChange={(e) => setNewAction(e.target.value)} placeholder={t('qd.actionPlaceholder')} className="mt-1 h-8 text-xs" />
            </div>
            <Button size="sm" className="h-8 text-xs gap-1" disabled={newAction.trim().length < 5 || addActionMut.isPending} onClick={() => addActionMut.mutate(newAction.trim())}>
              <Plus size={13} /> {t('capaDetail.add')}
            </Button>
          </div>
        )}
      </div>

      {/* Verification */}
      {(canVerify || c.status === 'VERIFIED' || c.status === 'CLOSED') && (
        <div className="rounded-xl border border-border/60 p-4">
          <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><ShieldCheck size={14} className="text-primary" /> {t('capaDetail.effectivenessVerification')}</h2>
          {c.effectiveness ? (
            <div className="text-sm"><span className="text-muted-foreground">{t('capaDetail.verifiedNote', { date: fmt(c.verifiedAt) })}</span>{c.effectiveness}</div>
          ) : canVerify ? (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label className="text-xs">{t('capaDetail.effectivenessNote')}</Label>
                <Input value={effectiveness} onChange={(e) => setEffectiveness(e.target.value)} placeholder={t('capaDetail.effectivenessPlaceholder')} className="mt-1 h-8 text-xs" />
              </div>
              <Button size="sm" className="h-8 text-xs" disabled={effectiveness.trim().length < 10 || verifyMut.isPending} onClick={() => verifyMut.mutate(effectiveness.trim())}>
                {t('capaDetail.verify')}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      {/* Evidence — supporting documents for the corrective/preventive action */}
      <div className="rounded-xl border border-border/60 p-4">
        <Attachments entityType="CAPA" entityId={c.id} category="EVIDENCE" title={t('common:attach.evidence')} />
      </div>
    </div>
  );
}

function F({ icon: Icon, label, value, node }: { icon: any; label: string; value?: string | null; node?: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Icon size={11} /> {label}</div>
      <div className="font-medium mt-0.5">{node ?? value ?? '—'}</div>
    </div>
  );
}
