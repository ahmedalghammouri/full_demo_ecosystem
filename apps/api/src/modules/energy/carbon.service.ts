import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { toPieces, smallestLadderUnit } from '../../common/units.util';
import { EnergyService } from './energy.service';

/**
 * The factor the pilot site supplied for the KSA national grid. Used ONLY when no factor row
 * exists for the factory — the resolved value always reports `isFallback` so a
 * defaulted number can never be mistaken for a configured one.
 */
export const KSA_GRID_FACTOR_FALLBACK = 0.568;

export interface ResolvedEmissionFactor {
  factorKgPerKwh: number;
  unit: string;
  source: string | null;
  effectiveFrom: string | null;
  /** True when no configured row applied and the KSA default was used. */
  isFallback: boolean;
}

export interface Scope2Result {
  /** kWh of purchased electricity in the window, for the requested scope. */
  kwh: number;
  /** kg CO2e = kwh × factor. */
  kgCO2e: number;
  /** Same figure in tonnes, for reporting. */
  tCO2e: number;
  factor: ResolvedEmissionFactor;
  scope: { areaId?: string; lineId?: string; machineId?: string } | null;
  window: { from: string; to: string };
  method: {
    standard: 'GHG Protocol Scope 2 (location-based)';
    formula: 'kg CO2e = kWh purchased electricity × grid emission factor';
    note: string;
  };
}

/**
 * CarbonService — Scope 2 (purchased electricity) emissions.
 *
 * Deliberately thin: it does not re-derive consumption. It reads the same kWh the
 * Energy module already reports, then applies the configured grid factor. That
 * guarantees the carbon number and the energy number can never disagree — the
 * failure mode the pilot site has already flagged twice on other KPIs.
 */
@Injectable()
export class CarbonService {
  private readonly logger = new Logger(CarbonService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly energy: EnergyService,
  ) {}

  /**
   * The factor in force for a factory at a given instant. Picks the row whose
   * effective window contains `at`, most recent first.
   */
  async resolveFactor(factoryId: string | null, at: Date = new Date()): Promise<ResolvedEmissionFactor> {
    const row = factoryId
      ? await this.prisma.gridEmissionFactor.findFirst({
          where: {
            factoryId,
            isActive: true,
            effectiveFrom: { lte: at },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
          },
          orderBy: { effectiveFrom: 'desc' },
        })
      : null;

    if (!row) {
      this.logger.warn(
        `No grid emission factor configured for factory ${factoryId ?? '(none)'} at ${at.toISOString()} — ` +
          `falling back to the KSA default ${KSA_GRID_FACTOR_FALLBACK} kg CO2e/kWh.`,
      );
      return {
        factorKgPerKwh: KSA_GRID_FACTOR_FALLBACK,
        unit: 'kg CO2e/kWh',
        source: 'KSA national grid default (no factor configured for this factory)',
        effectiveFrom: null,
        isFallback: true,
      };
    }

    return {
      factorKgPerKwh: row.factorKgPerKwh,
      unit: row.unit,
      source: row.source,
      effectiveFrom: row.effectiveFrom.toISOString(),
      isFallback: false,
    };
  }

  /** List every configured factor for a factory (newest effective date first). */
  async listFactors(factoryId: string | null) {
    if (!factoryId) return [];
    return this.prisma.gridEmissionFactor.findMany({
      where: { factoryId },
      orderBy: [{ effectiveFrom: 'desc' }],
    });
  }

  /**
   * Create a new factor version. Closes the currently-open row at the new row's
   * effective date rather than overwriting it, so historical reports stay
   * reproducible.
   */
  async createFactor(
    factoryId: string,
    dto: { factorKgPerKwh: number; source?: string; effectiveFrom?: string; notes?: string; unit?: string },
  ) {
    if (!(dto.factorKgPerKwh > 0)) {
      throw new NotFoundException('factorKgPerKwh must be greater than zero');
    }
    const effectiveFrom = dto.effectiveFrom ? new Date(dto.effectiveFrom) : new Date();

    return this.prisma.$transaction(async (tx) => {
      await tx.gridEmissionFactor.updateMany({
        where: { factoryId, isActive: true, effectiveTo: null, effectiveFrom: { lt: effectiveFrom } },
        data: { effectiveTo: effectiveFrom },
      });
      return tx.gridEmissionFactor.create({
        data: {
          factoryId,
          factorKgPerKwh: dto.factorKgPerKwh,
          unit: dto.unit ?? 'kg CO2e/kWh',
          source: dto.source ?? null,
          notes: dto.notes ?? null,
          effectiveFrom,
        },
      });
    });
  }

