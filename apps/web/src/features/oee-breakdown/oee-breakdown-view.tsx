'use client';
/**
 * OEE Breakdown — the same window, cut three ways.
 *
 * ── Why this is its own page ────────────────────────────────────────────────
 * These three tables used to sit at the bottom of every analysis on the OEE
 * Analysis page, under whichever chart happened to be selected. So they were
 * both always there and never the subject: a reader who wanted to compare
 * machines had to scroll past an analysis they had not asked for, and the
 * tables had no room for the charts that would have explained them.
 *
 * Given a page of their own they get what they were missing — each grouping
 * gets its own tab, its own charts, and a table that can be sorted and paged
 * rather than dumped in full.
 *
 * ── It is the same request the analysis page makes ──────────────────────────
 * Same engine, same scope, same window, same line basis. The numbers here and
 * the numbers there are the same numbers, because they are one query — not two
 * that agree today.
 */
import React from 'react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { AlertTriangle, Cpu, ClipboardList, Clock , Gauge} from 'lucide-react';

import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useTimeRange } from '@/hooks/use-time-range';
import { useOeeMode } from '@/hooks/use-oee-mode';
import ProductionKpiView from '@/features/production/production-kpi-view';
import { useLineBasis } from '@/hooks/use-line-basis';
import { useOrderFilterStore } from '@/store/order-filter-store';
import { useDeclareViewMode } from '@/components/layout/live-analytics-tabs';
import { PageTabs } from '@/components/layout/page-tabs';
import { cn } from '@/lib/utils';
import { LineOeeCard, type LineOee } from '@/features/oee-analysis/line-oee-card';

import { RankedOee, TimeComposition, OutputBars, type Slice } from './breakdown-charts';
import { BreakdownTable } from './breakdown-table';

interface Payload {
  machines: Slice[];
  jobOrders: Slice[];
  shifts: Slice[];
  window: { from: string; to: string };
  lineOee: LineOee | null;
}

/**
 * The three cuts, and what each is actually for.
 *
 * Named by the question rather than by the column they group on, because
 * "By machine" tells a reader what the rows are and not why they would look.
 */
