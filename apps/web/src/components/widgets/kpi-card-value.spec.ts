import { formatNumber } from '@/lib/utils';

/**
 * What a KPI card is allowed to print.
 *
 * ── The defect ──────────────────────────────────────────────────────────────
 * The Downtime Command Center showed four empty cards -- TOTAL DOWNTIME,
 * UNPLANNED, PLANNED STOPS, OEE IMPACT, all an em-dash -- directly above a
 * chart showing thousands of minutes. The plant read it as broken, and it was.
 *
 * Those four pass their own `fmtMin(m)`, which returns "265h 0m". The card ran
 * that through `formatNumber`, which does `Number("265h 0m")` -> NaN and
 * returns an em-dash. The three cards beside them that DID work -- Availability
 * Loss, MTTR, MTBF -- pass raw numbers.
 *
 * An em-dash means "nothing was recorded". The plant had 15,900 minutes of
 * downtime and 2,031 events. Saying "nothing" about that is not a cosmetic
 * fault, and it is the reason a customer stops trusting a dashboard.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * A caller that passes a STRING has already formatted it; print it verbatim.
 * A number still goes through `formatNumber`. Null and undefined are the only
 * things that mean "no data", and they alone may render as a dash.
 */

/** The card's own decision, extracted so it can be exercised without a DOM. */
function cardValue(value: number | string | null | undefined, unit?: string): string {
  const preformatted = typeof value === 'string' && Number.isNaN(Number(value));
  return preformatted ? value : formatNumber(value, unit === '%' ? 1 : 0);
}

describe('a card prints what it was given', () => {
  it('prints a preformatted duration instead of an em-dash', () => {
    // The exact strings the Downtime Command Center produces.
    expect(cardValue('265h 0m')).toBe('265h 0m');
    expect(cardValue('46h 28m')).toBe('46h 28m');
    expect(cardValue('12m')).toBe('12m');
  });

  it('still formats a plain number', () => {
    expect(cardValue(15900)).toBe('15.9K');
    expect(cardValue(2.34, '%')).toBe('2.3');
  });

  it('accepts a NUMERIC string as a number, not as text', () => {
    // An API that returns "42" in JSON must not defeat the formatting.
    expect(cardValue('42000')).toBe('42.0K');
  });

  it('keeps the em-dash for the only thing that means no data', () => {
    expect(cardValue(null)).toBe('—');
    expect(cardValue(undefined)).toBe('—');
  });

  it('does not turn a small non-zero value into 0', () => {
    // The other half of the same principle: 0.03 kW printed as "0" reads as
    // "nothing is running", which is the opposite of the truth.
    expect(cardValue(0.03)).not.toBe('0');
    expect(Number(cardValue(0.03))).toBeCloseTo(0.03, 2);
  });

  it('prints a real zero as zero', () => {
    // A measured zero is a fact and must not borrow precision it does not have.
    expect(cardValue(0)).toBe('0');
  });
});
