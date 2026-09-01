import * as fs from 'fs';
import * as path from 'path';

/**
 * A null factory is a SUPER_ADMIN, not "no factory".
 *
 * ── The bug, four times now ─────────────────────────────────────────────────
 * A SUPER_ADMIN's `factoryId` is null. Code that guards `if (!factoryId) return
 * null` therefore answers "nothing" for the account most likely to be looking —
 * and every caller of a shift resolver falls back to midnight when it gets
 * nothing. So the "Shift" period silently became "since today 00:00": no error,
 * no empty state, the button still highlighted.
 *
 * On this plant that was 6,361 units against 2,649 for one machine, and it is
 * why /production/oee/calculate?timeframe=shift disagreed with /oee-standard
 * over what was supposedly the same shift. They were not looking at the same
 * hours, and nothing on either screen said so.
 *
 * The fix is always the same: resolve ACROSS factories rather than bail. This
 * test exists because the fix has been applied three times to three copies, and
 * a fourth copy would be found the same way — by a user reporting numbers that
 * disagree.
 */

const UTIL = path.resolve(__dirname, 'shift-window.util.ts');

describe('shift resolution tolerates a null factory', () => {
  const src = fs.readFileSync(UTIL, 'utf8');
  const code = src
    .split(/\r?\n/)
    .filter((l) => {
      const t = l.trim();
      return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
    })
    .join(String.fromCharCode(10));

  it('exposes one window resolver, and the start reads from it', () => {
    // Two resolvers would drift: a shift that starts at one time for the window
    // and another for the slot end is the same class of bug one level down.
    expect(code).toContain('export async function currentShiftWindow');
    expect(code).toContain('export async function currentShiftStart');
    const start = code.slice(code.indexOf('export async function currentShiftStart'));
    expect(start).toContain('currentShiftWindow(prisma, factoryId)');
  });

  it('does not bail out on a null factory', () => {
    const win = code.slice(code.indexOf('export async function currentShiftWindow'));
    const body = win.slice(0, win.indexOf('export async function currentShiftStart'));
    // The guard that caused it.
    expect(body).not.toMatch(/if \(!factoryId\) return null;/);
    // And the shape that replaced it: the predicate is applied only when there
    // IS a factory, so a null one matches every factory's templates.
    expect(body).toMatch(/\.\.\.\(factoryId \? \{ factoryId \} : \{\}\)/);
  });

  it('still returns null when there are genuinely no templates', () => {
    // "No factory" and "no shifts configured" are different answers, and only
    // the second one justifies falling back.
    const win = code.slice(code.indexOf('export async function currentShiftWindow'));
    expect(win).toContain('if (templates.length === 0) return null;');
  });

  it('resolves the shift END, not just the start', () => {
    // The schedule basis divides by the slot an order was committed to, and for
    // a shift window that slot runs to the end of the SHIFT — not to now, and
    // not to midnight.
    const win = code.slice(code.indexOf('export async function currentShiftWindow'));
    expect(win).toContain('crossesMidnight ?');
    expect(win).toMatch(/return \{ start: startDt, end: endDt \};/);
  });

  it('would catch the guard coming back', () => {
    expect(/if \(!factoryId\) return null;/.test('  if (!factoryId) return null;')).toBe(true);
    expect(/\.\.\.\(factoryId \? \{ factoryId \} : \{\}\)/.test('where: { ...(factoryId ? { factoryId } : {}), isActive: true },')).toBe(true);
  });
});
