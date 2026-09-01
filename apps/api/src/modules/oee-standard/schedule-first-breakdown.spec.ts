import { StateTimelineService, type TimelineSegment } from './state-timeline.service';

/**
 * "Where the time went", re-read with booked schedule time taking precedence.
 *
 * ── The reading this pins ───────────────────────────────────────────────────
 * A sensor sees one thing: the machine is not turning. On 25 August M1 was
 * stopped from 07:30 to 08:51 and arrived as eighty-one minutes of BREAKDOWN —
 * while the schedule for those same minutes read cleaning until 08:00 and
 * startup until 08:30. Ranked against the other losses that stop was four times
 * its real size, and it pointed a shift review at a fault that lasted
 * twenty-one minutes.
 *
 * `scheduleFirst` is a pure projection over the two arrays a controller already
 * holds, so these drive the shipped function with no stubbing at all.
 *
 * It is DISPLAY ONLY by design, and the last test in this file is what says so:
 * the same inputs must leave `details()` — which feeds the counts and MTTR —
 * exactly where it was.
 */

const seg = (
  state: string, kind: TimelineSegment['kind'],
  fromH: number, fromM: number, toH: number, toM: number,
  machineId = 'm1', label?: string,
): TimelineSegment => {
  const from = new Date(Date.UTC(2026, 7, 25, fromH, fromM));
  const to = new Date(Date.UTC(2026, 7, 25, toH, toM));
  return {
    machineId, machineCode: machineId.toUpperCase(), state, kind, label,
    from, to, minutes: (+to - +from) / 60_000,
  };
};

const svc = () => new StateTimelineService({} as any);
const row = (out: ReturnType<StateTimelineService['scheduleFirst']>, label: string) =>
  out.find((r) => r.label === label);

