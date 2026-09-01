'use client';
/**
 * Signal Interpretation — what a machine state MEANS for downtime and OEE.
 *
 * Two halves of one question:
 *
 *   Tag Browser  → how a wire becomes a STATE   (signalRole, pulse, idle)
 *   this page    → what that STATE then COSTS   (downtime? planned? charged to OEE?)
 *
 * Every value here used to be a constant in the edge gateway. Whether a
 * changeover is charged against availability, which reason code a starved
 * machine is filed under, how long a state must hold before it is believed —
 * those are plant decisions. A customer who classifies them differently should
 * not need a redeploy in order to say so.
 *
 * Precedence, matching the gateway exactly: a rule for a specific machine wins
 * over the factory-wide rule for the same state, which wins over the gateway's
 * built-in fallback. So one awkward machine can be treated differently without
 * forking the whole table.
 */
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, SlidersHorizontal, AlertTriangle, Info } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FormDialog } from '@/components/ui/form-dialog';
import { DeleteDialog } from '@/components/ui/delete-dialog';
import { DataModeBadge } from '@/components/ui/data-mode-badge';
import { useToast } from '@/components/ui/use-toast';
import { api } from '@/services/api.client';
import { cn } from '@/lib/utils';

/** States the gateway can produce. Kept in step with MachineState in the schema. */
const STATES = [
  'RUNNING', 'IDLE', 'STOPPED', 'BREAKDOWN', 'PLANNED_STOP',
  'STARTUP', 'SETUP', 'CHANGEOVER', 'MAINTENANCE', 'STARVED', 'BLOCKED', 'OFFLINE',
];

const CATEGORIES = [
  'MECHANICAL', 'ELECTRICAL', 'MATERIAL', 'PROCESS', 'QUALITY',
  'STARTUP', 'CHANGEOVER', 'PLANNED_MAINTENANCE', 'PLANNED_BREAK', 'EXTERNAL', 'OTHER',
];

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
const CONDITIONS = ['GT', 'GTE', 'LT', 'LTE', 'EQ', 'NEQ'];

/** What a bound signal means, and which thresholds that meaning needs. */
const SIGNAL_ROLES = [
  { value: 'RUN_MODE', needs: [] as string[] },
  { value: 'RUN_MODE_PULSED', needs: ['pulse'] },
  { value: 'PROCESSING', needs: ['idle'] },
  { value: 'INFEED_AVAILABLE', needs: [] },
  { value: 'OUTFEED_BLOCKED', needs: [] },
];

const emptySignal = {
  tagId: '',
  signalRole: 'RUN_MODE',
  pulseWindowMs: '',
  pulseMinEdges: '',
  idleThresholdMs: '',
};

const emptyAlarm = {
  code: '',
  name: '',
  tagId: '',
  severity: 'HIGH',
  category: 'PROCESS',
  condition: 'GT',
  threshold: '',
  deadband: '',
  delaySeconds: '0',
  autoAck: false,
  isActive: true,
};

const emptyForm = {
  state: 'BREAKDOWN',
  machineId: '',
  isDowntime: true,
  isPlanned: false,
  affectsOEE: true,
  reasonCode: '',
  category: 'OTHER',
  debounceSeconds: '0',
  description: '',
  isActive: true,
};

