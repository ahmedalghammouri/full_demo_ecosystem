import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const DAY = 86_400_000;

/**
 * Power quality — voltage events, harmonics and EN 50160 compliance.
 *
 * Every query is scoped to one factory, and every entry point checks that the
 * factory's classification actually grants the capability first. A site without
 * power-quality metering must get a refusal, not an empty result set: an empty
 * chart reads as "nothing wrong here", which is the opposite of the truth.
 */
@Injectable()
export class PowerQualityService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Refuse early for a factory whose type does not grant this module.
   *
   * The capability list is written onto the factory row by the seeder from the
   * plant model, so this and the navigation read one source and cannot drift
   * into offering a screen the backend will not serve.
   */
  private async assertCapability(factoryId: string, capability: string) {
    const factory = await this.prisma.factory.findUnique({
      where: { id: factoryId },
      select: { code: true, metadata: true },
    });
    if (!factory) throw new ForbiddenException('Unknown factory');
    const caps = (factory.metadata as { capabilities?: string[] } | null)?.capabilities ?? [];
    if (!caps.includes(capability)) {
      throw new ForbiddenException(
        `${factory.code} does not have the ${capability} module. Its classification does not include power-quality metering.`,
      );
    }
  }

  // ── Events ───────────────────────────────────────────────────────────────

  async events(factoryId: string, params: { days?: number; type?: string; severity?: string; meterId?: string; limit?: number }) {
    await this.assertCapability(factoryId, 'POWER_QUALITY');
    const days = params.days ?? 30;
    const from = new Date(Date.now() - days * DAY);

    return this.prisma.pqEvent.findMany({
      where: {
        factoryId,
        startedAt: { gte: from },
        ...(params.type ? { type: params.type as never } : {}),
        ...(params.severity ? { severity: params.severity as never } : {}),
        ...(params.meterId ? { meterId: params.meterId } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: Math.min(params.limit ?? 200, 1000),
      include: { meter: { select: { id: true, meterNumber: true, name: true, nameAr: true } } },
    });
  }

  async summary(factoryId: string, days = 30) {
    await this.assertCapability(factoryId, 'POWER_QUALITY');
    const from = new Date(Date.now() - days * DAY);
    const prevFrom = new Date(from.getTime() - days * DAY);

    const [byType, bySeverity, byZone, byMeter, total, prevTotal, withScrap, worst] = await Promise.all([
      this.prisma.pqEvent.groupBy({ by: ['type'], where: { factoryId, startedAt: { gte: from } }, _count: true }),
      this.prisma.pqEvent.groupBy({ by: ['severity'], where: { factoryId, startedAt: { gte: from } }, _count: true }),
      this.prisma.pqEvent.groupBy({ by: ['iticZone'], where: { factoryId, startedAt: { gte: from }, iticZone: { not: null } }, _count: true }),
      this.prisma.pqEvent.groupBy({ by: ['meterId'], where: { factoryId, startedAt: { gte: from } }, _count: true }),
      this.prisma.pqEvent.count({ where: { factoryId, startedAt: { gte: from } } }),
      this.prisma.pqEvent.count({ where: { factoryId, startedAt: { gte: prevFrom, lt: from } } }),
      this.prisma.pqEvent.count({ where: { factoryId, startedAt: { gte: from }, causedScrap: true } }),
      // The deepest sag in the window: the single number an engineer asks for.
      this.prisma.pqEvent.findFirst({
        where: { factoryId, startedAt: { gte: from }, type: 'SAG' },
        orderBy: { magnitudePct: 'asc' },
        include: { meter: { select: { meterNumber: true, name: true } } },
      }),
    ]);

    const meters = await this.prisma.energyMeter.findMany({
      where: { id: { in: byMeter.map((m) => m.meterId) } },
      select: { id: true, meterNumber: true, name: true },
    });
    const meterById = new Map(meters.map((m) => [m.id, m]));

    return {
      periodDays: days,
      total,
      previousTotal: prevTotal,
      // Null rather than 0 when there is no previous period to compare with:
      // "no change" and "nothing to compare" are different statements.
      changePct: prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 1000) / 10 : null,
      withScrap,
      byType: byType.map((t) => ({ type: t.type, count: t._count })),
      bySeverity: bySeverity.map((s) => ({ severity: s.severity, count: s._count })),
      byZone: byZone.map((z) => ({ zone: z.iticZone, count: z._count })),
      byMeter: byMeter
        .map((m) => ({
          meterId: m.meterId,
          meterNumber: meterById.get(m.meterId)?.meterNumber ?? '—',
          name: meterById.get(m.meterId)?.name ?? '—',
          count: m._count,
        }))
        .sort((a, b) => b.count - a.count),
      worstSag: worst
        ? {
            magnitudePct: worst.magnitudePct,
            durationMs: worst.durationMs,
            startedAt: worst.startedAt,
            meter: worst.meter?.name ?? null,
          }
        : null,
    };
  }

  /**
   * Points for the ITIC/CBEMA plot.
   *
   * Duration on a log axis against residual voltage. The curve itself is drawn
   * client-side; this returns only measured points and the zone each fell in,
   * so the plot cannot classify an event differently from the events table.
   */
  async iticScatter(factoryId: string, days = 90) {
    await this.assertCapability(factoryId, 'POWER_QUALITY');
    const from = new Date(Date.now() - days * DAY);
    const events = await this.prisma.pqEvent.findMany({
      where: {
        factoryId,
        startedAt: { gte: from },
        type: { in: ['SAG', 'SWELL', 'INTERRUPTION'] },
      },
      select: {
        id: true, type: true, severity: true, iticZone: true,
        magnitudePct: true, durationMs: true, startedAt: true, causedScrap: true,
        meter: { select: { meterNumber: true, name: true } },
      },
      orderBy: { startedAt: 'desc' },
      take: 1000,
    });
    return { periodDays: days, points: events };
  }

  /** Events per day, for the trend strip above the scatter. */
  async timeline(factoryId: string, days = 60) {
    await this.assertCapability(factoryId, 'POWER_QUALITY');
    const from = new Date(Date.now() - days * DAY);
    const rows = await this.prisma.$queryRaw<Array<{ day: Date; type: string; count: bigint }>>`
      SELECT date_trunc('day', "startedAt") AS day, type, count(*) AS count
      FROM pq_events
      WHERE "factoryId" = ${factoryId} AND "startedAt" >= ${from}
      GROUP BY 1, 2
      ORDER BY 1`;
    return rows.map((r) => ({ day: r.day, type: r.type, count: Number(r.count) }));
  }

  // ── Harmonics ────────────────────────────────────────────────────────────

  /**
   * The latest spectrum per phase for one meter, plus the limits it is judged
   * against. Both standards are returned because they answer different
   * questions: EN 50160 bounds the voltage the utility delivers, IEEE 519
   * bounds the current the installation draws.
   */
  async harmonics(factoryId: string, meterId: string) {
    await this.assertCapability(factoryId, 'HARMONICS');
    const latest = await this.prisma.harmonicSnapshot.findMany({
      where: { factoryId, meterId },
      orderBy: { time: 'desc' },
      take: 3,
    });
    if (!latest.length) return { meterId, phases: [], limits: EN50160_VOLTAGE_LIMITS, ieee519: IEEE519_CURRENT_LIMITS };

    const trend = await this.prisma.$queryRaw<Array<{ hour: Date; vthd: number; ithd: number }>>`
      SELECT date_trunc('hour', time) AS hour, avg("vThd") AS vthd, avg("iThd") AS ithd
      FROM harmonic_snapshots
      WHERE "factoryId" = ${factoryId} AND "meterId" = ${meterId}
        AND time >= NOW() - INTERVAL '7 days'
      GROUP BY 1 ORDER BY 1`;

    return {
      meterId,
      at: latest[0].time,
      phases: latest.map((s) => ({
        phase: s.phase,
        vThd: s.vThd,
        iThd: s.iThd,
        tdd: s.tdd,
        // Orders start at H2, so index i is harmonic i + 2.
        orders: s.vHarmonics.map((v, i) => ({
          order: i + 2,
          voltagePct: v,
          currentPct: s.iHarmonics[i] ?? 0,
          voltageLimit: EN50160_VOLTAGE_LIMITS[i + 2] ?? null,
        })),
      })),
      trend: trend.map((t) => ({ hour: t.hour, vThd: Number(t.vthd), iThd: Number(t.ithd) })),
      limits: EN50160_VOLTAGE_LIMITS,
      ieee519: IEEE519_CURRENT_LIMITS,
    };
  }

  /** Meters ranked by distortion — where to look first. */
  async harmonicRanking(factoryId: string) {
    await this.assertCapability(factoryId, 'HARMONICS');
    const rows = await this.prisma.$queryRaw<Array<{
      meterId: string; meterNumber: string; name: string; vthd: number; ithd: number; tdd: number; samples: bigint;
    }>>`
      SELECT h."meterId", m."meterNumber", m.name,
             avg(h."vThd") AS vthd, avg(h."iThd") AS ithd, avg(h.tdd) AS tdd, count(*) AS samples
      FROM harmonic_snapshots h
      JOIN energy_meters m ON m.id = h."meterId"
      WHERE h."factoryId" = ${factoryId} AND h.time >= NOW() - INTERVAL '7 days'
      GROUP BY 1, 2, 3
      ORDER BY ithd DESC`;

    return rows.map((r) => ({
      meterId: r.meterId,
      meterNumber: r.meterNumber,
      name: r.name,
      vThd: Math.round(Number(r.vthd) * 100) / 100,
      iThd: Math.round(Number(r.ithd) * 100) / 100,
      tdd: Math.round(Number(r.tdd) * 100) / 100,
      samples: Number(r.samples),
      // EN 50160 caps voltage THD at 8%; IEEE 519 puts the usual current TDD
      // limit at 15% for this class of installation.
      voltagePass: Number(r.vthd) <= 8,
      currentPass: Number(r.tdd) <= 15,
    }));
  }

  // ── Compliance ───────────────────────────────────────────────────────────

  /** Weekly EN 50160 assessments, newest first. */
  async compliance(factoryId: string, weeks = 12) {
    await this.assertCapability(factoryId, 'POWER_QUALITY');
    return this.prisma.en50160Assessment.findMany({
      where: { factoryId },
      orderBy: { weekStart: 'desc' },
      take: weeks * 8,
      include: { meter: { select: { meterNumber: true, name: true } } },
    });
  }
}

