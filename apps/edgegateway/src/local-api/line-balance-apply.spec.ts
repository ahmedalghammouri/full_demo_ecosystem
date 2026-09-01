import { LineBalanceService } from './line-balance.service';

/**
 * Writing the correction, and the loop it must not enter.
 *
 * ── The failure this is built around ────────────────────────────────────────
 * The balance reads `actualQtyGood`. Applying a correction CHANGES
 * `actualQtyGood`. Left alone, the second pass reads its own output as
 * production, finds the line balanced, removes the correction — and the third
 * pass puts it back. A number oscillating every fifteen seconds, for no reason
 * visible to anyone watching the screen, and every swing journalled as if it
 * were a real event.
 *
 * The escape is that a balance is only ever computed over what the SENSORS
 * reported: the adjustment is subtracted back out before reconciling, and
 * recomputed from scratch each pass. Which also means the correction converges
 * rather than accumulating — the other way this could quietly inflate a shift.
 *
 * These tests run the apply pass repeatedly and require the second one to be
 * silent.
 */
describe('applying the line balance', () => {
  const I360 = { unitsPerInner: 1, innersPerCarton: 4, cartonsPerPallet: 40, baseUnit: 'CARTON' };

  /**
   * A job-order store that behaves like the database: `actualQtyGood` carries
   * the correction, and the balance has to take it back out to stay stable.
   */
  function build(steps: Array<{ code: string; unit: string; good: number }>, cfg: any[]) {
    const jo: Record<string, { good: number; adj: number }> = {};
    steps.forEach((s, i) => { jo[`jo-${i}`] = { good: s.good, adj: 0 }; });
    const journal: any[] = [];

    const counts: any = {
      balance: async () => [{
        workOrderId: 'wo-1', orderNumber: 'WO-1', skuCode: 'S', skuName: 'S',
        packaging: I360, ladder: { PIECE: 1, INNER: 1, CARTON: 4, PALLET: 160 },
        commonUnit: 'INNER',
        steps: steps.map((s, i) => {
          const mul = s.unit === 'CARTON' ? 4 : s.unit === 'PALLET' ? 160 : 1;
          // The measured figure: what the row holds, less what the balance put there.
          const measured = jo[`jo-${i}`].good - jo[`jo-${i}`].adj;
          return {
            jobOrderId: `jo-${i}`, sequenceOrder: i + 1, operationName: 'Op',
            machineId: s.code, machineCode: s.code, machineName: s.code,
            unit: s.unit, good: measured, reject: 0, total: measured,
            goodCommon: measured * mul, rejectCommon: 0, totalCommon: measured * mul,
            diffFromPrev: null, unconvertible: false,
          };
        }),
      }],
    };

    const prisma: any = {
      lineBalanceConfig: { findMany: async () => cfg },
      jobOrder: {
        findMany: async () => Object.entries(jo).map(([id, v]) => ({ id, balanceAdjGood: v.adj })),
        // Prisma's `update()` returns a LAZY PrismaPromise — nothing reaches the
        // database until the transaction runs it. A double that mutates on the
        // call instead would show an ABORTED transaction's writes as applied,
        // and quietly pass a test about surviving a failed write.
        update: jest.fn(({ where, data }: any) => ({
          __run: () => {
            if (data.actualQtyGood?.increment) jo[where.id].good += data.actualQtyGood.increment;
            if (typeof data.balanceAdjGood === 'number') jo[where.id].adj = data.balanceAdjGood;
          },
        })),
      },
      countAdjustment: { create: jest.fn((a: any) => ({ __run: () => journal.push(a.data) })) },
      $transaction: jest.fn(async (ops: any[]) => ops.map((o) => (o?.__run ? o.__run() : o))),
    };

    const svc = new LineBalanceService(prisma, { getFactoryId: () => 'f1' } as any, counts);
    return { svc, prisma, jo, journal };
  }

  const cfg = (machineId: string, extra: any = {}) => ({
    machineId, enabled: true, isAnchor: false, bufferToNextQty: null, bufferUnit: null,
    transitSec: null, maxCorrectionPct: 10, applyAdjustment: true, ...extra,
  });

  it('writes the correction onto the job order, in that step\'s own unit', async () => {
    // The wrapper counts PALLETS. A -160 inner correction is -1 pallet; writing
    // -160 into a pallet column would be wrong by a factor of 160.
    const { svc, jo } = build(
      [
        { code: 'M3', unit: 'PALLET', good: 10 },
        { code: 'M4', unit: 'PALLET', good: 13 },
      ],
      [cfg('M3', { isAnchor: true, bufferToNextQty: 1, bufferUnit: 'PALLET' }), cfg('M4', { maxCorrectionPct: 100 })],
    );

    await svc.applyBalances();

    // 13 wrapped against 10 palletised, and the palletiser's own figure is the
    // ceiling — a belt between them holds pallets it MADE, so it can only put
    // the wrapper behind, never ahead. Three pallets have no explanation, and
    // -480 inners has to land as -3 here.
    expect(jo['jo-1'].adj).toBe(-3);
    expect(jo['jo-1'].good).toBe(10);
  });

  it('changes nothing on a second pass over an unchanged line', async () => {
    const { svc, prisma, jo } = build(
      [
        { code: 'M1', unit: 'INNER', good: 900 },
        { code: 'M2', unit: 'INNER', good: 1000 },
      ],
      [cfg('M1', { bufferToNextQty: 0, bufferUnit: 'INNER' }), cfg('M2', { isAnchor: true })],
    );

    await svc.applyBalances();
    const afterFirst = { ...jo['jo-0'] };
    const writes = prisma.jobOrder.update.mock.calls.length;

    await svc.applyBalances();
    await svc.applyBalances();

    // The correction stands, and nothing was written to restate it.
    expect(jo['jo-0']).toEqual(afterFirst);
    expect(prisma.jobOrder.update.mock.calls.length).toBe(writes);
  });

  it('does not read its own correction as production', async () => {
    // The oscillation, stated directly: after applying, the measured figure is
    // still 900 and the correction is still the same 90 — not zero, and not 180.
    const { svc, jo } = build(
      [
        { code: 'M1', unit: 'INNER', good: 900 },
        { code: 'M2', unit: 'INNER', good: 1000 },
      ],
      [cfg('M1', { bufferToNextQty: 0, bufferUnit: 'INNER' }), cfg('M2', { isAnchor: true })],
    );

    await svc.applyBalances();
    expect(jo['jo-0'].adj).toBe(90);          // 10% ceiling on 900

    for (let i = 0; i < 5; i += 1) await svc.applyBalances();
    expect(jo['jo-0'].adj).toBe(90);          // not 0, not 450
    expect(jo['jo-0'].good).toBe(990);
  });

  it('follows the counters as they move, without accumulating', async () => {
    const { svc, jo } = build(
      [
        { code: 'M1', unit: 'INNER', good: 900 },
        { code: 'M2', unit: 'INNER', good: 1000 },
      ],
      [cfg('M1', { bufferToNextQty: 0, bufferUnit: 'INNER' }), cfg('M2', { isAnchor: true })],
    );
    await svc.applyBalances();
    expect(jo['jo-0'].adj).toBe(90);

    // The line keeps running: both counters advance, the gap widens.
    jo['jo-0'].good += 100;                   // measured 1000
    jo['jo-1'].good += 200;                   // measured 1200
    await svc.applyBalances();

    // 200 short, ceiling 10% of 1000 → 100. Replaces the 90; does not add to it.
    expect(jo['jo-0'].adj).toBe(100);
  });

  it('leaves a machine alone when apply is off for it', async () => {
    const { svc, jo, prisma } = build(
      [
        { code: 'M1', unit: 'INNER', good: 900 },
        { code: 'M2', unit: 'INNER', good: 1000 },
      ],
      [
        cfg('M1', { bufferToNextQty: 0, bufferUnit: 'INNER', applyAdjustment: false }),
        cfg('M2', { isAnchor: true }),
      ],
    );

    await svc.applyBalances();

    expect(jo['jo-0'].adj).toBe(0);
    expect(prisma.jobOrder.update).not.toHaveBeenCalled();
  });

  it('journals every correction with what it wanted and whether it was capped', async () => {
    const { svc, journal } = build(
      [
        { code: 'M1', unit: 'INNER', good: 1000 },
        { code: 'M2', unit: 'INNER', good: 1500 },
      ],
      [cfg('M1', { bufferToNextQty: 0, bufferUnit: 'INNER' }), cfg('M2', { isAnchor: true })],
    );

    await svc.applyBalances();

    expect(journal).toHaveLength(1);
    // Applied 100 of the 500 it asked for, and said so. This row is what makes
    // a balanced number reducible to a measurement.
    expect(journal[0].adjGood).toBe(100);
    expect(journal[0].requestedGood).toBe(500);
    expect(journal[0].clamped).toBe(true);
    expect(journal[0].countedGood).toBe(1000);
    expect(journal[0].anchorMachineId).toBe('M2');
  });

  it('re-offers the correction when the write fails', async () => {
    const { svc, prisma, jo } = build(
      [
        { code: 'M1', unit: 'INNER', good: 900 },
        { code: 'M2', unit: 'INNER', good: 1000 },
      ],
      [cfg('M1', { bufferToNextQty: 0, bufferUnit: 'INNER' }), cfg('M2', { isAnchor: true })],
    );

    const ok = prisma.$transaction;
    prisma.$transaction = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    await svc.applyBalances();
    expect(jo['jo-0'].adj).toBe(0);

    prisma.$transaction = ok;
    await svc.applyBalances();
    expect(jo['jo-0'].adj).toBe(90);
  });

  it('never writes a fraction of a pallet', async () => {
    // Found by running it: the wrapper came out with balanceAdjGood = +0.7.
    // The balance works in the line's SMALLEST unit, where its answer is exact —
    // and converting that back into pallets or cartons lands between two whole
    // numbers. A fractional count is not a small inaccuracy; it is a quantity
    // that cannot exist, and it would be carried into every report downstream.
    const { svc, jo, journal } = build(
      [
        { code: 'M3', unit: 'PALLET', good: 10 },
        { code: 'M4', unit: 'PALLET', good: 12 },
      ],
      [
        cfg('M3', { isAnchor: true, bufferToNextQty: 1, bufferUnit: 'PALLET' }),
        cfg('M4', { maxCorrectionPct: 5 }),
      ],
    );

    await svc.applyBalances();

    // It wants +1 pallet; the 10% ceiling on 7 allows only 0.7 of one. Truncated
    // to zero — the correction waits until it is a whole pallet rather than
    // booking part of one.
    expect(jo['jo-1'].adj).toBe(0);
    expect(Number.isInteger(jo['jo-1'].good)).toBe(true);
    expect(journal).toHaveLength(0);
  });

  it('applies the correction once it amounts to a whole unit', async () => {
    // Same line, further into the shift: 10% of 40 pallets is 4, so the single
    // pallet it is short by is now well inside the ceiling.
    const { svc, jo } = build(
      [
        { code: 'M3', unit: 'PALLET', good: 10 },
        { code: 'M4', unit: 'PALLET', good: 12 },
      ],
      [
        cfg('M3', { isAnchor: true, bufferToNextQty: 1, bufferUnit: 'PALLET' }),
        cfg('M4', { maxCorrectionPct: 20 }),
      ],
    );

    await svc.applyBalances();

    expect(jo['jo-1'].adj).toBe(-2);
    expect(jo['jo-1'].good).toBe(10);
  });
});
