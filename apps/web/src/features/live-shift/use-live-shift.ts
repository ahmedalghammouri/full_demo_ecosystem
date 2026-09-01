'use client';
/**
 * The live shift feed.
 *
 * ── Why one query per RANGE rather than one per widget ──────────────────────
 * Widgets choose their own range, and several usually sit on the same one. React
 * Query keys on `[live-shift, range, scope]`, so three widgets on "whole shift"
 * share a single request and a single set of numbers — they cannot drift apart,
 * because there is only one answer between them. Moving one widget to "last
 * hour" opens a second query; moving it back re-joins the first.
 *
 * ── Why the client never slices ─────────────────────────────────────────────
 * It would be cheaper to fetch the whole shift once and cut the tail in the
 * browser. It would also mean each widget re-deriving its own totals from raw
 * minutes, which is precisely how this system's counts drifted before. The
 * server owns the arithmetic; the client asks for a window and draws what comes
 * back.
 */
import { useQuery } from '@tanstack/react-query';

import { api } from '@/services/api.client';
import { useScope } from '@/hooks/use-scope';
import { useOrderFilterStore } from '@/store/order-filter-store';
import { useOeeMode } from '@/hooks/use-oee-mode';
import { useLineBasis } from '@/hooks/use-line-basis';
import type { LineOee } from '@/features/oee-analysis/line-oee-card';
import type { RangeKey, WindowInfo } from './range-control';

export interface ShiftHeader {
  templateId: string | null;
  code: string;
  name: string;
  start: string;
  end: string;
  now: string;
  elapsedMin: number;
  remainingMin: number;
  plannedMin: number;
  progressPct: number;
  resolved: boolean;
}

export interface LiveJobOrder {
  id: string;
  operation: string;
  step: number;
  status: string;
  machineId: string | null;
  machine: string;
  machineCode: string | null;
  workOrderId: string | null;
  workOrder: string;
  productionOrder: string | null;
  product: string;
  skuId: string | null;
  unit: string;
  plannedQty: number | null;
  goodQty: number;
  rejectedQty: number;
  goodPieces: number;
  rejectedPieces: number;
  progressPct: number | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
}

export interface MachineNow {
  machineId: string;
  code: string;
  name: string;
  state: string | null;
  since: string | null;
  line: string | null;
}

export interface MachineSlice {
  key: string;
  label: string;
  sublabel?: string | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  teep: number | null;
  time: Record<string, number>;
  counts: { good: number; rejected: number; total: number; theoretical: number };
}

export interface TrendPoint {
  at: string;
  key: string;
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  counts: { good: number; rejected: number; total: number; theoretical: number };
  time: Record<string, number>;
}

export interface TimelineSegment {
  machineId: string;
  machineLabel?: string;
  label?: string;
  state: string;
  from: string;
  to: string;
}

export type Basis = 'standard' | 'schedule';

