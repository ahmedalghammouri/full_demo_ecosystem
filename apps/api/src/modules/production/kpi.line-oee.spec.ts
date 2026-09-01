import { KpiService } from './kpi.service';
import { OEEService } from './oee.service';

/**
 * Line OEE — calculation-basis selection and multi-machine outfeed.
 *
 * The contract under test:
 *   1. ROLLUP is the default and stays a first-class method, not a legacy path.
 *   2. BOTTLENECK takes A and P from ONE constraint machine.
 *   3. The outfeed is a LIST; empty means every machine on the line.
 *   4. Whichever method runs, the response says which it used and why — an
 *      unexplained line OEE is what caused this rework in the first place.
 */
describe('KpiService.lineOeeAnalytics', () => {
  const factoryId = 'f1';
  const from = new Date('2026-08-01T00:00:00Z');
  const to = new Date('2026-08-02T00:00:00Z');

  const machine = (id: string, name: string, sortOrder: number) =>
    ({ id, name, code: id.toUpperCase(), sortOrder });

  /**
   * One job order that ran the whole window on `machineId`, producing
   * `good` + `rejected`. plannedStart/End match actuals so PPT == run time,
   * which keeps Availability at 100% and isolates what each test is about.
   */
  const jo = (machineId: string, good: number, rejected: number, idealCycleTimeSec = 1) => ({
    id: `jo-${machineId}`,
    machineId,
    status: 'COMPLETE',
    idealCycleTimeSec,
    actualQtyGood: good,
    actualQtyRejected: rejected,
    plannedStart: from,
    plannedEnd: to,
    actualStart: from,
    actualEnd: to,
    sequenceOrder: 1,
    outputUnit: null,
    workOrderId: `wo-${machineId}`,
    workOrder: { sku: null },
  });

  function build(line: Record<string, unknown>, jobOrders: unknown[]) {
    const prisma = {
      productionLine: { findFirst: jest.fn().mockResolvedValue(line) },
      jobOrder: { findMany: jest.fn().mockResolvedValue(jobOrders) },
      machineStateRecord: { findMany: jest.fn().mockResolvedValue([]) },
      // lineOeeAnalytics loads unplanned downtime to derive the time-based twin (OEE-TB).
      downtimeEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const scheduleKpi = { ratedCapacityByMachine: jest.fn().mockResolvedValue(new Map()) };
    const service = new KpiService(
      prisma as never, new OEEService(), { emit: jest.fn() } as never, scheduleKpi as never,
    
      // The records list delegates to the two engines; nothing in these
      // suites reaches it, so a stub is enough to construct the service.
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
    );
    return { service, prisma, scheduleKpi };
  }

  const machines = [machine('m1', 'Powder Filler', 1), machine('m2', 'Carton Packer', 2), machine('m3', 'Palletizer', 3)];

  // ─────────────────────────────────────────────────────────────
  describe('method selection', () => {
    it('uses ROLLUP by default and labels it', async () => {
      const { service } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'ROLLUP', bottleneckMachineId: null, outfeedMachineIds: [], machines },
        [jo('m1', 900, 100), jo('m2', 950, 50)],
      );

      const r = await service.lineOeeAnalytics(factoryId, 'l1', from, to);

      expect(r!.basis.method).toBe('ROLLUP');
      expect(r!.basis.formula).toContain('NOT an average of machine percentages');
      // Every machine contributes — the rollup is over all of them.
      expect(r!.machines).toHaveLength(3);
      expect(r!.machines.every((m) => m.isBottleneck === false)).toBe(true);
    });

    it('does not consult routing capacity at all in ROLLUP mode', async () => {
      const { service, scheduleKpi } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'ROLLUP', bottleneckMachineId: null, outfeedMachineIds: [], machines },
        [jo('m1', 100, 0)],
      );

      await service.lineOeeAnalytics(factoryId, 'l1', from, to);
      expect(scheduleKpi.ratedCapacityByMachine).not.toHaveBeenCalled();
    });

    it('switches to the bottleneck formula when the line is set to BOTTLENECK', async () => {
      const { service } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'BOTTLENECK', bottleneckMachineId: 'm1', outfeedMachineIds: ['m3'], machines },
        [jo('m1', 1000, 0), jo('m3', 900, 100)],
      );

      const r = await service.lineOeeAnalytics(factoryId, 'l1', from, to);
      if (!r || r.basis.method !== 'BOTTLENECK') throw new Error('expected BOTTLENECK result');

      expect(r.basis.method).toBe('BOTTLENECK');
      expect(r.basis.bottleneckMachineName).toBe('Powder Filler');
      expect(r.basis.bottleneckResolvedBy).toBe('CONFIGURED');
      // Quality comes from the palletizer only: 900 good of 1000.
      expect(r!.quality).toBe(90);
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('bottleneck is a single machine', () => {
    it('marks exactly one machine as the bottleneck', async () => {
      const { service } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'BOTTLENECK', bottleneckMachineId: 'm2', outfeedMachineIds: [], machines },
        [jo('m1', 500, 0), jo('m2', 500, 0), jo('m3', 500, 0)],
      );

      const r = await service.lineOeeAnalytics(factoryId, 'l1', from, to);
      expect(r!.machines.filter((m) => m.isBottleneck)).toHaveLength(1);
      expect(r!.machines.find((m) => m.isBottleneck)!.name).toBe('Carton Packer');
    });

    it('falls back to the slowest routing cycle time and says so', async () => {
      const { service, scheduleKpi } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'BOTTLENECK', bottleneckMachineId: null, outfeedMachineIds: [], machines },
        [jo('m1', 100, 0), jo('m3', 100, 0)],
      );
      scheduleKpi.ratedCapacityByMachine.mockResolvedValue(new Map([
        ['m1', { machineId: 'm1', unitsPerHour: 1800 }],
        ['m3', { machineId: 'm3', unitsPerHour: 600 }], // slowest → the constraint
      ]));

      const r = await service.lineOeeAnalytics(factoryId, 'l1', from, to);
      if (!r || r.basis.method !== 'BOTTLENECK') throw new Error('expected BOTTLENECK result');
      expect(r.basis.bottleneckResolvedBy).toBe('SLOWEST_ROUTING_CYCLE_TIME');
      expect(r.basis.bottleneckMachineName).toBe('Palletizer');
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('final outfeed accepts several machines', () => {
    it('pools quality across every nominated outfeed', async () => {
      // Two parallel palletizers: 900/1000 and 700/1000 → 1600 good of 2000.
      const { service } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'BOTTLENECK', bottleneckMachineId: 'm1', outfeedMachineIds: ['m2', 'm3'], machines },
        [jo('m1', 5000, 0), jo('m2', 900, 100), jo('m3', 700, 300)],
      );

      const r = await service.lineOeeAnalytics(factoryId, 'l1', from, to);
      if (!r || r.basis.method !== 'BOTTLENECK') throw new Error('expected BOTTLENECK result');

      expect(r!.quality).toBe(80); // 1600 / 2000
      expect(r.basis.outfeedResolvedBy).toBe('CONFIGURED');
      expect(r.basis.outfeedMachineNames).toEqual(['Carton Packer', 'Palletizer']);
      expect(r!.machines.filter((m) => m.isOutfeed)).toHaveLength(2);
    });

    it('treats an EMPTY list as every machine on the line', async () => {
      const { service } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'BOTTLENECK', bottleneckMachineId: 'm1', outfeedMachineIds: [], machines },
        [jo('m1', 400, 100), jo('m2', 300, 0), jo('m3', 300, 0)],
      );

      const r = await service.lineOeeAnalytics(factoryId, 'l1', from, to);
      if (!r || r.basis.method !== 'BOTTLENECK') throw new Error('expected BOTTLENECK result');

      expect(r.basis.outfeedResolvedBy).toBe('ALL_MACHINES_ON_LINE');
      expect(r!.machines.every((m) => m.isOutfeed)).toBe(true);
      expect(r.basis.outfeedMachineNames).toHaveLength(3);
    });

    it('ignores a nominated machine that is not on the line', async () => {
      const { service } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'BOTTLENECK', bottleneckMachineId: 'm1', outfeedMachineIds: ['ghost', 'm3'], machines },
        [jo('m1', 100, 0), jo('m3', 90, 10)],
      );

      const r = await service.lineOeeAnalytics(factoryId, 'l1', from, to);
      if (!r || r.basis.method !== 'BOTTLENECK') throw new Error('expected BOTTLENECK result');
      expect(r.basis.outfeedMachineNames).toEqual(['Palletizer']);
      expect(r!.quality).toBe(90);
    });

    it('does not double-count when the bottleneck is also an outfeed', async () => {
      const { service } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'BOTTLENECK', bottleneckMachineId: 'm1', outfeedMachineIds: ['m1'], machines },
        [jo('m1', 800, 200)],
      );

      const r = await service.lineOeeAnalytics(factoryId, 'l1', from, to);
      expect(r!.quality).toBe(80); // 800 of 1000, counted once
    });
  });

  // ─────────────────────────────────────────────────────────────
  describe('guards', () => {
    it('returns null for a line with no active machines', async () => {
      const { service } = build(
        { id: 'l1', name: 'Empty', code: 'PL-09', oeeMethod: 'BOTTLENECK', bottleneckMachineId: null, outfeedMachineIds: [], machines: [] },
        [],
      );
      expect(await service.lineOeeAnalytics(factoryId, 'l1', from, to)).toBeNull();
    });

    it('returns null when the line does not exist', async () => {
      const { service } = build(null as never, []);
      expect(await service.lineOeeAnalytics(factoryId, 'nope', from, to)).toBeNull();
    });

    it('degrades to ROLLUP — and says why — when no constraint can be resolved', async () => {
      // Nothing configured and no routing rates. Returning null would blank the line
      // on the hierarchy tree; showing a real figure labelled with the method that
      // actually produced it is more useful and more honest.
      const { service } = build(
        { id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'BOTTLENECK', bottleneckMachineId: null, outfeedMachineIds: [], machines },
        [jo('m1', 100, 0)],
      );

      const r = await service.lineOeeAnalytics(factoryId, 'l1', from, to);

      expect(r).not.toBeNull();
      expect(r!.method).toBe('ROLLUP');
      expect(r!.basis.method).toBe('ROLLUP');
      expect((r!.basis as { fallbackFrom?: string }).fallbackFrom).toBe('BOTTLENECK');
      expect((r!.basis as { fallbackReason?: string }).fallbackReason).toContain('No bottleneck configured');
    });
  });
});