const TABS = [
  {
    key: 'machines', label: 'Machines', icon: Cpu,
    blurb: 'Which asset is holding the line back. Rows are machines, so a slow one and a '
      + 'stopped one look different here even when their OEE matches.',
  },
  {
    key: 'jobOrders', label: 'Job orders', icon: ClipboardList,
    blurb: 'How each order actually ran. One work order appears once per routing step, so the '
      + 'same physical units are counted at each station they passed.',
  },
  {
    key: 'shifts', label: 'Shifts', icon: Clock,
    blurb: 'Whether the difference is the crew or the clock. Shifts are derived from the '
      + 'timestamp, so every minute is attributed whether or not anyone started a shift.',
  },
  {
    // Absorbed from its own route. The sheet asks the same window the same
    // questions the tabs beside it do, through endpoints that now project
    // from the same two engines — so it is a cut of this page, not a rival.
    key: 'kpis', label: 'KPI sheets', icon: Gauge,
    blurb: 'Work orders, attainment, capacity and first-pass yield beside the OEE '
      + 'they came from.',
  },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export function OeeBreakdownView() {
  const { filter, key: scopeKey, scope } = useScope();
  const { params: timeParams, key: timeKey, label: rangeLabel } = useTimeRange();
  const { atOee } = useOeeMode();
  const { poNumber, woId, skuId, shiftTemplateId } = useOrderFilterStore();
  const { param: lineBasisParam, key: lineBasisKey } = useLineBasis();
  useDeclareViewMode('analytics');

  const engine = atOee ? 'standard' : 'schedule';
  const isSchedule = engine === 'schedule';
  const path = atOee ? '/oee-standard' : '/oee-schedule';

  const dimKey = `${poNumber}|${woId}|${skuId}|${shiftTemplateId}`;
  const dimensions = {
    ...(woId ? { workOrderId: woId } : {}),
    ...(skuId ? { skuId } : {}),
    ...(shiftTemplateId ? { shiftTemplateId } : {}),
    ...(poNumber ? { productionOrderNumber: poNumber } : {}),
  };

  const q = useQuery({
    queryKey: ['oee-breakdown', engine, scopeKey, timeKey, dimKey, lineBasisKey],
    queryFn: () => api.get<Payload>(path, {
      // `timeParams` and not just the dates: Today and Shift produce the SAME
      // dateFrom/dateTo — a shift is resolved server-side, from `timeframe`,
      // because only the API holds the shift templates. Sending the dates alone
      // made the two presets one button: identical numbers, identical charts,
      // and the night shift's first hours missing from the view showing it.
      params: { ...timeParams, ...filter, ...dimensions, ...lineBasisParam },
    }),
    refetchInterval: 60_000,
    // Keep the previous window on screen while the next is fetched, so a
    // filter change updates the figures instead of unmounting the view.
    placeholderData: keepPreviousData,
  });

  const d = q.data as Payload | undefined;
  const [tab, setTab] = React.useState<TabKey>('machines');
  // The absorbed sheet has no slice rows of its own; it renders a whole view.
  const rowsFor = (k: TabKey): Slice[] => (k === 'kpis' ? [] : ((d as never)?.[k] ?? [])) as Slice[];

  return (
    <div className="flex flex-col gap-3 p-3 md:p-4">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold text-foreground">OEE Breakdown</h1>
          <span className={cn('rounded px-2 py-0.5 text-[11px] font-semibold',
            isSchedule ? 'bg-sky-500/15 text-sky-500' : 'bg-violet-500/15 text-violet-400')}>
            {isSchedule ? 'Schedule basis' : 'Standard basis'}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {rangeLabel} · {scope && scope.type !== 'FACTORY' ? scope.name : 'Whole factory'}
          </span>
        </div>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">
          One window, cut three ways. Same engine, scope, period and line basis as OEE Analysis —
          this is the same request, so the figures cannot disagree with that page. Every table
          sorts on any column and pages ten at a time; the charts above each one show the lowest
          twelve and say how many they left out.
        </p>
      </header>

      {q.isError && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 px-4 py-3 text-sm text-red-700 dark:text-red-400">
          The breakdown could not be read. Nothing below has been updated.
        </div>
      )}

      {/* What the scope itself scored, so the rows below have something to be
          compared against. On the bottleneck basis this is deliberately NOT the
          sum of the machine rows. */}
      <LineOeeCard data={d?.lineOee} />

      <PageTabs
        label="Which breakdown"
        value={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={TABS.map((t) => ({
          key: t.key, label: t.label, icon: t.icon, blurb: t.blurb,
          // The absorbed sheet has no slice rows to count.
          count: t.key === 'kpis' ? undefined : rowsFor(t.key).length,
        }))}
      />


      {TABS.filter((t) => t.key === tab).map((t) => {
        const rows = rowsFor(t.key);
        return (
          <div key={t.key} role="tabpanel" className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed text-muted-foreground">{t.blurb}</p>

              {t.key === 'kpis' ? <ProductionKpiView /> : q.isLoading ? (
                <p className="rounded-lg border border-border/60 bg-card px-4 py-8 text-center text-xs text-muted-foreground">
                  Reading the window…
                </p>
              ) : rows.length === 0 ? (
                <p className="rounded-lg border border-border/60 bg-card px-4 py-8 text-center text-xs text-muted-foreground">
                  Nothing in this window matches the current scope and filters.
                </p>
              ) : (
                <>
                  <div className="grid gap-3 xl:grid-cols-2">
                    <RankedOee rows={rows} />
                    <TimeComposition rows={rows} />
                  </div>
                  <OutputBars rows={rows} />
                  <BreakdownTable
                    rows={rows}
                    isSchedule={isSchedule}
                    nameHeader={t.label === 'Machines' ? 'Machine' : t.label === 'Shifts' ? 'Shift' : 'Job order'}
                  />
                </>
              )}
          </div>
        );
      })}

      <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
        <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden />
        <span>
          The rows do not sum to the headline, and are not meant to. Time is additive across
          machines, so four machines running an hour each are four machine-hours — not one hour of
          line time. Counts are not additive either: good and theoretical come from each work
          order&apos;s final routing step, so one pallet leaving the wrapper is one pallet, not four
          units counted once per station.
        </span>
      </p>
    </div>
  );
}