export interface LiveShiftPayload {
  shift: ShiftHeader;
  window: WindowInfo;
  bucketMin: number;
  /** Which engine answered. Echoed back so the page labels what it drew. */
  basis: Basis;
  /** Schedule basis only: how far the committed slot was allowed to reach. */
  slotTo?: string;
  /** What the LINE / area / factory scored. Null before the shift has any minutes. */
  lineOee: LineOee | null;
  empty: boolean;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  teep: number | null;
  utilization: number | null;
  /**
   * The time model. The two engines share every key except the top bar: the
   * standard one calls it `totalMin`, the schedule one `committedMin`, and the
   * schedule one adds `notStartedMin` / `notYetReachedMin`. Read it through
   * `topMin()` rather than naming either directly.
   */
  time: Record<string, number>;
  counts: { good: number; rejected: number; total: number; theoretical: number };
  /** Schedule basis only: how much of the promised slot has gone by. */
  slotElapsedPct?: number | null;
  bars: Array<{ key: string; minutes: number; pct: number; kind: 'base' | 'loss' | 'result' }>;
  audit: {
    ok: boolean; bucketsMin: number; bucketDriftMin: number; identityDriftMin: number;
    /** Parts booked in minutes with no measured runtime — see the OEE audit. */
    outputWithoutRuntimeParts?: number;
    /** What those parts add to Performance, in points. */
    outputWithoutRuntimePct?: number;
  };
  machines: MachineSlice[];
  jobOrders: LiveJobOrder[];
  machineNow: MachineNow[];
  trend: TrendPoint[];
  timeline: TimelineSegment[];
  /** The schedule over the same window, for the timeline's second track. */
  plannedTimeline?: TimelineSegment[];
  /**
   * The same minutes, re-read with booked schedule time taking precedence.
   *
   * DISPLAY ONLY, and only in "Where the time went". No OEE figure, no export
   * and no stored minute is computed from this — see `scheduleFirst` on the
   * API for why it is deliberately kept apart for now.
   */
  statesScheduleFirst?: Array<{
    key: string;
    label: string;
    kind: 'running' | 'planned' | 'external' | 'downtime' | 'unmeasured';
    /** Booked on the schedule, as opposed to reported by a sensor. */
    scheduled: boolean;
    minutes: number;
    /** What the machine reported before the schedule took its share. */
    rawMin: number;
    /** rawMin − minutes: the part a booked stop had already claimed. */
    reclaimedMin: number;
  }>;
  states: Array<{ state: string | null; minutes: number; rows: number }>;
  rejectReasons: {
    configured: boolean;
    totalPieces: number;
    occurrence: number;
    reasons: Array<{
      reason: string; category: string; pieces: number;
      occurrence: number; sharePct: number; cumulativePct: number;
    }>;
  } | null;
}

/**
 * How often each range refetches.
 *
 * A fifteen-minute window is a third stale after five minutes, so it polls hard;
 * a whole-shift total barely moves, so it does not. Polling everything at the
 * fastest rate would multiply requests for numbers that had not changed.
 */
const REFETCH_MS: Record<RangeKey, number> = {
  '15': 15_000,
  '30': 20_000,
  '60': 30_000,
  '120': 45_000,
  shift: 60_000,
};

/**
 * The window's top-level time bar, whichever engine produced it.
 *
 * The standard basis divides by the time that went by (`totalMin`); the
 * schedule basis divides by the slot the order was promised (`committedMin`).
 * Naming one of them at a call site is how a panel comes to read blank on the
 * other basis — which is exactly what `time.operatingMin` did on this page.
 */
export const topMin = (time: Record<string, number> | undefined): number | undefined =>
  time?.totalMin ?? time?.committedMin;

export const TOP_LABEL: Record<Basis, string> = {
  standard: 'Total time',
  schedule: 'Committed time',
};

export function useLiveShift(range: RangeKey) {
  const { filter, key: scopeKey } = useScope();
  // The same OEE / OEE-TB switch the analysis page honours, meaning the same
  // thing: atOee selects the STANDARD engine, and its absence the schedule one.
  // Read through `useOeeMode` rather than the store, so this page cannot drift
  // into being the one screen where the toggle is inert.
  const { atOee } = useOeeMode();
  const basis: Basis = atOee ? 'standard' : 'schedule';
  const { param: lineBasisParam, key: lineBasisKey } = useLineBasis();
  // The panel's product / order filter applies here too. It is part of the query
  // KEY as well as the params: without that, narrowing to one product would
  // re-serve the cached whole-factory answer, and the page would look filtered
  // while showing everything.
  const { poNumber, woId, skuId } = useOrderFilterStore();
  const dims = {
    ...(woId ? { workOrderId: woId } : {}),
    ...(skuId ? { skuId } : {}),
    ...(poNumber ? { productionOrderNumber: poNumber } : {}),
  };

  return useQuery<LiveShiftPayload>({
    queryKey: ['live-shift', basis, lineBasisKey, range, scopeKey, `${poNumber}|${woId}|${skuId}`],
    queryFn: async () => {
      const res = await api.get<any>('/live-shift', {
        params: { window: range, basis, ...filter, ...dims, ...lineBasisParam },
      });
      return (res?.data ?? res) as LiveShiftPayload;
    },
    refetchInterval: REFETCH_MS[range] ?? 60_000,
    // The window slides with the wall clock, so a cached answer is stale the
    // moment it lands — but keeping it on screen while the next one arrives is
    // what stops the page blanking every poll.
    staleTime: 0,
    placeholderData: (prev) => prev,
  });
}