/**
 * Window clamping — found while verifying real the pilot site data.
 *
 * PPT was clamped to the analysis window but run time was not, so a job order
 * spanning days reported its whole span inside a one-day view. Availability and
 * Performance for short windows were therefore computed over the wrong period.
 */
describe('KpiService window clamping', () => {
  const machine = (id: string, name: string, sortOrder: number) =>
    ({ id, name, code: id.toUpperCase(), sortOrder });

  function build(line: Record<string, unknown>, jobOrders: unknown[]) {
    const prisma = {
      productionLine: { findFirst: jest.fn().mockResolvedValue(line) },
      jobOrder: { findMany: jest.fn().mockResolvedValue(jobOrders) },
      machineStateRecord: { findMany: jest.fn().mockResolvedValue([]) },
      // lineOeeAnalytics loads unplanned downtime to derive the time-based twin (OEE-TB).
      downtimeEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const scheduleKpi = { ratedCapacityByMachine: jest.fn().mockResolvedValue(new Map()) };
    return new KpiService(
      prisma as never, new OEEService(), { emit: jest.fn() } as never, scheduleKpi as never,
    
      // The records list delegates to the two engines; nothing in these
      // suites reaches it, so a stub is enough to construct the service.
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
    );
  }

  it('counts only the in-window part of a job order that spans several days', async () => {
    // Ran 3 full days; we ask for ONE of them.
    const joStart = new Date('2026-08-01T00:00:00Z');
    const joEnd = new Date('2026-08-04T00:00:00Z');
    const winFrom = new Date('2026-08-02T00:00:00Z');
    const winTo = new Date('2026-08-03T00:00:00Z');   // 1440 minutes

    const service = build(
      {
        id: 'l1', name: 'Betti', code: 'PL-01', oeeMethod: 'ROLLUP',
        bottleneckMachineId: null, outfeedMachineIds: [],
        machines: [machine('m1', 'Powder Filler', 1)],
      },
      [{
        id: 'jo-1', machineId: 'm1', status: 'COMPLETE',
        // 1 unit per second: a full in-window day would earn 1440 minutes.
        idealCycleTimeSec: 1,
        actualQtyGood: 86_400, actualQtyRejected: 0,
        plannedStart: joStart, plannedEnd: joEnd,
        actualStart: joStart, actualEnd: joEnd,
        sequenceOrder: 1, outputUnit: null, workOrderId: 'wo-1', workOrder: { sku: null },
      }],
    );

    const r = await service.lineOeeAnalytics('f1', 'l1', winFrom, winTo);

    // 86,400 units × 1 s = 1440 earned minutes against 1440 in-window minutes.
    // Before the fix the denominator was the full 3-day span, giving ~33%.
    expect(r!.performance).toBe(100);
    expect(r!.availability).toBe(100);
  });
});
