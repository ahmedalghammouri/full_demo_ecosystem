import { StateInferenceService } from './state-inference.service';

/**
 * The state truth table.
 *
 *   RUN  PROC   cause                    state
 *   ───  ────   ──────────────────────   ──────────
 *    1     1    —                        RUNNING
 *    1     0    nothing arriving         STARVED
 *    1     0    cannot discharge         BLOCKED
 *    0    0/1   nothing arriving         STARVED
 *    0    0/1   cannot discharge         BLOCKED
 *    0    0/1   neither                  BREAKDOWN
 *
 * ── The point these tests defend ────────────────────────────────────────────
 * STARVED and BLOCKED name WHERE the cause is, and they point in opposite
 * directions along the line:
 *
 *   STARVED  nothing is arriving  → the machine BEFORE  (upstream)
 *   BLOCKED  nowhere to discharge → the machine AFTER   (downstream)
 *
 * So each is asked of its own side. An earlier draft of this file inferred
 * BLOCKED from "the machine before is running" — reasoning that if material
 * arrives and is not consumed, something ahead must be holding it. That is a
 * proxy, not the thing itself: a machine can be fed, idle and simply faulty, and
 * the proxy files its breakdown as an external loss, removing it from OEE.
 */
describe('StateInferenceService — the truth table', () => {
  // A five-station line: M1 fills → M2 weighs → M3 cartons → M4 palletises →
  // M5 wraps. M3 is the machine under test, so it has both neighbours.
  const LINE = [
    { id: 'm1', sortOrder: 1 }, { id: 'm2', sortOrder: 2 }, { id: 'm3', sortOrder: 3 },
    { id: 'm4', sortOrder: 4 }, { id: 'm5', sortOrder: 5 },
  ];
  const ME = 'm3';

  function build(opts: {
    states: Record<string, string>;
    processing?: 0 | 1 | null;
    idleForMs?: number;
    /** Rule 0: with no job order the machine is IDLE and no tag is read. */
    scheduled?: boolean;
    /**
     * The job-order statuses actually on the machine.
     *
     * The count used to be stubbed at a flat 1, which could not express "an
     * order exists but is PAUSED" — the situation the plant hit on 25 Aug. The
     * stub now answers the query it was asked, so a test can state the
     * statuses and let the service decide what they mean.
     */
    joStatuses?: string[];
  }) {
    const { states, processing = null, idleForMs = 10 * 60_000 } = opts;
    const prisma: any = {
      // Rule 0 gates everything on there being work scheduled: a machine with no
      // job order is IDLE and its tags are never read. Every row of this table is
      // about a machine that IS working, so the mock says so — otherwise all of
      // them would assert against IDLE and prove nothing about the table.
      jobOrder: {
        count: jest.fn(async ({ where }: any) => {
          if (opts.scheduled === false) return 0;
          if (!opts.joStatuses) return 1;
          const want = typeof where.status === 'string' ? [where.status] : (where.status?.in ?? []);
          return opts.joStatuses.filter((x) => want.includes(x)).length;
        }),
      },
      machine: {
        findUnique: jest.fn(async ({ where }: any) => ({
          ...LINE.find((m) => m.id === where.id)!, lineId: 'L1',
        })),
        findMany: jest.fn().mockResolvedValue(LINE),
      },
      machineCurrentStatus: {
        findMany: jest.fn(async ({ where }: any) =>
          (where.machineId.in as string[])
            .filter((id) => states[id] !== undefined)
            .map((id) => ({ machineId: id, state: states[id] }))),
        findUnique: jest.fn(async ({ where }: any) =>
          states[where.machineId] ? { state: states[where.machineId] } : null),
      },
      tagDefinition: {
        findFirst: jest.fn(async ({ where }: any) =>
          where?.signalRole === 'PROCESSING'
            ? (processing === null ? null : { id: 'proc', idleThresholdMs: 5 * 60_000 })
            : null),
        findMany: jest.fn().mockResolvedValue([]),   // no INFEED/OUTFEED bound
      },
      tagCurrentValue: {
        findUnique: jest.fn(async () =>
          processing === null ? null
            : { value: processing, quality: 'GOOD', timestamp: new Date(Date.now() - idleForMs) }),
      },
    };
    const svc = new StateInferenceService(prisma as never);
    // Returned alongside so a test can assert what was NOT consulted.
    return Object.assign(svc, { __prisma: prisma });
  }

  const RUN = 'RUNNING';
  /** Everything up and running except where stated. */
  const allRunning = { m1: RUN, m2: RUN, m3: RUN, m4: RUN, m5: RUN };

  // ── RUN = 1 ───────────────────────────────────────────────────────────────
  it('RUN 1 + PROC 1 → RUNNING', async () => {
    const s = build({ states: allRunning, processing: 1 });
    await expect(s.classify(ME, RUN)).resolves.toBe(RUN);
  });

  it('RUN 1 + PROC 0 + nothing arriving → STARVED', async () => {
    // Upstream is down, so the cartoner is ready with nothing to card.
    const s = build({ states: { ...allRunning, m1: 'BREAKDOWN', m2: 'BREAKDOWN' }, processing: 0 });
    await expect(s.classify(ME, RUN)).resolves.toBe('STARVED');
  });

  it('RUN 1 + PROC 0 + cannot discharge → BLOCKED', async () => {
    // Fed, but the machines AFTER it have stopped — the cartons have nowhere to
    // go. This is the case the upstream proxy could not tell apart from a fault.
    const s = build({ states: { ...allRunning, m4: 'BREAKDOWN', m5: 'BREAKDOWN' }, processing: 0 });
    await expect(s.classify(ME, RUN)).resolves.toBe('BLOCKED');
  });

  it('RUN 1 + PROC 0 + neighbours running → STARVED, because it is waiting', async () => {
    // Ready and not processing is not a fault, it is a wait — and the only thing
    // to wait for is the station in front. The neighbour checks above see only
    // whether a neighbour is STOPPED; a feeder that is simply slower starves this
    // machine every cycle while the whole line reports healthy.
    const s = build({ states: allRunning, processing: 0 });
    await expect(s.classify(ME, RUN)).resolves.toBe('STARVED');
  });

  it('RUN 0 + neighbours running → BREAKDOWN, because it stopped', async () => {
    // The distinction that keeps the rule above honest. Waiting and stopping are
    // different things: work was arriving and could be passed on, and Run Mode
    // went off anyway. That is its own, and it is charged to its availability.
    const s = build({ states: { ...allRunning, m3: 'BREAKDOWN' }, processing: 0 });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BREAKDOWN');
  });

  // ── RUN = 0 ───────────────────────────────────────────────────────────────
  it('RUN 0 + nothing arriving → STARVED', async () => {
    const s = build({ states: { ...allRunning, m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('STARVED');
  });

  it('RUN 0 + cannot discharge → BLOCKED', async () => {
    const s = build({ states: { ...allRunning, m3: 'BREAKDOWN', m4: 'BREAKDOWN', m5: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BLOCKED');
  });

  it('RUN 0 + neighbours fine → BREAKDOWN', async () => {
    // Work was arriving and could be passed on, and it stopped anyway. Its own,
    // and it must be charged to availability rather than excused.
    const s = build({ states: { ...allRunning, m3: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BREAKDOWN');
  });

  it('prefers STARVED when the line is stopped on both sides', async () => {
    // Nothing arriving AND nowhere to send it. The true constraint is the one
    // starving the line — that is where a fix has to go.
    const s = build({ states: { m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'BREAKDOWN', m4: 'BREAKDOWN', m5: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('STARVED');
  });

  // ── The two symptom-versus-cause rules ────────────────────────────────────
  it('is not starved by an upstream that is merely BLOCKED', async () => {
    // A blocked upstream HAS product and cannot pass it on — usually because this
    // machine stopped taking it. Blaming it would file this machine's own jam as
    // an external loss and remove it from OEE.
    const s = build({ states: { ...allRunning, m1: 'BLOCKED', m2: 'BLOCKED', m3: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BREAKDOWN');
  });

  it('is not blocked by a downstream that is merely STARVED', async () => {
    // A starved downstream is WAITING for product, which is the opposite of
    // refusing it — and it is usually waiting because of this machine. Reading it
    // as a blockage inverts the line and hides the real constraint.
    const s = build({ states: { ...allRunning, m3: 'BREAKDOWN', m4: 'STARVED', m5: 'STARVED' } });
    await expect(s.classify(ME, 'BREAKDOWN')).resolves.toBe('BREAKDOWN');
  });

  // ── The conservative edges ────────────────────────────────────────────────
  it('leaves a running machine alone when no PROCESSING signal is wired', async () => {
    // Silence is not evidence. Declaring starvation here would move a real loss
    // out of OEE and flatter the equipment.
    const s = build({ states: allRunning, processing: null });
    await expect(s.classify(ME, RUN)).resolves.toBe(RUN);
  });

  it('treats a brief gap between units as still processing', async () => {
    // A wrapper rests between pallets; a filler does not. Only a gap longer than
    // that signal's own slowest normal cycle counts.
    const s = build({ states: { ...allRunning, m1: 'BREAKDOWN', m2: 'BREAKDOWN' }, processing: 0, idleForMs: 30_000 });
    await expect(s.classify(ME, RUN)).resolves.toBe(RUN);
  });

  it('never overrules a machine that reported STARVED or BLOCKED itself', async () => {
    const s = build({ states: allRunning, processing: 1 });
    await expect(s.classify(ME, 'STARVED')).resolves.toBe('STARVED');
    await expect(s.classify(ME, 'BLOCKED')).resolves.toBe('BLOCKED');
  });

  it('never reclassifies a stop that already carries an explanation', async () => {
    // A changeover is a decision somebody made. Turning it into starvation moves
    // a PLANNED stop into an EXTERNAL loss and changes what OEE excludes.
    const s = build({ states: { ...allRunning, m1: 'BREAKDOWN', m2: 'BREAKDOWN' } });
    await expect(s.classify(ME, 'CHANGEOVER')).resolves.toBe('CHANGEOVER');
  });

  /**
   * Rule 0 — an unscheduled machine has nothing to say about itself.
   *
   * A machine with no job order is not RUNNING, not STARVED and not BROKEN: it
   * is IDLE, and none of its tags are worth reading to decide that. Run Mode on
   * at an unscheduled machine says the panel is powered; Run Mode off says
   * somebody switched it off. Inferring either way manufactures downtime out of
   * an idle plant.
   *
   * The elapsed time is not lost — it is exactly what the Energy module
   * measures, and standby draw on an idle machine is a real cost that OEE has
   * nothing to say about.
   */
  describe('no job order, no verdict', () => {
    it.each(['RUNNING', 'BREAKDOWN', 'IDLE', 'STOPPED'])(
      'reports IDLE for a raw %s when nothing is scheduled', async (raw) => {
        const s2 = build({ states: allRunning, processing: 1, scheduled: false });
        await expect(s2.classify(ME, raw)).resolves.toBe('IDLE');
      });

    it('does not read any tag to decide it', async () => {
      const s2 = build({ states: allRunning, processing: 1, scheduled: false });
      await s2.classify(ME, 'BREAKDOWN');
      expect((s2 as never as { __prisma: any }).__prisma.tagDefinition.findFirst).not.toHaveBeenCalled();
    });

    /**
     * ── A decision reversed on 26 Aug 2026, and why ─────────────────────────
     * This used to assert the opposite: that a PAUSED order still counts as
     * scheduled, because "mid-job and stopped is a stop on a real order, not an
     * idle plant". That reasoning was sound as far as it went, and it is kept
     * here because the argument still deserves to be findable.
     *
     * What it missed is that `StatusService.stoppedState` counted only
     * EXECUTING, so the plant had TWO answers to one question. On 25 Aug all
     * four orders on Line 1 were paused: M1's Run Mode bit dropped, took that
     * path, and read IDLE; M2, M3 and M4 kept their bits high, took this one,
     * and went on inferring STARVED and BLOCKED for an order nobody was
     * running. Four machines, one situation, three states.
     *
     * The original worry — that the stop would be hidden — does not come true.
     * IDLE is not downtime but it still occupies the clock and still counts
     * against OEE; the pause is recorded, in full. What stops happening is the
     * INFERENCE OF A CAUSE the system cannot know. A machine cannot be starved
     * of material for an order that is not running, and saying so moved a real
     * loss into an external one that OEE excludes.
     */
    it('a PAUSED order is NOT scheduled work — the pause is recorded as idle', async () => {
      const s2 = build({ states: allRunning, processing: 1, joStatuses: ['PAUSED'] });
      await expect(s2.classify(ME, RUN)).resolves.toBe('IDLE');
      expect((s2 as never as { __prisma: any }).__prisma.jobOrder.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ status: 'EXECUTING' }),
        }),
      );
    });
  });
});
