import { classifyMinute } from './minute-classification';

/**
 * Microstops, measured against each machine's own threshold.
 *
 * ── Why this needed a test rather than a look at the data ───────────────────
 * The plant's threshold is 60 seconds and the line's faults run for minutes, so
 * every machine currently reports zero microstops — correctly. A mechanism that
 * only ever returns zero is indistinguishable from one that is not wired at
 * all, and the field it writes sat hard-coded at 0 for months precisely because
 * nothing ever proved otherwise.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A stop is a microstop if the STATE RECORD is shorter than the threshold — not
 * if the slice of it inside this minute is. A 40-second stop straddling a
 * minute boundary is one 40-second stop, not two 20-second ones, and only the
 * record's own duration can tell them apart.
 *
 * It is reported as a SUBSET of the availability loss, never subtracted from
 * it, so the six buckets still sum to the minute and no OEE figure moved when
 * this became measurable.
 */
describe('microstops', () => {
  const MIN = 60_000;
  const T0 = new Date('2026-08-21T10:00:00Z').getTime();

  /** Everything not producing is an availability loss unless a rule says otherwise. */
  const verdictFor = async () => ({ isDowntime: true, isPlanned: false, affectsOEE: true });

  const run = (
    states: Array<{ state: string; startTime: Date; endTime: Date | null }>,
    microStopSec?: number,
    winFrom = T0,
    winTo = T0 + MIN,
  ) =>
    classifyMinute({
      winFrom,
      winTo,
      openEnd: winTo,
      states: states.map((s) => ({ machineId: 'm1', ...s })) as never,
      scheduledStops: [],
      paused: false,
      verdictFor,
      microStopSec,
    });

  it('counts a stop shorter than the threshold as a microstop', async () => {
    const r = await run(
      [
        { state: 'RUNNING', startTime: new Date(T0), endTime: new Date(T0 + 30_000) },
        { state: 'BREAKDOWN', startTime: new Date(T0 + 30_000), endTime: new Date(T0 + 70_000) },
      ],
      60, // a 40-second stop, under the 60-second threshold
    );

    expect(r.microStopMin).toBeGreaterThan(0);
    // Still counted as an availability loss — the microstop is a subset of it.
    expect(r.availabilityLossMin).toBeGreaterThanOrEqual(r.microStopMin);
  });

  it('does not count a stop longer than the threshold', async () => {
    const r = await run(
      [
        { state: 'RUNNING', startTime: new Date(T0), endTime: new Date(T0 + 10_000) },
        { state: 'BREAKDOWN', startTime: new Date(T0 + 10_000), endTime: new Date(T0 + 5 * MIN) },
      ],
      60, // a five-minute stop
    );

    expect(r.microStopMin).toBe(0);
    expect(r.availabilityLossMin).toBeGreaterThan(0);
  });

  /**
   * The reason the record's own duration is what counts.
   */
  it('judges a stop by its whole duration, not by the part inside this minute', async () => {
    // A 5-minute breakdown. Only 30 seconds of it fall in the minute under test.
    const stop = { state: 'BREAKDOWN', startTime: new Date(T0 - 4 * MIN - 30_000), endTime: new Date(T0 + 30_000) };
    const r = await run(
      [stop, { state: 'RUNNING', startTime: new Date(T0 + 30_000), endTime: new Date(T0 + MIN) }],
      60,
    );

    // The slice is 30 seconds — under the threshold — but the STOP is five
    // minutes, so it is a breakdown and not a microstop.
    expect(r.microStopMin).toBe(0);
    expect(r.availabilityLossMin).toBeCloseTo(0.5, 3);
  });

  it('reports nothing when no threshold is configured', async () => {
    const r = await run(
      [{ state: 'BREAKDOWN', startTime: new Date(T0), endTime: new Date(T0 + 20_000) }],
      undefined,
    );

    // A 20-second stop, but nobody has said what counts as short.
    expect(r.microStopMin).toBe(0);
  });

  it('never subtracts the microstop from the minute — the model still closes', async () => {
    const r = await run(
      [
        { state: 'RUNNING', startTime: new Date(T0), endTime: new Date(T0 + 20_000) },
        { state: 'BREAKDOWN', startTime: new Date(T0 + 20_000), endTime: new Date(T0 + 50_000) },
        { state: 'RUNNING', startTime: new Date(T0 + 50_000), endTime: new Date(T0 + MIN) },
      ],
      60,
    );

    const sum = r.operatingMin + r.availabilityLossMin + r.externalLossMin
      + r.plannedStopMin + r.unmeasuredMin;
    expect(sum).toBeCloseTo(1, 6);
    expect(r.microStopMin).toBeGreaterThan(0);
  });
});
