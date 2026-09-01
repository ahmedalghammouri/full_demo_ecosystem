import * as fs from 'fs';
import * as path from 'path';

/**
 * A date filter is parsed in one place.
 *
 * ── The bug, and how many times it was written ──────────────────────────────
 * A `dateFrom`/`dateTo` filter arrives as a string. Twenty-six places across
 * eight services turned it into a Date by appending a day edge:
 *
 *   new Date(`${dateTo}T23:59:59.999`)
 *
 * Which is correct for "2026-08-21" and produces
 * "2026-08-21T19:00:00T23:59:59.999" for anything carrying a time — an Invalid
 * Date that travels into the SQL as a null parameter and comes back as a 500.
 *
 * Six KPI endpoints were failing on exactly this and nobody knew, because the
 * web only ever sends whole dates. The first request for a narrower window
 * found all six at once. `quality.service.ts` already carried a local
 * `length <= 10` fix, applied four times by somebody who hit it and patched
 * where they stood.
 *
 * ── Two helpers, because there are two meanings ─────────────────────────────
 * `plantBound` anchors the day edge to the PLANT's clock, which is what a
 * production filter means. `utcBound` anchors it to UTC, which is what shift
 * generation and the scheduling horizon were deliberately written against —
 * re-pointing those at plant time would move every window by the plant's
 * offset, and for Riyadh that is three hours: a shift generated for the 21st
 * would begin on the 20th.
 *
 * Both accept a bare date OR a full timestamp. This test fails if anyone
 * appends a day edge by hand again.
 */

const SRC = path.resolve(__dirname, '..');
const HOME = 'common/plant-time.util.ts';

/** `new Date(`${x}T00:00:00…`)` — the day edge, appended by hand. */
const HAND_ROLLED = /new Date\(`\$\{[^}]+\}T(?:00:00:00|23:59:59)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('date bounds are parsed in one place', () => {
  const files = walk(SRC);

  it('finds the source tree and the helpers', () => {
    expect(files.length).toBeGreaterThan(50);
    const home = fs.readFileSync(path.join(SRC, HOME), 'utf8');
    expect(home).toContain('export function plantBound');
    expect(home).toContain('export function utcBound');
  });

  it('nobody appends a day edge by hand', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(SRC, f).replace(/\\/g, '/');
      if (rel === HOME) continue;
      for (const [i, line] of fs.readFileSync(f, 'utf8').split('\n').entries()) {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
        // A line that guards the length itself is the old local fix; it is not
        // the defect, though it is still a copy of the parse.
        if (line.includes('length <= 10')) continue;
        if (HAND_ROLLED.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The guard has to be able to fail, or it passes every file forever.
   */
  it('would catch a new copy', () => {
    expect(HAND_ROLLED.test('const to = new Date(`${dateTo}T23:59:59.999`);')).toBe(true);
    expect(HAND_ROLLED.test('const from = new Date(`${q.dateFrom}T00:00:00.000Z`);')).toBe(true);
    // Not fooled by an ordinary Date, or by a literal that carries no filter.
    expect(HAND_ROLLED.test('const d = new Date(row.bucketStart);')).toBe(false);
    expect(HAND_ROLLED.test("const d = new Date('2026-08-21T00:00:00');")).toBe(false);
  });
});
