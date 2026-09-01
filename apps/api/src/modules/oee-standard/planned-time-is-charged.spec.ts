import { classifyMinute, FALLBACK_VERDICTS, UNKNOWN_VERDICT, type Verdict } from './minute-classification';
import { auditTotals, EMPTY_TOTALS, type OeeTotals } from './oee-standard.calc';

/**
 * Two flags, two meanings — and the edges the reference says must be visible.
 *
 * ── What was wrong ──────────────────────────────────────────────────────────
 * The classifier branched on `isPlanned` alone, so `affectsOEE` was decorative
 * for every planned state. CHANGEOVER and SETUP ship with `affectsOEE: true`
 * precisely because setup-and-adjustment is one of the six big losses and is
 * supposed to hurt the reading. They were excused instead, and a plant that
 * never sees changeover charged has no reason to shorten it.
 *
 * ── The other edge ──────────────────────────────────────────────────────────
 * Counters are read off the job order and are independent of how the minute was
 * classified. So a line that runs through a scheduled break still books output
 * while the theoretical denominator for those minutes is zero. The parts are
 * real; the silence was the defect.
 */

const at = (min: number) => new Date(Date.UTC(2026, 7, 25, 8, min)).getTime();
const seg = (state: string, fromMin: number, toMin: number) => ({
  state, startTime: new Date(at(fromMin)), endTime: new Date(at(toMin)),
});

/** The seeded rules, as the plant actually has them. */
const verdictFor = async (state: string): Promise<Verdict> =>
  FALLBACK_VERDICTS[state] ?? UNKNOWN_VERDICT;

const run = (states: ReturnType<typeof seg>[], scheduledStops: Array<[number, number]> = []) =>
  classifyMinute({
    winFrom: at(0),
    winTo: at(60),
    openEnd: at(60),
    states,
    scheduledStops: scheduledStops.map(([a, b]) => [at(a), at(b)] as [number, number]),
    paused: false,
    verdictFor,
  });

describe('a planned state is excused only when the plant says it is', () => {
  it('charges CHANGEOVER as an availability loss, not a planned stop', async () => {
    // affectsOEE: true. Changeover is intended, and it still costs you.
    const b = await run([seg('CHANGEOVER', 0, 60)]);
    expect(b.availabilityLossMin).toBe(60);
    expect(b.plannedStopMin).toBe(0);
  });

  it('charges SETUP the same way, for the same reason', async () => {
    const b = await run([seg('SETUP', 0, 60)]);
    expect(b.availabilityLossMin).toBe(60);
    expect(b.plannedStopMin).toBe(0);
  });

  it('still excuses PLANNED_STOP and MAINTENANCE', async () => {
    // affectsOEE: false — genuinely outside the time the plant planned to produce in.
    const stop = await run([seg('PLANNED_STOP', 0, 60)]);
    expect(stop.plannedStopMin).toBe(60);
    expect(stop.availabilityLossMin).toBe(0);

    const maint = await run([seg('MAINTENANCE', 0, 60)]);
    expect(maint.plannedStopMin).toBe(60);
    expect(maint.availabilityLossMin).toBe(0);
  });

  it('leaves starved and blocked outside the ratio, as before', async () => {
    // Not planned, does not affect OEE: the LINE stopped this machine, and
    // charging it for the line's constraint is the mistake this term prevents.
    const b = await run([seg('STARVED', 0, 30), seg('BLOCKED', 30, 60)]);
    expect(b.externalLossMin).toBe(60);
    expect(b.availabilityLossMin).toBe(0);
    expect(b.plannedStopMin).toBe(0);
  });

  it('keeps every minute in exactly one bucket after the change', async () => {
    // The whole point of the classifier. Changing which bucket a state lands in
    // must not create or lose a minute.
    const b = await run([
      seg('RUNNING', 0, 20), seg('CHANGEOVER', 20, 30),
      seg('PLANNED_STOP', 30, 40), seg('BREAKDOWN', 40, 50), seg('STARVED', 50, 60),
    ]);
    const sum = b.operatingMin + b.availabilityLossMin + b.plannedStopMin
      + b.externalLossMin + b.unmeasuredMin;
    expect(sum).toBeCloseTo(60, 6);
    expect(b.operatingMin).toBe(20);
    expect(b.availabilityLossMin).toBe(20); // changeover 10 + breakdown 10
    expect(b.plannedStopMin).toBe(10);
    expect(b.externalLossMin).toBe(10);
  });
});

describe('a scheduled window still overrides what the machine reported', () => {
  it('takes running minutes away from operating when the schedule claims them', async () => {
    // The plant ran through its own scheduled break. The schedule wins: those
    // minutes were not planned production time, whatever the sensor saw.
    const b = await run([seg('RUNNING', 0, 60)], [[0, 30]]);
    expect(b.plannedStopMin).toBe(30);
    expect(b.operatingMin).toBe(30);
  });
});

describe('output booked with no runtime is named, not swallowed', () => {
  const totals = (over: Partial<OeeTotals>): OeeTotals => ({ ...EMPTY_TOTALS, ...over });

  it('reports the parts and what they add to Performance', async () => {
    // 1,245 pieces against a 203,220 denominator is +0.61 points — small, and
    // invisible unless something says it. It scales with planned-stop volume.
    const a = auditTotals(totals({
      totalMin: 8241, operatingMin: 4524, availabilityLossMin: 479,
      plannedStopMin: 2119, externalLossMin: 1119, unmeasuredMin: 0,
      goodParts: 136584, rejectedParts: 2151, theoreticalParts: 203220,
      outputWithoutRuntimeParts: 1245,
    }));
    expect(a.outputWithoutRuntimeParts).toBe(1245);
    expect(a.outputWithoutRuntimePct).toBeCloseTo(0.61, 2);
  });

  it('does not turn a reconciling window red', async () => {
    // `ok` is a statement about the MINUTES. Orphan output is a different fact
    // needing a different action — a schedule that does not match what the line
    // did, rather than a writer losing time — so it gets its own line.
    const a = auditTotals(totals({
      totalMin: 60, operatingMin: 60, theoreticalParts: 1000,
      goodParts: 900, outputWithoutRuntimeParts: 40,
    }));
    expect(a.ok).toBe(true);
    expect(a.outputWithoutRuntimeParts).toBe(40);
  });

  it('reports zero rather than dividing by nothing when no output was expected', async () => {
    const a = auditTotals(totals({ totalMin: 60, plannedStopMin: 60 }));
    expect(a.outputWithoutRuntimeParts).toBe(0);
    expect(a.outputWithoutRuntimePct).toBe(0);
  });
});
