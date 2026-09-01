'use client';
/**
 * Live Machines — what every machine is doing at this instant.
 *
 * The counterpart to Live Production: that page is about the orders, this one is
 * about the equipment. Same query, same shift window, so the two can never
 * disagree about the same machine.
 *
 * Machines are laid out as cards rather than a table because the question here is
 * "which one needs me" — a stopped machine should be findable across a room, and
 * a row in a table is not. Sorted by trouble first for the same reason.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';
import {
  useLive, LiveHeader, LiveStat, LivePct, LiveEmpty, LiveFailed,
  StateChip, fmtMin, fmtNum, since, type LiveMachine,
} from './live-shared';

/** Stopped and it is the machine's own fault → look here first. */
const OWN_FAULT = new Set(['BREAKDOWN']);
/** Stopped because the line cannot feed or drain it → not its fault. */
const WAITING = new Set(['STARVED', 'BLOCKED']);

/** Trouble first: own fault, then waiting, then everything else. */
function triage(m: LiveMachine): number {
  if (OWN_FAULT.has(m.state)) return 0;
  if (WAITING.has(m.state)) return 1;
  if (m.state === 'RUNNING') return 3;
  return 2;
}

function MachineCard({ m }: { m: LiveMachine }) {
  const { t } = useTranslation('production');
  const own = OWN_FAULT.has(m.state);
  const waiting = WAITING.has(m.state);

  return (
    <div className={cn(
      'rounded-lg border p-4 flex flex-col gap-3',
      own ? 'border-red-500/40 bg-red-500/[0.04]'
        : waiting ? 'border-amber-500/40 bg-amber-500/[0.04]'
        : 'border-border/50',
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">{m.code}</div>
          <div className="text-[11px] text-muted-foreground truncate">{m.name}</div>
          {m.line && <div className="text-[10px] text-muted-foreground/70 mt-0.5">{m.line}</div>}
        </div>
        <div className="text-end shrink-0">
          <StateChip state={m.state} />
          {m.stateSince && (
            <div className="text-[10px] text-muted-foreground mt-1">
              {t('live.forDuration', { ago: since(m.stateSince) })}
            </div>
          )}
        </div>
      </div>

      {/* Shift-to-date, from the same aggregate every other page reads. */}
      <div className="grid grid-cols-3 gap-2 text-center border-t border-border/30 pt-3">
        <div>
          <div className="text-[10px] text-muted-foreground">{t('oeeAn.availability')}</div>
          <div className="mt-0.5"><LivePct v={m.availability} /></div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">{t('machineStatus.running')}</div>
          <div className="text-sm font-semibold tabular-nums mt-0.5">{fmtMin(m.runMin)}</div>
        </div>
        <div>
          <div className="text-[10px] text-muted-foreground">{t('machineStatus.unplanned')}</div>
          <div className={cn('text-sm font-semibold tabular-nums mt-0.5', m.downMin > 0 && 'text-red-400')}>
            {fmtMin(m.downMin)}
          </div>
        </div>
      </div>

      {/* Only shown when non-zero — a permanent row of zeroes teaches people to
          stop reading the row that matters when it is not zero. */}
      {(m.externalMin > 0 || m.unmeasuredMin > 0) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] border-t border-border/30 pt-2">
          {m.externalMin > 0 && (
            <span className="text-amber-500">
              {t('machineStatus.external')} {fmtMin(m.externalMin)}
            </span>
          )}
          {m.unmeasuredMin > 0 && (
            <span className="text-amber-500" title={t('machineStatus.unmeasuredHelp')}>
              {t('machineStatus.unmeasured')} {fmtMin(m.unmeasuredMin)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function LiveMachinesView() {
  const { t } = useTranslation(['production', 'common']);
  // Declaring the mode is what hides the period control: this view has no use
  // for one, and an unusable filter is worse than a missing one.
  useDeclareViewMode('live');
  const { data, isLoading, error, refetch, scope } = useLive();

  const body = () => {
    if (error) return <LiveFailed onRetry={refetch} />;
    if (isLoading && !data) return <LiveEmpty text={t('common:loading')} />;
    if (!data?.machines?.length) return <LiveEmpty text={t('machineStatus.noMachines')} />;

    const ordered = [...data.machines].sort((a, b) => triage(a) - triage(b) || a.code.localeCompare(b.code));
    const running = data.machines.filter((m) => m.state === 'RUNNING').length;
    const faults = data.machines.filter((m) => OWN_FAULT.has(m.state)).length;
    const waiting = data.machines.filter((m) => WAITING.has(m.state)).length;
    const unmeasured = data.machines.filter((m) => m.unmeasuredMin > 0).length;

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <LiveStat label={t('live.producingNow')} value={`${running}/${data.machines.length}`} tone="good" />
          <LiveStat label={t('live.ownFault')} value={String(faults)} tone={faults > 0 ? 'bad' : undefined}
                    sub={t('live.ownFaultHelp')} />
          <LiveStat label={t('live.waitingOnLine')} value={String(waiting)} tone={waiting > 0 ? 'warn' : undefined}
                    sub={t('live.waitingHelp')} />
          <LiveStat label={t('oeeAn.availability')}
                    value={data.totals.availability == null ? '—' : `${data.totals.availability}%`}
                    sub={t('live.thisShift')} />
          {unmeasured > 0 && (
            <LiveStat label={t('machineStatus.unmeasured')} value={String(unmeasured)} tone="warn"
                      sub={t('live.unmeasuredHelp')} />
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {ordered.map((m) => <MachineCard key={m.machineId} m={m} />)}
        </div>

        <p className="text-[11px] text-muted-foreground">{t('live.machinesNote')}</p>
      </div>
    );
  };

  return (
    <div className="p-6 space-y-6">
      <LiveHeader
        title={t('live.machinesTitle')}
        subtitle={t('live.machinesSubtitle')}
        icon={Activity}
        data={data}
        scope={scope}
      />
      {body()}
    </div>
  );
}
