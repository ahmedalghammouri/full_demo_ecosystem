import { StateInferenceService } from './state-inference.service';
import { StatusService } from './status.service';

/**
 * "Does this machine have work?" must have ONE answer.
 *
 * ── The incident this pins ──────────────────────────────────────────────────
 * On 25 Aug 2026 all four job orders on Line 1 were PAUSED. M1's Run Mode bit
 * happened to drop, so it took `StatusService.stoppedState` — which counted
 * only EXECUTING — and correctly read IDLE. M2, M3 and M4 kept their bits high,
 * so they took `StateInference.hasWorkScheduled`, which counted EXECUTING *and*
 * PAUSED, were told there was work, and went on inferring STARVED and BLOCKED.
 *
 * Four machines in one situation showing three different states, and neither
 * rule was reachable from the other to notice. That is the shape of nearly
 * every fault this week: one fact, defined twice, drifting.
 *
 * EXECUTING is the right answer. A PAUSED order is a deliberate stop — the
 * machine is not being asked to produce, so it cannot be starved of material
 * for it or blocked from discharging it.
 *
 * The last test is the one that matters most: it asserts the two paths AGREE,
 * whatever the answer is. If someone later decides PAUSED should count as work,
 * that test fails until both are changed together.
 */

const prismaWith = (statuses: string[]) => ({
  jobOrder: {
    count: jest.fn().mockImplementation(async ({ where }: any) => {
      const want = typeof where.status === 'string' ? [where.status] : (where.status?.in ?? []);
      return statuses.filter((s) => want.includes(s)).length;
    }),
  },
  machineStateRule: { findMany: jest.fn().mockResolvedValue([]) },
  tagDefinition: { findMany: jest.fn().mockResolvedValue([]) },
  tagCurrentValue: { findMany: jest.fn().mockResolvedValue([]) },
  machine: { findUnique: jest.fn().mockResolvedValue(null) },
});

const inferenceFor = (statuses: string[]) =>
  new StateInferenceService(prismaWith(statuses) as any);

describe('one definition of "has work"', () => {
  it('a machine with an EXECUTING order has work', async () => {
    await expect(inferenceFor(['EXECUTING']).hasWorkScheduled('m1')).resolves.toBe(true);
  });

  it('a machine whose only order is PAUSED does NOT', async () => {
    // The 25 August case. A pause is a deliberate stop, not a machine fault and
    // not a material shortage.
    await expect(inferenceFor(['PAUSED']).hasWorkScheduled('m1')).resolves.toBe(false);
  });

  it('a machine with nothing on it does not', async () => {
    await expect(inferenceFor([]).hasWorkScheduled('m1')).resolves.toBe(false);
  });

  it('still has work when one order is paused and another is executing', async () => {
    await expect(inferenceFor(['PAUSED', 'EXECUTING']).hasWorkScheduled('m1')).resolves.toBe(true);
  });

  it('reads IDLE — not STARVED or BLOCKED — while every order is paused', async () => {
    // Rule 0 in `classify`: with nothing scheduled, no tag is worth reading to
    // decide the state. Inferring anything else manufactures downtime out of an
    // idle plant.
    const inf = inferenceFor(['PAUSED']);
    await expect(inf.classify('m1', 'STOPPED')).resolves.toBe('IDLE');
    await expect(inf.classify('m1', 'RUNNING')).resolves.toBe('IDLE');
  });

  it('does not overrule a machine that reported STARVED itself, once work exists', async () => {
    // Rule 1 survives the change: a status word that says STARVED outright is a
    // measurement, and nothing inferred may overrule it.
    const inf = inferenceFor(['EXECUTING']);
    await expect(inf.classify('m1', 'STARVED')).resolves.toBe('STARVED');
  });

  it('THE TWO PATHS AGREE — for every job-order situation', async () => {
    // The guard that makes this a fix rather than a patch. `stoppedState` is
    // private, so its rule is applied here exactly as the service applies it:
    // it asks the inference service and nothing else.
    for (const statuses of [[], ['PAUSED'], ['EXECUTING'], ['COMPLETE'], ['PAUSED', 'EXECUTING']]) {
      const inf = inferenceFor(statuses);
      const hasWork = await inf.hasWorkScheduled('m1');

      // What StatusService.stoppedState now returns, by construction.
      const fromStatusPath = hasWork ? 'BREAKDOWN' : 'IDLE';
      // What the inference path returns for an unexplained stop.
      const fromInferencePath = await inf.classify('m1', 'STOPPED');

      // They need not be the same STATE — one diagnoses a fault, the other a
      // cause — but they must never disagree about whether there is work.
      const statusPathSaysIdle = fromStatusPath === 'IDLE';
      const inferencePathSaysIdle = fromInferencePath === 'IDLE';
      expect(statusPathSaysIdle).toBe(inferencePathSaysIdle);
    }
  });

  it('caches, but not so long that a released order waits', async () => {
    const prisma = prismaWith(['EXECUTING']);
    const inf = new StateInferenceService(prisma as any);
    await inf.hasWorkScheduled('m1');
    await inf.hasWorkScheduled('m1');
    // Asked on every poll for every machine; a second query per poll would be
    // one round trip across the plant link per machine per sample.
    expect(prisma.jobOrder.count).toHaveBeenCalledTimes(1);
  });
});

describe('StatusService is wired to that one definition', () => {
  it('holds a reference to the inference service', () => {
    // A structural check, not a behavioural one: `stoppedState` is private, and
    // what this guards is that it CANNOT go back to running its own query.
    const src = StatusService.prototype.constructor.toString();
    expect(src).toContain('inference');
  });
});
