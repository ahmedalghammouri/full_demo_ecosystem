/**
 * A corrected count must survive the gateway's next flush.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 * The gateway re-derives rejected on EVERY flush, absolutely:
 *
 *     actualQtyRejected = max(0, totalAcc - goodAcc) + jo.manualQtyRejected
 *
 * `addJobOrderCount` had always maintained `manualQtyRejected` so its entries
 * came back out of that sum intact. `reportJobOrderOutput` — the tablet's
 * "Correct total" — wrote `actualQty*` and nothing else, so the gateway
 * restored the old figure within seconds and the operator watched the number
 * revert. Two save paths on one screen, behaving differently, and no test
 * anywhere compared them.
 *
 * Measured on the plant on 25 Aug 2026: M3 carried `manualQtyRejected = 2` with
 * `actualQtyRejected = 0`, and M4 carried 4 against 0 — the operator's entry
 * recorded and erased at the same time.
 *
 * These drive the two service methods against a stubbed Prisma and then apply
 * the gateway's own stamping formula to the result. A regression fails HERE
 * rather than on a tablet at six in the morning.
 */

import { ProductionService } from './production.service';

interface Row {
  id: string; factoryId: string; machineId: string | null; workOrderId: string;
  status: string; operatorId: string | null; handoverQty: number; scrapReason: string | null;
  actualQtyGood: number; actualQtyRejected: number;
  manualQtyGood: number; manualQtyRejected: number;
}

const ROW = (over: Partial<Row> = {}): Row => ({
  id: 'jo-1', factoryId: 'F', machineId: 'm1', workOrderId: 'wo-1',
  status: 'EXECUTING', operatorId: null, handoverQty: 0, scrapReason: null,
  actualQtyGood: 0, actualQtyRejected: 0, manualQtyGood: 0, manualQtyRejected: 0,
  ...over,
});

/** A Prisma stub that behaves like one table: findFirst returns the row, update mutates it. */
function harness(row: Row) {
  const prisma: any = {
    jobOrder: {
      findFirst: jest.fn().mockImplementation(async () => ({ ...row })),
      update: jest.fn().mockImplementation(async ({ data }: any) => {
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === 'object' && 'increment' in (v as any)) {
            (row as any)[k] = ((row as any)[k] ?? 0) + (v as any).increment;
          } else {
            (row as any)[k] = v;
          }
        }
        return { ...row };
      }),
    },
    scrapLog: { create: jest.fn().mockResolvedValue({}) },
    productionEvent: { create: jest.fn().mockResolvedValue({}) },
    machine: { findUnique: jest.fn().mockResolvedValue({ lineId: 'l1' }) },
    shiftInstance: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  // Only prisma and the KPI roll-up are exercised by these two methods; the
  // rest of the constructor is stubbed so the test stays about the arithmetic.
  const kpi = { propagateFromJobOrder: jest.fn().mockResolvedValue(undefined) } as any;
  const historian = { sampleActiveJobOrders: jest.fn().mockResolvedValue(undefined) } as any;
  const autoStops = { onJobOrderStart: jest.fn().mockResolvedValue(0) } as any;
  const svc = new ProductionService(
    prisma, {} as any, kpi, { emit: jest.fn() } as any, {} as any, historian, autoStops,
  ) as any;
  return { svc, prisma, row };
}

/**
 * The gateway's own stamp, verbatim from counter.service.ts:623.
 *
 * Copied rather than imported because the gateway is a separate build with its
 * own Prisma client. If that formula changes, this constant is the one place
 * this file has to follow it to — and a mismatch showing up here is exactly the
 * signal worth having.
 */
const gatewayStamp = (r: Row, totalAcc: number, goodAcc: number) => ({
  ...r,
  actualQtyRejected: Math.max(0, totalAcc - goodAcc) + r.manualQtyRejected,
});

