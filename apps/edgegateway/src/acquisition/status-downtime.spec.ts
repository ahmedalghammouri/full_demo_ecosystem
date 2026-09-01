import { StatusService } from './status.service';

/**
 * One stop, one reason.
 *
 * A machine rarely goes stopped → running. It goes STARVED, then the operator
 * gives up and calls maintenance, and it becomes BREAKDOWN. If the first event
 * stays open, the whole hour is booked under the first reason — and because
 * STARVED is excluded from OEE by rule, an hour of genuine breakdown disappears
 * from availability because its first two minutes were starvation.
 *
 * Found by live verification on 14 Aug 2026: M5 showed state BREAKDOWN with an
 * open STARVED event beneath it.
 */
describe('StatusService — downtime event boundaries', () => {
  const PREFIX = 'Auto (status signal): ';
  const t0 = new Date('2026-08-14T10:00:00Z');
  const t1 = new Date('2026-08-14T10:05:00Z');

  function build(openEvent: any = null) {
    const created: any[] = [];
    const updated: any[] = [];
    const history = { opened: [] as any[], closed: [] as any[] };
    const prisma: any = {
      machineStateRule: { findMany: jest.fn().mockResolvedValue([]) }, // fall back to built-ins
      machineStateRecord: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(async ({ where, data }) => { history.closed.push({ id: where.id, ...data }); }),
        create: jest.fn(async ({ data }) => { history.opened.push(data); return { id: 'sr' }; }),
      },
      jobOrder: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue(null) },
      machineCurrentStatus: {
        findUnique: jest.fn().mockResolvedValue({ state: 'RUNNING' }),
        upsert: jest.fn(),
      },
      downtimeEvent: {
        findFirst: jest.fn().mockResolvedValue(openEvent),
        create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'new' }; }),
        update: jest.fn(async ({ where, data }: any) => { updated.push({ id: where.id, ...data }); }),
      },
      workOrder: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn().mockResolvedValue({}) },
    };
    const inference = { classify: jest.fn(async (_m: string, s: string) => s) };
    const svc = new StatusService(prisma as never, inference as never);
    const apply = (state: string, when: Date) => (svc as never as {
      apply(f: string, m: string, s: string, w: Date): Promise<void>;
    }).apply('f1', 'm5', state, when);
    return { apply, created, updated, prisma, history };
  }

  const autoEvent = (state: string) => ({
    id: 'evt-1',
    startTime: t0,
    workOrderId: null,
    reason: `${PREFIX}${state}`,
  });

  it('closes the old event and opens a new one when the reason changes', async () => {
    const { apply, created, updated } = build(autoEvent('STARVED'));
    await apply('BREAKDOWN', t1);

    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe('evt-1');
    expect(updated[0].endTime).toBe(t1);
    expect(updated[0].durationMinutes).toBeCloseTo(5, 5);

    expect(created).toHaveLength(1);
    expect(created[0].reasonCode).toBe('UNPLANNED_BREAKDOWN');
    expect(created[0].reason).toBe(`${PREFIX}BREAKDOWN`);
    // The whole point: the breakdown is charged to OEE, the starvation was not.
    expect(created[0].affectsOEE).toBe(true);
  });

  it('leaves the event alone when the state has not changed', async () => {
    // apply() returns early on an unchanged state, but pin it anyway: this is
    // the every-poll path, and creating an event here would be catastrophic.
    const { apply, created, updated, prisma } = build(autoEvent('BREAKDOWN'));
    prisma.machineCurrentStatus.findUnique.mockResolvedValue({ state: 'BREAKDOWN' });
    await apply('BREAKDOWN', t1);
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
  });

  it('never rewrites an event a person classified by hand', async () => {
    // No AUTO prefix: an operator raised or reclassified this stop. Their record
    // outranks the signal, so it stays open and untouched.
    const { apply, created, updated } = build({
      id: 'evt-manual', startTime: t0, workOrderId: null,
      reason: 'Blade change — logged by operator',
    });
    await apply('BREAKDOWN', t1);
    expect(updated).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  it('closes the event when the machine starts running again', async () => {
    const { apply, created, updated, prisma } = build(autoEvent('BREAKDOWN'));
    prisma.machineCurrentStatus.findUnique.mockResolvedValue({ state: 'BREAKDOWN' });
    await apply('RUNNING', t1);
    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].endTime).toBe(t1);
    expect(updated[0].durationMinutes).toBeCloseTo(5, 5);
  });

  it('opens an event when a running machine stops', async () => {
    const { apply, created, updated } = build(null);
    await apply('BREAKDOWN', t1);
    expect(updated).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0].reason).toBe(`${PREFIX}BREAKDOWN`);
  });

  it('credits the closed minutes to the work order', async () => {
    const { apply, prisma } = build({
      id: 'evt-1', startTime: t0, workOrderId: 'wo-9', reason: `${PREFIX}STARVED`,
    });
    await apply('BREAKDOWN', t1);
    expect(prisma.workOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'wo-9' },
        data: { downtimeMinutes: { increment: 5 } },
      }),
    );
  });

  it('carries the rule through to the new event — a planned stop is not charged', async () => {
    const { apply, created } = build(autoEvent('BREAKDOWN'));
    await apply('PLANNED_STOP', t1);
    expect(created).toHaveLength(1);
    expect(created[0].isPlanned).toBe(true);
    expect(created[0].affectsOEE).toBe(false);
  });
  // ── Debounce ──────────────────────────────────────────────────────────────
  // The field was configured, carried through the rule, and used by nothing.
  // Live running recorded three BLOCKED events for one machine inside two
  // seconds — an event log nobody can read.
  describe('debounce — a state must hold before it is believed', () => {
    /** Same harness, but with a factory rule carrying a settling time. */
    function buildWithDebounce(seconds: number, state = 'BREAKDOWN') {
      const h = build(null);
      h.prisma.machineStateRule.findMany.mockResolvedValue([
        {
          state, machineId: null, isDowntime: true, isPlanned: false, affectsOEE: true,
          reasonCode: 'UNPLANNED_BREAKDOWN', category: 'MECHANICAL', debounceSeconds: seconds,
        },
      ]);
      return h;
    }

    it('does not record a state that flickers away before settling', async () => {
      const { apply, created } = buildWithDebounce(5);
      await apply('BREAKDOWN', new Date('2026-08-14T10:00:00Z'));
      await apply('BREAKDOWN', new Date('2026-08-14T10:00:02Z'));
      expect(created).toHaveLength(0);
    });

    it('records the state once it has held for the settling time', async () => {
      const { apply, created } = buildWithDebounce(5);
      await apply('BREAKDOWN', new Date('2026-08-14T10:00:00Z'));
      await apply('BREAKDOWN', new Date('2026-08-14T10:00:04Z'));
      expect(created).toHaveLength(0);
      await apply('BREAKDOWN', new Date('2026-08-14T10:00:05Z'));
      expect(created).toHaveLength(1);
    });

    it('restarts the clock when the machine changes its mind mid-settle', async () => {
      const { apply, created } = buildWithDebounce(5);
      await apply('BREAKDOWN', new Date('2026-08-14T10:00:00Z'));
      await apply('STARVED',   new Date('2026-08-14T10:00:03Z')); // different state
      await apply('BREAKDOWN', new Date('2026-08-14T10:00:06Z')); // clock restarts here
      expect(created).toHaveLength(0);
    });

    it('acts immediately when no settling time is configured', async () => {
      const { apply, created } = build(null); // no rules → built-in fallback, 0 s
      await apply('BREAKDOWN', new Date('2026-08-14T10:00:00Z'));
      expect(created).toHaveLength(1);
    });
  });
  // ── State history ─────────────────────────────────────────────────────────
  // The gateway wrote the live state and the downtime event but never the
  // history. machine_state_records held one RUNNING row per machine, opened when
  // its job order started and never closed — so the timeline drew a solid bar
  // for days, and the OEE engine, which reads STARVED/BLOCKED minutes from this
  // table, computed an external loss of zero for ever.
  describe('state history', () => {
    const t0 = new Date('2026-08-14T10:00:00Z');
    const t1 = new Date('2026-08-14T10:05:00Z');

    it('opens a record when the state changes', async () => {
      const { apply, history } = build(null);
      await apply('BREAKDOWN', t1);
      expect(history.opened).toHaveLength(1);
      expect(history.opened[0]).toMatchObject({ state: 'BREAKDOWN', startTime: t1, source: 'SYSTEM' });
    });

    it('closes the previous record with a duration', async () => {
      const { apply, history, prisma } = build(null);
      prisma.machineStateRecord.findFirst.mockResolvedValue({ id: 'sr-1', state: 'RUNNING', startTime: t0 });
      await apply('STARVED', t1);
      expect(history.closed).toHaveLength(1);
      expect(history.closed[0].id).toBe('sr-1');
      expect(history.closed[0].endTime).toBe(t1);
      expect(history.closed[0].durationMinutes).toBeCloseTo(5, 5);
      expect(history.opened[0].state).toBe('STARVED');
    });

    it('does not split a record when the state has not actually changed', async () => {
      // Defensive: apply() returns early on an unchanged state, but a stale open
      // record of the same state must not be closed and reopened either — that
      // would shred one long period into a row per poll.
      const { apply, history, prisma } = build(null);
      prisma.machineStateRecord.findFirst.mockResolvedValue({ id: 'sr-1', state: 'BREAKDOWN', startTime: t0 });
      await apply('BREAKDOWN', t1);
      expect(history.closed).toHaveLength(0);
      expect(history.opened).toHaveLength(0);
    });

    it('records the running order so the timeline has production context', async () => {
      const { apply, history, prisma } = build(null);
      prisma.jobOrder.findFirst.mockResolvedValue({ workOrderId: 'wo-7', workOrder: { skuId: 'sku-3' } });
      await apply('BREAKDOWN', t1);
      expect(history.opened[0]).toMatchObject({ workOrderId: 'wo-7', skuId: 'sku-3' });
    });

    it('still records the live state when the history write fails', async () => {
      // Losing a history row is bad; losing the downtime event because history
      // failed would be worse.
      const { apply, created, prisma } = build(null);
      prisma.machineStateRecord.findFirst.mockRejectedValue(new Error('db down'));
      await apply('BREAKDOWN', t1);
      expect(prisma.machineCurrentStatus.upsert).toHaveBeenCalled();
      expect(created).toHaveLength(1);
    });
    it('reconciles a stale open record once after a restart', async () => {
      // The machine came back up already STARVED, so no transition ever fires.
      // Its open record still says RUNNING from before the restart.
      const { apply, history, prisma } = build(null);
      prisma.machineCurrentStatus.findUnique.mockResolvedValue({ state: 'STARVED' });
      prisma.machineStateRecord.findFirst.mockResolvedValue({ id: 'sr-old', state: 'RUNNING', startTime: t0 });

      await apply('STARVED', t1);
      expect(history.closed).toHaveLength(1);
      expect(history.opened[0].state).toBe('STARVED');

      // Second reading: already reconciled, so nothing further is written.
      await apply('STARVED', new Date('2026-08-14T10:06:00Z'));
      expect(history.opened).toHaveLength(1);
    });

    it('leaves history alone when it already agrees', async () => {
      const { apply, history, prisma } = build(null);
      prisma.machineCurrentStatus.findUnique.mockResolvedValue({ state: 'RUNNING' });
      prisma.machineStateRecord.findFirst.mockResolvedValue({ id: 'sr-1', state: 'RUNNING', startTime: t0 });
      await apply('RUNNING', t1);
      expect(history.opened).toHaveLength(0);
      expect(history.closed).toHaveLength(0);
    });
  });
});
