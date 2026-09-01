import { OeeStandardWriter } from './oee-standard.writer';
import { auditTotals, computeOee, EMPTY_TOTALS } from './oee-standard.calc';

const MIN = 60_000;
/**
 * 08:00 PLANT-LOCAL, not UTC.
 *
 * Shift windows are stored as "HH:mm" wall-clock and resolved against local
 * hours, so a UTC anchor puts the shift somewhere else entirely and every
 * planned-stop offset lands in the wrong bucket. The first draft of this file
 * used `Z` and the stop tests failed for that reason alone — which is the same
 * timezone trap that has already produced two false bug reports on this project.
 */
const T0 = new Date(2026, 7, 19, 8, 0, 0, 0).getTime();
const at = (minsAfterT0: number) => new Date(T0 + minsAfterT0 * MIN);

/**
 * The writer, one minute at a time.
 *
 * Every test drives the SAME minute — 08:10 to 08:11 — and changes only what the
 * machine and the schedule said about it. That keeps each case about the
 * classification rule under test rather than about clock arithmetic, and it
 * makes the central property checkable everywhere: whatever the inputs, the five
 * buckets must add up to total time. Minutes that go missing here do not raise
 * an error, they inflate availability.
 */
describe('OeeStandardWriter — classifying one minute', () => {
  const BUCKET = 10; // minutes after T0

  function build(opts: {
    states?: Array<{ state: string; from: number; to: number | null }>;
    rules?: Array<{ state: string; isDowntime: boolean; isPlanned: boolean; affectsOEE: boolean }>;
    stops?: Array<{ startOffsetMin: number; durationMinutes: number; scope?: string; targets?: any[] }>;
    joStatus?: string;
    joStart?: number;
    joEnd?: number | null;
    good?: number;
    rejected?: number;
    prior?: { good: number; rejected: number };
    idealCycleTimeSec?: number | null;
  } = {}) {
    const {
      states = [], rules = [], stops = [], joStatus = 'EXECUTING',
      joStart = 0, joEnd = null, good = 0, rejected = 0,
      prior, idealCycleTimeSec = 60,
    } = opts;

    const captured: any[] = [];
    const prisma: any = {
      oeeMinute: {
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
        groupBy: jest.fn().mockResolvedValue(
          prior ? [{ jobOrderId: 'jo1', _sum: { goodParts: prior.good, rejectedParts: prior.rejected } }] : [],
        ),
        upsert: jest.fn(async ({ create }: any) => { captured.push(create); return create; }),
      },
      jobOrder: {
        findMany: jest.fn().mockResolvedValue([{
          id: 'jo1', factoryId: 'f1', machineId: 'm1', workOrderId: 'wo1', status: joStatus,
          idealCycleTimeSec, outputUnit: 'PIECE',
          actualStart: at(joStart), actualEnd: joEnd == null ? null : at(joEnd),
          plannedEnd: at(60),
          actualQtyGood: good, actualQtyRejected: rejected,
          machine: { lineId: 'L1' },
          workOrder: { sku: { baseUnit: 'PIECE', unitsPerInner: 1, innersPerCarton: 1, cartonsPerPallet: 1 } },
        }]),
      },
      machineStateRecord: {
        findMany: jest.fn().mockResolvedValue(states.map((s) => ({
          machineId: 'm1', state: s.state,
          startTime: at(s.from), endTime: s.to == null ? null : at(s.to),
        }))),
      },
      machineStateRule: {
        findMany: jest.fn(async ({ where }: any) =>
          rules.filter((r) => r.state === where.state).map((r) => ({ machineId: null, ...r }))),
      },
      shiftTemplate: {
        // One shift starting at T0, so a stop offset is minutes after 08:00.
        findMany: jest.fn().mockResolvedValue([{
          id: 'st1', code: 'A', name: 'Shift A',
          startTime: '08:00', endTime: '16:00', crossesMidnight: false,
        }]),
      },
      plannedStopTemplate: {
        findMany: jest.fn().mockResolvedValue(stops.map((s, i) => ({
          id: `stop${i}`, code: `S${i}`, name: `Stop ${i}`,
          durationMinutes: s.durationMinutes, scope: s.scope ?? 'FACTORY',
          shiftTemplateId: 'st1', startOffsetMin: s.startOffsetMin, isActive: true,
          targets: s.targets ?? [],
        }))),
      },
    };
    return { writer: new OeeStandardWriter(prisma as never), captured };
  }

  /** Run the capture for the bucket 08:10–08:11 and hand back the written row. */
  async function run(opts: Parameters<typeof build>[0] = {}) {
    const { writer, captured } = build(opts);
    // `at` is the start of the NEXT minute, so the closed bucket is 08:10–08:11.
    await writer.captureMinute(at(BUCKET + 1));
    return captured[0];
  }

  /** The property that must hold no matter what the inputs were. */
  const bucketsSum = (row: any) =>
    row.plannedStopMin + row.availabilityLossMin + row.externalLossMin + row.unmeasuredMin + row.operatingMin;

  it('captures the CLOSED minute, never the one still running', async () => {
    // At 08:11:00 barely any of 08:11 has elapsed. Capturing it would book a full
    // minute of total time against milliseconds of operating time and collapse
    // availability — the trap the first engine fell into.
    const row = await run({ states: [{ state: 'RUNNING', from: 0, to: null }] });
    expect(row.bucketStart.getTime()).toBe(at(BUCKET).getTime());
    expect(row.totalMin).toBe(1);
    expect(row.operatingMin).toBe(1);
  });

  it('books a running minute as operating time', async () => {
    const row = await run({ states: [{ state: 'RUNNING', from: 0, to: null }] });
    expect(row.operatingMin).toBe(1);
    expect(bucketsSum(row)).toBeCloseTo(row.totalMin, 6);
  });

  it('books a breakdown as an availability loss', async () => {
    const row = await run({ states: [{ state: 'BREAKDOWN', from: 0, to: null }] });
    expect(row.availabilityLossMin).toBe(1);
    expect(row.operatingMin).toBe(0);
    expect(bucketsSum(row)).toBeCloseTo(row.totalMin, 6);
  });

  it('splits a minute the machine spent half running and half broken', async () => {
    const row = await run({
      states: [
        { state: 'RUNNING', from: 0, to: BUCKET + 0.5 },
        { state: 'BREAKDOWN', from: BUCKET + 0.5, to: null },
      ],
    });
    expect(row.operatingMin).toBeCloseTo(0.5, 6);
    expect(row.availabilityLossMin).toBeCloseTo(0.5, 6);
    expect(bucketsSum(row)).toBeCloseTo(1, 6);
  });

  // ── State Rules decide, not a list in the code ────────────────────────────
  it('follows the State Rule when the plant reclassifies a state', async () => {
    // The same BREAKDOWN, configured as external. Availability must not move.
    const row = await run({
      states: [{ state: 'BREAKDOWN', from: 0, to: null }],
      rules: [{ state: 'BREAKDOWN', isDowntime: true, isPlanned: false, affectsOEE: false }],
    });
    expect(row.externalLossMin).toBe(1);
    expect(row.availabilityLossMin).toBe(0);
  });

  it('books starvation as external loss, out of the ratio entirely', async () => {
    const row = await run({ states: [{ state: 'STARVED', from: 0, to: null }] });
    expect(row.externalLossMin).toBe(1);
    const t = { ...EMPTY_TOTALS, ...row };
    expect(computeOee(t).time.operationalMin).toBe(0); // carved out above PPT
  });

  it('treats a state marked "not downtime" but not running as a loss', async () => {
    // Inside planned production time a minute that made nothing is a loss
    // whatever it is called. Otherwise IDLE becomes free time.
    const row = await run({
      states: [{ state: 'IDLE', from: 0, to: null }],
      rules: [{ state: 'IDLE', isDowntime: false, isPlanned: false, affectsOEE: true }],
    });
    expect(row.availabilityLossMin).toBe(1);
  });

  // ── Scheduled planned stops ───────────────────────────────────────────────
  it('places a planned stop by shift offset and duration, not by guesswork', async () => {
    // A stop 10 minutes into the shift for 30 minutes covers 08:10–08:40, so it
    // owns this whole bucket.
    const row = await run({
      states: [{ state: 'RUNNING', from: 0, to: null }],
      stops: [{ startOffsetMin: 10, durationMinutes: 30 }],
    });
    expect(row.plannedStopMin).toBe(1);
    expect(row.operatingMin).toBe(0);
  });

  it('leaves a bucket outside the stop window alone', async () => {
    const row = await run({
      states: [{ state: 'RUNNING', from: 0, to: null }],
      stops: [{ startOffsetMin: 30, durationMinutes: 30 }], // 08:30–09:00
    });
    expect(row.plannedStopMin).toBe(0);
    expect(row.operatingMin).toBe(1);
  });

  it('lets a scheduled stop outrank a machine that kept running through it', async () => {
    // The time was not ours to produce in. A machine running during a break does
    // not earn the minute back — and if it did, the break would flatter OEE.
    const row = await run({
      states: [{ state: 'RUNNING', from: 0, to: null }],
      stops: [{ startOffsetMin: 10, durationMinutes: 1 }],
    });
    expect(row.plannedStopMin).toBe(1);
    expect(row.operatingMin).toBe(0);
    expect(bucketsSum(row)).toBeCloseTo(1, 6);
  });

  it('does not let two overlapping stops remove more time than the clock has', async () => {
    // A factory break and a line cleaning that runs into it describe the SAME
    // stopped minutes. Summing their durations was the defect that made stopped
    // time exceed the window in the first engine.
    const row = await run({
      states: [{ state: 'RUNNING', from: 0, to: null }],
      stops: [
        { startOffsetMin: 5, durationMinutes: 20 },
        { startOffsetMin: 8, durationMinutes: 20 },
      ],
    });
    expect(row.plannedStopMin).toBe(1);
    expect(bucketsSum(row)).toBeCloseTo(1, 6);
  });

  it('applies a MACHINE-scoped stop only to the machines named', async () => {
    const other = await run({
      states: [{ state: 'RUNNING', from: 0, to: null }],
      stops: [{ startOffsetMin: 10, durationMinutes: 30, scope: 'MACHINE', targets: [{ machineId: 'm9', lineId: null }] }],
    });
    expect(other.plannedStopMin).toBe(0); // cleaning m9 is not downtime for m1

    const mine = await run({
      states: [{ state: 'RUNNING', from: 0, to: null }],
      stops: [{ startOffsetMin: 10, durationMinutes: 30, scope: 'MACHINE', targets: [{ machineId: 'm1', lineId: null }] }],
    });
    expect(mine.plannedStopMin).toBe(1);
  });

  it('ignores a stop that names no start — it is unplaceable, not midday', async () => {
    const row = await run({
      states: [{ state: 'RUNNING', from: 0, to: null }],
      stops: [{ startOffsetMin: null as any, durationMinutes: 30 }],
    });
    expect(row.plannedStopMin).toBe(0);
  });

  // ── Silence ───────────────────────────────────────────────────────────────
  it('books a minute the machine never reported as unmeasured, not as running', async () => {
    const row = await run({ states: [] });
    expect(row.unmeasuredMin).toBe(1);
    expect(row.operatingMin).toBe(0);
    expect(row.availabilityLossMin).toBe(0);
    // And it leaves the ratio entirely rather than flattering it.
    expect(computeOee({ ...EMPTY_TOTALS, ...row }).availability).toBeNull();
  });

  // ── Job-order scenarios ───────────────────────────────────────────────────
  it('books a paused order as a planned stop, not as the machine failing', async () => {
    // A pause is a decision somebody made about the time. Charging it to
    // availability blames the machine for a choice made about it.
    const row = await run({ joStatus: 'PAUSED', states: [] });
    expect(row.plannedStopMin).toBe(1);
    expect(row.jobOrderStatus).toBe('PAUSED');
  });

  it('stops accruing at actualEnd once the order finishes mid-minute', async () => {
    const row = await run({
      states: [{ state: 'RUNNING', from: 0, to: null }],
      joEnd: BUCKET + 0.25,
    });
    expect(row.totalMin).toBeCloseTo(0.25, 6);
    expect(row.operatingMin).toBeCloseTo(0.25, 6);
  });

  it('starts accruing at actualStart, not at the top of the minute', async () => {
    const row = await run({ states: [{ state: 'RUNNING', from: 0, to: null }], joStart: BUCKET + 0.4 });
    expect(row.totalMin).toBeCloseTo(0.6, 6);
  });

  it('keeps accruing past plannedEnd — an overrun is not free', async () => {
    // plannedEnd is T0+60; this bucket is T0+10, so run one far past it.
    const { writer, captured } = build({ states: [{ state: 'RUNNING', from: 0, to: null }] });
    await writer.captureMinute(at(121)); // bucket 120–121, an hour past plannedEnd
    expect(captured[0].totalMin).toBe(1);
    expect(captured[0].operatingMin).toBe(1);
  });

  // ── Counts and design speed ───────────────────────────────────────────────
  it('records the delta since the last closed minute, not the running total', async () => {
    const row = await run({
      states: [{ state: 'RUNNING', from: 0, to: null }],
      good: 500, rejected: 20, prior: { good: 480, rejected: 15 },
    });
    expect(row.goodParts).toBe(20);
    expect(row.rejectedParts).toBe(5);
  });

  it('never books a negative delta when a counter is reset', async () => {
    const row = await run({ good: 10, prior: { good: 400, rejected: 0 }, states: [] });
    expect(row.goodParts).toBe(0);
  });

  it('derives theoretical output from operating minutes and design speed', async () => {
    // 60 s per part → 60 parts an hour → one part in the operating minute.
    const row = await run({ states: [{ state: 'RUNNING', from: 0, to: null }], idealCycleTimeSec: 60 });
    expect(row.designSpeedPph).toBe(60);
    expect(row.theoreticalParts).toBeCloseTo(1, 6);
  });

  it('earns no theoretical output for a minute it was not operating', async () => {
    // Otherwise a broken machine accrues a target it never had a chance to meet,
    // and Performance measures the breakdown twice.
    const row = await run({ states: [{ state: 'BREAKDOWN', from: 0, to: null }] });
    expect(row.theoreticalParts).toBe(0);
  });

  it('leaves theoretical output at zero when no cycle time is configured', async () => {
    const row = await run({ states: [{ state: 'RUNNING', from: 0, to: null }], idealCycleTimeSec: null });
    expect(row.designSpeedPph).toBeNull();
    expect(row.theoreticalParts).toBe(0);
    // Performance is then null — unknown, which is honest — rather than zero.
    expect(computeOee({ ...EMPTY_TOTALS, ...row }).performance).toBeNull();
  });

  // ── The property, over a messy minute ─────────────────────────────────────
  it('accounts for every minute even when every rule fires at once', async () => {
    const row = await run({
      states: [
        { state: 'RUNNING', from: 0, to: BUCKET + 0.2 },
        { state: 'BREAKDOWN', from: BUCKET + 0.2, to: BUCKET + 0.4 },
        { state: 'STARVED', from: BUCKET + 0.4, to: BUCKET + 0.6 },
        // 0.6–0.8 nobody reported at all
        { state: 'CHANGEOVER', from: BUCKET + 0.8, to: null },
      ],
    });
    expect(bucketsSum(row)).toBeCloseTo(row.totalMin, 6);
    expect(row.unmeasuredMin).toBeCloseTo(0.2, 6);
    expect(auditTotals({ ...EMPTY_TOTALS, ...row }).ok).toBe(true);
  });
});
