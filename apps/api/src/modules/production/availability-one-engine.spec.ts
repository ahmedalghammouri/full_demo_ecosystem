import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * One engine computes availability. Not four.
 *
 * ── Why this file exists ────────────────────────────────────────────────────
 * On 18 Aug 2026 a plant manager had four pages open at once and read four
 * different availabilities for the same machine at the same moment: 92.7%, 91.8%,
 * 0% and 0%. Each page carried its own arithmetic over its own source, so a data
 * bug in one was invisible to the others — and a number nobody can reconcile is
 * a number nobody believes, whichever one happens to be right.
 *
 * The fix was not to correct three of them. It was to leave exactly one
 * implementation — `KpiService.machineFactTotals` — and have every surface read
 * it. This test defends that shape, because the failure mode is additive: nothing
 * breaks when somebody writes a second query, it just quietly starts disagreeing.
 *
 * It reads source, so it needs no database and no running app.
 */
describe('availability has one implementation', () => {
  const read = (f: string) =>
    readFileSync(join(__dirname, f), 'utf8')
      // Comments discuss the old duplication by name; only code counts here.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');

  const kpi = read('kpi.service.ts');
  const analytics = read('oee-analytics.service.ts');
  const status = read('machine-status.service.ts');

  it('exposes the aggregate from the KPI service', () => {
    expect(kpi).toContain('async machineFactTotals(');
  });

  it.each([
    ['oee-analytics.service.ts', () => analytics],
    ['machine-status.service.ts', () => status],
  ])('%s reads it rather than querying the fact store itself', (_f, get) => {
    const src = get();
    expect(src).toContain('machineFactTotals(');
    // The tell-tale of a second implementation: its own SUM over the snapshots.
    expect(src).not.toMatch(/SUM\(\s*"?runMin/i);
    expect(src).not.toMatch(/SUM\(\s*"?plannedMin/i);
  });

  it('leaves NO page summing runMin out of the fact store itself', () => {
    // kpi.service holds the canonical aggregates — per machine, per day, per scope.
    // Everywhere else must ask it. This is the invariant that keeps a fifth engine
    // from appearing: nothing breaks when somebody adds one, it just quietly starts
    // disagreeing with the other four, which is how this began.
    for (const src of [analytics, status]) {
      expect(src.match(/SUM\(\s*"?runMin/gi)).toBeNull();
      expect(src.match(/SUM\(\s*"?plannedMin/gi)).toBeNull();
      expect(src.match(/SUM\(\s*"?idealRunMin/gi)).toBeNull();
    }
  });

  it('gives the trend charts one implementation too', () => {
    // The daily series existed twice, and the machine-status copy was missing the
    // granularity filter the canonical one has.
    expect(kpi).toContain('async dailyFactTotals(');
    expect(analytics).toContain('dailyFactTotals(');
    expect(status).toContain('dailyFactTotals(');
  });

  /**
   * The invariant is that a rollup row is never summed on top of the minutes it
   * rolls up. How that is enforced changed with the store.
   *
   * `production_snapshots` held every granularity in one table — MINUTE, HOUR,
   * SHIFT, DAY, JO — so each aggregate had to carry `granularity = 'MINUTE'` or
   * it would double-count. `oee_minutes` has no granularity column at all: one
   * row IS one minute, and there is nothing coarser in the table to mix in. The
   * predicate became meaningless the moment the source changed, so asserting it
   * would have been asserting a spelling rather than the property.
   *
   * What is checked instead is the property itself: the canonical aggregates
   * read the minute store, and nothing in the table can be coarser than a minute.
   */
  it('cannot sum a rollup row on top of the minutes it rolls up', () => {
    const aggregates = kpi.split('async ').filter(
      (b) => b.startsWith('machineFactTotals') || b.startsWith('dailyFactTotals'),
    );
    expect(aggregates).toHaveLength(2);

    for (const a of aggregates) {
      // Either the old guard, or a source that has no granularity to guard.
      const guarded = a.includes("granularity = 'MINUTE'");
      const minuteStore = a.includes('oee_minutes') || a.includes('MINUTE_FACTS');
      expect(guarded || minuteStore).toBe(true);
    }
  });

  /**
   * And the projection those aggregates read must itself be one row per minute.
   * If it ever grew a coarser row, every caller would double-count silently.
   */
  it('reads a projection of the minute store, one row per minute', () => {
    expect(kpi).toContain('MINUTE_FACTS');
    // Just the fragment, not the rest of the file: the doc comment above it
    // names the retired table, and matching that would be matching prose.
    const after = kpi.split('MINUTE_FACTS = Prisma.sql')[1] ?? '';
    const compat = after.slice(0, after.indexOf('`;'));
    expect(compat).toContain('FROM oee_minutes');
    // It must not read anything that could carry a rolled-up row.
    expect(compat).not.toContain('production_snapshots');
    expect(compat).toContain("'MINUTE' AS granularity");
  });

  it('does not let Machine Status derive availability from state records', () => {
    // The old line was `this.pct(buckets.runMin, buckets.runMin + buckets.unplannedMin)`
    // over minutes bucketed from machine_state_records. State records draw the
    // timeline; they are not a second opinion on the KPI.
    expect(status).not.toMatch(/pct\(\s*buckets\.runMin/);
  });

  /**
   * The records list is a projection, not a fourth derivation.
   *
   * It used to build each row from `job_orders` plus `downtime_events` while the
   * cards above the same table read the minute store. Euro-Pack Robot read 35.3%
   * in the cards and 22.0% / 41.1% in the two rows underneath them — one screen,
   * two sources, ten points apart. Availability from logged stop events and
   * availability from elapsed minutes are different questions, and on a line
   * with unlogged stops they answer differently.
   */
  it('builds the OEE records list from the engines, not from stop events', () => {
    const start = kpi.indexOf('async oeeRecordsFromJobOrders');
    expect(start).toBeGreaterThan(-1);
    const body = kpi.slice(start, kpi.indexOf('  async ', start + 30));

    // It asks the engines the question.
    expect(body).toContain('oeeStandard.byJobOrder');
    expect(body).toContain('oeeSchedule.byJobOrder');

    // And does not answer it itself.
    expect(body).not.toContain('downtimeEvent');
    expect(body).not.toContain('$queryRaw');
    expect(body).not.toContain('joRollupChild');
    expect(body).not.toContain('timeBasedOee');
  });

  it('reports no availability rather than 0% when nothing was planned', () => {
    // 0% accuses a machine of failing when it was never asked to run, and it was
    // the shape that made an idle machine look identical to a broken one.
    expect(status).toMatch(/plannedMin > 0 \? this\.pct\(/);
  });
});
