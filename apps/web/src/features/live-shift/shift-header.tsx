'use client';
/**
 * The shift band — what this whole page is measuring.
 *
 * Every other live screen in this system showed numbers without saying which
 * shift they belonged to, and at a shift boundary that is the difference between
 * "we are behind" and "we just started". The band states the occurrence, its
 * planned span, how far into it we are, and what is left, before any number
 * appears below it.
 */
import React from 'react';
import { Radio } from 'lucide-react';

import { cn } from '@/lib/utils';
import { dur } from '@/features/oee-analysis/chart-kit';
import { formatTime } from '@/lib/datetime';
import type { ShiftHeader as Header, LiveJobOrder } from './use-live-shift';

// Factory time, via lib/datetime — not `.toLocaleTimeString([], ...)`, which
// reads both the runtime's default locale AND the runtime's local timezone,
// two different clocks on the server and the browser for the same instant
// (React error #418).
const clock = (iso: string | undefined | null) => (iso ? formatTime(iso) : '—');

/** Distinct values of a field across the open orders, in first-seen order. */
function distinct(orders: LiveJobOrder[], pick: (o: LiveJobOrder) => string | null): string[] {
  const seen = new Set<string>();
  for (const o of orders) {
    const v = pick(o);
    if (v && v !== '—') seen.add(v);
  }
  return [...seen];
}

export function ShiftBand({
  shift, jobOrders, scopeLabel, isFetching,
}: {
  shift: Header | undefined;
  jobOrders: LiveJobOrder[];
  scopeLabel: string;
  isFetching: boolean;
}) {
  // Starts null so the server-rendered markup and the client's FIRST paint
  // (before effects run) both show the same nothing — computing `new Date()`
  // directly in useState's initializer runs it again on the client at
  // hydration time, a different instant than the server rendered, which is a
  // guaranteed text mismatch (React error #418) independent of locale.
  const [tick, setTick] = React.useState<Date | null>(null);
  React.useEffect(() => {
    setTick(new Date());
    const id = setInterval(() => setTick(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * The context strip names what is RUNNING, not everything the shift has seen.
   *
   * `jobOrders` deliberately carries every order that overlapped the window,
   * because the shift's totals came from all of them and a screen that drops a
   * closed order shows figures with no visible source. That is right for the
   * TOTALS and wrong for this strip: an order that finished at 21:18 was still
   * being announced at 02:04 as though the line were running it, beside "Open
   * job orders 0" -- two lines of the same header contradicting each other.
   *
   * So the strip reads the live orders, and says plainly when there are none.
   * The totals below keep their full window and keep saying which window it is.
   */
  const live = jobOrders.filter((o) => !o.actualEnd);
  const running = live.length > 0;

  const products = distinct(live, (o) => o.product);
  const orders = distinct(live, (o) => o.workOrder);
  const pos = distinct(live, (o) => o.productionOrder);

  // What the shift produced still came from somewhere, so the closed orders are
  // named rather than hidden -- just not in the "running now" position.
  const finished = distinct(
    jobOrders.filter((o) => o.actualEnd),
    (o) => o.workOrder,
  ).filter((w) => !orders.includes(w));

  if (!shift) {
    return (
      <div className="rounded-lg border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
        Resolving the current shift…
      </div>
    );
  }

  // A gap between shifts is reported as a gap. A confident shift name over an
  // hour nobody worked is worse than an honest blank.
  if (!shift.resolved) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
          No shift is running right now
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          No active shift template covers {clock(shift.now)}. The figures below cover the calendar
          day so far rather than a shift — check the shift templates if the line is working.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded bg-primary/15 px-1.5 py-0.5 text-xs font-bold tracking-wide text-primary">
              {shift.code}
            </span>
            <h2 className="truncate text-base font-semibold text-foreground">{shift.name}</h2>
            <span
              className={cn(
                'inline-flex items-center gap-1 text-[11px] font-medium',
                isFetching ? 'text-primary' : 'text-emerald-600 dark:text-emerald-400',
              )}
            >
              <Radio className={cn('h-3 w-3', isFetching && 'animate-pulse')} aria-hidden />
              {isFetching ? 'Updating' : 'Live'}
            </span>
          </div>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">
            {clock(shift.start)} → {clock(shift.end)}
            <span className="mx-1.5" aria-hidden>·</span>
            planned {dur(shift.plannedMin)}
            <span className="mx-1.5" aria-hidden>·</span>
            now {tick ? formatTime(tick) : '—'}
          </p>
        </div>

        <dl className="flex flex-wrap items-end gap-x-6 gap-y-2 text-right">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Elapsed</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">{dur(shift.elapsedMin)}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Remaining</dt>
            <dd className="text-lg font-semibold tabular-nums text-foreground">{dur(shift.remainingMin)}</dd>
          </div>
        </dl>
      </div>

      {/* Elapsed against the planned shift. Not a KPI — a position in the shift. */}
      <div className="px-4">
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuenow={Math.round(shift.progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Shift elapsed"
        >
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${shift.progressPct}%` }} />
        </div>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 px-4 pb-3 pt-2 text-xs">
        <Ctx label="Scope" value={scopeLabel} />
        <Ctx label="Product" value={products.length ? products.join(' · ') : 'Nothing running'} />
        <Ctx label="Work order" value={orders.length ? orders.join(' · ') : 'Nothing running'} />
        <Ctx label="Production order" value={pos.length ? pos.join(' · ') : '—'} />
        <Ctx label="Open job orders" value={String(live.length)} />
        {!running && finished.length > 0 && (
          <Ctx label="Ran earlier this shift" value={finished.join(' · ')} />
        )}
      </div>
    </div>
  );
}

function Ctx({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <p className="truncate font-medium text-foreground" title={value}>{value}</p>
    </div>
  );
}
