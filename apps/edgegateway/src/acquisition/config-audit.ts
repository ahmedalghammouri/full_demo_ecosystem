/**
 * The gateway's judgements about its own configuration and its own signals.
 *
 * ── Why these are here and not in the services ──────────────────────────────
 * Each of these decides something — is this binding a trap, is this interval
 * reachable, can this count be believed — and every one of them lived inside a
 * Nest service wrapped around a Prisma client. That made them effectively
 * untestable: to check whether a threshold was right you had to stand up a
 * database.
 *
 * So they were shipped untested, and one of them was wrong in a way that made
 * it worse than useless: the binding audit compared a number against a STRING
 * column and flagged every tag on the plant, the four that agree along with the
 * three that do not. It was caught by running it against a real database, which
 * is exactly the kind of luck that should not be load-bearing.
 *
 * Pure functions, no I/O, no Nest. The services fetch rows and print strings;
 * the decisions are here, where a test can reach them.
 */

// ── Tag bindings ────────────────────────────────────────────────────────────

export interface AuditTag {
  code: string;
  /** STRING column — holds "100" and "40001", where the leading digit matters. */
  address: string | null;
  tagType: string;
  counterRole?: string | null;
  edgeType?: string | null;
  machine?: { code: string } | null;
}

/**
 * Configuration that is legal, loads cleanly, and is still a trap.
 *
 * None of these stop a reading. All of them make the reader's mental model
 * quietly false, and cost hours the next time something goes wrong:
 *
 *   NAME vs ADDRESS   a tag called `..._DI3` reading input 2. Every
 *                     conversation about it has to begin by establishing which
 *                     number is real.
 *   MIXED POLARITY    one machine's GOOD on RISING with its TOTAL on FALLING.
 *                     Valid — sensors differ — but the pair then responds
 *                     differently to the same contact ring and drifts apart for
 *                     a reason nothing on screen explains.
 *   ADDRESS CLASH     two live tags on one input. The poller obliges; the plant
 *                     sees one physical signal counted under two names.
 *
 * Returns one line per finding, or an empty array. **Silence has to be
 * reachable** — an audit a plant can never clear becomes background noise, and
 * then the next real finding scrolls past unread.
 */
export function auditBindings(deviceName: string, tags: AuditTag[]): string[] {
  const notes: string[] = [];

  for (const t of tags) {
    const named = /DI(\d+)/i.exec(t.code ?? '');
    if (!named || t.address === null || t.address === undefined) continue;
    // Both sides normalised to a number. `address` is text, so a bare `!==`
    // against a number is ALWAYS unequal — the defect this function was born
    // with, and the reason the first run reported seven findings where three
    // were real.
    const actual = Number(t.address);
    if (!Number.isFinite(actual)) continue; // a non-numeric address is not a guess to make
    if (Number(named[1]) !== actual) {
      notes.push(`${deviceName} · ${t.code} is named DI${named[1]} but reads input ${actual}`);
    }
  }

  const byAddress = new Map<string, string[]>();
  for (const t of tags) {
    if (t.address === null || t.address === undefined) continue;
    const list = byAddress.get(t.address) ?? [];
    list.push(t.code);
    byAddress.set(t.address, list);
  }
  for (const [addr, codes] of byAddress) {
    if (codes.length > 1) {
      notes.push(`${deviceName} · input ${addr} is read by ${codes.length} active tags: ${codes.join(', ')}`);
    }
  }

  const byMachine = new Map<string, AuditTag[]>();
  for (const t of tags) {
    if (t.tagType !== 'COUNTER' || !t.machine) continue;
    const list = byMachine.get(t.machine.code) ?? [];
    list.push(t);
    byMachine.set(t.machine.code, list);
  }
  for (const [code, list] of byMachine) {
    const edges = new Set(list.map((t) => t.edgeType));
    if (edges.size > 1) {
      notes.push(`${deviceName} · ${code} counts on two different edges: `
        + list.map((t) => `${t.counterRole}=${t.edgeType}`).join(' ')
        + ' — the pair will respond differently to the same contact ring');
    }
  }

  return notes;
}

// ── Orphaned tags ───────────────────────────────────────────────────────────

export interface OrphanTag {
  id: string;
  code: string;
  isActive: boolean;
  deviceId: string | null;
  address: string | null;
  machine?: { code: string } | null;
}

