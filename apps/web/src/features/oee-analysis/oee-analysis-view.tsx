'use client';
/**
 * OEE Analysis Overview — two engines, one screen, one control.
 *
 * The engines were on separate pages with their own date pickers, which made
 * comparing them a matter of setting two filters the same way and trusting that
 * you had. They now share the global scope and period, so the only thing that
 * can differ between the two readings is the thing that is supposed to:
 *
 *   OEE     → the SCHEDULE basis   — divides by the slot the order was promised
 *   OEE-TB  → the STANDARD basis   — divides by the time that actually went by
 *
 * The toggle is the one already in the filter panel, so the choice made here is
 * the same choice every other screen honours. Switching it swaps the whole page,
 * not a card: a page that mixed the two bases would put two numbers side by side
 * that were never comparable.
 *
 * ── What the two are for ────────────────────────────────────────────────────
 * The standard basis asks how well the equipment ran while it was running. The
 * schedule basis asks how much of a promise was kept, so it charges a late start
 * and it charges the part of the slot the order has not reached yet. They are
 * not meant to agree, and the gap between them IS the schedule adherence.
 */
import React from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { useOeeMode } from '@/hooks/use-oee-mode';
import { PageTabs } from '@/components/layout/page-tabs';
import { MachineStatusView } from '@/features/manufacturing/machine-status-view';
import { ScheduleCapacityView } from '@/features/production/schedule-capacity-view';
import { HierarchyOEE } from '@/features/production/hierarchy-oee';
import { useOrderFilterStore } from '@/store/order-filter-store';
import { useLineBasis } from '@/hooks/use-line-basis';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';
import {
  OverviewPanel,
  type TrendPoint, type TimelineSegment, type ProductionDetails,
} from './overview-panel';
import { AvailabilityPanel, type Distribution } from './availability-panel';
import { PerformancePanel } from './performance-panel';
import { QualityPanel, type RejectReasons } from './quality-panel';
import { LossPanel } from './loss-panel';
import { TimeModel } from './chart-kit';
import { DowntimePanel } from './downtime-panel';
import { LineOeeCard, type LineOee } from './line-oee-card';

interface Bar { key: string; minutes: number; pct: number; kind: 'base' | 'loss' | 'result' }
interface Slice {
  key: string; label: string; sublabel?: string | null;
  availability: number | null; performance: number | null; quality: number | null;
  oee: number | null; teep: number | null; utilization: number | null;
  /** Schedule basis only. */
  slotElapsedPct?: number | null;
  time: Record<string, number>;
  counts: { good: number; rejected: number; total: number; theoretical: number };
  bars: Bar[];
}
interface Payload extends Slice {
  /**
   * The bucket the SERVER actually grouped by — not the one the reader asked
   * for, which may have been "auto" or a size the window cannot support.
   *
   * The server is the only authority on this: it resolves "auto" from the
   * window's own width, and it is the one that ran the `date_trunc`. The page
   * used to label the trend from its own local guess instead, which is how a
   * chart of two DAY buckets ended up with "23 Aug 06:00" on the axis — a
   * clock time under a point covering twenty-four hours.
   */
  granularity: 'hour' | 'day' | 'week' | 'month';
  window: { from: string; to: string };
  audit: {
    ok: boolean; bucketsMin: number; bucketDriftMin: number; identityDriftMin: number;
    /**
     * Parts booked in minutes the engine credited no runtime for — the line
     * running through its own scheduled stop, almost always.
     *
     * Its own field rather than folded into `ok`, because it needs a different
     * action: `ok` failing means the writer lost time, this means the schedule
     * disagrees with what the line actually did.
     */
    outputWithoutRuntimeParts?: number;
    /** What those parts add to Performance, in points. */
    outputWithoutRuntimePct?: number;
  };
  machines: Slice[];
  jobOrders: Slice[];
  shifts: Slice[];
  states: Array<{ state: string | null; minutes: number; rows: number }>;
  trend: Array<TrendPoint & {
    teep: number | null;
    time: Record<string, number>;
    counts: { good: number; rejected: number; total: number; theoretical: number };
  }>;
  timeline: TimelineSegment[];
  /**
   * The SCHEDULE over the same window -- what the plant booked, as opposed to
   * what the machines reported. Drawn as a second band above each machine's
   * own row rather than merged into it: where the two disagree, that
   * disagreement is the finding.
   */
  plannedTimeline?: TimelineSegment[];
  production: ProductionDetails & { mttrMin: number | null; mtbfMin: number | null };
  distribution: Distribution;
  rejectReasons: RejectReasons;
  /** What the LINE / area / factory scored, as opposed to what its machines did. */
  lineOee: LineOee | null;
}

