'use client';

/**
 * OperatorHmiView — the SIMPLIFIED operator tablet screen (per training feedback).
 * Shows only what the operator needs, big and touch-first:
 *   Today's Work Order · Target Qty · Actual/Production Qty · Accepted/Rejected ·
 *   Downtime · Downtime Reason.
 * Plus the core shift actions (Start / Pause / Complete, +Count) and the historical
 * downtime-reason list (assign reason/sub-reason to recorded stoppages). Downtime
 * itself is auto-detected from machine status signals — no manual "log downtime"
 * action here — and machine-status/alarm/maintenance actions live elsewhere, so
 * this screen stays to the three core actions only.
 *
 * Deliberately a NEW screen — the full ShopFloorView (many KPIs) is untouched and
 * still used by supervisors on the desktop. All actions use production:execute
 * endpoints, which operators hold.
 */

import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Play, Pause, CheckSquare, Plus, AlertTriangle, Loader2, Package, Clock, Factory,
  Cpu, Layers, RotateCcw, Unplug, ShieldAlert, Undo2, CalendarClock,
} from 'lucide-react';

import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';
import { api } from '@/services/api.client';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { DowntimeReasonList } from './downtime-reason-list';
import { MachineSummary } from './machine-summary';
import { AlarmsLog } from './alarms-log';
import { useCurrentUser } from './use-current-user';

type JOStatus = 'SCHEDULED' | 'READY' | 'EXECUTING' | 'PAUSED' | 'COMPLETE' | 'CANCELLED';
interface JO {
  id: string;
  operationName: string;
  status: JOStatus;
  plannedQtyOut?: number;
  outputUnit?: string;
  actualQtyGood: number;
  actualQtyRejected: number;
  actualStart?: string;
  operatorId?: string;
  workOrder?: { id: string; orderNumber: string; sku?: { name: string; code: string } };
  machine?: { id?: string; name: string; code: string };
  // Routing position, and whether this step is out of the line. Needed to work
  // out which machine the line total is read from -- see BypassDialog.
  workOrderId?: string;
  sequenceOrder?: number;
  bypassedAt?: string | null;
  bypassReason?: string | null;
}

const ACTIVE: JOStatus[] = ['EXECUTING', 'PAUSED', 'READY'];

/**
 * One row of controls per work order on the line.
 *
 * Grouped by work order rather than shown as a single global bar: two orders
 * can be on the floor at once, and a button that started "everything" would
 * start the one the operator was not looking at.
 *
 * The counts under each button say what the line is actually doing right now,
 * so a half-started line — the state nobody noticed on 25 August — is visible
 * before the operator presses anything.
 */
