'use client';
/**
 * Live Shift — the current shift, as it happens.
 *
 * ── What separates this page from the analysis page ─────────────────────────
 * It has no date filter. The window is the shift, decided by the clock, and each
 * panel may narrow to a tail of it. That is the whole distinction: the analysis
 * page answers "what happened", this one answers "what is happening", and
 * neither can be pointed at the other's question. When both were one page with
 * one filter, the same day could read two ways depending on which half you were
 * looking at.
 *
 * ── Why it agrees with the analysis page by construction ────────────────────
 * Every number here comes from `oee_minutes` through `OeeStandardService` — the
 * same engine, the same scope, the same final-step rule. This page is a window,
 * not a third engine. It reuses the components too: the gauges and the duration
 * formatter come from the analysis page's own kit, and the timeline is the
 * `MachineStateGantt` that was already built for it.
 */
import React from 'react';
import { AlertTriangle, PackageCheck } from 'lucide-react';

import { useScope } from '@/hooks/use-scope';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';
import { MachineStateGantt, type GanttRow } from '@/components/charts/machine-state-gantt';
import { Gauge, dur, stateColour, SEGMENT_COLOUR, STATUS, pctText, TrendChart } from '@/features/oee-analysis/chart-kit';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/datetime';

import { LineOeeCard } from '@/features/oee-analysis/line-oee-card';
import { Panel, type RangeKey } from './range-control';
import { ShiftBand } from './shift-header';
import {
  useLiveShift, topMin, TOP_LABEL,
  type LiveShiftPayload, type LiveJobOrder, type Basis,
} from './use-live-shift';

// 'en-US' pinned, not the runtime default: `.toLocaleString()` with no locale
// follows Node's ICU default on the server and the visitor's OWN BROWSER
// LANGUAGE on the client — a hydration text mismatch (React error #418) on
// every number this formats.
const num = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: digits });

// Factory time, via lib/datetime — not `.toLocaleTimeString([], ...)`, which
// reads both the runtime's default locale AND the runtime's local timezone,
// two different clocks on the server and the browser for the same instant.
const clock = (iso: string | null | undefined) => (iso ? formatTime(iso) : '—');

/**
 * Each panel keeps its own range in its own state.
 *
 * A single hook per panel rather than a shared page-level range: panels on the
 * same range share one React Query entry and therefore one set of numbers, and
 * panels on different ranges are honestly different. See `use-live-shift`.
 */
function useRange(initial: RangeKey = 'shift') {
  const [range, setRange] = React.useState<RangeKey>(initial);
  const q = useLiveShift(range);
  return { range, setRange, ...q };
}

export function LiveShiftView() {
  const { key: scopeKey, scope } = useScope();
  useDeclareViewMode('live');

  // The band and the headline share the whole-shift query — the header must
  // describe the shift, not whichever tail a panel happens to be showing.
  const shiftQ = useLiveShift('shift');
  const data = shiftQ.data;

  const scopeLabel = scope && scope.type !== 'FACTORY' ? `${scope.name ?? scope.id}` : 'Whole factory';

  const basis: Basis = data?.basis ?? 'standard';
  const isSchedule = basis === 'schedule';

  return (
    <div className="space-y-3 p-3">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">Live Shift</h1>
          <span className={cn('rounded px-2 py-0.5 text-[11px] font-semibold',
            isSchedule ? 'bg-sky-500/15 text-sky-500' : 'bg-violet-500/15 text-violet-400')}>
            {isSchedule ? 'Schedule basis' : 'Standard basis'}
          </span>
        </div>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          The shift running now. No date filter — each panel shows the whole shift or a tail of it,
          and says which.{' '}
          {isSchedule ? (
            <>
              Dividing by the slot each order was <b>committed</b> to, so the remainder of the shift
              is charged before it happens and this reading climbs as the shift runs. Switch to{' '}
              <b>OEE-TB</b> in the filter panel for the time that has actually gone by.
            </>
          ) : (
            <>
              Dividing by the time that has actually gone by, so the reading is complete for every
              minute elapsed. Switch to <b>OEE</b> in the filter panel to divide by the promised
              slot instead.
            </>
          )}
        </p>
      </div>

      <ShiftBand
        shift={data?.shift}
        jobOrders={data?.jobOrders ?? []}
        scopeLabel={scopeLabel}
        isFetching={shiftQ.isFetching}
      />

      {shiftQ.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          The live feed could not be read. The panels below show the last figures that arrived.
        </div>
      )}

      {/* What the line scored this shift. Above the machine-level panels for the
          same reason as on the analysis page: they answer different questions,
          and seeing both is the point. */}
      <LineOeeCard data={data?.lineOee} />

      <div className="grid gap-3 xl:grid-cols-2">
        <FactorsPanel />
        <OutputPanel />
      </div>

      <TrendPanel />
      <TimelinePanel />

      <div className="grid gap-3 xl:grid-cols-2">
        <StatePanel />
        <RejectPanel />
      </div>

      <JobOrdersPanel />
      <MachinesPanel />

      <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">
        Every panel reads <code>{isSchedule ? 'oee_schedule_minutes' : 'oee_minutes'}</code> through
        the {isSchedule ? 'schedule' : 'standard'} engine — the same store and the same rules the
        OEE Analysis page uses on this basis — scoped to this shift. Good and theoretical counts come from each work order&apos;s FINAL routing step, so
        the shift total is deliberately not the sum of the machine rows — one pallet leaving the
        wrapper is one pallet, not four units counted once per station. Scrap is counted at every
        step, because a unit thrown away at the filler is a real loss the wrapper never saw.
      </p>
    </div>
  );
}

