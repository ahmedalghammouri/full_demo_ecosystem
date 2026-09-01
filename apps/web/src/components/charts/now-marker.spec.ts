import { followingEdge, nowMarkerPct, FOLLOW_GRACE_MS } from './now-marker';

/**
 * The "now" line on the machine status timeline.
 *
 * ── What went wrong ─────────────────────────────────────────────────────────
 * On the plant's screen it was missing entirely; on the customer's it appeared
 * but sat behind the real time. Both came from the same cause, and neither is
 * fixed by the obvious half of the fix:
 *
 *   THE CLOCK    `Date.now()` was read once per render with no ticker, so the
 *                marker froze wherever it was first drawn and fell further
 *                behind every minute. That is the "late" the customer saw.
 *
 *   THE EDGE     `windowEnd` is the instant the data was fetched, so the view
 *                ends AT now. Seconds later real time is past it, the marker
 *                falls outside the view, and it stops being drawn at all.
 *
 * Adding the ticker alone makes the second failure WORSE -- `now` crosses the
 * frozen edge sooner. The edge has to follow the clock too, which is what
 * `followingEdge` decides.
 */
describe('the right edge follows the clock, within reason', () => {
  const to = Date.parse('2026-08-26T12:39:00Z');

  it('does not move at all when the chart is not following', () => {
    // A historical date filter must render exactly the window it was given.
    expect(followingEdge(to, to + 60_000, false)).toBe(to);
  });

  it('advances to the clock while following', () => {
    expect(followingEdge(to, to + 90_000, true)).toBe(to + 90_000);
  });

  it('leaves the edge alone when the data already reaches the clock', () => {
    // A window that ends in the future -- a full shift, say -- is not shortened.
    expect(followingEdge(to, to - 60_000, true)).toBe(to);
  });

  it('STOPS following once the data goes stale', () => {
    // The failure this bound prevents: a backgrounded tab stops polling, and a
    // chart that kept stretching would draw an hour of blank. Blank here means
    // "the machine reported nothing" -- a lie about the plant, told to cover
    // for a stale browser.
    expect(followingEdge(to, to + FOLLOW_GRACE_MS, true)).toBe(to);
    expect(followingEdge(to, to + FOLLOW_GRACE_MS * 6, true)).toBe(to);
  });

  it('follows right up to the grace and not past it', () => {
    expect(followingEdge(to, to + FOLLOW_GRACE_MS - 1, true)).toBe(to + FOLLOW_GRACE_MS - 1);
  });

  it('is unaffected by the clock reading zero before the first tick', () => {
    expect(followingEdge(to, 0, true)).toBe(to);
  });
});

describe('where the now marker is drawn', () => {
  const from = 1000;
  const to = 3000;

  it('sits proportionally inside the view', () => {
    expect(nowMarkerPct(2000, from, to)).toBe(50);
    expect(nowMarkerPct(1500, from, to)).toBe(25);
  });

  it('draws at both edges rather than vanishing on them', () => {
    // The customer's case: the window ends AT now, so the marker lands exactly
    // on the boundary. An exclusive comparison would hide it there.
    expect(nowMarkerPct(from, from, to)).toBe(0);
    expect(nowMarkerPct(to, from, to)).toBe(100);
  });

  it('is absent when now is outside the view, which is honest', () => {
    // Yesterday's shift has no "now" in it, and drawing one would be a claim.
    expect(nowMarkerPct(to + 1, from, to)).toBeNull();
    expect(nowMarkerPct(from - 1, from, to)).toBeNull();
  });

  it('is absent before the clock first ticks', () => {
    // Zero is the un-mounted clock. Reading a real clock during a server render
    // and again on the client is a hydration mismatch, which this screen has
    // already been broken by once.
    expect(nowMarkerPct(0, 0, 3000)).toBeNull();
  });

  it('never divides by zero on a collapsed window', () => {
    expect(nowMarkerPct(1000, 1000, 1000)).toBe(0);
  });
});

describe('the two halves together', () => {
  it('keeps the marker on screen through a live minute', () => {
    // A live fetch lands, then thirty seconds pass with no refetch. The marker
    // must still be drawn -- this is the exact sequence that used to lose it.
    const fetched = Date.parse('2026-08-26T12:39:00Z');
    const later = fetched + 30_000;
    const edge = followingEdge(fetched, later, true);
    expect(nowMarkerPct(later, fetched - 3_600_000, edge)).toBe(100);
  });

  it('shows how it failed BEFORE the fix, with the edge frozen', () => {
    const fetched = Date.parse('2026-08-26T12:39:00Z');
    const later = fetched + 30_000;
    // follow=false is the old behaviour: the edge never moves.
    const edge = followingEdge(fetched, later, false);
    expect(nowMarkerPct(later, fetched - 3_600_000, edge)).toBeNull();
  });
});