function LineControls({
  jobs, show, pending, onAction,
}: {
  jobs: JO[];
  /** The card filter. It hides ORDERS, never steps -- see below. */
  show: JOStatus;
  pending: boolean;
  onAction: (workOrderId: string, status: string) => void;
}) {
  /**
   * The filter decides which work orders APPEAR here; it must never decide
   * which steps the buttons act on.
   *
   * Two orders were on the floor and only one was running, so "Running now"
   * showing both blocks was noise. But every block keeps ALL of its order's
   * steps: "Pause all" that paused only the running ones would leave a paused
   * step behind on a screen that just said it had stopped the line -- which is
   * the failure this whole component was built to remove.
   */
  const byWo = new Map<string, { number: string; jobs: JO[] }>();
  for (const jo of jobs) {
    const id = jo.workOrder?.id;
    if (!id) continue;
    const hit = byWo.get(id) ?? { number: jo.workOrder?.orderNumber ?? '—', jobs: [] };
    hit.jobs.push(jo);
    byWo.set(id, hit);
  }

  // Hide an order with nothing in the chosen state. Its block would carry four
  // live buttons for work the operator is not looking at.
  for (const [id, g] of [...byWo]) {
    if (!g.jobs.some((j) => j.status === show)) byWo.delete(id);
  }
  if (byWo.size === 0) return null;

  return (
    <div className="flex flex-col gap-2 mb-4">
      {[...byWo.entries()].map(([woId, g]) => {
        const running = g.jobs.filter((j) => j.status === 'EXECUTING').length;
        const paused = g.jobs.filter((j) => j.status === 'PAUSED').length;
        const total = g.jobs.length;
        // Half the line running and half paused is the state that went unseen.
        // Saying so plainly is most of this component's value.
        const mixed = running > 0 && running < total;

        return (
          <div key={woId} className={cn(
            'rounded-2xl border bg-card/60 p-3',
            mixed ? 'border-amber-500/40' : 'border-border/60',
          )}>
            <div className="flex items-center justify-between gap-2 mb-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Layers size={14} className="text-brand-400 shrink-0" />
                  <span className="text-sm font-bold text-foreground">Whole line</span>
                  <span className="text-xs font-mono text-brand-400/80">{g.number}</span>
                </div>
                <div className={cn('text-[11px] mt-0.5', mixed ? 'text-amber-400' : 'text-foreground/50')}>
                  {mixed
                    ? `${running} of ${total} steps running — the line is only half started`
                    : `${total} step${total === 1 ? '' : 's'} · ${running} running · ${paused} paused`}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <ActionBtn onClick={() => onAction(woId, 'EXECUTING')} icon={<Play size={16} />}
                label={paused > 0 && running === 0 ? 'Resume all' : 'Start all'} tone="green" disabled={pending} />
              <ActionBtn onClick={() => onAction(woId, 'PAUSED')} icon={<Pause size={16} />}
                label="Pause all" tone="amber" disabled={pending} />
              <ActionBtn onClick={() => onAction(woId, 'COMPLETE')} icon={<CheckSquare size={16} />}
                label="Complete all" tone="emerald" disabled={pending} />
              <ActionBtn onClick={() => onAction(woId, 'READY')} icon={<RotateCcw size={16} />}
                label="Reset" tone="sky" disabled={pending} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function OperatorHmiView() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [countFor, setCountFor] = useState<JO | null>(null);

  const { data: me } = useCurrentUser();

  const { data, isLoading } = useQuery({
    queryKey: ['shop-floor-jobs', 'operator-hmi'],
    queryFn: () => api.get('/production/job-orders'),
    refetchInterval: 15_000,
  });
  const { data: shiftA } = useQuery({
    queryKey: ['shift-analysis'],
    queryFn: () => api.get('/shifts/analysis'),
    refetchInterval: 20_000,
  });

  /**
   * This screen is LIVE, and says so.
   *
   * It reads a period-scoped endpoint (`planned-now`) while carrying no date
   * filter at all -- deliberately, because an operator at the line is asking
   * about this minute and nothing else. `period-reaches-the-page.spec.ts`
   * requires any page reading such an endpoint either to send the period or to
   * declare itself live. Declaring it is the truthful half of that choice.
   */
  useDeclareViewMode('live');

  const allJobs: JO[] = (data as any) ?? [];
  // Shop floor shows ONLY the job orders assigned to the logged-in operator, and
  // only the active ones (executing/ready/paused). The operator cannot reassign —
  // there is no assign control here (that stays with supervisors/managers).
  /**
   * Which cards to show.
   *
   * Two work orders can be on the floor at once -- 25 Aug 2026 had exactly that
   * -- and "everything active" then means five cards from two orders on one
   * tablet screen. The operator is looking for one of three things: what is
   * running, what they paused and have to come back to, or what is queued next.
   * Those are the filters, and nothing else -- there is deliberately no "All".
   * With two orders on the floor it put five cards from two orders on one
   * tablet screen, and the operator's first question is never "show me
   * everything". The default is what is RUNNING.
   */
  const [show, setShow] = useState<JOStatus>('EXECUTING');

  const mine = useMemo(
    () => allJobs
      .filter((j) => ACTIVE.includes(j.status) && (!me?.id || j.operatorId === me.id))
      .sort((a, b) => (a.status === 'EXECUTING' ? -1 : 1)),
    [allJobs, me?.id],
  );

  const counts = useMemo(() => ({
    EXECUTING: mine.filter((j) => j.status === 'EXECUTING').length,
    PAUSED: mine.filter((j) => j.status === 'PAUSED').length,
    READY: mine.filter((j) => j.status === 'READY').length,
  }), [mine]);

  const jobs = useMemo(() => mine.filter((j) => j.status === show), [mine, show]);
  // Deliberately from `mine`, not `jobs`: the machine summary and the downtime
  // list describe the line the operator is on, and narrowing them with a card
  // filter would quietly hide a stopped machine the moment they looked at what
  // was running.
  const machineIds = useMemo(
    () => [...new Set(mine.map((j) => j.machine?.id).filter(Boolean) as string[])],
    [mine],
  );

  // Shift downtime totals (per the shift engine) for the Downtime tile.
  const shift: any = shiftA;
  const downtimeMins = Math.round(shift?.totals?.downtimeMins ?? 0);

  const transition = useMutation({
    mutationFn: ({ id, status }: { id: string; status: JOStatus }) =>
      api.patch(`/production/job-orders/${id}/status`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] }),
    onError: (e: any) => toast({ variant: 'destructive', title: 'Action failed', description: e?.response?.data?.message }),
  });

  /**
   * Move every step of a work order together.
   *
   * The line's four steps run start-to-start: the operator starts them
   * together, pauses them together and finishes them together. Four separate
   * taps is four chances for one to be missed — which is how one machine ended
   * up in a different state from its siblings on 25 Aug 2026, with nothing
   * saying so.
   *
   * A step that legitimately cannot move is reported, not silently dropped:
   * "3 moved, 1 skipped" is the truth, and an operator who is told which step
   * held back can go and look at it.
   */
  const lineTransition = useMutation({
    mutationFn: ({ workOrderId, status }: { workOrderId: string; status: string }) =>
      api.patch(`/production/work-orders/${workOrderId}/job-orders/status`, { status }),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] });
      const d = res?.data ?? res;
      const moved = d?.moved?.length ?? 0;
      const skipped = d?.skipped ?? [];
      toast({
        title: `${moved} step${moved === 1 ? '' : 's'} → ${d?.status ?? ''}`,
        description: skipped.length
          ? `Held back: ${skipped.map((x: any) => `${x.step} (${x.reason})`).join(' · ')}`
          : undefined,
        variant: skipped.length ? 'default' : undefined,
      });
    },
    onError: (e: any) => toast({
      variant: 'destructive', title: 'Line action failed',
      description: e?.response?.data?.message,
    }),
  });

  const addCount = useMutation({
    mutationFn: ({ id, goodDelta, scrapDelta, scrapCategory, scrapReason }: { id: string; goodDelta: number; scrapDelta: number; scrapCategory?: string; scrapReason?: string }) =>
      api.patch(`/production/job-orders/${id}/add-count`, {
        goodDelta, scrapDelta,
        ...(scrapDelta > 0 ? { scrapCategory: scrapCategory ?? 'OTHER', ...(scrapReason?.trim() ? { scrapReason: scrapReason.trim() } : {}) } : {}),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] }); setCountFor(null); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Count failed', description: e?.response?.data?.message }),
  });

  // Correct/adjust the ABSOLUTE totals (fixes a mis-count) — sets the real values.
  const setOutput = useMutation({
    mutationFn: ({ id, actualQtyGood, actualQtyRejected, scrapCategory, scrapReason }: { id: string; actualQtyGood: number; actualQtyRejected: number; scrapCategory?: string; scrapReason?: string }) =>
      api.patch(`/production/job-orders/${id}/output`, {
        actualQtyGood, actualQtyRejected,
        ...(actualQtyRejected > 0 ? { scrapCategory: scrapCategory ?? 'OTHER', ...(scrapReason?.trim() ? { scrapReason: scrapReason.trim() } : {}) } : {}),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] }); setCountFor(null); },
    onError: (e: any) => toast({ variant: 'destructive', title: 'Adjust failed', description: e?.response?.data?.message }),
  });

  /**
   * Take a machine out of the line, or put it back.
   *
   * The line's good total is read from the LAST step product passes through.
   * When that machine breaks, product leaves the line one station earlier and
   * the total has to follow it — otherwise the line reports whatever the dead
   * machine last counted, for the rest of the order.
   */
  const [bypassFor, setBypassFor] = useState<JO | null>(null);
  const bypass = useMutation({
    mutationFn: ({ id, bypassed, password, reason }: {
      id: string; bypassed: boolean; password: string; reason?: string;
    }) => api.patch(`/production/job-orders/${id}/bypass`, { bypassed, password, reason }),
    onSuccess: (_res, vars) => {
      qc.invalidateQueries({ queryKey: ['shop-floor-jobs'] });
      qc.invalidateQueries({ queryKey: ['step-bypass'] });
      setBypassFor(null);
      toast({
        title: vars.bypassed ? 'Machine taken out of the line' : 'Machine back in the line',
        description: vars.bypassed
          ? 'The line total is now read from the step before it.'
          : 'The line total is read from this machine again.',
      });
    },
    // The password failure lands here, and the dialog stays open on purpose so
    // it can be retyped without starting over.
    onError: (e: any) => toast({
      variant: 'destructive', title: 'Bypass refused',
      description: e?.response?.data?.message ?? 'Could not change this step.',
    }),
  });

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6">
      {/* Shift strip */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-foreground">Today’s Work</h1>
          <p className="text-sm text-foreground/50">
            {me?.name ? `${me.name} · ` : ''}{shift?.status?.active?.name ?? 'Shift'} · {jobs.length} active
          </p>
        </div>
        <TileMini label="Downtime" value={`${downtimeMins}m`} tone={downtimeMins > 0 ? 'amber' : 'default'} icon={<Clock size={14} />} />
      </div>

      {/* Machine-state summary dashboard */}
      <div className="mb-4"><MachineSummary /></div>

      {/* The whole line, in one place. Sits above the cards because it acts on
          all of them, and an action whose reach is wider than the thing under
          your thumb has to look that way. */}
      {/* Line controls act on EVERY step of a work order, so they are built from
          the operator's whole list -- a filter showing only what is running must
          not turn "Pause all" into "pause some". */}
      <LineControls jobs={mine} show={show} pending={lineTransition.isPending}
        onAction={(workOrderId, status) => lineTransition.mutate({ workOrderId, status })} />

      {/* What is planned for this moment, from the same events the Machine
          status timeline draws on its plan track. */}
      <PlannedNow machineIds={machineIds} />

      {/* The filter. Counts are on the chips because "Paused 0" and no Paused
          chip at all look identical at a glance and mean different things. */}
      <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
        {([
          ['EXECUTING', 'Running now'],
          ['PAUSED', 'Paused'],
          ['READY', 'Planned'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setShow(key)}
            aria-pressed={show === key}
            className={cn(
              'shrink-0 px-3.5 h-9 rounded-full text-xs font-semibold border transition active:scale-95',
              show === key
                ? 'border-brand-400/50 bg-brand-400/15 text-brand-400'
                : 'border-border/60 text-foreground/55 active:bg-muted/60',
            )}
          >
            {label}
            <span className={cn('ml-1.5 tabular-nums',
              show === key ? 'text-brand-400/70' : 'text-foreground/35')}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-10"><Loader2 className="animate-spin" size={16} /> Loading…</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-2xl border border-border/60 p-10 text-center text-foreground/50">
          <Factory className="mx-auto mb-2 opacity-40" size={28} />
          {mine.length === 0 ? (
            'No active work order right now.'
          ) : (
            <>
              {/* An empty filter and an empty floor are different facts, and a
                  single "nothing here" would let one be read as the other. */}
              Nothing {show === 'EXECUTING' ? 'running' : show === 'PAUSED' ? 'paused' : 'waiting to start'} right now.
              {/* Point at a filter that HAS something, rather than leaving the
                  operator to try all three to find where their work went. */}
              <div className="flex flex-wrap gap-2 justify-center mt-3">
                {(['EXECUTING', 'PAUSED', 'READY'] as const)
                  .filter((k) => k !== show && counts[k] > 0)
                  .map((k) => (
                    <button key={k} onClick={() => setShow(k)}
                      className="px-3 h-8 rounded-full border border-brand-400/40 text-brand-400 text-xs font-semibold">
                      {k === 'EXECUTING' ? 'Running now' : k === 'PAUSED' ? 'Paused' : 'Planned'} {counts[k]}
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {jobs.map((jo) => {
            const target = Math.max(0, jo.plannedQtyOut ?? 0);
            const good = jo.actualQtyGood ?? 0;
            const rej = jo.actualQtyRejected ?? 0;
            const pct = target > 0 ? Math.min(100, Math.round((good / target) * 100)) : 0;
            const running = jo.status === 'EXECUTING';
            return (
              <div key={jo.id} className={cn('rounded-2xl border bg-card p-4 transition-colors',
                running ? 'border-green-500/25' : jo.status === 'PAUSED' ? 'border-amber-500/25' : 'border-border/60')}>
                {/* Header — machine name is the card title */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Cpu size={15} className="text-brand-400 shrink-0" />
                      <span className="text-base font-bold text-foreground truncate">{jo.machine?.name ?? jo.machine?.code ?? 'Machine'}</span>
                      {jo.machine?.name && jo.machine?.code && (
                        <span className="text-[10px] font-mono text-foreground/50 px-1.5 py-0.5 rounded bg-muted/60 shrink-0">{jo.machine.code}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1 min-w-0">
                      <span className="text-xs font-mono font-semibold text-brand-400/80 shrink-0">{jo.workOrder?.orderNumber ?? '—'}</span>
                      <span className="text-xs text-foreground/50 truncate">{jo.workOrder?.sku?.name ?? jo.operationName}</span>
                    </div>
                  </div>
                  <span className={cn('text-[10px] font-bold uppercase px-2 py-0.5 rounded-full shrink-0',
                    running ? 'bg-green-500/15 text-green-400' : jo.status === 'PAUSED' ? 'bg-amber-500/15 text-amber-400' : 'bg-blue-500/15 text-blue-400')}>
                    {jo.status}
                  </span>
                </div>

                {/* KPI tiles */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <Tile label="Target" value={target.toLocaleString()} unit={jo.outputUnit} />
                  <Tile label="Actual" value={good.toLocaleString()} unit={jo.outputUnit} tone="sky" />
                  <Tile label="Accepted / Rejected" value={`${good.toLocaleString()} / ${rej.toLocaleString()}`} tone={rej > 0 ? 'red' : 'emerald'} />
                </div>

                {/* Progress */}
                <div className="h-2 rounded-full bg-muted overflow-hidden mb-3">
                  <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct}%` }} />
                </div>

                {/* Out of the line — stated on the card, not hidden in a menu, because
                    it changes where the LINE's total comes from. */}
                {jo.bypassedAt && (
                  <div className="flex items-start gap-2 mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    <Unplug size={15} className="text-amber-400 shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-amber-400">Out of the line</div>
                      <div className="text-[11px] text-foreground/60 leading-snug">
                        The line total is read from the step before this one.
                        {jo.bypassReason ? ` · ${jo.bypassReason}` : ''}
                      </div>
                    </div>
                  </div>
                )}

                {/* Primary actions — large touch targets */}
                <div className="grid grid-cols-3 gap-2">
                  {running ? (
                    <ActionBtn onClick={() => transition.mutate({ id: jo.id, status: 'PAUSED' })} icon={<Pause size={18} />} label="Pause" tone="amber" />
                  ) : (
                    <ActionBtn onClick={() => transition.mutate({ id: jo.id, status: 'EXECUTING' })} icon={<Play size={18} />} label="Start" tone="green" />
                  )}
                  <ActionBtn onClick={() => setCountFor(jo)} icon={<Plus size={18} />} label="Count" tone="sky" />
                  <ActionBtn onClick={() => transition.mutate({ id: jo.id, status: 'COMPLETE' })} icon={<CheckSquare size={18} />} label="Complete" tone="emerald" />
                </div>

                {/* Deliberately BELOW the three, smaller and quieter: it is rare,
                    and it is not one of the actions an operator reaches for on a
                    normal shift. */}
                <button
                  onClick={() => setBypassFor(jo)}
                  className={cn(
                    'w-full mt-2 h-10 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition active:scale-95 border',
                    jo.bypassedAt
                      ? 'border-emerald-500/30 text-emerald-400 active:bg-emerald-500/15'
                      : 'border-border/60 text-foreground/55 active:bg-muted/60',
                  )}
                >
                  {jo.bypassedAt
                    ? <><Undo2 size={14} /> Put this machine back in the line</>
                    : <><Unplug size={14} /> Machine out of service — bypass it</>}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Downtime events — close (adjustable end time) + set reason / sub-reason */}
      <div className="mt-8">
        <h2 className="text-base font-bold text-foreground mb-1">Downtime events</h2>
        <p className="text-sm text-foreground/50 mb-3">Tap an event to close it (set end time) or set its reason and sub-reason.</p>
        <DowntimeReasonList machineIds={machineIds.length ? machineIds : undefined} />
      </div>

      {/* Alarms log */}
      <div className="mt-8">
        <h2 className="text-base font-bold text-foreground mb-3">Alarms</h2>
        <AlarmsLog />
      </div>

      {/* Dialogs */}
      {countFor && (
        <CountDialog
          jo={countFor}
          onClose={() => setCountFor(null)}
          pending={addCount.isPending || setOutput.isPending}
          onSubmit={(mode, g, s, cat, reason) => {
            if (mode === 'set') setOutput.mutate({ id: countFor.id, actualQtyGood: g, actualQtyRejected: s, scrapCategory: cat, scrapReason: reason });
            else addCount.mutate({ id: countFor.id, goodDelta: g, scrapDelta: s, scrapCategory: cat, scrapReason: reason });
          }}
        />
      )}

      {bypassFor && (
        <BypassDialog
          jo={bypassFor}
          pending={bypass.isPending}
          onClose={() => setBypassFor(null)}
          onConfirm={(password, reason) => bypass.mutate({
            id: bypassFor.id, bypassed: !bypassFor.bypassedAt, password, reason,
          })}
        />
      )}
    </div>
  );
}

// ── small presentational helpers ────────────────────────────────────────────
function Tile({ label, value, unit, tone = 'default' }: { label: string; value: string; unit?: string; tone?: string }) {
  const toneCls: Record<string, string> = {
    default: 'text-foreground', sky: 'text-sky-400', emerald: 'text-emerald-400', red: 'text-red-400', amber: 'text-amber-400',
  };
  return (
    <div className="rounded-xl bg-muted/40 p-2.5 text-center">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-foreground/45">{label}</div>
      <div className={cn('text-lg font-bold tabular-nums mt-0.5', toneCls[tone])}>
        {value}{unit ? <span className="text-[11px] font-normal text-foreground/40 ml-1">{unit}</span> : null}
      </div>
    </div>
  );
}
function TileMini({ label, value, tone = 'default', icon }: { label: string; value: string; tone?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border/60 px-3 py-1.5 text-center">
      <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-foreground/45">{icon}{label}</div>
      <div className={cn('text-base font-bold tabular-nums', tone === 'amber' && 'text-amber-400')}>{value}</div>
    </div>
  );
}
function ActionBtn({ onClick, icon, label, tone, disabled }: {
  onClick: () => void; icon: React.ReactNode; label: string; tone: string; disabled?: boolean;
}) {
  const cls: Record<string, string> = {
    green: 'bg-green-500/15 text-green-400 active:bg-green-500/25',
    amber: 'bg-amber-500/15 text-amber-400 active:bg-amber-500/25',
    sky: 'bg-sky-500/15 text-sky-400 active:bg-sky-500/25',
    red: 'bg-red-500/15 text-red-400 active:bg-red-500/25',
    emerald: 'bg-emerald-500/15 text-emerald-400 active:bg-emerald-500/25',
  };
  return (
    <button onClick={onClick} disabled={disabled}
      className={cn('flex flex-col items-center justify-center gap-1 h-16 rounded-xl font-semibold text-xs transition active:scale-95',
        cls[tone], disabled && 'opacity-40 pointer-events-none')}>
      {icon}{label}
    </button>
  );
}

const SCRAP_CATEGORIES = ['QUALITY', 'SETUP', 'DAMAGE', 'OVERRUN', 'MATERIAL', 'MACHINE', 'OPERATOR', 'OTHER'];

/**
 * Count entry with two modes:
 *  • Add (+)     → increments the running totals (add-count deltas).
 *  • Correct     → sets the ABSOLUTE totals to fix a mis-count (output endpoint),
 *                  pre-filled with the current good/rejected so the operator edits
 *                  the real numbers.
 */
function CountDialog({ jo, onClose, onSubmit, pending }: {
  jo: JO;
  onClose: () => void;
  onSubmit: (mode: 'add' | 'set', good: number, scrap: number, scrapCategory: string, scrapReason: string) => void;
  pending: boolean;
}) {
  const [mode, setMode] = useState<'add' | 'set'>('add');
  const [good, setGood] = useState('');
  const [scrap, setScrap] = useState('');
  const [scrapCategory, setScrapCategory] = useState('QUALITY');
  const [scrapReason, setScrapReason] = useState('');
  const scrapNum = Number(scrap) || 0;
  const unit = jo.outputUnit ? ` ${jo.outputUnit}` : '';

  // Switching to Correct pre-fills the current totals; back to Add clears.
  const switchMode = (m: 'add' | 'set') => {
    setMode(m);
    if (m === 'set') { setGood(String(jo.actualQtyGood ?? 0)); setScrap(String(jo.actualQtyRejected ?? 0)); }
    else { setGood(''); setScrap(''); }
  };

  const canSave = mode === 'set' ? (good !== '' || scrap !== '') : (!!good || !!scrap);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-card border border-border p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-1">
          <Package size={18} className="text-sky-400" />
          <div className="font-bold text-foreground">{mode === 'set' ? 'Correct count' : 'Add count'} · {jo.workOrder?.orderNumber}</div>
        </div>
        <div className="text-xs text-foreground/50 mb-3">{jo.machine?.name ?? jo.machine?.code ?? jo.operationName}{unit ? ` · counts in${unit}` : ''}</div>

        {/* Mode toggle */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-muted/40 mb-3">
          {(['add', 'set'] as const).map((m) => (
            <button key={m} onClick={() => switchMode(m)}
              className={cn('h-8 rounded-lg text-xs font-semibold transition', mode === m ? 'bg-sky-500 text-white' : 'text-foreground/60')}>
              {m === 'add' ? 'Add (+)' : 'Correct total'}
            </button>
          ))}
        </div>

        {mode === 'set' && (
          <div className="text-[11px] text-amber-400 mb-2">Current: {jo.actualQtyGood ?? 0} good · {jo.actualQtyRejected ?? 0} rejected — edit to the correct totals.</div>
        )}

        {mode === 'add' && (
          <div className="text-[11px] text-muted-foreground mb-2">
            Enter a negative number to take a count back &mdash; e.g. <span className="font-mono">-150</span> in
            Rejected undoes 150 entered by mistake.
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-emerald-400">{mode === 'set' ? 'Accepted (total)' : 'Accepted (±)'}</span>
            {/*
              A TOTAL cannot be negative, but a DELTA can — that is how a count
              entered by mistake is taken back. Before this the only way to undo
              an operator's slip was to edit the database by hand.
            */}
            <input type="number" inputMode="numeric" min={mode === 'set' ? 0 : undefined}
              value={good} onChange={(e) => setGood(e.target.value)}
              className="h-12 text-lg text-center rounded-xl bg-emerald-500/5 border border-emerald-500/25 focus:outline-none focus:border-emerald-400" autoFocus />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-red-400">{mode === 'set' ? 'Rejected (total)' : 'Rejected (±)'}</span>
            <input type="number" inputMode="numeric" min={mode === 'set' ? 0 : undefined}
              value={scrap} onChange={(e) => setScrap(e.target.value)}
              className="h-12 text-lg text-center rounded-xl bg-red-500/5 border border-red-500/25 focus:outline-none focus:border-red-400" />
          </label>
        </div>

        {/* Scrap reason — when a reject quantity is present. */}
        {scrapNum > 0 && (
          <div className="mt-3 space-y-2 rounded-xl bg-red-500/5 border border-red-500/20 p-2.5">
            <div className="text-[11px] font-semibold text-red-400 flex items-center gap-1"><AlertTriangle size={12} /> Scrap reason</div>
            <select value={scrapCategory} onChange={(e) => setScrapCategory(e.target.value)}
              className="w-full h-10 px-2 text-sm rounded-lg bg-background border border-red-500/25 text-red-300 focus:outline-none focus:border-red-400">
              {SCRAP_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="text" value={scrapReason} onChange={(e) => setScrapReason(e.target.value)}
              placeholder="Note / specific cause (optional)"
              className="w-full h-10 px-3 text-sm rounded-lg bg-background border border-red-500/25 focus:outline-none focus:border-red-400 placeholder:text-foreground/30" />
          </div>
        )}

        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl border border-border font-semibold text-sm active:scale-95">Cancel</button>
          <button
            disabled={pending || !canSave}
            onClick={() => onSubmit(mode, Number(good) || 0, scrapNum, scrapCategory, scrapReason)}
            className="flex-1 h-11 rounded-xl bg-sky-500 text-white font-semibold text-sm active:scale-95 disabled:opacity-50"
          >
            {pending ? 'Saving…' : mode === 'set' ? 'Save correction' : 'Save count'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Taking a machine out of the line — the confirmation.
 *
 * ── What the operator is actually agreeing to ───────────────────────────────
 * Not "disable a machine". The line's good total is read from the LAST step a
 * unit passes through, so bypassing that step moves the number the whole line
 * is judged on to a different machine. The dialog therefore leads with the
 * sentence that says so, naming both machines, BEFORE it asks for anything.
 *
 * The consequence is computed here from the same rule the server applies — the
 * last step that is neither bypassed nor the one being bypassed now. The server
 * decides for real and refuses if it disagrees; this is what the operator reads.
 *
 * ── Why a password ──────────────────────────────────────────────────────────
 * Because the change is rare, wide, and easy to make with a thumb. It is a
 * deliberate pause, not a login: the endpoint's permission check and the audit
 * record are what say who did it.
 */
function BypassDialog({ jo, onClose, onConfirm, pending }: {
  jo: JO;
  onClose: () => void;
  onConfirm: (password: string, reason: string) => void;
  pending: boolean;
}) {
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const restoring = !!jo.bypassedAt;

  /**
   * The consequence comes from the SERVER, not from a copy of the rule here.
   *
   * "Which step is the line's output read from" is one rule, and it already
   * exists twice — once in TypeScript for the live path, once in SQL for the
   * minute store. A third copy in this dialog could drift, and its way of
   * failing would be the worst of the three: the operator agrees to a sentence
   * that is not what happens.
   */
  const { data: plan, isLoading: planLoading, isError: planError } = useQuery<any>({
    queryKey: ['step-bypass', jo.workOrderId],
    queryFn: () => api.get(`/production/work-orders/${jo.workOrderId}/step-bypass`),
    enabled: !!jo.workOrderId,
  });

  const steps: any[] = plan?.steps ?? [];
  const byId = (id?: string | null) => steps.find((x) => x.id === id) ?? null;
  const nameOf = (x: any) => x?.machineName ?? x?.machineCode ?? x?.operationName ?? '—';

  const me = byId(jo.id);
  const before = byId(plan?.outputStepId);
  // The server worked this out with the same function it will use to act.
  const after = restoring
    ? // Restoring puts this step back; it is the latest, so it becomes the one.
      (steps.filter((x) => !x.bypassedAt || x.id === jo.id).slice(-1)[0] ?? null)
    : byId(me?.outputMovesTo);

  // Saying this here means the operator does not type a password to be told no.
  const liveSteps = steps.filter((x) => !x.bypassedAt);
  const blocked = !planLoading && !planError
    && (steps.length === 0 || (!restoring && liveSteps.length <= 1));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-labelledby="bypass-title">
      <div className="w-full sm:max-w-md bg-card border border-border rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 mb-1">
          {restoring ? <Undo2 size={18} className="text-emerald-400" /> : <ShieldAlert size={18} className="text-amber-400" />}
          <h3 id="bypass-title" className="text-base font-bold text-foreground">
            {restoring ? 'Put this machine back in the line?' : 'Take this machine out of the line?'}
          </h3>
        </div>
        <p className="text-xs text-foreground/50 mb-4">{nameOf(jo)} · {jo.operationName}</p>

        {planLoading ? (
          <div className="flex items-center gap-2 text-xs text-foreground/50 py-6">
            <Loader2 size={14} className="animate-spin" /> Working out what this changes…
          </div>
        ) : planError ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 mb-4">
            <div className="text-xs font-bold text-red-400 mb-1">Cannot check this right now</div>
            <p className="text-[11px] text-foreground/70 leading-relaxed">
              The line steps could not be loaded, so this screen cannot say which machine the
              total would move to. Try again rather than guessing.
            </p>
          </div>
        ) : blocked ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 mb-4">
            <div className="text-xs font-bold text-red-400 mb-1">This one cannot be bypassed</div>
            <p className="text-[11px] text-foreground/70 leading-relaxed">
              It is the last step still counting. Bypassing it would leave the order with no
              machine to read output from, and the line would report that it produced nothing.
            </p>
          </div>
        ) : (
          <div className="rounded-xl bg-muted/50 p-3 mb-4">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-foreground/45 mb-1.5">
              What changes
            </div>
            <p className="text-sm text-foreground leading-relaxed">
              The line’s good total is read from{' '}
              <b className="text-foreground">{nameOf(before)}</b> today. After this it will be read from{' '}
              <b className={restoring ? 'text-emerald-400' : 'text-amber-400'}>{nameOf(after)}</b>.
            </p>
            <p className="text-[11px] text-foreground/50 mt-2 leading-relaxed">
              This applies to the whole work order, on every screen — not only from now on.
              Scrap already recorded on {nameOf(jo)} still counts as scrap.
            </p>
          </div>
        )}

        {!blocked && !planLoading && !planError && (
          <>
            {!restoring && (
              <label className="block mb-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                  Why (optional)
                </span>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Wrapping table gearbox failed"
                  className="mt-1 w-full h-11 px-3 rounded-xl bg-muted/40 border border-border text-sm text-foreground"
                />
              </label>
            )}

            <label className="block mb-4">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-foreground/45">
                Supervisor password
              </span>
              <input
                type="password"
                inputMode="numeric"
                autoFocus
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && password) onConfirm(password, reason); }}
                className="mt-1 w-full h-12 px-3 rounded-xl bg-muted/40 border border-border text-lg tracking-widest text-foreground"
              />
            </label>
          </>
        )}

        <div className="grid grid-cols-2 gap-2">
          <button onClick={onClose}
            className="h-12 rounded-xl border border-border/60 text-sm font-semibold text-foreground/70 active:bg-muted/60">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(password, reason)}
            disabled={blocked || planLoading || planError || !password || pending}
            className={cn('h-12 rounded-xl text-sm font-bold flex items-center justify-center gap-2 active:scale-95 transition',
              restoring ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400',
              (blocked || planLoading || planError || !password || pending) && 'opacity-40 pointer-events-none')}>
            {pending ? <Loader2 size={16} className="animate-spin" /> : null}
            {restoring ? 'Put it back' : 'Bypass it'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * What the plan says is happening right now.
 *
 * ── Why the tablet needs this at all ────────────────────────────────────────
 * The Machine status timeline draws a plan track above each machine -- the blue
 * "Lunch Break" and "Change Over" bands. The operator standing at the line has
 * no such screen, so a stop that the plant PLANNED looks exactly like a stop
 * that went wrong: the counts stop, the tiles go quiet, and nothing says why.
 *
 * This reads the same events the timeline's plan track reads, through the same
 * function, so the two can never disagree about what is scheduled.
 *
 * ── Why it is ALWAYS on screen ─────────────────────────────────────────────
 * It used to hide itself when nothing was scheduled, to save space on a small
 * screen. That made "the plant has nothing planned" and "this strip is broken"
 * look identical -- which is the exact defect this whole week has been about.
 * A quiet line saying nothing is scheduled costs one row and answers the
 * question; an absent strip answers nothing.
 */
function PlannedNow({ machineIds }: { machineIds: string[] }) {
  const { data } = useQuery<any>({
    queryKey: ['planned-now'],
    // No machine list is sent. Scope is the server's decision -- a client that
    // hands over its own id list walks past the resolution that decides what
    // this user may see, which `scope-reachable.spec.ts` forbids outright.
    // The factory's planned stops are a handful of rows; the filtering below
    // is presentation, not authorisation.
    queryFn: () => api.get('/oee-standard/planned-now'),
    // A planned stop starts on a clock, not on an event, so this polls. Half a
    // minute is well inside the shortest stop the plant configures.
    refetchInterval: 30_000,
  });

  // Narrowed to the machines this operator is standing at, for readability.
  const onMine = (sg: any) => machineIds.length === 0 || machineIds.includes(sg.machineId);
  const active: any[] = (data?.active ?? []).filter(onMine);
  const next: any = ((data?.upcoming ?? []).filter(onMine))[0] ?? null;

  const hhmm = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const minsUntil = (iso: string) => Math.max(0, Math.round((+new Date(iso) - Date.now()) / 60_000));

  // One band usually covers the whole line, booked against each machine
  // separately. Naming it once and listing the machines beside it says the same
  // thing in a quarter of the space.
  const byLabel = new Map<string, { label: string; to: string; machines: string[]; charged: boolean }>();
  for (const a of active) {
    const k = `${a.label}|${a.to}`;
    const hit = byLabel.get(k) ?? { label: a.label, to: a.to, machines: [] as string[], charged: !!a.charged };
    if (a.machineCode) hit.machines.push(a.machineCode);
    byLabel.set(k, hit);
  }

  return (
    <div className="mb-3 space-y-2">
      {[...byLabel.values()].map((b, i) => (
        <div key={i} className="flex items-start gap-2.5 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3.5 py-2.5">
          <CalendarClock size={16} className="text-sky-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-bold text-sky-300">{b.label}</div>
            <div className="text-[11px] text-foreground/60 leading-snug">
              Planned · until {hhmm(b.to)}
              {b.machines.length ? ` · ${b.machines.join(' · ')}` : ''}
              {/* The operator is entitled to know whether this stop is costing
                  the line's reading -- it changes nothing they do, but it
                  changes how the shift's number will look to them later. */}
              {b.charged ? ' · counts against OEE' : ' · excluded from OEE'}
            </div>
          </div>
        </div>
      ))}

      {active.length === 0 && (
        <div className="flex items-center gap-2.5 rounded-xl border border-border/60 px-3.5 py-2 text-xs text-foreground/55">
          <CalendarClock size={14} className="shrink-0 opacity-60" />
          {next ? (
            <>
              Next planned stop: <b className="text-foreground/80">{next.label}</b> in {minsUntil(next.from)} min
              <span className="opacity-60">({hhmm(next.from)})</span>
            </>
          ) : (
            // Said out loud, because a missing strip and an empty schedule are
            // different facts and the operator cannot tell them apart from a
            // blank space.
            <>No planned stop scheduled. Any stop from here is unplanned.</>
          )}
        </div>
      )}
    </div>
  );
}
