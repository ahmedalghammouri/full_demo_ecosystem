import { PlannedStopService } from './planned-stop.service';

/**
 * Turning a planned-stop definition into real downtime events.
 *
 * ── What this is guarding ───────────────────────────────────────────────────
 * Materialising is where a definition stops being configuration and becomes
 * minutes removed from a machine's availability. Two things therefore have to
 * be exactly right, and both were wrong:
 *
 *   WHEN. The generator read the shift's start time and fell back to "00:00"
 *   when a stop had no shift. So every stop on its own schedule was written at
 *   MIDNIGHT, on every machine it targeted, at an hour nobody chose — and it
 *   looked completely successful, because events were created.
 *
 *   WHETHER. A definition that cannot be placed on the clock must produce
 *   NOTHING and say so. Silently creating something plausible is worse than
 *   creating nothing, because nobody goes looking for a stop that appears to
 *   have worked.
 *
 * The dates below are read back as plant wall-clock, which is what the plant
 * reads off the screen and what the OEE window is anchored on.
 */
describe('materialising planned stops', () => {
  const FACTORY = 'f1';
  const MACHINE = 'm1';

  /** A recurrence covering every weekday, indefinitely. */
  const EVERY_DAY = {
    id: 'rule-1', factoryId: FACTORY, name: 'Breaks',
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startDate: null, endDate: null, isPerpetual: true, oneOffDate: null, isActive: true,
  };

  function build(template: Record<string, unknown>) {
    const created: any[] = [];
    const prisma: any = {
      plannedStopTemplate: {
        findMany: jest.fn(async () => [{
          id: 't1', factoryId: FACTORY, code: 'BRK', name: 'Break',
          durationMinutes: 30, scope: 'MACHINE', category: 'PLANNED_BREAK', causeId: null,
          shiftTemplateId: null, startOffsetMin: 0, startTimeLocal: null,
          scheduleRuleId: EVERY_DAY.id, shiftTemplate: null, scheduleRule: EVERY_DAY,
          targets: [{ machineId: MACHINE, lineId: null }],
          ...template,
        }]),
      },
      machine: { findMany: jest.fn(async () => [{ id: MACHINE }]) },
      downtimeEvent: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async (a: any) => { created.push(a.data); return a.data; }),
      },
    };
    return { svc: new PlannedStopService(prisma), created, prisma };
  }

  /** Plant wall-clock HH:MM, which is what the screen shows. */
  const hhmm = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  it('writes the event at the clock time the stop was given', async () => {
    const { svc, created } = build({ startTimeLocal: '10:30' });

    const res = await svc.materialise(FACTORY, { dateFrom: '2026-08-24', dateTo: '2026-08-24' });

    expect(res.created).toBe(1);
    expect(hhmm(created[0].startTime)).toBe('10:30');
    expect(hhmm(created[0].endTime)).toBe('11:00');       // + the 30 minutes it lasts
    expect(created[0].durationMinutes).toBe(30);
    expect(created[0].machineId).toBe(MACHINE);
  });

  it('creates NOTHING for a stop with no clock time, and names it', async () => {
    // The defect, stated directly. This used to write a 00:00 event on every
    // targeted machine and report success.
    const { svc, created } = build({ startTimeLocal: null });

    const res = await svc.materialise(FACTORY, { dateFrom: '2026-08-24', dateTo: '2026-08-24' });

    expect(created).toHaveLength(0);
    expect(res.created).toBe(0);
    // Named, not silently dropped — a stop producing nothing is exactly what
    // the user needs to be told about.
    expect(res.notScheduled).toContain('BRK');
  });

  it('marks the event as planned and off the OEE charge', async () => {
    // The whole point of a planned stop: the minutes leave availability's
    // denominator instead of counting against the machine.
    const { svc, created } = build({ startTimeLocal: '06:00' });
    await svc.materialise(FACTORY, { dateFrom: '2026-08-24' });

    expect(created[0].isPlanned).toBe(true);
    expect(created[0].affectsOEE).toBe(false);
    expect(created[0].category).toBe('PLANNED_BREAK');
  });

  it('repeats it on every day of the range, at the same clock time', async () => {
    const { svc, created } = build({ startTimeLocal: '14:15' });

    const res = await svc.materialise(FACTORY, { dateFrom: '2026-08-24', dateTo: '2026-08-26' });

    expect(res.created).toBe(3);
    expect(created.map((c) => hhmm(c.startTime))).toEqual(['14:15', '14:15', '14:15']);
    expect(created.map((c) => c.startTime.getDate())).toEqual([24, 25, 26]);
  });

  it('is idempotent — running the same range twice does not double the stop', async () => {
    // Every duplicate would be a second subtraction from availability for one
    // break that happened once.
    const { svc, prisma } = build({ startTimeLocal: '10:30' });
    await svc.materialise(FACTORY, { dateFrom: '2026-08-24' });

    prisma.downtimeEvent.findFirst = jest.fn(async () => ({ id: 'existing' }));
    const again = await svc.materialise(FACTORY, { dateFrom: '2026-08-24' });

    expect(again.created).toBe(0);
    expect(again.skipped).toBe(1);
  });

  it('places a shift-bound stop from the shift start, not from its own clock', async () => {
    // The other kind. Its offset counts from the shift, and adding a standalone
    // clock time on top would move it twice.
    const { svc, created } = build({
      shiftTemplateId: 's1',
      shiftTemplate: { startTime: '06:00', scheduleRule: EVERY_DAY },
      scheduleRuleId: null, scheduleRule: null,
      startOffsetMin: 240,
      startTimeLocal: '23:00',
    });

    await svc.materialise(FACTORY, { dateFrom: '2026-08-24' });

    expect(hhmm(created[0].startTime)).toBe('10:00');     // 06:00 + 4h
  });

  it('uses the shift’s legacy `days` when it has no ScheduleRule yet', async () => {
    // The defect that made a correctly configured break appear nowhere.
    //
    // Recurrence moved from ShiftTemplate.days into ScheduleRule, and the
    // schema says days is "retained only so existing rows keep working until
    // they are migrated". The generator read scheduleRule and nothing else, so
    // an unmigrated shift looked like a shift with NO recurrence — and every
    // stop on it produced zero events while reporting success.
    //
    // Both of this plant's shifts carried days = [6,0,1,2,3,4] and a null
    // scheduleRuleId, so nothing a user could do on the Planned Stops page
    // would ever have produced an event.
    const { svc, created } = build({
      shiftTemplateId: 's1',
      shiftTemplate: {
        startTime: '07:30',
        scheduleRule: null,                       // never migrated
        days: [6, 0, 1, 2, 3, 4],                 // the real working week
      },
      scheduleRuleId: null, scheduleRule: null,
      startOffsetMin: 330,
    });

    const res = await svc.materialise(FACTORY, { dateFrom: '2026-08-24' });

    expect(res.notScheduled).toEqual([]);
    expect(res.created).toBe(1);
    expect(hhmm(created[0].startTime)).toBe('13:00');   // 07:30 + 5h30
  });

  it('still reports a shift with no recurrence anywhere', async () => {
    // Falling back to `days` must not become "assume every day". A shift that
    // genuinely has no working days set produces nothing, and is named.
    const { svc, created } = build({
      shiftTemplateId: 's1',
      shiftTemplate: { startTime: '07:30', scheduleRule: null, days: [] },
      scheduleRuleId: null, scheduleRule: null,
      startOffsetMin: 60,
    });

    const res = await svc.materialise(FACTORY, { dateFrom: '2026-08-24' });

    expect(created).toHaveLength(0);
    expect(res.notScheduled).toContain('BRK');
  });
});
