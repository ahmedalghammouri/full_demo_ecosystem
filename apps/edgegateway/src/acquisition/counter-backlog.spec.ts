/**
 * What happens to pulses counted while nothing is executing.
 *
 * ── The defect this pins ────────────────────────────────────────────────────
 * On Line 1 the last job orders stopped counting at 13:30 on 25 Aug 2026 and
 * the next counting minute was 05:54 the following morning. In between, the
 * counters kept turning and `accumulated` kept climbing, while the flush was
 * skipped because no order was EXECUTING. `synced` stayed where it was, so the
 * backlog was never discarded — only deferred.
 *
 * The moment an order started, sixteen hours of pulses left as ONE delta. The
 * minute writer books `jo.actualQtyGood − minutes already booked`, so all of it
 * landed in a single minute:
 *
 *     M1  1260 pieces in one minute   (ceiling: 45)
 *     M2  2100 pieces in one minute   — in a minute recorded STARVED
 *     M4   960 pieces in one minute   = six pallets at once
 *
 * The plant saw its counts "jump by 500" and corrected four orders by hand.
 *
 * ── The rule now ────────────────────────────────────────────────────────────
 * A pulse with no executing order behind it belongs to no order. It is dropped
 * and tallied, never carried forward to whichever order starts next.
 *
 * The model below is the `writeBatch` accounting exactly: an accumulator that
 * always advances, a `synced` watermark, and the decision about the gap between
 * them. Driving the real service needs Modbus, a database and a clock; this
 * drives the arithmetic that was wrong.
 */

interface Mem { accumulated: number; synced: number }

/** The rule as `writeBatch` now applies it. */
function flush(mem: Mem, ctx: { joId: string | null }) {
  if (!ctx.joId) {
    const orphaned = mem.accumulated - mem.synced;
    mem.synced = mem.accumulated;          // dropped, not carried
    return { booked: 0, orphaned };
  }
  const delta = mem.accumulated - mem.synced;
  if (delta <= 0) return { booked: 0, orphaned: 0 };
  mem.synced = mem.accumulated;
  return { booked: delta, orphaned: 0 };
}

/** The rule as it was, kept so the regression is visible and not just described. */
function flushOld(mem: Mem, ctx: { joId: string | null; running: boolean }) {
  if (!ctx.joId || !ctx.running) return { booked: 0, orphaned: 0 };  // backlog HELD
  const delta = mem.accumulated - mem.synced;
  if (delta <= 0) return { booked: 0, orphaned: 0 };
  mem.synced = mem.accumulated;
  return { booked: delta, orphaned: 0 };
}

describe('pulses counted while nothing is executing', () => {
  it('are dropped, not saved up for the next order', () => {
    const mem: Mem = { accumulated: 0, synced: 0 };
    // A whole night of pulses with no order.
    mem.accumulated += 1260;
    const night = flush(mem, { joId: null });
    expect(night).toEqual({ booked: 0, orphaned: 1260 });

    // Morning: an order starts and the line makes five real units.
    mem.accumulated += 5;
    expect(flush(mem, { joId: 'jo-1' })).toEqual({ booked: 5, orphaned: 0 });
  });

  it('REPRODUCES the 25-26 August jump under the old rule', () => {
    // Same inputs, previous behaviour: the night is held, then paid out whole.
    const mem: Mem = { accumulated: 0, synced: 0 };
    mem.accumulated += 1260;
    expect(flushOld(mem, { joId: null, running: false }).booked).toBe(0);

    mem.accumulated += 5;
    // 1265 in the first minute an order is running. This is the bug, exactly.
    expect(flushOld(mem, { joId: 'jo-1', running: true }).booked).toBe(1265);
  });

  it('keeps counting when the order runs but the machine reads STARVED', () => {
    // The other half. An EXECUTING order plus a pulse means a unit was made;
    // the state engine's opinion cannot unmake it. Holding it did not discard
    // the count, it only paid it out in a later, wrong minute -- which is how a
    // minute marked STARVED came to carry 2100 pieces.
    const mem: Mem = { accumulated: 0, synced: 0 };
    mem.accumulated += 40;
    expect(flush(mem, { joId: 'jo-1' }).booked).toBe(40);

    const old: Mem = { accumulated: 40, synced: 0 };
    expect(flushOld(old, { joId: 'jo-1', running: false }).booked).toBe(0);
  });

  it('tallies every dropped pulse rather than losing the fact silently', () => {
    // A counter turning with nothing scheduled is worth knowing about, whether
    // it means the line moved outside an order or the input is picking up noise.
    const mem: Mem = { accumulated: 0, synced: 0 };
    let tally = 0;
    for (const n of [300, 700, 260]) {
      mem.accumulated += n;
      tally += flush(mem, { joId: null }).orphaned;
    }
    expect(tally).toBe(1260);
  });

  it('never books a negative delta, whatever the accumulator does', () => {
    // A gateway restart reseeds `synced` from the DB; if that lands ahead of
    // the accumulator the difference is negative and must book nothing.
    const mem: Mem = { accumulated: 10, synced: 90 };
    expect(flush(mem, { joId: 'jo-1' })).toEqual({ booked: 0, orphaned: 0 });
  });

  it('is idempotent — flushing twice with no new pulses books nothing', () => {
    const mem: Mem = { accumulated: 45, synced: 0 };
    expect(flush(mem, { joId: 'jo-1' }).booked).toBe(45);
    expect(flush(mem, { joId: 'jo-1' }).booked).toBe(0);
  });

  it('loses nothing across a stop that stays inside one order', () => {
    // The case that must NOT change: an order executing throughout, with a
    // pause in the pulses. Every unit still arrives, in its own flush.
    const mem: Mem = { accumulated: 0, synced: 0 };
    let booked = 0;
    for (const n of [45, 0, 0, 45, 12]) {
      mem.accumulated += n;
      booked += flush(mem, { joId: 'jo-1' }).booked;
    }
    expect(booked).toBe(102);
    expect(mem.synced).toBe(mem.accumulated);
  });
});
