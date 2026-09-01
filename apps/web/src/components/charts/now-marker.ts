/**
 * Where "now" belongs on a timeline chart, and how far its right edge may
 * chase the clock.
 *
 * ── Why these two decisions sit together, and outside the component ─────────
 * The "now" marker was missing on one screen and lagging on another, and both
 * came from the same pair of facts:
 *
 *   THE CLOCK    `Date.now()` was read once per render with no ticker, so the
 *                marker froze where it was first drawn.
 *   THE EDGE     `windowEnd` is the instant the data was fetched, so the view
 *                ends AT now — and seconds later the marker is outside it and
 *                stops being drawn at all.
 *
 * Adding a ticker alone makes the second failure arrive SOONER. The two have to
 * move together, which is why they are one small module rather than two lines
 * buried in a 700-line chart, and why they can be tested without a DOM.
 */

/**
 * How far past the data's own end the right edge may be stretched.
 *
 * Bounded on purpose. If polling stops — a backgrounded tab, a dropped link —
 * stretching to the clock would draw an ever-growing blank band, and blank on
 * this chart means "the machine reported nothing". That would be a lie about
 * the plant, told to cover for a stale browser. Past the grace the edge stops,
 * the marker leaves the view, and the reader sees what is true: these figures
 * are no longer current.
 */
export const FOLLOW_GRACE_MS = 10 * 60_000;

/** The right edge of a chart whose window is meant to end at the present. */
export function followingEdge(rawTo: number, nowTs: number, follow: boolean): number {
  if (!follow) return rawTo;
  if (nowTs <= rawTo) return rawTo;                   // data already reaches the clock
  if (nowTs - rawTo >= FOLLOW_GRACE_MS) return rawTo; // stale: do not invent a gap
  return nowTs;
}

/**
 * Where the marker sits in the view, as a percentage — or null when it does not
 * belong on screen at all.
 *
 * `nowTs` is 0 until the chart's clock first ticks, because reading a clock
 * during a server render and again on the client is a hydration mismatch by
 * construction, and this screen has been broken by that before. Zero is outside
 * every real window, so the marker simply waits a frame.
 *
 * Both bounds are INCLUSIVE. A live window ends exactly at now, so the marker
 * lands on the boundary constantly; an exclusive test would hide it there,
 * which is most of the original bug.
 */
export function nowMarkerPct(nowTs: number, from: number, to: number): number | null {
  if (!nowTs) return null;
  if (nowTs < from || nowTs > to) return null;
  const span = Math.max(1, to - from);
  return ((nowTs - from) / span) * 100;
}
