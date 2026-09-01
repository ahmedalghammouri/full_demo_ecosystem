import { CarbonService, KSA_GRID_FACTOR_FALLBACK } from './carbon.service';

/**
 * Scope 2 carbon — the pilot site PoC items 26 & 27.
 *
 * The contract these tests defend:
 *  1. kg CO2e = kWh × factor, exactly — no rounding drift in the middle.
 *  2. kWh comes from the Energy module, never re-derived here, so carbon and
 *     energy can never disagree.
 *  3. The factor is CONFIGURED data. When none is configured the KSA default is
 *     used but must be flagged, so a defaulted number is never read as approved.
 */
describe('CarbonService (Scope 2)', () => {
  const factoryId = 'factory-1';

  function build(opts: { kwh?: number; factorRow?: unknown } = {}) {
    const prisma = {
      gridEmissionFactor: {
        findFirst: jest.fn().mockResolvedValue(opts.factorRow ?? null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      energyWOMachineKpi: { findMany: jest.fn().mockResolvedValue([]) },
      // The order OUTPUT comes from its final routing step, not from summing the
      // per-machine energy rows.
      jobOrder: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const energy = { electricalKwh: jest.fn().mockResolvedValue(opts.kwh ?? 0) };
    const service = new CarbonService(prisma as never, energy as never);
    return { service, prisma, energy };
  }

  const configuredRow = {
    factorKgPerKwh: 0.568,
    unit: 'kg CO2e/kWh',
    source: 'Operator-supplied KSA national grid emission factor (PoC baseline)',
    effectiveFrom: new Date('2026-01-01T00:00:00Z'),
  };

  describe('resolveFactor', () => {
    it('returns the configured factor and does not flag a fallback', async () => {
      const { service } = build({ factorRow: configuredRow });
      const f = await service.resolveFactor(factoryId);

      expect(f.factorKgPerKwh).toBe(0.568);
      expect(f.unit).toBe('kg CO2e/kWh');
      expect(f.source).toContain('Operator-supplied');
      expect(f.effectiveFrom).toBe('2026-01-01T00:00:00.000Z');
      expect(f.isFallback).toBe(false);
    });

    it('falls back to the KSA default and FLAGS it when nothing is configured', async () => {
      const { service } = build({ factorRow: null });
      const f = await service.resolveFactor(factoryId);

      expect(f.factorKgPerKwh).toBe(KSA_GRID_FACTOR_FALLBACK);
      expect(f.isFallback).toBe(true);
      expect(f.effectiveFrom).toBeNull();
    });

    it('asks for the version in force at the reporting instant', async () => {
      const { service, prisma } = build({ factorRow: configuredRow });
      const at = new Date('2026-06-30T12:00:00Z');
      await service.resolveFactor(factoryId, at);

      const where = prisma.gridEmissionFactor.findFirst.mock.calls[0][0].where;
      expect(where.effectiveFrom).toEqual({ lte: at });
      expect(where.OR).toEqual([{ effectiveTo: null }, { effectiveTo: { gte: at } }]);
    });
  });

  describe('scope2', () => {
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-31T23:59:59Z');

    it('multiplies kWh by the factor', async () => {
      const { service } = build({ kwh: 12_500, factorRow: configuredRow });
      const r = await service.scope2(factoryId, undefined, from, to);

      expect(r.kwh).toBe(12_500);
      expect(r.kgCO2e).toBe(7100);        // 12500 × 0.568
      expect(r.tCO2e).toBe(7.1);
      expect(r.factor.isFallback).toBe(false);
    });

    it('reads kWh from the Energy module rather than re-deriving it', async () => {
      const { service, energy } = build({ kwh: 900, factorRow: configuredRow });
      const scope = { lineId: 'line-betti' };
      await service.scope2(factoryId, scope, from, to);

      expect(energy.electricalKwh).toHaveBeenCalledWith(factoryId, scope, from, to);
    });

    it('returns zero emissions for zero consumption, not a null', async () => {
      const { service } = build({ kwh: 0, factorRow: configuredRow });
      const r = await service.scope2(factoryId, undefined, from, to);

      expect(r.kwh).toBe(0);
      expect(r.kgCO2e).toBe(0);
      expect(r.tCO2e).toBe(0);
    });

    it('carries the method statement so the number is self-documenting', async () => {
      const { service } = build({ kwh: 100, factorRow: configuredRow });
      const r = await service.scope2(factoryId, undefined, from, to);

      expect(r.method.standard).toBe('GHG Protocol Scope 2 (location-based)');
      expect(r.method.formula).toContain('kWh purchased electricity × grid emission factor');
      expect(r.window).toEqual({ from: from.toISOString(), to: to.toISOString() });
    });

    it('propagates the fallback flag into the result', async () => {
      const { service } = build({ kwh: 1000, factorRow: null });
      const r = await service.scope2(factoryId, undefined, from, to);

      expect(r.kgCO2e).toBe(568);
      expect(r.factor.isFallback).toBe(true);
    });
  });

  describe('scope2ByWorkOrder', () => {
    it('sums machine ENERGY but takes OUTPUT from the final step only', async () => {
      const { service, prisma } = build({ factorRow: configuredRow });
      // A routed work order: the same physical units pass BOTH machines.
      prisma.energyWOMachineKpi.findMany.mockResolvedValue([
        { machineId: 'm1', totalKwh: 1000, goodQty: 4000, outputUnit: 'CARTON' },
        { machineId: 'm2', totalKwh: 500, goodQty: 4000, outputUnit: 'CARTON' },
      ]);
      // Final step produced 1,000 CARTON. With 4 inners per carton that is 4,000
      // pieces — the order's real output.
      prisma.jobOrder.findMany.mockResolvedValue([
        {
          sequenceOrder: 2, actualQtyGood: 1000, outputUnit: 'CARTON',
          workOrder: { sku: { unitsPerInner: 1, innersPerCarton: 4, cartonsPerPallet: 40, baseUnit: 'CARTON' } },
        },
      ]);

      const r = await service.scope2ByWorkOrder(factoryId, 'wo-1');

      // Energy DOES sum across machines — each one really drew its own power.
      expect(r!.kwh).toBe(1500);
      expect(r!.kgCO2e).toBe(852);

      // Output does NOT. Summing goodQty across the two machines gave 8,000 and
      // halved the reported carbon intensity; on a five-step routing it divided it
      // by five. 852 ÷ 4,000 real pieces = 0.213.
      expect(r!.goodQty).toBe(4000);
      expect(r!.kgCO2ePerUnit).toBeCloseTo(0.213, 4);

      // And the unit is named from the packaging, not the inventory base unit.
      expect(r!.outputUnit).toBe('INNER');

      expect(r!.byMachine).toHaveLength(2);
      expect(r!.byMachine[0].kgCO2e).toBe(568);
    });

    it('returns null when the work order has no energy rows', async () => {
      const { service } = build({ factorRow: configuredRow });
      expect(await service.scope2ByWorkOrder(factoryId, 'wo-none')).toBeNull();
    });
  });
});
