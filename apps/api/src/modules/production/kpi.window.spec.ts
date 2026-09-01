import { KpiService } from './kpi.service';
import { OEEService } from './oee.service';

/**
 * The window predicate used to select job orders for a KPI window.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The predicate was written as "started inside the window OR ended inside it",
 * duplicated in six places. That excludes the single most important case on a
 * running line: a job order that began BEFORE the window and has not ended.
 *
 * On real data — one job order per machine, started the previous day, still
 * running — asking for "today" matched nothing, so Overall Line OEE rendered
 * 0.0% with A/P/Q all zero, and the machine OEE leaderboard reported "no records
 * found". Nothing was broken in the arithmetic; the rows never arrived.
 *
 * These tests pin the corrected predicate at the boundary cases, so the same
 * mistake cannot be reintroduced by editing any one call site.
 */
describe('job-order window selection', () => {
  const from = new Date('2026-08-08T00:00:00.000Z');
  const to = new Date('2026-08-08T23:59:59.999Z');

  /** Captures the `where` clause the service sends to Prisma. */
  function buildCapturing() {
    const prisma = {
      productionLine: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'line-1', name: 'Powder Packing Line 1', code: 'PL-01',
          oeeMethod: 'ROLLUP', bottleneckMachineId: null, outfeedMachineIds: [],
          machines: [{ id: 'm1', name: 'Powder Filler', code: 'M1', sortOrder: 1 }],
        }),
      },
      jobOrder: { findMany: jest.fn().mockResolvedValue([]) },
      machineStateRecord: { findMany: jest.fn().mockResolvedValue([]) },
      // lineOeeAnalytics loads unplanned downtime to derive the time-based twin (OEE-TB).
      downtimeEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new KpiService(
      prisma as never,
      new OEEService(),
      { emit: jest.fn() } as never,
      { ratedCapacityByMachine: jest.fn().mockResolvedValue(new Map()) } as never,
    
      // The records list delegates to the two engines; nothing in these
      // suites reaches it, so a stub is enough to construct the service.
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
    );
    return { service, prisma };
  }

  /**
   * Evaluates the captured Prisma `where` against a job order, mirroring how
   * Prisma itself would: top-level keys are ANDed, `AND` is a conjunction, `OR`
   * a disjunction, and a comparison filter never matches a null column.
   */
  function matches(where: Record<string, any>, jo: { actualStart: Date | null; actualEnd: Date | null }) {
    const cmp = (field: Date | null, f: Record<string, any>) => {
      if (field === null) return false; // null never satisfies lte/gte in Prisma
      if (f.lte !== undefined && !(field <= f.lte)) return false;
      if (f.gte !== undefined && !(field >= f.gte)) return false;
      return true;
    };
    const leaf = (c: Record<string, any>): boolean => {
      if ('actualEnd' in c) return c.actualEnd === null ? jo.actualEnd === null : cmp(jo.actualEnd, c.actualEnd);
      if ('actualStart' in c) return cmp(jo.actualStart, c.actualStart);
      if (c.OR) return c.OR.some(leaf);
      if (c.AND) return c.AND.every(leaf);
      return true;
    };
    return (where.AND ?? []).every(leaf);
  }

  async function capturedWhere() {
    const { service, prisma } = buildCapturing();
    await service.lineOeeAnalytics('f1', 'line-1', from, to);
    return prisma.jobOrder.findMany.mock.calls[0][0].where as Record<string, any>;
  }

  it('selects a job order that started before the window and is still open — the case that read 0', async () => {
    const where = await capturedWhere();
    expect(matches(where, {
      actualStart: new Date('2026-08-07T07:31:00.000Z'),
      actualEnd: null,
    })).toBe(true);
  });

  it('selects a job order that started before the window and ended inside it', async () => {
    const where = await capturedWhere();
    expect(matches(where, {
      actualStart: new Date('2026-08-07T22:00:00.000Z'),
      actualEnd: new Date('2026-08-08T04:00:00.000Z'),
    })).toBe(true);
  });

  it('selects a job order fully contained in the window', async () => {
    const where = await capturedWhere();
    expect(matches(where, {
      actualStart: new Date('2026-08-08T08:00:00.000Z'),
      actualEnd: new Date('2026-08-08T12:00:00.000Z'),
    })).toBe(true);
  });

  it('selects a job order that spans the whole window on both sides', async () => {
    const where = await capturedWhere();
    expect(matches(where, {
      actualStart: new Date('2026-08-01T00:00:00.000Z'),
      actualEnd: new Date('2026-09-01T00:00:00.000Z'),
    })).toBe(true);
  });

  it('excludes a job order that ended before the window began', async () => {
    const where = await capturedWhere();
    expect(matches(where, {
      actualStart: new Date('2026-08-06T08:00:00.000Z'),
      actualEnd: new Date('2026-08-07T16:00:00.000Z'),
    })).toBe(false);
  });

  it('excludes a job order that starts after the window ends', async () => {
    const where = await capturedWhere();
    expect(matches(where, {
      actualStart: new Date('2026-08-09T08:00:00.000Z'),
      actualEnd: null,
    })).toBe(false);
  });

  it('excludes a job order that never started', async () => {
    const where = await capturedWhere();
    expect(matches(where, { actualStart: null, actualEnd: null })).toBe(false);
  });

  it('does not use the old containment form', async () => {
    const where = await capturedWhere();
    // The bug shape: a top-level OR of two "inside the window" comparisons.
    const isContainment =
      Array.isArray(where.OR) &&
      where.OR.length === 2 &&
      where.OR.every((c: any) => c.actualStart?.gte !== undefined || c.actualEnd?.gte !== undefined);
    expect(isContainment).toBe(false);
  });
});

