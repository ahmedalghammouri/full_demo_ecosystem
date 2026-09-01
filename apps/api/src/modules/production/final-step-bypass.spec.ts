import { KpiService, FINAL_STEP } from './kpi.service';
import { OEEService } from './oee.service';

/**
 * Bypassing the last machine on the line.
 *
 * ── The situation this exists for ───────────────────────────────────────────
 * Line 1 runs Filling → Cartoning → Palletising → Wrapping, and the line's good
 * output is the WRAPPER's count, because that is what actually leaves the line.
 * The wrapper broke mid-order. Product now leaves at the palletiser, and until
 * somebody says so the line reports whatever the dead machine last counted.
 *
 * ── Why an upstream total is the right answer, not a partial one ────────────
 * These are serial steps on the SAME units. The palletiser's total already
 * includes every unit the wrapper went on to wrap, so once the wrapper is
 * bypassed the palletiser's running total IS the line's output — for the whole
 * order, not just the minutes since the breakdown. That is why the flag lives on
 * the job order and not on the minute.
 *
 * ── What is actually verified here ──────────────────────────────────────────
 * The rule exists twice: in TypeScript for the live path, and in SQL for the
 * minute store — and BOTH are live in production. Two copies of a rule is how
 * every defect this month started, so the SQL half is asserted here too, against
 * the exported fragment the four queries share rather than a copy of its text.
 */
