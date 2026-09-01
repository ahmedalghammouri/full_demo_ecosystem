import {
  describeOrphans, suggestedIntervalMs, aliasingWarning, deriveRejects,
  type OrphanTag,
} from './config-audit';

/**
 * The gateway's alarms and its self-description.
 *
 * ── Why these were untested, and why that mattered ──────────────────────────
 * All four shipped working and unguarded, because each lived inside a Nest
 * service wrapped around a Prisma client — checking a threshold meant standing
 * up a database. Two of them are the alarms that are supposed to catch the NEXT
 * counting fault, so the system's tripwires were themselves the part with
 * nothing watching it.
 *
 * The decisions now live in `config-audit.ts` with no I/O. The services fetch
 * rows and print strings; these are the judgements, and they are the shipped
 * ones — not a copy.
 */

const tag = (over: Partial<OrphanTag> = {}): OrphanTag => ({
  id: 't1', code: 'EDGECOUNTER01_DI0', isActive: false, deviceId: null,
  address: '0', machine: { code: 'M1' }, ...over,
});

describe('orphaned tags', () => {
  it('says nothing at all when the plant is clean', () => {
    // Silence must be reachable, or the warning becomes furniture.
    expect(describeOrphans([], new Map())).toBeNull();
  });

  it('names the machine, the reason and the address', () => {
    const msg = describeOrphans([tag()], new Map())!;
    expect(msg).toContain('M1 EDGECOUNTER01_DI0');
    expect(msg).toContain('no device');
    expect(msg).toContain('address 0');
  });

  it('calls out a stored count, which is the part that misleads', () => {
    // 5477 on a tag nothing polls looks exactly like a live count to anyone
    // reading the table — and cost real time during the 25 Aug investigation.
    const msg = describeOrphans([tag()], new Map([['t1', 5477]]))!;
    expect(msg).toContain('still carries a stored count of 5477');
  });

  it('does not invent a count for a tag that has none', () => {
    // The header explains what a stored count IS, so the assertion has to look
    // at the tag's own line — my first version checked the whole message and
    // failed on its own preamble.
    const line = describeOrphans([tag()], new Map())!.split(/\r?\n/)[1];
    expect(line).toContain('EDGECOUNTER01_DI0');
    expect(line).not.toContain('still carries');
  });

  it('distinguishes a detached tag from a merely disabled one', () => {
    const msg = describeOrphans(
      [tag({ id: 'a', code: 'A_DI0', deviceId: null }),
       tag({ id: 'b', code: 'B_DI1', deviceId: 'dev-1', isActive: false })],
      new Map(),
    )!;
    expect(msg).toContain('A_DI0 (no device');
    expect(msg).toContain('B_DI1 (inactive');
  });

  it('leads with the count, so the size is visible before the list', () => {
    const msg = describeOrphans([tag({ id: 'a' }), tag({ id: 'b' })], new Map())!;
    expect(msg.startsWith('2 counter tag(s)')).toBe(true);
  });

  it('survives a tag with no machine attached', () => {
    const msg = describeOrphans([tag({ machine: null })], new Map())!;
    expect(msg).toContain('EDGECOUNTER01_DI0');
  });
});

describe('the suggested poll interval', () => {
  it('gives a device headroom over what it actually achieves', () => {
    // 30 ms measured → 45 → rounded up to 50.
    expect(suggestedIntervalMs(30)).toBe(50);
    // 69 ms — the slowest round trip measured on this plant → 103.5 → 110.
    expect(suggestedIntervalMs(69)).toBe(110);
  });

  it('never suggests a number below its own floor', () => {
    // A fast device must not be handed back an interval that re-states the same
    // impossible promise the warning is complaining about.
    expect(suggestedIntervalMs(1)).toBe(50);
    expect(suggestedIntervalMs(0)).toBe(50);
  });

  it('always lands on a round ten, because a person has to type it', () => {
    for (const ms of [21, 33, 47, 68, 120, 431]) {
      expect(suggestedIntervalMs(ms) % 10).toBe(0);
    }
  });

  it('always leaves real headroom above the measurement', () => {
    // The property that matters: the suggestion must be reachable. Anything at
    // or below the achieved rate would trip the same warning immediately.
    for (const ms of [21, 33, 47, 69, 120, 431, 1423]) {
      expect(suggestedIntervalMs(ms)).toBeGreaterThan(ms);
    }
  });

  it('scales up for a genuinely slow link rather than capping', () => {
    // The 1423 ms spike seen on 25 Aug. A cap here would quietly re-suggest an
    // unreachable number for the one device that most needs a real one.
    expect(suggestedIntervalMs(1423)).toBe(2140);
  });
});

describe('the aliasing warning', () => {
  it('names BOTH failures, not just the low one', () => {
    // The original text ended "or counts will be low" — true, and half the
    // story. The plant saw the other half and the warning lost the argument.
    const w = aliasingWarning('tag-1', 1, 27);
    expect(w).toContain('MISSED');
    expect(w).toContain('COUNTED TWICE');
    expect(w).toContain('EITHER direction');
  });

  it('carries the measurement that provoked it', () => {
    expect(aliasingWarning('tag-1', 1, 27)).toContain('1 sample(s) / 27ms');
  });

  it('tells the reader what to do next', () => {
    const w = aliasingWarning('tag-1', 2, 64);
    expect(w).toContain('poll interval');
    expect(w).toContain('debounce');
  });
});

describe('derived rejects', () => {
  it('is what the total saw and the good did not', () => {
    expect(deriveRejects(100, 95, 0)).toEqual({ rejected: 5, impossible: false });
  });

  it('adds the operator’s own entry, which a sensor must never overwrite', () => {
    expect(deriveRejects(100, 95, 40)).toEqual({ rejected: 45, impossible: false });
  });

  it('flags good above total — M1 on 25 August', () => {
    // good 425, total 361. The derived reject is -64.
    const d = deriveRejects(361, 425, 0);
    expect(d.impossible).toBe(true);
    // Clamped, so the write stays sane...
    expect(d.rejected).toBe(0);
  });

  it('still honours a manual entry while the counters are impossible', () => {
    // ...and the operator's figure is the ONLY thing holding the number up.
    // Without this, no correction to the rejected figure can survive a flush.
    expect(deriveRejects(361, 425, 6)).toEqual({ rejected: 6, impossible: true });
  });

  it('does not flag an equal pair — a run with no rejects at all', () => {
    expect(deriveRejects(100, 100, 0)).toEqual({ rejected: 0, impossible: false });
  });

  it('never returns a negative figure, whatever the inputs', () => {
    for (const [t, g, m] of [[0, 0, 0], [0, 999, 0], [10, 500, 0], [5, 5, 0]]) {
      expect(deriveRejects(t, g, m).rejected).toBeGreaterThanOrEqual(0);
    }
  });
});
