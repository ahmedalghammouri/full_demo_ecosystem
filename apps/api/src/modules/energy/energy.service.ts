import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EnergyPeriod } from '@prisma/client';
import { instantiateMeterTags } from './meter-templates';
import { plantDayKey, plantBound } from '../../common/plant-time.util';

@Injectable()
export class EnergyService {
  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────
  // COST TARIFFS — scoped rate resolution (machine > line > area > factory)
  // ────────────────────────────────────────────────────────────

  /**
   * Resolve a cost rate (per meter unit) for each in-scope meter. For every meter
   * we pick the most specific active tariff matching its energy type, in order:
   * machine → line → area → factory-default. Returns a meterId → ratePerUnit map.
   */
  private async resolveMeterRates(
    factoryId: string | null,
    meters: { id: string; type: string; machineId: string | null; lineId: string | null; areaId: string | null }[],
  ): Promise<Map<string, number>> {
    const rates = new Map<string, number>();
    if (!meters.length) return rates;
    const tariffs = await this.prisma.energyTariff.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: { energyType: true, machineId: true, lineId: true, areaId: true, ratePerUnit: true },
    });
    for (const m of meters) {
      const ofType = tariffs.filter((t) => t.energyType === (m.type as any));
      const pick =
        ofType.find((t) => t.machineId && t.machineId === m.machineId) ??
        ofType.find((t) => t.lineId && t.lineId === m.lineId) ??
        ofType.find((t) => t.areaId && t.areaId === m.areaId) ??
        ofType.find((t) => !t.machineId && !t.lineId && !t.areaId); // factory default
      if (pick) rates.set(m.id, pick.ratePerUnit);
    }
    return rates;
  }

  // ────────────────────────────────────────────────────────────
  // OVERVIEW
  // ────────────────────────────────────────────────────────────

  /** Scope (area/line/machine) → an EnergyMeter where-fragment. Meters can be
   *  scoped directly (machineId/lineId/areaId) OR via their machine's line/area. */
  private scopeMeterWhere(scope?: { areaId?: string; lineId?: string; machineId?: string }): Record<string, unknown> {
    if (!scope) return {};
    if (scope.machineId) return { machineId: scope.machineId };
    if (scope.lineId) return { OR: [{ lineId: scope.lineId }, { machine: { lineId: scope.lineId } }] };
    if (scope.areaId) return { OR: [{ areaId: scope.areaId }, { line: { areaId: scope.areaId } }, { machine: { line: { areaId: scope.areaId } } }] };
    return {};
  }

  /**
   * Truthful consumption straight from `EnergyReading` (cumulative value is a
   * monotonic meter total, so consumption = last − first in the window, per meter).
   * Used as a fallback whenever `EnergySummary` buckets aren't populated yet.
   */
  private async consumptionFromReadings(
    factoryId: string | null,
    meterWhere: Record<string, unknown>,
    from: Date,
    to: Date,
  ): Promise<{ total: number; byType: Record<string, number>; byMeter: Map<string, number> }> {
    const meters = await this.prisma.energyMeter.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true, ...meterWhere },
      select: { id: true, type: true },
    });
    const byType: Record<string, number> = {};
    const byMeter = new Map<string, number>();
    let total = 0;
    for (const m of meters) {
      const [first, last] = await Promise.all([
        this.prisma.energyReading.findFirst({ where: { meterId: m.id, timestamp: { gte: from, lte: to } }, orderBy: { timestamp: 'asc' }, select: { value: true } }),
        this.prisma.energyReading.findFirst({ where: { meterId: m.id, timestamp: { gte: from, lte: to } }, orderBy: { timestamp: 'desc' }, select: { value: true } }),
      ]);
      if (!first || !last) continue;
      const delta = Math.max(0, (last.value ?? 0) - (first.value ?? 0));
      total += delta;
      byMeter.set(m.id, delta);
      byType[m.type] = (byType[m.type] ?? 0) + delta;
    }
    return { total, byType, byMeter };
  }

  /**
   * ELECTRICAL kWh consumed in a window for a scope — the single public read every
   * electricity-derived KPI must use (cost, energy ratio, Scope 2 carbon), so those
   * figures can never disagree with the Energy dashboard.
   */
  async electricalKwh(
    factoryId: string | null,
    scope: { areaId?: string; lineId?: string; machineId?: string } | undefined,
    from: Date,
    to: Date,
  ): Promise<number> {
    const meterWhere = this.scopeMeterWhere(scope);
    const { byType } = await this.consumptionFromReadings(factoryId, meterWhere, from, to);
    return byType['ELECTRICAL'] ?? 0;
  }

  async getOverview(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const meterWhere = this.scopeMeterWhere(scope);
    const meterScoped = Object.keys(meterWhere).length ? { meter: meterWhere } : {};
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const [meterCount, monthlySummaries, dailySummaries] = await Promise.all([
      this.prisma.energyMeter.count({ where: { ...factoryFilter, isActive: true, ...meterWhere } }),
      this.prisma.energySummary.findMany({
        where: { ...factoryFilter, ...meterScoped, periodType: EnergyPeriod.DAILY, periodStart: { gte: monthStart } },
        include: { meter: { select: { type: true } } },
      }),
      this.prisma.energySummary.findMany({
        where: { ...factoryFilter, ...meterScoped, periodType: EnergyPeriod.DAILY, periodStart: { gte: dayStart } },
        include: { meter: { select: { type: true } } },
      }),
    ]);

    let totalMTD = monthlySummaries.reduce((s, r) => s + r.totalConsumption, 0);
    let costMTD = monthlySummaries.reduce((s, r) => s + (r.cost ?? 0), 0);
    // Today's headline is ELECTRICAL only — summing kWh + m³ + L into one number is
    // physically meaningless. Per-type figures live in `byType`; cost (SAR) is comparable.
    let todayElectrical = dailySummaries.filter((r) => r.meter.type === 'ELECTRICAL').reduce((s, r) => s + r.totalConsumption, 0);

    let byType: Record<string, number> = {};
    for (const s of monthlySummaries) {
      const t = s.meter.type;
      byType[t] = (byType[t] ?? 0) + s.totalConsumption;
    }

    // Fallback to raw readings when the rollup hasn't populated summaries yet,
    // so the dashboard shows true consumption instead of zeros.
    if (!monthlySummaries.length) {
      const mtd = await this.consumptionFromReadings(factoryId, meterWhere, monthStart, now);
      totalMTD = mtd.total;
      byType = mtd.byType;
      // Derive cost live from configured tariffs (EnergySummary.cost is unpopulated).
      const scopedMeters = await this.prisma.energyMeter.findMany({
        where: { ...factoryFilter, isActive: true, ...meterWhere },
        select: { id: true, type: true, machineId: true, lineId: true, areaId: true },
      });
      const rates = await this.resolveMeterRates(factoryId, scopedMeters);
      costMTD = 0;
      for (const [mid, cons] of mtd.byMeter) costMTD += cons * (rates.get(mid) ?? 0);
    }
    if (!dailySummaries.length) {
      todayElectrical = (await this.consumptionFromReadings(factoryId, meterWhere, dayStart, now)).byType['ELECTRICAL'] ?? 0;
    }

    // Trend: last 7 days ELECTRICAL daily totals (single unit = kWh, so the chart
    // is physically meaningful — gas/water/air are shown separately in byType).
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
    const trendSummaries = await this.prisma.energySummary.findMany({
      where: { ...factoryFilter, ...meterScoped, periodType: EnergyPeriod.DAILY, periodStart: { gte: sevenDaysAgo } },
      include: { meter: { select: { type: true } } },
      orderBy: { periodStart: 'asc' },
    });

    const byDate: Record<string, number> = {};
    for (const s of trendSummaries) {
      if (s.meter.type !== 'ELECTRICAL') continue;
      const d = s.periodStart.toISOString().slice(5, 10); // MM-DD
      byDate[d] = (byDate[d] ?? 0) + s.totalConsumption;
    }
    // Reading-based fallback: per-day ELECTRICAL consumption for the last 7 days.
    if (!trendSummaries.length) {
      for (let i = 6; i >= 0; i--) {
        const dStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        const dEnd = new Date(dStart); dEnd.setDate(dEnd.getDate() + 1);
        const day = dStart.toISOString().slice(5, 10);
        byDate[day] = (await this.consumptionFromReadings(factoryId, meterWhere, dStart, dEnd)).byType['ELECTRICAL'] ?? 0;
      }
    }

    // Headline consumption is ELECTRICAL kWh (single unit). The full multi-utility
    // picture is in `byType`; the all-utilities sum is exposed separately, not as
    // the headline (mixing kWh/m³/L into one figure is not physically meaningful).
    const electricalMtd = byType['ELECTRICAL'] ?? 0;
    return {
      meterCount,
      totalConsumptionMtd: parseFloat(electricalMtd.toFixed(2)),
      totalConsumptionUnit: 'kWh',
      totalConsumptionAllMtd: parseFloat(totalMTD.toFixed(2)),
      totalCostMtd: parseFloat(costMTD.toFixed(2)),
      totalConsumptionToday: parseFloat(todayElectrical.toFixed(2)),
      byType,
      trend: Object.entries(byDate).map(([date, value]) => ({ date, value: parseFloat(value.toFixed(2)) })),
    };
  }

  /**
   * Energy Command Center cockpit — composes the scope-aware overview, live power and
   * the multi-utility consumption trend with a production-energy waste split
   * (running / idle / downtime kWh) and specific energy (kWh/unit) from EnergyWOSummary,
   * plus the live top consumers. One round-trip for the native energy command page.
   */
  async getEnergyCockpit(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
    range?: { dateFrom?: string; dateTo?: string },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const now = new Date();
    const to = plantBound(range?.dateTo, 'end') ?? now;
    const from = plantBound(range?.dateFrom, 'start')
      ?? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13);
    // Plant-local day, so a window labelled "today" matches the plant's day.
    const iso = (d: Date) => plantDayKey(d);

    const [overview, live, consumption, woSummaries] = await Promise.all([
      this.getOverview(factoryId, scope),
      this.getLivePower(factoryId, scope),
      this.getConsumption(factoryId, { from: iso(from), to: iso(to), periodType: 'DAILY', ...scope }),
      this.prisma.energyWOSummary.findMany({
        where: { ...factoryFilter, computedAt: { gte: from, lte: to } },
        select: { runningKwh: true, idleKwh: true, downtimeKwh: true, anomalyCount: true, kwhPerUnit: true },
      }),
    ]);

    // Production-energy waste split + specific energy (factory-level, over the window).
    let runningKwh = 0, idleKwh = 0, downtimeKwh = 0, anomalyCount = 0;
    const perUnit: number[] = [];
    for (const w of woSummaries) {
      runningKwh += w.runningKwh ?? 0;
      idleKwh += w.idleKwh ?? 0;
      downtimeKwh += w.downtimeKwh ?? 0;
      anomalyCount += w.anomalyCount ?? 0;
      if (w.kwhPerUnit != null && w.kwhPerUnit > 0) perUnit.push(w.kwhPerUnit);
    }
    const round2 = (n: number) => parseFloat(n.toFixed(2));
    const avgKwhPerUnit = perUnit.length ? round2(perUnit.reduce((s, v) => s + v, 0) / perUnit.length) : null;

    // Live top consumers — scope-aware, by instantaneous power.
    const topConsumers = [...(live?.meters ?? [])]
      .filter((m) => (m.powerKw ?? 0) > 0)
      .sort((a, b) => (b.powerKw ?? 0) - (a.powerKw ?? 0))
      .slice(0, 8)
      .map((m) => ({ meterId: m.meterId, name: m.name, type: m.type, powerKw: m.powerKw, standby: m.standby, machineState: m.machineState }));

    return {
      scope: scope && (scope.areaId || scope.lineId || scope.machineId) ? scope : null,
      overview,
      live,
      consumption,
      waste: {
        runningKwh: round2(runningKwh),
        idleKwh: round2(idleKwh),
        downtimeKwh: round2(downtimeKwh),
        anomalyCount,
        avgKwhPerUnit,
        woCount: woSummaries.length,
      },
      topConsumers,
      generatedAt: now.toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────
  // METERS
  // ────────────────────────────────────────────────────────────

  async findMeters(factoryId: string | null) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const meters = await this.prisma.energyMeter.findMany({
      where: { ...factoryFilter, isActive: true },
      include: {
        machine: { select: { name: true, code: true } },
        area: { select: { name: true } },
        device: { select: { id: true, deviceCode: true, protocol: true, status: true, lastSeenAt: true } },
        _count: { select: { tags: true } },
        readings: {
          orderBy: { timestamp: 'desc' },
          take: 1,
          select: { value: true, unit: true, timestamp: true, source: true },
        },
        summaries: {
          where: {
            periodType: EnergyPeriod.DAILY,
            periodStart: {
              gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
            },
          },
          select: { totalConsumption: true, cost: true },
        },
      },
      orderBy: [{ type: 'asc' }, { name: 'asc' }],
    });

    // Live MTD consumption (readings fallback) + cost from configured tariffs —
    // keeps the meters table consistent with the overview KPIs.
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const { byMeter } = await this.consumptionFromReadings(factoryId, {}, monthStart, now);
    const rates = await this.resolveMeterRates(
      factoryId,
      meters.map((m) => ({ id: m.id, type: m.type, machineId: m.machineId, lineId: m.lineId, areaId: m.areaId })),
    );

    return meters.map(m => {
      const summaryMtd = m.summaries.reduce((s, r) => s + r.totalConsumption, 0);
      const mtdConsumption = summaryMtd > 0 ? summaryMtd : (byMeter.get(m.id) ?? 0);
      const summaryCost = m.summaries.reduce((s, r) => s + (r.cost ?? 0), 0);
      const mtdCost = summaryCost > 0 ? summaryCost : mtdConsumption * (rates.get(m.id) ?? 0);
      return {
        id: m.id,
        meterNumber: m.meterNumber,
        name: m.name,
        type: m.type,
        unit: m.unit,
        brand: m.brand,
        location: m.location,
        machine: m.machine,
        area: m.area,
        model: m.model,
        templateKey: m.templateKey,
        device: m.device,
        online: !!m.device?.lastSeenAt && Date.now() - m.device.lastSeenAt.getTime() < 60_000 && m.device.status === 'CONNECTED',
        tagCount: m._count.tags,
        lastReading: m.readings[0] ?? null,
        ratePerUnit: rates.get(m.id) ?? null,
        mtdConsumption: parseFloat(mtdConsumption.toFixed(2)),
        mtdCost: parseFloat(mtdCost.toFixed(2)),
      };
    });
  }

  // ────────────────────────────────────────────────────────────
  // READINGS
  // ────────────────────────────────────────────────────────────

  async addReading(factoryId: string | null, dto: {
    meterId: string;
    value: number;
    timestamp?: string;
    source?: string;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const meter = await this.prisma.energyMeter.findFirst({
      where: { id: dto.meterId, ...factoryFilter },
    });
    if (!meter) throw new NotFoundException('Energy meter not found');

    return this.prisma.energyReading.create({
      data: {
        meterId: dto.meterId,
        factoryId: meter.factoryId,
        timestamp: dto.timestamp ? new Date(dto.timestamp) : new Date(),
        value: dto.value,
        unit: meter.unit,
        source: dto.source ?? 'MANUAL',
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // CONSUMPTION REPORT
  // ────────────────────────────────────────────────────────────

  async getConsumption(factoryId: string | null, filters: {
    from: string;
    to: string;
    periodType?: string;
    meterId?: string;
    areaId?: string;
    lineId?: string;
    machineId?: string;
  }) {
    const { from, to, periodType = 'DAILY', meterId, areaId, lineId, machineId } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};
    // Respect the active analysis scope by filtering on the summary's meter.
    const meterWhere = this.scopeMeterWhere({ areaId, lineId, machineId });
    const hasScope = Object.keys(meterWhere).length > 0;

    const summaries = await this.prisma.energySummary.findMany({
      where: {
        ...factoryFilter,
        periodType: periodType as EnergyPeriod,
        periodStart: { gte: new Date(from), lte: new Date(to) },
        ...(meterId && { meterId }),
        ...(hasScope ? { meter: meterWhere } : {}),
      },
      include: {
        meter: { select: { name: true, type: true, unit: true } },
      },
      orderBy: { periodStart: 'asc' },
    });

    // Aggregate by date for chart
    const byDate: Record<string, Record<string, number>> = {};
    for (const s of summaries) {
      const date = plantDayKey(s.periodStart);
      if (!byDate[date]) byDate[date] = {};
      const key = s.meter.type;
      byDate[date][key] = parseFloat(((byDate[date][key] ?? 0) + s.totalConsumption).toFixed(2));
    }

    // Fallback: when the rollup hasn't produced summaries yet, derive the daily chart
    // from raw EnergyReading deltas (same approach the overview KPIs use) so the trend
    // isn't blank while the overview shows consumption.
    if (summaries.length === 0) {
      const start = new Date(from);
      const end = new Date(to);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dStart = new Date(d); dStart.setHours(0, 0, 0, 0);
        const dEnd = new Date(d); dEnd.setHours(23, 59, 59, 999);
        const { byType } = await this.consumptionFromReadings(factoryId, meterWhere, dStart, dEnd);
        const dateKey = plantDayKey(dStart);
        for (const [type, val] of Object.entries(byType)) {
          if (val <= 0) continue;
          if (!byDate[dateKey]) byDate[dateKey] = {};
          byDate[dateKey][type] = parseFloat(((byDate[dateKey][type] ?? 0) + val).toFixed(2));
        }
      }
    }

    return {
      summaries,
      chart: Object.entries(byDate)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({ date: date.slice(5), ...values })),
    };
  }

  // ────────────────────────────────────────────────────────────
  // METER CRUD
  // ────────────────────────────────────────────────────────────

  /**
   * Create an energy meter. When `gatewayId` (or any Modbus connection info) is
   * supplied, also create + link a METER Device so the edge gateway polls it.
   * `templateKey` is stored; the gateway materializes the ENERGY tags from the
   * matching register-map template on its next reload.
   */
  async createMeter(factoryId: string | null, dto: {
    meterNumber: string; name: string; type: string; unit: string;
    location?: string; brand?: string; manufacturer?: string; model?: string; templateKey?: string;
    machineId?: string; lineId?: string; areaId?: string;
    gatewayId?: string; protocol?: string; ipAddress?: string; port?: number; unitId?: number;
    serialPort?: string; baudRate?: number; parity?: string; dataBits?: number; stopBits?: number;
    pollIntervalMs?: number;
  }) {
    const resolvedFactoryId = factoryId ?? await this.getDefaultFactoryId();

    // Derive areaId from the chosen scope so meters roll up consistently
    // (machine → line → area), matching Device/TagDefinition behavior.
    let { machineId, lineId, areaId } = dto;
    if (!areaId) {
      if (machineId) {
        const m = await this.prisma.machine.findUnique({ where: { id: machineId }, select: { lineId: true, areaId: true } });
        if (m) { areaId = m.areaId ?? undefined; if (!lineId) lineId = m.lineId ?? undefined; }
      } else if (lineId) {
        const l = await this.prisma.productionLine.findUnique({ where: { id: lineId }, select: { areaId: true } });
        if (l) areaId = l.areaId ?? undefined;
      }
    }

    // Optionally provision the comms device for edge polling.
    let deviceId: string | null = null;
    if (dto.gatewayId || dto.ipAddress || dto.serialPort) {
      const device = await this.prisma.device.create({
        data: {
          factoryId: resolvedFactoryId,
          gatewayId: dto.gatewayId || null,
          machineId: machineId || null,
          lineId: lineId || null,
          areaId: areaId || null,
          name: `${dto.name} (meter)`,
          deviceCode: `${dto.meterNumber}-DEV`,
          type: 'METER',
          protocol: dto.protocol ?? 'MODBUS',
          ipAddress: dto.ipAddress ?? null,
          port: dto.port ?? 502,
          unitId: dto.unitId ?? 1,
          serialPort: dto.serialPort ?? null,
          baudRate: dto.baudRate ?? null,
          parity: dto.parity ?? null,
          dataBits: dto.dataBits ?? null,
          stopBits: dto.stopBits ?? null,
          pollIntervalMs: dto.pollIntervalMs ?? null,
          status: 'DISCONNECTED',
        },
      });
      deviceId = device.id;
    }

    const meter = await this.prisma.energyMeter.create({
      data: {
        factoryId: resolvedFactoryId,
        deviceId,
        meterNumber: dto.meterNumber,
        name: dto.name,
        type: dto.type as any,
        unit: dto.unit,
        location: dto.location,
        brand: dto.brand,
        manufacturer: dto.manufacturer,
        model: dto.model,
        templateKey: dto.templateKey,
        machineId: machineId || null,
        lineId: lineId || null,
        areaId: areaId || null,
        isActive: true,
      },
    });

    // Materialize the meter's ENERGY tags from its register-map template now, so they
    // exist immediately on insert (the edge gateway also provisions them on reload as a
    // safety net — provisioning is idempotent by factoryId+code, so this never duplicates).
    if (dto.templateKey) {
      await this.provisionMeterTags(resolvedFactoryId, meter.id, deviceId, machineId || null, dto.meterNumber, dto.templateKey);
    }

    return meter;
  }

  /** Create a meter's ENERGY TagDefinitions from its template (idempotent). */
  private async provisionMeterTags(
    factoryId: string, meterId: string, deviceId: string | null,
    machineId: string | null, meterNumber: string, templateKey: string,
  ) {
    const specs = instantiateMeterTags(templateKey, meterNumber);
    for (const s of specs) {
      const exists = await this.prisma.tagDefinition.findFirst({ where: { factoryId, code: s.code } });
      if (exists) continue;
      await this.prisma.tagDefinition.create({
        data: {
          factoryId, meterId, deviceId, machineId,
          code: s.code, name: s.name, dataType: s.dataType as any, tagType: 'ENERGY',
          unit: s.unit, address: s.address, registerType: s.registerType,
          wordCount: s.wordCount, wordOrder: s.wordOrder, scaleFactor: s.scaleFactor,
          energyRole: s.energyRole,
        },
      });
    }
  }

  async updateMeter(factoryId: string | null, id: string, dto: {
    name?: string; type?: string; unit?: string; location?: string; brand?: string;
    manufacturer?: string; model?: string; templateKey?: string;
    ipAddress?: string; port?: number; unitId?: number; protocol?: string;
    serialPort?: string; baudRate?: number; parity?: string; dataBits?: number; stopBits?: number;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const meter = await this.prisma.energyMeter.findFirst({ where: { id, ...factoryFilter } });
    if (!meter) throw new NotFoundException('Energy meter not found');

    // Propagate connection changes to the linked device.
    if (meter.deviceId) {
      const devData: Record<string, unknown> = {};
      for (const k of ['protocol', 'ipAddress', 'port', 'unitId', 'serialPort', 'baudRate', 'parity', 'dataBits', 'stopBits'] as const) {
        if ((dto as any)[k] !== undefined) devData[k] = (dto as any)[k];
      }
      if (Object.keys(devData).length) await this.prisma.device.update({ where: { id: meter.deviceId }, data: devData });
    }

    return this.prisma.energyMeter.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.type && { type: dto.type as any }),
        ...(dto.unit && { unit: dto.unit }),
        ...(dto.location !== undefined && { location: dto.location }),
        ...(dto.brand !== undefined && { brand: dto.brand }),
        ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer }),
        ...(dto.model !== undefined && { model: dto.model }),
        ...(dto.templateKey !== undefined && { templateKey: dto.templateKey }),
      },
    });
  }

  /** Static list of built-in meter register-map templates (the gateway owns the maps). */
  getMeterTemplates() {
    return [
      { key: 'SCHNEIDER_PM5110', label: 'Schneider PowerLogic PM5110', manufacturer: 'Schneider Electric' },
      { key: 'SIEMENS_PAC3200', label: 'Siemens SENTRON PAC3200', manufacturer: 'Siemens' },
      { key: 'SIEMENS_PAC2200', label: 'Siemens SENTRON PAC2200', manufacturer: 'Siemens' },
      { key: 'GENERIC_PM', label: 'Generic 3-phase Power Meter', manufacturer: 'Generic' },
    ];
  }

  /**
   * Live power per meter + standby ("consuming with no production") detection.
   * For each in-scope meter: latest powerKw, machine state, whether any linked
   * machine has an EXECUTING Job Order, and a standby flag when power is drawn
   * with no active production. Powers the Energy → Live page.
   */
  async getLivePower(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ) {
    const IDLE_THRESHOLD_KW = 0.5;
    const meters = await this.prisma.energyMeter.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true, ...this.scopeMeterWhere(scope) },
      include: {
        machine: { select: { id: true, name: true, code: true, lineId: true, areaId: true, currentStatus: { select: { state: true } } } },
        line: { select: { id: true, name: true } },
        area: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });

    const items = await Promise.all(meters.map(async (m) => {
      const latest = await this.prisma.energyReading.findFirst({
        where: { meterId: m.id }, orderBy: { timestamp: 'desc' },
        select: { powerKw: true, value: true, timestamp: true, machineState: true },
      });
      const powerKw = latest?.powerKw ?? null;

      // Resolve scope target + whether production is active there.
      let scopeKind: 'machine' | 'line' | 'area' | 'factory' = 'factory';
      let scopeName = 'Factory';
      let state: string | null = null;
      const joWhere: any = { status: 'EXECUTING' };
      if (m.machineId && m.machine) {
        scopeKind = 'machine'; scopeName = m.machine.name; state = m.machine.currentStatus?.state ?? null;
        joWhere.machineId = m.machineId;
      } else if (m.lineId && m.line) {
        scopeKind = 'line'; scopeName = m.line.name; joWhere.machine = { lineId: m.lineId };
      } else if (m.areaId && m.area) {
        scopeKind = 'area'; scopeName = m.area.name; joWhere.machine = { areaId: m.areaId };
      }
      const executingJos = await this.prisma.jobOrder.count({ where: joWhere });
      const inProduction = executingJos > 0 || state === 'RUNNING';
      const standby = powerKw != null && powerKw > IDLE_THRESHOLD_KW && !inProduction;

      return {
        meterId: m.id, meterNumber: m.meterNumber, name: m.name, type: m.type, unit: m.unit,
        scopeKind, scopeName, machineState: state ?? latest?.machineState ?? null,
        powerKw, lastValue: latest?.value ?? null, lastAt: latest?.timestamp?.toISOString() ?? null,
        inProduction, executingJobOrders: executingJos, standby,
      };
    }));

    return {
      totalPowerKw: parseFloat(items.reduce((s, i) => s + (i.powerKw ?? 0), 0).toFixed(2)),
      standbyPowerKw: parseFloat(items.filter((i) => i.standby).reduce((s, i) => s + (i.powerKw ?? 0), 0).toFixed(2)),
      standbyCount: items.filter((i) => i.standby).length,
      meters: items,
    };
  }

  /** ENERGY tags belonging to a meter (separate from machine/production tags). */
  async getMeterTags(factoryId: string | null, meterId: string) {
    return this.prisma.tagDefinition.findMany({
      where: { ...(factoryId ? { factoryId } : {}), meterId, isActive: true },
      include: { currentValue: true },
      orderBy: { energyRole: 'asc' },
    });
  }

  async deleteMeter(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const meter = await this.prisma.energyMeter.findFirst({ where: { id, ...factoryFilter } });
    if (!meter) throw new NotFoundException('Energy meter not found');
    await this.prisma.energyMeter.update({ where: { id }, data: { isActive: false } });
  }

  // ────────────────────────────────────────────────────────────
  // TARIFF CRUD
  // ────────────────────────────────────────────────────────────

  async listTariffs(factoryId: string | null) {
    return this.prisma.energyTariff.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      include: {
        machine: { select: { id: true, name: true, code: true } },
        line: { select: { id: true, name: true } },
        area: { select: { id: true, name: true } },
      },
      orderBy: [{ energyType: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async createTariff(factoryId: string | null, dto: {
    energyType: string; ratePerUnit: number; currency?: string; label?: string;
    machineId?: string; lineId?: string; areaId?: string;
  }) {
    const resolvedFactoryId = factoryId ?? (await this.getDefaultFactoryId());
    return this.prisma.energyTariff.create({
      data: {
        factoryId: resolvedFactoryId,
        energyType: dto.energyType as any,
        ratePerUnit: dto.ratePerUnit,
        currency: dto.currency ?? 'SAR',
        label: dto.label ?? null,
        machineId: dto.machineId || null,
        lineId: dto.lineId || null,
        areaId: dto.areaId || null,
        isActive: true,
      },
    });
  }

  async updateTariff(factoryId: string | null, id: string, dto: {
    energyType?: string; ratePerUnit?: number; currency?: string; label?: string;
    machineId?: string | null; lineId?: string | null; areaId?: string | null;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const existing = await this.prisma.energyTariff.findFirst({ where: { id, ...factoryFilter } });
    if (!existing) throw new NotFoundException('Tariff not found');
    return this.prisma.energyTariff.update({
      where: { id },
      data: {
        ...(dto.energyType && { energyType: dto.energyType as any }),
        ...(dto.ratePerUnit != null && { ratePerUnit: dto.ratePerUnit }),
        ...(dto.currency && { currency: dto.currency }),
        ...(dto.label !== undefined && { label: dto.label }),
        ...(dto.machineId !== undefined && { machineId: dto.machineId || null }),
        ...(dto.lineId !== undefined && { lineId: dto.lineId || null }),
        ...(dto.areaId !== undefined && { areaId: dto.areaId || null }),
      },
    });
  }

  async deleteTariff(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const existing = await this.prisma.energyTariff.findFirst({ where: { id, ...factoryFilter } });
    if (!existing) throw new NotFoundException('Tariff not found');
    await this.prisma.energyTariff.update({ where: { id }, data: { isActive: false } });
  }

  private async getDefaultFactoryId(): Promise<string> {
    const factory = await this.prisma.factory.findFirst({ where: { isActive: true } });
    if (!factory) throw new NotFoundException('No active factory found');
    return factory.id;
  }
}
