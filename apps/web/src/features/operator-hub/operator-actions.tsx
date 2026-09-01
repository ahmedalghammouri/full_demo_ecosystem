'use client';

/**
 * Shop-floor operator action dialogs: change machine status, raise an alarm, and
 * raise a maintenance request. All use endpoints the OPERATOR role can call
 * (production:execute / unguarded alarm create). Lightweight, touch-first modals.
 */

import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity, AlertTriangle, Wrench, X, Play, Pause, CalendarClock, Settings2,
  Repeat, ArrowDownToLine, ArrowUpFromLine, PowerOff, Check,
} from 'lucide-react';

import { api } from '@/services/api.client';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';

export type MachineLite = { id: string; name: string; code: string };

/**
 * Machine states grouped by what they mean for OEE, not listed flat.
 *
 * A flat 10-button grid gave every state the same weight, so an operator had to
 * read all ten to find one. Grouping by OEE impact makes the choice a two-step
 * scan (which kind of stop? then which one) and quietly teaches why the
 * distinction matters: only UNPLANNED states cost availability.
 */
type StateDef = { id: string; icon: React.ReactNode; tone: string; ring: string; fill: string };

const STATE_GROUPS: Array<{ key: string; labelKey: string; hintKey: string; states: StateDef[] }> = [
  {
    key: 'productive',
    labelKey: 'opHub.st.grpProductive',
    hintKey: 'opHub.st.grpProductiveHint',
    states: [
      { id: 'RUNNING', icon: <Play size={17} />, tone: 'text-emerald-400', ring: 'border-emerald-500/40', fill: 'bg-emerald-500 border-emerald-500 text-white' },
    ],
  },
  {
    key: 'unplanned',
    labelKey: 'opHub.st.grpUnplanned',
    hintKey: 'opHub.st.grpUnplannedHint',
    states: [
      { id: 'BREAKDOWN', icon: <AlertTriangle size={17} />, tone: 'text-red-400', ring: 'border-red-500/40', fill: 'bg-red-500 border-red-500 text-white' },
      { id: 'IDLE', icon: <Pause size={17} />, tone: 'text-slate-300', ring: 'border-slate-500/40', fill: 'bg-slate-500 border-slate-500 text-white' },
      { id: 'STARVED', icon: <ArrowDownToLine size={17} />, tone: 'text-orange-400', ring: 'border-orange-500/40', fill: 'bg-orange-500 border-orange-500 text-white' },
      { id: 'BLOCKED', icon: <ArrowUpFromLine size={17} />, tone: 'text-orange-400', ring: 'border-orange-500/40', fill: 'bg-orange-500 border-orange-500 text-white' },
    ],
  },
  {
    key: 'planned',
    labelKey: 'opHub.st.grpPlanned',
    hintKey: 'opHub.st.grpPlannedHint',
    states: [
      { id: 'PLANNED_STOP', icon: <CalendarClock size={17} />, tone: 'text-sky-400', ring: 'border-sky-500/40', fill: 'bg-sky-500 border-sky-500 text-white' },
      { id: 'STARTUP', icon: <Play size={17} />, tone: 'text-teal-400', ring: 'border-teal-500/40', fill: 'bg-teal-500 border-teal-500 text-white' },
      { id: 'SETUP', icon: <Settings2 size={17} />, tone: 'text-amber-400', ring: 'border-amber-500/40', fill: 'bg-amber-500 border-amber-500 text-white' },
      { id: 'CHANGEOVER', icon: <Repeat size={17} />, tone: 'text-amber-400', ring: 'border-amber-500/40', fill: 'bg-amber-500 border-amber-500 text-white' },
      { id: 'MAINTENANCE', icon: <Wrench size={17} />, tone: 'text-violet-400', ring: 'border-violet-500/40', fill: 'bg-violet-500 border-violet-500 text-white' },
    ],
  },
  {
    key: 'offline',
    labelKey: 'opHub.st.grpOffline',
    hintKey: 'opHub.st.grpOfflineHint',
    states: [
      { id: 'OFFLINE', icon: <PowerOff size={17} />, tone: 'text-slate-400', ring: 'border-slate-600/40', fill: 'bg-slate-600 border-slate-600 text-white' },
    ],
  },
];