// ── Factors ─────────────────────────────────────────────────────────────────

function FactorsPanel() {
  const { range, setRange, data, isFetching } = useRange('shift');
  return (
    <Panel title="Shift performance" range={range} onRange={setRange}
      window={data?.window} loading={isFetching}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Gauge label="OEE" value={data?.oee ?? null} />
        <Gauge label="Availability" value={data?.availability ?? null} />
        <Gauge label="Performance" value={data?.performance ?? null} />
        <Gauge label="Quality" value={data?.quality ?? null} />
      </div>
      {data && !data.audit?.ok && (
        <p className="mt-2 flex items-start gap-1.5 rounded bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          The time model does not close on itself for this window
          (drift {num(data.audit?.identityDriftMin, 2)} min). The factors above are still the
          engine&apos;s own output — this flags that they should not be trusted yet.
        </p>
      )}
      {/*
        Separate from the drift warning above, and deliberately so: the minutes
        can reconcile perfectly while the line was still producing through a
        scheduled stop. Those parts raise Performance without raising what it
        divides by, and until this line existed nothing said so.
      */}
      {(data?.audit?.outputWithoutRuntimeParts ?? 0) > 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded bg-sky-500/10 px-2 py-1 text-[11px] text-sky-700 dark:text-sky-300">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>
            <b>{num(data!.audit!.outputWithoutRuntimeParts)}</b> pieces were counted while the
            schedule had this line stopped, adding{' '}
            <b>+{num(data!.audit!.outputWithoutRuntimePct, 2)}</b> points to Performance with
            nothing added to what it divides by. Either the schedule does not match what ran, or
            a stop needs logging.
          </span>
        </p>
      )}
    </Panel>
  );
}

// ── Output ──────────────────────────────────────────────────────────────────

