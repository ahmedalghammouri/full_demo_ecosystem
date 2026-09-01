import { StatusService } from './status.service';

/**
 * A stopped machine must have a downtime event, even if it never changes state.
 *
 * ── The defect this pins ────────────────────────────────────────────────────
 * `apply` returns early when the state has not changed — correctly, there is
 * nothing to transition. But the early return skipped the code that opens the
 * downtime event, and the reconciliation it did run only repaired the state
 * RECORD. So a machine that was already stopped when the gateway started, or one
 * whose events were cleared by a Danger Zone reset while it stayed in the same
 * state, kept an open state record with no event behind it — for as long as it
 * kept not changing.
 *
 * Measured on the plant: four machines BLOCKED or in BREAKDOWN, each with an open
 * state record, zero open downtime events between them.
 *
 * The damage was not a missing row. Machine Status reads state records and showed
 * 0% availability; the fact store reads downtime events, saw no stop at all, and
 * credited those minutes as run time — 91.8% for the same machine on the same
 * screen at the same moment. Two pages describing the same minutes and
 * disagreeing about whether the machine was running is what makes a plant stop
 * trusting the system, and it is the bug this file exists to prevent.
 */
describe('StatusService — reconciling an unchanged stopped machine', () => {
  const PREFIX = 'Auto (status signal): ';
  const stoppedSince = new Date('2026-08-18T20:00:00Z');
  const now = new Date('2026-08-18T20:30:00Z');

  function build(opts: { openEvent?: any; openRecord?: any; state?: string } = {}) {
    const created: any[] = [];
    const state = opts.state ?? 'BLOCKED';
    const prisma: any = {
      machineStateRule: { findMany: jest.fn().mockResolvedValue([]) }, // built-in rules
      machineStateRecord: {
        findFirst: jest.fn().mockResolvedValue(
          opts.openRecord === undefined
            ? { id: 'sr-1', state, startTime: stoppedSince }
            : opts.openRecord,
        ),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn().mockResolvedValue({ id: 'sr-2' }),
      },
      jobOrder: { count: jest.fn().mockResolvedValue(1), findFirst: jest.fn().mockResolvedValue(null) },
      machineCurrentStatus: {
        // The machine is ALREADY in this state — this is the early-return path.
        findUnique: jest.fn().mockResolvedValue({ state }),
        upsert: jest.fn(),
      },
      downtimeEvent: {
        findFirst: jest.fn().mockResolvedValue(opts.openEvent ?? null),
        create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'new' }; }),
        update: jest.fn().mockResolvedValue({}),
      },
      workOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const inference = { classify: jest.fn(async (_m: string, s: string) => s) };
    const svc = new StatusService(prisma as never, inference as never);
    const apply = (s: string, when: Date) => (svc as never as {
      apply(f: string, m: string, s: string, w: Date): Promise<void>;
    }).apply('f1', 'm1', s, when);
    return { svc, apply, created, prisma };
  }

  it('opens the missing event for a machine that is already stopped', async () => {
    const { apply, created } = build();
    await apply('BLOCKED', now);

    expect(created).toHaveLength(1);
    expect(created[0].reason).toBe(`${PREFIX}BLOCKED`);
  });

  it('backdates it to when the machine actually stopped', async () => {
    // Opening at `now` would silently forgive the thirty minutes it has already
    // been stopped for — the exact minutes availability is supposed to charge.
    const { apply, created } = build();
    await apply('BLOCKED', now);

    expect(created[0].startTime).toEqual(stoppedSince);
  });

  it('carries the rule flags, so the reopened event is charged like any other', async () => {
    // BLOCKED is a stop that does NOT affect OEE. An event reopened with the
    // wrong flags would charge the line's constraint to the machine.
    const { apply, created } = build();
    await apply('BLOCKED', now);

    expect(created[0].affectsOEE).toBe(false);
    expect(created[0].isPlanned).toBe(false);
    expect(created[0].category).toBe('PROCESS');
  });

  it('charges a BREAKDOWN to OEE, unlike a blockage', async () => {
    const { apply, created } = build({ state: 'BREAKDOWN' });
    await apply('BREAKDOWN', now);

    expect(created[0].affectsOEE).toBe(true);
    expect(created[0].reasonCode).toBe('UNPLANNED_BREAKDOWN');
  });

  it('does nothing when an event is already open', async () => {
    const { apply, created } = build({ openEvent: { id: 'evt-1' } });
    await apply('BLOCKED', now);

    expect(created).toHaveLength(0);
  });

  it('opens no event for a state that is not downtime', async () => {
    const { apply, created } = build({ state: 'RUNNING' });
    await apply('RUNNING', now);

    expect(created).toHaveLength(0);
  });

  it('re-checks after the TTL, so a reset while running repairs itself', async () => {
    // The old code reconciled once per boot. Clearing events from the Danger Zone
    // while the gateway was running therefore left the machine broken until
    // somebody restarted it. The TTL is measured on the wall clock, so the clock
    // is what has to move here — not the reading's timestamp.
    const clock = jest.spyOn(Date, 'now');
    try {
      const t = now.getTime();
      clock.mockReturnValue(t);

      const { apply, created, prisma } = build({ openEvent: { id: 'evt-1' } });
      await apply('BLOCKED', now);
      expect(created).toHaveLength(0); // event present, nothing to do

      // The events are wiped underneath a running gateway.
      prisma.downtimeEvent.findFirst.mockResolvedValue(null);

      // Five seconds later the TTL has not elapsed — no re-query, no storm.
      clock.mockReturnValue(t + 5_000);
      await apply('BLOCKED', new Date(t + 5_000));
      expect(created).toHaveLength(0);

      // A minute later it looks again, finds the event gone, and repairs itself.
      clock.mockReturnValue(t + 61_000);
      await apply('BLOCKED', new Date(t + 61_000));
      expect(created).toHaveLength(1);
      expect(created[0].reason).toBe(`${PREFIX}BLOCKED`);
    } finally {
      clock.mockRestore();
    }
  });
});
