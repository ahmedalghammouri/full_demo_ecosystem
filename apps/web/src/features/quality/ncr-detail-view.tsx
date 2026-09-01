'use client';

import { useTranslation } from 'react-i18next';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, AlertTriangle, Factory, Boxes, Package, User, CalendarClock, FileText,
  Hash, ClipboardCheck, Wrench, ShieldCheck, CheckCircle2, Download,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';
import { exportRecordToPDF } from '@/lib/export-utils';
import { Attachments } from '@/components/ui/attachments';

const SEV: Record<string, { labelKey: string; cls: string }> = {
  MINOR: { labelKey: 'ncr.severity.MINOR', cls: 'text-blue-400 border-blue-500/30 bg-blue-500/10' },
  MAJOR: { labelKey: 'ncr.severity.MAJOR', cls: 'text-amber-400 border-amber-500/30 bg-amber-500/10' },
  CRITICAL: { labelKey: 'ncr.severity.CRITICAL', cls: 'text-red-400 border-red-500/30 bg-red-500/10' },
};
const STATUS_LABEL_KEYS: Record<string, string> = {
  OPEN: 'ncr.status.OPEN', IN_REVIEW: 'ncr.status.IN_REVIEW', CAPA_PENDING: 'ncr.status.CAPA_PENDING', RESOLVED: 'ncr.status.RESOLVED', CLOSED: 'ncr.status.CLOSED',
};
const TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_REVIEW', 'RESOLVED'], IN_REVIEW: ['CAPA_PENDING', 'RESOLVED'],
  CAPA_PENDING: ['RESOLVED'], RESOLVED: ['CLOSED'], CLOSED: [],
};
const DISPOSITION_LABEL_KEYS: Record<string, string> = {
  USE_AS_IS: 'ncr.disposition.USE_AS_IS', REWORK: 'ncr.disposition.REWORK', SCRAP: 'ncr.disposition.SCRAP', RETURN_TO_SUPPLIER: 'ncr.disposition.RETURN_TO_SUPPLIER',
};

const fmt = (iso?: string | null) => { if (!iso) return '—'; const d = new Date(iso); return isNaN(d.getTime()) ? '—' : d.toLocaleString(); };

