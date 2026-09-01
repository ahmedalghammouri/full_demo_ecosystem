import { bucketLabels } from './datetime';

/**
 * A time axis whose every label is the same is not a time axis.
 *
 * ── What the plant saw ──────────────────────────────────────────────────────
 * "Availability over time" showed six ticks, all reading `00:00`, and the same
 * on the performance, quality and loss pages. Four pages, one cause.
 *
 * Each of those panels carried its own copy of
 *
 *     const hhmm = (iso) => `${d.getHours()}:${d.getMinutes()}`
 *
 * and `trend()` on the api buckets by HOUR OR DAY depending on how wide the
 * window is. On any multi-day window every bucket starts at midnight, so every
 * label was midnight. The chart was drawing the right shape over an axis that
 * said nothing.
 *
 * ── The second fault in the same four lines ─────────────────────────────────
 * `getHours()` is the BROWSER's clock. These timestamps are UTC and the plant
 * is Asia/Riyadh, so the labels were three hours out for anyone not sitting in
 * +03 -- and a wrong hour still looks like an hour, so nothing gave it away.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * The format follows the SPACING of the buckets, taken from the data itself
 * rather than from a granularity flag a caller has to remember to pass. Data
 * that knows how coarse it is cannot disagree with its own labels.
 */

const RIYADH = 'Asia/Riyadh';

describe('the format follows the bucket size', () => {
  it('labels daily buckets by DATE, not by their midnight', () => {
    // The exact defect. Five consecutive days, as `trend()` returns them.
    const days = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']
      .map((d) => `${d}T00:00:00.000Z`);
    const out = bucketLabels(days, RIYADH);

    expect(new Set(out).size).toBe(5);          // five ticks, five labels
    expect(out.every((l) => l === '00:00')).toBe(false);
    expect(out[0]).toMatch(/^\d{2} [A-Z][a-z]{2}$/);
  });

  it('labels hourly buckets by TIME, which is what they need', () => {
    const hours = [0, 1, 2, 3].map((h) => `2026-08-28T0${h}:00:00.000Z`);
    const out = bucketLabels(hours, RIYADH);

    expect(new Set(out).size).toBe(4);
    expect(out.every((l) => /^\d{2}:\d{2}$/.test(l))).toBe(true);
  });

  it('labels monthly buckets by month', () => {
    const months = ['2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01']
      .map((d) => `${d}T00:00:00.000Z`);
    const out = bucketLabels(months, RIYADH);

    expect(new Set(out).size).toBe(4);
    expect(out[3]).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
  });
});

describe('the labels are in FACTORY time', () => {
  it('renders a UTC instant at the plant clock, not the browser clock', () => {
    // 21:00 UTC is 00:00 the NEXT day in Riyadh (+03). The old code called
    // getHours() and would have said whatever the viewer's machine said.
    expect(bucketLabels(['2026-08-27T21:00:00.000Z'], RIYADH)).toEqual(['00:00']);
    expect(bucketLabels(['2026-08-28T11:30:00.000Z'], RIYADH)).toEqual(['14:30']);
  });

  it('puts a daily bucket on the right plant day', () => {
    // A bucket stamped 21:00 UTC belongs to the 28th in Riyadh, not the 27th.
    const two = ['2026-08-27T21:00:00.000Z', '2026-08-28T21:00:00.000Z'];
    expect(bucketLabels(two, RIYADH)).toEqual(['28 Aug', '29 Aug']);
  });
});

describe('it does not fall apart on awkward data', () => {
  it('survives a single bucket', () => {
    // No gap to measure. The finest format is the safe default: it can never
    // merge two distinct instants into one label.
    expect(bucketLabels(['2026-08-28T11:30:00.000Z'], RIYADH)).toEqual(['14:30']);
  });

  it('survives an empty series', () => {
    expect(bucketLabels([], RIYADH)).toEqual([]);
  });

  it('keeps a slot for a null bucket instead of shifting the axis', () => {
    // The points must stay aligned with their labels. Dropping one here would
    // slide every later label one tick to the left -- the chart would look
    // fine and be wrong, which is worse than a visible gap.
    const out = bucketLabels(['2026-08-28T00:00:00.000Z', null, '2026-08-28T02:00:00.000Z'], RIYADH);
    expect(out).toHaveLength(3);
    expect(out[1]).toBe('—');
  });

  it('is not thrown off by ONE missing bucket in an hourly series', () => {
    // The median is why. Hours 0,1,2, then a gap to 9, then 10, 11. A mean gap
    // would clear the 23h threshold on a longer series and relabel the whole
    // axis as dates; the median stays at one hour.
    const hours = [0, 1, 2, 9, 10, 11].map((h) => `2026-08-28T${String(h).padStart(2, '0')}:00:00.000Z`);
    const out = bucketLabels(hours, RIYADH);
    expect(out.every((l) => /^\d{2}:\d{2}$/.test(l))).toBe(true);
  });

  it('is order-independent', () => {
    // Spacing is a property of the set, not of the order it arrived in.
    const asc = ['2026-08-24', '2026-08-25', '2026-08-26'].map((d) => `${d}T00:00:00.000Z`);
    const desc = [...asc].reverse();
    expect(bucketLabels(desc, RIYADH)).toEqual([...bucketLabels(asc, RIYADH)].reverse());
  });
});
