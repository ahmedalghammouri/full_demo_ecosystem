import { CounterService } from './counter.service';

/**
 * Count at wire speed, write in bulk — the acquisition/writer split.
 *
 * ── What this replaces ──────────────────────────────────────────────────────
 * Every counter tag used to be written on its own, and a TOTAL counter cost
 * five sequential round-trips across the plant's internet link: read the job
 * order, write it, read the machine status, write it, read the job order again
 * for the event. A GOOD counter cost three. Two counters on one machine were
 * eight round-trips, one after another, every flush — and the TOTAL role paid
 * the most, which is exactly the tag the line reported as lagging.
 *
 * Worse than slow, it was ORDER-DEPENDENT: the total counter derived scrap by
 * asking the database what the good counter had just written. Whether that
 * write had landed decided the answer.
 *
 * Now the accumulator runs untouched at sample rate, and the writer takes the
 * whole batch — every tag, every machine — computes it in memory, and sends it
 * as ONE transaction. These tests hold both halves of that.
 */
describe('bulk counter writing', () => {
  const MACHINE = 'm1';
  const JOB = 'jo-1';

  let seq = 0;
  const freshConfig = () => ({
    get: () => `${require('os').tmpdir()}/mes-counter-bulk-${process.pid}-${(seq += 1)}`,
  });

  const tag = (id: string, role: string, machineId = MACHINE) => ({
    id, machineId, factoryId: 'f1', counterRole: role, edgeType: 'RISING', code: id,
  }) as never;

  function build(machines: string[] = [MACHINE]) {
    const jo: Record<string, { actualQtyGood: number; actualQtyRejected: number }> = {};
    for (const m of machines) jo[m] = { actualQtyGood: 0, actualQtyRejected: 0 };

    const applied: Array<Record<string, unknown>> = [];
    const prisma: any = {
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
      jobOrder: {
        findMany: jest.fn(async () => machines.map((m) => ({
          id: `${JOB}-${m}`, machineId: m,
          actualQtyGood: jo[m].actualQtyGood, actualQtyRejected: jo[m].actualQtyRejected,
          manualQtyGood: 0, manualQtyRejected: 0,
        }))),
        findFirst: jest.fn(async () => ({ id: JOB })),
        findUnique: jest.fn(async () => ({ actualQtyGood: 0, actualQtyRejected: 0 })),
        update: jest.fn(async ({ where, data }: any) => {
          applied.push({ id: where.id, ...data });
          const m = String(where.id).replace(`${JOB}-`, '');
          if (!jo[m]) return {};
          if (data.actualQtyGood?.increment) jo[m].actualQtyGood += data.actualQtyGood.increment;
          if (typeof data.actualQtyGood === 'number') jo[m].actualQtyGood = data.actualQtyGood;
          if (data.actualQtyRejected?.increment) jo[m].actualQtyRejected += data.actualQtyRejected.increment;
          if (typeof data.actualQtyRejected === 'number') jo[m].actualQtyRejected = data.actualQtyRejected;
          return jo[m];
        }),
      },
      machineCurrentStatus: {
        findMany: jest.fn(async () => machines.map((m) => ({ machineId: m, state: 'RUNNING', goodCount: 0 }))),
        findUnique: jest.fn(async () => ({ state: 'RUNNING', goodCount: 0 })),
        upsert: jest.fn(async () => ({})),
        update: jest.fn(async () => ({})),
      },
      gatewayCounterState: {
        findUnique: jest.fn(async () => null),
        upsert: jest.fn(async () => ({})),
      },
    };
    return { prisma, jo, applied };
  }

  /**
   * Bring a tag to a known LOW baseline.
   *
   * The first sighting only asks the cache to seed itself from disk, in the
   * background — it does not record the level. So a second reading is needed
   * after that lands, or the first rising edge of the test is swallowed as the
   * baseline and every count comes out one short.
   */
  async function ready(svc: CounterService, tags: unknown[]) {
    for (const t of tags) svc.observe(t as never, false, new Date().toISOString());
    await new Promise((r) => setTimeout(r, 60));
    for (const t of tags) svc.observe(t as never, false, new Date().toISOString());
  }

  function pulse(svc: CounterService, t: unknown, n: number) {
    for (let i = 0; i < n; i += 1) {
      svc.observe(t as never, true, new Date().toISOString());
      svc.observe(t as never, false, new Date().toISOString());
    }
  }

  it('sends the whole batch as one transaction, whatever its size', async () => {
    const { prisma } = build(['m1', 'm2', 'm3']);
    const svc = new CounterService(prisma, freshConfig() as never);
    const tags = [
      tag('g1', 'GOOD', 'm1'), tag('t1', 'TOTAL', 'm1'),
      tag('g2', 'GOOD', 'm2'), tag('t2', 'TOTAL', 'm2'),
      tag('g3', 'GOOD', 'm3'),
    ];
    await ready(svc, tags);
    for (const t of tags) pulse(svc, t, 40);

    await svc.flush();

    // Five counters across three machines, two hundred units. Two calls: one
    // batched resolve, one batched write. The old path was over twenty
    // sequential round-trips for the same work.
    expect(prisma.$transaction.mock.calls.length).toBe(2);
  });

  it('does not scale its round-trips with the number of counts', async () => {
    const { prisma } = build();
    const svc = new CounterService(prisma, freshConfig() as never);
    const g = tag('g', 'GOOD');
    await ready(svc, [g]);

    pulse(svc, g, 500);          // an entire shift's worth in one batch
    await svc.flush();

    // 500 units, still two calls. This is the property that lets the poller run
    // at wire speed without the writer ever becoming the bottleneck.
    expect(prisma.$transaction.mock.calls.length).toBe(2);
  });

  it('derives scrap from the accumulators, not from what the database just saw', async () => {
    const { prisma, jo } = build();
    const svc = new CounterService(prisma, freshConfig() as never);
    const good = tag('g', 'GOOD');
    const total = tag('t', 'TOTAL');
    await ready(svc, [good, total]);

    pulse(svc, total, 100);      // 100 units passed the machine
    pulse(svc, good, 94);        // 94 of them were good
    await svc.flush();

    expect(jo.m1.actualQtyGood).toBe(94);
    expect(jo.m1.actualQtyRejected).toBe(6);
  });

  it('keeps the good count when only the total sensor fired this batch', async () => {
    // The two are different sensors centimetres apart; their pulses do not land
    // in the same 20ms window. Deriving from only the tags that moved would read
    // the absent good counter as zero and book the whole run as scrap.
    const { prisma, jo } = build();
    const svc = new CounterService(prisma, freshConfig() as never);
    const good = tag('g', 'GOOD');
    const total = tag('t', 'TOTAL');
    await ready(svc, [good, total]);

    pulse(svc, good, 50);
    pulse(svc, total, 50);
    await svc.flush();
    expect(jo.m1.actualQtyRejected).toBe(0);

    pulse(svc, total, 1);        // the total sensor alone advances
    await svc.flush();

    expect(jo.m1.actualQtyGood).toBe(50);
    expect(jo.m1.actualQtyRejected).toBe(1);
  });

  it('credits a lone TOTAL counter as production, never as scrap', async () => {
    // A machine with a total sensor and no good sensor knows what it made and
    // nothing about quality. `total - good` with no good counter is `total`,
    // and calling all of it rejected is simply false.
    const { prisma, jo } = build();
    const svc = new CounterService(prisma, freshConfig() as never);
    const total = tag('t', 'TOTAL');
    await ready(svc, [total]);

    pulse(svc, total, 30);
    await svc.flush();

    expect(jo.m1.actualQtyGood).toBe(30);
    expect(jo.m1.actualQtyRejected).toBe(0);
  });

  it('re-offers the whole batch when the transaction fails', async () => {
    const { prisma, jo } = build();
    const svc = new CounterService(prisma, freshConfig() as never);
    const g = tag('g', 'GOOD');
    await ready(svc, [g]);
    pulse(svc, g, 25);

    const ok = prisma.$transaction;
    prisma.$transaction = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    await svc.flush();
    expect(jo.m1.actualQtyGood).toBe(0);     // nothing landed

    prisma.$transaction = ok;
    await svc.flush();
    // Nothing was marked written, so the whole backlog is still owed and lands
    // intact. A batch that half-committed would be worse than one that failed.
    expect(jo.m1.actualQtyGood).toBe(25);
  });

  it('does not write the same delta twice when a flush overruns its timer', async () => {
    const { prisma, jo } = build();
    const svc = new CounterService(prisma, freshConfig() as never);
    const g = tag('g', 'GOOD');
    await ready(svc, [g]);
    pulse(svc, g, 60);

    // Two flushes racing, as a slow link and a 1s timer produce in the plant.
    await Promise.all([svc.flush(), svc.flush()]);

    expect(jo.m1.actualQtyGood).toBe(60);
  });
});