export function SignalRulesView() {
  const { t } = useTranslation(['iot', 'common']);
  const { toast } = useToast();
  const qc = useQueryClient();

  const [formOpen, setFormOpen] = useState(false);
  const [editRule, setEditRule] = useState<any | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ id: string; state: string } | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [scopeFilter, setScopeFilter] = useState('ALL');

  const [alarmOpen, setAlarmOpen] = useState(false);
  const [editAlarm, setEditAlarm] = useState<any | null>(null);
  const [alarmForm, setAlarmForm] = useState({ ...emptyAlarm });
  const [deleteAlarm, setDeleteAlarm] = useState<{ id: string; code: string } | null>(null);

  const { data: rulesResp, isLoading } = useQuery({
    queryKey: ['iot', 'state-rules'],
    queryFn: () => api.get('/iot/state-rules'),
    staleTime: 15_000,
  });
  const rules: any[] = Array.isArray(rulesResp) ? rulesResp : ((rulesResp as any)?.data ?? []);

  const { data: machinesResp } = useQuery({
    queryKey: ['hierarchy', 'machines'],
    queryFn: () => api.get('/hierarchy/machines'),
    staleTime: 60_000,
  });
  const machineOpts: any[] = Array.isArray(machinesResp) ? machinesResp : ((machinesResp as any)?.data ?? []);

  // Status tags carrying a signal role — shown so the two halves of the model
  // can be read on one screen instead of being reconciled from memory.
  const { data: tagsResp } = useQuery({
    queryKey: ['iot', 'tags', 'signals'],
    queryFn: () => api.get('/iot/tags', { params: { limit: 500 } }),
    staleTime: 30_000,
  });
  const allTags: any[] = (tagsResp as any)?.data ?? [];
  const signalTags: any[] = allTags.filter((tg: any) => tg.isMachineStatus || tg.signalRole);

  const { data: alarmDefsResp } = useQuery({
    queryKey: ['alarms', 'definitions'],
    queryFn: () => api.get('/alarms/definitions'),
    staleTime: 15_000,
  });
  const alarmDefs: any[] = Array.isArray(alarmDefsResp) ? alarmDefsResp : ((alarmDefsResp as any)?.data ?? []);

  const saveAlarm = useMutation({
    mutationFn: (dto: any) =>
      editAlarm ? api.patch(`/alarms/definitions/${editAlarm.id}`, dto) : api.post('/alarms/definitions', dto),
    onSuccess: () => {
      toast({ title: t('rules.alarmSaved') });
      qc.invalidateQueries({ queryKey: ['alarms', 'definitions'] });
      setAlarmOpen(false);
      setEditAlarm(null);
    },
    onError: (e: any) => toast({ title: t('rules.alarmSaveFailed'), description: e?.message, variant: 'destructive' }),
  });

  const deleteAlarmMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/alarms/definitions/${id}`),
    onSuccess: () => {
      toast({ title: t('rules.alarmDeleted') });
      qc.invalidateQueries({ queryKey: ['alarms', 'definitions'] });
      setDeleteAlarm(null);
    },
    onError: (e: any) => toast({ title: t('rules.alarmDeleteFailed'), description: e?.message, variant: 'destructive' }),
  });

  const openAlarmCreate = () => {
    setEditAlarm(null);
    setAlarmForm({ ...emptyAlarm });
    setAlarmOpen(true);
  };

  const openAlarmEdit = (a: any) => {
    setEditAlarm(a);
    setAlarmForm({
      code: a.code ?? '',
      name: a.name ?? '',
      tagId: a.tagId ?? '',
      severity: a.severity ?? 'HIGH',
      category: a.category ?? 'PROCESS',
      condition: a.condition ?? 'GT',
      threshold: a.threshold != null ? String(a.threshold) : '',
      deadband: a.deadband != null ? String(a.deadband) : '',
      delaySeconds: String(a.delaySeconds ?? 0),
      autoAck: !!a.autoAck,
      isActive: a.isActive !== false,
    });
    setAlarmOpen(true);
  };

  const submitAlarm = () => {
    saveAlarm.mutate({
      code: alarmForm.code.trim(),
      name: alarmForm.name.trim(),
      tagId: alarmForm.tagId,
      severity: alarmForm.severity,
      category: alarmForm.category,
      condition: alarmForm.condition,
      threshold: Number(alarmForm.threshold),
      deadband: alarmForm.deadband === '' ? null : Number(alarmForm.deadband),
      delaySeconds: Number(alarmForm.delaySeconds) || 0,
      autoAck: alarmForm.autoAck,
      isActive: alarmForm.isActive,
    });
  };

  // The threshold is what makes an alarm capable of firing at all; the API
  // rejects a definition without one, so the form should not offer to send it.
  const alarmValid = !!(alarmForm.code && alarmForm.name && alarmForm.tagId && alarmForm.threshold !== '');

  // ── Binding a signal to its meaning ───────────────────────────────────────
  // Edited here rather than only in the Tag Browser. A page called Signal
  // Interpretation that shows what a signal means but makes you go somewhere
  // else to change it is half a screen: you would have to leave, find the right
  // tag among hundreds, and come back to see the effect.
  const [signalOpen, setSignalOpen] = useState(false);
  const [editSignal, setEditSignal] = useState<any | null>(null);
  const [signalForm, setSignalForm] = useState({ ...emptySignal });

  const saveSignal = useMutation({
    mutationFn: (dto: any) => api.patch(`/iot/tags/${dto.tagId}`, dto.body),
    onSuccess: () => {
      toast({ title: t('rules.signalSaved') });
      qc.invalidateQueries({ queryKey: ['iot', 'tags', 'signals'] });
      qc.invalidateQueries({ queryKey: ['iot', 'tags', 'all'] });
      setSignalOpen(false);
      setEditSignal(null);
    },
    onError: (e: any) => toast({ title: t('rules.signalSaveFailed'), description: e?.message, variant: 'destructive' }),
  });

  const openSignalCreate = () => {
    setEditSignal(null);
    setSignalForm({ ...emptySignal });
    setSignalOpen(true);
  };

  const openSignalEdit = (tg: any) => {
    setEditSignal(tg);
    setSignalForm({
      tagId: tg.id,
      signalRole: tg.signalRole || 'RUN_MODE',
      pulseWindowMs: tg.pulseWindowMs != null ? String(tg.pulseWindowMs) : '',
      pulseMinEdges: tg.pulseMinEdges != null ? String(tg.pulseMinEdges) : '',
      idleThresholdMs: tg.idleThresholdMs != null ? String(tg.idleThresholdMs) : '',
    });
    setSignalOpen(true);
  };

  const submitSignal = () => {
    const num = (s: string) => (s === '' ? undefined : Number(s));
    saveSignal.mutate({
      tagId: signalForm.tagId,
      body: {
        // Binding a role is the statement that this tag drives machine state,
        // so set the flag with it rather than leaving a role nothing reads.
        isMachineStatus: true,
        signalRole: signalForm.signalRole,
        pulseWindowMs: num(signalForm.pulseWindowMs),
        pulseMinEdges: num(signalForm.pulseMinEdges),
        idleThresholdMs: num(signalForm.idleThresholdMs),
      },
    });
  };

  const roleNeeds = (what: string) =>
    SIGNAL_ROLES.find((r) => r.value === signalForm.signalRole)?.needs.includes(what) ?? false;

  // Only boolean points can carry a signal role — a role on a float register
  // would be read as "is it >= 1", which is not what anybody means by it.
  const bindableTags = allTags.filter(
    (tg: any) => tg.dataType === 'BOOL' || tg.registerType === 'DISCRETE' || tg.registerType === 'COIL' || tg.isMachineStatus,
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['iot', 'state-rules'] });
  };

  const saveMutation = useMutation({
    mutationFn: (dto: any) =>
      editRule ? api.patch(`/iot/state-rules/${editRule.id}`, dto) : api.post('/iot/state-rules', dto),
    onSuccess: () => {
      toast({ title: t('rules.saved') });
      invalidate();
      setFormOpen(false);
      setEditRule(null);
    },
    onError: (e: any) => toast({ title: t('rules.saveFailed'), description: e?.message, variant: 'destructive' }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/iot/state-rules/${id}`),
    onSuccess: () => {
      toast({ title: t('rules.deleted') });
      invalidate();
      setDeleteDialog(null);
    },
    onError: (e: any) => toast({ title: t('rules.deleteFailed'), description: e?.message, variant: 'destructive' }),
  });

  const filtered = useMemo(() => {
    if (scopeFilter === 'ALL') return rules;
    if (scopeFilter === 'FACTORY') return rules.filter((r) => !r.machineId);
    return rules.filter((r) => r.machineId === scopeFilter);
  }, [rules, scopeFilter]);

  const openCreate = () => {
    setEditRule(null);
    setForm({ ...emptyForm });
    setFormOpen(true);
  };

  const openEdit = (r: any) => {
    setEditRule(r);
    setForm({
      state: r.state,
      machineId: r.machineId ?? '',
      isDowntime: !!r.isDowntime,
      isPlanned: !!r.isPlanned,
      affectsOEE: !!r.affectsOEE,
      reasonCode: r.reasonCode ?? '',
      category: r.category ?? 'OTHER',
      debounceSeconds: String(r.debounceSeconds ?? 0),
      description: r.description ?? '',
      isActive: r.isActive !== false,
    });
    setFormOpen(true);
  };

  const handleSubmit = () => {
    const dto: any = {
      state: form.state,
      machineId: form.machineId || null,
      isDowntime: form.isDowntime,
      isPlanned: form.isPlanned,
      affectsOEE: form.affectsOEE,
      reasonCode: form.reasonCode.trim() || null,
      category: form.category,
      debounceSeconds: Number(form.debounceSeconds) || 0,
      description: form.description.trim() || null,
      isActive: form.isActive,
    };
    saveMutation.mutate(dto);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 shrink-0">
        <div>
          <h1 className="text-lg font-bold flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            {t('rules.title')}
            <DataModeBadge mode="live" />
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">{t('rules.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="h-9 w-56 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('rules.scopeAll')}</SelectItem>
              <SelectItem value="FACTORY">{t('rules.scopeFactory')}</SelectItem>
              {machineOpts.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>{m.code} — {m.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" /> {t('rules.addRule')}
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 py-4 space-y-6">
        {/* Bound signals — the input side of the model. */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('rules.boundSignals')}
            </h2>
            <Button size="sm" variant="outline" onClick={openSignalCreate}>
              <Plus className="h-4 w-4 mr-1" /> {t('rules.bindSignal')}
            </Button>
          </div>
          {signalTags.length === 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
              <span>{t('rules.noSignals')}</span>
            </div>
          ) : (
            <div className="rounded-lg border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('rules.tag')}</TableHead>
                    <TableHead>{t('rules.machine')}</TableHead>
                    <TableHead>{t('rules.address')}</TableHead>
                    <TableHead>{t('tform.signalRole')}</TableHead>
                    <TableHead>{t('rules.thresholds')}</TableHead>
                    <TableHead className="w-16" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {signalTags.map((tg: any) => (
                    <TableRow key={tg.id}>
                      <TableCell className="font-mono text-xs">{tg.code}</TableCell>
                      <TableCell className="text-xs">{tg.machine?.code ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {tg.registerType === 'DISCRETE' ? `DI ${tg.address}` : `${tg.registerType} ${tg.address}`}
                      </TableCell>
                      <TableCell>
                        {tg.signalRole
                          ? <Badge variant="secondary" className="text-[10px]">{tg.signalRole}</Badge>
                          // A status tag with no role is read literally and takes
                          // no part in starvation detection. That is a silent
                          // half-configuration, so it is called out rather than
                          // left looking like a blank cell.
                          : <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-500">
                              {t('rules.unset')}
                            </Badge>}
                      </TableCell>
                      <TableCell className="text-[11px] text-muted-foreground">
                        {tg.signalRole === 'RUN_MODE_PULSED' && `${tg.pulseWindowMs ?? 6000} ms / ${tg.pulseMinEdges ?? 4} edges`}
                        {tg.signalRole === 'PROCESSING' && `${Math.round((tg.idleThresholdMs ?? 300000) / 1000)} s idle`}
                      </TableCell>
                      <TableCell>
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openSignalEdit(tg)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        {/* State rules — the output side. */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            {t('rules.stateRules')}
          </h2>
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('rules.state')}</TableHead>
                  <TableHead>{t('rules.scope')}</TableHead>
                  <TableHead>{t('rules.downtime')}</TableHead>
                  <TableHead>{t('rules.planned')}</TableHead>
                  <TableHead>{t('rules.affectsOee')}</TableHead>
                  <TableHead>{t('rules.reasonCode')}</TableHead>
                  <TableHead>{t('rules.category')}</TableHead>
                  <TableHead>{t('rules.debounce')}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow><TableCell colSpan={9} className="text-center text-xs py-6 text-muted-foreground">{t('common:loading')}</TableCell></TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow><TableCell colSpan={9} className="text-center text-xs py-6 text-muted-foreground">{t('rules.empty')}</TableCell></TableRow>
                )}
                {filtered.map((r: any) => (
                  <TableRow key={r.id} className={cn(r.isActive === false && 'opacity-50')}>
                    <TableCell className="font-mono text-xs font-semibold">{r.state}</TableCell>
                    <TableCell className="text-xs">
                      {r.machineId
                        ? <Badge variant="outline" className="text-[10px]">{r.machine?.code ?? t('rules.machine')}</Badge>
                        : <span className="text-muted-foreground">{t('rules.scopeFactory')}</span>}
                    </TableCell>
                    <TableCell><YesNo on={r.isDowntime} /></TableCell>
                    <TableCell><YesNo on={r.isPlanned} /></TableCell>
                    <TableCell><YesNo on={r.affectsOEE} /></TableCell>
                    <TableCell className="font-mono text-[11px]">{r.reasonCode ?? '—'}</TableCell>
                    <TableCell className="text-[11px]">{r.category}</TableCell>
                    <TableCell className="text-[11px]">{r.debounceSeconds ?? 0}s</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(r)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => setDeleteDialog({ id: r.id, state: r.state })}>
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
            <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
            {t('rules.precedenceHelp')}
          </p>
        </section>

        {/* Alarm definitions — a tag value crossing a limit, rather than a state. */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('rules.alarmRules')}
            </h2>
            <Button size="sm" variant="outline" onClick={openAlarmCreate}>
              <Plus className="h-4 w-4 mr-1" /> {t('rules.addAlarm')}
            </Button>
          </div>
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('rules.alarmCode')}</TableHead>
                  <TableHead>{t('rules.tag')}</TableHead>
                  <TableHead>{t('rules.condition')}</TableHead>
                  <TableHead>{t('rules.deadband')}</TableHead>
                  <TableHead>{t('rules.delay')}</TableHead>
                  <TableHead>{t('rules.severity')}</TableHead>
                  <TableHead className="w-20" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {alarmDefs.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-xs py-6 text-muted-foreground">{t('rules.noAlarms')}</TableCell></TableRow>
                )}
                {alarmDefs.map((a: any) => (
                  <TableRow key={a.id} className={cn(a.isActive === false && 'opacity-50')}>
                    <TableCell className="text-xs">
                      <div className="font-mono font-semibold">{a.code}</div>
                      <div className="text-muted-foreground">{a.name}</div>
                    </TableCell>
                    <TableCell className="font-mono text-[11px]">
                      {a.tag?.code ?? '—'}
                      {a.tag?.machine?.code && <span className="text-muted-foreground"> · {a.tag.machine.code}</span>}
                    </TableCell>
                    <TableCell className="font-mono text-[11px]">
                      {a.condition ?? 'GT'} {a.threshold} {a.tag?.unit ?? ''}
                    </TableCell>
                    <TableCell className="text-[11px]">{a.deadband ?? '—'}</TableCell>
                    <TableCell className="text-[11px]">{a.delaySeconds ?? 0}s</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-[10px]">{a.severity}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openAlarmEdit(a)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7"
                          onClick={() => setDeleteAlarm({ id: a.id, code: a.code })}>
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
            <Info className="h-3.5 w-3.5 shrink-0 mt-px" />
            {t('rules.alarmEngineHelp')}
          </p>
        </section>
      </div>

      <FormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditRule(null); }}
        onSubmit={handleSubmit}
        title={editRule ? t('rules.editTitle', { state: editRule.state }) : t('rules.createTitle')}
        isSubmitting={saveMutation.isPending}
        isValid={!!form.state}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('rules.state')}</Label>
            <Select value={form.state} onValueChange={v => setForm(f => ({ ...f, state: v }))} disabled={!!editRule}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('rules.scope')}</Label>
            <Select value={form.machineId || 'FACTORY'}
              onValueChange={v => setForm(f => ({ ...f, machineId: v === 'FACTORY' ? '' : v }))}
              disabled={!!editRule}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="FACTORY">{t('rules.scopeFactory')}</SelectItem>
                {machineOpts.map((m: any) => (
                  <SelectItem key={m.id} value={m.id}>{m.code} — {m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
            <Toggle
              checked={form.isDowntime}
              onChange={v => setForm(f => ({ ...f, isDowntime: v }))}
              label={t('rules.isDowntimeLabel')}
              help={t('rules.isDowntimeHelp')}
            />
            <Toggle
              checked={form.isPlanned}
              onChange={v => setForm(f => ({ ...f, isPlanned: v }))}
              label={t('rules.isPlannedLabel')}
              help={t('rules.isPlannedHelp')}
            />
            <Toggle
              checked={form.affectsOEE}
              onChange={v => setForm(f => ({ ...f, affectsOEE: v }))}
              label={t('rules.affectsOeeLabel')}
              help={t('rules.affectsOeeHelp')}
            />
          </div>

          <div>
            <Label>{t('rules.reasonCode')}</Label>
            <Input className="mt-1 font-mono text-xs" value={form.reasonCode}
              placeholder="UNPLANNED_BREAKDOWN"
              onChange={e => setForm(f => ({ ...f, reasonCode: e.target.value }))} />
          </div>
          <div>
            <Label>{t('rules.category')}</Label>
            <Select value={form.category} onValueChange={v => setForm(f => ({ ...f, category: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>{t('rules.debounce')}</Label>
            <Input type="number" min={0} className="mt-1" value={form.debounceSeconds}
              onChange={e => setForm(f => ({ ...f, debounceSeconds: e.target.value }))} />
            <p className="text-[11px] text-muted-foreground mt-1">{t('rules.debounceHelp')}</p>
          </div>

          <div className="col-span-2">
            <Label>{t('rules.description')}</Label>
            <Input className="mt-1" value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>
        </div>
      </FormDialog>

      <FormDialog
        open={signalOpen}
        onClose={() => { setSignalOpen(false); setEditSignal(null); }}
        onSubmit={submitSignal}
        title={editSignal ? t('rules.editSignalTitle', { code: editSignal.code }) : t('rules.bindSignalTitle')}
        isSubmitting={saveSignal.isPending}
        isValid={!!signalForm.tagId}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Label>{t('rules.tag')}</Label>
            {editSignal ? (
              <div className="mt-1 rounded-md border border-border/50 bg-muted/30 px-3 py-2 text-sm">
                <span className="font-mono">{editSignal.code}</span>
                <span className="text-muted-foreground">
                  {editSignal.machine?.code ? ` · ${editSignal.machine.code}` : ''}
                  {editSignal.registerType === 'DISCRETE' ? ` · DI ${editSignal.address}` : ''}
                </span>
              </div>
            ) : (
              <>
                <Select value={signalForm.tagId} onValueChange={v => setSignalForm(f => ({ ...f, tagId: v }))}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder={t('rules.pickTag')} /></SelectTrigger>
                  <SelectContent>
                    {bindableTags.map((tg: any) => (
                      <SelectItem key={tg.id} value={tg.id}>
                        {tg.code}
                        {tg.machine?.code ? ` — ${tg.machine.code}` : ''}
                        {tg.registerType === 'DISCRETE' ? ` (DI ${tg.address})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground mt-1">{t('rules.bindableHelp')}</p>
              </>
            )}
          </div>

          <div className="col-span-2">
            <Label>{t('tform.signalRole')}</Label>
            <Select value={signalForm.signalRole} onValueChange={v => setSignalForm(f => ({ ...f, signalRole: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="RUN_MODE">{t('tform.roleRunMode')}</SelectItem>
                <SelectItem value="RUN_MODE_PULSED">{t('tform.roleRunModePulsed')}</SelectItem>
                <SelectItem value="PROCESSING">{t('tform.roleProcessing')}</SelectItem>
                <SelectItem value="INFEED_AVAILABLE">{t('tform.roleInfeed')}</SelectItem>
                <SelectItem value="OUTFEED_BLOCKED">{t('tform.roleOutfeed')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              {signalForm.signalRole === 'RUN_MODE' && t('tform.roleRunModeHelp')}
              {signalForm.signalRole === 'RUN_MODE_PULSED' && t('tform.roleRunModePulsedHelp')}
              {signalForm.signalRole === 'PROCESSING' && t('tform.roleProcessingHelp')}
              {signalForm.signalRole === 'INFEED_AVAILABLE' && t('tform.roleInfeedHelp')}
              {signalForm.signalRole === 'OUTFEED_BLOCKED' && t('tform.roleOutfeedHelp')}
            </p>
          </div>

          {/* Only the thresholds the chosen role actually uses. */}
          {roleNeeds('pulse') && (
            <>
              <div>
                <Label>{t('tform.pulseWindowMs')}</Label>
                <Input type="number" min={0} className="mt-1" placeholder="6000"
                  value={signalForm.pulseWindowMs}
                  onChange={e => setSignalForm(f => ({ ...f, pulseWindowMs: e.target.value }))} />
              </div>
              <div>
                <Label>{t('tform.pulseMinEdges')}</Label>
                <Input type="number" min={2} className="mt-1" placeholder="4"
                  value={signalForm.pulseMinEdges}
                  onChange={e => setSignalForm(f => ({ ...f, pulseMinEdges: e.target.value }))} />
              </div>
              <p className="col-span-2 text-[11px] text-muted-foreground -mt-1">{t('tform.pulseHelp')}</p>
            </>
          )}

          {roleNeeds('idle') && (
            <div className="col-span-2">
              <Label>{t('tform.idleThresholdMs')}</Label>
              <Input type="number" min={0} className="mt-1" placeholder="300000"
                value={signalForm.idleThresholdMs}
                onChange={e => setSignalForm(f => ({ ...f, idleThresholdMs: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground mt-1">{t('tform.idleThresholdHelp')}</p>
            </div>
          )}
        </div>
      </FormDialog>

      <FormDialog
        open={alarmOpen}
        onClose={() => { setAlarmOpen(false); setEditAlarm(null); }}
        onSubmit={submitAlarm}
        title={editAlarm ? t('rules.editAlarmTitle', { code: editAlarm.code }) : t('rules.createAlarmTitle')}
        isSubmitting={saveAlarm.isPending}
        isValid={alarmValid}
      >
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>{t('rules.alarmCode')}</Label>
            <Input className="mt-1 font-mono text-xs" value={alarmForm.code} placeholder="TEMP_HIGH"
              onChange={e => setAlarmForm(f => ({ ...f, code: e.target.value }))} />
          </div>
          <div>
            <Label>{t('rules.alarmName')}</Label>
            <Input className="mt-1" value={alarmForm.name}
              onChange={e => setAlarmForm(f => ({ ...f, name: e.target.value }))} />
          </div>

          <div className="col-span-2">
            <Label>{t('rules.tag')}</Label>
            <Select value={alarmForm.tagId} onValueChange={v => setAlarmForm(f => ({ ...f, tagId: v }))}>
              <SelectTrigger className="mt-1"><SelectValue placeholder={t('rules.pickTag')} /></SelectTrigger>
              <SelectContent>
                {allTags.map((tg: any) => (
                  <SelectItem key={tg.id} value={tg.id}>
                    {tg.code}{tg.machine?.code ? ` — ${tg.machine.code}` : ''}{tg.unit ? ` (${tg.unit})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>{t('rules.condition')}</Label>
            <Select value={alarmForm.condition} onValueChange={v => setAlarmForm(f => ({ ...f, condition: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CONDITIONS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('rules.threshold')}</Label>
            <Input type="number" className="mt-1" value={alarmForm.threshold}
              onChange={e => setAlarmForm(f => ({ ...f, threshold: e.target.value }))} />
          </div>

          <div>
            <Label>{t('rules.deadband')}</Label>
            <Input type="number" min={0} className="mt-1" value={alarmForm.deadband}
              onChange={e => setAlarmForm(f => ({ ...f, deadband: e.target.value }))} />
            <p className="text-[11px] text-muted-foreground mt-1">{t('rules.deadbandHelp')}</p>
          </div>
          <div>
            <Label>{t('rules.delay')}</Label>
            <Input type="number" min={0} className="mt-1" value={alarmForm.delaySeconds}
              onChange={e => setAlarmForm(f => ({ ...f, delaySeconds: e.target.value }))} />
            <p className="text-[11px] text-muted-foreground mt-1">{t('rules.delayHelp')}</p>
          </div>

          <div>
            <Label>{t('rules.severity')}</Label>
            <Select value={alarmForm.severity} onValueChange={v => setAlarmForm(f => ({ ...f, severity: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{t('rules.category')}</Label>
            <Input className="mt-1" value={alarmForm.category}
              onChange={e => setAlarmForm(f => ({ ...f, category: e.target.value }))} />
          </div>

          <div className="col-span-2 space-y-2 rounded-lg border border-border/40 bg-muted/20 p-3">
            <Toggle
              checked={alarmForm.autoAck}
              onChange={v => setAlarmForm(f => ({ ...f, autoAck: v }))}
              label={t('rules.autoAckLabel')}
              help={t('rules.autoAckHelp')}
            />
            <Toggle
              checked={alarmForm.isActive}
              onChange={v => setAlarmForm(f => ({ ...f, isActive: v }))}
              label={t('rules.activeLabel')}
              help={t('rules.activeHelp')}
            />
          </div>
        </div>
      </FormDialog>

      <DeleteDialog
        open={!!deleteAlarm}
        onClose={() => setDeleteAlarm(null)}
        onConfirm={() => deleteAlarm && deleteAlarmMutation.mutate(deleteAlarm.id)}
        title={t('rules.deleteAlarmTitle', { code: deleteAlarm?.code })}
        description={t('rules.deleteAlarmDesc')}
        isDeleting={deleteAlarmMutation.isPending}
      />

      <DeleteDialog
        open={!!deleteDialog}
        onClose={() => setDeleteDialog(null)}
        onConfirm={() => deleteDialog && deleteMutation.mutate(deleteDialog.id)}
        title={t('rules.deleteTitle', { state: deleteDialog?.state })}
        description={t('rules.deleteDesc')}
        isDeleting={deleteMutation.isPending}
      />
    </div>
  );
}

function YesNo({ on }: { on: boolean }) {
  return on
    ? <Badge className="text-[10px] bg-emerald-500/15 text-emerald-500 border-emerald-500/30">YES</Badge>
    : <Badge variant="outline" className="text-[10px] text-muted-foreground">NO</Badge>;
}

function Toggle({ checked, onChange, label, help }: {
  checked: boolean; onChange: (v: boolean) => void; label: string; help: string;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer">
      <input type="checkbox" className="mt-1" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span>
        <span className="text-sm">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{help}</span>
      </span>
    </label>
  );
}
