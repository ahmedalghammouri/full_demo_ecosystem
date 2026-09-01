'use client';

/**
 * DowntimeReasonList — recorded downtime events with inline reason / sub-reason
 * attribution. Solves the "assign a reason to a PAST stoppage" requirement: the
 * system auto-records downtime (from machine state) often WITHOUT a reason; here an
 * operator/supervisor picks an event and sets its reason + sub-reason from the
 * predefined cause tree. Reuses the shared CauseTreeSelect and the existing
 * PATCH /production/downtime/events/:id endpoint (production:execute) — no backend
 * change. Tablet-friendly (large targets; the tree picker no longer traps the
 * on-screen keyboard).
 */

import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Clock, CheckCircle2, ChevronDown, Loader2, Tag, Square, History, Radio } from 'lucide-react';

import { api } from '@/services/api.client';
import { useToast } from '@/components/ui/use-toast';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDateTimeShort, toDateTimeLocal, dateTimeLocalToIso } from '@/lib/datetime';
import {
  CauseTreeSelect,
  type ReasonNode, type CauseSelection,
} from '@/features/production/production-downtime-view';

/** How many history rows reveal per tap. */
const HISTORY_PAGE = 8;

type DowntimeEvent = {
  id: string;
  machineId: string;
  machine: { id: string; name: string; code: string } | null;
  workOrder: { id: string; orderNumber: string } | null;
  cause: { id: string; name: string; parent?: { name: string; parent?: { name: string } } } | null;
  category: string;
  reasonCode: string;
  reason: string | null;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
  isOpen: boolean;
  isPlanned: boolean;
};

/** Plant time, not the tablet's. A device with a wrong timezone must not shift
 *  the clock an operator reads off a downtime record. */
function fmtWhen(iso: string) {
  return formatDateTimeShort(iso);
}
function fmtDur(mins: number | null, isOpen: boolean) {
  if (isOpen) return 'ongoing';
  if (mins == null) return '—';
  if (mins < 60) return `${Math.round(mins)}m`;
  const h = Math.floor(mins / 60);
  return `${h}h ${Math.round(mins % 60)}m`;
}
function causePath(c: DowntimeEvent['cause']): string | null {
  if (!c) return null;
  const parts = [c.parent?.parent?.name, c.parent?.name, c.name].filter(Boolean);
  return parts.join(' › ');
}
/**
 * datetime-local value in PLANT time.
 *
 * This used to read the browser's clock (getFullYear/getHours…). On a tablet set
 * to any other timezone the prefilled "now" was wrong, and because the submit
 * path re-read the field as plant time, closing a stoppage recorded the wrong
 * instant — and could even produce a negative duration.
 */
function toLocalInput(iso?: string) {
  return toDateTimeLocal(iso ?? new Date());
}

// Close an open downtime with an operator-adjustable end time (defaults to now,
// floored to the event's start so a negative duration is impossible).
function CloseRow({ start, onClose, pending }: { start: string; onClose: (endTime: string) => void; pending: boolean }) {
  const { t } = useTranslation('production');
  const [end, setEnd] = useState(() => toLocalInput());
  const minEnd = toLocalInput(start);
  return (
    <div className="mt-2 rounded-lg bg-muted/30 p-2.5">
      <div className="text-[11px] font-medium text-red-400 mb-1.5 flex items-center gap-1.5"><Square size={11} /> {t('opHub.dt.closeTitle', { defaultValue: 'Close this downtime' })}</div>
      <div className="flex items-center gap-2">
        <input
          type="datetime-local"
          value={end}
          min={minEnd}
          onChange={(ev) => setEnd(ev.target.value)}
          className="flex-1 h-9 text-sm rounded-lg bg-background border border-border px-2 focus:outline-none focus:border-red-400"
        />
        <button
          disabled={pending || !end || end < minEnd}
          onClick={() => onClose(end)}
          className="h-9 px-3 rounded-lg bg-red-500 text-white text-sm font-semibold active:scale-95 disabled:opacity-50"
        >
          {pending ? '…' : t('opHub.dt.close', { defaultValue: 'Close' })}
        </button>
      </div>
    </div>
  );
}

