import { LineBalanceService } from './line-balance.service';

/**
 * Bounding counters against the material between them.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Material flows M1 -> M2 -> M3 -> M4, and the belts between two machines hold
 * what the first made and the second has not taken yet. So relative to a chosen
 * reference machine:
 *
 *     a machine BEFORE it must stand AHEAD by every belt in between
 *     a machine AFTER  it must stand BEHIND by the same reasoning
 *
 * The balance enforces those two limits and NOTHING else. A machine that
 * already satisfies its bound is left completely alone.
 *
 * ── What this replaced, and why ─────────────────────────────────────────────
 * The first version chained: each machine was measured against its NEIGHBOUR'S
 * already-corrected figure. Two faults, and the plant saw both.
 *
 * It carried one machine's error into the judgement of the next, which defeats
 * the point of naming a reference — the reference, and nothing else, is what
 * the line is measured against. And because each link was settled before the
 * next was considered, every machine was pulled onto the same number: on
 * 24 Aug the line read 17,340 / 17,492 / 17,600 / 19,520 and the balance made
 * all four exactly 17,600. That is not a limit being enforced, it is equality
 * being imposed, and the two are not the same thing.
 *
 * The failure mode here is a number that looks reasonable, so the figures below
 * are the plant's own and were checked by hand.
 */
