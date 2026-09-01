import { readFileSync, existsSync, readdirSync } from 'fs';
import { join, sep } from 'path';

/**
 * Every link in the navigation points at a page that exists.
 *
 * ── Why this needed a test ──────────────────────────────────────────────────
 * The app has THREE copies of its own navigation: the sidebar, the Apps
 * launcher (`lib/quick-actions.ts`), and the shortcut strip at the bottom of
 * that file. Deleting a route updates none of them.
 *
 * When the nine OEE pages became three, the sidebar was rebuilt by hand and the
 * launcher was not — so six tiles sat on the Apps page pointing at routes that
 * had been deleted, and the only thing that surfaced them was a user opening
 * the page and finding icons that should have gone. A launcher is a copy of the
 * navigation, and a copy is the thing that goes stale.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Any `href: '/…'` in either file must resolve to an app-router page on disk.
 * Dynamic segments are skipped — `/quality/ncr/[id]` cannot be checked this
 * way — and so are external links.
 */

const WEB = join(__dirname, '../../../../web/src');
const APP = join(WEB, 'app', '(platform)');

/** Routes the app router serves outside the (platform) group. */
const EXTRA_ROOTS = [join(WEB, 'app')];

function pageExists(href: string): boolean {
  const parts = href.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('['))) return true; // dynamic, not checkable here
  for (const root of [APP, ...EXTRA_ROOTS]) {
    if (existsSync(join(root, ...parts, 'page.tsx'))) return true;
  }
  return false;
}

function hrefsIn(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const line of src.split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//')) continue;
    for (const m of line.matchAll(/href: '(\/[^']*)'/g)) out.push(m[1]);
  }
  return out;
}

const SOURCES = [
  ['sidebar', join(WEB, 'components', 'layout', 'sidebar.tsx')],
  ['apps launcher', join(WEB, 'lib', 'quick-actions.ts')],
] as const;

describe.each(SOURCES)('%s has no dead links', (_name, file) => {
  it('the file is where we think it is', () => {
    expect(existsSync(file)).toBe(true);
  });

  it('every href resolves to a page on disk', () => {
    const dead = [...new Set(hrefsIn(file))].filter((h) => !pageExists(h));
    expect(dead).toEqual([]);
  });

  it('links to the OEE section point at the three pages that exist', () => {
    const gone = ['/production/oee', '/manufacturing/oee', '/production/kpi',
      '/manufacturing/kpi', '/analytics', '/analytics/insights',
      '/manufacturing/machine-status', '/production/loss-tree',
      '/production/performance-analytics', '/production/quality-analytics',
      '/production/schedule-capacity'];
    const found = hrefsIn(file).filter((h) => gone.includes(h));
    expect(found).toEqual([]);
  });
});

describe('the route tree and the guard agree', () => {
  it('finds the app router', () => {
    expect(existsSync(APP)).toBe(true);
    expect(readdirSync(APP).length).toBeGreaterThan(10);
  });

  it('would catch a link to a route that is not there', () => {
    expect(pageExists('/live-shift')).toBe(true);
    expect(pageExists('/production/oee')).toBe(false);
    // A dynamic segment is not a dead link.
    expect(pageExists('/quality/ncr/[id]')).toBe(true);
  });

  it('the Dashboard Center no longer offers the Custom source', () => {
    // Removed at build time, not behind a flag: a flag is what gets switched
    // back on by accident in a deployed image.
    const dc = readFileSync(join(WEB, 'features', 'dashboard-center', 'dashboard-center-view.tsx'), 'utf8');
    const code = dc
      .split(String.fromCharCode(13)).join('')
      .split(String.fromCharCode(10))
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('{/*'));
      })
      .join(String.fromCharCode(10));
    expect(code).not.toContain("value: 'GRAFANA'");
    expect(code).not.toContain('useGrafanaHealth');
  });
});
