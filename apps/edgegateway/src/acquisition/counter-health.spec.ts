import { CounterService } from './counter.service';

/**
 * Telling a broken sensor from a slow poll — replayed from the real capture.
 *
 * ── The investigation this encodes ──────────────────────────────────────────
 * SDPF's first machine has two counters a few centimetres apart, watching the
 * same cartons: one wired as the total, one as the good count. The total
 * reported a fraction of the good one, and the obvious suspects — wrong
 * address, wrong edge type, a slow poll — were all wrong.
 *
 * A 44-second capture of the raw inputs settled it (modbus-log 2026-08-23
 * 22:56). Sampling every 96 ms:
 *
 *   Addr 1 (good)   HIGH 39% of the time,  28 edges,  active level 607 ms
 *   Addr 0 (total)  HIGH 99% of the time,   5 edges,  active level  98 ms
 *                                                     and EVERY one of those
 *                                                     five lasted exactly one
 *                                                     sample
 *
 * Four of the five landed within one sample of an Addr-1 edge, so both were
 * watching the same stream. A level never seen for more than one sample is
 * shorter than the interval and cannot be measured by it — and the capture
 * ratio gives its width: 5/28 = 18%, times 96 ms, is about 17 ms. Against the
 * other sensor's 607 ms. A thirty-five-fold difference in pulse width, on the
 * same cartons. No poll rate reachable over Modbus fixes that; the sensor does.
 *
 * These tests replay both signals and require the gateway to reach the same
 * conclusion on its own, so the next line does not need the investigation.
 */
