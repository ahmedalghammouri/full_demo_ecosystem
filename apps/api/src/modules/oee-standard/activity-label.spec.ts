import { activityLabel } from './activity-label';
import { stopMarker } from '../production/planned-stop-plan';

/**
 * A band on the timeline must be readable by a person standing at a screen.
 *
 * These pin both directions: the marker never shows, and the name never gets
 * eaten. The second is the one worth guarding — a filter that strips too much
 * is invisible, because a band with no label still draws.
 */
describe('what a timeline band is called', () => {
  it('drops the idempotency marker a booked stop carries', () => {
    // The real shape, built from the real writer rather than a copy of it —
    // if the marker format changes, this test comes with it.
    const marker = stopMarker('plan-7', '2026-08-25T05:00:00.000Z');
    expect(activityLabel(`Line Cleaning ${marker}`)).toBe('Line Cleaning');
  });

  it('drops the repair marker, leaving the band its state name', () => {
    // What the plant actually saw: a UUID painted across a night shift.
    expect(activityLabel('[idle-repair tail of 940d8674-c671-49af-a23f-95351506c786]'))
      .toBeUndefined();
    expect(activityLabel('[idle-repair: was STARVED, no order was executing]'))
      .toBeUndefined();
  });

  it('keeps a human note that a marker was appended to', () => {
    expect(activityLabel('Changeover to SKU-22 [idle-repair: was STARVED, no order was executing]'))
      .toBe('Changeover to SKU-22');
  });

  it('still drops the trailing provenance clause', () => {
    expect(activityLabel('Line Cleaning — start of shift (from plan 7)'))
      .toBe('Line Cleaning — start of shift');
  });

  it('leaves an ordinary name completely alone', () => {
    // The failure nobody would notice: over-stripping is silent.
    for (const name of [
      'Line Cleaning — start of shift',
      'Startup',
      'Changeover 20:00 → 20:45',
      'Lunch break',
    ]) {
      expect(activityLabel(name)).toBe(name);
    }
  });

  it('gives no label rather than an empty one', () => {
    // An empty string would draw an empty band and read as a bug.
    for (const empty of [null, undefined, '', '   ', '[only a marker]', '(only provenance)']) {
      expect(activityLabel(empty)).toBeUndefined();
    }
  });
});
