'use client';

/**
 * PlannedDowntimeManager — manage planned (scheduled) downtime events:
 * generate this week from shifts, add manual entries, list & delete.
 *
 * Extracted from Shift Configuration so it can live where downtime belongs:
 * the Downtime Management module and the Planned Downtime Schedule page.
 */

import React, { useEffect, useState } from 'react';
import { toFactoryDayKey, formatDateTime, dateTimeLocalToIso } from '@/lib/datetime';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, Plus, Trash2, ShieldOff, Coffee, Sparkles, Timer } from 'lucide-react';

import { api } from '@/services/api.client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { SelectMenu } from '@/components/ui/select-menu';
import { FormDialog } from '@/components/ui/form-dialog';
import { InlineFormSlot } from '@/components/ui/inline-form-panel';
import { TablePagination } from '@/components/ui/table-pagination';
import {
  usePlannedCauses, usePlannedDowntime, useGeneratePlannedDowntime,
  useAddPlannedDowntime, useDeletePlannedDowntime,
} from './use-shifts';
import { ScopeTreePicker, type ScopeSelection } from './scope-tree-picker';

const causeIcon = (category?: string) =>
  category === 'PLANNED_CLEANING' ? Sparkles : category === 'PLANNED_BREAK' ? Coffee : ShieldOff;

const weekRange = () => {
  const today = new Date();
  const iso = (d: Date) => toFactoryDayKey(d);
  return { dateFrom: iso(today), dateTo: iso(new Date(today.getTime() + 6 * 86_400_000)) };
};

