import { setCounterPollRate, COUNTER_POLL_MS } from '../../../prisma/seeds/counter-poll-rate.seed';

/**
 * The regression this file exists for.
 *
 * The plant slowed two devices to 200 ms against a running line, deployed, and
 * the next container start silently put them back to 20 — because the seed ran
 * on every boot and only skipped devices already at or below its target. The
 * seed's own documentation said a deliberate slowdown must be respected, so
 * these pin the behaviour the prose promised rather than the one it had.
 */
function fakePrisma(devices: Array<{ id: string; name: string; pollIntervalMs: number | null }>) {
  const written: Array<{ id: string; pollIntervalMs: number }> = [];
  return {
    written,
    devices,
    client: {
      tagDefinition: { findMany: async () => devices.map((d) => ({ deviceId: d.id })) },
      device: {
        findMany: async () => devices,
        update: async ({ where, data }: any) => {
          written.push({ id: where.id, pollIntervalMs: data.pollIntervalMs });
          const d = devices.find((x) => x.id === where.id)!;
          d.pollIntervalMs = data.pollIntervalMs;
        },
      },
    } as any,
  };
}

describe('the boot-time counter poll seed', () => {
  it('LEAVES A DELIBERATELY SLOWED DEVICE ALONE', async () => {
    // The exact case that broke: 200 ms, chosen by a person, on a live line.
    const p = fakePrisma([{ id: 'd1', name: 'EDGECOUNTER01', pollIntervalMs: 200 }]);
    const changes = await setCounterPollRate(p.client);
    expect(changes).toEqual([]);
    expect(p.written).toEqual([]);
    expect(p.devices[0].pollIntervalMs).toBe(200);
  });

  it('leaves a deliberately FASTER device alone too', async () => {
    // The rule is "a number a person put there is a decision", not "slower wins".
    const p = fakePrisma([{ id: 'd1', name: 'EDGECOUNTER01', pollIntervalMs: 10 }]);
    expect(await setCounterPollRate(p.client)).toEqual([]);
    expect(p.devices[0].pollIntervalMs).toBe(10);
  });

  it('still fills in a device that has never been configured', async () => {
    // The seed's real job. A NULL has had no decision made about it.
    const p = fakePrisma([{ id: 'd1', name: 'NEW-DEVICE', pollIntervalMs: null }]);
    expect(await setCounterPollRate(p.client)).toEqual([
      { device: 'NEW-DEVICE', from: null, to: COUNTER_POLL_MS },
    ]);
    expect(p.devices[0].pollIntervalMs).toBe(COUNTER_POLL_MS);
  });

  it('obeys an explicit interval, because then a person is asking', async () => {
    const p = fakePrisma([{ id: 'd1', name: 'EDGECOUNTER01', pollIntervalMs: 200 }]);
    expect(await setCounterPollRate(p.client, { intervalMs: 50 })).toEqual([
      { device: 'EDGECOUNTER01', from: 200, to: 50 },
    ]);
    expect(p.devices[0].pollIntervalMs).toBe(50);
  });

  it('reports without writing under --dry-run', async () => {
    const p = fakePrisma([{ id: 'd1', name: 'EDGECOUNTER01', pollIntervalMs: 200 }]);
    const changes = await setCounterPollRate(p.client, { intervalMs: 50, dryRun: true });
    expect(changes).toHaveLength(1);
    expect(p.written).toEqual([]);
    expect(p.devices[0].pollIntervalMs).toBe(200);
  });

  it('is idempotent — a second boot changes nothing', async () => {
    const p = fakePrisma([{ id: 'd1', name: 'NEW-DEVICE', pollIntervalMs: null }]);
    expect(await setCounterPollRate(p.client)).toHaveLength(1);
    expect(await setCounterPollRate(p.client)).toEqual([]);
    expect(p.written).toHaveLength(1);
  });

  it('touches nothing when no device carries a counter tag', async () => {
    const p = fakePrisma([]);
    expect(await setCounterPollRate(p.client)).toEqual([]);
  });
});
