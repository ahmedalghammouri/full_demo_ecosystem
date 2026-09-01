'use client';

/**
 * FailureModeManager — inline manager dialog for a machine's FMEA failure modes.
 *
 * Mirrors the MasterDataSelect "manage" pattern (add / edit / delete) but the
 * data is machine-scoped and richer (category + severity/occurrence/detection →
 * RPN + recommended action). Opened from the gear button next to the Failure
 * Mode field in the maintenance work-order form.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Check, X, Sparkles } from 'lucide-react';

import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectMenu } from '@/components/ui/select-menu';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { toast } from '@/components/ui/use-toast';

export interface FailureModeItem {
  id: string;
  code: string;
  description: string;
  category: string;
  rpn: number;
  recommendedAction?: string | null;
  causeDescription?: string | null;
  effectDescription?: string | null;
  severityScore?: number;
  occurrenceScore?: number;
  detectionScore?: number;
}

const CATEGORIES = [
  'MECHANICAL', 'ELECTRICAL', 'PROCESS', 'MATERIAL', 'OPERATOR',
  'CHANGEOVER', 'UTILITY', 'QUALITY', 'EXTERNAL',
] as const;

interface FormState {
  description: string;
  category: string;
  severityScore: string;
  occurrenceScore: string;
  detectionScore: string;
  recommendedAction: string;
}

const EMPTY_FORM: FormState = {
  description: '',
  category: 'MECHANICAL',
  severityScore: '1',
  occurrenceScore: '1',
  detectionScore: '1',
  recommendedAction: '',
};

const rpnOf = (f: FormState) =>
  (Number(f.severityScore) || 1) * (Number(f.occurrenceScore) || 1) * (Number(f.detectionScore) || 1);

export function FailureModeManager({
  machineId, machineName, open, onOpenChange,
}: {
  machineId: string;
  machineName?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation('maintenance');
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ['maintenance', 'failure-modes', machineId],
    queryFn: () => api.get('/maintenance/failure-modes', { params: { machineId } }),
    enabled: open && !!machineId,
    staleTime: 60_000,
  });
  const items: FailureModeItem[] = (data as any) ?? [];

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['maintenance', 'failure-modes', machineId] });
  const errMsg = (e: unknown) =>
    (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? t('fmManager.opFailed');

  const resetForm = () => { setForm(EMPTY_FORM); setEditId(null); };

  const payload = (f: FormState) => ({
    machineId,
    description: f.description.trim(),
    category: f.category,
    severityScore: Number(f.severityScore) || 1,
    occurrenceScore: Number(f.occurrenceScore) || 1,
    detectionScore: Number(f.detectionScore) || 1,
    recommendedAction: f.recommendedAction.trim() || undefined,
  });

  const createMut = useMutation({
    mutationFn: () => api.post('/maintenance/failure-modes', payload(form)),
    onSuccess: () => { invalidate(); resetForm(); toast({ title: t('fmManager.added') }); },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });

  const updateMut = useMutation({
    mutationFn: (id: string) => {
      const { machineId: _m, ...rest } = payload(form);
      return api.patch(`/maintenance/failure-modes/${id}`, rest);
    },
    onSuccess: () => { invalidate(); resetForm(); toast({ title: t('fmManager.updated') }); },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete<{ deleted?: boolean; disabled?: boolean; usedBy?: number }>(`/maintenance/failure-modes/${id}`),
    onSuccess: (res) => {
      invalidate();
      toast(res?.disabled
        ? { title: t('fmManager.disabled'), description: t('fmManager.disabledDesc', { count: res.usedBy }) }
        : { title: t('fmManager.deleted') });
    },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });

  const seedMut = useMutation({
    mutationFn: () => api.post<{ created: number; skipped: number }>('/maintenance/failure-modes/seed-standard', { machineId }),
    onSuccess: (res) => { invalidate(); toast({ title: t('fmManager.seeded', { created: res.created, skipped: res.skipped }) }); },
    onError: (e) => toast({ title: errMsg(e), variant: 'destructive' }),
  });

  const startEdit = (it: FailureModeItem) => {
    setEditId(it.id);
    setForm({
      description: it.description,
      category: it.category,
      severityScore: String(it.severityScore ?? 1),
      occurrenceScore: String(it.occurrenceScore ?? 1),
      detectionScore: String(it.detectionScore ?? 1),
      recommendedAction: it.recommendedAction ?? '',
    });
  };

  const submit = () => {
    if (!form.description.trim()) return;
    if (editId) updateMut.mutate(editId);
    else createMut.mutate();
  };

  const busy = createMut.isPending || updateMut.isPending;
  const scoreOpts = Array.from({ length: 10 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-base">{t('fmManager.title')}</DialogTitle>
          <DialogDescription>
            {machineName ? t('fmManager.descFor', { machine: machineName }) : t('fmManager.desc')}
          </DialogDescription>
        </DialogHeader>

        {/* Add / Edit form */}
        <div className="rounded-lg border border-border/60 p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2 space-y-1">
              <Label className="text-xs">{t('fmManager.description')} *</Label>
              <Input
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t('fmManager.descriptionPlaceholder')}
                className="h-9"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('fmManager.category')}</Label>
              <SelectMenu
                size="md" fullWidth
                value={form.category}
                onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}
                options={CATEGORIES.map((c) => ({ value: c, label: c }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t('fmManager.recommendedAction')}</Label>
              <Input
                value={form.recommendedAction}
                onChange={(e) => setForm((f) => ({ ...f, recommendedAction: e.target.value }))}
                placeholder={t('fmManager.recommendedActionPlaceholder')}
                className="h-9"
              />
            </div>
            <div className="grid grid-cols-4 gap-2 sm:col-span-2">
              <div className="space-y-1">
                <Label className="text-[10px]">{t('fmManager.severity')}</Label>
                <SelectMenu size="md" fullWidth value={form.severityScore} onValueChange={(v) => setForm((f) => ({ ...f, severityScore: v }))} options={scoreOpts} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t('fmManager.occurrence')}</Label>
                <SelectMenu size="md" fullWidth value={form.occurrenceScore} onValueChange={(v) => setForm((f) => ({ ...f, occurrenceScore: v }))} options={scoreOpts} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t('fmManager.detection')}</Label>
                <SelectMenu size="md" fullWidth value={form.detectionScore} onValueChange={(v) => setForm((f) => ({ ...f, detectionScore: v }))} options={scoreOpts} />
              </div>
              <div className="space-y-1">
                <Label className="text-[10px]">{t('fmManager.rpn')}</Label>
                <div className="h-9 flex items-center justify-center rounded-md border border-border/60 bg-muted/30 text-sm font-semibold">
                  {rpnOf(form)}
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <Button type="button" variant="ghost" size="sm" disabled={seedMut.isPending} onClick={() => seedMut.mutate()}>
              <Sparkles size={13} className="mr-1" /> {t('fmManager.seedStandard')}
            </Button>
            <div className="flex gap-2">
              {editId && (
                <Button type="button" variant="outline" size="sm" onClick={resetForm}>{t('fmManager.cancel')}</Button>
              )}
              <Button type="button" size="sm" disabled={!form.description.trim() || busy} onClick={submit}>
                {editId ? <><Check size={14} className="mr-1" /> {t('fmManager.save')}</> : <><Plus size={14} className="mr-1" /> {t('fmManager.add')}</>}
              </Button>
            </div>
          </div>
        </div>

        {/* List */}
        <div className="max-h-72 overflow-y-auto space-y-1.5 -mx-1 px-1">
          {items.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">{t('fmManager.empty')}</p>
          )}
          {items.map((it) => (
            <div key={it.id} className={`flex items-start gap-2 rounded-md border border-border/60 px-3 py-2 ${editId === it.id ? 'ring-1 ring-primary/50' : ''}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-mono text-muted-foreground">{it.code}</span>
                  <span className="text-sm font-medium truncate">{it.description}</span>
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {it.category} · RPN {it.rpn}
                  {it.recommendedAction ? ` · ${it.recommendedAction}` : ''}
                </div>
              </div>
              <button type="button" className="p-1 text-muted-foreground hover:text-foreground hover:bg-muted rounded" onClick={() => startEdit(it)} title={t('fmManager.edit')}>
                <Pencil size={13} />
              </button>
              <button type="button" className="p-1 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded" disabled={deleteMut.isPending} onClick={() => deleteMut.mutate(it.id)} title={t('fmManager.delete')}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
