import { stopWindowsForShift, type StopDefinition } from './planned-stop-window.util';

/**
 * Where a planned stop lands on the clock, and what happens when it cannot.
 *
 * ── The two defects this pins ───────────────────────────────────────────────
 * A planned stop is the only thing that legitimately removes time from the
 * availability denominator, so being wrong about WHEN one happens is not a
 * cosmetic problem — it is minutes taken off a machine's availability at a time
 * nobody chose, or left on it when somebody did choose.
 *
 * A stop on its OWN schedule — a weekly cleaning, a break that does not belong
 * to one shift — used to fail in two opposite directions at once:
 *
 *   The generator placed it at MIDNIGHT. It read the shift's start time and
 *   fell back to "00:00" when there was no shift, so a stop with no shift got a
 *   downtime event at midnight on every machine it targeted.
 *
 *   OEE never saw it at all. Placement required the definition's shift to match
 *   the shift being measured, and a standalone stop has no shift, so it never
 *   matched and never left the denominator.
 *
 * One definition, two answers, and they disagreed with each other. A stop now
 * carries its own clock time, and one without a placement is skipped and
 * reported rather than guessed onto the calendar.
 */
describe('planned stop placement', () => {
  const SHIFT_A = 'shift-a';
  const machine = { machineId: 'm1', lineId: 'l1' };

  /** Shift 1 on 24 Aug 2026, 06:00 → 14:00 plant time. */
  const shift = {
    templateId: SHIFT_A,
    code: 'S1',
    name: 'Shift 1',
    shiftStart: new Date('2026-08-24T06:00:00'),
    shiftDate: new Date('2026-08-24T00:00:00'),
  };

  const def = (over: Partial<StopDefinition>): StopDefinition => ({
    id: 's', code: 'BRK', name: 'Break', durationMinutes: 30, scope: 'FACTORY',
    shiftTemplateId: null, startOffsetMin: null, startTimeLocal: null,
    isActive: true, targets: [], ...over,
  });

  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  it('places a shift-bound stop at the offset from that shift start', async () => {
    const w = stopWindowsForShift(
      [def({ shiftTemplateId: SHIFT_A, startOffsetMin: 240 })], shift as any, machine,
    );
    expect(w).toHaveLength(1);
    expect(hhmm(w[0].start)).toBe('10:00');       // 06:00 + 4h
    expect(hhmm(w[0].end)).toBe('10:30');
  });

  it('places a stop on its own schedule at its own clock time', async () => {
    // The case OEE could not see at all. It has no shift, and it must still
    // leave the denominator.
    const w = stopWindowsForShift(
      [def({ scheduleRuleId: 'r1', startTimeLocal: '09:15' } as any)], shift as any, machine,
    );
    expect(w.length).toBeGreaterThanOrEqual(1);
    expect(w.map((x) => hhmm(x.start))).toContain('09:15');
  });

  it('does NOT place a standalone stop at midnight when it has no time', async () => {
    // The defect, stated directly. A stop with nowhere to go must produce
    // nothing — not an event at 00:00 that removes half an hour from the night
    // shift's availability without anyone asking.
    const w = stopWindowsForShift([def({ scheduleRuleId: 'r1' } as any)], shift as any, machine);
    expect(w).toHaveLength(0);
  });

  it('ignores a shift-bound stop that belongs to a DIFFERENT shift', async () => {
    const w = stopWindowsForShift(
      [def({ shiftTemplateId: 'shift-b', startOffsetMin: 60 })], shift as any, machine,
    );
    expect(w).toHaveLength(0);
  });

  it('offers the next day too, so an overnight shift still finds its break', async () => {
    // A shift that starts at 22:00 contains 01:00 of the FOLLOWING day. Placing
    // a standalone stop only on the shift's own date would lose every break in
    // the second half of every night shift.
    const night = {
      ...shift,
      shiftStart: new Date('2026-08-24T22:00:00'),
      shiftDate: new Date('2026-08-24T00:00:00'),
    };
    const w = stopWindowsForShift(
      [def({ scheduleRuleId: 'r1', startTimeLocal: '01:00' } as any)], night as any, machine,
    );
    const days = w.map((x) => x.start.getDate());
    expect(days).toContain(25);
  });

  it('refuses a stop with no duration rather than emitting an empty window', async () => {
    const w = stopWindowsForShift(
      [def({ shiftTemplateId: SHIFT_A, startOffsetMin: 60, durationMinutes: 0 })],
      shift as any, machine,
    );
    expect(w).toHaveLength(0);
  });

  it('does not apply a stop to a machine outside its scope', async () => {
    // Recording a cleaning stop against equipment nobody touched invents
    // downtime, and it comes straight off that machine's availability.
    const w = stopWindowsForShift(
      [def({
        scope: 'MACHINE', shiftTemplateId: SHIFT_A, startOffsetMin: 60,
        targets: [{ machineId: 'other', lineId: null }],
      })],
      shift as any, machine,
    );
    expect(w).toHaveLength(0);
  });
});