describe('line balance', () => {
  const I360 = { unitsPerInner: 1, innersPerCarton: 4, cartonsPerPallet: 40, baseUnit: 'CARTON' };

  function build(
    steps: Array<{ code: string; unit: string; good: number; reject?: number }>,
    cfg: Array<Partial<Record<string, unknown>>> = [],
  ) {
    const counts: any = {
      balance: async () => [{
        workOrderId: 'wo-1', orderNumber: 'WO-1',
        skuCode: 'S', skuName: 'S', packaging: I360,
        ladder: { PIECE: 1, INNER: 1, CARTON: 4, PALLET: 160 },
        commonUnit: 'INNER',
        steps: steps.map((s, i) => {
          const mul = s.unit === 'CARTON' ? 4 : s.unit === 'PALLET' ? 160 : 1;
          const reject = s.reject ?? 0;
          return {
            jobOrderId: `jo-${i}`, sequenceOrder: i + 1, operationName: 'Op',
            machineId: s.code, machineCode: s.code, machineName: s.code,
            unit: s.unit, good: s.good, reject, total: s.good + reject,
            goodCommon: s.good * mul, rejectCommon: reject * mul,
            totalCommon: (s.good + reject) * mul,
            diffFromPrev: null, unconvertible: false,
          };
        }),
      }],
    };
    const prisma: any = {
      lineBalanceConfig: {
        findMany: async () => cfg.map((c) => ({
          machineId: c.machineId, enabled: c.enabled ?? true, isAnchor: c.isAnchor ?? false,
          bufferToNextQty: c.bufferToNextQty ?? null, bufferUnit: c.bufferUnit ?? null,
          transitSec: null,
          maxCorrectionPct: c.maxCorrectionPct ?? 10, applyAdjustment: false,
        })),
      },
    };
    return new LineBalanceService(prisma, { getFactoryId: () => 'f1' } as any, counts);
  }

  const at = (run: any, code: string) => run.steps.find((s: any) => s.machineCode === code);

  /** The plant's line as configured on 24 Aug: 12 inners, 40 cartons, 1 pallet. */
  const SDPF = (m1: number, m2: number, m3: number, m4: number) => build(
    [
      { code: 'M1', unit: 'INNER', good: m1 },
      { code: 'M2', unit: 'CARTON', good: m2 },
      { code: 'M3', unit: 'PALLET', good: m3 },
      { code: 'M4', unit: 'PALLET', good: m4 },
    ],
    [
      { machineId: 'M1', bufferToNextQty: 12, bufferUnit: 'INNER', maxCorrectionPct: 100 },
      { machineId: 'M2', bufferToNextQty: 40, bufferUnit: 'CARTON', maxCorrectionPct: 100 },
      { machineId: 'M3', bufferToNextQty: 1, bufferUnit: 'PALLET', isAnchor: true },
      { machineId: 'M4', maxCorrectionPct: 100 },
    ],
  );

  it('leaves a machine that already satisfies its bound completely alone', async () => {
    // The correction the plant asked about. With the anchor at 110 pallets
    // (17,600), the filler is allowed to stand 12 + 160 = 172 inners ahead of
    // it and the cartoner 160 ahead. Every machine here is inside its bound, so
    // not one is touched — where the chained version dragged all four onto the
    // same figure.
    const svc = SDPF(17_772, 4_440, 110, 109);
    const [run] = await svc.balance();

    expect(at(run, 'M1').verdict).toBe('BALANCED');
    expect(at(run, 'M2').verdict).toBe('BALANCED');
    expect(at(run, 'M4').verdict).toBe('BALANCED');
    expect(run.totalCorrection).toBe(0);
  });

  it('raises an upstream machine only as far as its own bound', async () => {
    // The plant's live figures. The filler must be at least anchor + 172 and
    // reads 17,340, so it is 432 short — not the 260 that merely levelled it
    // with the anchor.
    const svc = SDPF(17_340, 4_373, 110, 110);
    const [run] = await svc.balance();

    const m1 = at(run, 'M1');
    expect(m1.explainedByBuffer).toBe(172);           // 12 inners + 40 cartons
    expect(m1.unexplained).toBe(432);
    expect(m1.balancedCommon).toBe(17_772);
    // Landing exactly 172 ahead of the anchor is the whole claim.
    expect(m1.balancedCommon - at(run, 'M3').goodCommon).toBe(172);
  });

  it('measures every machine against the ANCHOR, not against its neighbour', async () => {
    // The cartoner is badly wrong; the filler is fine. A chain would carry the
    // cartoner's error into the filler's judgement. Measuring both against the
    // reference keeps one broken counter from moving another machine's number.
    const svc = SDPF(17_772, 1_000, 110, 109);
    const [run] = await svc.balance();

    expect(at(run, 'M2').verdict).toBe('CLAMPED');    // 4,000 against a bound of 17,760
    expect(at(run, 'M1').verdict).toBe('BALANCED');
    expect(at(run, 'M1').correction).toBe(0);
  });

  it('pulls a downstream machine down to its bound', async () => {
    // The wrapper says 122 pallets against the palletiser's 110. It cannot wrap
    // pallets that were never made, whatever is sitting on the belt.
    const svc = SDPF(17_772, 4_440, 110, 122);
    const [run] = await svc.balance();

    const m4 = at(run, 'M4');
    expect(m4.explainedByBuffer).toBe(160);
    expect(m4.unexplained).toBe(1_920);               // 19,520 - 17,600
    expect(m4.balancedCommon).toBe(17_600);
    expect(m4.correction).toBe(-1_920);
    // The anchor itself is the ceiling. A belt between them holds pallets the
    // palletiser MADE and the wrapper has not taken, so it makes room below
    // that figure and never above it.
    expect(m4.balancedCommon - at(run, 'M3').goodCommon).toBe(0);
  });

  it('never touches the anchor', async () => {
    const svc = SDPF(1_000, 100, 110, 100);
    const [run] = await svc.balance();
    expect(at(run, 'M3').verdict).toBe('ANCHOR');
    expect(at(run, 'M3').correction).toBe(0);
  });

  it('clamps at the ceiling and reports what it refused', async () => {
    // A sensor drifting far past its ceiling is a maintenance problem. Capping
    // it quietly would hide the fault this exists to expose, so the figure it
    // wanted is named.
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 1_000 }, { code: 'M2', unit: 'INNER', good: 1_500 }],
      [
        { machineId: 'M1', bufferToNextQty: 0, bufferUnit: 'INNER', maxCorrectionPct: 5 },
        { machineId: 'M2', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();

    const m1 = at(run, 'M1');
    expect(m1.verdict).toBe('CLAMPED');
    expect(m1.requestedCorrection).toBe(500);
    expect(m1.correction).toBe(50);
    expect(m1.reason).toContain('500');
  });

  it('refuses to balance across a belt whose capacity is unknown', async () => {
    // One unmeasured belt anywhere between a machine and the anchor makes the
    // whole allowance unknown. An unmeasured conveyor is not an empty one, and
    // guessing it holds nothing turns work-in-progress into a false correction.
    const svc = build(
      [
        { code: 'M1', unit: 'INNER', good: 800 },
        { code: 'M2', unit: 'INNER', good: 900 },
        { code: 'M3', unit: 'INNER', good: 1_000 },
      ],
      [
        { machineId: 'M1', bufferToNextQty: 50, bufferUnit: 'INNER' },
        { machineId: 'M2' },                          // the M2 -> M3 belt is unknown
        { machineId: 'M3', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();

    expect(at(run, 'M2').verdict).toBe('UNCONFIGURED');
    // M1 is two links away and one of them is unknown, so it cannot be judged
    // either — the span it would be measured across is not a known quantity.
    expect(at(run, 'M1').verdict).toBe('UNCONFIGURED');
    expect(run.totalCorrection).toBe(0);
  });

  it('leaves a machine alone when its balancing is switched off', async () => {
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 800 }, { code: 'M2', unit: 'INNER', good: 1_000 }],
      [
        { machineId: 'M1', bufferToNextQty: 50, bufferUnit: 'INNER', enabled: false },
        { machineId: 'M2', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();
    expect(at(run, 'M1').verdict).toBe('DISABLED');
    expect(at(run, 'M1').correction).toBe(0);
  });

  it('counts scrap at the anchor as material the line upstream had to make', async () => {
    // A unit the anchor rejected was still produced by everything before it, so
    // the upstream bound is measured against what the anchor HANDLED, not only
    // against what it passed on.
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 1_000 }, { code: 'M2', unit: 'INNER', good: 950, reject: 50 }],
      [
        { machineId: 'M1', bufferToNextQty: 0, bufferUnit: 'INNER' },
        { machineId: 'M2', isAnchor: true },
      ],
    );
    const [run] = await svc.balance();
    // 950 good + 50 scrap = 1,000 handled, and M1 made exactly that.
    expect(at(run, 'M1').verdict).toBe('BALANCED');
  });

  it('converts a capacity from the unit it was measured in', async () => {
    const svc = SDPF(17_772, 4_440, 110, 109);
    const [run] = await svc.balance();
    expect(at(run, 'M1').bufferCommon).toBe(12);
    expect(at(run, 'M2').bufferCommon).toBe(160);     // 40 cartons
    expect(at(run, 'M3').bufferCommon).toBe(160);     // 1 pallet
  });

  it('falls back to the end of the line when no anchor is configured', async () => {
    const svc = build(
      [{ code: 'M1', unit: 'INNER', good: 900 }, { code: 'M2', unit: 'INNER', good: 1_000 }],
      [{ machineId: 'M1', bufferToNextQty: 0, bufferUnit: 'INNER', maxCorrectionPct: 100 }],
    );
    const [run] = await svc.balance();
    expect(run.anchorMachineId).toBe('M2');
    expect(at(run, 'M1').correction).toBe(100);
  });
});
