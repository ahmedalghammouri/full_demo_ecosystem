import { AlarmService } from './alarm.service';

/**
 * The alarm engine is the piece that decides what shows up in an operator's
 * outstanding queue. The cases that matter are not "does GT work" — they are the
 * ones that separate a usable alarm log from an unreadable one: a spike that
 * should not raise, a value hovering on the limit that should not chatter, and a
 * restart that should not duplicate.
 */

interface DefOverrides {
  condition?: string | null;
  threshold?: number | null;
  deadband?: number | null;
  delaySeconds?: number;
  autoAck?: boolean;
}

function makeService(defOverrides: DefOverrides = {}) {
  const created: any[] = [];
  const updated: any[] = [];
  let openEvent: { id: string } | null = null;
  const events = new Map<string, any>();

  const def = {
    id: 'def-1',
    factoryId: 'f1',
    code: 'TEMP_HIGH',
    name: 'Temperature high',
    severity: 'HIGH',
    category: 'PROCESS',
    condition: 'GT',
    threshold: 80,
    deadband: null,
    delaySeconds: 0,
    autoAck: false,
    ...defOverrides,
  };

  const prisma: any = {
    alarmDefinition: {
      findMany: jest.fn(async () => [def]),
    },
    alarmEvent: {
      create: jest.fn(async ({ data }: any) => {
        const id = `evt-${created.length + 1}`;
        created.push(data);
        events.set(id, { ...data, resolvedAt: null });
        return { id };
      }),
      findUnique: jest.fn(async ({ where }: any) => events.get(where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        updated.push({ id: where.id, ...data });
        const e = events.get(where.id);
        if (e) Object.assign(e, data);
        return e;
      }),
      findFirst: jest.fn(async () => openEvent),
    },
  };

  const svc = new AlarmService(prisma);
  return {
    svc, prisma, created, updated, def,
    setOpenEvent: (e: { id: string } | null) => { openEvent = e; },
    seedEvent: (id: string, triggeredAt: Date) => events.set(id, { triggeredAt, resolvedAt: null }),
  };
}

const at = (ms: number) => new Date(ms).toISOString();

