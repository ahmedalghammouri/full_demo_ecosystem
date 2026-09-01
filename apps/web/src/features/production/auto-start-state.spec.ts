import {
  autoStartState, AUTO_START_GRACE_MIN, DUE_SOON_MIN,
  type AutoStartOrder,
} from './auto-start-state';

/**
 * The auto-start indicator's judgement.
 *
 * ── What it is for ──────────────────────────────────────────────────────────
 * On 25 Aug 2026 WO-2026-0004 auto-started at 12:55 while WO-2026-0003 was
 * still executing on the same four machines. The scheduler now refuses that and
 * notifies; this decides whether the plant can SEE it coming — an amber pulse
 * on the row half an hour before the collision, rather than a notification
 * after it.
 *
 * ── Why it was untested until now ───────────────────────────────────────────
 * It lived inside the work-orders view, so reaching it meant rendering a page
 * that imports React, the router and a query client. This app had no test
 * runner at all. Both are fixed: the rule is its own module with no imports,
 * and `jest.config.js` gives the web app somewhere to put a test.
 */

const MIN = 60_000;
const NOW = Date.UTC(2026, 7, 26, 12, 0);

const wo = (over: Partial<AutoStartOrder> = {}): AutoStartOrder => ({
  id: 'wo-4', status: 'PLANNED', plannedStart: new Date(NOW - 5 * MIN).toISOString(),
  autoStart: true, lineId: 'line-1', ...over,
});

const running = (over: Partial<AutoStartOrder> = {}): AutoStartOrder =>
  wo({ id: 'wo-3', status: 'IN_PROGRESS', ...over });

describe('the auto-start indicator', () => {
  it('is off when the order is not armed', () => {
    expect(autoStartState(wo({ autoStart: false }), [], NOW)).toBe('off');
  });

  it('is armed when its time is still comfortably ahead', () => {
    const future = wo({ plannedStart: new Date(NOW + 5 * 60 * MIN).toISOString() });
    expect(autoStartState(future, [], NOW)).toBe('armed');
  });

  it('warms to “soon” inside the watch window, with the line free', () => {
    const nearly = wo({ plannedStart: new Date(NOW + (DUE_SOON_MIN - 5) * MIN).toISOString() });
    expect(autoStartState(nearly, [], NOW)).toBe('soon');
  });

  it('is held when it is due and the line is running something else', () => {
    // 25 August, seen half an hour early instead of hours late.
    expect(autoStartState(wo(), [wo(), running()], NOW)).toBe('held');
  });

  it('warns BEFORE the collision, not only after it', () => {
    // Twenty minutes ahead of its start, with the line already busy. The whole
    // value of the indicator is in this row.
    const soon = wo({ plannedStart: new Date(NOW + 20 * MIN).toISOString() });
    expect(autoStartState(soon, [soon, running()], NOW)).toBe('held');
  });

  it('is not held by an order running on a DIFFERENT line', () => {
    expect(autoStartState(wo(), [wo(), running({ lineId: 'line-2' })], NOW)).toBe('soon');
  });

  it('is not held by itself', () => {
    // The list contains the order being judged. Comparing it against itself
    // would mark every in-progress order as blocking its own start.
    const self = wo({ status: 'IN_PROGRESS' });
    expect(autoStartState(self, [self], NOW)).toBe('armed');
  });

  it('is never held when no line is recorded', () => {
    // Nothing can be shown to collide with it, and colouring it on a guess
    // would be its own kind of wrong.
    expect(autoStartState(wo({ lineId: null }), [wo(), running({ lineId: null })], NOW)).toBe('soon');
  });

  it('goes stale past the scheduler’s window', () => {
    const late = wo({ plannedStart: new Date(NOW - (AUTO_START_GRACE_MIN + 30) * MIN).toISOString() });
    expect(autoStartState(late, [], NOW)).toBe('stale');
  });

  it('reports stale BEFORE it looks at the line', () => {
    // A stale order will not start whatever the line is doing. Showing "held"
    // would send the reader after a blockage that is beside the point.
    const late = wo({ plannedStart: new Date(NOW - (AUTO_START_GRACE_MIN + 30) * MIN).toISOString() });
    expect(autoStartState(late, [late, running()], NOW)).toBe('stale');
  });

  it('is still only held right up to the edge of the window', () => {
    const edge = wo({ plannedStart: new Date(NOW - (AUTO_START_GRACE_MIN - 1) * MIN).toISOString() });
    expect(autoStartState(edge, [edge, running()], NOW)).toBe('held');
  });

  it('says nothing alarming about an order already running or done', () => {
    // Neither is waiting on anything, so neither should pulse.
    expect(autoStartState(wo({ status: 'IN_PROGRESS' }), [running()], NOW)).toBe('armed');
    expect(autoStartState(wo({ status: 'COMPLETED' }), [running()], NOW)).toBe('armed');
  });

  it('stays quiet before the clock is set', () => {
    // The first render. Reading the time on the server and again in the browser
    // would hydrate as a mismatch, so the page opens with every row armed —
    // the honest thing to show before it knows what time it is.
    expect(autoStartState(wo(), [wo(), running()], 0)).toBe('armed');
  });

  it('does not read a malformed date as 1970 and mark everything stale', () => {
    expect(autoStartState(wo({ plannedStart: 'not a date' }), [], NOW)).toBe('armed');
  });

  it('shares its window with the scheduler', () => {
    // Two numbers, one rule. If the service's grace changes and this does not,
    // the screen promises a start the scheduler will refuse.
    expect(AUTO_START_GRACE_MIN).toBe(4 * 60);
  });
});
