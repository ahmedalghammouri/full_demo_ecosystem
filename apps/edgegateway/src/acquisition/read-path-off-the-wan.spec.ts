import { ModbusPollerService } from './modbus-poller.service';

/**
 * The Modbus read path must not wait on the server.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * Every poll cycle fanned each reading out to the current-value table, the
 * historian, MQTT, machine state and alarms — all of which live on the far side
 * of the plant's internet link — and then AWAITED them before releasing
 * `dev.busy`. The next Modbus sample could not start until that returned.
 *
 * On site (23 Aug 2026, out.log) that made a device configured for a 100 ms
 * poll actually sample every ~430 ms, and the gateway said so itself:
 *
 *   EDGECOUNTER01: poll cycle 529ms exceeds its 100ms interval
 *                  — 456 sample(s) skipped since the last report
 *
 * 456 skipped out of 600 expected in a minute. A carton counter whose contact
 * closes for a fraction of that is then read as a flat TRUE, and the plant's
 * 44 cartons were recorded as 4.
 *
 * Two round-trips had been hiding inside that wait — a read-before-write in
 * `writeCurrentValue`, and another in the status apply — but removing them only
 * shortens the wait. What fixes it is that the read path stops waiting at all:
 * deferred work is queued and drained separately.
 *
 * This test holds that open. It makes every server call take far longer than a
 * poll interval and asserts the cycle still returns promptly — so re-awaiting
 * the network inside the read loop fails here rather than in the plant.
 */
