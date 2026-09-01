import * as fs from 'fs';
import * as path from 'path';

/**
 * "Shift" and "Today" are different windows.
 *
 * ── The bug ─────────────────────────────────────────────────────────────────
 * The filter panel's two buttons sent IDENTICAL dates. `useTimeRange` rounds
 * dateFrom down to midnight for both presets and distinguishes them only by a
 * `timeframe` parameter that neither engine controller read — so selecting
 * Shift produced the same window, the same charts and the same numbers as
 * Today, and the night shift's first four and a half hours were simply absent
 * from the view that claimed to show it.
 *
 *   day    2026-08-21T21:00Z → now     4 trend buckets
 *   shift  2026-08-21T21:00Z → now     4 trend buckets      ← before
 *   shift  2026-08-21T16:30Z → now     9 trend buckets      ← after
 *
 * ── Why the server resolves it ──────────────────────────────────────────────
 * A shift is not a client-side concept: only the server holds the templates.
 * The client says "shift" and the API decides which hours that is, using the
 * same helper Live Shift and the production endpoints use. Two resolvers would
 * mean "the shift" covering different hours depending on which route answered.
 */

const CTRLS = [
  path.resolve(__dirname, 'oee-standard.controller.ts'),
  path.resolve(__dirname, '..', 'oee-schedule', 'oee-schedule.controller.ts'),
];

describe.each(CTRLS.map((f) => [path.basename(f), f]))('%s honours timeframe=shift', (_name, file) => {
  const src = fs.readFileSync(file as string, 'utf8');
  const code = src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
    })
    .join(String.fromCharCode(10));

  it('accepts the parameter', () => {
    expect(code).toMatch(/@Query\('timeframe'\) timeframe\?: string,/);
  });

  it('resolves the window through the shared resolver, not resolveLocalRange alone', () => {
    // A controller that parses the dates directly cannot tell the two presets
    // apart, because the dates are identical.
    expect(code).toContain('resolveRequestWindow(');
    expect(code).not.toMatch(/const \{ from, to \} = resolveLocalRange\(dateFrom, dateTo, 1\);/);
  });

  it('uses the ONE shift resolver', () => {
    expect(code).toContain('currentShiftWindow(');
  });

  it('takes the slot end from the shift, not from now', () => {
    // The schedule basis divides by the slot an order was committed to; for a
    // shift that runs to the END of the shift.
    const fn = code.slice(code.indexOf('async function resolveRequestWindow'));
    expect(fn).toMatch(/return \{ from: shift\.start, to: now, slotTo: shift\.end \};/);
  });

  it('falls back to the dates when no shift is configured', () => {
    // "No templates" is a real answer. Inventing a window would be worse than
    // honouring the one the client asked for.
    const fn = code.slice(code.indexOf('async function resolveRequestWindow'));
    expect(fn).toContain('resolveLocalRange(dateFrom, dateTo, 1, now)');
  });
});
