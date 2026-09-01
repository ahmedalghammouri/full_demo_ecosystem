import { ScheduleKpiService } from './schedule-kpi.service';

/**
 * MSA and volume capacity utilization — the pilot site PoC items 14–17, using the formulas
 * the pilot site supplied verbatim.
 */
describe('ScheduleKpiService', () => {
  const factoryId = 'f1';
  const from = new Date('2026-08-01T00:00:00Z');
  const to = new Date('2026-08-31T00:00:00Z'); // exactly 30 days = 720 h

  function build(
    orders: unknown[] = [],
    machines: unknown[] = [],
    producedRows: unknown[] = [],
    routingSteps: unknown[] = [],
  ) {
    const prisma = {
      productionOrder: { findMany: jest.fn().mockResolvedValue(orders) },
      machine: { findMany: jest.fn().mockResolvedValue(machines) },
      // Actual output comes from the per-minute fact store, already in PIECES and
      // already clamped to the window — see the comment in volumeCapacityUtilization
      // for why the cumulative JobOrder counter could not be used.
      $queryRaw: jest.fn().mockResolvedValue(producedRows),
      jobOrder: { findMany: jest.fn().mockResolvedValue([]) },
      routingStep: { findMany: jest.fn().mockResolvedValue(routingSteps) },
    };
    return { service: new ScheduleKpiService(prisma as never), prisma };
  }

  /** A fact-store output row as the capacity reader sees it (pieces, in-window). */
  const produced = (machineId: string, pieces: number) => ({ machineId, pieces });

  /**
   * A routing step as the capacity resolver reads it. `cycleTimeSec` is seconds per
   * ONE out-unit; with no SKU packaging the out-unit IS the base unit, so
   * units/hour = 3600 / cycleTimeSec.
   */
  const step = (
    machineId: string | null,
    cycleTimeSec: number | null,
    extra: Partial<{ outUnit: string | null; sku: unknown; machineOptions: unknown[]; stepNumber: number }> = {},
  ) => ({
    id: `step-${machineId}-${cycleTimeSec}`,
    stepNumber: extra.stepNumber ?? 1,
    operationName: 'Filling',
    cycleTimeSec,
    outUnit: extra.outUnit ?? null,
    machineId,
    process: { id: 'proc-1', name: 'Process v1.0', sku: extra.sku ?? null },
    machineOptions: extra.machineOptions ?? [],
  });

  const order = (n: string, targetQty: number, completedQty: number) => ({
    id: `po-${n}`, orderNumber: n, targetQty, completedQty, status: 'COMPLETED', sku: { name: 'SKU-A', code: 'A' },
  });

  describe('masterScheduleAttainment', () => {
    it('credits each order at most its scheduled quantity', async () => {
      // 800/1000 short, 1500/1000 over. Naive total would be 2300/2000 = 115%.
      // The min() caps the over-produced order at its schedule → 1800/2000 = 90%.
      const { service } = build([order('PO-1', 1000, 800), order('PO-2', 1000, 1500)]);
      const r = await service.masterScheduleAttainment(factoryId, from, to);

      expect(r.totalScheduledQty).toBe(2000);
      expect(r.totalActualQty).toBe(2300);
      expect(r.totalCreditedQty).toBe(1800);
      expect(r.msaPct).toBe(90);
    });

    it('reports 100% only when every order met its plan', async () => {
      const { service } = build([order('PO-1', 500, 500), order('PO-2', 700, 900)]);
      const r = await service.masterScheduleAttainment(factoryId, from, to);
      expect(r.msaPct).toBe(100);
    });

    it('exposes the per-order lines behind the figure', async () => {
      const { service } = build([order('PO-1', 1000, 250)]);
      const r = await service.masterScheduleAttainment(factoryId, from, to);

      expect(r.lines).toHaveLength(1);
      expect(r.lines[0]).toMatchObject({
        orderNumber: 'PO-1', scheduledQty: 1000, actualQty: 250, creditedQty: 250, attainmentPct: 25,
      });
    });

    it('excludes cancelled orders from both sides', async () => {
      const { service, prisma } = build([]);
      await service.masterScheduleAttainment(factoryId, from, to);
      expect(prisma.productionOrder.findMany.mock.calls[0][0].where.status).toEqual({ not: 'CANCELLED' });
    });

    it('scopes by planned window overlap, not by actual execution', async () => {
      const { service, prisma } = build([]);
      await service.masterScheduleAttainment(factoryId, from, to);
      const where = prisma.productionOrder.findMany.mock.calls[0][0].where;
      expect(where.plannedStart).toEqual({ lte: to });
      expect(where.plannedEnd).toEqual({ gte: from });
    });

    it('returns 0 rather than NaN when nothing was scheduled', async () => {
      const { service } = build([]);
      const r = await service.masterScheduleAttainment(factoryId, from, to);
      expect(r.msaPct).toBe(0);
      expect(r.orderCount).toBe(0);
    });
  });

  /**
   * Rated capacity is derived from the ROUTING STEP cycle time — the same master data
   * that generates job orders — so there is no separate capacity field to drift.
   */
  describe('ratedCapacityByMachine', () => {
    it('derives units/hour from the step cycle time', async () => {
      // 2 s per out-unit → 1,800 units/hour.
      const { service } = build([], [], [], [step('m1', 2)]);
      const rated = await service.ratedCapacityByMachine(factoryId, ['m1']);

      expect(rated.get('m1')!.unitsPerHour).toBe(1800);
      expect(rated.get('m1')!.cycleTimeSec).toBe(2);
      expect(rated.get('m1')!.operationName).toBe('Filling');
      expect(rated.get('m1')!.machineOverride).toBe(false);
    });

    it('converts the step out-unit to PIECES', async () => {
      // 2 s per CARTON → 1,800 cartons/h. 1 carton = 12 inners × 1 piece = 12 pieces
      // → 21,600 pieces/h.
      const sku = { baseUnit: 'INNER', unitsPerInner: 1, innersPerCarton: 12, cartonsPerPallet: 40 };
      const { service } = build([], [], [], [step('m1', 2, { outUnit: 'CARTON', sku })]);
      const rated = await service.ratedCapacityByMachine(factoryId, ['m1']);

      expect(rated.get('m1')!.unitsPerHour).toBe(21_600);
    });

    it('is expressed in PIECES, not the SKU base unit', async () => {
      // baseUnit CARTON would give 1,800/h; pieces gives 1,800 × 24 = 43,200/h.
      // The distinction matters: the actual output this rate is divided into is
      // also totalled in pieces, and baseUnit varies per SKU so it cannot give a
      // consistent cross-product denominator.
      const sku = { baseUnit: 'CARTON', unitsPerInner: 6, innersPerCarton: 4, cartonsPerPallet: 40 };
      const { service } = build([], [], [], [step('m1', 2, { outUnit: 'CARTON', sku })]);
      const rated = await service.ratedCapacityByMachine(factoryId, ['m1']);

      expect(rated.get('m1')!.unitsPerHour).toBe(43_200);
    });

    it('lets a machine-specific cycle time override the step default', async () => {
      const { service } = build([], [], [], [
        step('m1', 2, { machineOptions: [{ machineId: 'm2', cycleTimeSec: 4 }] }),
      ]);
      const rated = await service.ratedCapacityByMachine(factoryId, ['m1', 'm2']);

      expect(rated.get('m1')!.unitsPerHour).toBe(1800); // 3600/2
      expect(rated.get('m2')!.unitsPerHour).toBe(900);  // 3600/4 — the override
      expect(rated.get('m2')!.machineOverride).toBe(true);
    });

    it('falls back to the step rate for an alternative machine with no override', async () => {
      const { service } = build([], [], [], [
        step('m1', 3, { machineOptions: [{ machineId: 'm2', cycleTimeSec: null }] }),
      ]);
      const rated = await service.ratedCapacityByMachine(factoryId, ['m2']);

      expect(rated.get('m2')!.unitsPerHour).toBe(1200); // 3600/3
      expect(rated.get('m2')!.machineOverride).toBe(false);
    });

    it('keeps the SLOWEST rate when several routings cover the same machine', async () => {
      // Capacity utilization must not be flattered by the machine's easiest product.
      const { service } = build([], [], [], [
        step('m1', 2, { stepNumber: 1 }),
        step('m1', 6, { stepNumber: 2 }),
      ]);
      const rated = await service.ratedCapacityByMachine(factoryId, ['m1']);

      expect(rated.get('m1')!.unitsPerHour).toBe(600); // 3600/6, not 3600/2
    });

    it('ignores steps with a missing or zero cycle time', async () => {
      const { service } = build([], [], [], [step('m1', null), step('m2', 0)]);
      const rated = await service.ratedCapacityByMachine(factoryId, ['m1', 'm2']);
      expect(rated.size).toBe(0);
    });

    it('only considers active processes', async () => {
      const { service, prisma } = build([], [], [], []);
      await service.ratedCapacityByMachine(factoryId, ['m1']);
      expect(prisma.routingStep.findMany.mock.calls[0][0].where.process.isActive).toBe(true);
    });
  });

  describe('volumeCapacityUtilization', () => {
    const machine = (id: string) => ({ id, name: `M-${id}`, code: id.toUpperCase() });

    it('divides actual output by the routing-derived rate × window hours', async () => {
      // 36 s/unit → 100 units/h × 720 h = 72,000. 18,000 produced = 25%.
      const { service } = build(
        [], [machine('m1')],
        [produced('m1', 18_000)],
        [step('m1', 36)],
      );
      const r = await service.volumeCapacityUtilization(factoryId, from, to);

      expect(r.windowHours).toBe(720);
      expect(r.maxDesignedUnits).toBe(72_000);
      expect(r.actualUnits).toBe(18_000);
      expect(r.utilizationPct).toBe(25);
    });

    it('measures output over the SAME window as the capacity it is divided by', async () => {
      // The defect this pins: actual output was read from JobOrder.actualQtyGood, a
      // CUMULATIVE lifetime counter, while the denominator was built from the window's
      // hours. With job orders open for 230 hours the card read 760% for a window of a
      // few hours. Both sides must describe the same period or the ratio means nothing.
      const { service, prisma } = build([], [machine('m1')], [produced('m1', 18_000)], [step('m1', 36)]);
      await service.volumeCapacityUtilization(factoryId, from, to);

      // The output query is bounded by the requested window on both ends...
      const sql = JSON.stringify(prisma.$queryRaw.mock.calls[0][0]);
      expect(sql).toContain(from.toISOString());
      expect(sql).toContain(to.toISOString());
      // ...and the cumulative job-order counter is not consulted at all.
      expect(prisma.jobOrder.findMany).not.toHaveBeenCalled();
    });

    it('sums the denominator across machines in scope', async () => {
      const { service } = build(
        [], [machine('m1'), machine('m2')],
        [produced('m1', 36_000), produced('m2', 18_000)],
        [step('m1', 36, { stepNumber: 1 }), step('m2', 72, { stepNumber: 2 })],
      );
      const r = await service.volumeCapacityUtilization(factoryId, from, to);

      expect(r.maxDesignedUnits).toBe(108_000); // (100 + 50) × 720
      expect(r.actualUnits).toBe(54_000);
      expect(r.utilizationPct).toBe(50);
    });

    it('flags machines absent from any routing instead of silently skewing the result', async () => {
      const { service } = build(
        [], [machine('m1'), machine('m2')],
        [produced('m1', 7_200)],
        [step('m1', 36)],
      );
      const r = await service.volumeCapacityUtilization(factoryId, from, to);

      expect(r.machinesMissingCapacity).toHaveLength(1);
      expect(r.machinesMissingCapacity[0].id).toBe('m2');
      expect(r.machinesMissingCapacity[0].reason).toContain('routing step');
      expect(r.maxDesignedUnits).toBe(72_000); // only m1 contributes
    });

    it('traces each rate back to the routing step it came from', async () => {
      const { service } = build([], [machine('m1')], [], [step('m1', 36)]);
      const r = await service.volumeCapacityUtilization(factoryId, from, to);

      const m1 = r.byMachine.find((m) => m.machineId === 'm1')!;
      expect(m1.ratedUnitsPerHour).toBe(100);
      expect(m1.ratedFrom).toMatchObject({
        processName: 'Process v1.0', operationName: 'Filling', cycleTimeSec: 36, stepNumber: 1,
      });
    });

    it('returns null utilization for a machine with no routing rate', async () => {
      const { service } = build([], [machine('m1'), machine('m2')], [], [step('m1', 36)]);
      const r = await service.volumeCapacityUtilization(factoryId, from, to);

      const m2 = r.byMachine.find((m) => m.machineId === 'm2')!;
      expect(m2.utilizationPct).toBeNull();
      expect(m2.ratedFrom).toBeNull();
      expect(m2.maxDesignedUnits).toBe(0);
    });

    it('returns 0 rather than NaN when no routing rate resolves at all', async () => {
      const { service } = build([], [machine('m1')], [], []);
      const r = await service.volumeCapacityUtilization(factoryId, from, to);
      expect(r.utilizationPct).toBe(0);
    });

    it('carries the capacity basis so the number is self-documenting', async () => {
      const { service } = build([], [machine('m1')], [], [step('m1', 36)]);
      const r = await service.volumeCapacityUtilization(factoryId, from, to);

      expect(r.method.formula).toContain('Maximum Designed Unit Capacity');
      expect(r.method.capacityBasis).toContain('routing step cycle time');
      expect(r.method.capacityBasis).toContain('same master data that generates job orders');
    });
  });
});