describe('the read path does not wait on the network', () => {
  /** Far longer than any poll interval — stands in for a slow WAN hop. */
  const WAN_MS = 400;
  const slow = () => new Promise((r) => setTimeout(r, WAN_MS));

  function build() {
    const calls = { ingest: 0, status: 0, alarms: 0 };
    const ingest: any = { ingest: jest.fn(async () => { calls.ingest += 1; await slow(); }) };
    const statusSvc: any = { process: jest.fn(async () => { calls.status += 1; await slow(); return null; }) };
    const alarms: any = { evaluate: jest.fn(async () => { calls.alarms += 1; await slow(); }) };
    const counter: any = { observe: jest.fn() };
    const prisma: any = { device: { update: jest.fn(async () => ({})) } };
    const mqtt: any = { publish: jest.fn(() => true) };
    const energy: any = { process: jest.fn(async () => null) };
    const mlog: any = { log: jest.fn() };
    const ctx: any = {};
    const config: any = { get: () => undefined };

    const poller = new ModbusPollerService(
      prisma, mqtt, ingest, counter, energy, statusSvc, alarms, ctx, config, mlog,
    );
    return { poller, calls, ingest, statusSvc, alarms, counter };
  }

  function tag(id: string, address: number) {
    return {
      binding: { id, address, registerType: 'DISCRETE', dataType: 'BOOL' },
      tagId: id, code: id, factoryId: 'f1', machineId: 'm1', machineCode: 'M1',
      isCounter: true,
      counterTag: { id, machineId: 'm1', role: 'TOTAL', edgeType: 'RISING' },
      energyRole: null, historize: true,
      mqttPublishMode: 'CHANGE', mqttPublishRateSec: 0,
      historizationMode: 'CHANGE', historizationRateSec: 0,
      deadband: null,
      isMachineStatus: true,
      statusTag: { machineId: 'm1', factoryId: 'f1' },
    } as any;
  }

  function runtime(tags: any[]) {
    return {
      id: 'dev-1', name: 'EDGECOUNTER01',
      client: {
        // A real block read of six discrete inputs on a LAN is a few ms.
        readTagsBlocked: jest.fn(async (bindings: any[]) => {
          await new Promise((r) => setTimeout(r, 5));
          const out = new Map();
          for (const b of bindings) {
            out.set(b.id, { raw: true, value: true, quality: 'GOOD', timestamp: new Date() });
          }
          return out;
        }),
      },
      tags, meter: null, intervalMs: 100, timer: null, busy: false,
      outbox: [], draining: false, dropped: 0, signature: 's',
    } as any;
  }

  it('returns in around the Modbus round-trip, not the server round-trip', async () => {
    const { poller } = build();
    const dev = runtime([tag('t1', 0), tag('t2', 1), tag('t3', 2)]);

    const started = Date.now();
    await (poller as any).pollDevice(dev);
    const took = Date.now() - started;

    // Nine deferred server calls of 400 ms each sit behind this cycle. If any of
    // them is awaited on the read path the number below is at least WAN_MS.
    expect(took).toBeLessThan(WAN_MS);
    expect(dev.busy).toBe(false);
  });

  it('counts the edge from the sample itself, before anything can await', async () => {
    const { poller, counter } = build();
    const dev = runtime([tag('t1', 0)]);

    await (poller as any).pollDevice(dev);

    // Counting is synchronous inside the read loop: by the time the cycle is
    // over the edge has already been taken, with no server call in between.
    expect(counter.observe).toHaveBeenCalledTimes(1);
  });

  it('still performs the deferred work, just off the read path', async () => {
    const { poller, calls } = build();
    const dev = runtime([tag('t1', 0), tag('t2', 1)]);

    await (poller as any).pollDevice(dev);
    // Queued, not yet settled.
    expect(dev.outbox.length + calls.ingest).toBeGreaterThan(0);

    // Let the drain finish and confirm nothing was silently dropped.
    await new Promise((r) => setTimeout(r, WAN_MS * 3));
    expect(calls.ingest).toBe(2);
    expect(calls.status).toBe(2);
    expect(calls.alarms).toBe(2);
    expect(dev.outbox.length).toBe(0);
  });

  it('does not let a stalled link grow the queue without bound', async () => {
    const { poller } = build();
    const dev = runtime([tag('t1', 0)]);
    const cap = (ModbusPollerService as any).MAX_OUTBOX;

    // Far more cycles than the cap, with the link never keeping up.
    for (let i = 0; i < cap + 500; i += 1) {
      (poller as any).enqueue(dev, [async () => { await slow(); }]);
    }

    expect(dev.outbox.length).toBeLessThanOrEqual(cap);
    expect(dev.dropped).toBeGreaterThan(0);
  });

  /**
   * Sampling and reporting are different rates, and the counter keeps the fast one.
   *
   * ── The defect this pins ────────────────────────────────────────────────────
   * Once the read loop stopped waiting on the server it ran ~37 times a second,
   * and every one of those cycles queued a database write, a status evaluation
   * and an alarm check per tag — roughly 550 jobs a second across six tags,
   * against a link that could carry a fraction of it. The gateway reported the
   * result itself on 23 Aug 2026:
   *
   *   EDGECOUNTER01: 177723 queued write(s) discarded
   *
   * Counts survived that (they accumulate in memory and flush on their own
   * timer) but machine state and alarms were in the discarded pile.
   *
   * The fix is that only COUNTING runs at wire speed. Reporting happens on a
   * change, plus a heartbeat so a steady value still refreshes and time-based
   * rules still run. These tests hold both halves: the counter must see every
   * sample, and a value standing still must stop generating traffic.
   */
  describe('reporting is gated, counting is not', () => {
    /**
     * Doubles that return at once. The gating tests count HOW MANY times the
     * server layer is asked, so the outbox must be allowed to empty between
     * samples — measuring its length instead would just race the drain.
     */
    function fastBuild() {
      const ingest: any = { ingest: jest.fn(async () => {}) };
      const statusSvc: any = { process: jest.fn(async () => null) };
      const alarms: any = { evaluate: jest.fn(async () => {}) };
      const counter: any = { observe: jest.fn() };
      const prisma: any = { device: { update: jest.fn(async () => ({})) } };
      const mqtt: any = { publish: jest.fn(() => true) };
      const energy: any = { process: jest.fn(async () => null) };
      const mlog: any = { log: jest.fn() };
      const poller = new ModbusPollerService(
        prisma, mqtt, ingest, counter, energy, statusSvc, alarms, {} as any, { get: () => undefined } as any, mlog,
      );
      return { poller, ingest, statusSvc, alarms, counter };
    }

    /** Let the outbox drain settle before counting. */
    const settle = () => new Promise((r) => setTimeout(r, 5));

    function feed(dev: any, values: boolean[]) {
      let i = 0;
      dev.client.readTagsBlocked = jest.fn(async (bindings: any[]) => {
        const v = values[Math.min(i, values.length - 1)];
        i += 1;
        const out = new Map();
        for (const b of bindings) out.set(b.id, { raw: v, value: v, quality: 'GOOD', timestamp: new Date() });
        return out;
      });
      return dev;
    }

    it('observes every sample even when the value never moves', async () => {
      const { poller, counter } = fastBuild();
      const dev = feed(runtime([tag('t1', 0)]), [true]);

      for (let n = 0; n < 10; n += 1) { await (poller as any).pollDevice(dev); await settle(); }

      // Ten reads, ten observations. Counting must never be gated: the edge it
      // is watching for can only be seen in the sample it happens in.
      expect(counter.observe).toHaveBeenCalledTimes(10);
    });

    it('stops asking the server while the value stands still', async () => {
      const { poller, ingest, statusSvc, alarms } = fastBuild();
      const dev = feed(runtime([tag('t1', 0)]), [true]);

      for (let n = 0; n < 10; n += 1) { await (poller as any).pollDevice(dev); await settle(); }

      // The first reading is new and is reported. The nine identical ones that
      // follow it, inside the heartbeat window, say nothing new — and used to
      // cost three server calls each.
      expect(ingest.ingest).toHaveBeenCalledTimes(1);
      expect(statusSvc.process).toHaveBeenCalledTimes(1);
      expect(alarms.evaluate).toHaveBeenCalledTimes(1);
    });

    it('reports every value the gateway can see change', async () => {
      const { poller, ingest } = fastBuild();
      // Alternating on every sample — the worst case for a gate that batches.
      const dev = feed(runtime([tag('t1', 0)]), [true, false, true, false, true, false]);

      for (let n = 0; n < 6; n += 1) { await (poller as any).pollDevice(dev); await settle(); }

      // Six distinct readings, six reports. A transition the wire showed us is
      // never dropped — only repetition is.
      expect(ingest.ingest).toHaveBeenCalledTimes(6);
    });

    it('still refreshes a motionless value on the heartbeat', async () => {
      const { poller, ingest } = fastBuild();
      const dev = feed(runtime([tag('t1', 0)]), [true]);
      const beat = (ModbusPollerService as any).DISPATCH_HEARTBEAT_MS;

      await (poller as any).pollDevice(dev); await settle();
      expect(ingest.ingest).toHaveBeenCalledTimes(1);

      // Time-based rules — a machine idle for long enough, a rate-mode publish —
      // must keep running on a signal that has gone quiet, so the gate has to
      // let one through eventually rather than only on change.
      const realNow = Date.now;
      Date.now = () => realNow() + beat + 1;
      try {
        await (poller as any).pollDevice(dev); await settle();
      } finally {
        Date.now = realNow;
      }
      expect(ingest.ingest).toHaveBeenCalledTimes(2);
    });
  });
});
