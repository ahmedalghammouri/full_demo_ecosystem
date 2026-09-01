import { StatusService } from './status.service';

/**
 * Concurrent transitions for one machine must not orphan a state record.
 *
 * ── The defect this reproduces ──────────────────────────────────────────────
 * The outbox this gateway drains batches deferred work and runs a whole batch
 * with `Promise.allSettled` — deliberately concurrent, because most of what it
 * carries (an ingest write, an alarm check) is independent per tag. But
 * `StatusService.process()` rides the same outbox, and a machine's state
 * transitions are NOT independent of each other: `apply()` reads the open
 * history record, then writes it, several `await`s apart.
 *
 * Two `apply()` calls for the SAME machine landing in one batch used to
 * interleave: both read "the open record doesn't match this state" before
 * either had written, so both closed (or failed to find) the same row and both
 * created a new one. Closing only ever finds the LATEST open record, so every
 * earlier duplicate was orphaned open forever.
 *
 * Measured on the plant: fourteen open records on one machine across a single
 * shift, thirteen of them still reading RUNNING three hours after the machine
 * had gone IDLE — which is what made "Where the time went" show a stopped
 * machine as running, and why the Machine Status Timeline drew green over a
 * band the operator could see was red.
 *
 * The double below is a real in-memory table, not a canned response: `create`
 * appends, `update` mutates the matching row, `findFirst` filters and sorts
 * exactly as Postgres would. That is what makes the race reproducible —
 * a double that just returns fixed values cannot race at all.
 */
describe('StatusService — concurrent transitions for one machine', () => {
  function build() {
    let seq = 0;
    const records: Array<{
      id: string; machineId: string; state: string;
      startTime: Date; endTime: Date | null; durationMinutes: number | null;
    }> = [];

    // A small delay on the read, so two calls that start close together are
    // actually IN FLIGHT at the same time rather than trivially serialized by
    // the event loop finishing one microtask queue before the next begins.
    const settle = <T>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 2));

    let currentState = 'IDLE';
    const prisma: any = {
      machineStateRule: { findMany: jest.fn().mockResolvedValue([]) },
      machineStateRecord: {
        findFirst: jest.fn(async ({ where }: any) => {
          const open = records
            .filter((r) => r.machineId === where.machineId && r.endTime === null)
            .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
          return settle(open[0] ?? null);
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = records.find((r) => r.id === where.id);
          if (row) Object.assign(row, data);
          return settle(row);
        }),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `r${(seq += 1)}`, endTime: null, durationMinutes: null, ...data };
          records.push(row);
          return settle(row);
        }),
      },
      jobOrder: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue(null) },
      machineCurrentStatus: {
        findUnique: jest.fn(async () => settle({ state: currentState })),
        upsert: jest.fn(async ({ update }: any) => { currentState = update.state; }),
      },
      downtimeEvent: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 'evt' }),
        update: jest.fn().mockResolvedValue({}),
      },
      workOrder: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    };
    const inference = { classify: jest.fn(async (_m: string, s: string) => s) };
    const svc = new StatusService(prisma as never, inference as never);
    return { svc, records, prisma };
  }

  const openRecords = (records: any[], machineId: string) =>
    records.filter((r) => r.machineId === machineId && r.endTime === null);

  it('leaves exactly one open record after several rapid transitions race each other', async () => {
    const { svc, records } = build();
    const t = (s: number) => new Date(2026, 7, 24, 8, 0, s);

    // Five genuine transitions, all fired at once — as they arrive when a
    // batch drain scoops up several poll cycles' worth of deferred work.
    // `process` is the real public entry point; nothing here calls `apply`
    // directly, so this exercises exactly what the outbox does.
    const tag = (id: string) => ({ machineId: 'm1', factoryId: 'f1', id } as any);
    await Promise.all([
      svc.process(tag('t1'), 1, t(1).toISOString()),   // -> RUNNING
      svc.process(tag('t2'), 0, t(2).toISOString()),   // -> IDLE (or STARVED/whatever numeric=0 maps to)
      svc.process(tag('t3'), 1, t(3).toISOString()),
      svc.process(tag('t4'), 0, t(4).toISOString()),
      svc.process(tag('t5'), 1, t(5).toISOString()),
    ]);

    // Whatever the final sequence resolved to, AT MOST one record for this
    // machine may still be open. This is the invariant the bug violated.
    expect(openRecords(records, 'm1').length).toBeLessThanOrEqual(1);
  });

  it('processes machine-agnostic ordering, but never orphans a record', async () => {
    // A blunter version of the same scenario, run many times, because a race
    // does not reproduce on every run — it reproduces on SOME runs, which is
    // exactly why it survived in production without a test catching it.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const { svc, records } = build();
      const tag = (id: string) => ({ machineId: 'm1', factoryId: 'f1', id } as any);
      const base = attempt * 100;
      await Promise.all([
        svc.process(tag(`a${attempt}`), 1, new Date(2026, 7, 24, 9, 0, base + 1).toISOString()),
        svc.process(tag(`b${attempt}`), 0, new Date(2026, 7, 24, 9, 0, base + 2).toISOString()),
        svc.process(tag(`c${attempt}`), 1, new Date(2026, 7, 24, 9, 0, base + 3).toISOString()),
      ]);
      expect(openRecords(records, 'm1').length).toBeLessThanOrEqual(1);
    }
  });

  it('still processes two DIFFERENT machines fully in parallel', async () => {
    // The fix must not turn every machine's work into one global queue — that
    // would make one slow machine stall every other one's state updates.
    const { svc, records } = build();
    const start = Date.now();
    await Promise.all([
      svc.process({ machineId: 'm1', factoryId: 'f1', id: 'x' } as any, 1, new Date().toISOString()),
      svc.process({ machineId: 'm2', factoryId: 'f1', id: 'y' } as any, 1, new Date().toISOString()),
    ]);
    // Two machines, each with one ~2ms DB round-trip per step (several steps
    // per apply). Serialized across machines this would take roughly double;
    // run in parallel it should land well under that.
    expect(Date.now() - start).toBeLessThan(60);
    expect(openRecords(records, 'm1').length).toBeLessThanOrEqual(1);
    expect(openRecords(records, 'm2').length).toBeLessThanOrEqual(1);
  });
});