export function PlannedDowntimeManager() {
  const { t } = useTranslation('production');
  const { data: causes } = usePlannedCauses();

  const [pdPage, setPdPage] = useState(1);
  const [pdMachine, setPdMachine] = useState('ALL');
  useEffect(() => { setPdPage(1); }, [pdMachine]);
  const { data: plannedResp } = usePlannedDowntime({
    limit: 15,
    page: pdPage,
    machineId: pdMachine === 'ALL' ? undefined : pdMachine,
  });

  const { data: machinesData } = useQuery({
    queryKey: ['machines-list'],
    queryFn: () => api.get('/hierarchy/machines?limit=50'),
    staleTime: 60_000,
  });
  const machines: Array<{ id: string; name: string; code: string }> =
    ((machinesData as any)?.data ?? (Array.isArray(machinesData) ? machinesData : [])) as any[];

  const plannedGenMut = useGeneratePlannedDowntime();
  const addPlannedMut = useAddPlannedDowntime();
  const deletePlannedMut = useDeletePlannedDowntime();

  const todayIso = toFactoryDayKey(new Date());
  const [addPdOpen, setAddPdOpen] = useState(false);
  const [pd, setPd] = useState<{ causeId: string; scope: ScopeSelection | null; date: string; time: string; durationMinutes: string; notes: string }>({
    causeId: '', scope: null, date: todayIso, time: '13:00', durationMinutes: '30', notes: '',
  });
  const patchPd = (p: Partial<typeof pd>) => setPd((s) => ({ ...s, ...p }));
  const openAddPd = () => {
    setPd({ causeId: causes?.[0]?.id ?? '', scope: null, date: todayIso, time: '13:00', durationMinutes: '30', notes: '' });
    setAddPdOpen(true);
  };
  const pdValid = !!pd.causeId && !!pd.scope && !!pd.date && /^([01]\d|2[0-3]):([0-5]\d)$/.test(pd.time) && Number(pd.durationMinutes) > 0;
  const submitPd = () => {
    if (!pd.scope) return;
    // An unparseable date/time must not be sent as "now" — the API would accept
    // it and the planner would never learn their entry was discarded.
    const startTime = dateTimeLocalToIso(`${pd.date}T${pd.time}`);
    if (!startTime) return;
    addPlannedMut.mutate({
      causeId: pd.causeId,
      scopeType: pd.scope.type,
      scopeId: pd.scope.id,
      // The typed time is PLANT-local. `new Date('2026-08-24T13:00')` reads it in
      // the BROWSER's zone, so a planner working from anywhere but the plant was
      // scheduling a different instant than the one they typed.
      startTime,
      durationMinutes: Number(pd.durationMinutes),
      notes: pd.notes.trim() || undefined,
    }, { onSuccess: () => setAddPdOpen(false) });
  };

  const generatePlannedWeek = () => plannedGenMut.mutate(weekRange());

  const plannedEvents = plannedResp?.data ?? [];
  const totalPlannedMinutes = plannedResp?.totalPlannedMinutes ?? 0;

  return (
    <div className="space-y-4">
      <InlineFormSlot />

      <div className="rounded-xl border border-border/60 bg-card p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-xl">
            <h3 className="font-semibold flex items-center gap-2"><ShieldOff size={16} className="text-emerald-400" /> {t('plannedDowntime.title')}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {t('plannedDowntime.description')}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Button variant="outline" onClick={generatePlannedWeek} disabled={plannedGenMut.isPending}>
              <CalendarPlus size={16} className="mr-2" />
              {t('plannedDowntime.generateWeek')}
            </Button>
            <Button onClick={openAddPd}>
              <Plus size={16} className="mr-2" />
              {t('plannedDowntime.addPlanned')}
            </Button>
          </div>
        </div>

        {/* Linked reason codes */}
        <div className="mt-4 flex flex-wrap gap-2">
          {(causes ?? []).map((c) => {
            const Icon = causeIcon(c.category);
            return (
              <span key={c.id} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/40 px-2.5 py-1 text-xs">
                <Icon size={13} className="text-muted-foreground" />
                <span className="font-medium">{c.name}</span>
                <Badge variant="outline" className="text-[10px] font-mono ml-1">{c.code}</Badge>
              </span>
            );
          })}
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 px-2.5 py-1 text-xs">
            <Timer size={13} /> {t('plannedDowntime.minLogged', { count: totalPlannedMinutes })}
          </span>
        </div>
      </div>

      {/* Machine filter */}
      <div className="flex items-center gap-2">
        <SelectMenu
          value={pdMachine}
          onValueChange={setPdMachine}
          menuLabel={t('plannedDowntime.machine')}
          options={[
            { value: 'ALL', label: t('plannedDowntime.allMachines') },
            ...machines.map((m) => ({ value: m.id, label: `${m.code} — ${m.name}` })),
          ]}
        />
        <span className="ml-auto text-xs text-muted-foreground">
          {t('plannedDowntime.eventsCount', { count: (plannedResp as any)?.total ?? plannedEvents.length })}
        </span>
      </div>

      <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="text-left">
              <th className="px-4 py-2 font-medium">{t('plannedDowntime.col.start')}</th>
              <th className="px-4 py-2 font-medium">{t('plannedDowntime.col.machine')}</th>
              <th className="px-4 py-2 font-medium">{t('plannedDowntime.col.reason')}</th>
              <th className="px-4 py-2 font-medium">{t('plannedDowntime.col.type')}</th>
              <th className="px-4 py-2 font-medium text-right">{t('plannedDowntime.col.minutes')}</th>
              <th className="px-4 py-2 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody>
            {plannedEvents.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                {t('plannedDowntime.noPlanned')}<strong>{t('plannedDowntime.noPlannedAdd')}</strong>{t('plannedDowntime.noPlannedOr')}<strong>{t('plannedDowntime.noPlannedGenerate')}</strong>{t('plannedDowntime.noPlannedEnd')}
              </td></tr>
            ) : plannedEvents.map((e) => {
              const Icon = causeIcon(e.category);
              return (
                <tr key={e.id} className="border-t border-border/50">
                  {/*
                    Rendered in the FACTORY's zone, not sliced out of the ISO
                    string. Slicing shows the stored UTC instant verbatim, so a
                    break at 13:00 in Riyadh read 10:00 on screen — a correct
                    value displayed three hours early, every row of the table.
                  */}
                  <td className="px-4 py-2 tabular-nums">{formatDateTime(e.startTime)}</td>
                  <td className="px-4 py-2">{e.machine?.name ?? '—'} <span className="text-muted-foreground font-mono text-xs">{e.machine?.code}</span></td>
                  <td className="px-4 py-2">{e.cause?.name ?? '—'}</td>
                  <td className="px-4 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <Icon size={13} className="text-muted-foreground" />
                      <span className="text-xs">{e.category.replace('PLANNED_', '').toLowerCase()}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{e.durationMinutes ?? '—'}</td>
                  <td className="px-4 py-2 text-right">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      onClick={() => deletePlannedMut.mutate(e.id)} disabled={deletePlannedMut.isPending}>
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {(((plannedResp as any)?.total ?? 0) > 15) && (
          <div className="border-t border-border/50 px-4 py-2">
            <TablePagination page={pdPage} total={(plannedResp as any)?.total ?? 0} limit={15} onPageChange={setPdPage} />
          </div>
        )}
      </div>

      {/* Add Planned Downtime (manual) */}
      <FormDialog
        open={addPdOpen}
        onClose={() => setAddPdOpen(false)}
        title={t('plannedDowntime.addTitle')}
        onSubmit={submitPd}
        submitLabel={t('plannedDowntime.add')}
        isSubmitting={addPlannedMut.isPending}
        isValid={pdValid}
      >
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{t('plannedDowntime.reason')}</Label>
            <SelectMenu
              size="md"
              fullWidth
              value={pd.causeId}
              onValueChange={(v) => patchPd({ causeId: v })}
              placeholder={t('plannedDowntime.selectReason')}
              options={(causes ?? []).map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))}
            />
          </div>

          <div className="space-y-1.5">
            <Label>{t('plannedDowntime.applyTo')}</Label>
            {pd.scope && (
              <div className="text-xs mb-1.5 inline-flex items-center gap-1.5 rounded bg-primary/10 text-primary px-2 py-1">
                <span className="font-mono uppercase text-[10px]">{pd.scope.type}</span>
                <span className="font-medium">{pd.scope.name}</span>
                <span className="font-mono text-[10px] opacity-70">{pd.scope.code}</span>
              </div>
            )}
            <ScopeTreePicker value={pd.scope} onSelect={(sel) => patchPd({ scope: sel })} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>{t('plannedDowntime.date')}</Label>
              <Input type="date" value={pd.date} onChange={(e) => patchPd({ date: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('plannedDowntime.startTime')}</Label>
              <Input type="time" value={pd.time} onChange={(e) => patchPd({ time: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>{t('plannedDowntime.durationMin')}</Label>
              <Input type="number" value={pd.durationMinutes} onChange={(e) => patchPd({ durationMinutes: e.target.value })} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>{t('plannedDowntime.notesOptional')}</Label>
            <Input value={pd.notes} onChange={(e) => patchPd({ notes: e.target.value })} placeholder={t('plannedDowntime.notesPlaceholder')} />
          </div>

          <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground">
            {t('plannedDowntime.createsPre')}
            <strong className="text-foreground">
              {pd.scope ? (pd.scope.type === 'MACHINE' ? t('plannedDowntime.scopeMachine') : pd.scope.type === 'LINE' ? t('plannedDowntime.scopeLine') : t('plannedDowntime.scopeArea')) : '…'}
            </strong>{t('plannedDowntime.createsPost')}
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
