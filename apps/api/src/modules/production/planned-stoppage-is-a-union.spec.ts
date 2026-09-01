import { merge, spanMinutes, type Span } from '../oee-standard/minute-classification';

/**
 * A finish estimate delays by WALL CLOCK, so the stoppage it adds is the union
 * of the planned windows — never their sum.
 *
 * ── The bug this pins ───────────────────────────────────────────────────────
 * `plannedStoppageMins` added each planned downtime event's clipped duration.
 * Downtime is recorded PER MACHINE, and this line's routing runs its four steps
 * start-to-start — filling, cartoning, palletising and wrapping are all live at
 * once — so one line-wide cleaning window exists as four rows at the same clock
 * times. Adding them turned a 60-minute stop into four hours of delay.
 *
 * Measured on the plant's own 25 August window: 16 events across 4 machines,
 * summed 660 min, union 165 min. Exactly 4x — the machine count, which is the
 * signature of this mistake and the reason it got worse as the line grew.
 *
 * These exercise the same `merge`/`spanMinutes` the service now calls, so a
 * regression in the interval algebra fails here rather than in a finish time
 * somebody has to notice was optimistic.
 */

const at = (h: number, m = 0) => Date.UTC(2026, 7, 25, h, m);
const mins = (spans: Span[]) => spanMinutes(merge(spans));

describe('planned stoppage counts wall clock, not machine-minutes', () => {
  it('counts one line-wide window once, however many machines carry it', () => {
    // The real shape: four machines, one 60-minute cleaning window, four rows.
    const fourMachines: Span[] = [
      [at(7, 30), at(8, 30)],
      [at(7, 30), at(8, 30)],
      [at(7, 30), at(8, 30)],
      [at(7, 30), at(8, 30)],
    ];
    expect(mins(fourMachines)).toBe(60);
  });

  it('still adds windows that do not overlap', () => {
    // Merging must not collapse genuinely separate losses. M1 stops 10:00–10:30
    // and M2 stops 11:00–11:30: the line loses an hour, not half of one.
    expect(mins([[at(10), at(10, 30)], [at(11), at(11, 30)]])).toBe(60);
  });

  it('counts the covered time once when windows partly overlap', () => {
    // 10:00–11:00 and 10:30–12:00 cover 10:00–12:00. Summing says three hours.
    expect(mins([[at(10), at(11)], [at(10, 30), at(12)]])).toBe(120);
  });

  it('absorbs a window wholly inside another', () => {
    expect(mins([[at(8), at(12)], [at(9), at(10)]])).toBe(240);
  });

  it('joins windows that meet exactly, without inventing a gap', () => {
    expect(mins([[at(8), at(9)], [at(9), at(10)]])).toBe(120);
  });

  it('reproduces the plant figure: four machines, a day shift of stops', () => {
    // 25 August as seeded — cleaning 30, startup 30, changeover 45, lunch 60 —
    // booked against all four machines. 165 min of clock, 660 machine-minutes.
    const windows: Array<[number, number]> = [
      [at(7, 30), at(8, 0)],
      [at(8, 0), at(8, 30)],
      [at(10, 0), at(10, 45)],
      [at(12, 0), at(13, 0)],
    ];
    const perMachine: Span[] = [];
    for (let m = 0; m < 4; m++) for (const w of windows) perMachine.push([...w] as Span);

    const summed = perMachine.reduce((a, [s, e]) => a + (e - s) / 60_000, 0);
    expect(summed).toBe(660);          // what the dialog used to show
    expect(mins(perMachine)).toBe(165); // what the line actually loses
  });

  it('returns zero for no windows rather than anything clever', () => {
    expect(mins([])).toBe(0);
  });
});
