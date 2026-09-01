import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthService } from './auth.service';
import { PrismaService } from '../../database/prisma.service';
import { KpiService, type MachineFactTotals } from '../production/kpi.service';

/**
 * The landing page may not invent a zero.
 *
 * ── What the plant saw ──────────────────────────────────────────────────────
 * The login screen greeted every visitor with
 *
 *     Overall OEE   0.0%
 *     Quality Rate  0.0%
 *
 * for a factory that had just run a full order across 14,040 measured minutes.
 *
 * The endpoint averaged `oee_records`, and `oee_records` has never been written
 * -- zero rows on every database checked. Prisma's `_avg` over no rows returns
 * null, and the mapping was `Math.round((n ?? 0) * 10) / 10`. So "we have no
 * measurement" became "we measured zero", on the first screen a customer sees.
 *
 * ── Why this is the bug worth a test of its own ─────────────────────────────
 * A missing number rendered as 0 is not a cosmetic fault. 0% OEE is a CLAIM --
 * it says the line produced nothing. It is indistinguishable, to a reader, from
 * a catastrophic shift. This same `?? 0` has now been fixed in the KPI cards,
 * the energy tiles and here; the pattern is what needs holding, not the
 * instance.
 *
 * The rule: a MEASUREMENT with no data is null. A COUNT of zero is zero.
 * Employees, alarms and shifts are counts -- an alarm tally of 0 is a fact.
 */

const facts = (over: Partial<MachineFactTotals> = {}): MachineFactTotals => ({
  plannedMin: 0, runMin: 0, downMin: 0, plannedDownMin: 0, externalMin: 0,
  microStopMin: 0, idealRunMin: 0, unmeasuredMin: 0,
  totalBase: 0, goodBase: 0, scrapBase: 0, ...over,
});

/** The real engine's contract: null when the denominator is absent. */
const realFactors = (f: MachineFactTotals | undefined) => {
  const r1 = (n: number) => Math.round(n * 10) / 10;
  if (!f) return { availability: null, performance: null, quality: null, oee: null, availabilityTb: null, oeeTb: null };
  const availability = f.plannedMin > 0 ? r1((f.runMin / f.plannedMin) * 100) : null;
  const up = f.runMin + f.downMin;
  const availabilityTb = up > 0 ? r1((f.runMin / up) * 100) : null;
  const performance = f.runMin > 0 ? Math.min(100, r1((f.idealRunMin / f.runMin) * 100)) : null;
  const quality = f.totalBase > 0 ? r1((f.goodBase / f.totalBase) * 100) : null;
  const compose = (a: number | null) =>
    a != null && performance != null && quality != null ? r1((a * performance * quality) / 10_000) : null;
  return { availability, performance, quality, oee: compose(availability), availabilityTb, oeeTb: compose(availabilityTb) };
};

describe('the public landing overview', () => {
  let service: AuthService;

  /** RUNS is the only factory with machines that reported anything. */
  const RUNS = 'factory-runs';
  const IDLE = 'factory-idle';

  beforeEach(async () => {
    const prisma = {
      factory: {
        findMany: jest.fn().mockResolvedValue([
          { id: RUNS, code: 'RUNS', name: 'Running Site', nameAr: null, city: 'Dammam', lat: 1, lng: 1, color: '#0f0', glowColor: 'g', isActive: true },
          { id: IDLE, code: 'IDLE', name: 'Quiet Site', nameAr: null, city: 'Jeddah', lat: 2, lng: 2, color: '#00f', glowColor: 'b', isActive: true },
        ]),
      },
      machine: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'm1', factoryId: RUNS },
          { id: 'm2', factoryId: RUNS },
          { id: 'm3', factoryId: IDLE },
        ]),
      },
      // Counts, deliberately non-zero on the quiet site: it has staff, it just
      // has no production. That is exactly the case a zeroed OEE misdescribes.
      user: { groupBy: jest.fn().mockResolvedValue([{ factoryId: RUNS, _count: { _all: 40 } }, { factoryId: IDLE, _count: { _all: 7 } }]) },
      alarmEvent: { groupBy: jest.fn().mockResolvedValue([]) },
      shiftInstance: { groupBy: jest.fn().mockResolvedValue([]) },
    };

    const kpi = {
      // m1 carries the time, m2 carries the quantity — the shape the engine
      // really produces, because quantity is filtered to the final routing step.
      machineFactTotals: jest.fn().mockResolvedValue(new Map<string, MachineFactTotals>([
        ['m1', facts({ plannedMin: 100, runMin: 80, downMin: 20, idealRunMin: 72 })],
        ['m2', facts({ totalBase: 1000, goodBase: 950, scrapBase: 50 })],
        // m3 absent entirely: the quiet factory reported nothing.
      ])),
      factorsFromFacts: jest.fn(realFactors),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: { signAsync: jest.fn() } },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: EventEmitter2, useValue: { emit: jest.fn() } },
        { provide: KpiService, useValue: kpi },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('reports NULL, not 0, for a factory that measured nothing', async () => {
    const { factories } = await service.getFactoriesOverview();
    const quiet = factories.find((f) => f.code === 'IDLE')!;

    // The whole defect, stated four ways.
    expect(quiet.kpis.oee).toBeNull();
    expect(quiet.kpis.quality).toBeNull();
    expect(quiet.kpis.availability).toBeNull();
    expect(quiet.kpis.uptime).toBeNull();

    // And said again as the thing that must never come back.
    expect(quiet.kpis.oee).not.toBe(0);
    expect(quiet.kpis.quality).not.toBe(0);
  });

  it('keeps a real zero where zero is a measurement', async () => {
    const { factories } = await service.getFactoriesOverview();
    const quiet = factories.find((f) => f.code === 'IDLE')!;

    // No alarms is a fact about the factory; no OEE is the absence of one.
    expect(quiet.kpis.activeAlarms).toBe(0);
    expect(quiet.kpis.shiftsToday).toBe(0);
    // Headcount is a count, and this site is staffed.
    expect(quiet.kpis.employees).toBe(7);
  });

  it('adds the machines of one factory without counting a unit twice', async () => {
    const { factories } = await service.getFactoriesOverview();
    const running = factories.find((f) => f.code === 'RUNS')!;

    // Time from m1, quantity from m2, rolled into one factory.
    expect(running.kpis.availability).toBe(80);          // 80 / 100
    expect(running.kpis.uptime).toBe(80);                // 80 / (80 + 20)
    expect(running.kpis.performance).toBe(90);           // 72 / 80
    expect(running.kpis.quality).toBe(95);               // 950 / 1000
    expect(running.kpis.oee).toBeCloseTo(68.4, 1);       // 0.8 * 0.9 * 0.95
  });

  it('averages the network over the sites that HAVE a figure', async () => {
    const { summary } = await service.getFactoriesOverview();

    // One site ran, one did not. The average is the one that ran -- a quiet
    // site has no OEE to contribute, which is not the same as contributing 0.
    expect(summary.avgOEE).toBeCloseTo(68.4, 1);
    expect(summary.avgQuality).toBe(95);

    // The old code divided by the count of factories with oee > 0, which
    // happened to be right, and then rounded a null average to 0.0 when NO
    // factory had a figure. That is the case below.
    expect(summary.totalFactories).toBe(2);
  });

  it('says how long a window the percentages describe', async () => {
    // A bare percentage invites the reader to assume "right now". The page
    // labels the tiles from this, so it must be present and positive.
    const o = await service.getFactoriesOverview();
    expect(o.windowDays).toBeGreaterThan(0);
  });
});