describe('bypassing a step moves the line output upstream', () => {
  const from = new Date('2026-08-26T00:00:00Z');
  const to = new Date('2026-08-26T12:00:00Z');

  const step = (
    machineId: string, seq: number, good: number, rejected: number,
    bypassedAt: Date | null = null,
  ) => ({
    id: `jo-${machineId}`, machineId, status: 'COMPLETE', idealCycleTimeSec: 1,
    actualQtyGood: good, actualQtyRejected: rejected,
    plannedStart: from, plannedEnd: to, actualStart: from, actualEnd: to,
    sequenceOrder: seq, outputUnit: null,
    // One routed work order: that is what makes these four steps one batch.
    workOrderId: 'wo-1', workOrder: { sku: null },
    bypassedAt,
  });

  const machines = [
    { id: 'm1', name: 'Powder Filler', code: 'M1', sortOrder: 1 },
    { id: 'm2', name: 'Carton Packer', code: 'M2', sortOrder: 2 },
    { id: 'm3', name: 'Euro-Pack', code: 'M3', sortOrder: 3 },
    { id: 'm4', name: 'Uni-Tech Wrapping', code: 'M4', sortOrder: 4 },
  ];

  function lineService(jobOrders: unknown[]) {
    const prisma = {
      productionLine: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'l1', name: 'Line 1', code: 'PL-01', oeeMethod: 'ROLLUP',
          bottleneckMachineId: null, outfeedMachineIds: [], machines,
        }),
      },
      jobOrder: { findMany: jest.fn().mockResolvedValue(jobOrders) },
      machineStateRecord: { findMany: jest.fn().mockResolvedValue([]) },
      downtimeEvent: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const service = new KpiService(
      prisma as never, new OEEService(), { emit: jest.fn() } as never,
      { ratedCapacityByMachine: jest.fn().mockResolvedValue(new Map()) } as never,
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
    );
    return service;
  }

  /**
   * The rule itself. `finalStepCounts` is private, and reached here on purpose:
   * it is the one place both the line rollup and every hierarchy node get their
   * counts from, and asserting it directly says exactly what the rule is.
   *
   * On its own that would be the mistake of testing a copy of the logic, so the
   * LAST test in this block drives the public `lineOeeAnalytics` and checks the
   * bypass moves the number there too. That is what proves this private method
   * is still on the path a screen actually reads.
   */
  const counts = (jobOrders: unknown[]) =>
    (lineService(jobOrders) as any).finalStepCounts(jobOrders);

  it('normally reads the line total off the LAST step', () => {
    const r = counts([
      step('m1', 1, 5000, 0), step('m2', 2, 1200, 0),
      step('m3', 3, 150, 0), step('m4', 4, 140, 0),
    ]);
    expect(r.good).toBe(140);
  });

  it('reads it off the step BEFORE a bypassed last machine', () => {
    // The wrapper is out of service. 150 pallets left the line at the
    // palletiser, 140 of which happened to get wrapped before it broke.
    const r = counts([
      step('m1', 1, 5000, 0), step('m2', 2, 1200, 0),
      step('m3', 3, 150, 0), step('m4', 4, 140, 0, new Date()),
    ]);
    expect(r.good).toBe(150);
  });

  it('walks back over TWO bypassed steps', () => {
    const r = counts([
      step('m1', 1, 5000, 0), step('m2', 2, 1200, 0),
      step('m3', 3, 150, 0, new Date()), step('m4', 4, 140, 0, new Date()),
    ]);
    expect(r.good).toBe(1200);
  });

  it('still counts scrap recorded at a bypassed step', () => {
    // Units the wrapper spoiled before it failed are units the plant lost.
    // Bypassing changes where OUTPUT is read, not whether a loss happened.
    const r = counts([
      step('m1', 1, 5000, 0), step('m2', 2, 1200, 0),
      step('m3', 3, 150, 3), step('m4', 4, 140, 7, new Date()),
    ]);
    expect(r.good).toBe(150);
    expect(r.scrap).toBe(10);
  });

  it('reports the true last step rather than ZERO if every step is bypassed', () => {
    // Unreachable through the API, which refuses to bypass the last live step.
    // If it ever happens anyway, a wrong number beats a shift reporting that it
    // produced nothing at all.
    const b = new Date();
    const r = counts([
      step('m1', 1, 5000, 0, b), step('m2', 2, 1200, 0, b),
      step('m3', 3, 150, 0, b), step('m4', 4, 140, 0, b),
    ]);
    expect(r.good).toBe(140);
  });

  it('MOVES THE NUMBER ON THE PUBLIC LINE ANALYTICS, not just in the private rule', async () => {
    // Without this, the block above could pass while every screen still read
    // the dead machine. Quality is 100 * good / (good + scrap), so the two
    // cases are distinguishable only because the scrap is the same in both.
    const withScrap = (bypassed: boolean) => [
      step('m1', 1, 5000, 0), step('m2', 2, 1200, 0),
      step('m3', 3, 150, 3), step('m4', 4, 140, 7, bypassed ? new Date() : null),
    ];
    const live = await lineService(withScrap(false)).lineOeeAnalytics('f1', 'l1', from, to);
    const byp  = await lineService(withScrap(true)).lineOeeAnalytics('f1', 'l1', from, to);

    expect(live!.quality).toBeCloseTo(100 * (140 / 150), 1);  // 93.3 -- wrapper
    expect(byp!.quality).toBeCloseTo(100 * (150 / 160), 1);   // 93.8 -- palletiser
    expect(byp!.quality).toBeGreaterThan(live!.quality);
  });

  it('leaves an order with no bypass completely unchanged', () => {
    // The migration adds a nullable column and nothing is backfilled, so every
    // order recorded before today must read exactly as it did.
    const r = counts([
      step('m1', 1, 5000, 0), step('m2', 2, 1200, 0), step('m3', 3, 150, 0),
    ]);
    expect(r.good).toBe(150);
  });
});

describe('the SQL half of the rule says the same thing', () => {
  // Four queries share this fragment. These assert the fragment itself, so a
  // change to it cannot leave the TypeScript half above as the only copy that
  // knows about the bypass.
  const sql = FINAL_STEP.sql;

  it('excludes bypassed steps when picking the final one', () => {
    expect(sql).toContain('FILTER (WHERE NOT bypassed)');
  });

  it('falls back rather than returning NULL when all are bypassed', () => {
    // A NULL here joins to nothing and the line silently reports zero output.
    expect(sql).toContain('COALESCE');
    expect(sql.match(/MAX\("sequenceOrder"\)/g)).toHaveLength(2);
  });
});
