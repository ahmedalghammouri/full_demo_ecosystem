import { appliesOn, occurrencesBetween, weekdaysOf, describeRule } from './schedule-rule.util';

/**
 * The scheduling rule decides which days a plant is deemed to be working, and
 * therefore how much time OEE is measured against. An off-by-one here does not
 * crash anything — it quietly adds or removes a day of planned production time
 * and every KPI moves with it.
 */

const rule = (over: Partial<Parameters<typeof appliesOn>[0]> = {}) => ({
  daysOfWeek: [0, 1, 2, 3, 4] as unknown, // Sun–Thu, the KSA working week
  startDate: null,
  endDate: null,
  isPerpetual: false,
  oneOffDate: null,
  isActive: true,
  ...over,
});

/** Local calendar day, which is what a schedule is a statement about. */
const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

describe('schedule rules', () => {
  describe('weekdays', () => {
    it('runs on a selected weekday', () => {
      // 2026-08-16 is a Sunday.
      expect(appliesOn(rule(), day('2026-08-16'))).toBe(true);
    });

    it('does not run on a weekday that was left out', () => {
      // Friday is absent from the array — that IS how a holiday is expressed.
      expect(appliesOn(rule(), day('2026-08-14'))).toBe(false);
    });

    it('never runs when no weekday is selected', () => {
      // A half-filled form must not become seven days of production.
      expect(appliesOn(rule({ daysOfWeek: [] }), day('2026-08-16'))).toBe(false);
    });

    it('ignores junk in the weekday array', () => {
      expect(weekdaysOf({ daysOfWeek: [0, 9, -2, 'x', 3, 3] })).toEqual([0, 3]);
    });

    it('accepts a weekday array stored as a JSON string', () => {
      expect(weekdaysOf({ daysOfWeek: '[1,2]' })).toEqual([1, 2]);
    });
  });

  describe('date range', () => {
    it('does not run before the start date', () => {
      const r = rule({ startDate: new Date('2026-09-01T00:00:00Z') });
      expect(appliesOn(r, day('2026-08-31'))).toBe(false);
    });

    it('runs on the start date itself', () => {
      // 2026-08-16 is a Sunday; the bound is inclusive.
      const r = rule({ startDate: new Date('2026-08-16T00:00:00Z') });
      expect(appliesOn(r, day('2026-08-16'))).toBe(true);
    });

    it('runs on the end date itself', () => {
      const r = rule({ endDate: new Date('2026-08-16T00:00:00Z') });
      expect(appliesOn(r, day('2026-08-16'))).toBe(true);
    });

    it('does not run after the end date', () => {
      const r = rule({ endDate: new Date('2026-08-16T00:00:00Z') });
      expect(appliesOn(r, day('2026-08-17'))).toBe(false);
    });

    it('runs indefinitely when perpetual, ignoring a stale end date', () => {
      // An explicit "no end" is a decision; honouring a leftover endDate
      // underneath it would stop the plant silently.
      const r = rule({ isPerpetual: true, endDate: new Date('2020-01-01T00:00:00Z') });
      expect(appliesOn(r, day('2030-08-19'))).toBe(true);
    });
  });

  describe('one-off occurrence', () => {
    it('runs only on its date', () => {
      const r = rule({ oneOffDate: new Date('2026-08-14T00:00:00Z') });
      expect(appliesOn(r, day('2026-08-14'))).toBe(true);
      expect(appliesOn(r, day('2026-08-15'))).toBe(false);
    });

    it('runs even on a weekday the weekly pattern excludes', () => {
      // Friday overtime: the whole point is that it overrides the pattern.
      const r = rule({ oneOffDate: new Date('2026-08-14T00:00:00Z'), daysOfWeek: [0, 1, 2, 3, 4] });
      expect(day('2026-08-14').getDay()).toBe(5); // Friday
      expect(appliesOn(r, day('2026-08-14'))).toBe(true);
    });

    it('is not suppressed by an unrelated date range', () => {
      const r = rule({
        oneOffDate: new Date('2026-08-14T00:00:00Z'),
        startDate: new Date('2027-01-01T00:00:00Z'),
      });
      expect(appliesOn(r, day('2026-08-14'))).toBe(true);
    });
  });

  it('never runs when inactive', () => {
    expect(appliesOn(rule({ isActive: false }), day('2026-08-16'))).toBe(false);
  });

  describe('enumeration', () => {
    it('lists only the working days in the window', () => {
      const days = occurrencesBetween(rule(), day('2026-08-14'), day('2026-08-20'));
      // Fri 14 and Sat 15 are off; Sun 16 → Thu 20 are working.
      expect(days.map((d) => d.getDate())).toEqual([16, 17, 18, 19, 20]);
    });

    it('returns nothing when the range is inverted', () => {
      expect(occurrencesBetween(rule(), day('2026-08-20'), day('2026-08-14'))).toEqual([]);
    });

    it('stops at the range end for a perpetual rule', () => {
      const r = rule({ isPerpetual: true });
      const days = occurrencesBetween(r, day('2026-08-16'), day('2026-08-18'));
      expect(days).toHaveLength(3);
    });
  });

  describe('description', () => {
    it('describes a perpetual weekly rule', () => {
      expect(describeRule(rule({ isPerpetual: true }))).toBe('Sun, Mon, Tue, Wed, Thu, indefinitely');
    });

    it('describes a bounded rule', () => {
      const r = rule({
        startDate: new Date('2026-08-16T00:00:00Z'),
        endDate: new Date('2026-09-30T00:00:00Z'),
      });
      expect(describeRule(r)).toBe('Sun, Mon, Tue, Wed, Thu, 2026-08-16 → 2026-09-30');
    });

    it('describes a one-off', () => {
      expect(describeRule(rule({ oneOffDate: new Date('2026-08-14T00:00:00Z') })))
        .toBe('Once on 2026-08-14');
    });

    it('says plainly when a rule can never run', () => {
      expect(describeRule(rule({ daysOfWeek: [] }))).toBe('No days selected — never runs');
    });
  });
});