function Modal({ title, icon, onClose, children }: { title: string; icon: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-card border border-border p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 font-bold text-foreground">{icon}{title}</div>
          <button onClick={onClose} className="text-foreground/50 hover:text-foreground"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

function MachinePicker({ machines, value, onChange }: { machines: MachineLite[]; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="w-full h-11 rounded-xl bg-muted/40 border border-border px-3 text-sm focus:outline-none focus:border-brand-400">
      <option value="">Select machine…</option>
      {machines.map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}
    </select>
  );
}

const inputCls = 'w-full h-11 rounded-xl bg-muted/40 border border-border px-3 text-sm focus:outline-none focus:border-brand-400';
const btnPrimary = 'flex-1 h-11 rounded-xl text-white font-semibold text-sm active:scale-95 disabled:opacity-50';

// ── Change machine status ───────────────────────────────────────────────────
export function MachineStatusDialog({ machines, defaultMachineId, onClose }: { machines: MachineLite[]; defaultMachineId?: string; onClose: () => void }) {
  const { t } = useTranslation('production');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState(defaultMachineId ?? machines[0]?.id ?? '');
  const [state, setState] = useState('RUNNING');
  const [notes, setNotes] = useState('');

  const mut = useMutation({
    mutationFn: () => api.patch(`/production/downtime/machines/${machineId}/state`, { state, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
    onSuccess: () => {
      toast({ title: 'Machine status updated' });
      qc.invalidateQueries({ queryKey: ['machine-states'] });
      qc.invalidateQueries({ queryKey: ['machine-states-3d'] });
      qc.invalidateQueries({ queryKey: ['downtime-events'] });
      onClose();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Update failed', description: e?.response?.data?.message }),
  });

  const selected = STATE_GROUPS.flatMap((g) => g.states).find((x) => x.id === state);

  return (
    <Modal
      title={t('opHub.st.title', { defaultValue: 'Change machine status' })}
      icon={<Activity size={18} className="text-brand-400" />}
      onClose={onClose}
    >
      <div className="flex flex-col gap-3.5">
        <MachinePicker machines={machines} value={machineId} onChange={setMachineId} />

        {/* Grouped state picker — each group carries its OEE consequence */}
        <div className="flex flex-col gap-3 max-h-[52vh] overflow-y-auto -mx-1 px-1">
          {STATE_GROUPS.map((g) => (
            <div key={g.key}>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-foreground/70">
                  {t(g.labelKey)}
                </span>
                <span className="text-[10px] text-muted-foreground">{t(g.hintKey)}</span>
              </div>
              <div className={cn('grid gap-2', g.states.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
                {g.states.map((sd) => {
                  const active = state === sd.id;
                  return (
                    <button
                      key={sd.id}
                      onClick={() => setState(sd.id)}
                      aria-pressed={active}
                      className={cn(
                        // 56px target: this is used with gloves on a tablet.
                        'h-14 rounded-xl border flex items-center gap-2.5 px-3 text-[13px] font-bold',
                        'transition active:scale-[0.97]',
                        active ? cn(sd.fill, 'shadow-sm') : cn('bg-transparent', sd.tone, sd.ring),
                      )}
                    >
                      <span className="shrink-0">{sd.icon}</span>
                      <span className="truncate text-start leading-tight">
                        {t(`opHub.st.s.${sd.id}`, { defaultValue: sd.id.replace('_', ' ') })}
                      </span>
                      {active && <Check size={16} className="ms-auto shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={t('opHub.st.note', { defaultValue: 'Note (optional)' })}
          className={inputCls}
        />

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 h-12 rounded-xl border border-border font-semibold text-sm active:scale-95"
          >
            {t('opHub.st.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            disabled={mut.isPending || !machineId}
            onClick={() => mut.mutate()}
            className={cn(btnPrimary, 'h-12 flex items-center justify-center gap-2', selected?.fill ?? 'bg-brand-500')}
          >
            {mut.isPending
              ? t('opHub.st.saving', { defaultValue: 'Saving…' })
              : <>{selected?.icon}{t('opHub.st.setTo', { defaultValue: 'Set to' })}{' '}
                  {t(`opHub.st.s.${state}`, { defaultValue: state.replace('_', ' ') })}</>}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Raise an alarm ──────────────────────────────────────────────────────────
export function RaiseAlarmDialog({ machines, defaultMachineId, jobOrderId, onClose }: { machines: MachineLite[]; defaultMachineId?: string; jobOrderId?: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState(defaultMachineId ?? machines[0]?.id ?? '');
  const [severity, setSeverity] = useState('MEDIUM');
  const [description, setDescription] = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/alarms', { ...(machineId ? { machineId } : {}), ...(jobOrderId ? { jobOrderId } : {}), severity, description: description.trim() }),
    onSuccess: () => {
      toast({ title: 'Alarm raised' });
      qc.invalidateQueries({ queryKey: ['alarms'] });
      onClose();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Failed to raise alarm', description: e?.response?.data?.message }),
  });

  return (
    <Modal title="Raise alarm" icon={<AlertTriangle size={18} className="text-red-400" />} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <MachinePicker machines={machines} value={machineId} onChange={setMachineId} />
        <div className="grid grid-cols-5 gap-1.5">
          {['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((s) => (
            <button key={s} onClick={() => setSeverity(s)}
              className={cn('h-9 rounded-lg border text-[11px] font-semibold', severity === s ? 'bg-accent ring-1 ring-red-400 text-foreground' : 'border-border text-foreground/60')}>
              {s}
            </button>
          ))}
        </div>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is happening?" rows={3}
          className="w-full rounded-xl bg-muted/40 border border-border px-3 py-2 text-sm focus:outline-none focus:border-red-400" />
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border font-semibold text-sm active:scale-95">Cancel</button>
          <button disabled={mut.isPending || !description.trim()} onClick={() => mut.mutate()} className={cn(btnPrimary, 'bg-red-500')}>
            {mut.isPending ? 'Raising…' : 'Raise alarm'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Raise a maintenance request ─────────────────────────────────────────────
export function RaiseMaintenanceDialog({ machines, defaultMachineId, onClose }: { machines: MachineLite[]; defaultMachineId?: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [machineId, setMachineId] = useState(defaultMachineId ?? machines[0]?.id ?? '');
  const [priority, setPriority] = useState('MEDIUM');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const mut = useMutation({
    mutationFn: () => api.post('/maintenance/requests', { machineId, priority, title: title.trim(), ...(description.trim() ? { description: description.trim() } : {}) }),
    onSuccess: () => {
      toast({ title: 'Maintenance request sent' });
      qc.invalidateQueries({ queryKey: ['my-maint-requests'] });
      onClose();
    },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Request failed', description: e?.response?.data?.message }),
  });

  return (
    <Modal title="Maintenance request" icon={<Wrench size={18} className="text-amber-400" />} onClose={onClose}>
      <div className="flex flex-col gap-3">
        <MachinePicker machines={machines} value={machineId} onChange={setMachineId} />
        <div className="grid grid-cols-4 gap-2">
          {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((p) => (
            <button key={p} onClick={() => setPriority(p)}
              className={cn('h-9 rounded-lg border text-[11px] font-semibold', priority === p ? 'bg-accent ring-1 ring-amber-400 text-foreground' : 'border-border text-foreground/60')}>
              {p}
            </button>
          ))}
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short title (e.g. Conveyor jam)" className={inputCls} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details (optional)" rows={3}
          className="w-full rounded-xl bg-muted/40 border border-border px-3 py-2 text-sm focus:outline-none focus:border-amber-400" />
        <div className="flex gap-2 mt-1">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border font-semibold text-sm active:scale-95">Cancel</button>
          <button disabled={mut.isPending || !machineId || !title.trim()} onClick={() => mut.mutate()} className={cn(btnPrimary, 'bg-amber-500')}>
            {mut.isPending ? 'Sending…' : 'Send request'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
