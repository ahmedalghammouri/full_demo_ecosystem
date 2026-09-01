import { KpiService } from './kpi.service';
import { OEEService } from './oee.service';

/**
 * A deleted machine must disappear from every surface, not most of them.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * The Checkweigher was archived and vanished from Machine Status, Availability
 * Analytics, the Loss Tree and Schedule & Capacity — but kept its row in OEE by
 * hierarchy, reporting 0% A/P/Q. Four of six surfaces filtered on
 * `isActive/archivedAt`; two did not, and the two that did not were the ones a
 * reader would trust to list the plant.
 *
 * The filter is missing by OMISSION, which is the hard kind to see: nothing in
 * the query looks wrong, there is simply a clause that is not there. So this
 * asserts on the WHERE clause the service sends, which is the only place the
 * absence is visible without a database.
 */
describe('KpiService — archived machines', () => {
  const factoryId = 'f1';

  function build() {
    const prisma = {
      machine: { findMany: jest.fn().mockResolvedValue([]) },
      jobOrder: { findMany: jest.fn().mockResolvedValue([]) },
      machineStateRecord: { findMany: jest.fn().mockResolvedValue([]) },
      downtimeEvent: { findMany: jest.fn().mockResolvedValue([]) },
      machineStateRule: { findMany: jest.fn().mockResolvedValue([]) },
      productionLine: { findFirst: jest.fn().mockResolvedValue(null) },
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

  /** Every machine lookup this call made, as the WHERE clauses it sent. */
  const wheres = (prisma: { machine: { findMany: jest.Mock } }) =>
    prisma.machine.findMany.mock.calls.map((c) => c[0]?.where ?? {});

  it('excludes them when resolving a scope to machine ids', async () => {
    // This resolver feeds the OEE Analytics headline and the Machine OEE table.
    // Leaving an archived machine in the scope kept it in every total derived
    // from it, silently.
    const { service, prisma } = build();
    await service.resolveScopeMachineIds(factoryId, { lineId: 'l1' });

    expect(wheres(prisma)[0]).toMatchObject({ isActive: true, archivedAt: null });
  });

  it('excludes them from the OEE hierarchy tree', async () => {
    // The visible symptom: a deleted machine kept its row in OEE by hierarchy.
    const { service, prisma } = build();
    await service.hierarchyOEE(factoryId, '2026-08-18', '2026-08-18').catch(() => undefined);

    const all = wheres(prisma);
    expect(all.length).toBeGreaterThan(0);
    for (const w of all) {
      expect(w).toMatchObject({ isActive: true, archivedAt: null });
    }
  });

  it('keeps the scope filter alongside the archive filter, not instead of it', async () => {
    // A filter that replaced the line scope would return the whole factory —
    // right machines excluded, wrong machines included.
    const { service, prisma } = build();
    await service.resolveScopeMachineIds(factoryId, { lineId: 'l1' });

    expect(wheres(prisma)[0]).toMatchObject({
      factoryId, lineId: 'l1', isActive: true, archivedAt: null,
    });
  });
});
