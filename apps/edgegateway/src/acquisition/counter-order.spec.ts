import { CounterService } from './counter.service';

/**
 * One unit that raises TOTAL and GOOD in the same poll is not a reject.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * A TOTAL counter carries no bad count. `CounterService` derives one as
 * `total - good`, reading good from the job order. So when both bits rise
 * together — which is what the hardware does for a good part — whichever tag is
 * visited first decides the answer:
 *
 *   TOTAL first → good is still N-1, bad = 1 is WRITTEN, and it stands until
 *                 the next TOTAL edge re-derives it.
 *   GOOD first  → good is already N, bad = 0.
 *
 * Tags arrived in address order and TOTAL sat on the lower address on both of
 * this plant's modules, so TOTAL always won. On the filler, one part every three
 * seconds, the phantom reject was corrected three seconds later and nobody saw
 * it. On the wrapper — one pallet every NINE MINUTES — it stood for nine
 * minutes, and the minute-level OEE store recorded every one of them. A line
 * configured for 0.2% scrap reported 41%, all of it at the last machine.
 *
 * `ModbusPollerService` now sorts GOOD ahead of TOTAL. These tests pin the
 * behaviour that ordering buys, so the arithmetic cannot quietly go back to
 * depending on which address a plant happened to wire a counter to.
 */
describe('TOTAL/GOOD counter ordering', () => {
  const MACHINE = 'm5';
  const JOB = 'jo-1';
  // The service writes a local state file; point it at a scratch directory so a
  // test run never touches the gateway's real buffer.
  const CONFIG = { get: () => `${require('os').tmpdir()}/mes-counter-order-spec` };

  /**
   * A prisma double holding one job order in memory, so the two updates in a
   * pulse see each other exactly as they would against the database.
   */
  function build() {
    const jo = { actualQtyGood: 0, actualQtyRejected: 0, manualQtyGood: 0, manualQtyRejected: 0 };
    const status = { goodCount: 0, rejectCount: 0 };

    const prisma: any = {
      jobOrder: {
        update: jest.fn(async ({ data }: any) => {
          if (data.actualQtyGood?.increment) jo.actualQtyGood += data.actualQtyGood.increment;
          if (data.actualQtyRejected?.increment) jo.actualQtyRejected += data.actualQtyRejected.increment;
          if (typeof data.actualQtyRejected === 'number') jo.actualQtyRejected = data.actualQtyRejected;
          return jo;
        }),
        findUnique: jest.fn(async () => ({ ...jo })),
        findFirst: jest.fn(async () => ({ id: JOB })),
      },
      machineCurrentStatus: {
        findUnique: jest.fn(async () => ({ ...status })),
        upsert: jest.fn(async () => status),
        update: jest.fn(async () => status),
      },
    };
    return { prisma, jo };
  }

  const tag = (role: 'TOTAL' | 'GOOD') => ({
    id: `tag-${role}`, machineId: MACHINE, factoryId: 'f1',
    counterRole: role, edgeType: 'RISING' as const,
  });

  /**
   * Apply one pulse in the given order. `total` is the counter's cumulative
   * reading after the pulse; `inc` is the edge count for this poll.
   */
  async function pulse(svc: any, prisma: any, order: Array<'TOTAL' | 'GOOD'>, total: number) {
    for (const role of order) {
      await svc.applyToJob(tag(role), JOB, total, 1, new Date().toISOString());
    }
  }

  it('books no reject when GOOD is applied before TOTAL', async () => {
    const { prisma, jo } = build();
    const svc: any = new CounterService(prisma as never, CONFIG as never);

    for (let n = 1; n <= 3; n++) await pulse(svc, prisma, ['GOOD', 'TOTAL'], n);

    expect(jo.actualQtyGood).toBe(3);
    expect(jo.actualQtyRejected).toBe(0);
  });

  /**
   * The failing order, kept as a test so the cost of getting it wrong is written
   * down rather than remembered. Each pulse leaves a reject standing until the
   * NEXT pulse re-derives it — which on a nine-minute cycle is nine minutes of
   * minute rows carrying a scrap that never happened.
   */
  it('leaves a phantom reject standing when TOTAL is applied first', async () => {
    const { prisma, jo } = build();
    const svc: any = new CounterService(prisma as never, CONFIG as never);

    await pulse(svc, prisma, ['TOTAL', 'GOOD'], 1);

    expect(jo.actualQtyGood).toBe(1);
    // The unit was good. It is recorded as scrap until another TOTAL edge lands.
    expect(jo.actualQtyRejected).toBe(1);
  });

  it('still books a real reject when GOOD does not rise', async () => {
    const { prisma, jo } = build();
    const svc: any = new CounterService(prisma as never, CONFIG as never);

    await pulse(svc, prisma, ['GOOD', 'TOTAL'], 1);   // good part
    await svc.applyToJob(tag('TOTAL'), JOB, 2, 1, new Date().toISOString()); // bad part: total only

    expect(jo.actualQtyGood).toBe(1);
    expect(jo.actualQtyRejected).toBe(1);
  });

  it('never lets the derived scrap go negative', async () => {
    const { prisma, jo } = build();
    const svc: any = new CounterService(prisma as never, CONFIG as never);

    // Good runs ahead of total — the swapped-address case, which is what made a
    // whole machine incapable of reporting any scrap at all.
    await svc.applyToJob(tag('GOOD'), JOB, 0, 5, new Date().toISOString());
    await svc.applyToJob(tag('TOTAL'), JOB, 2, 1, new Date().toISOString());

    expect(jo.actualQtyRejected).toBe(0);
  });
});
