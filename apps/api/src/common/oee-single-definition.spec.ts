import * as fs from 'fs';
import * as path from 'path';

/**
 * OEE is multiplied in exactly one file.
 *
 * ── What this guards ────────────────────────────────────────────────────────
 * The product `A × P × Q` was written out by hand in eighteen places across
 * eight services. The multiplication never drifted — three numbers multiply the
 * same way everywhere. What drifted was the handling around it, and that is
 * what reached a screen:
 *
 *   `(a / 100) * (p / 100) * (q / 100) * 100`          no null guard at all
 *   `((r.performance ?? 0) / 100) * …`                 a missing factor as ZERO
 *   `a != null && p != null ? … : null`                null propagated
 *
 * A machine with no parts counted has no measurable Performance. Coercing that
 * to 0% produces an OEE of 0.0% for a machine that ran perfectly well, and no
 * reader can tell it from a machine that genuinely produced nothing. The engines
 * work hard to keep "not measured" distinct from "measured at zero"; one `?? 0`
 * at the last step throws it away.
 *
 * So the arithmetic lives in `oee-identity.util.ts` and nowhere else. This test
 * fails the moment a nineteenth copy appears — which is the only way a rule like
 * this survives contact with a deadline.
 */

const SRC = path.resolve(__dirname, '..');
const HOME = 'common/oee-identity.util.ts';

/**
 * The product, in the spellings it actually appeared in.
 *
 * Deliberately loose about what sits between the divisions: the point is to
 * catch `something / 100` multiplied by two more of the same, whatever the
 * operands are called.
 */
const PRODUCT = /\/\s*100\s*\)?\s*\*\s*\(?[^;\n]{0,80}?\/\s*100\s*\)?\s*\*\s*\(?[^;\n]{0,80}?\/\s*100\s*\)?\s*\*\s*100/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

describe('OEE is multiplied in one place', () => {
  const files = walk(SRC);

  it('finds the source tree', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some((f) => f.endsWith(path.normalize(HOME)))).toBe(true);
  });

  it('has no hand-written A × P × Q outside the identity module', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const rel = path.relative(SRC, f).replace(/\\/g, '/');
      if (rel === HOME) continue;
      const src = fs.readFileSync(f, 'utf8');
      for (const [i, line] of src.split('\n').entries()) {
        if (line.trim().startsWith('*') || line.trim().startsWith('//')) continue;
        if (PRODUCT.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The guard has to be able to fail. A pattern that matches nothing passes
   * every file forever, which is worse than having no rule.
   */
  it('would catch a new copy', () => {
    expect(PRODUCT.test('const oee = (availability / 100) * (performance / 100) * (quality / 100) * 100;')).toBe(true);
    expect(PRODUCT.test('const x = ((a ?? 0) / 100) * ((b ?? 0) / 100) * ((c ?? 0) / 100) * 100;')).toBe(true);
    // And not fire on something innocent.
    expect(PRODUCT.test('const pct = (good / total) * 100;')).toBe(false);
    expect(PRODUCT.test('const half = (a / 100) * 50;')).toBe(false);
  });

  it('every service that reports OEE imports the identity module', () => {
    // A file that computes OEE but imports nothing is computing it some other
    // way — which is the thing being prevented.
    const reporting = files.filter((f) => {
      const rel = path.relative(SRC, f).replace(/\\/g, '/');
      if (rel === HOME || rel.includes('.dto') || rel.includes('.module')) return false;
      const src = fs.readFileSync(f, 'utf8');
      return /\boee\s*[:=]/.test(src) && /availability/.test(src) && /performance/.test(src);
    });
    expect(reporting.length).toBeGreaterThan(3);

    const without = reporting
      .filter((f) => !fs.readFileSync(f, 'utf8').includes('oee-identity.util'))
      .map((f) => path.relative(SRC, f).replace(/\\/g, '/'))
      // These read OEE that someone else computed; they never derive it.
      .filter((rel) => ![
        'modules/dashboard/dashboard.service.ts',
        'modules/plant-dashboards/plant-dashboards.service.ts',
        'modules/production/machine-status.service.ts',
        'modules/production/machine-status.controller.ts',
        'modules/historian/production-snapshot.service.ts',
        'modules/ai/ai.service.ts',
        // These read an OEE someone else computed — an average of stored rows,
        // a report column, a live card delegating to OEEService. None derives it.
        'modules/auth/auth.service.ts',
        'modules/production/live-kpi.service.ts',
        'modules/reports/reports.service.ts',
      ].includes(rel));

    expect(without).toEqual([]);
  });
});
