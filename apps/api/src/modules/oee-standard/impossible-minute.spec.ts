import { impossibleMinute } from './oee-standard.writer';

/**
 * A minute that holds more parts than the machine could have made.
 *
 * ── Why this needs no judgement, and why it went unsaid anyway ──────────────
 * A machine cannot beat its own mechanical cycle. A minute over that ceiling is
 * PROOF the count is wrong, not evidence of a fast minute — and the design
 * speed is already in the row, so nothing has to be inferred or configured.
 *
 * On 25 Aug 2026 sixty such minutes were written for M1 alone, at an average of
 * 68.8 against a ceiling of 45, and nothing anywhere said a word. The plant
 * found it by eye, days later, from a screenshot.
 *
 * This is one of the two alarms meant to catch the NEXT counting fault, so it
 * shipping unguarded meant the system's tripwire had nothing watching it. The
 * thresholds below are the whole of its judgement: get them wrong in one
 * direction and it stays silent through a real fault, wrong in the other and it
 * cries through every ordinary minute until somebody mutes it.
 */

/** M1's real numbers: 1.3333 s per INNER → 2700/h → 45 a minute. */
const DESIGN = 2700;

describe('the impossible minute', () => {
  it('says nothing about a minute inside the machine’s ceiling', () => {
    expect(impossibleMinute(45, 1, DESIGN)).toBeNull();
    expect(impossibleMinute(12, 1, DESIGN)).toBeNull();
    expect(impossibleMinute(0, 1, DESIGN)).toBeNull();
  });

  it('tolerates a tenth over — that is the minute boundary, not a fault', () => {
    // A pulse landing either side of the second. Firing here would put the
    // alarm in every ordinary shift and teach the plant to ignore it.
    expect(impossibleMinute(49, 1, DESIGN)).toBeNull();   // 45 × 1.089
  });

  it('fires past that, because nothing else explains it', () => {
    expect(impossibleMinute(50, 1, DESIGN)).not.toBeNull(); // 45 × 1.11
  });

  it('catches the 25 August shape', () => {
    // The mode of M1's over-counting minutes, at a full minute of RUNNING.
    const v = impossibleMinute(81, 1, DESIGN)!;
    expect(v.counted).toBe(81);
    expect(v.ceiling).toBeCloseTo(45, 5);
  });

  it('scales the ceiling to the time the machine actually ran', () => {
    // Half a minute of operating can only make half a minute's worth. Holding
    // it to the full 45 would miss the CLEAREST cases — a machine that produced
    // a minute's output in thirty seconds.
    expect(impossibleMinute(30, 0.5, DESIGN)).not.toBeNull(); // ceiling 22.5
    expect(impossibleMinute(20, 0.5, DESIGN)).toBeNull();
  });

  it('reports the scaled ceiling, so the warning can show its working', () => {
    const v = impossibleMinute(30, 0.5, DESIGN)!;
    expect(v.ceiling).toBeCloseTo(22.5, 5);
  });

  it('stays silent when the machine was not operating', () => {
    // Zero operating minutes gives a zero ceiling, and every count would be
    // "impossible" — including the flush artefacts that land in a stopped
    // minute. That is F9's business, not this alarm's, and conflating them
    // would send the plant after the wrong fault.
    expect(impossibleMinute(286, 0, DESIGN)).toBeNull();
  });

  it('stays silent when no design speed is recorded', () => {
    // A ceiling needs a number the plant stated. Inventing one would manufacture
    // alarms out of an empty routing.
    expect(impossibleMinute(999, 1, null)).toBeNull();
    expect(impossibleMinute(999, 1, 0)).toBeNull();
  });

  it('works in each machine’s own unit without conversion', () => {
    // The line normalises to 2700 pieces/hour at every stage: the cartoner's
    // 5.3333 s per CARTON and the palletiser's 213.33 s per PALLET both arrive
    // here as 2700. So one ceiling serves all four machines, and a unit mix-up
    // cannot creep in.
    expect(impossibleMinute(12, 1, DESIGN)).toBeNull();   // cartoner, ~11.25/min
    expect(impossibleMinute(60, 1, DESIGN)).not.toBeNull();
  });

  it('is a pure judgement — the same inputs always give the same answer', () => {
    // It reads no clock and no configuration, so the throttle in the writer is
    // the ONLY thing that decides how often the plant hears about it.
    const a = impossibleMinute(81, 1, DESIGN);
    const b = impossibleMinute(81, 1, DESIGN);
    expect(a).toEqual(b);
  });
});
