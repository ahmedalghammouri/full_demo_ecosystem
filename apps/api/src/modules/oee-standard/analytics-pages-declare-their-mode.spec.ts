import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * Every analytics page declares its view mode.
 *
 * ── Why a page that "forgot" is worse than one that never had it ────────────
 * `useDeclareViewMode` is what shows or hides the shell's period control. A
 * page that skips it does not get a default -- it inherits whatever the LAST
 * page set. So the Downtime Command Center, the KPI sheets, the Command Center,
 * the Executive view and both energy pages showed a filter bar whose contents
 * depended on where the reader had just been.
 *
 * The customer reported it as "the filter bar is incomplete". It was not
 * missing; it was undeclared, and therefore different on every visit. That is
 * the harder version of the same bug: it works when you test it, because you
 * arrived from a page that happened to set the right mode.
 *
 * ── What this checks ────────────────────────────────────────────────────────
 * Any page that reads a period-scoped endpoint must SAY which mode it is. It
 * does not care which -- 'live' and 'analytics' are both honest answers -- only
 * that the page answers rather than inheriting.
 */
const WEB = join(__dirname, '..', '..', '..', '..', 'web', 'src');

/** Endpoints whose answer depends on the selected period. */
const PERIOD_ENDPOINTS =
  /\/(oee-standard|production\/kpi|downtime\/cockpit|energy\/(overview|analytics|cockpit)|executive|command-center)/;

/**
 * PAGES only -- `features/**` components that export a `*View` or `*Overview`.
 *
 * The first draft walked everything and flagged route wrappers, the app shell,
 * the scope panel and a card fragment. All of those legitimately mention a
 * period endpoint without owning the page's mode, and a check that shouts about
 * them teaches people to ignore it.
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx$/.test(p) && !/\.spec\.tsx$/.test(p)) out.push(p);
  }
  return out;
}

const isPage = (file: string, src: string) =>
  file.includes(`${sep}features${sep}`)
  && /export (?:default )?function \w*(View|Overview)\s*\(/.test(src);

describe('a page that reads a period endpoint declares its mode', () => {
  const pages = walk(WEB).filter((f) => {
    const src = readFileSync(f, 'utf8');
    return PERIOD_ENDPOINTS.test(src) && isPage(f, src);
  });

  it('finds the pages to check', () => {
    // If this ever drops to nothing, the regex above stopped matching and the
    // suite would pass by testing nothing at all.
    expect(pages.length).toBeGreaterThan(3);
  });

  it('every one of them says which mode it is', () => {
    const silent = pages
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        // Declaring it directly, or rendering the tab shell that declares it.
        return !src.includes('useDeclareViewMode')
          && !src.includes('AnalyticsTabs')
          && !src.includes('LiveAnalyticsTabs');
      })
      .map((f) => f.slice(WEB.length + 1).split(sep).join('/'));

    expect(silent).toEqual([]);
  });

  it('would catch a page that inherits instead of declaring', () => {
    // The guard's own guard: prove the check can fail, so a future refactor
    // that makes `includes` always true does not pass silently.
    const declares = (s: string) =>
      s.includes('useDeclareViewMode') || s.includes('AnalyticsTabs') || s.includes('LiveAnalyticsTabs');
    expect(declares("export default function X() { return null; }")).toBe(false);
    expect(declares("useDeclareViewMode('analytics');")).toBe(true);
  });
});
