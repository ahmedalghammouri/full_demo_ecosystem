import { KpiService } from './kpi.service';
import { OEEService } from './oee.service';

/**
 * Run time is OPERATING time, and the plant's State Rules decide which stops count.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Run time used to be the raw span a job order occupied. A machine that broke down
 * for half the window still reported a full window of run time, so schedule-based
 * Availability could not fall below 100% — the stop was visible only in the
 * time-based variant, and the two bases disagreed on the same screen. On live data
 * one bucket read planned 1.00 / run 1.00 / down 1.00 / availability 100%.
 *
 * The definition now subtracts stopped minutes, and WHICH kind of stop a state is
 * comes from MachineStateRule, not from a list of state names in the code:
 *
 *   unplanned  → leaves run, STAYS in PPT  → charged to Availability
 *   planned    → leaves run AND PPT        → never expected to produce
 *   external   → leaves run AND PPT        → healthy machine, starved line
 *
 * These tests pin each of the three, plus the rule lookup itself, because the
 * failure mode is silent: every number still renders, it is just wrong.
 */
describe('KpiService — run time is operating time', () => {
  const factoryId = 'f1';
  const from = new Date('2026-08-01T00:00:00Z');
  const to = new Date('2026-08-01T10:00:00Z'); // 600-minute window

  const machines = [{ id: 'm1', name: 'Powder Filler', code: 'M1', sortOrder: 1 }];

  /** One JO covering the whole window, planned exactly as it ran. */
  const jo = () => ({
    id: 'jo-m1',
    machineId: 'm1',
    status: 'COMPLETE',
    idealCycleTimeSec: 1,
    actualQtyGood: 1000,
    actualQtyRejected: 0,
    plannedStart: from,
    plannedEnd: to,
    actualStart: from,
    actualEnd: to,
    sequenceOrder: 1,
    outputUnit: null,
    workOrderId: 'wo-1',
    workOrder: { sku: null },
  });

  const event = (mins: number, flags: { isPlanned: boolean; affectsOEE: boolean }) => ({
    machineId: 'm1',
    startTime: from,
    endTime: new Date(from.getTime() + mins * 60_000),
    durationMinutes: mins,
    reasonCode: 'X',
    category: 'OTHER',
    ...flags,
  });

  const stateRecord = (mins: number, state = 'STARVED') => ({
    machineId: 'm1',
    state,
    startTime: from,
    endTime: new Date(from.getTime() + mins * 60_000),
  });

  function build(opts: {
    downtime?: unknown[];
    states?: unknown[];
    rules?: unknown[] | 'missing';
  } = {}) {
    const machineStateRule = opts.rules === 'missing'
      ? undefined
      : { findMany: jest.fn().mockResolvedValue(opts.rules ?? []) };
    const prisma = {
      productionLine: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'l1', name: 'Betti', code: 'PL-01',
          oeeMethod: 'ROLLUP', bottleneckMachineId: null, outfeedMachineIds: [], machines,
        }),
      },
      jobOrder: { findMany: jest.fn().mockResolvedValue([jo()]) },
      machineStateRecord: { findMany: jest.fn().mockResolvedValue(opts.states ?? []) },
      downtimeEvent: { findMany: jest.fn().mockResolvedValue(opts.downtime ?? []) },
      ...(machineStateRule ? { machineStateRule } : {}),
    };
    const service = new KpiService(
      prisma as never,
      new OEEService(),
      { emit: jest.fn() } as never,
      { ratedCapacityByMachine: jest.fn().mockResolvedValue(new Map()) } as never,
    
      // The records list delegates to the two engines; nothing in these
      // suites reaches it, so a stub is enough to construct the service.
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
    );
    return { service, prisma };
  }

  const availabilityOf = async (svc: KpiService) =>
    (await svc.lineOeeAnalytics(factoryId, 'l1', from, to))!.machines[0].availability;

  // ── the three kinds of stop ────────────────────────────────────────────────
  it('charges an unplanned stop to Availability', async () => {
    // 60 of 600 minutes lost to a breakdown → run 540, PPT still 600.
    const { service } = build({ downtime: [event(60, { isPlanned: false, affectsOEE: true })] });
    expect(await availabilityOf(service)).toBeCloseTo(90, 1);
  });

  it('reports 100% when nothing stopped — the definition did not move the baseline', async () => {
    const { service } = build();
    expect(await availabilityOf(service)).toBeCloseTo(100, 1);
  });

  it('does not charge a PLANNED stop — it leaves both sides of the ratio', async () => {
    // A scheduled changeover is time the line was never expected to produce in.
    const { service } = build({ downtime: [event(60, { isPlanned: true, affectsOEE: true })] });
    expect(await availabilityOf(service)).toBeCloseTo(100, 1);
  });

  it('does not charge an EXTERNAL stop — the machine is healthy, the line is not', async () => {
    const { service } = build({
      downtime: [event(60, { isPlanned: false, affectsOEE: false })],
      states: [stateRecord(60)],
    });
    expect(await availabilityOf(service)).toBeCloseTo(100, 1);
  });

  it('separates the three when all of them happen in one window', async () => {
    // 600 total: 60 planned + 60 external carved out → PPT 480; 48 unplanned → run 432.
    const { service } = build({
      downtime: [
        { ...event(60, { isPlanned: true, affectsOEE: true }) },
        {
          ...event(0, { isPlanned: false, affectsOEE: false }),
          startTime: new Date(from.getTime() + 60 * 60_000),
          endTime: new Date(from.getTime() + 120 * 60_000),
        },
        {
          ...event(0, { isPlanned: false, affectsOEE: true }),
          startTime: new Date(from.getTime() + 120 * 60_000),
          endTime: new Date(from.getTime() + 168 * 60_000),
        },
      ],
      states: [{
        machineId: 'm1', state: 'STARVED',
        startTime: new Date(from.getTime() + 60 * 60_000),
        endTime: new Date(from.getTime() + 120 * 60_000),
      }],
    });
    expect(await availabilityOf(service)).toBeCloseTo(90, 1); // 432 / 480
  });

  // ── the state rules decide, not the code ──────────────────────────────────
  it('reads the external states from MachineStateRule, not from a hardcoded list', async () => {
    const { service, prisma } = build({
      rules: [{ state: 'AWAITING_FORKLIFT' }],
    });
    await service.lineOeeAnalytics(factoryId, 'l1', from, to);

    // The rule query asks for exactly the definition of "external": a stop, not
    // planned, not affecting OEE.
    expect(prisma.machineStateRule!.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isDowntime: true, isPlanned: false, affectsOEE: false }),
      }),
    );
    // ...and the state history is then read for the CONFIGURED state, not STARVED.
    expect(prisma.machineStateRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: { in: ['AWAITING_FORKLIFT'] } }),
      }),
    );
  });

  it('falls back to STARVED/BLOCKED when a factory has configured no rules', async () => {
    // An empty rule table must not mean "nothing is external", or a plant that never
    // opened the Signal Rules page would start charging starvation to its machines.
    const { service, prisma } = build({ rules: [] });
    await service.lineOeeAnalytics(factoryId, 'l1', from, to);

    expect(prisma.machineStateRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ state: { in: ['STARVED', 'BLOCKED'] } }),
      }),
    );
  });

  it('still computes OEE when the rules table cannot be read at all', async () => {
    // Configuration must never be able to take the KPI engine down.
    const { service } = build({ rules: 'missing', downtime: [event(60, { isPlanned: false, affectsOEE: true })] });
    expect(await availabilityOf(service)).toBeCloseTo(90, 1);
  });
});