function OutputPanel() {
  const { range, setRange, data, isFetching } = useRange('shift');
  const c = data?.counts;
  const t = data?.time ?? {};
  const basis: Basis = data?.basis ?? 'standard';

  /**
   * The last station made nothing, but stations before it did.
   *
   * Output is counted at the FINAL routing step, which is the only place a unit
   * can be counted once. On a whole shift that is simply the line's output. Over
   * a short window it can read zero while the line is plainly working: the
   * filler and the cartoner are filling the buffers, and nothing has reached the
   * wrapper yet. Quality then divides zero by the scrap and prints 0.0%, which
   * is arithmetic answering a question nobody asked.
   *
   * The figures are left exactly as the engine computed them — this says what
   * they mean, rather than adjusting them into looking better.
   */
  const upstream = (data?.machines ?? []).filter((m) => (m.counts?.good ?? 0) > 0);
  const buffering = (c?.good ?? 0) === 0 && upstream.length > 0;

  return (
    <Panel title="Output and time" range={range} onRange={setRange}
      window={data?.window} loading={isFetching}>
      {buffering && (
        <p className="mb-2 flex items-start gap-1.5 rounded bg-sky-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-sky-700 dark:text-sky-300">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>
            Nothing reached the <strong>last station</strong> in this window, so line output is
            zero — but {upstream.map((m) => `${m.label} made ${num(m.counts.good)}`).join(', ')}.
            Those units are in the buffers between stations. Quality and OEE below are computed
            from the last station, so they read low for the same reason. Widen the range to the
            whole shift for a figure that is not dominated by where the buffers happen to be.
          </span>
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Good" value={num(c?.good)} unit="pieces · last station" tone="good" icon={<PackageCheck className="h-3.5 w-3.5" />} />
        <Stat label="Rejected" value={num(c?.rejected)} unit="pieces · every station" tone={c && c.rejected > 0 ? 'bad' : 'none'} />
        <Stat label="Total produced" value={num(c?.total)} unit="pieces" />
        <Stat label="Theoretical" value={num(c?.theoretical)} unit="last station, design speed" />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={TOP_LABEL[basis]} value={dur(topMin(data?.time))} />
        <Stat label="Running" value={dur(t.netProductionMin)} tone="good" />
        <Stat label="Unplanned down" value={dur(t.availabilityLossMin)} tone={t.availabilityLossMin > 0 ? 'bad' : 'none'} />
        <Stat label="Starved / blocked" value={dur(t.externalLossMin)} tone={t.externalLossMin > 0 ? 'warn' : 'none'} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Planned stops" value={dur(t.plannedStopMin)} />
        {/* The two terms that exist only on the schedule basis. Shown as their
            own row rather than folded in, because they are not losses the
            machine caused — they are the promise not yet kept and the promise
            not yet reached, and reading them as downtime is the misreading this
            basis most invites. */}
        {basis === 'schedule' ? (
          <>
            <Stat label="Not started" value={dur(t.notStartedMin)}
              unit="slot open, machine idle"
              tone={(t.notStartedMin ?? 0) > 0 ? 'warn' : 'none'} />
            <Stat label="Not yet reached" value={dur(t.notYetReachedMin)}
              unit="still ahead in the slot" />
            <Stat label="Slot elapsed"
              value={data?.slotElapsedPct == null ? '—' : `${data.slotElapsedPct.toFixed(1)}%`}
              unit="of the promise" />
          </>
        ) : (
          <>
            <Stat label="Unmeasured" value={dur(t.unmeasuredMin)}
              tone={(t.unmeasuredMin ?? 0) > 0 ? 'warn' : 'none'} />
            <Stat label="Operational" value={dur(t.operationalMin)} unit="the denominator" />
            <Stat label="Used operational" value={dur(t.usedOperationalMin)}
              unit="fully productive" tone="good" />
          </>
        )}
      </div>
      {(t.unmeasuredMin ?? 0) > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {dur(t.unmeasuredMin)} of this window was <strong>not reported</strong> by any machine —
          counted as neither running nor stopped, because guessing either would move OEE by an
          amount nobody could trace.
        </p>
      )}
    </Panel>
  );
}

function Stat({
  label, value, unit, tone = 'none', icon,
}: {
  label: string; value: string; unit?: string;
  tone?: 'good' | 'bad' | 'warn' | 'none'; icon?: React.ReactNode;
}) {
  const colour = tone === 'none' ? undefined : STATUS[tone];
  return (
    <div className="rounded-md border border-border/60 bg-background/40 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-0.5 text-lg font-semibold tabular-nums" style={colour ? { color: colour } : undefined}>
        {value}
      </p>
      {unit && <p className="text-[10px] text-muted-foreground">{unit}</p>}
    </div>
  );
}

// ── Trend ───────────────────────────────────────────────────────────────────

/**
 * One chart, two things — on ONE axis.
 *
 * Counts are bars and OEE is a line, but both are read against a single scale by
 * normalising the counts to their own maximum would be a lie. Instead the counts
 * chart and the factor chart are separate rows of the same grid: two charts, one
 * axis each, which is the only honest way to put a percentage beside a count.
 */
/**
 * The four factors, and the two counts, named once.
 *
 * OEE is drawn heavier than the three numbers it is made of, so the headline
 * reads as the conclusion rather than as a fourth peer.
 */
const FACTOR_SERIES = [
  { key: 'availability', name: 'Availability', colour: 'var(--viz-1)' },
  { key: 'performance', name: 'Performance', colour: 'var(--viz-2)' },
  { key: 'quality', name: 'Quality', colour: 'var(--viz-3)' },
  { key: 'oee', name: 'OEE', colour: 'var(--viz-4)', emphasis: true },
] as const;

const OUTPUT_SERIES = [
  { key: 'good', name: 'Good', colour: STATUS.good },
  { key: 'rejected', name: 'Rejected', colour: STATUS.bad },
] as const;

function TrendPanel() {
  const { range, setRange, data, isFetching } = useRange('shift');
  const points = (data?.trend ?? []).map((p) => ({
    // `at` stays the RAW instant and `t` carries the axis label. They used to
    // be one field holding the formatted clock, which left the CSV export with
    // no timestamp to lead with — "07:00" does not sort, join or plot.
    at: p.at,
    t: clock(p.at),
    oee: p.oee, availability: p.availability, performance: p.performance, quality: p.quality,
    good: p.counts?.good ?? 0,
    rejected: p.counts?.rejected ?? 0,
  }));

  return (
    <Panel
      title="Trend through the shift"
      range={range}
      onRange={setRange}
      window={data?.window}
      loading={isFetching}
      right={
        data ? (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {data.bucketMin} min buckets
          </span>
        ) : null
      }
    >
      {points.length === 0 ? (
        <Empty>No minutes recorded in this window yet.</Empty>
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {/*
            Two charts, one axis each. A percentage and a piece count share no
            scale, and normalising the counts to their own maximum to fit them
            under one axis would draw a shape that is not the data.
          */}
          <TrendChart
            title="OEE and its factors"
            data={points}
            
            height={210}
            series={FACTOR_SERIES}
            exportName="shift-oee"
          />
          <TrendChart
            title="Output per bucket"
            data={points}
            
            height={210}
            domain="auto"
            unit=""
            decimals={0}
            series={OUTPUT_SERIES}
            exportName="shift-output"
            empty="Nothing counted in this window yet."
          />
        </div>
      )}
    </Panel>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

/**
 * The machine-state timeline — the component the analysis page already uses.
 *
 * Zoom that re-renders rather than scaling, pan, a texture channel for the
 * colour-blind and print case, and gaps left as gaps. Building a second one for
 * this page would have meant two timelines to keep correct.
 */
function TimelinePanel() {
  const { range, setRange, data, isFetching } = useRange('shift');

  const rows: GanttRow[] = React.useMemo(() => {
    const byMachine = new Map<string, {
      label: string; segments: GanttRow['segments']; plan: GanttRow['segments'];
    }>();
    const at = (s: { machineId: string; machineLabel?: string; label?: string }) => {
      const hit = byMachine.get(s.machineId) ?? {
        label: (s as any).machineCode ?? s.machineLabel ?? s.label ?? s.machineId.slice(0, 8),
        segments: [] as GanttRow['segments'],
        plan: [] as GanttRow['segments'],
      };
      byMachine.set(s.machineId, hit);
      return hit;
    };
    for (const s of data?.timeline ?? []) {
      at(s).segments.push({ state: s.state, label: (s as any).label, startTime: s.from, endTime: s.to });
    }
    // A machine that only appears in the SCHEDULE still earns a row: time was
    // booked against it and nothing was measured, which is the case a shift
    // review most needs to see rather than the one it can least afford to lose.
    for (const s of data?.plannedTimeline ?? []) {
      at(s).plan.push({ state: s.state, label: (s as any).label, startTime: s.from, endTime: s.to });
    }
    const stats = new Map(data?.machines?.map((m) => [m.key, m]) ?? []);
    return [...byMachine.entries()]
      .map(([id, v]) => {
        const m = stats.get(id);
        return {
          id,
          label: m?.label ?? v.label,
          sublabel: m?.sublabel ?? undefined,
          meta: m
            ? `${m.availability == null ? '—' : `${m.availability.toFixed(0)}%`} · ${dur(m.time?.netProductionMin)}`
            : undefined,
          segments: v.segments,
          planSegments: v.plan.length > 0 ? v.plan : undefined,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data?.timeline, data?.plannedTimeline, data?.machines]);

  return (
    <Panel title="Machine status timeline" range={range} onRange={setRange}
      window={data?.window} loading={isFetching}>
      {rows.length === 0 ? (
        <Empty>No machine states recorded in this window.</Empty>
      ) : (
        <MachineStateGantt
          rows={rows}
          windowStart={data!.window.from}
          windowEnd={data!.window.to}
          // Every window this screen offers ends at the present moment, so the
          // chart's right edge has to keep up with the clock -- otherwise the
          // "now" marker sits exactly on a frozen edge and disappears seconds
          // after the fetch that drew it.
          follow
        />
      )}
    </Panel>
  );
}

// ── Where the time went ─────────────────────────────────────────────────────

/**
 * Where the time went — with booked schedule time given precedence.
 *
 * ── The reading this fixes ─────────────────────────────────────────────────
 * A sensor sees one thing: the machine is not turning. So a line stopped from
 * 07:30 to 08:51 arrives as eighty-one minutes of BREAKDOWN, even where the
 * plant had booked cleaning until 08:00 and startup until 08:30. Ranked against
 * the other losses, that stop is four times its real size and sends a shift
 * review after a fault that lasted twenty-one minutes.
 *
 * Each row now shows what it kept AND what a booked stop took from it, so the
 * subtraction is on the page rather than asserted. The equations behind OEE are
 * untouched — see `scheduleFirst` on the API for why that separation is
 * deliberate and what has to be settled before it closes.
 */
function StatePanel() {
  const { range, setRange, data, isFetching } = useRange('shift');

  const scheduleFirst = data?.statesScheduleFirst ?? [];
  // The raw breakdown is the fallback, not a mode: an older API, or a window
  // with no schedule at all, still has a panel — it simply has nothing to
  // subtract, which is exactly what an empty projection means.
  const rows = scheduleFirst.length > 0
    ? scheduleFirst.map((s) => ({
      key: s.key, label: s.label, minutes: s.minutes,
      reclaimedMin: s.reclaimedMin, scheduled: s.scheduled,
      colour: s.scheduled ? SEGMENT_COLOUR[s.kind] : stateColour(s.label),
    }))
    : (data?.states ?? []).filter((s) => s.minutes > 0).map((s) => ({
      key: s.state ?? 'Not reported', label: s.state ?? 'Not reported',
      minutes: s.minutes, reclaimedMin: 0, scheduled: false,
      colour: stateColour(s.state ?? 'Not reported'),
    }));

  const total = rows.reduce((a, r) => a + r.minutes, 0);
  const reclaimed = rows.reduce((a, r) => a + r.reclaimedMin, 0);

  return (
    <Panel title="Where the time went" range={range} onRange={setRange}
      window={data?.window} loading={isFetching}>
      {rows.length === 0 ? (
        <Empty>No machine states recorded in this window.</Empty>
      ) : (
        <>
          <ul className="space-y-1.5">
            {rows.map((r) => {
              const share = total > 0 ? (r.minutes / total) * 100 : 0;
              return (
                <li key={r.key} className="grid grid-cols-[minmax(90px,150px)_1fr_auto] items-center gap-2">
                  <span className="flex items-center gap-1.5 truncate text-xs" title={r.label}>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: r.colour }} aria-hidden />
                    {r.label}
                  </span>
                  <div className="flex h-4 items-center gap-px overflow-hidden rounded-sm bg-muted/60">
                    <div className="h-full" style={{ width: `${share}%`, background: r.colour }} />
                    {/* What a booked stop took off this row, drawn where it
                        would have been. Hatched and unsaturated so it reads as
                        an account of the missing time rather than as more of
                        the same loss. */}
                    {r.reclaimedMin > 0 && total > 0 && (
                      <div
                        className="h-full opacity-40"
                        title={`${dur(r.reclaimedMin)} of this was booked on the schedule`}
                        style={{
                          width: `${(r.reclaimedMin / total) * 100}%`,
                          backgroundImage:
                            `repeating-linear-gradient(135deg, ${r.colour} 0 2px, transparent 2px 5px)`,
                        }}
                      />
                    )}
                  </div>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                    {dur(r.minutes)} · {share.toFixed(1)}%
                    {r.reclaimedMin > 0 && (
                      <span className="ms-1 text-muted-foreground/60">−{dur(r.reclaimedMin)}</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
          {scheduleFirst.length > 0 && (
            // Say what the panel did. A reader who compares this with the
            // timeline, or with the OEE figures above, has to be able to find
            // out why they differ without asking anyone.
            <p className="mt-3 border-t border-border/40 pt-2 text-[11px] leading-relaxed text-muted-foreground">
              Booked schedule time takes precedence here: a minute the plant had
              booked belongs to that block, not to whatever the sensor reported
              through it.
              {reclaimed > 0 && (
                <> <span className="font-medium text-foreground/80">{dur(reclaimed)}</span> moved
                  out of the machine states this way.</>
              )}
              {' '}This panel reads the machines&rsquo; state records; the OEE figures
              above are unchanged and still come from the minute store, so the two
              totals need not match.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

// ── Rejects ─────────────────────────────────────────────────────────────────

function RejectPanel() {
  const { range, setRange, data, isFetching } = useRange('shift');
  const rr = data?.rejectReasons;

  return (
    <Panel title="Reject reasons" range={range} onRange={setRange}
      window={data?.window} loading={isFetching}>
      {!rr?.configured ? (
        <Empty>
          No reject reasons are being logged. That is a configuration state, not a clean shift —
          the reject count above may still be non-zero.
        </Empty>
      ) : (
        <>
          <ul className="space-y-1.5">
            {rr.reasons.map((r) => (
              <li key={`${r.category}:${r.reason}`}
                className="grid grid-cols-[minmax(110px,180px)_1fr_auto] items-center gap-2">
                <span className="truncate text-xs" title={`${r.category} — ${r.reason}`}>{r.reason}</span>
                <div className="h-4 rounded-sm bg-muted/60">
                  <div className="h-full rounded-sm bg-red-500/80" style={{ width: `${r.sharePct}%` }} />
                </div>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {num(r.pieces)} pc · {r.sharePct.toFixed(1)}%
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {num(rr.totalPieces)} pieces over {rr.occurrence} entries. Every quantity is converted
            to pieces on the product&apos;s packaging ladder before ranking — a scrapped pallet is
            160 pieces, not one.
          </p>
        </>
      )}
    </Panel>
  );
}

// ── Job orders ──────────────────────────────────────────────────────────────

const STATUS_TONE: Record<string, string> = {
  EXECUTING: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  PAUSED: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  COMPLETED: 'bg-slate-500/15 text-slate-700 dark:text-slate-300',
  READY: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
};

function JobOrdersPanel() {
  const { range, setRange, data, isFetching } = useRange('shift');
  const rows = data?.jobOrders ?? [];

  return (
    <Panel title="Job orders in this window" range={range} onRange={setRange}
      window={data?.window} loading={isFetching}>
      {rows.length === 0 ? (
        <Empty>No job order was open in this window.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-xs">
            <thead>
              <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <Th>Step</Th>
                <Th>Operation</Th>
                <Th>Machine</Th>
                <Th>Product</Th>
                <Th>Work order</Th>
                <Th className="text-right">Planned</Th>
                <Th className="text-right">Good</Th>
                <Th className="text-right">Rejected</Th>
                <Th>Unit</Th>
                <Th className="text-right">Good (pc)</Th>
                <Th className="w-28">Progress</Th>
                <Th>Started</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((j) => <JobRow key={j.id} j={j} />)}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Quantities are shown in each step&apos;s OWN output unit, with the piece equivalent
            beside them. The two columns are not alternatives — the raw figure is what the operator
            reads off the machine, and the piece figure is the only one that can be compared or
            added across steps.
          </p>
        </div>
      )}
    </Panel>
  );
}

function JobRow({ j }: { j: LiveJobOrder }) {
  const open = !j.actualEnd;
  return (
    <tr className={cn('border-b border-border/40 last:border-0', open && 'bg-primary/[0.03]')}>
      <Td className="tabular-nums">{j.step}</Td>
      <Td className="font-medium text-foreground">{j.operation}</Td>
      <Td>{j.machineCode ?? j.machine}</Td>
      <Td className="max-w-[200px] truncate" title={j.product}>{j.product}</Td>
      <Td>
        {j.workOrder}
        {j.productionOrder && <span className="block text-[10px] text-muted-foreground">{j.productionOrder}</span>}
      </Td>
      <Td className="text-right tabular-nums">{num(j.plannedQty)}</Td>
      <Td className="text-right tabular-nums font-medium">{num(j.goodQty)}</Td>
      <Td className={cn('text-right tabular-nums', j.rejectedQty > 0 && 'text-red-600 dark:text-red-400')}>
        {num(j.rejectedQty)}
      </Td>
      <Td className="text-muted-foreground">{j.unit}</Td>
      <Td className="text-right tabular-nums text-muted-foreground">{num(j.goodPieces)}</Td>
      <Td>
        {j.progressPct == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 flex-1 rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${j.progressPct}%` }} />
            </div>
            <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
              {j.progressPct.toFixed(0)}%
            </span>
          </div>
        )}
      </Td>
      <Td className="tabular-nums text-muted-foreground">{clock(j.actualStart)}</Td>
      <Td>
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium',
          STATUS_TONE[j.status] ?? 'bg-muted text-muted-foreground')}>
          {j.status}
        </span>
      </Td>
    </tr>
  );
}

// ── Machines ────────────────────────────────────────────────────────────────

function MachinesPanel() {
  const { range, setRange, data, isFetching } = useRange('shift');
  const stats = new Map((data?.machines ?? []).map((m) => [m.key, m]));

  return (
    <Panel
      title="Machines"
      range={range}
      onRange={setRange}
      window={data?.window}
      loading={isFetching}
      right={<span className="text-[11px] text-muted-foreground">State column is live, not windowed</span>}
    >
      {(data?.machineNow ?? []).length === 0 ? (
        <Empty>No machines in scope.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="border-b border-border/60 text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                <Th>Machine</Th>
                <Th>Line</Th>
                <Th>State now</Th>
                <Th>Since</Th>
                <Th className="text-right">Avail.</Th>
                <Th className="text-right">Perf.</Th>
                <Th className="text-right">Qual.</Th>
                <Th className="text-right">OEE</Th>
                <Th className="text-right">Running</Th>
                <Th className="text-right">Good</Th>
                <Th className="text-right">Rejected</Th>
              </tr>
            </thead>
            <tbody>
              {(data?.machineNow ?? []).map((m) => {
                const s = stats.get(m.machineId);
                const state = m.state ?? 'Not reported';
                return (
                  <tr key={m.machineId} className="border-b border-border/40 last:border-0">
                    <Td className="font-medium text-foreground">{m.code}
                      <span className="block text-[10px] font-normal text-muted-foreground">{m.name}</span>
                    </Td>
                    <Td className="text-muted-foreground">{m.line ?? '—'}</Td>
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full" style={{ background: stateColour(state) }} aria-hidden />
                        {state}
                      </span>
                    </Td>
                    <Td className="tabular-nums text-muted-foreground">{clock(m.since)}</Td>
                    <Td className="text-right tabular-nums">{pctText(s?.availability)}</Td>
                    <Td className="text-right tabular-nums">{pctText(s?.performance)}</Td>
                    <Td className="text-right tabular-nums">{pctText(s?.quality)}</Td>
                    <Td className="text-right tabular-nums font-medium">{pctText(s?.oee)}</Td>
                    <Td className="text-right tabular-nums text-muted-foreground">{dur(s?.time?.netProductionMin)}</Td>
                    <Td className="text-right tabular-nums">{num(s?.counts?.good)}</Td>
                    <Td className={cn('text-right tabular-nums',
                      (s?.counts?.rejected ?? 0) > 0 && 'text-red-600 dark:text-red-400')}>
                      {num(s?.counts?.rejected)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            <strong>State now</strong> is what the machine is reporting this second, from its
            current-status record. Every other column is the window above. They can disagree — a
            machine that just started running still carries the downtime it had five minutes ago.
          </p>
        </div>
      )}
    </Panel>
  );
}

// ── Small shared bits ───────────────────────────────────────────────────────

const Th = ({ children, className, title }: {
  children: React.ReactNode; className?: string; title?: string;
}) => (
  <th scope="col" title={title} className={cn('px-2 py-1.5 font-medium', className)}>{children}</th>
);

const Td = ({ children, className, title }: {
  children: React.ReactNode; className?: string; title?: string;
}) => (
  <td title={title} className={cn('px-2 py-1.5', className)}>{children}</td>
);

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p className="py-6 text-center text-xs text-muted-foreground">{children}</p>
);
