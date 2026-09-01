import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * "Now" and "over a period" are different questions, and the code must keep them
 * apart on its own.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * Every dashboard used to answer both at once: a card showing current output
 * beside a chart showing output over the selected window, both driven by the same
 * scope tree and the same time filter. A reader could not tell which number
 * described this minute and which described last week — and when they disagreed,
 * neither could be trusted.
 *
 * The separation was a convention, and conventions drift. These tests make it
 * structural: the live service has no date parameter to abuse, and the analytics
 * service has no live table to read. Both still go through the one aggregate, so
 * "live" describes a WINDOW, never a second arithmetic.
 */
describe('live and analytics are separate by construction', () => {
  const src = (f: string) =>
    readFileSync(join(__dirname, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  const live = src('live-kpi.service.ts');
  const liveCtl = src('live.controller.ts');
  const analytics = src('oee-analytics.service.ts');

  describe('the live service cannot be asked about the past', () => {
    it('takes no date range in any signature', () => {
      // The whole point: there is no parameter to pass one. A live page cannot
      // quietly become a historical one.
      expect(live).not.toMatch(/dateFrom/);
      expect(live).not.toMatch(/dateTo/);
    });

    it('exposes no date range on the endpoint either', () => {
      expect(liveCtl).not.toMatch(/dateFrom|dateTo|timeframe/);
    });

    it('derives its window from the shift templates', () => {
        // `currentShiftWindow` resolves both edges of the running shift. The start
      // is the data window; the end is the committed slot the schedule basis
      // divides by. `currentShiftStart` is a read of the same resolver.
    expect(live).toMatch(/currentShift(Start|Window)\(/);
    });

    it('reads the one canonical aggregate, not a query of its own', () => {
      expect(live).toContain('machineFactTotals(');
      expect(live.match(/SUM\(\s*"?runMin/gi)).toBeNull();
      expect(live.match(/SUM\(\s*"?plannedMin/gi)).toBeNull();
    });
  });

  describe('the analytics service cannot read the present', () => {
    it('does not read the live machine state table', () => {
      // MachineCurrentStatus holds "now" and has no meaning in a window. An
      // analytics page that consulted it would report an instant inside a period.
      expect(analytics).not.toMatch(/machineCurrentStatus/i);
    });

    it('does not read job orders directly', () => {
      // Job-order state is live. Everything historical about a job order is in
      // the fact store, tagged with its id.
      expect(analytics).not.toMatch(/prisma\.jobOrder\b/);
    });
  });

  describe('no surface grades a job order on its own', () => {
    const production = src('production.service.ts');

    it('has removed calcJobOrderOEE entirely', () => {
      // It computed availability as elapsed-since-start over planned duration with
      // NO downtime subtracted — the fail-open assumption, still running in its own
      // corner long after the fact store stopped making it. The shop-floor live
      // page and every per-step badge read from it.
      expect(production).not.toMatch(/calcJobOrderOEE/);
    });

    it('reads step factors from the fact store instead', () => {
      expect(production).toContain('jobOrderFactTotals(');
    });

    it('batches them, so a list of steps is one query not forty', () => {
      expect(production).toMatch(/jobOrderFactors\(\s*[\s\S]{0,120}flatMap/);
    });
  });

  describe('the browser cannot reintroduce a time filter either', () => {
    // The web package has no test runner of its own, and this invariant is worth
    // more than the tidiness of keeping the check in the same package as the code.
    // Both live in one repo and ship together.
    const liveDir = join(__dirname, '../../../../web/src/features/live');
    // Comments are stripped: live-shared.tsx states the rule in prose, naming the
    // hook it must never import, and a scan that counted prose as code would fail
    // on the explanation rather than on the code.
    const read = (f: string) => readFileSync(join(liveDir, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    it('the live feature folder exists where expected', () => {
      // A moved folder must fail loudly rather than skip silently — a guard that
      // quietly stops running is worse than no guard.
      expect(existsSync(liveDir)).toBe(true);
    });

    it.each(['live-shared.tsx', 'live-production-view.tsx', 'live-machines-view.tsx'])(
      '%s does not import the time-range hook',
      (f) => {
        expect(read(f)).not.toMatch(/use-time-range|useTimeRange/);
      },
    );

    it.each(['live-production-view.tsx', 'live-machines-view.tsx'])(
      '%s goes through the shared hook rather than its own query',
      (f) => {
        const src = read(f);
        expect(src).toContain('useLive(');
        // A page with its own useQuery could point at a historical endpoint and
        // drift from its sibling without anyone noticing.
        expect(src).not.toMatch(/useQuery\(/);
      },
    );

    it('sends only a line from the scope tree, never a machine', () => {
      const src = read('live-shared.tsx');
      expect(src).toMatch(/type === 'LINE'/);
    });
  });

  describe('the period control belongs to the analytics half only', () => {
    const web = join(__dirname, '../../../../web/src');
    const read = (rel: string) => readFileSync(join(web, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

    it('the filter panel renders the period section behind the view mode', () => {
      // On a live view the window is the running shift and the browser has no say
      // in it. A visible period selector there invites a change that does nothing,
      // which is the confusion the whole split exists to end.
      const panel = read('components/layout/scope-panel.tsx');
      expect(panel).toContain('useViewModeStore');
      expect(panel).toMatch(/viewMode === 'analytics' &&[\s\S]{0,200}PeriodSection/);
    });

    it('the tab component drives that mode rather than each page remembering', () => {
      const tabs = read('components/layout/live-analytics-tabs.tsx');
      expect(tabs).toContain('useViewModeStore');
      expect(tabs).toContain("setMode");
    });

    it.each([
      ['features/live/live-production-view.tsx', 'live'],
      ['features/live/live-machines-view.tsx', 'live'],
      // The four standalone analytics views these listed are gone: availability,
      // performance, quality and loss are tabs on the analysis page now, declared
      // analytical once by the page that owns them rather than four times over.
      ['features/production/schedule-capacity-view.tsx', 'analytics'],
      ['features/oee-analysis/oee-analysis-view.tsx', 'analytics'],
      ['features/oee-breakdown/oee-breakdown-view.tsx', 'analytics'],
    ])('%s declares itself as %s', (file, mode) => {
      // A page that skips this inherits whatever the last page set — which is how
      // a live screen ends up offering a date range it cannot honour.
      expect(read(file)).toContain(`useDeclareViewMode('${mode}')`);
    });
  });

  describe('one live page, two analytical pages, and nothing in between', () => {
    const web = join(__dirname, '../../../../web/src');
    const read = (rel: string) => readFileSync(join(web, rel), 'utf8');
    const exists = (rel: string) => existsSync(join(web, rel));

    /**
     * ── What this replaced ────────────────────────────────────────────────
     * Every subject used to own a page with a Now tab and an Analytics tab:
     * OEE, Equipment, Performance, Quality, Loss Tree, Schedule & Capacity,
     * plus Factory Analytics, Insights Studio and KPI Sheets alongside. Nine
     * routes, each asking a period question about the same scope and window,
     * five of them plain duplicates of tabs that already existed.
     *
     * The split they enforced was real and still is — a value read as "now"
     * must not be read as "the month". What changed is where the line falls.
     * It is no longer per subject: ONE page answers "now", and the analytical
     * pages carry every period question as tabs. So the rule guarded here moved
     * from "each subject pairs both readings" to "the live page is live, the
     * analytical pages are analytical, and neither borrows the other's
     * question".
     */
    it('the deleted subject pages are gone, not merely unlinked', () => {
      for (const f of [
        'features/production/oee-page.tsx',
        'features/production/availability-page.tsx',
        'features/manufacturing/machine-status-page.tsx',
        'features/production/performance-page.tsx',
        'features/production/quality-page.tsx',
        'features/production/loss-tree-page.tsx',
        'features/production/schedule-capacity-page.tsx',
        'features/production/kpi-page.tsx',
        'features/analytics/factory-analytics-view.tsx',
        'features/analytics/insights-studio-view.tsx',
      ]) {
        expect([f, exists(f)]).toEqual([f, false]);
      }
    });

    it('Live Shift is the live page, and reads the live endpoint', () => {
      expect(read('features/live-shift/use-live-shift.ts')).toContain("'/live-shift'");
      const src = read('features/live-shift/live-shift-view.tsx');
      expect(src).not.toContain("'/oee-standard'");
      expect(src).not.toContain("'/oee-schedule'");
    });

    it('the analytical pages read the engines directly', () => {
      for (const f of ['features/oee-analysis/oee-analysis-view.tsx',
                       'features/oee-breakdown/oee-breakdown-view.tsx']) {
        const src = read(f);
        expect([f, src.includes("'/oee-standard'")]).toEqual([f, true]);
        expect([f, src.includes("'/oee-schedule'")]).toEqual([f, true]);
        expect([f, src.includes("useDeclareViewMode('analytics')")]).toEqual([f, true]);
      }
    });

    it('the analysis page still renders everything it absorbed', () => {
      const src = read('features/oee-analysis/oee-analysis-view.tsx');
      for (const v of ['MachineStatusView', 'ScheduleCapacityView', 'HierarchyOEE']) {
        expect([v, src.includes(v)]).toEqual([v, true]);
      }
      for (const t of ['equipment', 'schedule', 'tree']) {
        expect([t, src.includes("key: '" + t + "'")]).toEqual([t, true]);
      }
    });

    it('the breakdown page still renders everything it absorbed', () => {
      const src = read('features/oee-breakdown/oee-breakdown-view.tsx');
      expect(src).toContain('ProductionKpiView');
      expect(src).toContain("key: 'kpis'");
    });

    it('the routes exist for exactly those three pages', () => {
      const app = join(web, 'app/(platform)');
      for (const r of ['live-shift', 'oee-analysis', 'oee-breakdown']) {
        expect([r, existsSync(join(app, r, 'page.tsx'))]).toEqual([r, true]);
      }
      for (const r of ['production/oee', 'manufacturing/machine-status',
                       'production/performance-analytics', 'production/quality-analytics',
                       'production/loss-tree', 'production/schedule-capacity',
                       'analytics', 'production/kpi']) {
        expect([r, existsSync(join(app, r, 'page.tsx'))]).toEqual([r, false]);
      }
    });
  });

  describe('both answer with the same arithmetic', () => {
    it('routes through the canonical aggregate in kpi.service', () => {
      for (const s of [live, analytics]) expect(s).toContain('machineFactTotals(');
    });

    it('derives its factors from the shared function, not its own formula', () => {
      // The null-rather-than-zero rule, the two availability bases and the OEE
      // composition all live in KpiService.factorsFromFacts. This page must call
      // it rather than restate any of them — a restatement is a second engine
      // wearing a smaller hat. The rules themselves are covered by
      // oee-both-bases.spec.ts.
      expect(live).toContain('factorsFromFacts(');
      expect(live).not.toMatch(/plannedMin > 0 \?/);
    });

    it('carries BOTH availability bases through to the live payload', () => {
      // Unifying the engine once dropped the time-based pair from every surface
      // and nothing failed, because what remained was still correct.
      expect(live).toMatch(/availabilityTb/);
      expect(live).toMatch(/oeeTb/);
    });
  });
});
