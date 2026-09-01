'use client';
/**
 * Planned stops — the time that is deliberately not production.
 *
 * Everything on this screen removes minutes from the OEE availability
 * denominator, which is why it exists at all: those minutes used to be two
 * fields on the shift template defaulting to 30 each, applied to every machine
 * in the factory at times the code picked. Nobody had entered any of it, and it
 * moved every availability figure in the plant.
 *
 * Three sections, because there are exactly three ways a planned stop happens:
 *   Schedules   — when things recur (shared with shift templates)
 *   Planned stops — inside a shift, or on their own schedule
 *   Work-order rules — with an order, such as changeover
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, CalendarClock, AlertTriangle, Info, PlayCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormDialog } from '@/components/ui/form-dialog';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

const WEEKDAYS = [
  { value: 0, key: 'sun' }, { value: 1, key: 'mon' }, { value: 2, key: 'tue' },
  { value: 3, key: 'wed' }, { value: 4, key: 'thu' }, { value: 5, key: 'fri' },
  { value: 6, key: 'sat' },
];

// Kept in step with the DowntimeCategory enum. A category the database
// accepts but this list omits leaves the form's Category select with no
// matching option, so it renders BLANK over a row that is correctly stored —
// which is exactly how STARTUP looked after it was added everywhere else.
const CATEGORIES = [
  'PLANNED_BREAK', 'PLANNED_CLEANING', 'PLANNED_MAINTENANCE',
  'STARTUP', 'CHANGEOVER', 'OTHER',
];

const TRIGGERS = ['PRODUCT_CHANGE', 'ORDER_CHANGE', 'ALWAYS'];

const emptySchedule = {
  name: '', daysOfWeek: [] as number[],
  mode: 'PERPETUAL' as 'PERPETUAL' | 'RANGE' | 'ONE_OFF',
  startDate: '', endDate: '', oneOffDate: '',
};

const emptyStop = {
  code: '', name: '', durationMinutes: '30',
  attachTo: 'SHIFT' as 'SHIFT' | 'SCHEDULE',
  shiftTemplateId: '', scheduleRuleId: '',
  startOffsetMin: '0', startTimeLocal: '',
  scope: 'LINE' as 'FACTORY' | 'LINE' | 'MACHINE',
  targetIds: [] as string[],
  category: 'PLANNED_BREAK',
  causeId: '',
};

const emptyWoRule = {
  code: '', name: '', trigger: 'PRODUCT_CHANGE', durationMinutes: '30',
  category: 'CHANGEOVER', affectsOEE: true, lineId: '', machineId: '', skuId: '',
};

export function PlannedStopsView() {
  const { t } = useTranslation(['production', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: stopsResp, isLoading } = useQuery({
    queryKey: ['planned-stops'],
    queryFn: () => api.get('/planned-stops'),
    staleTime: 15_000,
  });
  const stops: any[] = Array.isArray(stopsResp) ? stopsResp : ((stopsResp as any)?.data ?? []);

  const { data: schedResp } = useQuery({
    queryKey: ['planned-stops', 'schedules'],
    queryFn: () => api.get('/planned-stops/schedules'),
    staleTime: 15_000,
  });
  const schedules: any[] = Array.isArray(schedResp) ? schedResp : ((schedResp as any)?.data ?? []);

  const { data: woResp } = useQuery({
    queryKey: ['planned-stops', 'work-order-rules'],
    queryFn: () => api.get('/planned-stops/work-order-rules'),
    staleTime: 15_000,
  });
  const woRules: any[] = Array.isArray(woResp) ? woResp : ((woResp as any)?.data ?? []);

  const { data: tplResp } = useQuery({
    queryKey: ['shifts', 'templates', false],
    queryFn: () => api.get('/shifts/templates'),
    staleTime: 60_000,
  });
  const shiftTemplates: any[] = Array.isArray(tplResp) ? tplResp : ((tplResp as any)?.data ?? []);

  const { data: linesResp } = useQuery({ queryKey: ['hierarchy', 'lines'], queryFn: () => api.get('/hierarchy/lines'), staleTime: 60_000 });
  const { data: machinesResp } = useQuery({ queryKey: ['hierarchy', 'machines'], queryFn: () => api.get('/hierarchy/machines'), staleTime: 60_000 });
  const lines: any[] = Array.isArray(linesResp) ? linesResp : ((linesResp as any)?.data ?? []);
  const machines: any[] = Array.isArray(machinesResp) ? machinesResp : ((machinesResp as any)?.data ?? []);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['planned-stops'] });

  // ── Schedules ─────────────────────────────────────────────────────────────
  const [schedOpen, setSchedOpen] = useState(false);
  const [editSched, setEditSched] = useState<any | null>(null);
  const [schedForm, setSchedForm] = useState({ ...emptySchedule });
  const [delSched, setDelSched] = useState<{ id: string; name: string } | null>(null);

  const saveSched = useMutation({
    mutationFn: (dto: any) =>
      editSched ? api.patch(`/planned-stops/schedules/${editSched.id}`, dto) : api.post('/planned-stops/schedules', dto),
    onSuccess: () => { toast({ title: t('plannedStops.saved') }); invalidate(); setSchedOpen(false); setEditSched(null); },
    onError: (e: any) => toast({ title: t('plannedStops.saveFailed'), description: e?.message, variant: 'destructive' }),
  });
  const delSchedMut = useMutation({
    mutationFn: (id: string) => api.delete(`/planned-stops/schedules/${id}`),
    onSuccess: () => { toast({ title: t('plannedStops.deleted') }); invalidate(); setDelSched(null); },
    onError: (e: any) => toast({ title: t('plannedStops.deleteFailed'), description: e?.message, variant: 'destructive' }),
  });

  const submitSched = () => {
    const f = schedForm;
    saveSched.mutate({
      name: f.name.trim() || t('plannedStops.schedule'),
      daysOfWeek: f.mode === 'ONE_OFF' ? [] : f.daysOfWeek,
      isPerpetual: f.mode === 'PERPETUAL',
      startDate: f.mode === 'RANGE' && f.startDate ? f.startDate : f.mode === 'PERPETUAL' && f.startDate ? f.startDate : null,
      endDate: f.mode === 'RANGE' && f.endDate ? f.endDate : null,
      oneOffDate: f.mode === 'ONE_OFF' && f.oneOffDate ? f.oneOffDate : null,
    });
  };

  const openSchedEdit = (r: any) => {
    setEditSched(r);
    setSchedForm({
      name: r.name ?? '',
      daysOfWeek: Array.isArray(r.daysOfWeek) ? r.daysOfWeek : [],
      mode: r.oneOffDate ? 'ONE_OFF' : r.isPerpetual ? 'PERPETUAL' : 'RANGE',
      startDate: r.startDate ? String(r.startDate).slice(0, 10) : '',
      endDate: r.endDate ? String(r.endDate).slice(0, 10) : '',
      oneOffDate: r.oneOffDate ? String(r.oneOffDate).slice(0, 10) : '',
    });
    setSchedOpen(true);
  };

  const toggleDay = (d: number) =>
    setSchedForm(f => ({
      ...f,
      daysOfWeek: f.daysOfWeek.includes(d) ? f.daysOfWeek.filter(x => x !== d) : [...f.daysOfWeek, d].sort(),
    }));

  const schedValid = schedForm.mode === 'ONE_OFF'
    ? !!schedForm.oneOffDate
    : schedForm.daysOfWeek.length > 0;

  // ── Planned stops ─────────────────────────────────────────────────────────
  const [stopOpen, setStopOpen] = useState(false);
  const [editStop, setEditStop] = useState<any | null>(null);
  const [stopForm, setStopForm] = useState({ ...emptyStop });
  const [delStop, setDelStop] = useState<{ id: string; name: string } | null>(null);

  const saveStop = useMutation({
    mutationFn: (dto: any) =>
      editStop ? api.patch(`/planned-stops/${editStop.id}`, dto) : api.post('/planned-stops', dto),
    onSuccess: () => { toast({ title: t('plannedStops.saved') }); invalidate(); setStopOpen(false); setEditStop(null); },
    onError: (e: any) => toast({ title: t('plannedStops.saveFailed'), description: e?.message, variant: 'destructive' }),
  });
  const delStopMut = useMutation({
    mutationFn: (id: string) => api.delete(`/planned-stops/${id}`),
    onSuccess: () => { toast({ title: t('plannedStops.deleted') }); invalidate(); setDelStop(null); },
    onError: (e: any) => toast({ title: t('plannedStops.deleteFailed'), description: e?.message, variant: 'destructive' }),
  });

  const openStopEdit = (s: any) => {
    setEditStop(s);
    setStopForm({
      code: s.code ?? '', name: s.name ?? '',
      durationMinutes: String(s.durationMinutes ?? 30),
      attachTo: s.shiftTemplateId ? 'SHIFT' : 'SCHEDULE',
      shiftTemplateId: s.shiftTemplateId ?? '',
      scheduleRuleId: s.scheduleRuleId ?? '',
      startOffsetMin: String(s.startOffsetMin ?? 0),
      startTimeLocal: s.startTimeLocal ?? '',
      scope: s.scope ?? 'LINE',
      targetIds: (s.targets ?? []).map((x: any) => x.machineId ?? x.lineId).filter(Boolean),
      category: s.category ?? 'PLANNED_BREAK',
      causeId: s.causeId ?? '',
    });
    setStopOpen(true);
  };

  const submitStop = () => {
    const f = stopForm;
    saveStop.mutate({
      code: f.code.trim(), name: f.name.trim(),
      durationMinutes: Number(f.durationMinutes),
      shiftTemplateId: f.attachTo === 'SHIFT' ? f.shiftTemplateId || null : null,
      scheduleRuleId: f.attachTo === 'SCHEDULE' ? f.scheduleRuleId || null : null,
      startOffsetMin: Number(f.startOffsetMin) || 0,
      startTimeLocal: f.attachTo === 'SCHEDULE' ? (f.startTimeLocal || null) : null,
      scope: f.scope,
      category: f.category,
      causeId: f.causeId || null,
      targets: f.scope === 'FACTORY' ? [] : f.targetIds.map(id =>
        f.scope === 'MACHINE' ? { machineId: id } : { lineId: id }),
    });
  };

  const stopValid = !!(stopForm.code && stopForm.name && Number(stopForm.durationMinutes) > 0
    && (stopForm.attachTo === 'SHIFT'
      ? stopForm.shiftTemplateId
      // A stop on its own schedule has no shift to be measured from, so without
      // a clock time there is nowhere on the day to put it. The server refuses
      // it; refusing here too means the reader is told before they lose the form.
      : stopForm.scheduleRuleId && /^([01]?\d|2[0-3]):[0-5]\d$/.test(stopForm.startTimeLocal)));

  const targetOptions = stopForm.scope === 'MACHINE' ? machines : lines;

  // ── Materialise ───────────────────────────────────────────────────────────
  const [range, setRange] = useState(() => {
    const today = new Date().toISOString().slice(0, 10);
    return { from: today, to: today };
  });
  const materialise = useMutation({
    mutationFn: () => api.post('/planned-stops/materialise', { dateFrom: range.from, dateTo: range.to }),
    onSuccess: (r: any) => {
      const res = r?.data ?? r;
      toast({
        title: t('plannedStops.materialised', { created: res?.created ?? 0, skipped: res?.skipped ?? 0 }),
        description: res?.notScheduled?.length
          ? t('plannedStops.notScheduled', { list: res.notScheduled.join(', ') })
          : undefined,
      });
      invalidate();
    },
    onError: (e: any) => toast({ title: t('plannedStops.materialiseFailed'), description: e?.message, variant: 'destructive' }),
  });

  // ── Work-order rules ──────────────────────────────────────────────────────
  const [woOpen, setWoOpen] = useState(false);
  const [editWo, setEditWo] = useState<any | null>(null);
  const [woForm, setWoForm] = useState({ ...emptyWoRule });
  const [delWo, setDelWo] = useState<{ id: string; code: string } | null>(null);

  const saveWo = useMutation({
    mutationFn: (dto: any) =>
      editWo ? api.patch(`/planned-stops/work-order-rules/${editWo.id}`, dto) : api.post('/planned-stops/work-order-rules', dto),
    onSuccess: () => { toast({ title: t('plannedStops.saved') }); invalidate(); setWoOpen(false); setEditWo(null); },
    onError: (e: any) => toast({ title: t('plannedStops.saveFailed'), description: e?.message, variant: 'destructive' }),
  });
  const delWoMut = useMutation({
    mutationFn: (id: string) => api.delete(`/planned-stops/work-order-rules/${id}`),
    onSuccess: () => { toast({ title: t('plannedStops.deleted') }); invalidate(); setDelWo(null); },
    onError: (e: any) => toast({ title: t('plannedStops.deleteFailed'), description: e?.message, variant: 'destructive' }),
  });

  const openWoEdit = (r: any) => {
    setEditWo(r);
    setWoForm({
      code: r.code ?? '', name: r.name ?? '', trigger: r.trigger ?? 'PRODUCT_CHANGE',
      durationMinutes: String(r.durationMinutes ?? 30), category: r.category ?? 'CHANGEOVER',
      affectsOEE: r.affectsOEE !== false,
      lineId: r.lineId ?? '', machineId: r.machineId ?? '', skuId: r.skuId ?? '',
    });
    setWoOpen(true);
  };

  const submitWo = () => {
    saveWo.mutate({
      code: woForm.code.trim(), name: woForm.name.trim(),
      trigger: woForm.trigger, durationMinutes: Number(woForm.durationMinutes),
      category: woForm.category, affectsOEE: woForm.affectsOEE,
      lineId: woForm.lineId || null, machineId: woForm.machineId || null, skuId: woForm.skuId || null,
    });
  };

  const woValid = !!(woForm.code && woForm.name && Number(woForm.durationMinutes) > 0);

  // Stops that can never produce anything, because scope was never resolved.
  const untargeted = useMemo(
    () => stops.filter((s) => s.scope !== 'FACTORY' && (s.targets ?? []).length === 0),
    [stops],
  );

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarClock size={22} /> {t('plannedStops.title')}
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t('plannedStops.subtitle')}</p>
      </div>

      {untargeted.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm flex gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <b>{t('plannedStops.untargetedTitle', { count: untargeted.length })}</b>
            <p className="text-xs text-muted-foreground mt-1">{t('plannedStops.untargetedBody')}</p>
            <p className="text-xs font-mono mt-1">{untargeted.map((s) => s.code).join(', ')}</p>
          </div>
        </div>
      )}

      {/* ── Schedules ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">{t('plannedStops.schedules')}</h2>
          <Button size="sm" variant="outline" onClick={() => { setEditSched(null); setSchedForm({ ...emptySchedule }); setSchedOpen(true); }}>
            <Plus size={15} className="mr-1" /> {t('plannedStops.addSchedule')}
          </Button>
        </div>
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('plannedStops.name')}</TableHead>
                <TableHead>{t('plannedStops.recurrence')}</TableHead>
                <TableHead>{t('plannedStops.usedBy')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {schedules.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-xs py-6 text-muted-foreground">{t('plannedStops.noSchedules')}</TableCell></TableRow>
              )}
              {schedules.map((r) => (
                <TableRow key={r.id} className={cn(r.isActive === false && 'opacity-50')}>
                  <TableCell className="text-sm">{r.name}</TableCell>
                  <TableCell className="text-xs">{r.summary}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {t('plannedStops.usedByCount', {
                      shifts: r._count?.shiftTemplates ?? 0,
                      stops: r._count?.plannedStops ?? 0,
                    })}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openSchedEdit(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDelSched({ id: r.id, name: r.name })}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 flex gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('plannedStops.holidayHelp')}
        </p>
      </section>

      {/* ── Planned stops ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">{t('plannedStops.stops')}</h2>
          <div className="flex items-center gap-2">
            <Input type="date" className="h-9 w-36 text-xs" value={range.from}
              onChange={(e) => setRange(r => ({ ...r, from: e.target.value }))} />
            <Input type="date" className="h-9 w-36 text-xs" value={range.to}
              onChange={(e) => setRange(r => ({ ...r, to: e.target.value }))} />
            <Button size="sm" variant="outline" onClick={() => materialise.mutate()} disabled={materialise.isPending}>
              <PlayCircle size={15} className="mr-1" /> {t('plannedStops.materialise')}
            </Button>
            <Button size="sm" onClick={() => { setEditStop(null); setStopForm({ ...emptyStop }); setStopOpen(true); }}>
              <Plus size={15} className="mr-1" /> {t('plannedStops.addStop')}
            </Button>
          </div>
        </div>
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('plannedStops.stop')}</TableHead>
                <TableHead>{t('plannedStops.duration')}</TableHead>
                <TableHead>{t('plannedStops.when')}</TableHead>
                <TableHead>{t('plannedStops.appliesTo')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={5} className="text-center text-xs py-6 text-muted-foreground">{t('common:loading')}</TableCell></TableRow>
              )}
              {!isLoading && stops.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-xs py-6 text-muted-foreground">{t('plannedStops.noStops')}</TableCell></TableRow>
              )}
              {stops.map((s) => (
                <TableRow key={s.id} className={cn(s.isActive === false && 'opacity-50')}>
                  <TableCell className="text-sm">
                    <div className="font-medium">{s.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{s.code}</div>
                  </TableCell>
                  <TableCell className="text-sm">{s.durationMinutes} {t('plannedStops.min')}</TableCell>
                  <TableCell className="text-xs">
                    {s.shiftTemplate
                      ? t('plannedStops.insideShift', {
                          shift: s.shiftTemplate.code,
                          offset: Math.round((s.startOffsetMin ?? 0) / 60 * 10) / 10,
                        })
                      : s.scheduleRule
                        // The clock time is the whole point of the row: a
                        // schedule name says WHICH DAYS, and says nothing about
                        // when on the day the line actually stops.
                        ? <>
                            <span className="font-medium tabular-nums">{s.startTimeLocal ?? '—'}</span>
                            <span className="text-muted-foreground"> · {s.scheduleRule.name}</span>
                            {!s.startTimeLocal && (
                              <div className="text-amber-500">{t('plannedStops.noStartTime')}</div>
                            )}
                          </>
                        : <span className="text-amber-500">{t('plannedStops.noSchedule')}</span>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {s.scope === 'FACTORY'
                      ? <Badge variant="secondary" className="text-[10px]">{t('plannedStops.wholeFactory')}</Badge>
                      : (s.targets ?? []).length === 0
                        ? <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">{t('plannedStops.noTarget')}</Badge>
                        : (s.targets ?? []).map((x: any) => x.machine?.code ?? x.line?.code).join(', ')}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openStopEdit(s)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDelStop({ id: s.id, name: s.name })}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* ── Work-order rules ── */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">{t('plannedStops.woRules')}</h2>
          <Button size="sm" variant="outline" onClick={() => { setEditWo(null); setWoForm({ ...emptyWoRule }); setWoOpen(true); }}>
            <Plus size={15} className="mr-1" /> {t('plannedStops.addWoRule')}
          </Button>
        </div>
        <div className="rounded-lg border border-border/50 overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('plannedStops.rule')}</TableHead>
                <TableHead>{t('plannedStops.trigger')}</TableHead>
                <TableHead>{t('plannedStops.duration')}</TableHead>
                <TableHead>{t('plannedStops.chargedToOee')}</TableHead>
                <TableHead>{t('plannedStops.appliesTo')}</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {woRules.length === 0 && (
                <TableRow><TableCell colSpan={6} className="text-center text-xs py-6 text-muted-foreground">{t('plannedStops.noWoRules')}</TableCell></TableRow>
              )}
              {woRules.map((r) => (
                <TableRow key={r.id} className={cn(r.isActive === false && 'opacity-50')}>
                  <TableCell className="text-sm">
                    <div className="font-medium">{r.name}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{r.code}</div>
                  </TableCell>
                  <TableCell><Badge variant="secondary" className="text-[10px]">{r.trigger}</Badge></TableCell>
                  <TableCell className="text-sm">{r.durationMinutes} {t('plannedStops.min')}</TableCell>
                  <TableCell>
                    {r.affectsOEE
                      ? <Badge className="text-[10px] bg-emerald-500/15 text-emerald-500 border-emerald-500/30">{t('plannedStops.yes')}</Badge>
                      : <Badge variant="outline" className="text-[10px]">{t('plannedStops.no')}</Badge>}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.machine?.code ?? r.line?.code ?? t('plannedStops.everywhere')}
                    {r.sku?.code ? ` · ${r.sku.code}` : ''}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openWoEdit(r)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setDelWo({ id: r.id, code: r.code })}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] text-muted-foreground mt-2 flex gap-1.5">
          <Info className="h-3.5 w-3.5 shrink-0 mt-px" /> {t('plannedStops.woHelp')}
        </p>
      </section>

      {/* ── Schedule dialog ── */}
      <FormDialog
        open={schedOpen}
        onClose={() => { setSchedOpen(false); setEditSched(null); }}
        onSubmit={submitSched}
        title={editSched ? t('plannedStops.editSchedule') : t('plannedStops.newSchedule')}
        isSubmitting={saveSched.isPending}
        isValid={schedValid}
      >
        <div className="space-y-4">
          <div>
            <Label>{t('plannedStops.name')}</Label>
            <Input className="mt-1" value={schedForm.name} onChange={(e) => setSchedForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div>
            <Label>{t('plannedStops.mode')}</Label>
            <Select value={schedForm.mode} onValueChange={(v: any) => setSchedForm(f => ({ ...f, mode: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="PERPETUAL">{t('plannedStops.modePerpetual')}</SelectItem>
                <SelectItem value="RANGE">{t('plannedStops.modeRange')}</SelectItem>
                <SelectItem value="ONE_OFF">{t('plannedStops.modeOneOff')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {schedForm.mode === 'ONE_OFF' ? (
            <div>
              <Label>{t('plannedStops.date')}</Label>
              <Input type="date" className="mt-1" value={schedForm.oneOffDate}
                onChange={(e) => setSchedForm(f => ({ ...f, oneOffDate: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground mt-1">{t('plannedStops.oneOffHelp')}</p>
            </div>
          ) : (
            <>
              <div>
                <Label>{t('plannedStops.workingDays')}</Label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d.value}
                      type="button"
                      onClick={() => toggleDay(d.value)}
                      className={cn(
                        'px-3 py-1.5 rounded-md border text-xs transition-colors',
                        schedForm.daysOfWeek.includes(d.value)
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border/60 text-muted-foreground hover:border-border',
                      )}
                    >
                      {t(`plannedStops.day.${d.key}`)}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground mt-2">{t('plannedStops.holidayHelp')}</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{t('plannedStops.startDate')}</Label>
                  <Input type="date" className="mt-1" value={schedForm.startDate}
                    onChange={(e) => setSchedForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                {schedForm.mode === 'RANGE' && (
                  <div>
                    <Label>{t('plannedStops.endDate')}</Label>
                    <Input type="date" className="mt-1" value={schedForm.endDate}
                      onChange={(e) => setSchedForm(f => ({ ...f, endDate: e.target.value }))} />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </FormDialog>

      {/* ── Planned stop dialog ── */}
      <FormDialog
        open={stopOpen}
        onClose={() => { setStopOpen(false); setEditStop(null); }}
        onSubmit={submitStop}
        title={editStop ? t('plannedStops.editStop', { name: editStop.name }) : t('plannedStops.newStop')}
        isSubmitting={saveStop.isPending}
        isValid={stopValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('plannedStops.code')}</Label>
            <Input className="mt-1 font-mono text-xs" value={stopForm.code} placeholder="S1-BREAK"
              disabled={!!editStop}
              onChange={(e) => setStopForm(f => ({ ...f, code: e.target.value }))} />
          </div>
          <div>
            <Label>{t('plannedStops.name')}</Label>
            <Input className="mt-1" value={stopForm.name}
              onChange={(e) => setStopForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div>
            <Label>{t('plannedStops.duration')} ({t('plannedStops.min')})</Label>
            <Input type="number" min={1} className="mt-1" value={stopForm.durationMinutes}
              onChange={(e) => setStopForm(f => ({ ...f, durationMinutes: e.target.value }))} />
          </div>
          <div>
            <Label>{t('plannedStops.category')}</Label>
            <Select value={stopForm.category} onValueChange={(v) => setStopForm(f => ({ ...f, category: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>{t('plannedStops.attachTo')}</Label>
            <Select value={stopForm.attachTo} onValueChange={(v: any) => setStopForm(f => ({ ...f, attachTo: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SHIFT">{t('plannedStops.attachShift')}</SelectItem>
                <SelectItem value="SCHEDULE">{t('plannedStops.attachSchedule')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {stopForm.attachTo === 'SHIFT' ? (
            <>
              <div>
                <Label>{t('plannedStops.shift')}</Label>
                <Select value={stopForm.shiftTemplateId} onValueChange={(v) => setStopForm(f => ({ ...f, shiftTemplateId: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder={t('plannedStops.pickShift')} /></SelectTrigger>
                  <SelectContent>
                    {shiftTemplates.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.code} — {s.name} ({s.startTime})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('plannedStops.offsetFromStart')}</Label>
                <Input type="number" min={0} className="mt-1" value={stopForm.startOffsetMin}
                  onChange={(e) => setStopForm(f => ({ ...f, startOffsetMin: e.target.value }))} />
                <p className="text-[11px] text-muted-foreground mt-1">{t('plannedStops.offsetHelp')}</p>
              </div>
            </>
          ) : (
            <>
            <div className="col-span-2">
              <Label>{t('plannedStops.startTime')}</Label>
              <Input type="time" className="mt-1" value={stopForm.startTimeLocal}
                onChange={(e) => setStopForm(f => ({ ...f, startTimeLocal: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground mt-1">{t('plannedStops.startTimeHelp')}</p>
            </div>
            <div className="col-span-2">
              <Label>{t('plannedStops.schedule')}</Label>
              <Select value={stopForm.scheduleRuleId} onValueChange={(v) => setStopForm(f => ({ ...f, scheduleRuleId: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder={t('plannedStops.pickSchedule')} /></SelectTrigger>
                <SelectContent>
                  {schedules.map((r: any) => (
                    <SelectItem key={r.id} value={r.id}>{r.name} — {r.summary}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            </>
          )}

          <div className="col-span-2 border-t border-border/40 pt-3">
            <Label>{t('plannedStops.scope')}</Label>
            <Select value={stopForm.scope} onValueChange={(v: any) => setStopForm(f => ({ ...f, scope: v, targetIds: [] }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FACTORY">{t('plannedStops.scopeFactory')}</SelectItem>
                <SelectItem value="LINE">{t('plannedStops.scopeLine')}</SelectItem>
                <SelectItem value="MACHINE">{t('plannedStops.scopeMachine')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">{t('plannedStops.scopeHelp')}</p>
          </div>

          {stopForm.scope !== 'FACTORY' && (
            <div className="col-span-2">
              <Label>{stopForm.scope === 'MACHINE' ? t('plannedStops.machines') : t('plannedStops.lines')}</Label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {targetOptions.map((o: any) => (
                  <button
                    key={o.id}
                    type="button"
                    onClick={() => setStopForm(f => ({
                      ...f,
                      targetIds: f.targetIds.includes(o.id)
                        ? f.targetIds.filter(x => x !== o.id)
                        : [...f.targetIds, o.id],
                    }))}
                    className={cn(
                      'px-3 py-1.5 rounded-md border text-xs transition-colors',
                      stopForm.targetIds.includes(o.id)
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'border-border/60 text-muted-foreground hover:border-border',
                    )}
                  >
                    {o.code}
                  </button>
                ))}
              </div>
              {stopForm.targetIds.length === 0 && (
                <p className="text-[11px] text-amber-500 mt-1.5">{t('plannedStops.noTargetWarn')}</p>
              )}
            </div>
          )}
        </div>
      </FormDialog>

      {/* ── Work-order rule dialog ── */}
      <FormDialog
        open={woOpen}
        onClose={() => { setWoOpen(false); setEditWo(null); }}
        onSubmit={submitWo}
        title={editWo ? t('plannedStops.editWoRule', { code: editWo.code }) : t('plannedStops.newWoRule')}
        isSubmitting={saveWo.isPending}
        isValid={woValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('plannedStops.code')}</Label>
            <Input className="mt-1 font-mono text-xs" value={woForm.code} placeholder="CO-30"
              disabled={!!editWo}
              onChange={(e) => setWoForm(f => ({ ...f, code: e.target.value }))} />
          </div>
          <div>
            <Label>{t('plannedStops.name')}</Label>
            <Input className="mt-1" value={woForm.name}
              onChange={(e) => setWoForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="col-span-2">
            <Label>{t('plannedStops.trigger')}</Label>
            <Select value={woForm.trigger} onValueChange={(v) => setWoForm(f => ({ ...f, trigger: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRIGGERS.map(x => <SelectItem key={x} value={x}>{t(`plannedStops.trigger_${x}`)}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              {t(`plannedStops.triggerHelp_${woForm.trigger}`)}
            </p>
          </div>

          <div>
            <Label>{t('plannedStops.duration')} ({t('plannedStops.min')})</Label>
            <Input type="number" min={1} className="mt-1" value={woForm.durationMinutes}
              onChange={(e) => setWoForm(f => ({ ...f, durationMinutes: e.target.value }))} />
          </div>
          <div>
            <Label>{t('plannedStops.category')}</Label>
            <Select value={woForm.category} onValueChange={(v) => setWoForm(f => ({ ...f, category: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 rounded-lg border border-border/40 bg-muted/20 p-3">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="mt-1" checked={woForm.affectsOEE}
                onChange={(e) => setWoForm(f => ({ ...f, affectsOEE: e.target.checked }))} />
              <span>
                <span className="text-sm">{t('plannedStops.chargedToOee')}</span>
                <span className="block text-[11px] text-muted-foreground">{t('plannedStops.chargedHelp')}</span>
              </span>
            </label>
          </div>

          <div>
            <Label>{t('plannedStops.limitToLine')}</Label>
            <Select value={woForm.lineId || 'ALL'} onValueChange={(v) => setWoForm(f => ({ ...f, lineId: v === 'ALL' ? '' : v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('plannedStops.everywhere')}</SelectItem>
                {lines.map((l: any) => <SelectItem key={l.id} value={l.id}>{l.code} — {l.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('plannedStops.limitToMachine')}</Label>
            <Select value={woForm.machineId || 'ALL'} onValueChange={(v) => setWoForm(f => ({ ...f, machineId: v === 'ALL' ? '' : v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t('plannedStops.everywhere')}</SelectItem>
                {machines.map((m: any) => <SelectItem key={m.id} value={m.id}>{m.code} — {m.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FormDialog>

      <DeleteDialog open={!!delSched} onClose={() => setDelSched(null)}
        onConfirm={() => delSched && delSchedMut.mutate(delSched.id)}
        title={t('plannedStops.deleteScheduleTitle', { name: delSched?.name })}
        description={t('plannedStops.deleteScheduleDesc')} isDeleting={delSchedMut.isPending} />

      <DeleteDialog open={!!delStop} onClose={() => setDelStop(null)}
        onConfirm={() => delStop && delStopMut.mutate(delStop.id)}
        title={t('plannedStops.deleteStopTitle', { name: delStop?.name })}
        description={t('plannedStops.deleteStopDesc')} isDeleting={delStopMut.isPending} />

      <DeleteDialog open={!!delWo} onClose={() => setDelWo(null)}
        onConfirm={() => delWo && delWoMut.mutate(delWo.id)}
        title={t('plannedStops.deleteWoTitle', { code: delWo?.code })}
        description={t('plannedStops.deleteWoDesc')} isDeleting={delWoMut.isPending} />
    </div>
  );
}