/**
 * Counter tags that exist in the database but are not, and cannot be, polled.
 *
 * They do no harm to a reading — the poller loads tags THROUGH a device and
 * filters on `isActive`. What they harm is every diagnosis after them: on this
 * plant seven such counters carried stored totals of 5477, 2300 and 338, which
 * look exactly like live counts to anyone reading the table.
 *
 * `null` when there is nothing to say, so a clean plant stays quiet.
 */
export function describeOrphans(
  rows: OrphanTag[],
  storedCount: Map<string, number>,
): string | null {
  if (rows.length === 0) return null;
  const lines = rows.map((r) => {
    const why = r.deviceId === null ? 'no device' : 'inactive';
    const carried = storedCount.get(r.id);
    return `  ${r.machine?.code ?? '—'} ${r.code} (${why}, address ${r.address ?? '—'})`
      + (carried ? ` — still carries a stored count of ${carried}` : '');
  });
  return `${rows.length} counter tag(s) exist in the database but are not polled. `
    + 'They cannot affect a reading, but a stored count on one of them looks '
    + 'identical to a live count to anyone reading the table:\n'
    + lines.join('\n');
}

// ── Sampling ────────────────────────────────────────────────────────────────

/**
 * The poll interval a device can actually keep, from what it actually achieves.
 *
 * A warning that only says a number is wrong leaves the reader to guess the
 * right one, and the guess on this plant was 20 ms — on both counter devices,
 * where the Modbus round-trip is 21–69 ms. A value no wire can meet does not
 * sample faster; it only hides the ceiling.
 *
 * Half again the measured rate, rounded up to a round ten, with a floor of
 * 50 ms: enough headroom that an ordinary slow cycle does not re-trip the
 * warning, and never so low that it re-states the same impossible promise.
 */
export function suggestedIntervalMs(achievedMs: number): number {
  return Math.max(50, Math.ceil((achievedMs * 1.5) / 10) * 10);
}

/**
 * What a one-sample signal level means — BOTH of the things it can mean.
 *
 * The original text ended "or counts will be low". True for a pulse narrower
 * than the sample period, and only half the story: the same measurement equally
 * means contact ring sampled twice and counted twice. On 25 Aug 2026 this plant
 * had both at once on one device — M1 reading 1.53x its mechanical ceiling
 * while M2 read 0.83x — so the plant's own experience contradicted the only
 * failure the warning named, and the warning lost.
 */
export function aliasingWarning(tagId: string, minSamples: number, minMs: number): string {
  return `counter ${tagId}: shortest signal level seen lasted ${minSamples} sample(s) / ${minMs}ms. `
    + 'A level this short can fail in EITHER direction and this measurement '
    + 'cannot tell which: a real pulse narrower than the sample period is '
    + 'MISSED and the count comes out low, while contact ring sampled twice '
    + 'is COUNTED TWICE and the count comes out high. On 25 Aug 2026 this '
    + 'plant had both at once — M1 reading 1.53x its mechanical ceiling while '
    + 'M2 read 0.83x, on the same device on the same day. '
    + "Lower this device's poll interval to see the true shape, then set a "
    + "debounce from the machine's real cycle if the shape says ring.";
}

// ── Derived rejects ─────────────────────────────────────────────────────────

export interface DerivedRejects {
  /** What to write. Never negative. */
  rejected: number;
  /**
   * The good counter read HIGHER than the total counter.
   *
   * Arithmetically impossible — a machine cannot pass more units than it made.
   * The clamp below keeps the write sane and, on its own, makes the fault
   * invisible: the plant sees a plausible zero and never learns its two
   * counters disagree. M1 on 25 Aug read good 425 against total 361, the
   * derived reject was -64, and the operator then could not make the rejected
   * figure be anything at all — every correction landed on a number the next
   * flush overwrote with zero.
   */
  impossible: boolean;
}

/**
 * Scrap is what the total counter saw and the good counter did not, plus
 * whatever the operator entered by hand — which a sensor must never overwrite.
 */
export function deriveRejects(totalAcc: number, goodAcc: number, manualBad: number): DerivedRejects {
  return {
    rejected: Math.max(0, totalAcc - goodAcc) + manualBad,
    impossible: goodAcc > totalAcc,
  };
}