describe('a corrected count survives the gateway', () => {
  it('keeps a corrected REJECTED total after the next flush', async () => {
    // The plant's own shape: the sensor pair says 5 rejected, the operator
    // knows it was 40 and corrects the total.
    const { svc, row } = harness(ROW({ actualQtyGood: 83, actualQtyRejected: 5 }));

    await svc.reportJobOrderOutput('F', 'jo-1', { actualQtyGood: 83, actualQtyRejected: 40 });
    expect(row.actualQtyRejected).toBe(40);
    // The correction states its own manual share, which is what the gateway adds back.
    expect(row.manualQtyRejected).toBe(35);

    const after = gatewayStamp(row, 88, 83); // totalAcc 88, goodAcc 83 → autoBad 5
    expect(after.actualQtyRejected).toBe(40); // before the fix this came back as 5
  });

  it('keeps a corrected total when the sensor cannot derive rejects at all', async () => {
    // M1 on 25 Aug: good 425 > total 361, so the derived reject clamps to zero
    // and the manual share is the ONLY thing holding the number up.
    const { svc, row } = harness(ROW({ actualQtyGood: 425, actualQtyRejected: 0 }));

    await svc.reportJobOrderOutput('F', 'jo-1', { actualQtyGood: 425, actualQtyRejected: 6 });

    const after = gatewayStamp(row, 361, 425); // max(0, -64) = 0
    expect(after.actualQtyRejected).toBe(6);
  });

  it('lets a correction take a number DOWN', async () => {
    // The 150 entered into the wrong field. Before the fix there was no path
    // that could reduce a count at all.
    const { svc, row } = harness(ROW({
      actualQtyGood: 4443, actualQtyRejected: 156, manualQtyRejected: 156,
    }));

    await svc.reportJobOrderOutput('F', 'jo-1', { actualQtyGood: 4443, actualQtyRejected: 6 });
    expect(row.actualQtyRejected).toBe(6);
    expect(row.manualQtyRejected).toBe(6);
    expect(gatewayStamp(row, 0, 4443).actualQtyRejected).toBe(6);
  });

  it('accepts a NEGATIVE delta on the add path', async () => {
    const { svc, row } = harness(ROW({ actualQtyRejected: 156, manualQtyRejected: 156 }));

    await svc.addJobOrderCount('F', 'jo-1', { scrapDelta: -150 });
    expect(row.actualQtyRejected).toBe(6);
    expect(row.manualQtyRejected).toBe(6);
  });

  it('writes no scrap log for a negative delta', async () => {
    // A ScrapLog row with a negative quantity would corrupt every Pareto that
    // reads the table. The journal records the correction instead.
    const { svc, prisma } = harness(ROW({ actualQtyRejected: 20, manualQtyRejected: 20 }));
    await svc.addJobOrderCount('F', 'jo-1', { scrapDelta: -5 });
    expect(prisma.scrapLog.create).not.toHaveBeenCalled();
  });

  it('still writes a scrap log when scrap is genuinely added', async () => {
    const { svc, prisma } = harness(ROW());
    await svc.addJobOrderCount('F', 'jo-1', { scrapDelta: 3, scrapReason: 'Torn sachet' });
    expect(prisma.scrapLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.scrapLog.create.mock.calls[0][0].data.qty).toBe(3);
  });

  it('never lets a total go below zero, however the deltas arrive', async () => {
    const { svc, row } = harness(ROW({ actualQtyGood: 10, actualQtyRejected: 2 }));
    await svc.addJobOrderCount('F', 'jo-1', { goodDelta: -999, scrapDelta: -999 });
    expect(row.actualQtyGood).toBe(0);
    expect(row.actualQtyRejected).toBe(0);
  });

  it('never lets the manual share exceed the total it is a share of', async () => {
    // The two columns must stay consistent, or the gateway's stamp adds back
    // more than the job order ever held.
    const { svc, row } = harness(ROW({
      actualQtyGood: 10, actualQtyRejected: 4, manualQtyRejected: 4,
    }));
    await svc.addJobOrderCount('F', 'jo-1', { scrapDelta: -10 });
    expect(row.actualQtyRejected).toBe(0);
    expect(row.manualQtyRejected).toBe(0);
    expect(row.manualQtyRejected).toBeLessThanOrEqual(row.actualQtyRejected);
  });

  it('leaves a correction that matches the sensor with no manual share', async () => {
    // Correcting a number to exactly what the sensor already says should not
    // invent a manual entry — otherwise the next flush double-counts it.
    const { svc, row } = harness(ROW({ actualQtyGood: 100, actualQtyRejected: 5 }));
    await svc.reportJobOrderOutput('F', 'jo-1', { actualQtyGood: 100, actualQtyRejected: 5 });
    expect(row.manualQtyRejected).toBe(0);
    expect(gatewayStamp(row, 105, 100).actualQtyRejected).toBe(5);
  });
});