describe('the schedule-first breakdown', () => {
  it('leaves only the minutes the schedule did not book — the 25 August M1 stop', () => {
    // Exactly what was on screen: 81 minutes of BREAKDOWN across a booked
    // cleaning window and a booked startup.
    const out = svc().scheduleFirst(
      [seg('BREAKDOWN', 'downtime', 7, 30, 8, 51)],
      [
        seg('PLANNED_STOP', 'planned', 7, 30, 8, 0, 'm1', 'Cleaning — start of shift'),
        seg('PLANNED_STOP', 'downtime', 8, 0, 8, 30, 'm1', 'Startup'),
      ],
    );

    expect(row(out, 'BREAKDOWN')).toMatchObject({ rawMin: 81, minutes: 21, reclaimedMin: 60 });
    expect(row(out, 'Cleaning — start of shift')?.minutes).toBe(30);
    expect(row(out, 'Startup')?.minutes).toBe(30);
    // And the window is still eighty-one minutes long. A projection that
    // invents or loses time is worse than the reading it replaced.
    expect(out.reduce((a, r) => a + r.minutes, 0)).toBe(81);
  });

  it('names each booked block instead of calling them all PLANNED_STOP', () => {
    // Cleaning, a meal and a handover are one state and three different
    // activities. Ranked as one row they answer nothing.
    const out = svc().scheduleFirst(
      [seg('STOPPED', 'downtime', 7, 0, 12, 0)],
      [
        seg('PLANNED_STOP', 'planned', 7, 30, 8, 0, 'm1', 'Cleaning — start of shift'),
        seg('PLANNED_STOP', 'downtime', 8, 0, 8, 30, 'm1', 'Startup'),
        seg('PLANNED_STOP', 'planned', 9, 0, 10, 0, 'm1', 'Lunch Break'),
      ],
    );
    expect(out.filter((r) => r.scheduled).map((r) => r.label).sort())
      .toEqual(['Cleaning — start of shift', 'Lunch Break', 'Startup']);
  });

  it('leaves the sensor alone through scheduled PRODUCTION', () => {
    // The gaps between booked stops are not booked stops. Through them the
    // machine's own account stands, which is why RUNNING and BREAKDOWN still
    // appear at all.
    const out = svc().scheduleFirst(
      [seg('BREAKDOWN', 'downtime', 9, 0, 10, 0)],
      [seg('PRODUCTION', 'running', 8, 0, 12, 0, 'm1', 'Production')],
    );
    expect(row(out, 'BREAKDOWN')).toMatchObject({ minutes: 60, reclaimedMin: 0 });
    expect(out.filter((r) => r.scheduled)).toEqual([]);
  });

  it('takes RUNNING time too when the machine ran through a booked stop', () => {
    // Not a special case, the same rule: those minutes were not production for
    // any other purpose in the system either.
    const out = svc().scheduleFirst(
      [seg('RUNNING', 'running', 7, 0, 9, 0)],
      [seg('PLANNED_STOP', 'planned', 8, 0, 8, 30, 'm1', 'Lunch Break')],
    );
    expect(row(out, 'RUNNING')).toMatchObject({ rawMin: 120, minutes: 90, reclaimedMin: 30 });
  });

  it('counts one booked minute once, whichever stop was entered twice', () => {
    // The plant books line-wide windows, and a machine can carry two rows over
    // the same minutes. First booked wins; the minute is not spent twice.
    const out = svc().scheduleFirst(
      [seg('BREAKDOWN', 'downtime', 7, 0, 9, 0)],
      [
        seg('PLANNED_STOP', 'planned', 8, 0, 8, 30, 'm1', 'Cleaning — start of shift'),
        seg('PLANNED_STOP', 'planned', 8, 15, 8, 45, 'm1', 'Lunch Break'),
      ],
    );
    expect(row(out, 'Cleaning — start of shift')?.minutes).toBe(30);
    expect(row(out, 'Lunch Break')?.minutes).toBe(15); // only what was left
    expect(out.reduce((a, r) => a + r.minutes, 0)).toBe(120);
  });

  it('keeps a machine’s schedule to that machine', () => {
    // M1's cleaning window says nothing about M2, even at the same clock times.
    const out = svc().scheduleFirst(
      [
        seg('BREAKDOWN', 'downtime', 8, 0, 9, 0, 'm1'),
        seg('BREAKDOWN', 'downtime', 8, 0, 9, 0, 'm2'),
      ],
      [seg('PLANNED_STOP', 'planned', 8, 0, 8, 30, 'm1', 'Cleaning — start of shift')],
    );
    // 60 + 60 reported, 30 of M1's booked away.
    expect(row(out, 'BREAKDOWN')).toMatchObject({ rawMin: 120, minutes: 90, reclaimedMin: 30 });
  });

  it('keeps a state wholly absorbed by a booked stop, at zero', () => {
    // "STARVED — all 30 minutes of it was booked cleaning" is a finding. A row
    // that silently disappears is not.
    const out = svc().scheduleFirst(
      [seg('STARVED', 'external', 8, 0, 8, 30)],
      [seg('PLANNED_STOP', 'planned', 8, 0, 8, 30, 'm1', 'Cleaning — start of shift')],
    );
    expect(row(out, 'STARVED')).toMatchObject({ minutes: 0, reclaimedMin: 30 });
  });

  it('falls back to the plain breakdown when nothing was booked', () => {
    const out = svc().scheduleFirst([seg('RUNNING', 'running', 7, 0, 9, 0)], []);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ label: 'RUNNING', minutes: 120, reclaimedMin: 0 });
  });

  it('ranks by what each row kept, so the real losses sort to the top', () => {
    const out = svc().scheduleFirst(
      [
        seg('BREAKDOWN', 'downtime', 7, 30, 8, 51),
        seg('STARVED', 'external', 8, 51, 10, 0),
      ],
      [
        seg('PLANNED_STOP', 'planned', 7, 30, 8, 0, 'm1', 'Cleaning — start of shift'),
        seg('PLANNED_STOP', 'downtime', 8, 0, 8, 30, 'm1', 'Startup'),
      ],
    );
    // STARVED 69 min is the biggest real loss; BREAKDOWN's 81 was mostly booked.
    expect(out.map((r) => r.label)).toEqual([
      'STARVED', 'Cleaning — start of shift', 'Startup', 'BREAKDOWN',
    ]);
  });

  it('changes nothing that feeds a number — details() is untouched', () => {
    // The guarantee the whole separation rests on. `details()` is what produces
    // the stop counts, MTTR and MTBF; if the projection could reach it, "display
    // only" would be a comment rather than a fact.
    const segments = [
      seg('BREAKDOWN', 'downtime', 7, 30, 8, 51),
      seg('RUNNING', 'running', 8, 51, 10, 0),
    ];
    const s = svc();
    const before = s.details(segments);
    s.scheduleFirst(segments, [
      seg('PLANNED_STOP', 'planned', 7, 30, 8, 0, 'm1', 'Cleaning — start of shift'),
      seg('PLANNED_STOP', 'downtime', 8, 0, 8, 30, 'm1', 'Startup'),
    ]);
    expect(s.details(segments)).toEqual(before);
    expect(before.downtimeMin).toBe(81); // still the sensor's own account
  });
});
