'use client';

/**
 * QualityChecksPanel — record a quality inspection on the spot from the tablet.
 * Pick a quality plan → its parameters load → enter measurements (auto pass/fail
 * vs spec limits, or manual) → submit. Plan instruction files are shown read-only;
 * after submit the worker can attach evidence photos to the created inspection.
 * Reuses the existing POST /quality/inspections contract — no new backend.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, FlaskConical, CheckCircle2, Check, X, Loader2 } from 'lucide-react';

import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { Attachments } from '@/components/ui/attachments';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

interface QPlanParam { id: string; name: string; unit?: string | null; lsl?: number | null; usl?: number | null; nominalValue?: number | null; checkMethod?: string | null; isKPI?: boolean }
interface QPlan { id: string; code: string; name: string; type: string; isActive?: boolean; parameters: QPlanParam[] }
interface MeasRow { parameterId: string; parameterName: string; value: string; pass: boolean | null; notes: string }

const INSP_TYPES = ['PATROL', 'IN_PROCESS', 'INCOMING', 'FINAL'] as const;

export function QualityChecksPanel() {
  const { t } = useTranslation(['maintenance', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [planId, setPlanId] = useState('');
  const [type, setType] = useState<string>('PATROL');
  const [rows, setRows] = useState<MeasRow[]>([]);
  const [totalQty, setTotalQty] = useState('1');
  const [passQty, setPassQty] = useState('1');
  const [failQty, setFailQty] = useState('0');
  const [notes, setNotes] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);

  const { data: plansData } = useQuery({
    queryKey: ['quality', 'plans', 'floor'],
    queryFn: () => api.get<{ data?: QPlan[] } | QPlan[]>('/quality/plans'),
    staleTime: 60_000,
  });
  const plans: QPlan[] = (Array.isArray(plansData) ? plansData : (plansData as any)?.data ?? [])
    .filter((p: QPlan) => p.isActive !== false);
  const plan = plans.find((p) => p.id === planId);

  const selectPlan = (id: string) => {
    setPlanId(id);
    setCreatedId(null);
    const p = plans.find((x) => x.id === id);
    setRows((p?.parameters ?? []).map((pr) => ({ parameterId: pr.id, parameterName: pr.name, value: '', pass: null, notes: '' })));
  };

  // Auto pass/fail against the parameter's spec limits when a value is entered.
  const setValue = (idx: number, value: string) => {
    setRows((rs) => rs.map((r, i) => {
      if (i !== idx) return r;
      const pr = plan?.parameters.find((p) => p.id === r.parameterId);
      let pass = r.pass;
      const num = Number(value);
      if (value.trim() !== '' && Number.isFinite(num) && pr && (pr.lsl != null || pr.usl != null)) {
        pass = (pr.lsl == null || num >= pr.lsl) && (pr.usl == null || num <= pr.usl);
      }
      return { ...r, value, pass };
    }));
  };
  const togglePass = (idx: number, pass: boolean) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, pass } : r)));

  const createMut = useMutation({
    mutationFn: () => {
      const measurements = rows.filter((r) => r.value.trim() !== '' || r.pass != null).map((r) => ({
        parameterId: r.parameterId, parameterName: r.parameterName,
        value: r.value.trim() !== '' ? Number(r.value) : undefined,
        pass: r.pass ?? undefined, notes: r.notes || undefined,
      }));
      return api.post<{ id: string }>('/quality/inspections', {
        type,
        totalQty: parseInt(totalQty) || 0,
        passQty: parseInt(passQty) || 0,
        failQty: failQty ? parseInt(failQty) : undefined,
        planId: planId || undefined,
        notes: notes || undefined,
        measurements: measurements.length ? measurements : undefined,
      });
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['quality'] });
      setCreatedId(res.id);
      toast({ title: t('mfloor.q.recorded') });
    },
    onError: (e: any) => toast({ title: e?.response?.data?.message ?? t('maintenance:toast.error'), variant: 'destructive' }),
  });

  const reset = () => { setCreatedId(null); selectPlan(planId); setNotes(''); setTotalQty('1'); setPassQty('1'); setFailQty('0'); };

  return (
    <div className="flex-1 overflow-auto p-4 sm:p-6 space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-2xl">
        <div className="space-y-1.5">
          <Label className="text-xs">{t('mfloor.q.plan')}</Label>
          <SelectMenu size="md" fullWidth value={planId} onValueChange={selectPlan}
            placeholder={t('mfloor.q.selectPlan')}
            options={plans.length ? plans.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })) : [{ value: '', label: t('mfloor.q.noPlans') }]} />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">{t('mfloor.q.type')}</Label>
          <SelectMenu size="md" fullWidth value={type} onValueChange={setType}
            options={INSP_TYPES.map((ty) => ({ value: ty, label: t(`mfloor.q.types.${ty}`) }))} />
        </div>
      </div>

      {!planId ? (
        <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
          <FlaskConical size={36} className="mb-3 opacity-40" />
          <p className="text-sm">{t('mfloor.q.pickToStart')}</p>
        </div>
      ) : createdId ? (
        <div className="max-w-2xl space-y-4">
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 p-4 flex items-center gap-2 text-sm text-emerald-400">
            <CheckCircle2 size={18} /> {t('mfloor.q.recordedDone')}
          </div>
          <div className="rounded-xl border border-border/60 p-4">
            <Attachments entityType="QUALITY_INSPECTION" entityId={createdId} category="EVIDENCE" title={t('common:attach.evidence')} />
          </div>
          <Button variant="outline" className="h-10 gap-1.5" onClick={reset}>
            <ClipboardCheck size={15} /> {t('mfloor.q.recordAnother')}
          </Button>
        </div>
      ) : (
        <div className="max-w-3xl space-y-4">
          {/* Plan instructions (read) */}
          <div className="rounded-xl border border-border/60 p-4">
            <Attachments entityType="QUALITY_PLAN" entityId={planId} category="INSTRUCTION" title={t('common:attach.instructions')} readOnly />
          </div>

          {/* Quantities */}
          <div className="grid grid-cols-3 gap-3 max-w-md">
            <div className="space-y-1"><Label className="text-[11px]">{t('mfloor.q.totalQty')}</Label><Input type="number" min="0" value={totalQty} onChange={(e) => setTotalQty(e.target.value)} className="h-10" /></div>
            <div className="space-y-1"><Label className="text-[11px]">{t('mfloor.q.passQty')}</Label><Input type="number" min="0" value={passQty} onChange={(e) => setPassQty(e.target.value)} className="h-10 border-green-500/40" /></div>
            <div className="space-y-1"><Label className="text-[11px]">{t('mfloor.q.failQty')}</Label><Input type="number" min="0" value={failQty} onChange={(e) => setFailQty(e.target.value)} className="h-10 border-red-500/40" /></div>
          </div>

          {/* Per-parameter checklist */}
          {rows.length > 0 && (
            <div className="rounded-xl border border-border/60 divide-y divide-border/40">
              {rows.map((r, idx) => {
                const pr = plan?.parameters.find((p) => p.id === r.parameterId);
                const lo = pr?.lsl != null ? String(pr.lsl) : '—';
                const hi = pr?.usl != null ? String(pr.usl) : '—';
                const spec = pr && (pr.lsl != null || pr.usl != null) ? `${lo} … ${hi}${pr.unit ? ' ' + pr.unit : ''}` : (pr?.unit ?? '');
                return (
                  <div key={r.parameterId} className="p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium">{r.parameterName}{pr?.isKPI && <span className="ml-1.5 text-[9px] text-amber-400">KPI</span>}</p>
                      {spec && <p className="text-[10px] text-muted-foreground">{spec}</p>}
                      {pr?.checkMethod && <p className="text-[10px] text-muted-foreground italic">{pr.checkMethod}</p>}
                    </div>
                    <Input type="number" value={r.value} onChange={(e) => setValue(idx, e.target.value)} placeholder={t('mfloor.q.value')} className="h-10 w-full sm:w-32" />
                    <div className="flex gap-1.5">
                      <button type="button" onClick={() => togglePass(idx, true)}
                        className={cn('h-10 px-3 rounded-lg border flex items-center gap-1 text-xs font-semibold', r.pass === true ? 'bg-green-600 text-white border-green-600' : 'border-border text-muted-foreground')}>
                        <Check size={14} /> {t('mfloor.q.pass')}
                      </button>
                      <button type="button" onClick={() => togglePass(idx, false)}
                        className={cn('h-10 px-3 rounded-lg border flex items-center gap-1 text-xs font-semibold', r.pass === false ? 'bg-red-600 text-white border-red-600' : 'border-border text-muted-foreground')}>
                        <X size={14} /> {t('mfloor.q.fail')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5 max-w-2xl">
            <Label className="text-xs">{t('mform.internalNotes')}</Label>
            <textarea className="w-full min-h-[64px] rounded-md border border-input bg-background px-3 py-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          <Button className="h-11 gap-1.5 bg-emerald-600 hover:bg-emerald-700" disabled={!totalQty || createMut.isPending} onClick={() => createMut.mutate()}>
            {createMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />} {t('mfloor.q.submit')}
          </Button>
        </div>
      )}
    </div>
  );
}
