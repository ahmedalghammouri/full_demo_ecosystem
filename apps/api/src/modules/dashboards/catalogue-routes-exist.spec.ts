import { readFileSync, existsSync } from 'fs';
import { join, sep } from 'path';

/**
 * Every seeded dashboard points at a page that exists.
 *
 * ── Why the seed and not the database ───────────────────────────────────────
 * `prod-init.js` runs the Dashboard Center seed on EVERY deploy, deliberately:
 * that is how a newly added dashboard reaches an existing installation. It also
 * means the seed — not the database — is the catalogue's source of truth, and a
 * row fixed by hand in one environment is back the next time the image ships.
 *
 * When the nine OEE pages became three, three seeded entries kept pointing at
 * /production/kpi, /production/oee and /manufacturing/oee. The catalogue offered
 * three cards that led nowhere, and offered none of the three pages that had
 * replaced them.
 *
 * ── The slugs were reused on purpose ────────────────────────────────────────
 * A slug is the upsert key. Reusing the three carries any favourite or
 * permission somebody had set on the old card onto the page that took its job,
 * rather than orphaning one row and inserting another beside it.
 */

const API = join(__dirname, '..', '..', '..');
const SEED = join(API, 'prisma', 'seeds', 'dashboard-center.seed.ts');
const APP = join(API, '..', 'web', 'src', 'app', '(platform)');

function seededRoutes(): string[] {
  const src = readFileSync(SEED, 'utf8');
  const out: string[] = [];
  for (const line of src.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//')) continue;
    const m = line.match(/route: '(\/[^']*)'/);
    if (m) out.push(m[1]);
  }
  return out;
}

describe('the seeded catalogue matches the app router', () => {
  const routes = seededRoutes();

  it('reads the seed', () => {
    expect(routes.length).toBeGreaterThan(10);
  });

  it('every seeded route resolves to a page', () => {
    const dead = [...new Set(routes)].filter(
      (r) => !existsSync(join(APP, ...r.split('/').filter(Boolean), 'page.tsx')),
    );
    expect(dead).toEqual([]);
  });

  it('the three OEE pages are in the catalogue', () => {
    for (const r of ['/live-shift', '/oee-analysis', '/oee-breakdown']) {
      expect([r, routes.includes(r)]).toEqual([r, true]);
    }
  });

  it('no route points at a page that was deleted', () => {
    const gone = ['/production/oee', '/production/kpi', '/manufacturing/oee',
      '/manufacturing/kpi', '/analytics', '/analytics/insights',
      '/manufacturing/machine-status', '/production/loss-tree',
      '/production/schedule-capacity'];
    expect(routes.filter((r) => gone.includes(r))).toEqual([]);
  });

  it('the seed no longer re-adds the Grafana suite', () => {
    // It ran on every deploy, so excluding Custom at the API would have been
    // undone by the next image ship.
    const src = readFileSync(SEED, 'utf8');
    const code = src
      .split(String.fromCharCode(13)).join('')
      .split(String.fromCharCode(10))
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
      })
      .join(String.fromCharCode(10));
    expect(code).toContain('const GRAFANA_DASHBOARDS: DashboardSeed[] = [];');
    // No seed ENTRY declares that source. The upsert still references the enum
    // when deciding what counts as published, which is logic, not a row.
    expect(code).not.toContain('source: DashboardSource.GRAFANA');
  });

  it('would catch a route with no page', () => {
    const has = (r: string) => existsSync(join(APP, ...r.split('/').filter(Boolean), 'page.tsx'));
    expect(has('/oee-analysis')).toBe(true);
    expect(has('/production/oee')).toBe(false);
    expect(APP.split(sep).length).toBeGreaterThan(3);
  });
});