/**
 * Planned Production Time must stop at NOW.
 *
 * The window for "Today" runs to 23:59, so an order that started this morning was
 * charged planned time for the rest of the calendar day. On real data that read as
 * 205 elapsed minutes against a 1,440-minute day — Availability 14.2% on the machine
 * leaderboard, while the KPI summary directly above it (fact store, which accrues
 * minutes only as buckets close) said 100.0% for the same machine and period.
 *
 * Equipment answers for time that has passed. Not for the rest of the week.
 */
describe('planned production time is not charged for the future', () => {
  const HOUR = 3_600_000;

  function buildLine(jobOrders: unknown[]) {
    const prisma = {
      productionLine: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'line-1', name: 'PL-01', code: 'PL-01',
          oeeMethod: 'ROLLUP', bottleneckMachineId: null, outfeedMachineIds: [],
          machines: [{ id: 'm1', name: 'Powder Filler', code: 'M1', sortOrder: 1 }],
        }),
      },
      jobOrder: { findMany: jest.fn().mockResolvedValue(jobOrders) },
      machineStateRecord: { findMany: jest.fn().mockResolvedValue([]) },
      downtimeEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new KpiService(
      prisma as never, new OEEService(), { emit: jest.fn() } as never,
      { ratedCapacityByMachine: jest.fn().mockResolvedValue(new Map()) } as never,
    
      // The records list delegates to the two engines; nothing in these
      // suites reaches it, so a stub is enough to construct the service.
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
    );
    return service;
  }

  it('measures availability against elapsed time, not the whole calendar day', async () => {
    const now = Date.now();
    const windowStart = new Date(now - 4 * HOUR);   // window opened 4h ago
    const windowEnd = new Date(now + 12 * HOUR);    // …and runs 12h into the future
    const startedAgo = new Date(now - 4 * HOUR);    // ran the whole elapsed window

    const service = buildLine([{
      id: 'jo-1', machineId: 'm1', status: 'EXECUTING', idealCycleTimeSec: 1,
      actualQtyGood: 240, actualQtyRejected: 0,
      plannedStart: windowStart, plannedEnd: windowEnd,   // planned far past now
      actualStart: startedAgo, actualEnd: null,           // still running
      sequenceOrder: 1, outputUnit: null, workOrderId: 'wo-1', workOrder: { sku: null },
    }]);

    const r = await service.lineOeeAnalytics('f1', 'line-1', windowStart, windowEnd);

    // Ran for every elapsed minute of the window, so availability is ~100% — NOT the
    // 4/16 = 25% that charging the unelapsed 12 hours would produce.
    expect(r!.availability).toBeGreaterThan(95);
  });
});
