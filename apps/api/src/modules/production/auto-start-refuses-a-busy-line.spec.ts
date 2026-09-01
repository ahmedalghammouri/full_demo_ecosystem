import { WorkOrderSchedulerService } from './work-order-scheduler.service';

/**
 * Auto-start must not put two orders on one line, and must not run a stale plan.
 *
 * ── The incident this pins ──────────────────────────────────────────────────
 * The scheduler asked one question — `plannedStart <= now` — and started
 * whatever answered yes. On 25 Aug 2026 WO-2026-0004 auto-started at 12:55
 * while WO-2026-0003 was still executing on the same four machines. Neither
 * order was wrong; the scheduler was, and it said nothing to anybody.
 *
 * The same single question also meant a plan from last week still matched
 * forever: `lte: now` has no floor.
 *
 * Both refusals REPORT. A scheduler that silently declines is only marginally
 * better than one that silently proceeds — the plant still cannot see why its
 * order did not run.
 */

const MIN = 60_000;

function harness(opts: {
  dueWO?: any;
  blocker?: any;
} = {}) {
  const started: string[] = [];
  const notices: Array<{ title: string; reason: string }> = [];

  const prisma: any = {
    workOrder: {
      findMany: jest.fn().mockResolvedValue(opts.dueWO ? [opts.dueWO] : []),
      findFirst: jest.fn().mockResolvedValue(opts.blocker ?? null),
    },
    jobOrder: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const production: any = {
    startWorkOrder: jest.fn().mockImplementation(async (_f: any, _u: any, id: string) => { started.push(id); }),
    updateJobOrderStatus: jest.fn().mockResolvedValue(undefined),
  };
  const notifications: any = {
    dispatch: jest.fn().mockImplementation(async (n: any) => {
      notices.push({ title: n.title, reason: n.data?.reason });
    }),
  };
  const svc = new WorkOrderSchedulerService(prisma, production, notifications);
  return { svc, started, notices, production, notifications };
}

const WO = (over: any = {}) => ({
  id: 'wo-4', factoryId: 'F', orderNumber: 'WO-2026-0004',
  plannedStart: new Date(Date.now() - 5 * MIN), lineId: 'line-1',
  ...over,
});

describe('auto-start refuses a busy line', () => {
  it('starts a due order when the line is free', async () => {
    const { svc, started, notices } = harness({ dueWO: WO() });
    await svc.tick();
    expect(started).toEqual(['wo-4']);
    expect(notices).toEqual([]);
  });

  it('holds the order back when another is running on the same line', async () => {
    // 25 August, exactly.
    const { svc, started, notices } = harness({
      dueWO: WO(),
      blocker: { id: 'wo-3', orderNumber: 'WO-2026-0003' },
    });
    await svc.tick();
    expect(started).toEqual([]);
    expect(notices).toHaveLength(1);
    expect(notices[0].title).toContain('WO-2026-0003');
    expect(notices[0].reason).toBe('busy:wo-3');
  });

  it('reports a blocked order ONCE, not every minute', async () => {
    const { svc, notices } = harness({
      dueWO: WO(),
      blocker: { id: 'wo-3', orderNumber: 'WO-2026-0003' },
    });
    await svc.tick();
    await svc.tick();
    await svc.tick();
    // A warning repeated every sixty seconds is a warning everybody mutes.
    expect(notices).toHaveLength(1);
  });

  it('starts the order as soon as the line frees up', async () => {
    const { svc, started, prisma } = (() => {
      const h = harness({ dueWO: WO(), blocker: { id: 'wo-3', orderNumber: 'WO-2026-0003' } });
      return { ...h, prisma: (h.svc as any).prisma };
    })();
    await svc.tick();
    expect(started).toEqual([]);

    prisma.workOrder.findFirst.mockResolvedValue(null); // WO-0003 finished
    await svc.tick();
    expect(started).toEqual(['wo-4']);
  });

  it('does not block an order that has no line recorded', async () => {
    // Nothing can be shown to collide with it, and refusing on a guess would be
    // its own kind of wrong.
    const { svc, started } = harness({
      dueWO: WO({ lineId: null }),
      blocker: { id: 'wo-3', orderNumber: 'WO-2026-0003' },
    });
    await svc.tick();
    expect(started).toEqual(['wo-4']);
  });
});

describe('auto-start refuses a stale slot', () => {
  it('will not start an order whose planned time is long past', async () => {
    // Planned nine hours ago — well beyond the four-hour window.
    const { svc, started, notices } = harness({
      dueWO: WO({ plannedStart: new Date(Date.now() - 9 * 60 * MIN) }),
    });
    await svc.tick();
    expect(started).toEqual([]);
    expect(notices[0].reason).toBe('stale');
    expect(notices[0].title).toContain('will not auto-start');
  });

  it('still starts one inside the window', async () => {
    const { svc, started } = harness({
      dueWO: WO({ plannedStart: new Date(Date.now() - 90 * MIN) }),
    });
    await svc.tick();
    expect(started).toEqual(['wo-4']);
  });

  it('reports staleness before it even looks at the line', async () => {
    // A stale order is a scheduling decision. Whether the line happens to be
    // free is beside the point, and reporting "busy" would send the plant after
    // the wrong thing.
    const { svc, notices } = harness({
      dueWO: WO({ plannedStart: new Date(Date.now() - 9 * 60 * MIN) }),
      blocker: { id: 'wo-3', orderNumber: 'WO-2026-0003' },
    });
    await svc.tick();
    expect(notices[0].reason).toBe('stale');
  });

  it('reports again when a blocked order later goes stale', async () => {
    // The situation changed, and that is news. The reason is part of the key
    // precisely so this second notice gets through.
    const h = harness({ dueWO: WO(), blocker: { id: 'wo-3', orderNumber: 'WO-2026-0003' } });
    await h.svc.tick();
    expect(h.notices).toHaveLength(1);

    (h.svc as any).prisma.workOrder.findMany.mockResolvedValue([
      WO({ plannedStart: new Date(Date.now() - 9 * 60 * MIN) }),
    ]);
    await h.svc.tick();
    expect(h.notices).toHaveLength(2);
    expect(h.notices[1].reason).toBe('stale');
  });

  it('never lets a notification failure stop the tick', async () => {
    const h = harness({ dueWO: WO(), blocker: { id: 'wo-3', orderNumber: 'WO-2026-0003' } });
    h.notifications.dispatch.mockRejectedValue(new Error('mail server down'));
    await expect(h.svc.tick()).resolves.not.toThrow();
  });
});
