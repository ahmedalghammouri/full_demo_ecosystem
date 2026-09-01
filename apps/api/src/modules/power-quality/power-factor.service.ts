import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const DAY = 86_400_000;

/**
 * Tariff assumptions.
 *
 * These are choices, not measurements, and they are returned with every
 * response so nobody presents a modelled saving as a metered one.
 *
 * The important one is the capacity charge. It is billed on **apparent** power,
 * so a poor power factor inflates it directly — and for most industrial sites
 * that is the larger of the two ways low PF costs money, several times over the
 * reactive-energy surcharge everyone quotes. A business case built only on the
 * kVArh line understates the return badly.
 */
const TARIFF = {
  currency: 'SAR',
  energyPerKwh: 0.18,
  /** Per kVA of billed demand, per month — charged on apparent power. */
  capacityPerKvaMonth: 30,
  /** Surcharge on reactive energy drawn below the threshold power factor. */
  reactivePerKvarh: 0.045,
  pfThreshold: 0.9,
  vatPct: 15,
};

@Injectable()
export class PowerFactorService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertCapability(factoryId: string) {
    const factory = await this.prisma.factory.findUnique({
      where: { id: factoryId },
      select: { code: true, metadata: true },
    });
    if (!factory) throw new ForbiddenException('Unknown factory');
    const caps = (factory.metadata as { capabilities?: string[] } | null)?.capabilities ?? [];
    if (!caps.includes('POWER_FACTOR')) {
      throw new ForbiddenException(
        `${factory.code} does not have the POWER_FACTOR module. Its classification does not include reactive-power metering.`,
      );
    }
    return factory;
  }

  /**
   * Power factor across the estate's boards, what it costs, and the banks that
   * are supposed to be fixing it.
   */
  async overview(factoryId: string, days = 30) {
    await this.assertCapability(factoryId);
    const from = new Date(Date.now() - days * DAY);

    const [byMeter, trend, banks] = await Promise.all([
      this.prisma.$queryRaw<Array<{
        meterId: string; meterNumber: string; name: string;
        avgPf: number; minPf: number; kwh: number; kvarh: number; peakKw: number;
      }>>`
        SELECT r."meterId", m."meterNumber", m.name,
               avg(r."powerFactor")  AS "avgPf",
               min(r."powerFactor")  AS "minPf",
               sum(r."powerKw")      AS kwh,
               sum(r."reactiveKvar") AS kvarh,
               max(r."powerKw")      AS "peakKw"
        FROM energy_readings r
        JOIN energy_meters m ON m.id = r."meterId"
        WHERE r."factoryId" = ${factoryId}
          AND r.timestamp >= ${from}
          AND r."powerFactor" IS NOT NULL
        GROUP BY 1, 2, 3
        ORDER BY "avgPf" ASC`,

      this.prisma.$queryRaw<Array<{ day: Date; pf: number; kvar: number }>>`
        SELECT date_trunc('day', r.timestamp) AS day,
               avg(r."powerFactor")  AS pf,
               sum(r."reactiveKvar") AS kvar
        FROM energy_readings r
        WHERE r."factoryId" = ${factoryId}
          AND r.timestamp >= ${from}
          AND r."powerFactor" IS NOT NULL
        GROUP BY 1 ORDER BY 1`,

      this.prisma.capacitorBank.findMany({
        where: { factoryId },
        include: {
          machine: { select: { code: true, name: true, nameAr: true } },
          steps: { orderBy: { stepNo: 'asc' } },
        },
      }),
    ]);

    const meters = byMeter.map((m) => {
      const avgPf = Number(m.avgPf);
      const kwh = Number(m.kwh);
      const kvarh = Number(m.kvarh);
      const peakKw = Number(m.peakKw);

      // Only the reactive energy drawn below the threshold attracts a surcharge.
      const billableKvarh = avgPf < TARIFF.pfThreshold
        ? Math.max(0, kvarh - kwh * Math.tan(Math.acos(TARIFF.pfThreshold)))
        : 0;

      // Capacity is billed on apparent power: S = P / pf.
      const billedKva = avgPf > 0 ? peakKw / avgPf : peakKw;
      const kvaAtTarget = peakKw / 0.98;

      return {
        meterId: m.meterId,
        meterNumber: m.meterNumber,
        name: m.name,
        avgPf: round(avgPf, 3),
        minPf: round(Number(m.minPf), 3),
        kwh: round(kwh, 1),
        kvarh: round(kvarh, 1),
        peakKw: round(peakKw, 1),
        billedKva: round(billedKva, 1),
        compliant: avgPf >= TARIFF.pfThreshold,
        cost: {
          reactiveSurcharge: round(billableKvarh * TARIFF.reactivePerKvarh, 0),
          // Per month, scaled from the window so the two figures are comparable.
          capacityPenalty: round((billedKva - kvaAtTarget) * TARIFF.capacityPerKvaMonth, 0),
        },
      };
    });

    const totalReactive = meters.reduce((n, m) => n + m.cost.reactiveSurcharge, 0);
    const totalCapacity = meters.reduce((n, m) => n + Math.max(0, m.cost.capacityPenalty), 0);

    return {
      periodDays: days,
      tariff: {
        ...TARIFF,
        note:
          'Modelling assumptions, not metered values. The capacity charge is billed on apparent power, which is usually the larger of the two ways a poor power factor costs money.',
      },
      meters,
      worst: meters[0] ?? null,
      exposure: {
        reactiveSurcharge: round(totalReactive, 0),
        capacityPenalty: round(totalCapacity, 0),
        total: round(totalReactive + totalCapacity, 0),
        // Stated explicitly because it is the point: quoting only the kVArh line
        // understates the return, often by several times.
        capacityShareOfTotal:
          totalReactive + totalCapacity > 0
            ? Math.round((totalCapacity / (totalReactive + totalCapacity)) * 100)
            : null,
      },
      trend: trend.map((t) => ({
        day: t.day,
        pf: round(Number(t.pf), 3),
        kvar: round(Number(t.kvar), 1),
      })),
      banks: banks.map((b) => ({
        id: b.id,
        code: b.machine.code,
        name: b.machine.name,
        totalKvar: b.totalKvar,
        stepCount: b.stepCount,
        stepKvar: b.stepKvar,
        detunedFilter: b.detunedFilter,
        ratedStepCurrent: b.ratedStepCurrent,
        measuredStepCurrent: b.measuredStepCurrent,
        // The finding, computed rather than asserted: a bank with no detuning
        // reactor draws harmonic current on top of its own, and runs above
        // nameplate until it fails.
        currentOverloadPct:
          b.ratedStepCurrent && b.measuredStepCurrent != null
            ? round((b.measuredStepCurrent / b.ratedStepCurrent - 1) * 100, 1)
            : null,
        ratedCapacitanceUf: b.ratedCapacitanceUf,
        measuredCapacitanceUf: b.measuredCapacitanceUf,
        healthIndex: b.healthIndex,
        verdict:
          b.measuredStepCurrent === 0 ? 'FAILED'
          : b.ratedStepCurrent && b.measuredStepCurrent! > b.ratedStepCurrent * 1.1 ? 'OVERLOADED'
          : 'OK',
        steps: b.steps.map((s) => ({
          stepNo: s.stepNo, kvar: s.kvar, state: s.state,
          currentA: s.currentA, capacitanceUf: s.capacitanceUf,
          healthPct: s.healthPct, switchingOps: s.switchingOps,
        })),
      })),
    };
  }

  /**
   * How much compensation it would take to reach a target power factor, and
   * what that is worth.
   *
   * Q = P · (tan φ₁ − tan φ₂). Standard, and stated so a reviewer can check it
   * rather than trust it.
   */
  async sizing(factoryId: string, target = 0.98, days = 30) {
    await this.assertCapability(factoryId);
    const o = await this.overview(factoryId, days);

    const sized = o.meters
      .filter((m) => m.avgPf < target)
      .map((m) => {
        const phi1 = Math.acos(Math.min(1, Math.max(0.01, m.avgPf)));
        const phi2 = Math.acos(target);
        const kvarNeeded = m.peakKw * (Math.tan(phi1) - Math.tan(phi2));
        const kvaNow = m.peakKw / m.avgPf;
        const kvaAfter = m.peakKw / target;
        const annualSaving =
          (kvaNow - kvaAfter) * TARIFF.capacityPerKvaMonth * 12 + m.cost.reactiveSurcharge * (365 / days);
        return {
          meterId: m.meterId,
          meterNumber: m.meterNumber,
          name: m.name,
          currentPf: m.avgPf,
          targetPf: target,
          kvarNeeded: round(kvarNeeded, 0),
          // Banks are sold in steps; round up to something orderable.
          recommendedBankKvar: Math.ceil(kvarNeeded / 25) * 25,
          kvaBefore: round(kvaNow, 1),
          kvaAfter: round(kvaAfter, 1),
          annualSaving: round(annualSaving, 0),
        };
      });

    const totalKvar = sized.reduce((n, s) => n + s.recommendedBankKvar, 0);
    const totalSaving = sized.reduce((n, s) => n + s.annualSaving, 0);
    // A detuned bank costs more than a plain one, and on a distorted board the
    // plain one is what fails — so this is the price that belongs in the case.
    const capexPerKvar = 220;
    const capex = totalKvar * capexPerKvar;

    return {
      target,
      formula: 'Q = P · (tan φ₁ − tan φ₂)',
      assumptions: {
        capexPerKvar,
        note:
          'Detuned banks assumed, at a premium over plain ones. On a board with this level of current distortion a plain bank is what fails, so the cheaper option is not the comparable one.',
      },
      perMeter: sized,
      totalKvar,
      capex,
      annualSaving: round(totalSaving, 0),
      paybackYears: totalSaving > 0 ? round(capex / totalSaving, 1) : null,
    };
  }
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