/**
 * The analyses this page will hold, in the reference's own order.
 *
 * Listed in full from the start, with the ones not yet built visibly disabled.
 * A menu that grows an item at a time tells a reader nothing about what is
 * coming; one that shows the whole shape says exactly how far along it is.
 */
const ANALYSES = [
  { key: 'overview', label: 'Overview', blurb: 'Comprehensive overview of the machine KPIs and status.', ready: true },
  { key: 'availability', label: 'Availability', blurb: 'Detailed overview of availability and its most relevant KPIs.', ready: true },
  { key: 'performance', label: 'Performance', blurb: 'Detailed overview of performance and its most relevant KPIs.', ready: true },
  { key: 'quality', label: 'Quality', blurb: 'Detailed overview of quality and its most relevant KPIs.', ready: true },
  { key: 'loss', label: 'Loss overview', blurb: 'Investigate TEEP and the different losses.', ready: true },
  { key: 'downtime', label: 'Downtime analysis', blurb: 'Detailed analysis of downtime reasons.', ready: true },
  // ── Absorbed pages ──────────────────────────────────────────────────────
  // Each of these was a route of its own, reading an older endpoint. They ask
  // period questions about the same scope and window as the tabs above, so a
  // reader had to leave the page, re-pick the filter, and hope the two agreed.
  { key: 'equipment', label: 'Equipment', blurb: 'Machine states over the period, and who lost the time.', ready: true },
  { key: 'schedule', label: 'Schedule & capacity', blurb: 'Attainment against the plan, and how much of the rated capacity was used.', ready: true },
  { key: 'tree', label: 'Factory tree', blurb: 'The same window rolled up the asset hierarchy, area by line by machine.', ready: true },
] as const;

/**
 * Both engines' bar keys in one map. The schedule basis adds two levels the
 * standard one has no room for; the standard one calls the top bar something
 * else. Everything between them is the same model with the same names.
 */
const BAR_LABEL: Record<string, string> = {
  totalTime: 'Total time',
  committedTime: 'Committed time (the promised slot)',
  plannedStops: 'Planned stops',
  externalLoss: 'External loss (starved / blocked)',
  unmeasured: 'Unmeasured',
  operationalTime: 'Operational time',
  notStarted: 'Not started (slot open, machine idle)',
  notYetReached: 'Not yet reached',
  availabilityLosses: 'Availability losses',
  netProductionTime: 'Net production time',
  performanceLosses: 'Performance losses',
  microstopLosses: 'Microstop losses',
  netOperationalTime: 'Net operational time',
  qualityLosses: 'Quality losses',
  usedOperationalTime: 'Used operational time',
};

const pct = (n: number | null | undefined) => (n == null ? '—' : `${n.toFixed(1)}%`);
const mins = (n: number | undefined) =>
  n == null ? '—' : n >= 60 ? `${Math.floor(n / 60)}h ${Math.round(n % 60)}m` : `${n.toFixed(1)}m`;