/**
 * EN 50160 individual voltage-harmonic limits, % of fundamental.
 *
 * Odd non-triplen orders get the widest allowance because they are what a
 * six-pulse converter actually produces; even orders are held tight because a
 * healthy installation has almost none, so their presence is itself a finding.
 */
const EN50160_VOLTAGE_LIMITS: Record<number, number> = {
  2: 2.0, 3: 5.0, 4: 1.0, 5: 6.0, 6: 0.5, 7: 5.0, 8: 0.5, 9: 1.5,
  10: 0.5, 11: 3.5, 12: 0.5, 13: 3.0, 14: 0.5, 15: 0.5, 16: 0.5, 17: 2.0,
  18: 0.5, 19: 1.5, 20: 0.5, 21: 0.5, 22: 0.5, 23: 1.5, 24: 0.5, 25: 1.5,
};

/**
 * IEEE 519 current-distortion limits by short-circuit ratio, % of demand.
 *
 * The standard bounds TDD, not THD — referenced to maximum demand rather than
 * to the present fundamental — which is why a lightly loaded feeder can show an
 * alarming THD while remaining compliant.
 */
const IEEE519_CURRENT_LIMITS = [
  { scrMin: 0, scrMax: 20, tdd: 5.0 },
  { scrMin: 20, scrMax: 50, tdd: 8.0 },
  { scrMin: 50, scrMax: 100, tdd: 12.0 },
  { scrMin: 100, scrMax: 1000, tdd: 15.0 },
  { scrMin: 1000, scrMax: Infinity, tdd: 20.0 },
];
