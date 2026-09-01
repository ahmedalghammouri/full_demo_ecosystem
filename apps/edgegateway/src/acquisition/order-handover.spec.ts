/**
 * What the counter does when the order under it changes.
 *
 * ── The questions this answers ──────────────────────────────────────────────
 * "An order finished. Is anything still held that will land on the next one?"
 * "An order was paused and a DIFFERENT order started on the same machine —
 *  what happens to each of their counts?"
 * "The paused one resumes tomorrow. Does it carry on correctly?"
 *
 * They are the same question asked three ways, and the answer turns on one
 * design fact: THE ORDER'S TOTAL LIVES IN POSTGRES, AND THE GATEWAY ONLY EVER
 * SENDS INCREMENTS. The gateway holds no order's running total, so there is
 * nothing for it to lose, mix up, or double.
 *
 * The model below is `writeBatch`'s accounting exactly: an accumulator that
 * always advances, a `synced` watermark, the order the counter currently
 * believes it is counting for, and the handover that settles between them.
 */

interface Mem { accumulated: number; synced: number; jobOrderId: string | null }
interface Booking { jobOrderId: string; delta: number }

/** `writeBatch`, reduced to the decisions this file is about. */
function flush(mem: Mem, ctx: { joId: string | null }): { booked: Booking[]; orphaned: number } {
  const booked: Booking[] = [];

  if (ctx.joId !== mem.jobOrderId) {
    if (mem.jobOrderId) {
      // A real handover: settle whatever the OLD order is still owed, then
      // start the new one from zero.
      const tail = mem.accumulated - mem.synced;
      if (tail > 0) booked.push({ jobOrderId: mem.jobOrderId, delta: tail });
      mem.accumulated = 0;
      mem.synced = 0;
      mem.jobOrderId = ctx.joId;
      return { booked, orphaned: 0 };
    }
    // First attribution: pulses taken before the order behind them resolved.
    mem.jobOrderId = ctx.joId;
  }

  if (!ctx.joId) {
    // Nothing executing. These pulses belong to no order — dropped, not saved.
    const orphaned = mem.accumulated - mem.synced;
    mem.synced = mem.accumulated;
    return { booked, orphaned: Math.max(0, orphaned) };
  }

  const delta = mem.accumulated - mem.synced;
  if (delta > 0) {
    mem.synced = mem.accumulated;
    booked.push({ jobOrderId: ctx.joId, delta });
  }
  return { booked, orphaned: 0 };
}

const fresh = (): Mem => ({ accumulated: 0, synced: 0, jobOrderId: null });

describe('an order finishes and the next one starts clean', () => {
  it('carries nothing across the handover', () => {
    const mem = fresh();
    mem.accumulated += 500;
    expect(flush(mem, { joId: 'A' }).booked).toEqual([{ jobOrderId: 'A', delta: 500 }]);

    // A completes, and the line turns once more before the gateway is told.
    // THE ONE BOUNDARY WORTH KNOWING: those pulses settle to A, because A is
    // still the order this counter believes it is counting. It is bounded by a
    // single flush interval -- a second or two, not a shift -- and it is the
    // honest answer: they were made while A was the order on the machine.
    mem.accumulated += 30;
    expect(flush(mem, { joId: null })).toEqual({
      booked: [{ jobOrderId: 'A', delta: 30 }], orphaned: 0,
    });
    expect(mem.jobOrderId).toBeNull();
    expect(mem.accumulated).toBe(0);

    // From here on nothing is executing, and every further pulse is orphaned --
    // never saved up for whichever order starts next. This is the fix for the
    // 25-26 August jump.
    mem.accumulated += 400;
    expect(flush(mem, { joId: null })).toEqual({ booked: [], orphaned: 400 });

    // B starts. It begins at zero: not at 930, not at 400.
    mem.accumulated += 12;
    expect(flush(mem, { joId: 'B' }).booked).toEqual([{ jobOrderId: 'B', delta: 12 }]);
    expect(mem.jobOrderId).toBe('B');
  });

  it('settles what the OLD order was still owed, to the OLD order', () => {
    // The database was unreachable for the last flush, so A has an unsent
    // remainder when B takes over. It belongs to A and is booked against A.
    const mem = fresh();
    mem.jobOrderId = 'A';
    mem.accumulated = 500;
    mem.synced = 460;
    const r = flush(mem, { joId: 'B' });
    expect(r.booked).toEqual([{ jobOrderId: 'A', delta: 40 }]);
    expect(mem.jobOrderId).toBe('B');
    expect(mem.accumulated).toBe(0);
  });
});

