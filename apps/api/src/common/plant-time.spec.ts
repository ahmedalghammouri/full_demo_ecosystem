import { resolveLocalRange } from './plant-time.util';

/**
 * Date-only filters are LOCAL calendar dates.
 *
 * `new Date('2026-08-09')` parses as midnight **UTC**. The web builds these strings
 * from local calendar components deliberately — its own comment warns that
 * `toISOString` shifts local midnight into the previous day. At a +03 plant the two
 * readings are three hours apart, so at 00:22 local on 9 Aug a "Today" window began
 * at 03:00 — in the FUTURE — and every KPI on the page read 0.0%, while "Shift" and
 * "Week" looked perfectly healthy because their bounds were safely in the past.
 *
 * The same mistake was fixed in one call site at a time and reappeared in the next.
 * These tests pin the single shared definition.
 */
describe('resolveLocalRange', () => {
  it('starts a "today" window at LOCAL midnight, not UTC midnight', () => {
    // 00:22 local on 9 Aug — the window the failing screenshot was taken in.
    const now = new Date(2026, 7, 9, 0, 22, 0, 0);
    const { from } = resolveLocalRange('2026-08-09', '2026-08-09', 7, now);

    expect(from).toEqual(new Date(2026, 7, 9, 0, 0, 0, 0));
    // The decisive property: the window must already have begun.
    expect(from.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('never lets the window end in the future', () => {
    const now = new Date(2026, 7, 9, 0, 22, 0, 0);
    const { to } = resolveLocalRange('2026-08-09', '2026-08-09', 7, now);
    expect(to).toEqual(now);
  });

  it('keeps the full end-of-day bound for a window that has already closed', () => {
    const now = new Date(2026, 7, 9, 10, 0, 0, 0);
    const { from, to } = resolveLocalRange('2026-08-07', '2026-08-08', 7, now);

    expect(from).toEqual(new Date(2026, 7, 7, 0, 0, 0, 0));
    expect(to).toEqual(new Date(2026, 7, 8, 23, 59, 59, 999));
  });

  it('is not zero-width for a single day', () => {
    const now = new Date(2026, 7, 10, 12, 0, 0, 0);
    const { from, to } = resolveLocalRange('2026-08-08', '2026-08-08', 7, now);
    expect(to.getTime() - from.getTime()).toBeGreaterThan(23 * 3_600_000);
  });

  /**
   * Sub-day bounds.
   *
   * The day-edge suffix used to be appended unconditionally, so a caller asking
   * for one hour got `2026-08-20T14:00:00T23:59:59.999` — an Invalid Date that
   * travelled all the way into the SQL and came back as a 500. A live screen that
   * wants the last thirty minutes has to be able to say so.
   */
  it('reads a full timestamp as the instant it names, not as a day edge', () => {
    const now = new Date(2026, 7, 20, 18, 0, 0, 0);
    const { from, to } = resolveLocalRange('2026-08-20T14:00:00', '2026-08-20T15:00:00', 7, now);

    expect(from).toEqual(new Date(2026, 7, 20, 14, 0, 0, 0));
    expect(to).toEqual(new Date(2026, 7, 20, 15, 0, 0, 0));
    expect(to.getTime() - from.getTime()).toBe(3_600_000);
  });

  it('still gives a bare date its whole day', () => {
    const now = new Date(2026, 7, 21, 12, 0, 0, 0);
    const { from, to } = resolveLocalRange('2026-08-20', '2026-08-20', 7, now);
    expect(from.getHours()).toBe(0);
    expect(to.getHours()).toBe(23);
  });

  it('ignores a bound it cannot parse rather than passing NaN down the stack', () => {
    const now = new Date(2026, 7, 20, 18, 0, 0, 0);
    const { from, to } = resolveLocalRange('not-a-date', 'rubbish', 2, now);

    expect(Number.isNaN(from.getTime())).toBe(false);
    expect(Number.isNaN(to.getTime())).toBe(false);
    expect(to).toEqual(now);
  });

  it('falls back to a trailing window ending now when no dates are given', () => {
    const now = new Date(2026, 7, 9, 10, 0, 0, 0);
    const { from, to } = resolveLocalRange(undefined, undefined, 7, now);
    expect(to).toEqual(now);
    expect(to.getTime() - from.getTime()).toBe(7 * 86_400_000);
  });
});
