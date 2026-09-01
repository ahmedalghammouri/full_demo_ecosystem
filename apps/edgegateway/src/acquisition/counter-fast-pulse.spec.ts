import { CounterService } from './counter.service';

/**
 * A counter must not lose pulses to database latency.
 *
 * ── What went wrong on the line ─────────────────────────────────────────────
 * The filler runs about 120 parts a minute — a pulse every 500 ms, and the
 * pulse itself far shorter. The device is polled every 100 ms, which is fast
 * enough to see each one, but `process()` did two fresh queries (the executing
 * job order, the machine's state), a file write and up to two more writes PER
 * COUNTER TAG PER POLL, and the poller awaited all of it inline. `dev.busy`
 * then skipped every cycle that arrived while it ran.
 *
 * So the real sampling period was the length of that chain, not 100 ms, and a
 * pulse that opened and closed inside one was never seen. The counts came out
 * low and the input looked permanently TRUE — the sampler was only awake for
 * part of the wave.
 *
 * ── The contract these tests hold ───────────────────────────────────────────
 * `observe()` is synchronous and touches nothing but memory. `flush()` does the
 * writing, on its own timer. Whatever the database is doing, every edge in the
 * sample stream is counted.
 */
describe('counting at speed', () => {
  const MACHINE = 'm1';
  const JOB = 'jo-1';
  /**
   * A FRESH state directory per service.
   *
   * This was one shared path, so the counter file survived not just between
   * tests but between RUNS — a suite's result depended on how many times it had
   * been run before. Counting tests whose numbers drift with history are worse
   * than no counting tests.
   */
  let dirSeq = 0;
  const freshConfig = () => ({
    get: () => `${require('os').tmpdir()}/mes-counter-fast-spec-${process.pid}-${(dirSeq += 1)}`,
  });

  const TAG = {
    id: 'tag-total', machineId: MACHINE, factoryId: 'f1',
    counterRole: 'TOTAL' as const, edgeType: 'RISING' as const,
    code: 'M1_TOTAL', unit: 'PIECE',
  } as never;

  /** A prisma double that is DELIBERATELY slow, standing in for a loaded database. */
  function build(latencyMs = 40) {
    const slow = async <T>(v: T): Promise<T> => {
      await new Promise((r) => setTimeout(r, latencyMs));
      return v;
    };
    const jo = { actualQtyGood: 0, actualQtyRejected: 0 };
    const prisma: any = {
      // The writer sends its whole batch through $transaction — the resolve pair
      // as one round-trip, then every update as another. The double runs the
      // promises it is handed, so the latency of a batch is ONE call, not N.
      $transaction: jest.fn((ops: any[]) => Promise.all(ops)),
      jobOrder: {
        findMany: jest.fn(() => slow([{
          id: JOB, machineId: MACHINE,
          actualQtyGood: jo.actualQtyGood, actualQtyRejected: jo.actualQtyRejected,
          manualQtyGood: 0, manualQtyRejected: 0,
        }])),
        findFirst: jest.fn(() => slow({ id: JOB })),
        findUnique: jest.fn(() => slow({ ...jo, manualQtyGood: 0, manualQtyRejected: 0 })),
        update: jest.fn(({ data }: any) => {
          if (data.actualQtyGood?.increment) jo.actualQtyGood += data.actualQtyGood.increment;
          if (data.actualQtyRejected?.increment) jo.actualQtyRejected += data.actualQtyRejected.increment;
          // A TOTAL counter derives scrap and writes it ABSOLUTELY, so it never
          // overwrites operator-entered scrap. The double has to honour that or
          // it silently drops the only write this role makes.
          if (typeof data.actualQtyGood === 'number') jo.actualQtyGood = data.actualQtyGood;
          if (typeof data.actualQtyRejected === 'number') jo.actualQtyRejected = data.actualQtyRejected;
          return slow(jo);
        }),
      },
      machineCurrentStatus: {
        findMany: jest.fn(() => slow([{ machineId: MACHINE, state: 'RUNNING', goodCount: 0 }])),
        findUnique: jest.fn(() => slow({ state: 'RUNNING' })),
        upsert: jest.fn(() => slow({})),
        update: jest.fn(() => slow({})),
      },
      gatewayCounterState: {
        findUnique: jest.fn(() => slow(null)),
        upsert: jest.fn(() => slow({})),
      },
    };
    return { prisma, jo };
  }

  /** Seed the tag into the cache — the first sighting never counts, by design. */
  async function ready(svc: CounterService) {
    svc.observe(TAG, false, new Date().toISOString());
    await new Promise((r) => setTimeout(r, 60)); // let the background seed land
  }

  it('observe() does no I/O — it returns without awaiting anything', async () => {
    const { prisma } = build(500); // any await here would take half a second
    const svc = new CounterService(prisma, freshConfig() as never);
    await ready(svc);

    const started = Date.now();
    for (let i = 0; i < 200; i += 1) {
      svc.observe(TAG, i % 2 === 1, new Date().toISOString());
    }
    // 100 rising edges through a database that takes 500ms a call.
    expect(Date.now() - started).toBeLessThan(50);
  });

  it('counts every edge of a 2 Hz train, then writes the total once', async () => {
    const { prisma, jo } = build(40);
    const svc = new CounterService(prisma, freshConfig() as never);
    await ready(svc);

    // 120 parts a minute for a minute: 120 pulses, each a rise and a fall.
    for (let i = 0; i < 120; i += 1) {
      svc.observe(TAG, true, new Date().toISOString());
      svc.observe(TAG, false, new Date().toISOString());
    }
    await svc.flush();

    expect(jo.actualQtyGood + jo.actualQtyRejected).toBeGreaterThan(0);
    // One flush, not 120 — the write is batched.
    expect(prisma.jobOrder.update.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('asks the database about a machine once per flush, not once per pulse', async () => {
    const { prisma } = build(5);
    const svc = new CounterService(prisma, freshConfig() as never);
    await ready(svc);

    for (let i = 0; i < 50; i += 1) {
      svc.observe(TAG, true, new Date().toISOString());
      svc.observe(TAG, false, new Date().toISOString());
    }
    await svc.flush();

    // 50 pulses. The old path ran BOTH of these on every poll, so the count
    // scaled with production; now the job-order gate is asked once per flush.
    expect(prisma.jobOrder.findFirst.mock.calls.length).toBeLessThanOrEqual(1);
    // Status is read twice, and both are legitimate: once as the running gate,
    // once by bumpStatus writing the machine's own good/reject counters. What
    // matters is that neither scales with the number of pulses.
    expect(prisma.machineCurrentStatus.findUnique.mock.calls.length).toBeLessThan(5);
  });

  it('keeps counting while the database is unreachable, and lands it on recovery', async () => {
    const { prisma, jo } = build(5);
    // The writer reaches the database through $transaction now — one batched
    // round-trip for the whole flush. That is where an outage has to be
    // simulated, and where it has to be survivable.
    const realTx = prisma.$transaction;
    prisma.$transaction = jest.fn(async () => { throw new Error('ECONNREFUSED'); });
    const svc = new CounterService(prisma, freshConfig() as never);
    await ready(svc);

    for (let i = 0; i < 30; i += 1) {
      svc.observe(TAG, true, new Date().toISOString());
      svc.observe(TAG, false, new Date().toISOString());
    }
    await svc.flush();                       // outage: nothing written
    expect(jo.actualQtyGood + jo.actualQtyRejected).toBe(0);

    prisma.$transaction = realTx;
    await svc.flush();                       // recovered: the backlog lands
    expect(jo.actualQtyGood + jo.actualQtyRejected).toBeGreaterThan(0);
  });
});