describe('a paused order, and another order taking the machine', () => {
  /**
   * The scenario the plant asked about. `machineContexts` resolves only
   * EXECUTING orders, so a PAUSED order simply is not `joId` — it needs no
   * special case anywhere.
   */
  it('gives the pause to neither order', () => {
    const mem = fresh();
    mem.accumulated += 800;
    flush(mem, { joId: 'A' });                 // A runs

    // A is paused. The first flush after the pause settles A's own tail to A
    // and lets go of the order; everything after belongs to nobody.
    mem.accumulated += 25;
    expect(flush(mem, { joId: null })).toEqual({
      booked: [{ jobOrderId: 'A', delta: 25 }], orphaned: 0,
    });
    mem.accumulated += 60;
    expect(flush(mem, { joId: null })).toEqual({ booked: [], orphaned: 60 });

    // B starts on the same machine while A is still paused. It starts at zero.
    mem.accumulated += 300;
    expect(flush(mem, { joId: 'B' }).booked).toEqual([{ jobOrderId: 'B', delta: 300 }]);
    // A's 800 are untouched in Postgres the whole time.
  });

  it('lets the paused order resume and carry on correctly', () => {
    // The point that makes all of this safe: the gateway never held A's total.
    // A's 800 are in Postgres on A's row; the gateway resumes sending A
    // increments from zero, and they ADD to what is already there.
    const mem = fresh();
    mem.accumulated += 800;
    flush(mem, { joId: 'A' });                 // A: 800 in Postgres

    // B takes the machine. B then makes 300.
    flush(mem, { joId: 'B' });
    mem.accumulated += 300;
    expect(flush(mem, { joId: 'B' }).booked).toEqual([{ jobOrderId: 'B', delta: 300 }]);

    // A resumes. B is settled and A starts a fresh increment stream from zero.
    flush(mem, { joId: 'A' });
    expect(mem.jobOrderId).toBe('A');
    expect(mem.accumulated).toBe(0);

    mem.accumulated += 120;
    expect(flush(mem, { joId: 'A' }).booked).toEqual([{ jobOrderId: 'A', delta: 120 }]);
    // A's row reads 800 + 120 = 920. Nothing lost, nothing counted twice, and
    // the gateway never had to remember either total.
  });

  it('never books one pulse to two orders', () => {
    // The audit that makes the handover defensible: across a whole sequence of
    // swaps, the sum booked plus the sum orphaned equals what was counted.
    const mem = fresh();
    let counted = 0;
    let booked = 0;
    let orphaned = 0;
    const script: Array<[number, string | null]> = [
      [100, 'A'], [50, 'A'], [20, null], [70, 'B'], [30, 'B'],
      [10, null], [90, 'A'], [40, 'A'], [5, null],
    ];
    for (const [pulses, jo] of script) {
      counted += pulses;
      mem.accumulated += pulses;
      const r = flush(mem, { joId: jo });
      booked += r.booked.reduce((n, b) => n + b.delta, 0);
      orphaned += r.orphaned;
    }
    // What is still in the accumulator is owed, not lost.
    const owed = mem.accumulated - mem.synced;
    expect(booked + orphaned + owed).toBe(counted);
  });
});

describe('a gateway restart in the middle of all this', () => {
  it('starts fully synced, so a restart cannot invent a backlog', () => {
    // `load()` seeds synced from the stored accumulated. A restart therefore
    // books nothing for the time it was down, which is right: those pulses were
    // never observed by anyone.
    const stored = { accumulated: 55_596 };
    const mem: Mem = { accumulated: stored.accumulated, synced: stored.accumulated, jobOrderId: 'A' };
    expect(flush(mem, { joId: 'A' }).booked).toEqual([]);

    mem.accumulated += 15;
    expect(flush(mem, { joId: 'A' }).booked).toEqual([{ jobOrderId: 'A', delta: 15 }]);
  });
});