describe('counter health', () => {
  let seq = 0;
  const freshConfig = () => ({
    get: () => `${require('os').tmpdir()}/mes-counter-health-${process.pid}-${(seq += 1)}`,
  });

  const prismaStub = () => ({
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
    jobOrder: { findMany: jest.fn(async () => []), findUnique: jest.fn(async () => null) },
    machineCurrentStatus: { findMany: jest.fn(async () => []) },
    gatewayCounterState: { findUnique: jest.fn(async () => null), upsert: jest.fn(async () => ({})) },
  }) as any;

  const tag = (id: string, role: string) => ({
    id, machineId: 'm1', factoryId: 'f1', counterRole: role, edgeType: 'RISING', code: id,
  }) as never;

  /** Feed a signal sampled every `intervalMs`, advancing a fake clock. */
  function replay(svc: CounterService, t: unknown, levels: boolean[], intervalMs: number, clock: { now: number }) {
    for (const lv of levels) {
      clock.now += intervalMs;
      svc.observe(t as never, lv, new Date(clock.now).toISOString());
    }
  }

  /** `period` samples per cycle, `active` of them at the counted level. */
  const square = (cycles: number, period: number, active: number) => {
    const out: boolean[] = [];
    for (let c = 0; c < cycles; c += 1) {
      for (let i = 0; i < period; i += 1) out.push(i < active);
    }
    return out;
  };

  function withClock() {
    const clock = { now: Date.UTC(2026, 7, 23, 22, 56, 40) };
    const real = Date.now;
    Date.now = () => clock.now;
    return { clock, restore: () => { Date.now = real; } };
  }

  it('calls a healthy counter healthy', async () => {
    // Addr 1's shape: roughly 600ms active, 780ms idle, at a 96ms sample. Six
    // samples of signal per pulse — nothing marginal about it.
    const { clock, restore } = withClock();
    try {
      const svc = new CounterService(prismaStub(), freshConfig() as never);
      const t = tag('good', 'GOOD');
      svc.observe(t, false, new Date(clock.now).toISOString());
      await new Promise((r) => setTimeout(r, 60));
      replay(svc, t, square(20, 14, 6), 96, clock);

      const d = svc.counterDiagnostics().find((x) => x.tagId === 'good')!;
      expect(d.verdict).toBe('OK');
      expect(d.aliasing).toBe(false);
      expect(d.shortestActiveSamples).toBeGreaterThan(1);
    } finally { restore(); }
  });

  it('flags a signal whose pulse is never longer than one sample', async () => {
    // Addr 0's shape: active for a single sample, then idle for a long time.
    // The gateway cannot know how short the real pulse is — only that it is
    // shorter than the interval, which is exactly what it must say.
    const { clock, restore } = withClock();
    try {
      const svc = new CounterService(prismaStub(), freshConfig() as never);
      const t = tag('total', 'TOTAL');
      svc.observe(t, false, new Date(clock.now).toISOString());
      await new Promise((r) => setTimeout(r, 60));
      replay(svc, t, square(12, 28, 1), 96, clock);

      const d = svc.counterDiagnostics().find((x) => x.tagId === 'total')!;
      expect(d.verdict).toBe('ALIASING');
      expect(d.aliasing).toBe(true);
      expect(d.shortestActiveSamples).toBe(1);
    } finally { restore(); }
  });

  it('measures the sample interval and the duty cycle it actually saw', async () => {
    const { clock, restore } = withClock();
    try {
      const svc = new CounterService(prismaStub(), freshConfig() as never);
      const t = tag('good', 'GOOD');
      svc.observe(t, false, new Date(clock.now).toISOString());
      await new Promise((r) => setTimeout(r, 60));
      replay(svc, t, square(20, 10, 4), 96, clock);

      const d = svc.counterDiagnostics().find((x) => x.tagId === 'good')!;
      expect(d.sampleIntervalMs).toBe(96);
      // 4 of every 10 samples at the counted level, as fed.
      expect(d.activePct).toBeGreaterThanOrEqual(38);
      expect(d.activePct).toBeLessThanOrEqual(42);
    } finally { restore(); }
  });

  it('separates the two by verdict when both run on one machine', async () => {
    // The pair as they are on the line. What matters is that the gateway does
    // not report them the same way — one is usable and one is not.
    const { clock, restore } = withClock();
    try {
      const svc = new CounterService(prismaStub(), freshConfig() as never);
      const good = tag('good', 'GOOD');
      const total = tag('total', 'TOTAL');
      svc.observe(good, false, new Date(clock.now).toISOString());
      svc.observe(total, false, new Date(clock.now).toISOString());
      await new Promise((r) => setTimeout(r, 60));

      // Interleaved on one clock, as the poller reads them in one block.
      const g = square(20, 14, 6);
      const tt = square(20, 14, 1);
      for (let i = 0; i < g.length; i += 1) {
        clock.now += 96;
        svc.observe(good, g[i], new Date(clock.now).toISOString());
        svc.observe(total, tt[i], new Date(clock.now).toISOString());
      }

      const diags = svc.counterDiagnostics();
      const dg = diags.find((x) => x.tagId === 'good')!;
      const dt = diags.find((x) => x.tagId === 'total')!;
      expect(dg.verdict).toBe('OK');
      expect(dt.verdict).toBe('ALIASING');
      // Same stream, same rate — the counts must NOT be what separates them.
      expect(dg.edgesPerMin).toBeCloseTo(dt.edgesPerMin!, 0);
    } finally { restore(); }
  });

  it('says nothing about a counter it has not watched change', async () => {
    // No claim without evidence. A tag sitting at one level has not shown the
    // gateway anything, and reporting it as healthy would be an invention.
    const svc = new CounterService(prismaStub(), freshConfig() as never);
    const t = tag('idle', 'GOOD');
    svc.observe(t, false, new Date().toISOString());
    await new Promise((r) => setTimeout(r, 60));
    for (let i = 0; i < 30; i += 1) svc.observe(t, false, new Date().toISOString());

    const d = svc.counterDiagnostics().find((x) => x.tagId === 'idle')!;
    expect(d.verdict).toBe('UNKNOWN');
  });

  it('grades the SHORTER level, not the louder one', async () => {
    // The trap the plant's capture sprang, and the reason this test exists.
    //
    // Addr 0 is a normally-CLOSED sensor: it rests HIGH for seconds and the
    // event is a brief drop. A first version of this diagnostic measured the
    // "active" (high) level, saw 2958 ms of resting state, and pronounced a
    // sensor healthy whose real pulse was under one sample.
    //
    // Detecting an edge means seeing the level BEFORE it and the level AFTER
    // it, so the limit is whichever of the two is shorter — whatever its
    // polarity.
    const { clock, restore } = withClock();
    try {
      const svc = new CounterService(prismaStub(), freshConfig() as never);
      const t = tag('nc', 'TOTAL');
      svc.observe(t, true, new Date(clock.now).toISOString());
      await new Promise((r) => setTimeout(r, 60));

      // 27 samples high, 1 sample low — the shape of the real Addr 0.
      const levels: boolean[] = [];
      for (let c = 0; c < 12; c += 1) {
        for (let i = 0; i < 28; i += 1) levels.push(i < 27);
      }
      replay(svc, t, levels, 96, clock);

      const d = svc.counterDiagnostics().find((x) => x.tagId === 'nc')!;
      expect(d.activePct).toBeGreaterThan(90);        // looks busy and healthy
      expect(d.medianActiveMs).toBeLessThan(200);     // but the limit is the drop
      expect(d.verdict).toBe('ALIASING');
    } finally { restore(); }
  });
});
