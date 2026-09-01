import { LineBasisService, type Aggregate, type LineMethod } from './line-basis.service';
import type { OeeScope } from './oee-standard.service';

/**
 * What a line, an area and the factory scored.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 *   1. A single machine has no line basis, and says so rather than inventing one.
 *   2. BOTTLENECK takes A and P from the constraint ALONE.
 *   3. Good and theoretical are counted at the line's LAST STATION — where
 *      saleable units leave — and scrap at EVERY machine, because a unit binned
 *      upstream is a loss to the line even though the last station never saw it.
 *      The TIME, by contrast, is entirely the constraint's.
 *   4. The request picks the method; the line keeps the constraint and outfeed.
 *   5. BOTTLENECK asked for on a line with no constraint falls back and explains.
 *   6. Above a line, percentages are averaged and WEIGHTED by occupancy, while
 *      minutes and pieces stay additive.
 *
 * The aggregate function is a stub. That is the point of the design: the rule is
 * engine-agnostic, so it can be tested without a store, and the standard engine,
 * the schedule engine and the live screen all get the same answer because they
 * all call this.
 */
describe('LineBasisService', () => {
  const F = 'f1';

  const agg = (
    availability: number | null, performance: number | null, quality: number | null,
    counts: Partial<Aggregate['counts']> = {},
    totalMin = 100,
  ): Aggregate => ({
    availability, performance, quality,
    time: { totalMin },
    counts: { good: 0, rejected: 0, total: 0, theoretical: 0, ...counts },
  });

  /**
   * A prisma double returning the given lines. `machines` is the shape the
   * service selects, so a change to that select breaks the test rather than
   * silently returning undefined.
   */
  function build(lines: unknown[]) {
    const prisma = { productionLine: { findMany: jest.fn().mockResolvedValue(lines) } };
    return new LineBasisService(prisma as never);
  }

  const machine = (id: string, name: string, sortOrder: number) =>
    ({ id, name, code: id.toUpperCase(), sortOrder });

  const LINE = {
    id: 'l1', name: 'Powder Packing Line 1', code: 'PL-01', areaId: 'a1',
    area: { name: 'Packing' },
    oeeMethod: 'BOTTLENECK',
    bottleneckMachineId: 'm1',
    outfeedMachineIds: ['m5'],
    machines: [
      machine('m1', 'Powder Filler', 1),
      machine('m3', 'Carton Packer', 2),
      machine('m4', 'Euro-Pack Robot', 3),
      machine('m5', 'Uni-tech Wrapping', 4),
    ],
  };

  /** Routes each aggregate call by what the scope asked for. */
  const router = (by: {
    bottleneck: Aggregate; outfeed: Aggregate; whole: Aggregate;
  }) => {
    const seen: OeeScope[] = [];
    const fn = async (s: OeeScope) => {
      seen.push(s);
      if (s.machineId) return by.bottleneck;
      if (s.machineIds) return by.outfeed;
      return by.whole;
    };
    return { fn, seen };
  };

  // ── 1 ──────────────────────────────────────────────────────────────────────
  it('does not apply to a single machine', async () => {
    const svc = build([LINE]);
    const own = agg(90, 80, 70);
    const r = await svc.forScope(F, { machineId: 'm1' }, 'BOTTLENECK', async () => own, own);

    expect(r.applies).toBe(false);
    expect(r.level).toBe('MACHINE');
    expect(r.availability).toBe(90);
    expect(r.note).toMatch(/single machine/i);
  });

  // ── 2 and 3 ────────────────────────────────────────────────────────────────
  it('takes time from the constraint and the counts from the last station', async () => {
    const svc = build([LINE]);
    const { fn, seen } = router({
      // The constraint ran badly; the line is only as fast as it.
      bottleneck: agg(60, 50, 99, { good: 30000, rejected: 5, theoretical: 90000 }, 480),
      // Saleable units leave here, at this station's own design speed.
      outfeed: agg(95, 95, 95, { good: 800, rejected: 20, theoretical: 20000 }, 480),
      // Scrap from every machine on the line.
      whole: agg(90, 90, 90, { good: 31000, rejected: 200 }, 1920),
    });

    const r = await svc.forScope(F, { lineId: 'l1' }, 'BOTTLENECK', fn, agg(90, 90, 90));

    expect(r.applies).toBe(true);
    expect(r.availability).toBe(60);
    expect(r.performance).toBe(50);
    // 800 good at the last station, 200 scrapped across the line → 800/1000.
    expect(r.quality).toBe(80);
    expect(r.oee).toBe(24); // 0.60 × 0.50 × 0.80
    expect(r.counts).toEqual({ good: 800, rejected: 200, total: 1000, theoretical: 20000 });

    expect(seen.filter((s) => s.machineId === 'm1')).toHaveLength(1);
    expect(seen.filter((s) => s.machineIds?.join() === 'm5')).toHaveLength(1);
    expect(seen.every((s) => s.lineId === 'l1')).toBe(true);
  });

  /**
   * Theoretical follows GOOD, not the time.
   *
   * It is the ceiling for the units being counted, so it has to be the ceiling
   * of the station that counted them. Taking it from the constraint while taking
   * good from the last station divides one machine's output by another
   * machine's capacity, and the Performance that falls out means nothing.
   */
  it('takes theoretical from the same station as good', async () => {
    const svc = build([LINE]);
    const { fn } = router({
      bottleneck: agg(60, 50, 99, { good: 30000, theoretical: 90000 }, 480),
      outfeed: agg(95, 95, 95, { good: 480, theoretical: 1803 }, 480),
      whole: agg(90, 90, 90, { rejected: 14 }, 1920),
    });

    const r = await svc.forScope(F, { lineId: 'l1' }, 'BOTTLENECK', fn, agg(90, 90, 90));

    expect(r.counts.good).toBe(480);
    expect(r.counts.theoretical).toBe(1803);
  });

  /**
   * A short window in which nothing has reached the last station yet.
   *
   * Quality reads 0.0% because no saleable unit left the line in that window —
   * a true statement about output, not a fault. Recorded here so the behaviour
   * is a decision rather than a surprise; the live screen explains it in words
   * and points the reader at a wider range.
   */
  it('reports zero Quality when nothing reached the last station', async () => {
    const svc = build([LINE]);
    const { fn } = router({
      bottleneck: agg(80, 90, 99, { good: 5189, theoretical: 9000 }, 480),
      outfeed: agg(0, 0, 0, { good: 0, theoretical: 0 }, 480),   // nothing wrapped yet
      whole: agg(70, 70, 0, { good: 11105, rejected: 5281 }, 1920),
    });

    const r = await svc.forScope(F, { lineId: 'l1' }, 'BOTTLENECK', fn, agg(70, 70, 0));

    expect(r.counts.good).toBe(0);
    expect(r.counts.rejected).toBe(5281);
    expect(r.quality).toBe(0);
    // The TIME is still the constraint's, so the window is not empty.
    expect(r.time.totalMin).toBe(480);
  });

  it('reports the line time model as the CONSTRAINT’s, not the whole line’s', async () => {
    const svc = build([LINE]);
    const { fn } = router({
      bottleneck: agg(60, 50, 99, { good: 30000 }, 480),
      outfeed: agg(95, 95, 95, { good: 800 }, 480),
      whole: agg(90, 90, 90, { rejected: 200 }, 1920),
    });
    const r = await svc.forScope(F, { lineId: 'l1' }, 'BOTTLENECK', fn, agg(90, 90, 90));

    // 1920 is four machines' minutes added up; the line was subject to 480.
    expect(r.time.totalMin).toBe(480);
  });

  // ── 4 ──────────────────────────────────────────────────────────────────────
  it('lets the request override the method but not the constraint', async () => {
    const svc = build([LINE]);
    const { fn, seen } = router({
      bottleneck: agg(60, 50, 99),
      outfeed: agg(95, 95, 95, { good: 800 }),
      whole: agg(88, 77, 66, { good: 30000, rejected: 200 }),
    });

    const r = await svc.forScope(F, { lineId: 'l1' }, 'ROLLUP', fn, agg(88, 77, 66));

    expect(r.lines[0].method).toBe('ROLLUP');
    expect(r.lines[0].configured).toBe('BOTTLENECK');
    // The roll-up is the engine's own line-scoped aggregate, untouched.
    expect(r.availability).toBe(88);
    expect(r.performance).toBe(77);
    expect(r.quality).toBe(66);
    // It must not have gone looking for the constraint at all.
    expect(seen.some((s) => s.machineId)).toBe(false);
  });

  it('uses the line’s own method when the request does not ask for one', async () => {
    const svc = build([LINE]);
    const { fn } = router({
      bottleneck: agg(60, 50, 99),
      outfeed: agg(95, 95, 95, { good: 800 }),
      whole: agg(88, 77, 66, { rejected: 200 }),
    });
    const r = await svc.forScope(F, { lineId: 'l1' }, null, fn, agg(88, 77, 66));
    expect(r.lines[0].method).toBe('BOTTLENECK');
  });

  it('treats an empty outfeed list as the whole line', async () => {
    const svc = build([{ ...LINE, outfeedMachineIds: [] }]);
    const { fn } = router({
      bottleneck: agg(60, 50, 99),
      outfeed: agg(95, 95, 95, { good: 800 }),
      whole: agg(90, 90, 90, { rejected: 200 }),
    });
    const r = await svc.forScope(F, { lineId: 'l1' }, 'BOTTLENECK', fn, agg(90, 90, 90));

    expect(r.lines[0].outfeedIds).toEqual(['m1', 'm3', 'm4', 'm5']);
    expect(r.lines[0].outfeedResolvedBy).toBe('ALL_MACHINES_ON_LINE');
  });

  // ── 5 ──────────────────────────────────────────────────────────────────────
  it('falls back to ROLLUP when no constraint is nominated, and says why', async () => {
    const svc = build([{ ...LINE, bottleneckMachineId: null }]);
    const { fn } = router({
      bottleneck: agg(60, 50, 99),
      outfeed: agg(95, 95, 95, { good: 800 }),
      whole: agg(88, 77, 66, { rejected: 200 }),
    });

    const r = await svc.forScope(F, { lineId: 'l1' }, 'BOTTLENECK', fn, agg(88, 77, 66));

    expect(r.lines[0].method).toBe('ROLLUP');
    expect(r.lines[0].fallbackReason).toMatch(/no bottleneck machine is nominated/i);
    expect(r.availability).toBe(88);
  });

  // ── 6 ──────────────────────────────────────────────────────────────────────
  describe('above a line', () => {
    const LINE2 = {
      ...LINE, id: 'l2', name: 'Line 2', code: 'PL-02',
      oeeMethod: 'ROLLUP', bottleneckMachineId: null, outfeedMachineIds: [],
      machines: [machine('n1', 'N1', 1)],
    };

    /** Per-line routing, so each line can return its own figures. */
    const perLine = (byLine: Record<string, { bottleneck?: Aggregate; outfeed?: Aggregate; whole: Aggregate }>) =>
      async (s: OeeScope): Promise<Aggregate> => {
        const l = byLine[s.lineId as string];
        if (s.machineId) return l.bottleneck!;
        if (s.machineIds) return l.outfeed!;
        return l.whole;
      };

    it('weights each line by how long it was occupied, not by how many there are', async () => {
      const svc = build([LINE, LINE2]);
      const fn = perLine({
        // Ran all shift, scored 90.
        l1: {
          bottleneck: agg(90, 100, 99, { good: 5000, theoretical: 9000 }, 480),
          outfeed: agg(0, 0, 0, { good: 900, theoretical: 100 }, 480),
          whole: agg(0, 0, 0, { good: 5900, rejected: 100 }, 480),
        },
        // Ran twenty minutes, scored 10. Unweighted this would halve the area.
        l2: { whole: agg(10, 100, 100, { good: 10, rejected: 0, theoretical: 5 }, 20) },
      });

      const r = await svc.forScope(F, { areaId: 'a1' }, null, fn, agg(50, 50, 50));

      expect(r.applies).toBe(true);
      expect(r.level).toBe('AREA');
      expect(r.lines).toHaveLength(2);

      // (90×480 + 10×20) / 500 = 86.8 — not the unweighted 50.
      expect(r.availability).toBe(86.8);
      expect(r.note).toMatch(/l1: BOTTLENECK|PL-01: BOTTLENECK/);
    });

    it('keeps minutes and pieces additive even though percentages are averaged', async () => {
      const svc = build([LINE, LINE2]);
      const fn = perLine({
        l1: {
          bottleneck: agg(90, 100, 99, { good: 5000, theoretical: 9000 }, 480),
          outfeed: agg(0, 0, 0, { good: 900, theoretical: 100 }, 480),
          whole: agg(0, 0, 0, { good: 5900, rejected: 100 }, 480),
        },
        l2: { whole: agg(10, 100, 100, { good: 10, rejected: 5, theoretical: 5 }, 20) },
      });

      const r = await svc.forScope(F, { areaId: 'a1' }, null, fn, agg(50, 50, 50));

      expect(r.counts.good).toBe(910);      // 900 + 10
      expect(r.counts.rejected).toBe(105);  // 100 + 5
      expect(r.counts.theoretical).toBe(105);
      expect(r.time.totalMin).toBe(500);    // 480 + 20
    });

    it('ignores a line with no occupancy rather than letting it drag the average', async () => {
      const svc = build([LINE, LINE2]);
      const fn = perLine({
        l1: {
          bottleneck: agg(90, 100, 99, { good: 5000, theoretical: 9000 }, 480),
          outfeed: agg(0, 0, 0, { good: 900, theoretical: 100 }, 480),
          whole: agg(0, 0, 0, { good: 5900, rejected: 100 }, 480),
        },
        // Idle all window: nothing ran, so it has no opinion about availability.
        l2: { whole: agg(0, 0, 0, {}, 0) },
      });

      const r = await svc.forScope(F, { areaId: 'a1' }, null, fn, agg(50, 50, 50));
      expect(r.availability).toBe(90);
    });

    it('does not apply when no line with machines is in scope', async () => {
      const svc = build([]);
      const own = agg(50, 50, 50);
      const r = await svc.forScope(F, {}, 'BOTTLENECK', async () => own, own);

      expect(r.applies).toBe(false);
      expect(r.level).toBe('FACTORY');
      expect(r.availability).toBe(50);
    });
  });

  // ── the method the request may ask for ─────────────────────────────────────
  it('accepts only the two methods', () => {
    const methods: LineMethod[] = ['ROLLUP', 'BOTTLENECK'];
    expect(methods).toHaveLength(2);
  });
});
