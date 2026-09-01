'use client';

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Trash2, CalendarRange } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/services/api.client';
import { dateTimeLocalToIso, formatDateTime } from '@/lib/datetime';

/**
 * Clear planned downtime for a chosen period — the one reset with a window.
 *
 * ── Why this one has a date range ───────────────────────────────────────────
 * Every other reset clears a whole history, because the histories they clear
 * are MEASURED and a plant either wants the measurements or does not. Planned
 * downtime is different: the plant AUTHORS it, so getting two days wrong is an
 * ordinary mistake. Before this, correcting those two days meant clearing every
 * real breakdown along with them, or running SQL against production by hand.
 *
 * ── The count follows the range ─────────────────────────────────────────────
 * A number sitting beside a range control gets read as that range's total. So
 * it is: pick a period and the card asks the server, using the same overlap
 * rule the delete itself uses. The figure confirmed is the figure that goes.
 */
export function ResetPlannedDowntimeCard({
  totalAllTime,
  onReset,
}: {
  /** Whole-history figure, shown until a period is chosen. */
  totalAllTime?: number;
  onReset: (from: string, to: string, count: number) => void;
}) {
  // Defaulted to today so the control opens on something real, and deliberately
  // NOT to a wide range — a destructive form should never open pre-aimed at
  // more than the operator asked for.
  const today = new Date();
  const iso = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const startOfToday = new Date(today); startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(today); endOfToday.setHours(23, 59, 0, 0);

  const [from, setFrom] = React.useState(iso(startOfToday));
  const [to, setTo] = React.useState(iso(endOfToday));

  const fromIso = dateTimeLocalToIso(from);
  const toIso = dateTimeLocalToIso(to);
  const rangeValid = !!fromIso && !!toIso && new Date(toIso) > new Date(fromIso);

  const preview = useQuery({
    queryKey: ['planned-downtime-preview', fromIso, toIso],
    queryFn: () => api.get<{ total: number; plannedDowntimeEvents: number; plannedStateRecords: number }>(
      '/system/planned-downtime-preview',
      { params: { from: fromIso, to: toIso } },
    ),
    enabled: rangeValid,
    staleTime: 5_000,
  });

  const inRange = preview.data?.total;
  const nothingToDelete = rangeValid && preview.isFetched && inRange === 0;

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/[0.03] p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-red-300">Reset Planned Downtime</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            Deletes planned downtime events and their PLANNED_STOP timeline bands for a period you
            choose. Unplanned downtime in the same period is kept — a machine that genuinely broke
            down during a cancelled cleaning window still broke down. Causes and categories are
            configuration and are preserved.
          </p>
          <div className="text-xs mt-2 text-muted-foreground">
            {rangeValid ? (
              <>
                In this period{' '}
                <span className="font-bold text-foreground">
                  {preview.isFetching && inRange === undefined ? '…' : (inRange ?? 0).toLocaleString()}
                </span>
                {preview.data && preview.data.total > 0 && (
                  <span className="ms-1 opacity-70">
                    ({preview.data.plannedDowntimeEvents.toLocaleString()} events,{' '}
                    {preview.data.plannedStateRecords.toLocaleString()} timeline bands)
                  </span>
                )}
              </>
            ) : (
              <>
                On file, all time{' '}
                <span className="font-bold text-foreground">{(totalAllTime ?? 0).toLocaleString()}</span>
              </>
            )}
          </div>
        </div>

        <Button
          variant="destructive"
          size="sm"
          className="shrink-0"
          disabled={!rangeValid || !inRange}
          onClick={() => rangeValid && inRange ? onReset(fromIso!, toIso!, inRange) : undefined}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" /> Reset
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-t border-red-500/15 pt-3">
        <div className="space-y-1">
          <label htmlFor="pd-from" className="text-[11px] uppercase tracking-wider text-muted-foreground">From</label>
          <Input id="pd-from" type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-[13.5rem] text-xs" />
        </div>
        <div className="space-y-1">
          <label htmlFor="pd-to" className="text-[11px] uppercase tracking-wider text-muted-foreground">To</label>
          <Input id="pd-to" type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-[13.5rem] text-xs" />
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground pb-1.5">
          <CalendarRange className="w-3.5 h-3.5" aria-hidden />
          {/* Stated because "between these dates" is ambiguous at the edges, and
              on a delete the ambiguity is expensive. */}
          <span>
            Anything overlapping the period is included, even if it started before it.
          </span>
        </div>
      </div>

      {!rangeValid && (
        <p className="text-[11px] text-red-300/80">The period ends before it starts.</p>
      )}
      {nothingToDelete && (
        <p className="text-[11px] text-muted-foreground">
          No planned downtime in {formatDateTime(fromIso!)} → {formatDateTime(toIso!)}. Nothing to reset.
        </p>
      )}
    </div>
  );
}