export function OeeAnalysisView() {
  const { t } = useTranslation('common');
  const { filter, key: scopeKey } = useScope();
  const { params: timeParams, key: timeKey, preset, dateFrom: rangeFrom, dateTo: rangeTo } = useTimeRange();
  const { atOee } = useOeeMode();
  const { poNumber, woId, skuId, shiftTemplateId } = useOrderFilterStore();
  const { param: lineBasisParam, key: lineBasisKey } = useLineBasis();
  // The period control in the filter panel only renders on the analytics half.
  // This page is entirely analytical, so it says so — otherwise arriving here
  // from a live screen leaves the period picker hidden and the window stuck.
  useDeclareViewMode('analytics');

  // atOee is the platform-wide basis toggle. Here it picks the ENGINE, because
  // on this page the basis IS the engine — the two are not separate choices.
  const engine = atOee ? 'standard' : 'schedule';
  const path = atOee ? '/oee-standard' : '/oee-schedule';

  // The order / product / shift filter from the panel. It has to be part of the
  // query key as well as the params: without it, narrowing to one product would
  // re-serve the cached whole-factory answer and the page would look filtered
  // while showing everything.
  const dimKey = `${poNumber}|${woId}|${skuId}|${shiftTemplateId}`;
  const dimensions = {
    ...(woId ? { workOrderId: woId } : {}),
    ...(skuId ? { skuId } : {}),
    ...(shiftTemplateId ? { shiftTemplateId } : {}),
    ...(poNumber ? { productionOrderNumber: poNumber } : {}),
  };

  /**
   * Bucket size for the trend, chosen by the reader.
   *
   * `undefined` means "let the timeframe decide", which is what the page did
   * before and remains the right default — a shift wants hours, a quarter wants
   * weeks. Naming one overrides that, and the choice is part of the query key
   * because two bucket sizes are two different answers, not two views of one.
   */
  /**
   * Which bucket sizes make sense for the SELECTED PERIOD.
   *
   * Offering "Month" while looking at "Today" is what produced the complaint
   * this exists to fix: one bar for a day that has not finished, bucketed by a
   * unit thirty times wider than the window itself. The period the reader
   * already chose in the main filter implies the resolutions worth offering —
   * this narrows the list to those, rather than trusting the reader to avoid a
   * combination the data cannot make sense of.
   */
  const allowedBuckets = React.useMemo(() => {
    const ALL = [
      { value: 'auto', label: 'Auto' },
      { value: 'hour', label: 'Hour' },
      { value: 'day', label: 'Day' },
      { value: 'week', label: 'Week' },
      { value: 'month', label: 'Month' },
    ] as const;
    const spanDays = (() => {
      const a = new Date(rangeFrom).getTime();
      const b = new Date(rangeTo).getTime();
      return Number.isFinite(a) && Number.isFinite(b) ? Math.max(1, Math.round((b - a) / 86_400_000) + 1) : 1;
    })();
    const allow: Set<string> =
      preset === 'today' || preset === 'shift' ? new Set(['auto', 'hour'])
      : preset === 'week' ? new Set(['auto', 'hour', 'day'])
      : preset === 'month' ? new Set(['auto', 'day', 'week'])
      // Custom range: size the offer to how wide it actually is, the same
      // reasoning applied to the named presets above.
      : spanDays <= 2 ? new Set(['auto', 'hour'])
      : spanDays <= 14 ? new Set(['auto', 'hour', 'day'])
      : spanDays <= 62 ? new Set(['auto', 'day', 'week'])
      : new Set(['auto', 'week', 'month']);
    return ALL.filter((b) => allow.has(b.value));
  }, [preset, rangeFrom, rangeTo]);

  const [bucket, setBucket] = React.useState<string | undefined>(undefined);
  // A manual bucket choice belongs to the period it was made for. Switching
  // "Today" for "Month" and keeping a hand-picked "Month" bucket size on top
  // of it means one bar for the whole window — a choice made for a different
  // question, silently carried into this one. The filter panel's own Period
  // control already implies a sensible bucket (see the server's default in
  // production.service.ts); overriding it is a per-view decision that should
  // not survive the reader moving to a different view.
  React.useEffect(() => setBucket(undefined), [timeKey]);

  const q = useQuery({
    queryKey: ['oee-analysis', engine, scopeKey, timeKey, dimKey, lineBasisKey, bucket ?? 'auto'],
    queryFn: () => api.get<Payload>(path, {
      // `timeParams` and not just the dates: Today and Shift produce the SAME
      // dateFrom/dateTo — a shift is resolved server-side, from `timeframe`,
      // because only the API holds the shift templates. Sending the dates alone
      // made the two presets one button: identical numbers, identical charts,
      // and the night shift's first hours missing from the view showing it.
      params: { ...timeParams, ...filter, ...dimensions, ...lineBasisParam, ...(bucket ? { bucket } : {}) },
    }),
    refetchInterval: 30_000,
    /*
     * Keep the figures on screen while the next window is fetched.
     *
     * Without this, every scope, period, order or bucket change blanks
     * `q.data` for the duration of the request. The whole page is behind
     * `{d && …}`, so it unmounts — gauges, charts, tables, the Gantt — and
     * remounts a moment later. That reads as a full page reload for what is
     * only a change of window, it throws away the chart instances rather than
     * updating their data, and it makes every filter feel expensive.
     *
     * The previous answer stays up, marked stale by `isFetching`, and is
     * replaced in place when the new one lands. Same pattern the live screens
     * already use — see use-live-shift's `placeholderData`.
     */
    placeholderData: keepPreviousData,
  });

  const [analysis, setAnalysis] = React.useState<(typeof ANALYSES)[number]['key']>('overview');

  const d = q.data;
  const isSchedule = engine === 'schedule';
  const topMin = isSchedule ? d?.time.committedMin : d?.time.totalMin;

  return (
    <div className="flex flex-col gap-5 p-4 md:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">OEE Analysis Overview</h1>
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
            isSchedule ? 'bg-sky-500/15 text-sky-500' : 'bg-violet-500/15 text-violet-400'
          }`}>
            {isSchedule ? 'Schedule basis' : 'Standard basis'}
          </span>
        </div>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {isSchedule ? (
            <>
              Dividing the measured minutes by the slot each order was <b>committed</b> to. A late
              start is charged, and so is the part of the slot the order has not reached yet — so a
              reading taken mid-slot climbs all day. This answers <i>of the time we promised, how
              much have we delivered</i>.
            </>
          ) : (
            <>
              Dividing the measured minutes by the time that actually <b>went by</b>. This
              answers{' '}
              <i>of the time it ran, how well did it run</i>.
            </>
          )}{' '}
          Switch with the <b>{atOee ? t('atOee.tb') : t('atOee.schedule')}</b> button in the filter
          panel. The two are not meant to agree; the gap between them is the schedule adherence.
        </p>
      </header>

      {/* ── Which analysis ── */}
      <PageTabs
        label="Which analysis"
        value={analysis}
        onChange={(k) => setAnalysis(k as (typeof ANALYSES)[number]['key'])}
        tabs={ANALYSES.map((a) => ({
          key: a.key, label: a.label, blurb: a.blurb, disabled: !a.ready,
        }))}
      />

      {/*
        `isLoading` is now the FIRST load only — afterwards the previous window
        stays on screen while the next one is fetched. `isFetching` is what
        says the figures below are a moment out of date, and it has to be
        shown: numbers that quietly belong to the previous filter, with nothing
        saying so, are worse than a spinner.
      */}
      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!q.isLoading && q.isFetching && (
        <p className="text-xs text-muted-foreground">
          Updating — the figures below are the previous window until this one arrives.
        </p>
      )}
      {q.isError && <p className="text-sm text-destructive">Could not load this window.</p>}

      {d && (
        <>
          <div className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm ${
            d.audit.ok ? 'border-emerald-600/30 bg-emerald-500/5' : 'border-amber-600/40 bg-amber-500/10'
          }`}>
            {d.audit.ok
              ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
              : <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />}
            <span className="font-medium">
              {d.audit.ok ? 'Every minute is accounted for' : 'Minutes do not reconcile'}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              buckets {d.audit.bucketsMin}m · bucket drift {d.audit.bucketDriftMin}m · identity drift {d.audit.identityDriftMin}m
            </span>
          </div>

          {/*
            Output the line booked while the schedule said it was stopped.

            Counters are read off the job order and are independent of how the
            minute was classified, so parts made during a scheduled stop are
            counted while the theoretical denominator for those minutes is
            zero. They raise Performance without raising what it divides by.

            A separate banner from the minute audit above, because it asks for a
            different fix: the minutes reconcile perfectly and the reading is
            still slightly generous. Silence here is what let Performance drift
            upward with nothing to point at.
          */}
          {(d.audit.outputWithoutRuntimeParts ?? 0) > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-sky-600/30 bg-sky-500/5 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 shrink-0 text-sky-600" />
              <span className="font-medium">
                The line produced while the schedule had it stopped
              </span>
              <span className="text-xs text-muted-foreground">
                <b className="font-mono">{Math.round(d.audit.outputWithoutRuntimeParts!).toLocaleString('en-US')}</b>
                {' '}pieces were counted in minutes with no measured runtime, so they add{' '}
                <b className="font-mono">+{(d.audit.outputWithoutRuntimePct ?? 0).toFixed(2)}</b> points
                to Performance without adding to what it divides by. Either the schedule does not
                match what the line ran, or a stop needs logging against it.
              </span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <Kpi label="OEE" value={pct(d.oee)} big
              hint={isSchedule && d.slotElapsedPct != null ? `slot ${pct(d.slotElapsedPct)} elapsed` : undefined} />
            <Kpi label="Availability" value={pct(d.availability)}
              hint={`${mins(d.time.netProductionMin)} ÷ ${mins(d.time.operationalMin)}`} />
            <Kpi label="Performance" value={pct(d.performance)}
              hint={`${Math.round(d.counts.total)} ÷ ${Math.round(d.counts.theoretical)} parts`} />
            <Kpi label="Quality" value={pct(d.quality)}
              hint={`${Math.round(d.counts.good)} good of ${Math.round(d.counts.total)}`} />
            {isSchedule
              ? <Kpi label="Slot elapsed" value={pct(d.slotElapsedPct)} hint={`${mins(d.time.notYetReachedMin)} not reached`} />
              : <Kpi label="Utilization" value={pct(d.utilization)} hint="PPT ÷ Total time" />}
            <Kpi label="TEEP" value={pct(d.teep)} hint="OEE × Utilization" />
          </div>

          {/*
            A low schedule figure means two different things depending on where in
            the slot it was read, so the page says which one is on screen rather
            than leaving it to be taken as a verdict it may not be.
          */}
          {isSchedule && d.slotElapsedPct != null && d.slotElapsedPct < 99 && (
            <p className="rounded-lg border border-amber-600/30 bg-amber-500/5 p-3 text-sm">
              <b>{pct(d.slotElapsedPct)}</b> of the committed slot has gone by, so{' '}
              <b>{mins(d.time.notYetReachedMin)}</b> of it is time the orders have not reached yet
              and is counted against them. Mid-slot this is a progress figure, not a verdict.
            </p>
          )}

          {/*
            The absorbed pages, rendered whole. Each still fetches its own
            endpoint — attainment and capacity are stored KPIs with no engine
            route, and the factory tree is a hierarchy roll-up — but all three
            now project from the same two engines this page reads, so the tab
            and the page around it can no longer disagree.
          */}
          {analysis === 'equipment' && <MachineStatusView />}
          {analysis === 'schedule' && <ScheduleCapacityView />}
          {analysis === 'tree' && <HierarchyOEE />}

          {analysis === 'loss' && (
            <LossPanel
              teep={d.teep} oee={d.oee} utilization={d.utilization}
              trend={d.trend ?? []}
              bars={d.bars} labels={BAR_LABEL}
              machineCount={d.machines.length}
              topMin={topMin ?? 0}
            />
          )}

          {analysis === 'downtime' && (
            <DowntimePanel
              distribution={d.distribution}
              timeline={d.timeline ?? []}
              plannedTimeline={d.plannedTimeline ?? []}
              machines={d.machines}
              windowStart={d.window.from}
              windowEnd={d.window.to}
            />
          )}

          {analysis === 'quality' && (
            <QualityPanel
              quality={d.quality}
              trend={d.trend ?? []}
              counts={d.counts}
              rejectReasons={d.rejectReasons}
            />
          )}

          {analysis === 'performance' && (
            <PerformancePanel
              performance={d.performance}
              trend={d.trend ?? []}
              counts={d.counts}
              netProductionMin={d.time.netProductionMin}
            />
          )}

          {analysis === 'availability' && (
            <AvailabilityPanel
              availability={d.availability}
              trend={d.trend ?? []}
              netProductionMin={d.time.netProductionMin}
              availabilityLossMin={d.time.availabilityLossMin}
              production={d.production}
              distribution={d.distribution}
            />
          )}

          {/* The line's own score, above the machine-level analyses.
              Deliberately additional rather than a replacement: the panels below
              stay machine-level, and the gap between the two is the thing worth
              reading. */}
          <LineOeeCard data={d.lineOee} />

          {analysis === 'overview' && (
            <OverviewPanel
              bucket={bucket} onBucketChange={setBucket} allowedBuckets={allowedBuckets}
              // What the server actually grouped by. The axis labels follow
              // THIS, never the requested value — "auto" is not a bucket, and
              // a request the window could not honour is not one either.
              effectiveBucket={d.granularity}
              oee={d.oee} availability={d.availability}
              performance={d.performance} quality={d.quality}
              trend={d.trend ?? []}
              production={d.production}
              timeline={d.timeline ?? []}
              plannedTimeline={d.plannedTimeline ?? []}
              operationalMin={d.time.operationalMin}
              usedOperationalMin={d.time.usedOperationalMin}
              machines={d.machines}
              windowStart={d.window.from}
              windowEnd={d.window.to}
            />
          )}

          {/* The waterfall is the Loss page's argument; on the other analyses it
              would be a fifth chart nobody came for. */}
          {analysis === 'overview' && (
          <section className="rounded-lg border border-border/60 bg-card p-4">
            <h2 className="mb-1 text-sm font-semibold">
              Time model{d.machines.length > 1 ? ' — machine-minutes' : ''}
            </h2>
            <p className="mb-2 text-xs text-muted-foreground">
              Every bar is a share of the top level. Each grey level is the one above it minus the
              amber losses between them.
            </p>
            <p className="mb-4 text-xs text-muted-foreground">
              {d.machines.length > 1 ? (
                <>
                  Summed over <b>{d.machines.length} machines</b>, so the top bar is
                  machine-minutes: each machine contributes its own clock. That is{' '}
                  <span className="font-mono tabular-nums">{mins((topMin ?? 0) / d.machines.length)}</span>{' '}
                  per machine, not {mins(topMin)} of wall clock. Narrow the scope to one machine to
                  read it against the clock.
                </>
              ) : (
                <>One machine in scope, so the top bar is wall clock.</>
              )}
            </p>
            <TimeModel bars={d.bars} labels={BAR_LABEL} />
          </section>
          )}

          {d.states.length > 0 && (
            <section className="rounded-lg border border-border/60 bg-card p-4">
              <h2 className="mb-1 text-sm font-semibold">Minutes by machine state</h2>
              <p className="mb-3 text-xs text-muted-foreground">
                The model says how much was lost. This says under which state — without it,
                &ldquo;availability loss 3h&rdquo; is not something anybody can act on.
              </p>
              <div className="flex flex-wrap gap-2">
                {d.states.map((s) => (
                  <span key={s.state ?? 'none'}
                    className="rounded border border-border/60 bg-muted/40 px-2 py-1 font-mono text-xs">
                    {s.state ?? 'no state reported'} · {mins(s.minutes)}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* The three breakdown tables moved to their own page. They used to
              sit here under whichever analysis was selected, so they were both
              always present and never the subject — and had no room for the
              charts that explain them. Same request, same numbers. */}
          <a
            href="/oee-breakdown"
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-card px-4 py-3 text-sm transition-colors hover:border-primary/40 hover:bg-muted/30"
          >
            <span>
              <span className="font-medium text-foreground">Breakdown by machine, job order and shift</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {d.machines.length} machines · {d.jobOrders.length} job orders · {d.shifts.length} shifts
                {' '}in this window, each with its own charts and a sortable table.
              </span>
            </span>
            <span aria-hidden className="text-muted-foreground">→</span>
          </a>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, hint, big }: { label: string; value: string; hint?: string; big?: boolean }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border/60 bg-card p-3">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`font-semibold tabular-nums ${big ? 'text-3xl' : 'text-2xl'}`}>{value}</span>
      {hint && <span className="font-mono text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

