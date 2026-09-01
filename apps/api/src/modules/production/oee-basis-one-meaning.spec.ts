import * as fs from 'fs';
import * as path from 'path';

/**
 * The OEE / OEE-TB toggle means the same thing on every screen.
 *
 * ── The bug ─────────────────────────────────────────────────────────────────
 * `kpi.service` derived its own pair of availability bases and published them as
 * the two sides of the toggle:
 *
 *     availability   = runMin / plannedMin      plannedMin = total - planned
 *                                                          - external - unmeasured
 *     availabilityTb = runMin / (runMin + downMin)
 *
 * The six minute buckets are defined to sum to totalMin, so
 *
 *     total - planned - external - unmeasured  ===  operating + availabilityLoss
 *
 * identically — measured on this plant to six decimals on every machine, the
 * difference was 0.000000. The two denominators were one quantity, and the
 * toggle switched between a number and that number rounded twice. The Command
 * Center showed 34.6% and 34.5% for its two "bases" while the OEE Analysis page,
 * which calls the engines, showed 34.6% and 1.6%.
 *
 * `plannedMin` was never the planned time: it is elapsed time less the stops
 * nobody is charged for, which IS the standard basis. The committed slot exists
 * only in the schedule engine, and this path had never reached it.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * Anything that publishes the pair projects it from the two engines. A service
 * that derives an availability of its own is a third definition, and a third
 * definition is how the toggle came to be decorative.
 */

const KPI = path.resolve(__dirname, 'kpi.service.ts');
const src = fs.readFileSync(KPI, 'utf8');

/** Code only — this file explains the bug, and the prose names what it forbids. */
const code = src
  .split(/\r?\n/)
  .filter((l) => {
    const t = l.trim();
    return !(t.startsWith('*') || t.startsWith('//') || t.startsWith('/*'));
  })
  .join(String.fromCharCode(10));

/** The body of one method, up to the next one. */
function body(name: string): string {
  const at = code.indexOf(`async ${name}(`);
  expect(at).toBeGreaterThan(-1);
  const next = code.indexOf('  async ', at + 30);
  const priv = code.indexOf('  private ', at + 30);
  const ends = [next, priv].filter((i) => i > -1);
  return code.slice(at, ends.length ? Math.min(...ends) : code.length);
}

describe('OEE and OEE-TB are the two engines, everywhere', () => {
  it.each(['snapshotAggregate', 'snapshotScope', 'snapshotMachineTrend'])(
    '%s projects both bases from the engines', (name) => {
      const b = body(name);
      expect(b).toContain('this.oeeStandard.');
      expect(b).toContain('this.oeeSchedule.');
      // And derives neither itself.
      expect(b).not.toContain('snapMetrics');
      expect(b).not.toContain('calculateDetailed');
    });

  /**
   * The denominator that was never the planned time.
   */
  it('nobody rebuilds the collapsed pair', () => {
    const offenders: string[] = [];
    for (const [i, line] of code.split(/\r?\n/).entries()) {
      // `run / (run + down)` in any spelling — the "time-based" denominator that
      // is algebraically the standard one.
      if (/\b(run|runMin|operatingMin)\s*\/\s*\(\s*(run|runMin|operatingMin)\s*\+/.test(line)) {
        offenders.push(`kpi.service.ts:${i + 1}  ${line.trim().slice(0, 80)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the schedule side is clipped to the period, not to now', () => {
    // `to` is clamped to now by callers so planned time does not accrue for
    // hours that have not happened. The schedule basis needs the opposite: the
    // unreached remainder of the slot is what makes the reading climb to true.
    // Passing `to` gave 34.0%/98.4% where the analysis page gave 2.1%/6.0%.
    expect(code).toContain('function endOfPlantDay');
    for (const name of ['snapshotAggregate', 'snapshotScope', 'snapshotMachineTrend']) {
      expect(body(name)).toContain('endOfPlantDay');
    }
  });

  it('there is one read path, not a branch that changes the arithmetic', () => {
    // A WO/PO drill-down used to fall through to a live job-order scan with its
    // own A/P/Q, so applying a filter silently changed which arithmetic answered.
    const b = body('oeeAnalytics');
    expect(b).toContain('this.snapshotAggregate');
    expect(b).not.toContain('snapshotsEnabled');
    expect(b).not.toContain('jobOrder.findMany');
  });

  it('would catch the collapsed denominator coming back', () => {
    const re = /\b(run|runMin|operatingMin)\s*\/\s*\(\s*(run|runMin|operatingMin)\s*\+/;
    expect(re.test('const availabilityTb = run / (run + down) * 100;')).toBe(true);
    expect(re.test('const a = operatingMin / (operatingMin + availabilityLossMin);')).toBe(true);
    expect(re.test('const a = runMin / plannedMin;')).toBe(false);
  });
});
