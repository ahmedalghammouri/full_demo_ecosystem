import { KpiService } from './kpi.service';
import { OEEService } from './oee.service';

/**
 * Both availability bases travel together, always.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Unifying the KPI engine onto one aggregate quietly dropped the time-based pair.
 * Every surface kept schedule-based availability and lost OEE-TB, and nothing
 * failed — the numbers that remained were correct, so the loss was invisible
 * until somebody looked for a figure that had simply stopped existing.
 *
 * The two answer different questions and a plant needs both:
 *
 *   schedule-based  run ÷ planned production time — of the time we MEANT to
 *                   produce, how much did we? Scheduled-but-never-started counts
 *                   against it.
 *   time-based      run ÷ (run + unplanned downtime) — while the line was up,
 *                   how much of that was productive? Blind to the schedule.
 *
 * A plant that runs to demand rather than to a fixed schedule reads the second.
 * Producing one without the other is the failure this guards.
 */
describe('KpiService.factorsFromFacts — both bases', () => {
  const svc = () => new KpiService(
    {} as never, new OEEService(), { emit: jest.fn() } as never, {} as never,
  
      // The records list delegates to the two engines; nothing in these
      // suites reaches it, so a stub is enough to construct the service.
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
      { byJobOrder: jest.fn().mockResolvedValue([]) } as never,
    );

  /** An hour planned, 45 min running, 15 min broken, all of it good output. */
  const facts = (over: Partial<Record<string, number>> = {}) => ({
    plannedMin: 60, runMin: 45, downMin: 15, plannedDownMin: 0,
    externalMin: 0, unmeasuredMin: 0, microStopMin: 0,
    idealRunMin: 45, totalBase: 100, goodBase: 100, scrapBase: 0,
    ...over,
  }) as never;

  it('reports the schedule basis against planned production time', () => {
    expect(svc().factorsFromFacts(facts()).availability).toBeCloseTo(75, 1); // 45/60
  });

  it('reports the time basis against uptime plus downtime', () => {
    expect(svc().factorsFromFacts(facts()).availabilityTb).toBeCloseTo(75, 1); // 45/(45+15)
  });

  it('separates the two when scheduled time was never started', () => {
    // Planned 120, but the order only ran for 60 of them: half the schedule was
    // never begun. Schedule-based charges that; time-based does not, because the
    // machine was not up to be judged.
    const f = svc().factorsFromFacts(facts({ plannedMin: 120 }));
    expect(f.availability).toBeCloseTo(37.5, 1);   // 45/120
    expect(f.availabilityTb).toBeCloseTo(75, 1);   // 45/60 — unchanged
  });

  it('composes OEE on each basis with the same P and Q', () => {
    const f = svc().factorsFromFacts(facts({ plannedMin: 120 }));
    // Only availability differs, so the two OEEs differ by exactly that ratio.
    expect(f.oee! / f.oeeTb!).toBeCloseTo(f.availability! / f.availabilityTb!, 3);
  });

  it('returns null on each basis when its own denominator is absent', () => {
    // Nothing planned and nothing run: neither question has an answer, and 0%
    // would read as failure rather than "never asked to run".
    const f = svc().factorsFromFacts(facts({ plannedMin: 0, runMin: 0, downMin: 0 }));
    expect(f.availability).toBeNull();
    expect(f.availabilityTb).toBeNull();
    expect(f.oee).toBeNull();
    expect(f.oeeTb).toBeNull();
  });

  it('still answers on the time basis when nothing was scheduled', () => {
    // A machine that ran unscheduled has no schedule-based availability but a
    // perfectly meaningful time-based one — exactly the case OEE-TB exists for.
    const f = svc().factorsFromFacts(facts({ plannedMin: 0 }));
    expect(f.availability).toBeNull();
    expect(f.availabilityTb).toBeCloseTo(75, 1);
    expect(f.oeeTb).not.toBeNull();
  });

  it('never emits one basis without the other', () => {
    const keys = Object.keys(svc().factorsFromFacts(facts()));
    for (const k of ['availability', 'availabilityTb', 'oee', 'oeeTb']) {
      expect(keys).toContain(k);
    }
  });
});
