import { CountBalanceService } from './count-balance.service';

/**
 * Comparing machines that count in different units.
 *
 * ── Why this is worth a test ────────────────────────────────────────────────
 * On SDPF's line the filler counts inners, the cartoner counts cartons and the
 * palletiser counts pallets. Read off their panels the numbers are 1280, 356
 * and 10, which look like three unrelated facts. Through the product's ladder
 * they are 1280, 1424 and 1600 inners of the same material — and now they can
 * be subtracted from each other, which is the whole point: a counter that is
 * missing pulses shows up as a machine reporting less than the one that fed it.
 *
 * The failure mode this guards is silent. Get a conversion wrong and every
 * number still renders, still looks plausible, and quietly accuses the wrong
 * machine. So the ladder arithmetic is pinned against numbers checked by hand.
 */
describe('count balance across a line', () => {
  /** The real I360 ladder: 1 CARTON = 4 INNER, 1 PALLET = 40 CARTON = 160 INNER. */
  const SKU = {
    code: '10310191', name: 'GENTO Powder Detergent',
    baseUnit: 'CARTON', unitsPerInner: 1, innersPerCarton: 4, cartonsPerPallet: 40,
  };

  function build(steps: Array<Partial<Record<string, unknown>>>) {
    const jobs = steps.map((s, i) => ({
      id: `jo-${i + 1}`,
      workOrderId: 'wo-1',
      sequenceOrder: i + 1,
      operationName: 'Op',
      machineId: `m${i + 1}`,
      outputUnit: 'INNER',
      actualQtyGood: 0,
      actualQtyRejected: 0,
      machine: { code: `M${i + 1}`, name: `Machine ${i + 1}` },
      workOrder: { orderNumber: 'WO-2026-0001', sku: SKU },
      ...s,
    }));
    const prisma: any = { jobOrder: { findMany: jest.fn(async () => jobs) } };
    const ctx: any = { getFactoryId: () => 'f1' };
    return new CountBalanceService(prisma, ctx);
  }

  it('converts every step onto one unit before comparing', async () => {
    const svc = build([
      { outputUnit: 'INNER', actualQtyGood: 1280, actualQtyRejected: 1 },
      { outputUnit: 'CARTON', actualQtyGood: 356 },
      { outputUnit: 'PALLET', actualQtyGood: 10 },
    ]);
    const [run] = await svc.balance();

    // The smallest rung anything on this line counts in, so no conversion divides.
    expect(run.commonUnit).toBe('INNER');
    expect(run.ladder).toEqual({ PIECE: 1, INNER: 1, CARTON: 4, PALLET: 160 });

    // 356 cartons IS 1424 inners; 10 pallets IS 1600. Checked by hand.
    expect(run.steps.map((s) => s.goodCommon)).toEqual([1280, 1424, 1600]);

    // And each machine's own number is kept beside it — that is what its panel
    // shows, and a technician standing at the line compares against that.
    expect(run.steps.map((s) => `${s.good} ${s.unit}`))
      .toEqual(['1280 INNER', '356 CARTON', '10 PALLET']);
  });

  it('subtracts what came out of one machine from what the next handled', async () => {
    const svc = build([
      { outputUnit: 'INNER', actualQtyGood: 1280, actualQtyRejected: 1 },
      { outputUnit: 'CARTON', actualQtyGood: 356 },
      { outputUnit: 'PALLET', actualQtyGood: 10 },
    ]);
    const [run] = await svc.balance();

    // Nothing upstream of the first step, so there is nothing to compare it to —
    // null, not zero, because zero would read as a balanced line.
    expect(run.steps[0].diffFromPrev).toBeNull();
    expect(run.steps[1].diffFromPrev).toBe(1280 - 1424); // -144
    expect(run.steps[2].diffFromPrev).toBe(1424 - 1600); // -176
  });

  it('measures against GOOD upstream and TOTAL here', async () => {
    // A rejected unit was still made by the machine before, and still passed
    // through this one. Comparing good-to-good would hide scrap; comparing
    // total-to-total would count a reject as if it had been fed onward.
    const svc = build([
      { outputUnit: 'INNER', actualQtyGood: 100, actualQtyRejected: 10 },
      { outputUnit: 'INNER', actualQtyGood: 90, actualQtyRejected: 10 },
    ]);
    const [run] = await svc.balance();

    expect(run.steps[0].goodCommon).toBe(100);
    expect(run.steps[1].totalCommon).toBe(100);
    expect(run.steps[1].diffFromPrev).toBe(0); // balanced
  });

  it('orders by routing sequence, not by however the rows arrive', async () => {
    const svc = build([
      { sequenceOrder: 3, outputUnit: 'PALLET', actualQtyGood: 10, machine: { code: 'M3', name: 'c' } },
      { sequenceOrder: 1, outputUnit: 'INNER', actualQtyGood: 1600, machine: { code: 'M1', name: 'a' } },
      { sequenceOrder: 2, outputUnit: 'CARTON', actualQtyGood: 400, machine: { code: 'M2', name: 'b' } },
    ]);
    const [run] = await svc.balance();

    // "The machine before it" is defined by the routing. Comparing a step with
    // whichever row the database happened to return first is meaningless.
    expect(run.steps.map((s) => s.machineCode)).toEqual(['M1', 'M2', 'M3']);
    expect(run.steps[1].diffFromPrev).toBe(0);
    expect(run.steps[2].diffFromPrev).toBe(0);
  });

  it('refuses to convert a unit that is not on the ladder', async () => {
    const svc = build([
      { outputUnit: 'INNER', actualQtyGood: 1000 },
      { outputUnit: 'KG', actualQtyGood: 250 },
      { outputUnit: 'CARTON', actualQtyGood: 250 },
    ]);
    const [run] = await svc.balance();

    // KG is not a rung. Converting it as though it were pieces would produce a
    // confident, wrong comparison — so it is flagged and left out of the chain.
    expect(run.steps[1].unconvertible).toBe(true);
    expect(run.steps[1].diffFromPrev).toBeNull();

    // And the step after it is compared against the last step that COULD be
    // converted, so one off-ladder unit does not break the rest of the line.
    expect(run.steps[2].totalCommon).toBe(1000);
    expect(run.steps[2].diffFromPrev).toBe(0);
  });

  it('keeps separate work orders apart', async () => {
    const jobs = [
      { id: 'a1', workOrderId: 'wo-1', sequenceOrder: 1, operationName: 'Op', machineId: 'm1',
        outputUnit: 'INNER', actualQtyGood: 100, actualQtyRejected: 0,
        machine: { code: 'M1', name: 'a' }, workOrder: { orderNumber: 'WO-1', sku: SKU } },
      { id: 'b1', workOrderId: 'wo-2', sequenceOrder: 1, operationName: 'Op', machineId: 'm1',
        outputUnit: 'INNER', actualQtyGood: 900, actualQtyRejected: 0,
        machine: { code: 'M1', name: 'a' }, workOrder: { orderNumber: 'WO-2', sku: SKU } },
    ];
    const prisma: any = { jobOrder: { findMany: jest.fn(async () => jobs) } };
    const runs = await new CountBalanceService(prisma, { getFactoryId: () => 'f1' } as any).balance();

    // Two orders running at once must not be chained into one false balance.
    expect(runs).toHaveLength(2);
    expect(runs.every((r) => r.steps.length === 1)).toBe(true);
  });

  it('survives a product with no packaging set', async () => {
    // A missing ladder must not collapse every quantity to zero — the defect
    // that makes a whole line read as producing nothing.
    const jobs = [{
      id: 'x', workOrderId: 'wo-1', sequenceOrder: 1, operationName: 'Op', machineId: 'm1',
      outputUnit: 'CARTON', actualQtyGood: 50, actualQtyRejected: 0,
      machine: { code: 'M1', name: 'a' }, workOrder: { orderNumber: 'WO-1', sku: null },
    }];
    const prisma: any = { jobOrder: { findMany: jest.fn(async () => jobs) } };
    const [run] = await new CountBalanceService(prisma, { getFactoryId: () => 'f1' } as any).balance();

    expect(run.steps[0].goodCommon).toBe(50);
  });
});
