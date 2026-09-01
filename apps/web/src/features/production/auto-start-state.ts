/**
 * What auto-start is about to do with a work order.
 *
 * ── Why this is its own module ──────────────────────────────────────────────
 * It lived inside the work-orders view, next to the component that draws it —
 * which meant testing it required rendering a page that imports React, the
 * router, a query client and forty icons. So it shipped untested, and the one
 * thing it decides is whether the plant gets a warning before two orders end up
 * on one line, which is the fault that started all of this.
 *
 * No React here, no imports at all. The component draws; this decides.
 *
 * ── Why the browser decides it and not the server ───────────────────────────
 * The list already holds every order and its line, which is exactly what "is
 * something blocking it" needs. A dedicated endpoint would be a second copy of
 * the scheduler's rule and a second chance for the two to disagree — and when
 * they disagreed, the screen and the scheduler would each be certain.
 */

/** How long before its planned start an armed order is worth watching. */
export const DUE_SOON_MIN = 30;

/**
 * The scheduler's own grace window. Past this it will not start at all.
 *
 * Must match `AUTO_START_GRACE_MIN` in `work-order-scheduler.service.ts`. Two
 * numbers, one rule — the alternative was an endpoint whose only job was to
 * carry a constant across the wire, and this way a divergence is at least
 * visible in one grep.
 */
export const AUTO_START_GRACE_MIN = 4 * 60;

export type AutoState = 'off' | 'armed' | 'soon' | 'held' | 'stale';

export interface AutoStartOrder {
  id: string;
  status: string;
  plannedStart: string;
  autoStart?: boolean;
  lineId?: string | null;
}

export function autoStartState(
  order: AutoStartOrder, all: AutoStartOrder[], now: number,
): AutoState {
  if (!order.autoStart) return 'off';
  // Before the clock is set — the first render, where reading `Date.now()` on
  // the server and again in the browser would hydrate as a mismatch.
  if (!now) return 'armed';
  // An order already running or finished is not waiting on anything.
  if (!['PLANNED', 'RELEASED'].includes(order.status)) return 'armed';

  const start = new Date(order.plannedStart).getTime();
  // A malformed date must not silently read as 1970 and mark everything stale.
  if (!Number.isFinite(start)) return 'armed';
  const lateMin = (now - start) / 60_000;

  // Past the scheduler's window nothing further happens without a person, so
  // this is the loudest state — and it is decided BEFORE the line is examined.
  // Reporting "the line is busy" for an order that will never start anyway
  // sends the reader after the wrong thing.
  if (lateMin > AUTO_START_GRACE_MIN) return 'stale';

  // Due or nearly due AND the line is taken: the 25 August shape, caught before
  // it happens rather than after. An order with no line recorded is never
  // "held" — it cannot be shown to collide with anything, and colouring it on a
  // guess would be its own kind of wrong.
  const blocked = !!order.lineId && all.some(
    (o) => o.id !== order.id && o.lineId === order.lineId && o.status === 'IN_PROGRESS',
  );
  if (lateMin > -DUE_SOON_MIN && blocked) return 'held';
  if (lateMin > -DUE_SOON_MIN) return 'soon';
  return 'armed';
}