export function DowntimeReasonList({
  machineIds,
  workOrderId,
  limit = 40,
  className,
}: {
  /** Restrict to these machines (client-side filter). Omit = whole factory. */
  machineIds?: string[];
  workOrderId?: string;
  limit?: number;
  className?: string;
}) {
  const { t } = useTranslation('production');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // History starts collapsed: a busy shift can rack up dozens of stoppages and
  // an endlessly tall page is unusable on a tablet held in one hand.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyShown, setHistoryShown] = useState(HISTORY_PAGE);

  // ── Two queries on purpose ──────────────────────────────────────────
  // The API orders by startTime DESC with a default page size. Planned cleaning
  // slots are generated days AHEAD, so their startTime outranks a stoppage that
  // is happening right now — the whole page filled with future planned stops and
  // the live breakdown never appeared on the operator's screen.
  //
  // So OPEN events are fetched on their own, unbounded by date, and always shown
  // first. History is a separate, capped list bounded to the PAST.
  const now = useMemo(() => new Date(), []);
  const dateFrom = useMemo(() => new Date(+now - 7 * 86_400_000).toISOString(), [now]);

  const { data: openData, isLoading: openLoading } = useQuery({
    queryKey: ['downtime-events', 'open', workOrderId ?? 'all'],
    queryFn: () => api.get('/production/downtime/events', {
      params: { ...(workOrderId ? { workOrderId } : {}), isOpen: 'true', limit: 50 },
    }),
    refetchInterval: 15_000,
  });

  const { data, isLoading: histLoading } = useQuery({
    queryKey: ['downtime-events', 'history', workOrderId ?? 'all', dateFrom, limit],
    queryFn: () => api.get('/production/downtime/events', {
      // dateTo = now excludes planned stops scheduled for later this week — an
      // operator cannot act on a cleaning slot five days out.
      params: { ...(workOrderId ? { workOrderId } : {}), dateFrom, dateTo: new Date().toISOString(), limit },
    }),
    refetchInterval: 30_000,
  });
  const isLoading = openLoading || histLoading;

  const { data: reasonTree = [] } = useQuery<ReasonNode[]>({
    queryKey: ['downtime-reason-tree'],
    queryFn: () => api.get('/production/downtime/reasons/tree'),
    staleTime: 300_000,
  });

  const scope = (list: DowntimeEvent[]) =>
    machineIds?.length ? list.filter((e) => machineIds.includes(e.machineId)) : list;

  /** Live stoppages — always visible, never truncated. */
  const openEvents: DowntimeEvent[] = useMemo(
    () => scope((openData as any)?.data ?? []),
    [openData, machineIds],
  );

  /** Closed history, newest first, with the open ones removed so nothing repeats. */
  const historyEvents: DowntimeEvent[] = useMemo(() => {
    const openIds = new Set(openEvents.map((e) => e.id));
    return scope((data as any)?.data ?? []).filter((e) => !openIds.has(e.id) && !e.isOpen);
  }, [data, machineIds, openEvents]);


  const setReason = useMutation({
    mutationFn: ({ id, causeId, category }: { id: string; causeId: string; category: string }) =>
      api.patch(`/production/downtime/events/${id}`, { causeId, category }),
    onSuccess: () => {
      toast({ title: t('dlive.toastLogged', { defaultValue: 'Reason saved' }) });
      qc.invalidateQueries({ queryKey: ['downtime-events'] });
      qc.invalidateQueries({ queryKey: ['downtime'] });
      setExpandedId(null);
    },
    onError: (e: any) =>
      toast({ variant: 'destructive', title: 'Failed to save reason', description: e?.response?.data?.message }),
  });

  const closeEvent = useMutation({
    mutationFn: ({ id, endTime }: { id: string; endTime: string }) =>
      // The field holds PLANT-local time; convert with the factory zone, not the
      // tablet's, or the recorded end instant is off by the device's offset.
      api.patch(`/production/downtime/events/${id}/end`, { endTime: dateTimeLocalToIso(endTime) }),
    onSuccess: () => {
      toast({ title: 'Downtime closed' });
      qc.invalidateQueries({ queryKey: ['downtime-events'] });
      qc.invalidateQueries({ queryKey: ['downtime'] });
      qc.invalidateQueries({ queryKey: ['machine-states-3d'] });
      qc.invalidateQueries({ queryKey: ['machine-states'] });
    },
    onError: (e: any) =>
      toast({ variant: 'destructive', title: 'Failed to close downtime', description: e?.response?.data?.message }),
  });

  const onCause = (eventId: string) => (_id: string, sel: CauseSelection | null) => {
    if (sel) setReason.mutate({ id: eventId, causeId: _id, category: sel.category });
  };

  /** Count of closed events still missing a reason — the operator's to-do. */
  const needReason = useMemo(
    () => historyEvents.filter((e) => !e.cause && !e.reason).length,
    [historyEvents],
  );

  /** One event card. Touch targets are >= 44px; the whole header is the hit area. */
  const renderEvent = (e: DowntimeEvent) => {
    const hasReason = !!e.cause || !!e.reason;
    const expanded = expandedId === e.id;
    const busy = setReason.isPending && expandedId === e.id;
    return (
      <li
        key={e.id}
        className={cn(
          'rounded-2xl border bg-card transition-shadow',
          // Collapsed: clip to the rounded corners (keeps the tap ripple tidy).
          // Expanded: must NOT clip — the cause picker below opens an absolutely
          // positioned dropdown that can be taller than this card. With
          // overflow-hidden here that dropdown was invisibly cut off at the
          // card's bottom edge, so on a short tablet/laptop viewport an operator
          // saw the search box but none of the reasons under it and could not
          // pick one. Letting the card grow (overflow-visible) lets the page
          // scroll to reveal the full list instead.
          expanded ? 'overflow-visible' : 'overflow-hidden',
          e.isOpen ? 'border-red-500/45 shadow-[0_0_0_1px_rgba(239,68,68,0.18)]' : 'border-border/60',
        )}
      >
        <button
          onClick={() => setExpandedId(expanded ? null : e.id)}
          className="w-full flex items-center gap-3 p-3.5 min-h-[68px] text-start active:bg-accent/40 transition"
        >
          <div className={cn(
            'flex items-center justify-center w-11 h-11 rounded-xl shrink-0',
            e.isOpen ? 'bg-red-500/15 text-red-400'
              : e.isPlanned ? 'bg-sky-500/15 text-sky-400'
              : 'bg-amber-500/15 text-amber-400',
          )}>
            {e.isOpen ? <Radio size={19} className="animate-pulse" /> : <AlertTriangle size={19} />}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-[15px] text-foreground truncate">
                {e.machine?.code ?? e.machine?.name ?? 'Machine'}
              </span>
              {e.isOpen && (
                <Badge variant="destructive" className="h-[18px] text-[10px] font-bold tracking-wide">
                  {t('opHub.dt.live', { defaultValue: 'LIVE' })}
                </Badge>
              )}
              {e.isPlanned && !e.isOpen && (
                <Badge variant="outline" className="h-[18px] text-[10px] text-sky-400 border-sky-500/40">
                  {t('opHub.dt.planned', { defaultValue: 'PLANNED' })}
                </Badge>
              )}
              {e.workOrder && (
                <span className="text-[11px] font-mono text-brand-400/70">{e.workOrder.orderNumber}</span>
              )}
            </div>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-1">
              <Clock size={12} />
              <span>{fmtWhen(e.startTime)}</span>
              <span className="opacity-40">/</span>
              <span className={cn('font-semibold tabular-nums', e.isOpen && 'text-red-400')}>
                {fmtDur(e.durationMinutes, e.isOpen)}
              </span>
            </div>

            <div className="mt-1.5">
              {hasReason ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                  <CheckCircle2 size={13} /> <span className="truncate">{causePath(e.cause) ?? e.reason}</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-semibold">
                  <Tag size={13} /> {t('opHub.dt.noReason', { defaultValue: 'No reason set - tap to add' })}
                </span>
              )}
            </div>
          </div>

          <ChevronDown
            size={18}
            className={cn('text-muted-foreground shrink-0 transition-transform', expanded && 'rotate-180')}
          />
        </button>

        {expanded && (
          <div className="p-3.5 pt-0 border-t border-border/50">
            {e.isOpen && (
              <CloseRow
                start={e.startTime}
                pending={closeEvent.isPending}
                onClose={(endTime) => closeEvent.mutate({ id: e.id, endTime })}
              />
            )}
            <div className="text-xs font-semibold text-muted-foreground mb-2 mt-3">
              {hasReason
                ? t('opHub.dt.changeReason', { defaultValue: 'Change reason / sub-reason' })
                : t('opHub.dt.selectReason', { defaultValue: 'Select reason / sub-reason' })}
            </div>
            {busy ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="animate-spin" size={15} /> {t('opHub.dt.saving', { defaultValue: 'Saving...' })}
              </div>
            ) : (
              <CauseTreeSelect
                reasonTree={reasonTree}
                value={e.cause?.id ?? ''}
                machineId={e.machineId || undefined}
                onChange={onCause(e.id)}
              />
            )}
          </div>
        )}
      </li>
    );
  };

  const visibleHistory = historyOpen ? historyEvents.slice(0, historyShown) : [];

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {isLoading && openEvents.length === 0 && historyEvents.length === 0 ? (
        <div className="flex items-center gap-2 text-muted-foreground p-4 text-sm">
          <Loader2 className="animate-spin" size={16} />
          {t('opHub.dt.loading', { defaultValue: 'Loading downtime events...' })}
        </div>
      ) : (
        <>
          {/* LIVE - always visible, never collapsed, never truncated */}
          <section>
            <h3 className="flex items-center gap-2 text-sm font-bold text-foreground mb-2">
              <span className={cn(
                'inline-block w-2 h-2 rounded-full',
                openEvents.length ? 'bg-red-500 animate-pulse' : 'bg-emerald-500',
              )} />
              {t('opHub.dt.liveTitle', { defaultValue: 'Active stoppages' })}
              {openEvents.length > 0 && (
                <span className="text-red-400 tabular-nums">({openEvents.length})</span>
              )}
            </h3>

            {openEvents.length === 0 ? (
              <div className="rounded-2xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-5 text-center">
                <CheckCircle2 size={22} className="mx-auto text-emerald-400 mb-1.5" />
                <p className="text-sm font-semibold text-emerald-400">
                  {t('opHub.dt.allRunning', { defaultValue: 'No active stoppages - all machines running' })}
                </p>
              </div>
            ) : (
              <ul className="flex flex-col gap-2.5">{openEvents.map(renderEvent)}</ul>
            )}
          </section>

          {/* HISTORY - collapsed so the page cannot grow unbounded */}
          {historyEvents.length > 0 && (
            <section>
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="w-full flex items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-4 py-3 min-h-[56px] active:bg-accent/40 transition"
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <History size={16} className="text-muted-foreground" />
                  {t('opHub.dt.historyTitle', { defaultValue: 'Recent stoppages' })}
                  <span className="text-muted-foreground tabular-nums">({historyEvents.length})</span>
                </span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {needReason > 0 && (
                    <Badge variant="outline" className="h-[18px] text-[10px] text-amber-400 border-amber-500/40">
                      {needReason} {t('opHub.dt.needReason', { defaultValue: 'need a reason' })}
                    </Badge>
                  )}
                  <ChevronDown size={17} className={cn('transition-transform', historyOpen && 'rotate-180')} />
                </span>
              </button>

              {historyOpen && (
                <>
                  <ul className="flex flex-col gap-2.5 mt-2.5">{visibleHistory.map(renderEvent)}</ul>
                  {historyShown < historyEvents.length && (
                    <button
                      onClick={() => setHistoryShown((n) => n + HISTORY_PAGE)}
                      className="w-full mt-2.5 h-11 rounded-xl border border-border/60 text-sm font-semibold text-muted-foreground active:bg-accent/40"
                    >
                      {t('opHub.dt.showMore', { defaultValue: 'Show more' })}
                      {' '}({historyEvents.length - historyShown})
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