describe('AlarmService', () => {
  it('raises when the condition is met and there is no delay', async () => {
    const { svc, created } = makeService();
    await svc.evaluate('tag-1', 'm1', 95, at(1_000));
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ code: 'TEMP_HIGH', value: 95, threshold: 80, machineId: 'm1' });
  });

  it('does not raise while the value is inside the limit', async () => {
    const { svc, created } = makeService();
    await svc.evaluate('tag-1', 'm1', 79, at(1_000));
    expect(created).toHaveLength(0);
  });

  it('raises only once while the condition persists', async () => {
    const { svc, created } = makeService();
    await svc.evaluate('tag-1', 'm1', 95, at(1_000));
    await svc.evaluate('tag-1', 'm1', 96, at(2_000));
    await svc.evaluate('tag-1', 'm1', 97, at(3_000));
    expect(created).toHaveLength(1);
  });

  // The point of delaySeconds: a momentary spike is not a fault.
  it('suppresses a spike shorter than delaySeconds', async () => {
    const { svc, created } = makeService({ delaySeconds: 10 });
    await svc.evaluate('tag-1', 'm1', 95, at(0));
    await svc.evaluate('tag-1', 'm1', 95, at(5_000));
    await svc.evaluate('tag-1', 'm1', 70, at(6_000)); // recovered
    expect(created).toHaveLength(0);
  });

  it('raises once the condition has held for delaySeconds', async () => {
    const { svc, created } = makeService({ delaySeconds: 10 });
    await svc.evaluate('tag-1', 'm1', 95, at(0));
    await svc.evaluate('tag-1', 'm1', 95, at(9_000));
    expect(created).toHaveLength(0);
    await svc.evaluate('tag-1', 'm1', 95, at(10_000));
    expect(created).toHaveLength(1);
  });

  it('restarts the delay timer after the value dips back inside', async () => {
    const { svc, created } = makeService({ delaySeconds: 10 });
    await svc.evaluate('tag-1', 'm1', 95, at(0));
    await svc.evaluate('tag-1', 'm1', 70, at(5_000));  // clears the timer
    await svc.evaluate('tag-1', 'm1', 95, at(6_000));  // starts again
    await svc.evaluate('tag-1', 'm1', 95, at(12_000)); // only 6s into the new breach
    expect(created).toHaveLength(0);
  });

  it('resolves with a duration when the value recovers', async () => {
    const { svc, updated } = makeService();
    await svc.evaluate('tag-1', 'm1', 95, at(0));
    await svc.evaluate('tag-1', 'm1', 70, at(120_000));
    expect(updated).toHaveLength(1);
    expect(updated[0].durationMinutes).toBeCloseTo(2, 5);
    expect(updated[0].resolvedAt).toBeInstanceOf(Date);
  });

  // Hysteresis. Without it, a value sitting on the limit produces an event per poll.
  it('does not clear inside the deadband', async () => {
    const { svc, created, updated } = makeService({ deadband: 5 });
    await svc.evaluate('tag-1', 'm1', 85, at(0));  // raise
    await svc.evaluate('tag-1', 'm1', 78, at(1_000)); // below 80 but inside 80-5
    expect(updated).toHaveLength(0);
    await svc.evaluate('tag-1', 'm1', 74, at(2_000)); // below 75 → clears
    expect(updated).toHaveLength(1);
    expect(created).toHaveLength(1);
  });

  it('does not chatter: one raise and one resolve across a hovering value', async () => {
    const { svc, created, updated } = makeService({ deadband: 5 });
    for (const [t, v] of [[0, 85], [1, 79], [2, 81], [3, 78], [4, 82], [5, 79]] as const) {
      await svc.evaluate('tag-1', 'm1', v, at(t * 1_000));
    }
    expect(created).toHaveLength(1);
    expect(updated).toHaveLength(0);
  });

  it('applies the deadband below the threshold for an LT alarm', async () => {
    const { svc, created, updated } = makeService({ condition: 'LT', threshold: 20, deadband: 5 });
    await svc.evaluate('tag-1', 'm1', 15, at(0));    // raise
    await svc.evaluate('tag-1', 'm1', 22, at(1_000)); // above 20 but inside 20+5
    expect(updated).toHaveLength(0);
    await svc.evaluate('tag-1', 'm1', 26, at(2_000)); // above 25 → clears
    expect(updated).toHaveLength(1);
    expect(created).toHaveLength(1);
  });

  // A half-filled definition must not invent a fault.
  it('raises nothing when no threshold is configured', async () => {
    const { svc, created } = makeService({ threshold: null });
    await svc.evaluate('tag-1', 'm1', 9999, at(0));
    expect(created).toHaveLength(0);
  });

  it('ignores a reading that is not a number', async () => {
    const { svc, prisma } = makeService();
    await svc.evaluate('tag-1', 'm1', null, at(0));
    await svc.evaluate('tag-1', 'm1', Number.NaN, at(0));
    expect(prisma.alarmDefinition.findMany).not.toHaveBeenCalled();
  });

  // A restart mid-alarm must adopt the open event, not open a second one.
  it('adopts an event left open by a previous run', async () => {
    const { svc, created, updated, setOpenEvent, seedEvent } = makeService();
    setOpenEvent({ id: 'evt-prior' });
    seedEvent('evt-prior', new Date(0));

    await svc.evaluate('tag-1', 'm1', 95, at(1_000));
    expect(created).toHaveLength(0); // adopted, not duplicated

    await svc.evaluate('tag-1', 'm1', 70, at(61_000));
    expect(updated).toHaveLength(1);
    expect(updated[0].id).toBe('evt-prior');
  });

  it('stamps acknowledgedAt at raise when autoAck is set', async () => {
    const { svc, created } = makeService({ autoAck: true });
    await svc.evaluate('tag-1', 'm1', 95, at(1_000));
    expect(created[0].acknowledgedAt).toEqual(created[0].triggeredAt);
  });

  it('leaves acknowledgedAt null when autoAck is off', async () => {
    const { svc, created } = makeService();
    await svc.evaluate('tag-1', 'm1', 95, at(1_000));
    expect(created[0].acknowledgedAt).toBeNull();
  });

  it('does not overwrite an event an operator already resolved', async () => {
    const { svc, prisma, updated } = makeService();
    await svc.evaluate('tag-1', 'm1', 95, at(0));
    // Operator closes it by hand while the condition is still live.
    prisma.alarmEvent.findUnique.mockResolvedValueOnce({ triggeredAt: new Date(0), resolvedAt: new Date(1_000) });
    await svc.evaluate('tag-1', 'm1', 70, at(2_000));
    expect(updated).toHaveLength(0);
  });

  it('survives a database failure without breaking the poll cycle', async () => {
    const { svc, prisma } = makeService();
    prisma.alarmDefinition.findMany.mockRejectedValueOnce(new Error('db down'));
    await expect(svc.evaluate('tag-1', 'm1', 95, at(0))).resolves.toBeUndefined();
  });

  it('evaluates EQ and NEQ conditions', async () => {
    const eq = makeService({ condition: 'EQ', threshold: 3 });
    await eq.svc.evaluate('tag-1', 'm1', 3, at(0));
    expect(eq.created).toHaveLength(1);

    const neq = makeService({ condition: 'NEQ', threshold: 3 });
    await neq.svc.evaluate('tag-1', 'm1', 3, at(0));
    expect(neq.created).toHaveLength(0);
    await neq.svc.evaluate('tag-1', 'm1', 4, at(1_000));
    expect(neq.created).toHaveLength(1);
  });
});
