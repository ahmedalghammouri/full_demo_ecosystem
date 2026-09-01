/**
 * How one machine-minute is split into buckets — shared by both OEE engines.
 *
 * The two engines differ in ONE definition: where Total time begins and ends.
 * Everything else — which minutes count as running, which as a planned stop,
 * which as somebody else's problem, which as never observed — is the same
 * question with the same answer, and a second copy of it would drift from the
 * first the moment either was fixed. That drift is the defect this whole project
 * has been unwinding, so the shared part is shared code.
 *
 * Pure: no database, no clock, no configuration lookup. The caller resolves the
 * State Rules and hands the verdicts in, which is also what makes this testable
 * without a Postgres.
 */

/** What a State Rule says about a state, once resolved for a machine. */
export interface Verdict {
  isDowntime: boolean;
  isPlanned: boolean;
  affectsOEE: boolean;
}

/** The only state that counts as producing. Setup and changeover are work, not output. */
export const PRODUCING = new Set(['RUNNING']);

/**
 * Used when a factory has configured no rule for a state. Deliberately the same
 * shape the seed writes, so a fresh install records downtime correctly instead
 * of silently recording none.
 */
export const FALLBACK_VERDICTS: Record<string, Verdict> = {
  RUNNING: { isDowntime: false, isPlanned: false, affectsOEE: true },
  IDLE: { isDowntime: true, isPlanned: false, affectsOEE: true },
  BREAKDOWN: { isDowntime: true, isPlanned: false, affectsOEE: true },
  PLANNED_STOP: { isDowntime: true, isPlanned: true, affectsOEE: false },
  MAINTENANCE: { isDowntime: true, isPlanned: true, affectsOEE: false },
  SETUP: { isDowntime: true, isPlanned: true, affectsOEE: true },
  CHANGEOVER: { isDowntime: true, isPlanned: true, affectsOEE: true },
  STARVED: { isDowntime: true, isPlanned: false, affectsOEE: false },
  BLOCKED: { isDowntime: true, isPlanned: false, affectsOEE: false },
  OFFLINE: { isDowntime: true, isPlanned: false, affectsOEE: false },
};

export const UNKNOWN_VERDICT: Verdict = { isDowntime: true, isPlanned: false, affectsOEE: true };

export type Span = [number, number];

/**
 * Merge overlapping spans — returning NEW spans, never editing the ones given.
 *
 * The obvious implementation seeds the output with the first input span and then
 * extends it in place. That aliases: the output shares array objects with the
 * input, so extending a span here quietly rewrites it wherever else it is held.
 *
 * It costs nothing until the same span is merged twice, which is exactly what
 * the classification below does — a running span is merged once into `operating`
 * and again into `claimedSoFar`. The second merge stretched the first result, and
 * a machine that ran for half a minute was booked as running for the whole one.
 * No error, no warning: just availability that reads too high.
 */
export function merge(spans: Span[]): Span[] {
  if (spans.length === 0) return [];
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  const out: Span[] = [[sorted[0][0], sorted[0][1]]];
  for (let i = 1; i < sorted.length; i++) {
    const last = out[out.length - 1];
    if (sorted[i][0] <= last[1]) last[1] = Math.max(last[1], sorted[i][1]);
    else out.push([sorted[i][0], sorted[i][1]]);
  }
  return out;
}

/** The part of `spans` that does not fall inside `taken`. `taken` must be merged. */
export function subtract(spans: Span[], taken: Span[]): Span[] {
  if (taken.length === 0) return spans;
  const out: Span[] = [];
  for (const [s, e] of spans) {
    let cur = s;
    for (const [ts, te] of taken) {
      if (te <= cur || ts >= e) continue;
      if (ts > cur) out.push([cur, Math.min(ts, e)]);
      cur = Math.max(cur, te);
      if (cur >= e) break;
    }
    if (cur < e) out.push([cur, e]);
  }
  return out;
}

const MS_PER_MIN = 60_000;
export const spanMinutes = (spans: Span[]) =>
  spans.reduce((a, [s, e]) => a + (e - s), 0) / MS_PER_MIN;

export interface StateSegment {
  state: string;
  startTime: Date;
  endTime: Date | null;
}

export interface MinuteBuckets {
  plannedStopMin: number;
  availabilityLossMin: number;
  externalLossMin: number;
  unmeasuredMin: number;
  operatingMin: number;
  /**
   * The part of `availabilityLossMin` that came from stops SHORTER than the
   * machine's threshold.
   *
   * Reported, not re-bucketed. It is a subset of the availability loss and is
   * NOT subtracted from it, so the time model still closes on itself and no
   * OEE figure moves because this became measurable. Deciding that a microstop
   * is a performance loss rather than an availability loss is a real change to
   * the model, and it gets its own before/after rather than arriving inside the
   * commit that merely started counting them.
   */
  microStopMin: number;
  /** The state that governed most of the minute, for readability on the page. */
  dominantState: string | null;
}

