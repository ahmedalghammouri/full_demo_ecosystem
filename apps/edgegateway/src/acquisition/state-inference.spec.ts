import { StateInferenceService } from './state-inference.service';

/**
 * Classifying WHY a machine stopped.
 *
 * A Run Mode signal reports that a machine stopped; it cannot report why. Without
 * a reason every stop is charged to the machine as a breakdown, so a palletiser
 * idle because the filler upstream is down scores exactly as badly as one that has
 * actually failed. OEE already removes Starved and Blocked minutes from Planned
 * Production Time — what was missing was anything that DECIDED a stop was external.
 *
 * These tests pin the decision, especially the guards: the service must never
 * invent starvation where the line cannot produce it.
 */
describe('StateInferenceService', () => {
  /** Powder Packing Line 1, in material-flow order. */
  const LINE = [
    { id: 'm1', sortOrder: 1 }, // Powder Filler — filler
    { id: 'm2', sortOrder: 2 }, // Checkweigher
    { id: 'm3', sortOrder: 3 }, // Carton Packer
    { id: 'm4', sortOrder: 4 }, // Euro-Pack Robot
    { id: 'm5', sortOrder: 5 }, // Uni-tech Wrapping
  ];

  /**
   * @param states     machineId → current state
   * @param materialTags tags carrying a materialRole, with their latest reading
   */
  function build(
    states: Record<string, string>,
    materialTags: Array<{ machineId: string; signalRole: string; value: number; quality?: string }> = [],
  ) {
    const prisma = {
      /**

       * Rule 0 gates everything on there being work scheduled: a machine with

       * no job order is IDLE and its tags are not consulted. These cases are all

       * about a machine that IS working, so the mock says so — otherwise every

       * one of them would assert against IDLE and prove nothing about the table.

       */

      jobOrder: { count: jest.fn().mockResolvedValue(1) },

      machine: {
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve({ ...LINE.find((m) => m.id === where.id)!, lineId: 'line-1' }),
        ),
        findMany: jest.fn().mockResolvedValue(LINE),
      },
      machineCurrentStatus: {
        // The truth table asks for the NEAREST upstream machine by id.
        findUnique: jest.fn(({ where }: any) =>
          Promise.resolve(
            states[where.machineId] !== undefined ? { state: states[where.machineId] } : null,
          ),
        ),
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            (where.machineId.in as string[])
              .filter((id) => states[id] !== undefined)
              .map((id) => ({ machineId: id, state: states[id] })),
          ),
        ),
      },
      tagDefinition: {
        findFirst: jest.fn(({ where }: any) =>
          Promise.resolve(
            materialTags
              .map((t, i) => ({ ...t, id: `tag-${t.machineId}-${i}` }))
              .find((t) => t.machineId === where.machineId && t.signalRole === where.signalRole) ?? null,
          ),
        ),
        findMany: jest.fn(({ where }: any) =>
          Promise.resolve(
            materialTags
              .filter((t) => t.machineId === where.machineId)
              .map((t, i) => ({ id: `tag-${t.machineId}-${i}`, signalRole: t.signalRole })),
          ),
        ),
      },
      // Latest value per tag — one indexed lookup, no history scan.
      tagCurrentValue: {
        findUnique: jest.fn(({ where }: any) => {
          const idx = Number(String(where.tagId).split('-').pop());
          const mid = String(where.tagId).split('-')[1];
          const t = materialTags.filter((x) => x.machineId === mid)[idx];
          // Old enough to be past the idle threshold, so the test controls the outcome
          // through the VALUE rather than through timing.
          return Promise.resolve(t ? { value: String(t.value), quality: t.quality ?? 'GOOD', timestamp: new Date(Date.now() - 60 * 60_000) } : null);
        }),
      },
    };
    return new StateInferenceService(prisma as never);
  }

  const RUNNING = 'RUNNING';

  it('calls a stop STARVED when everything upstream has stopped', async () => {
    // The filler is down, so nothing reaches the cartoner.
    const svc = build({ m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('STARVED');
  });

  it('calls a stop BLOCKED when everything downstream has stopped', async () => {
    // The wrapper is down and the pallets have backed up to the cartoner. BLOCKED
    // means "nowhere to discharge", so it is the machines AFTER that decide it.
    const svc = build({ m1: RUNNING, m2: RUNNING, m3: 'BREAKDOWN', m4: 'BREAKDOWN', m5: 'BREAKDOWN' });
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('BLOCKED');
  });

  it('leaves the stop alone when the neighbours are running — the fault is here', async () => {
    const svc = build({ m1: RUNNING, m2: RUNNING, m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('BREAKDOWN');
  });

  it('never starves the FIRST machine on the line — nothing feeds it', async () => {
    // Whole line down. m1 has no upstream, so its stop stays its own.
    const svc = build({ m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'BREAKDOWN', m4: 'BREAKDOWN', m5: 'BREAKDOWN' });
    expect(await svc.classify('m1', 'BREAKDOWN')).toBe('BLOCKED'); // downstream is stopped
  });

  it('never blocks the LAST machine on the line — nothing follows it', async () => {
    // Whole line down. m5 has no downstream; upstream is stopped, so it is starved.
    const svc = build({ m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'BREAKDOWN', m4: 'BREAKDOWN', m5: 'BREAKDOWN' });
    expect(await svc.classify('m5', 'BREAKDOWN')).toBe('STARVED');
  });

  it('never overrules an explicit STARVED or BLOCKED from the machine itself', async () => {
    const svc = build({ m1: RUNNING, m2: RUNNING, m3: 'STARVED', m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m3', 'STARVED')).toBe('STARVED');
    expect(await svc.classify('m3', 'BLOCKED')).toBe('BLOCKED');
  });

  it('never reclassifies a stop somebody has already explained', async () => {
    // Everything upstream is down, but this stop is a planned changeover. It is
    // not starvation just because the line happens to be idle around it.
    const svc = build({ m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'CHANGEOVER', m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m3', 'CHANGEOVER')).toBe('CHANGEOVER');
    expect(await svc.classify('m3', 'PLANNED_STOP')).toBe('PLANNED_STOP');
    expect(await svc.classify('m3', 'MAINTENANCE')).toBe('MAINTENANCE');
  });

  // ── STARVED and BLOCKED need evidence AT THIS MACHINE ─────────────────────
  // Either the machine stopped, or its process stopped. A neighbour's state
  // alone never is, and may not overrule a machine whose own signals say it is
  // working.
  //
  // These tests exist because the opposite was briefly implemented — a stopped
  // feeder inferring starvation for a machine with no PROCESSING signal — and
  // the line disproved it within the hour. Powder Filler went down and the cartoner
  // and palletiser were instantly reported STARVED while the wrapper's table was
  // still rotating: a rotating table means a pallet was being wrapped, which
  // means the palletiser had just delivered one, which means the cartoner had fed
  // it. The machines called starved were visibly working.
  //
  // The flaw is that a stopped feeder does not mean nothing is arriving. There is
  // product between the stations, and the cartoner works through what is in front
  // of it long after the filler stops — Powder Filler had been down one minute.
  // Starvation arrives when the buffer drains, at a delay no topology can know.
  it('leaves a running machine alone when it has no PROCESSING signal', async () => {
    // Everything upstream is down and this machine still says it is running.
    // Nothing here reports a stop, so nothing may be charged as one.
    const svc = build({ m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: RUNNING, m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m3', RUNNING)).toBe(RUNNING);
  });

  it('does not starve a machine whose own signals show it working, at any distance', async () => {
    // The palletiser one station further down, in the same moment. Its Run Mode
    // is on and it has no processing signal; there is no stop to classify.
    const svc = build({ m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: RUNNING, m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m4', RUNNING)).toBe(RUNNING);
  });

  it('still classifies once the machine itself reports a stop', async () => {
    // The evidence the rule asks for. Run Mode has gone off, so there IS a stop
    // here — and now the line decides whose fault it is.
    const svc = build({ m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('STARVED');
  });

  // ── I360's actual case ──────────────────────────────────────────────────────
  // Carton Packer and Uni-Tech report Run Mode ON while starved: "ready, but no product
  // currently being processed". A starved machine here NEVER looks stopped, so the
  // wrapping table's rotation is the only thing that distinguishes working from
  // waiting. These are the tests that matter for tracker IDs 10 and 11.
  describe('ready but not processing (I360 signal semantics)', () => {
    it('calls the wrapper STARVED when the table is still and nothing is arriving', async () => {
      // The wrapper is last on the line, so it can never be blocked. Its feeder
      // has stopped, so it simply has no pallet.
      const svc = build(
        { m1: RUNNING, m2: RUNNING, m3: RUNNING, m4: 'BREAKDOWN', m5: RUNNING },
        [{ machineId: 'm5', signalRole: 'PROCESSING', value: 0 }],
      );
      expect(await svc.classify('m5', RUNNING)).toBe('STARVED');
    });

    it('calls it STARVED when the table is still, even with the line healthy', async () => {
      // Ready and not processing means WAITING, and on a serial line the only
      // thing to wait for is the station in front. "Healthy" here only means no
      // neighbour is STOPPED — a feeder that is merely SLOWER starves this
      // machine just as surely. The wrapper takes 115 s a pallet and the
      // palletiser 255 s, so it waits over two minutes of every normal cycle
      // with every machine on the line reporting fine.
      const svc = build(
        { m1: RUNNING, m2: RUNNING, m3: RUNNING, m4: RUNNING, m5: RUNNING },
        [{ machineId: 'm5', signalRole: 'PROCESSING', value: 0 }],
      );
      expect(await svc.classify('m5', RUNNING)).toBe('STARVED');
    });

    it('leaves the wrapper RUNNING while the table IS rotating', async () => {
      const svc = build(
        { m1: RUNNING, m2: RUNNING, m3: RUNNING, m4: RUNNING, m5: RUNNING },
        [{ machineId: 'm5', signalRole: 'PROCESSING', value: 1 }],
      );
      expect(await svc.classify('m5', RUNNING)).toBe(RUNNING);
    });

    it('calls it BLOCKED when it is the downstream that has stopped', async () => {
      // Not processing, and nothing downstream can accept: backed up, not starved.
      const svc = build(
        { m1: RUNNING, m2: RUNNING, m3: RUNNING, m4: 'BREAKDOWN', m5: 'BREAKDOWN' },
        [{ machineId: 'm3', signalRole: 'PROCESSING', value: 0 }],
      );
      expect(await svc.classify('m3', RUNNING)).toBe('BLOCKED');
    });

    it('never starves the head of the line, even when it is not processing', async () => {
      // The filler has no upstream. Idle there is the filler's own problem.
      const svc = build(
        { m1: RUNNING, m2: RUNNING, m3: RUNNING, m4: RUNNING, m5: RUNNING },
        [{ machineId: 'm1', signalRole: 'PROCESSING', value: 0 }],
      );
      expect(await svc.classify('m1', RUNNING)).toBe(RUNNING);
    });

    it('ignores a PROCESSING reading the gateway flagged BAD', async () => {
      const svc = build(
        { m1: RUNNING, m2: RUNNING, m3: RUNNING, m4: RUNNING, m5: RUNNING },
        [{ machineId: 'm5', signalRole: 'PROCESSING', value: 0, quality: 'BAD' }],
      );
      expect(await svc.classify('m5', RUNNING)).toBe(RUNNING);
    });
  });

  it('asks the machine directly before it, not every machine up the line', async () => {
    // m1 is down two places back, but m2 — the station that actually feeds m3 —
    // is still running and passing on what it already has. So m3 is not starved
    // yet; it will be when m2 runs dry, and m2's own state will say so then.
    const svc = build({ m1: 'BREAKDOWN', m2: RUNNING, m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('BREAKDOWN');
  });

  it('starves from its immediate feeder alone, even with the rest of the line up', async () => {
    // The opposite case, and the common one: only m2 is down. Material reaches m3
    // through m2 and nowhere else, so m3 starves whatever m1 is doing. Requiring
    // every upstream machine to be stopped missed exactly this — a single-station
    // failure, which is most of them.
    const svc = build({ m1: RUNNING, m2: 'BREAKDOWN', m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('STARVED');
  });

  it('prefers a bound material signal over inference from neighbours', async () => {
    // Neighbours all running would leave this a breakdown, but the infeed sensor
    // says no material is present. A measurement beats a guess.
    const svc = build(
      { m1: RUNNING, m2: RUNNING, m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING },
      [{ machineId: 'm3', signalRole: 'INFEED_AVAILABLE', value: 0 }],
    );
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('STARVED');
  });

  it('reads OUTFEED_BLOCKED as blocked when the signal is asserted', async () => {
    const svc = build(
      { m1: RUNNING, m2: RUNNING, m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING },
      [{ machineId: 'm3', signalRole: 'OUTFEED_BLOCKED', value: 1 }],
    );
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('BLOCKED');
  });

  it('ignores a material signal the gateway itself marked BAD quality', async () => {
    // A sensor reading flagged BAD is worse than no reading: classifying a stop
    // from a signal we distrust puts a wrong reason into the downtime log and
    // removes real minutes from the OEE loss.
    const svc = build(
      { m1: RUNNING, m2: RUNNING, m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING },
      [{ machineId: 'm3', signalRole: 'INFEED_AVAILABLE', value: 0, quality: 'BAD' }],
    );
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('BREAKDOWN');
  });

  it('treats a machine with no status record as still producing', async () => {
    // m1 and m2 have never reported. Assuming they are stopped would invent
    // starvation across a whole line on a fresh install.
    const svc = build({ m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING });
    expect(await svc.classify('m3', 'BREAKDOWN')).toBe('BREAKDOWN');
  });
  // ── Cascade misattribution ────────────────────────────────────────────────
  // Found by live verification, not by the tests above: with Filling stopped,
  // the palletiser was reported BLOCKED by the wrapper it had itself starved.
  describe('a neighbour that is a symptom is not a cause', () => {
    it('is not BLOCKED by a downstream machine that is merely STARVED', async () => {
      // m5 is starved because m4 stopped feeding it. Reading that as a blockage
      // inverts the line: the true starvation at the head is reported as a
      // blockage behind it, and the real constraint disappears from the report.
      const svc = build({ m1: 'BREAKDOWN', m2: RUNNING, m3: RUNNING, m4: 'BREAKDOWN', m5: 'STARVED' });
      expect(await svc.classify('m4', 'BREAKDOWN')).toBe('BREAKDOWN');
    });

    it('is still BLOCKED by a downstream machine stopped for its own reason', async () => {
      // The guard excuses a downstream that is STARVED, not one that is genuinely
      // broken. m5 is down on its own account, so m4 really has nowhere to send.
      const svc = build({ m1: RUNNING, m2: RUNNING, m3: RUNNING, m4: 'BREAKDOWN', m5: 'BREAKDOWN' });
      expect(await svc.classify('m4', 'BREAKDOWN')).toBe('BLOCKED');
    });

    it('is not STARVED by an upstream machine that is merely BLOCKED', async () => {
      // A blocked upstream HAS product and cannot pass it on — usually because
      // this machine stopped taking it. Calling that starvation blames the
      // upstream for a jam this machine caused, and files the loss as external.
      const svc = build({ m1: 'BLOCKED', m2: 'BLOCKED', m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING });
      expect(await svc.classify('m3', 'BREAKDOWN')).toBe('BREAKDOWN');
    });

    it('is still STARVED by an upstream machine stopped for its own reason', async () => {
      const svc = build({ m1: 'BREAKDOWN', m2: 'BREAKDOWN', m3: 'BREAKDOWN', m4: RUNNING, m5: RUNNING });
      expect(await svc.classify('m3', 'BREAKDOWN')).toBe('STARVED');
    });
  });
});
