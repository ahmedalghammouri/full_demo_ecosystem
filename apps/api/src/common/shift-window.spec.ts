import { resolveShiftAt, type ShiftTemplateWindow } from './shift-window.util';

/**
 * Deriving the shift from a TIMESTAMP.
 *
 * Shift attribution used to require a `ShiftInstance` row linked to the work order.
 * Nothing ever created one: the whole database held a single instance, twelve days
 * stale, so every "group by shift" collapsed into one bucket labelled "Unassigned" —
 * while the Command Center cheerfully displayed the current shift's NAME, because
 * that came from the templates instead.
 *
 * Deriving it needs no rows, works for history as well as live, and lets a single
 * production order be attributed across every shift it actually ran in.
 *
 * The overnight cases are the ones worth pinning: 02:00 belongs to the night shift
 * that STARTED yesterday, not to a new occurrence today.
 */
describe('resolveShiftAt', () => {
  // the pilot site's two-shift pattern.
  const templates: ShiftTemplateWindow[] = [
    { id: 't1', code: 'S1', name: 'Shift 1 — Day', startTime: '07:30', endTime: '19:30', crossesMidnight: false },
    { id: 't2', code: 'S2', name: 'Shift 2 — Night', startTime: '19:30', endTime: '07:30', crossesMidnight: true },
  ];

  /** Local-time constructor — templates are plant-local wall clock. */
  const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi, 0, 0);

  it('puts mid-morning in the day shift', () => {
    const r = resolveShiftAt(at(2026, 8, 8, 10, 15), templates)!;
    expect(r.code).toBe('S1');
    expect(r.shiftStart).toEqual(at(2026, 8, 8, 7, 30));
  });

  it('puts mid-evening in the night shift, starting today', () => {
    const r = resolveShiftAt(at(2026, 8, 8, 22, 0), templates)!;
    expect(r.code).toBe('S2');
    expect(r.shiftStart).toEqual(at(2026, 8, 8, 19, 30));
  });

  it('attributes 02:00 to the night shift that began the PREVIOUS day', () => {
    const r = resolveShiftAt(at(2026, 8, 9, 2, 0), templates)!;
    expect(r.code).toBe('S2');
    expect(r.shiftStart).toEqual(at(2026, 8, 8, 19, 30));
    // The occurrence is dated by the day it STARTED, so a night shift is not split
    // across two calendar days in a report.
    expect(r.shiftDate).toEqual(at(2026, 8, 8, 0, 0));
  });

  it('treats the boundary minute as the start of the next shift, not the end of the last', () => {
    expect(resolveShiftAt(at(2026, 8, 8, 19, 30), templates)!.code).toBe('S2');
    expect(resolveShiftAt(at(2026, 8, 8, 7, 30), templates)!.code).toBe('S1');
    expect(resolveShiftAt(at(2026, 8, 8, 19, 29), templates)!.code).toBe('S1');
  });

  it('returns null in a genuine gap between shifts rather than guessing', () => {
    const partial: ShiftTemplateWindow[] = [
      { id: 't1', code: 'S1', name: 'Day', startTime: '08:00', endTime: '16:00', crossesMidnight: false },
    ];
    expect(resolveShiftAt(at(2026, 8, 8, 3, 0), partial)).toBeNull();
  });

  it('returns null when no templates are configured', () => {
    expect(resolveShiftAt(at(2026, 8, 8, 10, 0), [])).toBeNull();
  });
});