/**
 * Classify [winFrom, winTo) for one machine, in strict precedence.
 *
 *   1. SCHEDULED PLANNED STOP  a break somebody put on the calendar. Wins over
 *                              everything, including a machine that kept running
 *                              through it: the time was not ours to produce in.
 *   2. STATE RULE              whatever the plant configured this state to mean.
 *   3. UNOBSERVED              no state record at all → unmeasured, out of both
 *                              sides. Silence is not evidence of a stop.
 *
 * Each layer is SUBTRACTED from what the layer above did not claim, so the five
 * buckets sum to the window by construction rather than by arithmetic that has
 * to be trusted.
 *
 * @param paused a job order on hold. The whole minute reads as a planned stop:
 *   a pause is a decision somebody made about the time, and charging it to
 *   availability blames the machine for a choice made about it.
 */
export async function classifyMinute(opts: {
  winFrom: number;
  winTo: number;
  openEnd: number;
  states: StateSegment[];
  scheduledStops: Span[];
  paused: boolean;
  verdictFor: (state: string) => Promise<Verdict>;
  /**
   * Seconds below which a stop is a MICROSTOP rather than a real breakdown.
   *
   * Per machine, from `Machine.downtimeThreshold` — a field the plant has been
   * able to set since the hierarchy screen was built and which nothing has ever
   * read. Measured against the state record's OWN duration, not against the
   * slice of it that fell inside this minute: a 40-second stop straddling a
   * minute boundary is one 40-second stop, not two 20-second ones.
   */
  microStopSec?: number;
}): Promise<MinuteBuckets> {
  const {
    winFrom, winTo, openEnd, states, scheduledStops, paused, verdictFor,
    microStopSec,
  } = opts;
  const whole: Span[] = [[winFrom, winTo]];

  const byKind: Record<'operating' | 'planned' | 'external' | 'avail', Span[]> = {
    operating: [], planned: [], external: [], avail: [],
  };
  // A subset of `avail`, tracked alongside rather than instead of it.
  const microSpans: Span[] = [];
  const microMs = (microStopSec ?? 0) * 1000;
  let dominantState: string | null = null;
  let dominantMs = 0;

  for (const seg of states) {
    const s = Math.max(new Date(seg.startTime).getTime(), winFrom);
    const e = Math.min(seg.endTime ? new Date(seg.endTime).getTime() : openEnd, winTo);
    if (e <= s) continue;
    if (e - s > dominantMs) { dominantMs = e - s; dominantState = seg.state; }

    if (PRODUCING.has(seg.state)) { byKind.operating.push([s, e]); continue; }

    // The record's WHOLE duration decides whether it is a microstop, even when
    // only part of it lands in this minute.
    const wholeMs = (seg.endTime ? new Date(seg.endTime).getTime() : openEnd)
      - new Date(seg.startTime).getTime();
    const isMicro = microMs > 0 && wholeMs > 0 && wholeMs < microMs;

    const v = await verdictFor(seg.state);
    // A planned state is excused from OEE only when the plant SAYS it is.
    //
    // This used to branch on `isPlanned` alone, which made `affectsOEE`
    // decorative for every planned state — and excused CHANGEOVER and SETUP,
    // which the seed marks `affectsOEE: true` precisely because they are NOT
    // excused. Setup and adjustment is one of the six big losses; a plant that
    // never sees it charged has no reason to shorten it.
    //
    // So the two flags now mean two different things, as the columns imply:
    //   isPlanned    was this stop intended?      (reporting, the state list)
    //   affectsOEE   should the reading hurt?     (the arithmetic)
    // PLANNED_STOP and MAINTENANCE keep affectsOEE:false and stay excluded.
    if (v.isDowntime && v.isPlanned && !v.affectsOEE) byKind.planned.push([s, e]);
    else if (v.isDowntime && !v.affectsOEE) byKind.external.push([s, e]);
    else if (isMicro) { byKind.avail.push([s, e]); microSpans.push([s, e]); }
    // Not producing and not excused is an availability loss — including a state
    // the plant marked as "not downtime". Inside planned production time, a
    // minute that made nothing is a loss whatever it is called.
    else byKind.avail.push([s, e]);
  }

  const pausedSpans: Span[] = paused ? [[winFrom, winTo]] : [];

  const planned = merge([...scheduledStops, ...byKind.planned, ...pausedSpans]);
  const operating = subtract(merge(byKind.operating), planned);
  const external = subtract(
    merge(byKind.external),
    [...planned, ...operating].sort((a, b) => a[0] - b[0]),
  );
  const claimedSoFar = merge([...planned, ...operating, ...external]);
  const avail = subtract(merge(byKind.avail), claimedSoFar);
  // Whatever no layer claimed was never observed at all.
  const unmeasured = subtract(whole, merge([...claimedSoFar, ...avail]));

  return {
    plannedStopMin: spanMinutes(planned),
    operatingMin: spanMinutes(operating),
    externalLossMin: spanMinutes(external),
    availabilityLossMin: spanMinutes(avail),
    microStopMin: spanMinutes(merge(microSpans.map((x) => [...x] as Span))),
    unmeasuredMin: spanMinutes(unmeasured),
    dominantState,
  };
}