  /**
   * Scope 2 emissions for a window and scope. `kwh` comes from the Energy module's
   * own consumption read, so this number always reconciles with the energy KPIs.
   */
  async scope2(
    factoryId: string | null,
    scope: { areaId?: string; lineId?: string; machineId?: string } | undefined,
    from: Date,
    to: Date,
  ): Promise<Scope2Result> {
    const [kwh, factor] = await Promise.all([
      this.energy.electricalKwh(factoryId, scope, from, to),
      // Factor in force at the END of the window — the period being reported.
      this.resolveFactor(factoryId, to),
    ]);

    const kgCO2e = kwh * factor.factorKgPerKwh;

    return {
      kwh: Math.round(kwh * 100) / 100,
      kgCO2e: Math.round(kgCO2e * 100) / 100,
      tCO2e: Math.round((kgCO2e / 1000) * 1000) / 1000,
      factor,
      scope: scope && (scope.areaId || scope.lineId || scope.machineId) ? scope : null,
      window: { from: from.toISOString(), to: to.toISOString() },
      method: {
        standard: 'GHG Protocol Scope 2 (location-based)',
        formula: 'kg CO2e = kWh purchased electricity × grid emission factor',
        note:
          'Covers purchased ELECTRICAL energy only. Scope 1 (on-site fuel combustion) and ' +
          'Scope 3 (value chain) are out of scope for this PoC.',
      },
    };
  }

  /**
   * Scope 2 attributed to one work order, reusing the per-WO energy already
   * computed by the energy-ratio KPI so the two never diverge.
   */
  async scope2ByWorkOrder(factoryId: string | null, workOrderId: string) {
    const rows = await this.prisma.energyWOMachineKpi.findMany({
      where: { ...(factoryId ? { factoryId } : {}), workOrderId },
      select: { machineId: true, totalKwh: true, goodQty: true, outputUnit: true },
    });
    if (rows.length === 0) return null;

    const factor = await this.resolveFactor(factoryId);
    // kWh sums across machines — every machine really did draw its own power.
    const totalKwh = rows.reduce((s, r) => s + (r.totalKwh ?? 0), 0);

    // OUTPUT does not. Summing goodQty across the machines of a routed work order
    // counts the same physical bag once per step it passes — five steps here — so
    // the per-unit carbon figure came out roughly five times too low. The order's
    // output is the FINAL step's good quantity, in pieces, exactly as it is
    // everywhere else in the system.
    const steps = await this.prisma.jobOrder.findMany({
      where: { workOrderId },
      select: {
        sequenceOrder: true, actualQtyGood: true, outputUnit: true,
        workOrder: { select: { sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } } } },
      },
      orderBy: { sequenceOrder: 'desc' },
      take: 1,
    });
    const last = steps[0];
    const totalGood = last
      ? toPieces(last.actualQtyGood ?? 0, last.outputUnit, last.workOrder?.sku ?? null)
      : 0;
    const outputUnit = last?.workOrder?.sku ? smallestLadderUnit(last.workOrder.sku) : null;

    const kgCO2e = totalKwh * factor.factorKgPerKwh;

    return {
      workOrderId,
      kwh: Math.round(totalKwh * 100) / 100,
      kgCO2e: Math.round(kgCO2e * 100) / 100,
      tCO2e: Math.round((kgCO2e / 1000) * 1000) / 1000,
      /** Carbon intensity of the order's output — the reportable per-unit number. */
      kgCO2ePerUnit: totalGood > 0 ? Math.round((kgCO2e / totalGood) * 10000) / 10000 : null,
      // Derived from the SKU packaging, matching the piece-denominated goodQty.
      outputUnit,
      goodQty: totalGood,
      factor,
      byMachine: rows.map((r) => ({
        machineId: r.machineId,
        kwh: Math.round((r.totalKwh ?? 0) * 100) / 100,
        kgCO2e: Math.round((r.totalKwh ?? 0) * factor.factorKgPerKwh * 100) / 100,
      })),
    };
  }
}
