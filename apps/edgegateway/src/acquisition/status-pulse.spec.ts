import { StatusService, type StatusTag } from './status.service';

/**
 * Three machine states carried on a single bit.
 *
 * I360's Euro-Pack Robot signal (I/O ID 5):
 *   steady ON — running with product, or ready with none
 *   PULSING   — stop mode
 *   OFF       — alarm or emergency stop
 *
 * Reading the level alone cannot separate running from stopped, because a pulsing
 * signal is high half the time. Sampling it naively reports the machine as
 * alternately running and broken every second, filling the downtime log with
 * one-second events and destroying its availability.
 *
 * So the bit is judged by how often it CHANGES. These tests pin that, including
 * the case that makes the naive implementation look correct — a pulsing signal
 * sampled while it happens to be high.
 */
describe('StatusService — three states on one bit', () => {
  /** No state is written here; only `derive` is under test. */
  function build() {
    const prisma = {
      jobOrder: { count: jest.fn().mockResolvedValue(1) }, // an order IS running
      machineCurrentStatus: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      downtimeEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      workOrder: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    // `stoppedState` now asks the inference service whether the machine has
    // work, instead of running its own job-order query with its own idea of
    // what counts — see one-definition-of-work.spec.ts.
    const inference = {
      classify: jest.fn(async (_m: string, s: string) => s),
      hasWorkScheduled: jest.fn(async () => true),
    };
    const svc = new StatusService(prisma as never, inference as never);
    /** `derive` is private; this is the behaviour under test. */
    const derive = (tag: StatusTag, v: number) => (svc as never as {
      derive(t: StatusTag, n: number): Promise<string | null>;
    }).derive(tag, v);
    return { derive, svc };
  }

  const pulsedTag: StatusTag = {
    tagId: 'euro-pack-run', factoryId: 'f1', machineId: 'm4',
    dataType: 'BOOL', statusMap: null, signalRole: 'RUN_MODE_PULSED',
  };
  const plainTag: StatusTag = {
    tagId: 'cartonPacker-run', factoryId: 'f1', machineId: 'm3',
    dataType: 'BOOL', statusMap: null, signalRole: 'RUN_MODE',
  };

  it('reads a steady HIGH signal as running', async () => {
    const { derive } = build();
    for (let i = 0; i < 10; i++) expect(await derive(pulsedTag, 1)).toBe('RUNNING');
  });

  it('reads a steady LOW signal as a fault', async () => {
    const { derive } = build();
    // First sample is the initial level, so no transition is recorded.
    await derive(pulsedTag, 0);
    expect(await derive(pulsedTag, 0)).toBe('BREAKDOWN');
  });

  it('reads a PULSING signal as stop mode, not as running or broken', async () => {
    const { derive } = build();
    let last: string | null = null;
    // Four full cycles — well past the edge threshold.
    for (let i = 0; i < 8; i++) last = await derive(pulsedTag, i % 2);
    expect(last).toBe('IDLE');
  });

  it('still reports stop mode when the pulse is sampled while HIGH', async () => {
    // The case that makes a level-only implementation look correct: the signal is
    // oscillating, and this particular sample lands on the high half.
    const { derive } = build();
    for (let i = 0; i < 8; i++) await derive(pulsedTag, i % 2);
    expect(await derive(pulsedTag, 1)).toBe('IDLE');
  });

  it('recovers to running once the signal settles high again', async () => {
    const { derive } = build();
    for (let i = 0; i < 8; i++) await derive(pulsedTag, i % 2);
    expect(await derive(pulsedTag, 1)).toBe('IDLE');

    // The window is time-based, so advance the clock rather than the sample count.
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    try {
      expect(await derive(pulsedTag, 1)).toBe('RUNNING');
    } finally {
      Date.now = realNow;
    }
  });

  it('does not treat a single start or stop as pulsing', async () => {
    // One machine stopping and restarting is two edges, not a pulse train.
    const { derive } = build();
    await derive(pulsedTag, 1);
    await derive(pulsedTag, 0);
    expect(await derive(pulsedTag, 1)).toBe('RUNNING');
  });

  it('leaves a plain RUN_MODE bit alone — no pulse logic applied', async () => {
    // Carton Packer's signal has two states. Oscillation there is a machine starting and
    // stopping, and must be reported as exactly that.
    const { derive } = build();
    for (let i = 0; i < 8; i++) await derive(plainTag, i % 2);
    expect(await derive(plainTag, 1)).toBe('RUNNING');
    expect(await derive(plainTag, 0)).toBe('BREAKDOWN');
  });

  it('keeps RUN_MODE ON meaning ABLE to work, not necessarily working', async () => {
    // I360: "ON: running/ready, INCLUDING the condition where the machine is ready
    // but no product is currently being processed." Whether it is actually working
    // is decided later, by the PROCESSING signal.
    const { derive } = build();
    expect(await derive(plainTag, 1)).toBe('RUNNING');
  });
});

/**
 * The gap every test above leaves open.
 *
 * Each of them calls `derive` once per LEVEL CHANGE, which quietly assumes the
 * gateway sees every edge. In the field `derive` is called once per POLL, and an
 * edge that falls between two polls did not happen as far as the detector is
 * concerned. A signal can therefore be wired correctly, configured correctly and
 * pulsing correctly, and still report RUNNING for ever.
 *
 * That is what was reported from the line on 19 Aug 2026: the lamp was flashed,
 * and the machine never left RUNNING.
 */
describe('StatusService — sampling a flashing lamp', () => {
  function build() {
    const prisma = {
      jobOrder: { count: jest.fn().mockResolvedValue(1) },
      machineCurrentStatus: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      downtimeEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn(), update: jest.fn() },
      workOrder: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    // `stoppedState` now asks the inference service whether the machine has
    // work, instead of running its own job-order query with its own idea of
    // what counts — see one-definition-of-work.spec.ts.
    const inference = {
      classify: jest.fn(async (_m: string, s: string) => s),
      hasWorkScheduled: jest.fn(async () => true),
    };
    const svc = new StatusService(prisma as never, inference as never);
    const derive = (tag: StatusTag, v: number) => (svc as never as {
      derive(t: StatusTag, n: number): Promise<string | null>;
    }).derive(tag, v);
    return { derive, svc };
  }

  const pulsed: StatusTag = {
    tagId: 'm4-run', factoryId: 'f1', machineId: 'm4',
    dataType: 'BOOL', statusMap: null, signalRole: 'RUN_MODE_PULSED',
    pulseWindowMs: 6000, pulseMinEdges: 4,
  };

  /**
   * Poll a 1 Hz lamp — 500 ms high, 500 ms low — at a given sample interval,
   * with the clock advancing exactly as it would on the line.
   */
  async function poll(
    derive: (t: StatusTag, v: number) => Promise<string | null>,
    sampleMs: number, forMs: number,
  ): Promise<string | null> {
    const HALF_PERIOD_MS = 500;
    const realNow = Date.now;
    const t0 = realNow();
    let last: string | null = null;
    try {
      for (let elapsed = 0; elapsed <= forMs; elapsed += sampleMs) {
        Date.now = () => t0 + elapsed;
        const high = Math.floor(elapsed / HALF_PERIOD_MS) % 2 === 0;
        last = await derive(pulsed, high ? 1 : 0);
      }
    } finally {
      Date.now = realNow;
    }
    return last;
  }

  it('sees the flash when sampled fast enough', async () => {
    // 100 ms — five samples per half-cycle. This is what an EdgeCounter device
    // polls at by default, and it resolves the lamp comfortably.
    const { derive } = build();
    expect(await poll(derive, 100, 10_000)).toBe('IDLE');
  });

  it('reports RUNNING for ever when sampled at the flash rate', async () => {
    // 1000 ms against a 1 Hz lamp lands on the same phase of every cycle. The bit
    // reads as a constant — and a pulsing signal is high half the time, so the
    // constant it reads is "on". No pulse window or edge count can recover an
    // edge that was never sampled; this is a property of the sample rate alone.
    const { derive } = build();
    expect(await poll(derive, 1000, 60_000)).toBe('RUNNING');
  });

  it('is unreliable at exactly Nyquist', async () => {
    // 500 ms is precisely the half-period — the boundary case that looks
    // reasonable on paper and cannot be depended on. Whatever it reports, it is
    // not a rate anyone should configure.
    const { derive } = build();
    const state = await poll(derive, 500, 60_000);
    expect(['RUNNING', 'IDLE']).toContain(state);
  });

  // ── Making the failure visible ──────────────────────────────────────────────
  it('reports the sample rate it actually achieved, not the one configured', async () => {
    // The number that matters is measured: a device set to 100 ms whose block
    // read takes 400 ms is sampling at 400 ms, and nothing else in the gateway
    // says so.
    const { derive, svc } = build();
    await poll(derive, 1000, 10_000);

    const [d] = svc.pulseDiagnostics();
    expect(d.observedSampleMs).toBe(1000);
    expect(d.fastestResolvableFlashHz).toBeLessThan(1); // cannot see a 1 Hz lamp
  });

  it('separates "no signal arriving" from "signal too fast to see"', async () => {
    // The two field faults that look identical from every screen. A stuck bit
    // never changes; an aliased one changes and is never sampled changing. Only
    // the edge count tells them apart, and the operator needs that distinction
    // to know whether to look at the wiring or at the poll rate.
    const stuck = build();
    for (let i = 0; i < 20; i++) await stuck.derive(pulsed, 1);
    expect(stuck.svc.pulseDiagnostics()[0].everSawAnEdge).toBe(false);

    const aliased = build();
    await poll(aliased.derive, 1000, 60_000);
    expect(aliased.svc.pulseDiagnostics()[0].everSawAnEdge).toBe(false);
    expect(aliased.svc.pulseDiagnostics()[0].observedSampleMs).toBe(1000);
  });

  it('shows a healthy signal as pulsing, with the edges it counted', async () => {
    const { derive, svc } = build();
    await poll(derive, 100, 10_000);

    const [d] = svc.pulseDiagnostics();
    expect(d.pulsing).toBe(true);
    expect(d.edgesInWindow).toBeGreaterThanOrEqual(d.minEdges);
    expect(d.machineId).toBe('m4');
  });
});
