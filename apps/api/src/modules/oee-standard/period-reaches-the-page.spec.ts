import { readFileSync, readdirSync } from 'fs';
import { join, sep } from 'path';

/**
 * A page that shows a period must SEND the period.
 *
 * ── Three times now ─────────────────────────────────────────────────────────
 * The filter panel's Today and Shift buttons produce the SAME dateFrom and
 * dateTo — deliberately, because a shift is not a client-side concept: only the
 * API holds the templates. What distinguishes them is `timeframe`, and
 * `useTimeRange` returns it inside `params`.
 *
 * Every page that reached past `params` to take the two date fields therefore
 * lost the distinction, and Shift silently became Today:
 *
 *   production-overview.tsx   imported useTimeRange and never called it
 *   oee-analysis-view.tsx     destructured { dateFrom, dateTo }
 *   oee-breakdown-view.tsx    destructured { dateFrom, dateTo }
 *   scope-panel.tsx           picked params.dateFrom / params.dateTo out
 *
 * Each looked correct in isolation. The failure was only visible by switching
 * the two buttons and seeing nothing change — which is what a user reported,
 * twice, before this test existed.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Spread the whole `params`. If a caller genuinely needs the raw dates for
 * something else it may still read them, but the request it builds carries the
 * period entire.
 */

const WEB = join(__dirname, '../../../../web/src');

/** Files that call an endpoint whose window the period governs. */
const PERIOD_ENDPOINTS = /'\/(oee-standard|oee-schedule|production\/oee\/|production\/kpis|dashboard\/(overview|kpis|command-center|executive)|machine-status\/)/;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx') || e.name.endsWith('.ts')) out.push(p);
  }
  return out;
}

describe('the selected period reaches the request', () => {
  /**
   * Scope: any page that READS a period-scoped endpoint.
   *
   * The first version also required `useTimeRange` to be imported, which meant
   * a page that never thought about the period at all was silently exempt —
   * and that is exactly how manufacturing-overview asked /dashboard/overview
   * for whatever it defaults to while the filter panel sat above it.
   *
   * A LIVE page is exempt, and says so: its window is the running shift and the
   * browser has no say in it.
   */
  const files = walk(WEB).filter((f) => {
    const src = readFileSync(f, 'utf8');
    if (!PERIOD_ENDPOINTS.test(src)) return false;
    return !src.includes("useDeclareViewMode('live')");
  });

  it('finds the pages that read a period-scoped endpoint', () => {
    expect(files.length).toBeGreaterThan(2);
  });

  /**
   * The rule is about the REQUEST, not the destructuring.
   *
   * A page may legitimately read `dateFrom` for a label, or pass it to an
   * endpoint that names its parameters differently. What it must not do is
   * build the request out of the two dates alone, because those are identical
   * for Today and Shift.
   */
  it('every one of them sends the period, not just the dates', () => {
    const offenders = files
      .filter((f) => {
        const src = readFileSync(f, 'utf8');
        // The accepted forms: spreading the hook's params under either name, the
        // `{ params }` shorthand, or naming `timeframe` in a params object.
        return !(src.includes('...timeParams') || src.includes('...params')
                 || src.includes('{ params }') || src.includes('params,')
                 || src.includes('timeframe,') || src.includes('timeframe:'));
      })
      .map((f) => f.slice(WEB.length + 1).split(sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('would catch a request built from the dates alone', () => {
    const carries = (s: string) => s.includes('...timeParams') || s.includes('...params')
      || s.includes('timeframe,') || s.includes('timeframe:');
    expect(carries("api.get('/oee-standard', { params: { dateFrom, dateTo } })")).toBe(false);
    expect(carries("api.get('/oee-standard', { params: { ...timeParams } })")).toBe(true);
    expect(carries("params: { lineId, timeframe, dateFrom, dateTo }")).toBe(true);
  });
});