export function NcrDetailView({ ncrId }: { ncrId: string }) {
  const { t } = useTranslation('quality');
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['quality', 'ncr-detail', ncrId],
    queryFn: () => api.get<any>(`/quality/ncr/${ncrId}`),
    staleTime: 15_000,
  });

  const statusMut = useMutation({
    mutationFn: (status: string) => api.patch(`/quality/ncr/${ncrId}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['quality', 'ncr-detail', ncrId] });
      qc.invalidateQueries({ queryKey: ['quality', 'ncr'] });
      toast({ title: t('toast.ncrStatusUpdated') });
    },
    onError: (e: any) => toast({ variant: 'destructive', title: t('toast.error'), description: e?.response?.data?.message ?? t('toast.failed') }),
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t('ncrDetail.loading')}</div>;
  if (isError || !data) {
    return (
      <div className="p-6 space-y-4">
        <Link href="/quality/ncr"><Button variant="outline" size="sm"><ArrowLeft size={14} className="mr-1.5" /> {t('common.back')}</Button></Link>
        <div className="text-sm text-red-400">{t('ncrDetail.notFound')}</div>
      </div>
    );
  }

  const n = data;
  const sev = SEV[n.severity] ?? SEV.MINOR;
  const next = TRANSITIONS[n.status] ?? [];
  const statusLabel = (s: string) => (STATUS_LABEL_KEYS[s] ? t(STATUS_LABEL_KEYS[s]) : s);

  const exportPdf = () => exportRecordToPDF(`NCR ${n.ncrNumber}`, n.title ?? '', [
    { heading: t('pdf.summary'), fields: [
      { label: t('ncr.col.ncr'), value: n.ncrNumber }, { label: t('nform.title'), value: n.title },
      { label: t('nform.severity'), value: SEV[n.severity] ? t(SEV[n.severity].labelKey) : n.severity }, { label: t('ncr.col.status'), value: statusLabel(n.status) },
      { label: t('nform.description'), value: n.description },
    ]},
    { heading: t('ncrDetail.classification'), fields: [
      { label: t('qd.defectCategory'), value: n.defectCategory }, { label: t('qd.defectCode'), value: n.defectCode ?? '—' },
      { label: t('qd.ncQty'), value: String(n.quantity ?? '—') }, { label: t('qd.disposition'), value: DISPOSITION_LABEL_KEYS[n.disposition] ? t(DISPOSITION_LABEL_KEYS[n.disposition]) : (n.disposition ?? '—') },
    ]},
    { heading: t('ncrDetail.context'), fields: [
      { label: t('qd.machine'), value: n.machine ? `${n.machine.name} (${n.machine.code})` : '—' },
      { label: t('qd.batchLot'), value: n.batchRecord?.batchNumber ?? '—' },
      { label: t('qd.product'), value: n.sku ? `${n.sku.name} (${n.sku.code})` : '—' },
      { label: t('qd.detectedBy'), value: n.detectedBy?.name ?? '—' },
      { label: t('qd.detectedAt'), value: fmt(n.detectedAt) }, { label: t('qd.dueDate'), value: fmt(n.dueDate) },
    ]},
    { heading: t('ncrDetail.investigation'), fields: [
      { label: t('qd.rootCause'), value: n.rootCause ?? '—' },
      { label: t('qd.correctiveAction'), value: n.correctiveAction ?? '—' },
      { label: t('qd.preventiveAction'), value: n.preventiveAction ?? '—' },
    ]},
  ]);

  return (
    <div className="p-6 space-y-5 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="space-y-1">
          <Link href="/quality/ncr" className="inline-flex items-center text-xs text-muted-foreground hover:text-foreground">
            <ArrowLeft size={13} className="mr-1" /> {t('ncrDetail.backToRegister')}
          </Link>
          <h1 className="text-2xl font-bold flex items-center gap-2 font-mono">
            <AlertTriangle size={20} className="text-primary" /> {n.ncrNumber}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border', sev.cls)}>{t(sev.labelKey)}</span>
            <Badge variant="outline">{statusLabel(n.status)}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" className="gap-1.5 h-8 text-xs" onClick={exportPdf}><Download size={13} /> PDF</Button>
          {next.map((s) => (
            <Button key={s} size="sm" className="h-8 text-xs" disabled={statusMut.isPending} onClick={() => statusMut.mutate(s)}>
              → {statusLabel(s)}
            </Button>
          ))}
        </div>
      </div>

      <div><div className="text-lg font-semibold">{n.title}</div>
        {n.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{n.description}</p>}</div>

      <Section title={t('ncrDetail.classification')} icon={ClipboardCheck}>
        <Field icon={Hash} label={t('qd.defectCategory')} value={n.defectCategory} />
        <Field icon={Hash} label={t('qd.defectCode')} value={n.defectCode} />
        <Field icon={Boxes} label={t('qd.ncQty')} value={n.quantity != null ? String(n.quantity) : null} />
        <Field icon={Package} label={t('qd.disposition')} value={n.disposition ? t(`ncr.disposition.${n.disposition}`, { defaultValue: n.disposition }) : null} />
      </Section>

      <Section title={t('ncrDetail.context')} icon={Factory}>
        <Field icon={Factory} label={t('qd.machine')} value={n.machine ? `${n.machine.name} (${n.machine.code})` : null} />
        <Field icon={Boxes} label={t('qd.batchLot')} value={n.batchRecord?.batchNumber} />
        <Field icon={Package} label={t('qd.product')} value={n.sku ? `${n.sku.name} (${n.sku.code})` : null} />
        <Field icon={User} label={t('qd.detectedBy')} value={n.detectedBy?.name} />
        <Field icon={CalendarClock} label={t('qd.detectedAt')} value={fmt(n.detectedAt)} />
        <Field icon={CalendarClock} label={t('qd.dueDate')} value={fmt(n.dueDate)} />
      </Section>

      <Section title={t('ncrDetail.investigation')} icon={Wrench}>
        <Field icon={Wrench} label={t('qd.rootCause')} value={n.rootCause} full />
        <Field icon={ShieldCheck} label={t('qd.correctiveAction')} value={n.correctiveAction} full />
        <Field icon={ShieldCheck} label={t('qd.preventiveAction')} value={n.preventiveAction} full />
      </Section>

      {/* Linked CAPAs */}
      <div className="rounded-xl border border-border/60 p-4">
        <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><ShieldCheck size={14} className="text-primary" /> {t('ncrDetail.capaSection')}</h2>
        {Array.isArray(n.capas) && n.capas.length > 0 ? (
          <div className="space-y-2">
            {n.capas.map((c: any) => (
              <Link key={c.id} href={`/quality/capa/${c.id}`} className="flex items-center gap-3 rounded-lg border border-border/40 px-3 py-2 hover:bg-muted/20">
                <span className="font-mono text-xs text-primary">{c.capaNumber}</span>
                <span className="text-xs flex-1 truncate">{c.title}</span>
                <Badge variant="outline" className="text-[10px] h-5">{c.type}</Badge>
                <Badge variant="secondary" className="text-[10px] h-5">{c.status}</Badge>
              </Link>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('qd.noCapa')}</p>
        )}
      </div>

      {/* Evidence — defect photos / supporting documents */}
      <div className="rounded-xl border border-border/60 p-4">
        <Attachments entityType="NCR" entityId={n.id} category="EVIDENCE" title={t('common:attach.evidence')} />
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 p-4">
      <h2 className="text-sm font-semibold mb-3 flex items-center gap-1.5"><Icon size={14} className="text-primary" /> {title}</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">{children}</div>
    </div>
  );
}

function Field({ icon: Icon, label, value, full }: { icon: any; label: string; value?: string | null; full?: boolean }) {
  return (
    <div className={cn(full && 'col-span-2 md:col-span-3')}>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1"><Icon size={11} /> {label}</div>
      <div className="font-medium mt-0.5 whitespace-pre-wrap">{value || '—'}</div>
    </div>
  );
}
