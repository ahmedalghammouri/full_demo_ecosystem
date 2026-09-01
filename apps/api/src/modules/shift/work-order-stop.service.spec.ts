import { WorkOrderStopService } from './work-order-stop.service';

/**
 * Changeover is the largest controllable loss on a packing line, and the only
 * way it stays traceable is if the system can tell the three cases apart: a real
 * product change, another order for the same product, and a cold start with
 * nothing to change from.
 *
 * Booking a full changeover on a cold start is the failure that matters — it
 * invents loss every single morning, on every machine, for ever.
 */
describe('WorkOrderStopService — triggers', () => {
  const RULE = {
    id: 'r1', code: 'CO-30', name: 'Changeover', trigger: 'PRODUCT_CHANGE',
    durationMinutes: 30, causeId: null, category: 'CHANGEOVER',
    affectsOEE: true, isPlanned: true,
    lineId: null, machineId: null, skuId: null,
  };

  function build(opts: {
    rules?: any[];
    currentSku?: string | null;
    currentWo?: string;
    previous?: { workOrder: { id: string; skuId: string | null } } | null;
    existingEvent?: boolean;
  } = {}) {
    const created: any[] = [];
    const prisma: any = {
      workOrderStopRule: { findMany: jest.fn().mockResolvedValue(opts.rules ?? [RULE]) },
      jobOrder: {
        findUnique: jest.fn().mockResolvedValue({
          workOrder: { id: opts.currentWo ?? 'wo-2', skuId: opts.currentSku ?? 'sku-B', lineId: 'line-1' },
        }),
        findFirst: jest.fn().mockResolvedValue(opts.previous === undefined
          ? { workOrder: { id: 'wo-1', skuId: 'sku-A' } }
          : opts.previous),
      },
      downtimeEvent: {
        findFirst: jest.fn().mockResolvedValue(opts.existingEvent ? { id: 'e1' } : null),
        create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'new' }; }),
      },
    };
    const svc = new WorkOrderStopService(prisma as never);
    const run = () => svc.applyOnJobOrderStart('f1', {
      id: 'jo-1', machineId: 'm3', workOrderId: 'wo-2', startedAt: new Date('2026-08-15T08:00:00Z'),
    });
    return { run, created, prisma };
  }

  describe('PRODUCT_CHANGE', () => {
    it('fires when the SKU differs from the previous order', async () => {
      const { run, created } = build();
      const applied = await run();
      expect(applied).toEqual([{ ruleCode: 'CO-30', minutes: 30 }]);
      expect(created).toHaveLength(1);
      expect(created[0].durationMinutes).toBe(30);
      expect(created[0].affectsOEE).toBe(true); // planned, but still a loss
      expect(created[0].isPlanned).toBe(true);
    });

    it('does not fire for another order of the SAME product', async () => {
      const { run, created } = build({
        currentSku: 'sku-A',
        previous: { workOrder: { id: 'wo-1', skuId: 'sku-A' } },
      });
      expect(await run()).toEqual([]);
      expect(created).toHaveLength(0);
    });

    it('does not fire on a cold start', async () => {
      // Nothing ran here before, so there is nothing to change FROM. Booking a
      // changeover here would invent loss every morning on every machine.
      const { run, created } = build({ previous: null });
      expect(await run()).toEqual([]);
      expect(created).toHaveLength(0);
    });
  });

  describe('ORDER_CHANGE', () => {
    it('fires for a different order even with the same product', async () => {
      const { run, created } = build({
        rules: [{ ...RULE, trigger: 'ORDER_CHANGE' }],
        currentSku: 'sku-A',
        currentWo: 'wo-2',
        previous: { workOrder: { id: 'wo-1', skuId: 'sku-A' } },
      });
      expect(await run()).toHaveLength(1);
      expect(created).toHaveLength(1);
    });

    it('does not fire when it is the same order resuming', async () => {
      const { run, created } = build({
        rules: [{ ...RULE, trigger: 'ORDER_CHANGE' }],
        currentWo: 'wo-1',
        previous: { workOrder: { id: 'wo-1', skuId: 'sku-A' } },
      });
      expect(await run()).toEqual([]);
      expect(created).toHaveLength(0);
    });

    it('fires on a cold start — the first order IS a change of order', async () => {
      const { run } = build({ rules: [{ ...RULE, trigger: 'ORDER_CHANGE' }], previous: null });
      expect(await run()).toHaveLength(1);
    });
  });

  describe('ALWAYS', () => {
    it('fires unconditionally, same product and same order included', async () => {
      const { run } = build({
        rules: [{ ...RULE, trigger: 'ALWAYS' }],
        currentSku: 'sku-A', currentWo: 'wo-1',
        previous: { workOrder: { id: 'wo-1', skuId: 'sku-A' } },
      });
      expect(await run()).toHaveLength(1);
    });
  });

  describe('narrowing', () => {
    it('ignores a rule scoped to a different machine', async () => {
      const { run, created } = build({ rules: [{ ...RULE, machineId: 'm9' }] });
      expect(await run()).toEqual([]);
      expect(created).toHaveLength(0);
    });

    it('ignores a rule scoped to a different line', async () => {
      const { run } = build({ rules: [{ ...RULE, lineId: 'line-9' }] });
      expect(await run()).toEqual([]);
    });

    it('ignores a rule scoped to a different SKU', async () => {
      const { run } = build({ rules: [{ ...RULE, skuId: 'sku-Z' }] });
      expect(await run()).toEqual([]);
    });

    it('applies a rule scoped to this machine', async () => {
      const { run } = build({ rules: [{ ...RULE, machineId: 'm3' }] });
      expect(await run()).toHaveLength(1);
    });
  });

  it('books the stop BEFORE the order starts, not out of the middle of the run', async () => {
    const { run, created } = build();
    await run();
    const start = created[0].startTime as Date;
    const end = created[0].endTime as Date;
    expect(end.toISOString()).toBe('2026-08-15T08:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 60_000).toBe(30);
  });

  it('does not book the same stop twice for one job order', async () => {
    // A retried start must not remove another 30 minutes from production on paper.
    const { run, created } = build({ existingEvent: true });
    expect(await run()).toEqual([]);
    expect(created).toHaveLength(0);
  });

  it('does nothing for a job order with no machine', async () => {
    const prisma: any = { workOrderStopRule: { findMany: jest.fn() } };
    const svc = new WorkOrderStopService(prisma as never);
    expect(await svc.applyOnJobOrderStart('f1', { id: 'jo', machineId: null, workOrderId: 'wo' })).toEqual([]);
    expect(prisma.workOrderStopRule.findMany).not.toHaveBeenCalled();
  });

  it('records the job order on the event so the stop is traceable', async () => {
    const { run, created } = build();
    await run();
    expect(created[0].jobOrderId).toBe('jo-1');
    expect(created[0].workOrderId).toBe('wo-2');
    expect(created[0].notes).toContain('CO-30');
  });
});
