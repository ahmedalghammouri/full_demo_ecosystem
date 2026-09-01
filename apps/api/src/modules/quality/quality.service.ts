import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { plantBound } from '../../common/plant-time.util';
import { PrismaService } from '../../database/prisma.service';
import { sumInPieces } from '../../common/units.util';
import { NCRStatus, Severity, type Prisma } from '@prisma/client';
import { archivedWhere } from '../../common/archive.util';
import {
  NCR_TRANSITIONS,
  type CreateInspectionDto,
  type UpdateInspectionDto,
  type CreateNCRDto,
  type UpdateNCRDto,
  type UpdateNCRStatusDto,
  type CreateCAPADto,
  type UpdateCAPADto,
  type AddCAPAActionDto,
  type VerifyCAPADto,
  type CreateQualityPlanDto,
  type UpdateQualityPlanDto,
  type CreateQualityParameterDto,
  type UpdateQualityParameterDto,
} from './dto/quality.dto';

@Injectable()
export class QualityService {
  private readonly logger = new Logger(QualityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ────────────────────────────────────────────────────────────
  // KPIs
  // ────────────────────────────────────────────────────────────

  /** Resolve an analysis scope (area/line/machine) to the machine ids it covers (undefined = whole factory). */
  private async scopeMachineIds(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ): Promise<string[] | undefined> {
    if (!scope || (!scope.areaId && !scope.lineId && !scope.machineId)) return undefined;
    if (scope.machineId) return [scope.machineId];
    const ms = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(scope.lineId ? { lineId: scope.lineId } : {}),
        ...(scope.areaId ? { line: { areaId: scope.areaId } } : {}),
      },
      select: { id: true },
    });
    return ms.map((m) => m.id);
  }

  async getKPIs(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ) {
    const now = new Date();
    // NOTE: setHours MUTATES `now`, so capture the instant first.
    const dayEnd = new Date(now.getTime());
    const dayStart = new Date(now.setHours(0, 0, 0, 0));
    const factoryFilter = factoryId ? { factoryId } : {};
    // Scope (area/line/machine) → machine-id filter applied to every machine-bound metric.
    const machineIds = await this.scopeMachineIds(factoryId, scope);
    const machineScope = machineIds ? { machineId: { in: machineIds } } : {};

    const [inspections, openNCRs, criticalNCRs, totalCAPAs, openCAPAs, prodToday, cpk] = await Promise.all([
      this.prisma.inspectionResult.findMany({
        where: { ...factoryFilter, ...machineScope, inspectedAt: { gte: dayStart } },
      }),
      this.prisma.nCR.count({ where: { ...factoryFilter, ...machineScope, status: NCRStatus.OPEN } }),
      this.prisma.nCR.count({
        where: { ...factoryFilter, ...machineScope, status: NCRStatus.OPEN, severity: Severity.CRITICAL },
      }),
      this.prisma.cAPA.count({ where: { ...factoryFilter } }),
      this.prisma.cAPA.count({ where: { ...factoryFilter, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      // Real scrap rate from production (job orders started today), not a placeholder.
      //
      // A Prisma `_sum` CANNOT be used here: routing steps count in different units
      // (inners at the filler, cartons at the cartoner, pallets at the palletiser)
      // and the database cannot convert them — it would add unlike quantities and
      // report a scrap rate that is simply wrong. Rows are fetched with their unit
      // and summed in pieces instead.
      this.prisma.jobOrder.findMany({
        // Overlap, not "started today": a job order that began yesterday and is still
        // running is today's production, and asking only for today's starts returned
        // nothing on a line running a multi-day order.
        where: {
          ...factoryFilter, ...machineScope,
          AND: [
            { actualStart: { lte: dayEnd } },
            { OR: [{ actualEnd: null }, { actualEnd: { gte: dayStart } }] },
          ],
        },
        select: {
          actualQtyGood: true, actualQtyRejected: true, outputUnit: true,
          // Needed to pick the FINAL step per work order — see below.
          workOrderId: true, sequenceOrder: true,
          workOrder: { select: { sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } } } },
        },
      }),
      this.computeCpk(factoryId, dayStart, machineIds),
    ]);

    const totalInspected = inspections.reduce((s, i) => s + i.totalQty, 0);
    const totalPassed = inspections.reduce((s, i) => s + i.passQty, 0);
    const fpy = totalInspected > 0 ? (totalPassed / totalInspected) * 100 : 0;
    const reworkQty = inspections.reduce((s, i) => s + i.failQty, 0);

    // GOOD is the FINAL routing step of each work order — what actually left the
    // line. Summing good across every step counted the same physical bag once at the
    // filler, again at the checkweigher, again at the cartoner, and so on: five steps
    // turned 1,920 real units into 10,128, inflating the denominator and understating
    // the scrap rate roughly fivefold.
    //
    // SCRAP is the opposite: a unit can be lost at ANY step, and a bag rejected at the
    // filler never reaches the palletiser to be counted again. So scrap sums across
    // all steps while good does not.
    const finalSteps = [...prodToday
      .reduce((m, j) => {
        const k = j.workOrderId ?? '__standalone';
        const cur = m.get(k);
        if (!cur || j.sequenceOrder > cur.sequenceOrder) m.set(k, j);
        return m;
      }, new Map<string, (typeof prodToday)[number]>())
      .values()];

    const good = sumInPieces(finalSteps, (j) => j.actualQtyGood, (j) => j.outputUnit, (j) => j.workOrder?.sku ?? null).pieces;
    const rejected = sumInPieces(prodToday, (j) => j.actualQtyRejected, (j) => j.outputUnit, (j) => j.workOrder?.sku ?? null).pieces;
    const producedTotal = good + rejected;

    return {
      fpy: parseFloat(fpy.toFixed(1)),
      passRate: parseFloat(fpy.toFixed(1)),
      // Defect Rate is the exact complement of FPY over the same inspected quantity —
      // exposed explicitly so every quality surface binds to one field instead of
      // re-deriving it (or falling back to the OEE quality factor, which is not the same).
      defectRate: totalInspected > 0 ? parseFloat((100 - fpy).toFixed(1)) : 0,
      defectPpm: totalInspected > 0 ? Math.round((reworkQty / totalInspected) * 1_000_000) : 0,
      totalInspected,
      totalPassed,
      totalFailed: reworkQty,
      reworkRate: totalInspected > 0 ? parseFloat(((reworkQty / totalInspected) * 100).toFixed(1)) : 0,
      scrapRate: producedTotal > 0 ? parseFloat(((rejected / producedTotal) * 100).toFixed(1)) : 0,
      openNCRs,
      criticalNCRs,
      openCAPAs,
      capaComplianceRate: totalCAPAs > 0
        ? parseFloat((((totalCAPAs - openCAPAs) / totalCAPAs) * 100).toFixed(1))
        : 100,
      inspectionsToday: inspections.length,
      cpk, // real Cpk from SPC measurements with spec limits, or null when not measurable
    };
  }

  /**
   * Quality Intelligence cockpit — the native quality command-center payload. Composes
   * the day KPIs with a windowed FPY trend, a defect Pareto (NCR by category), NCR
   * severity + status mix, inspection-outcome mix and the CAPA funnel. Scope-aware.
   */
  async getQualityCockpit(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
    range?: { dateFrom?: string; dateTo?: string },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machineIds = await this.scopeMachineIds(factoryId, scope);
    const machineScope = machineIds ? { machineId: { in: machineIds } } : {};

    const now = new Date();
    const to = plantBound(range?.dateTo, 'end') ?? now;
    const from = range?.dateFrom
      ? (plantBound(range.dateFrom, 'start') as Date)
      : new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
    const spanMs = Math.max(to.getTime() - from.getTime(), 86_400_000);
    const multiDay = spanMs > 36 * 3_600_000;
    const r1 = (n: number) => Math.round(n * 10) / 10;

    const [kpis, inspections, ncrs, capaGroups] = await Promise.all([
      this.getKPIs(factoryId, scope),
      this.prisma.inspectionResult.findMany({
        where: { ...factoryFilter, ...machineScope, inspectedAt: { gte: from, lte: to } },
        select: { inspectedAt: true, totalQty: true, passQty: true, failQty: true, result: true },
      }),
      this.prisma.nCR.findMany({
        where: { ...factoryFilter, ...machineScope, detectedAt: { gte: from, lte: to } },
        select: { defectCategory: true, severity: true, status: true, quantity: true },
      }),
      this.prisma.cAPA.groupBy({ by: ['status'], where: { ...factoryFilter }, _count: { _all: true } }),
    ]);

    // FPY trend, bucketed by day (or hour for same-day windows).
    const buckets: { start: number; label: string; pass: number; total: number }[] = [];
    {
      const step = multiDay ? 86_400_000 : 3_600_000;
      const d = new Date(from);
      if (multiDay) d.setHours(0, 0, 0, 0); else d.setMinutes(0, 0, 0);
      while (d.getTime() <= to.getTime() && buckets.length < 90) {
        buckets.push({
          start: d.getTime(),
          label: multiDay ? `${d.getMonth() + 1}/${d.getDate()}` : `${d.getHours()}:00`,
          pass: 0, total: 0,
        });
        d.setTime(d.getTime() + step);
      }
    }
    const stepMs = multiDay ? 86_400_000 : 3_600_000;
    for (const i of inspections) {
      const t = i.inspectedAt.getTime();
      const b = buckets.find((x) => t >= x.start && t < x.start + stepMs);
      if (b) { b.pass += i.passQty; b.total += i.totalQty; }
    }
    const fpyTrend = buckets.map((b) => ({ time: b.label, fpy: b.total > 0 ? r1((b.pass / b.total) * 100) : 0 }));

    // Defect Pareto from NCR (by category, weighted by affected quantity).
    const byCat: Record<string, { quantity: number; count: number }> = {};
    for (const n of ncrs) {
      const key = n.defectCategory || 'OTHER';
      if (!byCat[key]) byCat[key] = { quantity: 0, count: 0 };
      byCat[key].quantity += n.quantity ?? 0;
      byCat[key].count += 1;
    }
    const sortedCats = Object.entries(byCat)
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.quantity - a.quantity);
    const totalQty = sortedCats.reduce((s, c) => s + c.quantity, 0);
    let cum = 0;
    const defectPareto = sortedCats.map((c) => {
      cum += c.quantity;
      return { ...c, cumulative: totalQty > 0 ? Math.round((cum / totalQty) * 100) : 0 };
    });

    // NCR severity + status mix.
    const sevOrder: Severity[] = [Severity.CRITICAL, Severity.MAJOR, Severity.MINOR];
    const ncrBySeverity = sevOrder.map((s) => ({ severity: s, count: ncrs.filter((n) => n.severity === s).length }));
    const ncrByStatus = Object.values(NCRStatus).map((s) => ({ status: s, count: ncrs.filter((n) => n.status === s).length }));

    // Inspection-outcome mix.
    const inspectionByResult = ['PASS', 'CONDITIONAL', 'FAIL', 'PENDING'].map((res) => ({
      result: res, count: inspections.filter((i) => i.result === res).length,
    }));

    return {
      scope: scope && (scope.areaId || scope.lineId || scope.machineId) ? scope : null,
      kpis,
      fpyTrend,
      defectPareto,
      ncrBySeverity,
      ncrByStatus,
      inspectionByResult,
      capaByStatus: capaGroups.map((g) => ({ status: g.status, count: g._count._all })),
      generatedAt: now.toISOString(),
    };
  }

  /**
   * Process-capability index from today's SPC measurements that carry spec limits.
   * Cpk = min((USL−µ)/3σ, (µ−LSL)/3σ). Returns null when there is not enough data
   * (≥2 samples with a non-zero σ) — the UI then renders "—" instead of a fake value.
   */
  private async computeCpk(factoryId: string | null, since: Date, machineIds?: string[]): Promise<number | null> {
    const rows = await this.prisma.sPCMeasurement.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(machineIds ? { machineId: { in: machineIds } } : {}),
        measuredAt: { gte: since },
        usl: { not: null },
        lsl: { not: null },
      },
      select: { value: true, usl: true, lsl: true },
    });
    if (rows.length < 2) return null;
    const vals = rows.map((r) => r.value);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1);
    const sigma = Math.sqrt(variance);
    if (sigma <= 0) return null;
    // Use the average spec band across samples (parameters may differ; this is an aggregate).
    const usl = rows.reduce((s, r) => s + (r.usl ?? 0), 0) / rows.length;
    const lsl = rows.reduce((s, r) => s + (r.lsl ?? 0), 0) / rows.length;
    const cpk = Math.min((usl - mean) / (3 * sigma), (mean - lsl) / (3 * sigma));
    return parseFloat(cpk.toFixed(2));
  }

  // ────────────────────────────────────────────────────────────
  // INSPECTIONS
  // ────────────────────────────────────────────────────────────

  async createInspection(factoryId: string | null, userId: string, dto: CreateInspectionDto) {
    const factoryFilter = factoryId ? { factoryId } : {};

    // Validate references
    if (dto.workOrderId) {
      const wo = await this.prisma.workOrder.findFirst({ where: { id: dto.workOrderId, ...factoryFilter } });
      if (!wo) throw new NotFoundException('Work order not found');
    }
    if (dto.machineId) {
      const m = await this.prisma.machine.findFirst({ where: { id: dto.machineId, ...factoryFilter } });
      if (!m) throw new NotFoundException('Machine not found');
    }

    const resolvedFactoryId = await this.resolveFactoryId(factoryId, dto.machineId, dto.workOrderId);
    const inspectionNumber = await this.generateInspectionNumber(resolvedFactoryId);

    const failQty = dto.failQty ?? (dto.totalQty - dto.passQty);
    const result = failQty === 0 ? 'PASS' : dto.passQty === 0 ? 'FAIL' : 'CONDITIONAL';

    const inspection = await this.prisma.inspectionResult.create({
      data: {
        factoryId: resolvedFactoryId,
        planId: dto.planId,
        workOrderId: dto.workOrderId,
        batchRecordId: dto.batchRecordId,
        machineId: dto.machineId,
        inspectionNumber,
        type: dto.type as any,
        result: result as any,
        totalQty: dto.totalQty,
        passQty: dto.passQty,
        failQty,
        measurements: dto.measurements as unknown as Prisma.InputJsonValue ?? undefined,
        inspectorId: userId,
        inspectedAt: dto.inspectedAt ? new Date(dto.inspectedAt) : new Date(),
        notes: dto.notes,
      },
      include: {
        inspector: { select: { name: true } },
        plan: { select: { name: true, code: true } },
        workOrder: { select: { orderNumber: true } },
        machine: { select: { name: true, code: true } },
      },
    });

    // Feed the SPC charts: turn each numeric parameter reading into an
    // SPCMeasurement row (with the plan's control/spec limits). Best-effort —
    // never let SPC bookkeeping break inspection creation.
    try {
      await this.syncSpcFromInspection({
        factoryId: resolvedFactoryId,
        userId,
        planId: dto.planId,
        machineId: dto.machineId,
        workOrderId: dto.workOrderId,
        measuredAt: inspection.inspectedAt,
        measurements: dto.measurements ?? [],
      });
    } catch (e) {
      this.logger.warn(`SPC sync skipped for ${inspectionNumber}: ${(e as Error).message}`);
    }

    this.eventEmitter.emit('quality.inspection.created', {
      inspection,
      factoryId: resolvedFactoryId,
      result,
    });

    // Auto-create NCR if FAIL
    if (result === 'FAIL') {
      this.logger.warn(`Inspection ${inspectionNumber} FAILED — auto-NCR trigger recommended`);
      this.eventEmitter.emit('quality.inspection.failed', { inspection, factoryId: resolvedFactoryId });
    }

    return inspection;
  }

  /**
   * Project an inspection's parameter readings into the SPCMeasurement table so
   * the SPC control charts have data. Resolves a machine (required by the SPC
   * model) from the inspection or, failing that, the work order's job orders,
   * and stamps each point with the quality plan's control/spec limits.
   */
  private async syncSpcFromInspection(args: {
    factoryId: string;
    userId: string | null;
    planId?: string | null;
    machineId?: string | null;
    workOrderId?: string | null;
    measuredAt: Date;
    measurements: Array<{ parameterId?: string; parameterName?: string; value?: number; unit?: string; subgroupNumber?: number }>;
  }) {
    const numeric = (args.measurements ?? []).filter((m) => m && typeof m.value === 'number' && !isNaN(m.value as number));
    if (numeric.length === 0) return;

    // SPCMeasurement.machineId is required — resolve one or skip.
    let machineId = args.machineId ?? null;
    if (!machineId && args.workOrderId) {
      const jo = await this.prisma.jobOrder.findFirst({
        where: { workOrderId: args.workOrderId, machineId: { not: null } },
        select: { machineId: true },
        orderBy: { sequenceOrder: 'asc' },
      });
      machineId = jo?.machineId ?? null;
    }
    if (!machineId) return; // SPC is machine-bound; nothing we can attribute it to.

    // Pull the plan's parameter limits, keyed by id and by name (measurements may carry either).
    const params = args.planId
      ? await this.prisma.qualityParameter.findMany({ where: { planId: args.planId } })
      : [];
    const byId = new Map(params.map((p) => [p.id, p]));
    const byName = new Map(params.map((p) => [p.name, p]));

    const rows = numeric.map((m) => {
      const p = (m.parameterId && byId.get(m.parameterId)) || (m.parameterName && byName.get(m.parameterName)) || null;
      const value = m.value as number;
      const ucl = p?.ucl ?? null;
      const lcl = p?.lcl ?? null;
      const outOfControl = (ucl != null && value > ucl) || (lcl != null && value < lcl);
      return {
        factoryId: args.factoryId,
        machineId: machineId as string,
        parameterName: m.parameterName ?? p?.name ?? 'Parameter',
        parameterUnit: m.unit ?? p?.unit ?? null,
        value,
        subgroupNumber: m.subgroupNumber ?? null,
        workOrderId: args.workOrderId ?? null,
        measuredAt: args.measuredAt,
        measuredById: args.userId ?? null,
        isOutOfControl: outOfControl,
        controlViolation: outOfControl ? 'RULE_1' : null,
        ucl,
        lcl,
        cl: p?.nominalValue ?? null,
        usl: p?.usl ?? null,
        lsl: p?.lsl ?? null,
      };
    });

    await this.prisma.sPCMeasurement.createMany({ data: rows });
  }

  /**
   * Quick SPC entry (SPC page / Quality Floor) — record one or more readings for a
   * machine directly, without a full inspection. Reuses the same control/spec-limit
   * stamping + out-of-control flagging as inspection-driven SPC.
   */
  async recordSpcMeasurements(
    factoryId: string | null,
    userId: string | null,
    dto: { machineId: string; planId?: string; workOrderId?: string; measuredAt?: string; measurements: any[] },
  ) {
    const resolvedFactoryId = await this.resolveFactoryId(factoryId, dto.machineId, dto.workOrderId);
    const numeric = (dto.measurements ?? []).filter((m) => m && typeof m.value === 'number' && !isNaN(m.value));
    if (numeric.length === 0) return { recorded: 0 };
    const before = await this.prisma.sPCMeasurement.count({ where: { factoryId: resolvedFactoryId } });
    await this.syncSpcFromInspection({
      factoryId: resolvedFactoryId,
      userId,
      planId: dto.planId,
      machineId: dto.machineId,
      workOrderId: dto.workOrderId,
      measuredAt: dto.measuredAt ? new Date(dto.measuredAt) : new Date(),
      measurements: numeric,
    });
    const after = await this.prisma.sPCMeasurement.count({ where: { factoryId: resolvedFactoryId } });
    return { recorded: after - before };
  }

  async getInspectionById(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const inspection = await this.prisma.inspectionResult.findFirst({
      where: { id, ...factoryFilter },
      include: {
        inspector: { select: { id: true, name: true } },
        plan: { include: { parameters: true } },
        workOrder: { select: { id: true, orderNumber: true, status: true } },
        machine: { select: { id: true, name: true, code: true } },
        batchRecord: { select: { id: true, batchNumber: true } },
      },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');
    return inspection;
  }

  async updateInspection(factoryId: string | null, id: string, dto: UpdateInspectionDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const inspection = await this.prisma.inspectionResult.findFirst({
      where: { id, ...factoryFilter },
    });
    if (!inspection) throw new NotFoundException('Inspection not found');

    // Validate any reassigned references stay within the factory.
    if (dto.workOrderId) {
      const wo = await this.prisma.workOrder.findFirst({ where: { id: dto.workOrderId, ...factoryFilter } });
      if (!wo) throw new NotFoundException('Work order not found');
    }
    if (dto.machineId) {
      const m = await this.prisma.machine.findFirst({ where: { id: dto.machineId, ...factoryFilter } });
      if (!m) throw new NotFoundException('Machine not found');
    }
    if (dto.planId) {
      const p = await this.prisma.qualityPlan.findFirst({ where: { id: dto.planId, ...factoryFilter } });
      if (!p) throw new NotFoundException('Quality plan not found');
    }
    if (dto.batchRecordId) {
      const b = await this.prisma.batchRecord.findFirst({ where: { id: dto.batchRecordId, ...factoryFilter } });
      if (!b) throw new NotFoundException('Batch record not found');
    }

    const passQty = dto.passQty ?? inspection.passQty;
    const failQty = dto.failQty ?? inspection.failQty;
    const autoResult = failQty === 0 ? 'PASS' : passQty === 0 ? 'FAIL' : 'CONDITIONAL';

    return this.prisma.inspectionResult.update({
      where: { id },
      data: {
        ...(dto.type && { type: dto.type as any }),
        ...(dto.planId !== undefined && { planId: dto.planId }),
        ...(dto.workOrderId !== undefined && { workOrderId: dto.workOrderId }),
        ...(dto.batchRecordId !== undefined && { batchRecordId: dto.batchRecordId }),
        ...(dto.machineId !== undefined && { machineId: dto.machineId }),
        ...(dto.totalQty !== undefined && { totalQty: dto.totalQty }),
        ...(dto.inspectedAt && { inspectedAt: new Date(dto.inspectedAt) }),
        ...(dto.result && { result: dto.result as any }),
        ...(!dto.result && { result: autoResult as any }),
        ...(dto.passQty !== undefined && { passQty }),
        ...(dto.failQty !== undefined && { failQty }),
        ...(dto.measurements && { measurements: dto.measurements as unknown as Prisma.InputJsonValue }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: {
        inspector: { select: { name: true } },
        plan: { select: { name: true, code: true } },
        workOrder: { select: { orderNumber: true } },
        machine: { select: { name: true, code: true } },
      },
    });
  }

  async findInspections(factoryId: string | null, filters: {
    search?: string;
    type?: string;
    result?: string;
    workOrderId?: string;
    productionOrderId?: string;
    machineId?: string;
    areaId?: string;
    lineId?: string;
    dateFrom?: string;
    dateTo?: string;
    archived?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, type, result, workOrderId, productionOrderId, dateFrom, dateTo, archived, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};
    const machineIds = await this.qualityScopeMachineIds(factoryId, filters);

    // Work-order filter: explicit WO, else all WOs under the selected PO.
    let woFilter: any = {};
    if (workOrderId) woFilter = { workOrderId };
    else if (productionOrderId) {
      const wos = await this.prisma.workOrder.findMany({ where: { productionOrderId, ...factoryFilter }, select: { id: true } });
      woFilter = { workOrderId: { in: wos.map((w) => w.id) } };
    }

    const where: any = {
      ...archivedWhere(archived),
      ...factoryFilter,
      ...(type && { type }),
      ...(result && { result }),
      ...woFilter,
      ...(machineIds ? { machineId: { in: machineIds } } : {}),
      // Single combined date range (the previous two spreads overwrote each other).
      ...((dateFrom || dateTo) ? {
        inspectedAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo.length <= 10 ? `${dateTo}T23:59:59.999` : dateTo) } : {}),
        },
      } : {}),
      ...(search && {
        OR: [
          { inspectionNumber: { contains: search, mode: 'insensitive' } },
          { machine: { name: { contains: search, mode: 'insensitive' } } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.inspectionResult.count({ where }),
      this.prisma.inspectionResult.findMany({
        where,
        include: {
          inspector: { select: { name: true } },
          plan: { select: { name: true, code: true } },
          workOrder: { select: { orderNumber: true } },
          machine: { select: { name: true, code: true } },
        },
        orderBy: { inspectedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((i) => ({
        id: i.id,
        inspectionNumber: i.inspectionNumber,
        type: i.type,
        result: i.result,
        inspector: i.inspector.name,
        machine: i.machine?.name ?? null,
        workOrder: (i as any).workOrder?.orderNumber ?? null,
        planName: i.plan?.name ?? null,
        date: i.inspectedAt.toISOString(),
        passQty: i.passQty,
        failQty: i.failQty,
        totalQty: i.totalQty,
        archivedAt: (i as any).archivedAt ?? null,
        fpy: i.totalQty > 0 ? parseFloat(((i.passQty / i.totalQty) * 100).toFixed(1)) : 0,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ────────────────────────────────────────────────────────────
  // NCRs
  // ────────────────────────────────────────────────────────────

  async createNCR(factoryId: string | null, userId: string, dto: CreateNCRDto) {
    const resolvedFactoryId = await this.resolveFactoryId(factoryId, dto.machineId);
    const ncrNumber = await this.generateNCRNumber(resolvedFactoryId);

    const ncr = await this.prisma.nCR.create({
      data: {
        factoryId: resolvedFactoryId,
        ncrNumber,
        title: dto.title,
        description: dto.description,
        severity: dto.severity as Severity,
        status: 'OPEN',
        skuId: dto.skuId,
        batchRecordId: dto.batchRecordId,
        machineId: dto.machineId,
        defectCategory: dto.defectCategory,
        defectCode: dto.defectCode,
        quantity: dto.quantity,
        disposition: dto.disposition,
        detectedById: userId,
        detectedAt: new Date(dto.detectedAt),
        dueDate: new Date(dto.dueDate),
      },
      include: {
        detectedBy: { select: { name: true } },
      },
    });

    this.eventEmitter.emit('quality.ncr.created', {
      ncr,
      factoryId: resolvedFactoryId,
    });

    if (dto.severity === 'CRITICAL') {
      this.eventEmitter.emit('quality.ncr.critical', { ncr, factoryId: resolvedFactoryId });
    }

    this.logger.log(`NCR ${ncrNumber} created (${dto.severity})`);
    return ncr;
  }

  async getNCRById(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const ncr = await this.prisma.nCR.findFirst({
      where: { id, ...factoryFilter },
      include: {
        detectedBy: { select: { id: true, name: true } },
        capas: {
          include: {
            assignedTo: { select: { name: true } },
            actions: true,
          },
        },
      },
    });
    if (!ncr) throw new NotFoundException('NCR not found');

    // Resolve the scalar machine/batch/sku ids to display objects (no relations on NCR).
    const [machine, batchRecord, sku] = await Promise.all([
      ncr.machineId ? this.prisma.machine.findUnique({ where: { id: ncr.machineId }, select: { id: true, name: true, code: true } }) : null,
      ncr.batchRecordId ? this.prisma.batchRecord.findUnique({ where: { id: ncr.batchRecordId }, select: { id: true, batchNumber: true } }) : null,
      ncr.skuId ? this.prisma.sKU.findUnique({ where: { id: ncr.skuId }, select: { id: true, name: true, code: true } }) : null,
    ]);
    return { ...ncr, machine, batchRecord, sku };
  }

  async updateNCR(factoryId: string | null, id: string, dto: UpdateNCRDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const ncr = await this.prisma.nCR.findFirst({ where: { id, ...factoryFilter } });
    if (!ncr) throw new NotFoundException('NCR not found');
    if (ncr.status === 'CLOSED') throw new BadRequestException('Cannot update a closed NCR');

    // Validate any reassigned references stay within the factory.
    if (dto.machineId) {
      const m = await this.prisma.machine.findFirst({ where: { id: dto.machineId, ...factoryFilter } });
      if (!m) throw new NotFoundException('Machine not found');
    }
    if (dto.skuId) {
      const s = await this.prisma.sKU.findFirst({ where: { id: dto.skuId, ...factoryFilter } });
      if (!s) throw new NotFoundException('SKU not found');
    }
    if (dto.batchRecordId) {
      const b = await this.prisma.batchRecord.findFirst({ where: { id: dto.batchRecordId, ...factoryFilter } });
      if (!b) throw new NotFoundException('Batch record not found');
    }

    return this.prisma.nCR.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(dto.description && { description: dto.description }),
        ...(dto.severity && { severity: dto.severity as Severity }),
        ...(dto.skuId !== undefined && { skuId: dto.skuId }),
        ...(dto.batchRecordId !== undefined && { batchRecordId: dto.batchRecordId }),
        ...(dto.machineId !== undefined && { machineId: dto.machineId }),
        ...(dto.defectCategory && { defectCategory: dto.defectCategory }),
        ...(dto.defectCode !== undefined && { defectCode: dto.defectCode }),
        ...(dto.quantity !== undefined && { quantity: dto.quantity }),
        ...(dto.detectedAt && { detectedAt: new Date(dto.detectedAt) }),
        ...(dto.disposition && { disposition: dto.disposition }),
        ...(dto.rootCause !== undefined && { rootCause: dto.rootCause }),
        ...(dto.correctiveAction !== undefined && { correctiveAction: dto.correctiveAction }),
        ...(dto.preventiveAction !== undefined && { preventiveAction: dto.preventiveAction }),
        ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
      },
      include: { detectedBy: { select: { name: true } } },
    });
  }

  async updateNCRStatus(factoryId: string | null, id: string, userId: string, dto: UpdateNCRStatusDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const ncr = await this.prisma.nCR.findFirst({ where: { id, ...factoryFilter } });
    if (!ncr) throw new NotFoundException('NCR not found');

    const allowed = NCR_TRANSITIONS[ncr.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition NCR from ${ncr.status} to ${dto.status}. Allowed: [${allowed.join(', ')}]`,
      );
    }

    const updates: any = { status: dto.status };
    if (dto.status === 'RESOLVED') {
      updates.resolvedAt = new Date();
      updates.resolvedById = userId;
    }
    if (dto.status === 'CLOSED') {
      updates.closedAt = new Date();
      updates.closedById = userId;
    }

    const updated = await this.prisma.nCR.update({ where: { id }, data: updates });

    this.eventEmitter.emit('quality.ncr.status-changed', {
      ncrId: id,
      ncrNumber: ncr.ncrNumber,
      from: ncr.status,
      to: dto.status,
      factoryId: ncr.factoryId,
    });

    return updated;
  }

  async findNCRs(factoryId: string | null, filters: {
    search?: string;
    status?: string;
    severity?: string;
    dateFrom?: string;
    dateTo?: string;
    machineId?: string;
    areaId?: string;
    lineId?: string;
    skuId?: string;
    archived?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, severity, dateFrom, dateTo, skuId, archived, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};
    const scopeMachineIds = await this.qualityScopeMachineIds(factoryId, filters);

    // `status` may be a single value or a comma-separated list (e.g. the CAPA
    // dialog requests OPEN,IN_REVIEW,CAPA_PENDING for its "Related NCR" picker).
    const statusList = status ? status.split(',').map((s) => s.trim()).filter(Boolean) : [];
    const where: any = {
      ...archivedWhere(archived),
      ...factoryFilter,
      ...(statusList.length === 1 && { status: statusList[0] as NCRStatus }),
      ...(statusList.length > 1 && { status: { in: statusList as NCRStatus[] } }),
      ...(severity && { severity: severity as Severity }),
      ...(scopeMachineIds ? { machineId: { in: scopeMachineIds } } : {}),
      ...(skuId ? { skuId } : {}),
      // Single combined detected-at range (the previous spreads overwrote each other).
      ...((dateFrom || dateTo) ? {
        detectedAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo.length <= 10 ? `${dateTo}T23:59:59.999` : dateTo) } : {}),
        },
      } : {}),
      ...(search && {
        OR: [
          { ncrNumber: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
          { description: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.nCR.count({ where }),
      this.prisma.nCR.findMany({
        where,
        include: {
          detectedBy: { select: { name: true } },
          capas: { select: { id: true, status: true } },
        },
        orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // NCR keeps machine/batch/sku as scalar ids (no relations) — resolve their
    // display names in one batch each so the register table isn't full of blanks.
    const machineIds = [...new Set(data.map((n) => n.machineId).filter(Boolean) as string[])];
    const batchIds = [...new Set(data.map((n) => n.batchRecordId).filter(Boolean) as string[])];
    const skuIds = [...new Set(data.map((n) => n.skuId).filter(Boolean) as string[])];
    const [machines, batches, skus] = await Promise.all([
      machineIds.length ? this.prisma.machine.findMany({ where: { id: { in: machineIds } }, select: { id: true, name: true, code: true } }) : [],
      batchIds.length ? this.prisma.batchRecord.findMany({ where: { id: { in: batchIds } }, select: { id: true, batchNumber: true } }) : [],
      skuIds.length ? this.prisma.sKU.findMany({ where: { id: { in: skuIds } }, select: { id: true, name: true, code: true } }) : [],
    ]);
    const machineMap = new Map(machines.map((m) => [m.id, m]));
    const batchMap = new Map(batches.map((b) => [b.id, b]));
    const skuMap = new Map(skus.map((s) => [s.id, s]));

    return {
      data: data.map((n: any) => ({
        ...n,
        machine: n.machineId ? machineMap.get(n.machineId) ?? null : null,
        batchRecord: n.batchRecordId ? batchMap.get(n.batchRecordId) ?? null : null,
        sku: n.skuId ? skuMap.get(n.skuId) ?? null : null,
        // The web table reads `reportedAt`; the model stores it as `detectedAt`.
        reportedAt: n.detectedAt?.toISOString?.() ?? n.detectedAt,
        capaCount: n.capas.length,
        openCAPAs: n.capas.filter((c: any) => ['OPEN', 'IN_PROGRESS'].includes(c.status)).length,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ────────────────────────────────────────────────────────────
  // CAPAs
  // ────────────────────────────────────────────────────────────

  async createCAPA(factoryId: string | null, userId: string, dto: CreateCAPADto) {
    const factoryFilter = factoryId ? { factoryId } : {};

    let resolvedFactoryId = factoryId;

    if (dto.ncrId) {
      const ncr = await this.prisma.nCR.findFirst({ where: { id: dto.ncrId, ...factoryFilter } });
      if (!ncr) throw new NotFoundException('NCR not found');
      resolvedFactoryId = ncr.factoryId;

      // Transition NCR to CAPA_PENDING
      if (ncr.status === 'IN_REVIEW' || ncr.status === 'OPEN') {
        await this.prisma.nCR.update({
          where: { id: dto.ncrId },
          data: { status: 'CAPA_PENDING' },
        });
      }
    }

    const finalFactoryId = resolvedFactoryId ?? await this.getDefaultFactoryId();
    const capaNumber = await this.generateCAPANumber(finalFactoryId);

    const capa = await this.prisma.cAPA.create({
      data: {
        factoryId: finalFactoryId,
        capaNumber,
        ncrId: dto.ncrId,
        type: dto.type as any,
        title: dto.title,
        description: dto.description,
        status: 'OPEN',
        priority: dto.priority as any,
        assignedToId: dto.assignedToId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
      },
      include: {
        assignedTo: { select: { name: true, email: true } },
        ncr: { select: { ncrNumber: true, title: true } },
      },
    });

    this.eventEmitter.emit('quality.capa.created', { capa, factoryId: finalFactoryId });
    this.logger.log(`CAPA ${capaNumber} created (${dto.type})`);
    return capa;
  }

  async getCAPAById(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const capa = await this.prisma.cAPA.findFirst({
      where: { id, ...factoryFilter },
      include: {
        assignedTo: { select: { id: true, name: true, email: true } },
        ncr: { select: { ncrNumber: true, title: true, severity: true } },
        actions: {
          include: { capa: false },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!capa) throw new NotFoundException('CAPA not found');
    return capa;
  }

  async updateCAPA(factoryId: string | null, id: string, dto: UpdateCAPADto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const capa = await this.prisma.cAPA.findFirst({ where: { id, ...factoryFilter } });
    if (!capa) throw new NotFoundException('CAPA not found');
    if (capa.status === 'CLOSED') throw new BadRequestException('Cannot update a closed CAPA');

    return this.prisma.cAPA.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(dto.description && { description: dto.description }),
        ...(dto.priority && { priority: dto.priority as any }),
        ...(dto.assignedToId !== undefined && { assignedToId: dto.assignedToId }),
        ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
        ...(dto.effectiveness !== undefined && { effectiveness: dto.effectiveness }),
      },
    });
  }

  async findCAPAs(factoryId: string | null, filters: {
    search?: string;
    status?: string;
    type?: string;
    ncrId?: string;
    dateFrom?: string;
    dateTo?: string;
    archived?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, type, ncrId, dateFrom, dateTo, archived, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: any = {
      ...archivedWhere(archived),
      ...factoryFilter,
      ...(status && { status }),
      ...(type && { type }),
      ...(ncrId && { ncrId }),
      // CAPA has no machine link → period filter only (by created date).
      ...((dateFrom || dateTo) ? {
        createdAt: {
          ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
          ...(dateTo ? { lte: new Date(dateTo.length <= 10 ? `${dateTo}T23:59:59.999` : dateTo) } : {}),
        },
      } : {}),
      ...(search && {
        OR: [
          { capaNumber: { contains: search, mode: 'insensitive' } },
          { title: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.cAPA.count({ where }),
      this.prisma.cAPA.findMany({
        where,
        include: {
          assignedTo: { select: { name: true } },
          ncr: { select: { ncrNumber: true } },
          actions: { select: { id: true, status: true } },
        },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((c) => ({
        ...c,
        totalActions: c.actions.length,
        completedActions: c.actions.filter((a) => a.status === 'COMPLETED').length,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async addCAPAAction(factoryId: string | null, capaId: string, dto: AddCAPAActionDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const capa = await this.prisma.cAPA.findFirst({ where: { id: capaId, ...factoryFilter } });
    if (!capa) throw new NotFoundException('CAPA not found');

    // Move CAPA to IN_PROGRESS if still OPEN
    if (capa.status === 'OPEN') {
      await this.prisma.cAPA.update({ where: { id: capaId }, data: { status: 'IN_PROGRESS' } });
    }

    const action = await this.prisma.cAPAAction.create({
      data: {
        capaId,
        description: dto.description,
        assignedToId: dto.assignedToId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: 'OPEN',
      },
    });

    return action;
  }

  async completeCAPAAction(factoryId: string | null, capaId: string, actionId: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const capa = await this.prisma.cAPA.findFirst({ where: { id: capaId, ...factoryFilter } });
    if (!capa) throw new NotFoundException('CAPA not found');

    const action = await this.prisma.cAPAAction.findFirst({
      where: { id: actionId, capaId },
    });
    if (!action) throw new NotFoundException('CAPA action not found');

    return this.prisma.cAPAAction.update({
      where: { id: actionId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }

  async verifyCAPA(factoryId: string | null, id: string, userId: string, dto: VerifyCAPADto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const capa = await this.prisma.cAPA.findFirst({
      where: { id, ...factoryFilter },
      include: { actions: true },
    });
    if (!capa) throw new NotFoundException('CAPA not found');

    const pendingActions = capa.actions.filter((a) => a.status !== 'COMPLETED');
    if (pendingActions.length > 0) {
      throw new BadRequestException(
        `Cannot verify CAPA: ${pendingActions.length} action(s) still pending`,
      );
    }

    const verified = await this.prisma.cAPA.update({
      where: { id },
      data: {
        status: 'VERIFIED',
        verifiedAt: new Date(),
        verifiedById: userId,
        effectiveness: dto.effectiveness,
      },
    });

    this.eventEmitter.emit('quality.capa.verified', { capa: verified, factoryId: capa.factoryId });
    return verified;
  }

  async closeCAPA(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const capa = await this.prisma.cAPA.findFirst({ where: { id, ...factoryFilter } });
    if (!capa) throw new NotFoundException('CAPA not found');
    if (capa.status !== 'VERIFIED') {
      throw new BadRequestException('CAPA must be verified before closing');
    }

    return this.prisma.cAPA.update({
      where: { id },
      data: { status: 'CLOSED', completedAt: new Date() },
    });
  }

  // ────────────────────────────────────────────────────────────
  // DELETE OPERATIONS
  // ────────────────────────────────────────────────────────────

  async deleteCAPA(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const capa = await this.prisma.cAPA.findFirst({ where: { id, ...factoryFilter } });
    if (!capa) throw new NotFoundException('CAPA not found');
    if (!['OPEN', 'IN_PROGRESS'].includes(capa.status)) {
      throw new BadRequestException('Only open CAPAs can be deleted');
    }
    await this.prisma.cAPA.delete({ where: { id } });
  }

  async deleteNCR(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const ncr = await this.prisma.nCR.findFirst({ where: { id, ...factoryFilter } });
    if (!ncr) throw new NotFoundException('NCR not found');
    if (!['OPEN', 'IN_REVIEW'].includes(ncr.status)) {
      throw new BadRequestException('Only open NCRs can be deleted');
    }
    await this.prisma.nCR.delete({ where: { id } });
  }

  async deleteInspection(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const record = await this.prisma.inspectionResult.findFirst({ where: { id, ...factoryFilter } });
    if (!record) throw new NotFoundException('Inspection result not found');
    await this.prisma.inspectionResult.delete({ where: { id } });
  }

  // ────────────────────────────────────────────────────────────
  // QUALITY PLANS (ISA-95 QualityTest definitions)
  // ────────────────────────────────────────────────────────────

  async findQualityPlans(factoryId: string | null, filters: { skuId?: string; type?: string; isActive?: boolean; archived?: string; machineId?: string; areaId?: string; lineId?: string }) {
    const machineIds = await this.qualityScopeMachineIds(factoryId, filters);
    const where: any = {
      ...(factoryId ? { factoryId } : {}),
      ...archivedWhere(filters.archived),
      ...(filters.skuId && { skuId: filters.skuId }),
      ...(filters.type && { type: filters.type }),
      ...(filters.isActive !== undefined ? { isActive: filters.isActive } : { isActive: true }),
      // Scope: plans for the in-scope machines, plus factory-wide plans (machineId null).
      ...(machineIds ? { OR: [{ machineId: { in: machineIds } }, { machineId: null }] } : {}),
    };
    const plans = await this.prisma.qualityPlan.findMany({
      where,
      include: {
        parameters: { orderBy: { sortOrder: 'asc' } },
      },
      orderBy: { name: 'asc' },
    });
    return plans;
  }

  async getInspectionsByWorkOrder(factoryId: string | null, workOrderId: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    return this.prisma.inspectionResult.findMany({
      where: { workOrderId, ...factoryFilter },
      include: {
        inspector: { select: { name: true } },
        plan: { select: { name: true, code: true, type: true } },
      },
      orderBy: { inspectedAt: 'desc' },
    });
  }

  // ────────────────────────────────────────────────────────────
  // QUALITY PLAN CRUD (ISA-95 QualityTestSpecification)
  // ────────────────────────────────────────────────────────────

  async getQualityPlanById(factoryId: string | null, id: string) {
    const where = factoryId ? { id, factoryId } : { id };
    const plan = await this.prisma.qualityPlan.findFirst({
      where,
      include: {
        parameters: { orderBy: { sortOrder: 'asc' } },
        _count: { select: { results: true } },
      },
    });
    if (!plan) throw new NotFoundException('Quality plan not found');
    return plan;
  }

  async createQualityPlan(factoryId: string, dto: CreateQualityPlanDto) {
    const existing = await this.prisma.qualityPlan.findFirst({
      where: { factoryId, code: dto.code.toUpperCase() },
    });
    if (existing) throw new BadRequestException(`Plan code '${dto.code}' already exists`);

    return this.prisma.qualityPlan.create({
      data: {
        factoryId,
        code: dto.code.toUpperCase(),
        name: dto.name,
        type: dto.type,
        skuId: dto.skuId,
        machineId: dto.machineId,
        samplingFrequency: dto.samplingFrequency,
        samplingQty: dto.samplingQty ?? 1,
        version: dto.version ?? '1',
      },
      include: { parameters: true, _count: { select: { results: true } } },
    });
  }

  async updateQualityPlan(factoryId: string | null, id: string, dto: UpdateQualityPlanDto) {
    const where = factoryId ? { id, factoryId } : { id };
    const plan = await this.prisma.qualityPlan.findFirst({ where });
    if (!plan) throw new NotFoundException('Quality plan not found');

    return this.prisma.qualityPlan.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.type && { type: dto.type }),
        ...(dto.skuId !== undefined && { skuId: dto.skuId || null }),
        ...(dto.machineId !== undefined && { machineId: dto.machineId || null }),
        ...(dto.samplingFrequency !== undefined && { samplingFrequency: dto.samplingFrequency || null }),
        ...(dto.samplingQty !== undefined && { samplingQty: dto.samplingQty }),
        ...(dto.version !== undefined && { version: dto.version }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
      include: { parameters: { orderBy: { sortOrder: 'asc' } }, _count: { select: { results: true } } },
    });
  }

  async deleteQualityPlan(factoryId: string | null, id: string) {
    const where = factoryId ? { id, factoryId } : { id };
    const plan = await this.prisma.qualityPlan.findFirst({
      where,
      include: { _count: { select: { results: true } } },
    });
    if (!plan) throw new NotFoundException('Quality plan not found');
    const resultCount = (plan as any)._count?.results ?? 0;
    if (resultCount > 0) {
      throw new BadRequestException(
        `Cannot delete a plan that has ${resultCount} inspection record(s). Deactivate it instead.`,
      );
    }
    await this.prisma.qualityPlan.delete({ where: { id } });
  }

  async approveQualityPlan(factoryId: string | null, id: string, userId: string) {
    const where = factoryId ? { id, factoryId } : { id };
    const plan = await this.prisma.qualityPlan.findFirst({ where });
    if (!plan) throw new NotFoundException('Quality plan not found');
    if (plan.approvedAt) throw new BadRequestException('Plan is already approved');

    return this.prisma.qualityPlan.update({
      where: { id },
      data: { approvedAt: new Date(), approvedById: userId },
      include: { parameters: { orderBy: { sortOrder: 'asc' } }, _count: { select: { results: true } } },
    });
  }

  // ────────────────────────────────────────────────────────────
  // QUALITY PARAMETERS (ISA-95 QualityTestSpecificationProperty)
  // ────────────────────────────────────────────────────────────

  async addParameter(factoryId: string | null, planId: string, dto: CreateQualityParameterDto) {
    const where = factoryId ? { id: planId, factoryId } : { id: planId };
    const plan = await this.prisma.qualityPlan.findFirst({ where });
    if (!plan) throw new NotFoundException('Quality plan not found');

    const last = await this.prisma.qualityParameter.findFirst({
      where: { planId },
      orderBy: { sortOrder: 'desc' },
    });

    return this.prisma.qualityParameter.create({
      data: {
        planId,
        name: dto.name,
        unit: dto.unit,
        nominalValue: dto.nominalValue,
        ucl: dto.ucl,
        lcl: dto.lcl,
        usl: dto.usl,
        lsl: dto.lsl,
        checkMethod: dto.checkMethod,
        isKPI: dto.isKPI ?? false,
        sortOrder: dto.sortOrder ?? (last ? last.sortOrder + 1 : 0),
      },
    });
  }

  async updateParameter(factoryId: string | null, planId: string, paramId: string, dto: UpdateQualityParameterDto) {
    const where = factoryId ? { id: planId, factoryId } : { id: planId };
    const plan = await this.prisma.qualityPlan.findFirst({ where });
    if (!plan) throw new NotFoundException('Quality plan not found');

    const param = await this.prisma.qualityParameter.findFirst({ where: { id: paramId, planId } });
    if (!param) throw new NotFoundException('Parameter not found');

    return this.prisma.qualityParameter.update({
      where: { id: paramId },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.unit !== undefined && { unit: dto.unit || null }),
        ...(dto.nominalValue !== undefined && { nominalValue: dto.nominalValue }),
        ...(dto.ucl !== undefined && { ucl: dto.ucl }),
        ...(dto.lcl !== undefined && { lcl: dto.lcl }),
        ...(dto.usl !== undefined && { usl: dto.usl }),
        ...(dto.lsl !== undefined && { lsl: dto.lsl }),
        ...(dto.checkMethod !== undefined && { checkMethod: dto.checkMethod || null }),
        ...(dto.isKPI !== undefined && { isKPI: dto.isKPI }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async deleteParameter(factoryId: string | null, planId: string, paramId: string) {
    const where = factoryId ? { id: planId, factoryId } : { id: planId };
    const plan = await this.prisma.qualityPlan.findFirst({ where });
    if (!plan) throw new NotFoundException('Quality plan not found');

    const param = await this.prisma.qualityParameter.findFirst({ where: { id: paramId, planId } });
    if (!param) throw new NotFoundException('Parameter not found');

    await this.prisma.qualityParameter.delete({ where: { id: paramId } });
  }

  // ────────────────────────────────────────────────────────────
  // SPC — STATISTICAL PROCESS CONTROL
  // ────────────────────────────────────────────────────────────

  /** Resolve an analysis scope (area/line/machine) to covered machine ids. */
  private async qualityScopeMachineIds(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ): Promise<string[] | undefined> {
    if (!scope || (!scope.areaId && !scope.lineId && !scope.machineId)) return undefined;
    if (scope.machineId) return [scope.machineId];
    const ms = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(scope.lineId ? { lineId: scope.lineId } : {}),
        ...(scope.areaId ? { line: { areaId: scope.areaId } } : {}),
      },
      select: { id: true },
    });
    return ms.map((m) => m.id);
  }

  /** Build the shared SPCMeasurement where-clause from scope/time/order filters. */
  private async spcWhere(
    factoryId: string | null,
    f: { machineId?: string; areaId?: string; lineId?: string; skuId?: string; workOrderId?: string; productionOrderId?: string; from?: string; to?: string },
  ): Promise<any> {
    const machineIds = await this.qualityScopeMachineIds(factoryId, f);
    let woFilter: any = {};
    if (f.workOrderId) woFilter = { workOrderId: f.workOrderId };
    else if (f.productionOrderId) {
      const wos = await this.prisma.workOrder.findMany({ where: { productionOrderId: f.productionOrderId, ...(factoryId ? { factoryId } : {}) }, select: { id: true } });
      woFilter = { workOrderId: { in: wos.map((w) => w.id) } };
    }
    return {
      ...(factoryId ? { factoryId } : {}),
      ...(machineIds ? { machineId: { in: machineIds } } : {}),
      ...(f.skuId ? { skuId: f.skuId } : {}),
      ...woFilter,
      ...((f.from || f.to) ? {
        measuredAt: {
          ...(f.from ? { gte: new Date(f.from) } : {}),
          ...(f.to ? { lte: new Date(`${f.to.length <= 10 ? `${f.to}T23:59:59.999` : f.to}`) } : {}),
        },
      } : {}),
    };
  }

  async getSPCParameters(
    factoryId: string | null,
    filters: { machineId?: string; areaId?: string; lineId?: string; skuId?: string; workOrderId?: string; productionOrderId?: string; from?: string; to?: string },
  ) {
    const where = await this.spcWhere(factoryId, filters);

    const raw = await this.prisma.sPCMeasurement.groupBy({
      by: ['parameterName', 'parameterUnit', 'machineId'],
      where,
      _count: { value: true },
      _avg: { value: true, ucl: true, lcl: true, cl: true },
    });

    return raw.map(p => ({
      parameterName: p.parameterName,
      unit: p.parameterUnit,
      machineId: p.machineId,
      mean: p._avg.cl ?? p._avg.value,
      ucl: p._avg.ucl,
      lcl: p._avg.lcl,
      sampleCount: p._count.value,
    }));
  }

  async getSPCMeasurements(
    factoryId: string | null,
    filters: { parameterId?: string; machineId?: string; areaId?: string; lineId?: string; skuId?: string; workOrderId?: string; productionOrderId?: string; from?: string; to?: string; limit: number },
  ) {
    const where = {
      ...(await this.spcWhere(factoryId, filters)),
      ...(filters.parameterId ? { parameterName: filters.parameterId } : {}),
    };

    return this.prisma.sPCMeasurement.findMany({
      where,
      orderBy: { measuredAt: 'desc' },
      take: filters.limit,
      select: {
        id: true,
        parameterName: true,
        parameterUnit: true,
        value: true,
        machineId: true,
        ucl: true,
        lcl: true,
        cl: true,
        isOutOfControl: true,
        controlViolation: true,
        measuredAt: true,
        sampleSize: true,
        subgroupNumber: true,
      },
    });
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ────────────────────────────────────────────────────────────

  private async resolveFactoryId(
    factoryId: string | null,
    machineId?: string,
    workOrderId?: string,
  ): Promise<string> {
    if (factoryId) return factoryId;

    if (machineId) {
      const m = await this.prisma.machine.findUnique({ where: { id: machineId } });
      if (m) return m.factoryId;
    }
    if (workOrderId) {
      const wo = await this.prisma.workOrder.findUnique({ where: { id: workOrderId } });
      if (wo) return wo.factoryId;
    }
    return this.getDefaultFactoryId();
  }

  private async getDefaultFactoryId(): Promise<string> {
    const factory = await this.prisma.factory.findFirst({ where: { isActive: true } });
    if (!factory) throw new BadRequestException('No factory found — cannot create record');
    return factory.id;
  }

  private async generateInspectionNumber(factoryId: string): Promise<string> {
    const today = new Date();
    const prefix = `INS-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

    const last = await this.prisma.inspectionResult.findFirst({
      where: { factoryId, inspectionNumber: { startsWith: prefix } },
      orderBy: { inspectionNumber: 'desc' },
    });

    const seq = last ? parseInt(last.inspectionNumber.slice(-4), 10) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  }

  private async generateNCRNumber(factoryId: string): Promise<string> {
    const today = new Date();
    const prefix = `NCR-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

    const last = await this.prisma.nCR.findFirst({
      where: { factoryId, ncrNumber: { startsWith: prefix } },
      orderBy: { ncrNumber: 'desc' },
    });

    const seq = last ? parseInt(last.ncrNumber.slice(-4), 10) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  }

  private async generateCAPANumber(factoryId: string): Promise<string> {
    const today = new Date();
    const prefix = `CAPA-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}`;

    const last = await this.prisma.cAPA.findFirst({
      where: { factoryId, capaNumber: { startsWith: prefix } },
      orderBy: { capaNumber: 'desc' },
    });

    const seq = last ? parseInt(last.capaNumber.slice(-4), 10) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  }
}
