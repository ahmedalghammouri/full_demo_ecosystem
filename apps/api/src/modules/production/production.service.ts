import {
  Injectable, NotFoundException, BadRequestException, Logger,
  ConflictException, type OnApplicationBootstrap,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { oeeIdentityOf } from '../../common/oee-identity.util';
import { PrismaService } from '../../database/prisma.service';
import { archivedWhere } from '../../common/archive.util';
import { findProcessForSku } from '../../common/process-scope.util';
import { currentShiftStart, currentShiftWindow } from '../../common/shift-window.util';
import { scheduleOps, makeWorkCalendar, type SchedOp } from '../scheduling/op-scheduler';
import { OEEService } from './oee.service';
import { KpiService } from './kpi.service';
import { ApsService } from '../aps/aps.service';
import { HistorianService } from '../historian/historian.service';
import { AutoPlannedStopService } from './auto-planned-stop.service';
import {
  convertUnits, isConvertibleUnit, normaliseUnit, piecesPer, smallestLadderUnit,
  toPieces, sumInPieces, UNIT_LADDER, type SkuPackaging,
} from '../../common/units.util';
import { resolveLocalRange, plantBound } from '../../common/plant-time.util';

/**
 * The end of the plant day a moment falls in.
 *
 * Deliberately identical to the one in OeeScheduleController: it is the fallback
 * slot end, and if the two ever differ the same request answered by two routes
 * clips the committed slot differently.
 */
function endOfLocalDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}
import type { WorkOrderStatus, Prisma } from '@prisma/client';
import type {
  CreateWorkOrderDto, UpdateWorkOrderDto, CompleteWorkOrderDto,
  HoldWorkOrderDto, RecordCountDto,
  CreateProductionOrderDto, UpdateProductionOrderDto,
  CreateWOFromPODto, ProductionOrderFiltersDto,
} from './dto/work-order.dto';
import { isTrendBucket, type TrendBucket } from '../../common/trend-bucket.util';

// The interval algebra the OEE classifier already uses. Shared rather than
// re-derived: two implementations of "merge these spans" is how the same
// window ends up counted once in one place and four times in another.
import { merge, spanMinutes, type Span } from '../oee-standard/minute-classification';
import { canBypass, canRestore, outputStepAfter, checkBypassPassword, type BypassStep } from './step-bypass';
import {
  projectBreaks, layStops, shiftStartsBetween,
  type ShiftShape, type StopPlanItem,
} from './planned-stop-plan';
import { stepDurationMins } from './step-duration';

const VALID_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  PLANNED: ['RELEASED', 'IN_PROGRESS', 'CANCELLED'],
  RELEASED: ['IN_PROGRESS', 'CANCELLED', 'ON_HOLD'],
  IN_PROGRESS: ['COMPLETED', 'ON_HOLD', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class ProductionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly oeeService: OEEService,
    private readonly kpiService: KpiService,
    private readonly eventEmitter: EventEmitter2,
    private readonly apsService: ApsService,
    private readonly historian: HistorianService,
    /** Books the stops an order and a shift already say they will take. */
    private readonly autoStops: AutoPlannedStopService,
  ) {}

  /**
   * Self-heal finished-goods inventory on boot: any COMPLETED work order whose
   * produced output never reached stock (seeded data, or completed before the
   * finalize path existed) gets posted now. Deferred + non-blocking so it never
   * delays readiness; idempotent (skips WOs that already have a finished-goods lot).
   */
  onApplicationBootstrap(): void {
    setTimeout(() => {
      this.backfillFinishedGoods().catch((e) =>
        this.logger.error('Finished-goods backfill failed', e as Error),
      );
    }, 8_000);
  }

  /**
   * Post finished goods for every COMPLETED WO that has produced output but no
   * finished-goods lot yet. Reuses the exact completion path (final-step good,
   * base-unit conversion, RECEIPT movement, SKU on-hand bump, genealogy) so the
   * numbers match the live flow. Returns how many were scanned/posted.
   */
  async backfillFinishedGoods(): Promise<{ scanned: number; posted: number }> {
    const wos = await this.prisma.workOrder.findMany({
      where: { status: 'COMPLETED', skuId: { not: null }, deletedAt: null },
      select: { id: true, factoryId: true },
    });
    let posted = 0;
    for (const w of wos) {
      const has = await this.prisma.finishedGoodsLot.findFirst({
        where: { workOrderId: w.id }, select: { id: true },
      });
      if (has) continue;
      await this.finalizeWorkOrderProduction(w.factoryId, null, w.id);
      posted++;
    }
    if (posted > 0) this.logger.log(`Finished-goods backfill: posted ${posted}/${wos.length} completed WOs to inventory`);
    return { scanned: wos.length, posted };
  }

  // ────────────────────────────────────────────────────────────
  // WORK ORDER CRUD
  // ────────────────────────────────────────────────────────────

  async createWorkOrder(factoryId: string | null, userId: string, dto: CreateWorkOrderDto) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const sku = await this.prisma.sKU.findFirst({ where: { id: dto.skuId, ...factoryFilter } });
    if (!sku) throw new NotFoundException('SKU not found or not in your factory');

    if (dto.productionOrderId) {
      const po = await this.prisma.productionOrder.findFirst({
        where: { id: dto.productionOrderId, ...factoryFilter },
      });
      if (!po) throw new NotFoundException('Production order not found');
    }

    const resolvedFactoryId = factoryId ?? sku.factoryId;
    const orderNumber = await this.generateOrderNumber(resolvedFactoryId);

    const workOrder = await this.prisma.workOrder.create({
      data: {
        factoryId: resolvedFactoryId,
        orderNumber,
        skuId: dto.skuId,
        lineId: dto.lineId ?? null,
        productionOrderId: dto.productionOrderId,
        status: 'PLANNED',
        priority: dto.priority,
        autoStart: dto.autoStart ?? false,
        plannedQty: dto.plannedQty,
        plannedStart: new Date(dto.plannedStart),
        plannedEnd: new Date(dto.plannedEnd),
        operatorId: dto.operatorId,
        supervisorId: dto.supervisorId,
        notes: dto.notes,
        createdById: userId,
      },
    });

    // A work order spans the product's whole routing. Generate the job-order
    // dispatch list (one per routing step → machine). generateJobOrders blocks
    // when the product has no approved process; roll the WO back so we never
    // leave an orphan, machineless work order behind.
    try {
      await this.generateJobOrders(resolvedFactoryId, workOrder.id, {
        plannedStart: dto.plannedStart,
        plannedEnd: dto.plannedEnd,
        clearExisting: false,
        assignments: dto.assignments,
      });
    } catch (err) {
      await this.prisma.workOrder.delete({ where: { id: workOrder.id } }).catch(() => undefined);
      throw err;
    }

    // Material-availability gate: raise shortage requests to inventory and flag the
    // WO "Awaiting Materials" if any step material is short (non-blocking — the WO is
    // created either way and simply cannot start until materials are available).
    await this.checkWorkOrderMaterials(workOrder.id, userId);

    const full = await this.getWorkOrderById(resolvedFactoryId, workOrder.id);
    this.eventEmitter.emit('production.work-order.created', { workOrder: full, factoryId: resolvedFactoryId });
    this.logger.log(`Work order ${orderNumber} created with ${full.totalSteps} routed job orders`);

    return full;
  }

  async findWorkOrders(factoryId: string | null, filters: {
    search?: string;
    status?: string;
    priority?: string;
    machineId?: string;
    lineId?: string;
    areaId?: string;
    dateFrom?: string;
    dateTo?: string;
    archived?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, priority, machineId, lineId, areaId, dateFrom, dateTo, archived, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const statusFilter = status
      ? status.includes(',')
        ? { status: { in: status.split(',').map(s => s.trim()) as WorkOrderStatus[] } }
        : { status: status as WorkOrderStatus }
      : {};

    // A WO "belongs to" a machine via its job orders — routed WOs span multiple
    // machines through their JO steps (there is no single header machine).
    const scopeOr: Prisma.WorkOrderWhereInput[] | null = machineId
      ? [{ jobOrders: { some: { machineId } } }]
      : lineId
        ? [{ lineId }, { jobOrders: { some: { machine: { lineId } } } }]
        : areaId
          ? [{ line: { areaId } }, { jobOrders: { some: { machine: { line: { areaId } } } } }]
          : null;

    const where: Prisma.WorkOrderWhereInput = {
      ...factoryFilter,
      deletedAt: null,
      ...archivedWhere(archived),
      ...statusFilter,
      ...(priority && { priority: priority as 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' }),
      ...(scopeOr && { OR: scopeOr }),
      ...(dateFrom && { plannedStart: { gte: new Date(dateFrom) } }),
      ...(dateTo && { plannedEnd: { lte: new Date(dateTo) } }),
      ...(search && {
        OR: [
          { orderNumber: { contains: search, mode: 'insensitive' as const } },
          { sku: { name: { contains: search, mode: 'insensitive' as const } } },
          { jobOrders: { some: { machine: { name: { contains: search, mode: 'insensitive' as const } } } } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.workOrder.count({ where }),
      this.prisma.workOrder.findMany({
        where,
        include: {
          sku: { select: { name: true, code: true, itemNumber: true, baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true } },
          line: { select: { name: true, code: true } },
          operator: { select: { name: true } },
          supervisor: { select: { name: true } },
          productionOrder: { select: { orderNumber: true } },
          _count: { select: { jobOrders: true } },
          jobOrders: {
            orderBy: { sequenceOrder: 'asc' },
            select: {
              id: true,
              operationName: true,
              sequenceOrder: true,
              status: true,
              actualQtyGood: true,
              actualQtyRejected: true,
              actualStart: true,
              actualEnd: true,
              idealCycleTimeSec: true,
              outputUnit: true,
              machine: { select: { name: true, code: true } },
              operator: { select: { name: true } },
            },
          },
        },
        orderBy: [{ priority: 'desc' }, { plannedStart: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // One fact-store read for every step on the page, rather than one per row.
    const joFactors = await this.jobOrderFactors(
      data.flatMap((wo) => wo.jobOrders.map((j) => j.id)),
    );

    return {
      data: data.map((wo) => {
        const mapped = this.mapWorkOrder(wo);
        const totalSteps = wo.jobOrders.length;
        const completedSteps = wo.jobOrders.filter(j => j.status === 'COMPLETE').length;
        const lastJO = wo.jobOrders[totalSteps - 1];
        return {
          ...mapped,
          archivedAt: (wo as any).archivedAt ?? null,
          completedSteps,
          totalSteps,
          // Step-based progress — unit-safe
          progress: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : mapped.progress,
          // Good = the FINAL step's output (what actually left the line). Scrap is
          // lost at EVERY step, so it must be summed — but the steps count in
          // different units (inners / cartons / pallets), so the raw sum that used
          // to sit here added unlike quantities. Both are now converted to pieces
          // and reported in one declared unit.
          goodQty: lastJO
            ? toPieces(lastJO.actualQtyGood ?? 0, (lastJO as any).outputUnit, wo.sku)
            : mapped.goodQty,
          scrapQty: sumInPieces(
            wo.jobOrders,
            (j) => j.actualQtyRejected,
            (j) => (j as any).outputUnit,
            () => wo.sku,
          ).pieces,
          // Self-derived from the SKU packaging: quantities are held in pieces, but
          // when an inner IS one piece the shop floor calls it an inner, and a card
          // reading "pcs" is read as a different number. Never hardcoded.
          qtyUnit: smallestLadderUnit(wo.sku),
          // Same split as the detail endpoint: the commitment converted to PIECES so
          // it is comparable with goodQty/scrapQty above, plus the number as ordered
          // in the unit it was ordered in. A list row that shows one and a bar that
          // uses the other is how "150 PALLET" became "150 INNER".
          plannedQtyBase: toPieces(mapped.plannedQty ?? 0, (wo as any).qtyUnit, wo.sku),
          plannedQtyOrdered: mapped.plannedQty ?? 0,
          plannedQtyOrderedUnit: (wo as any).qtyUnit ?? null,
          jobOrders: wo.jobOrders.map((jo) => ({
            id: jo.id,
            operationName: jo.operationName,
            sequenceOrder: jo.sequenceOrder,
            status: jo.status,
            machine: jo.machine,
            operator: jo.operator,
            joOEE: (joFactors.get(jo.id) ?? this.noFactors()).joOEE,
          })),
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getWorkOrderById(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
      include: {
        sku: true,
        line: true,
        operator: { select: { id: true, name: true, email: true } },
        supervisor: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        startedBy: { select: { id: true, name: true } },
        completedBy: { select: { id: true, name: true } },
        productionOrder: { select: { orderNumber: true, sapOrderNumber: true } },
        batchRecords: { select: { id: true, batchNumber: true, status: true } },
        downtimeEvents: {
          where: { endTime: null },
          select: { id: true, startTime: true, category: true, reason: true },
        },
        jobOrders: {
          orderBy: { sequenceOrder: 'asc' },
          include: {
            machine:  { select: { id: true, name: true, code: true } },
            operator: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    // ISA-95: each JO can have a different outputUnit (PIECE → CARTON → PALLET).
    // Summing across all JOs is meaningless. Correct approach:
    //   • liveGoodQty / liveActualQty  = last JO output (the WO's final product unit)
    //   • liveScrapQty                 = total scrap events across ALL steps (quality KPI)
    //   • liveProgress (qty-based)     = last JO good qty vs WO plannedQty
    //   • liveStepProgress             = % of JO steps completed (always meaningful)
    // All in PIECES: the steps count in different packaging units, so scrap can only
    // be summed after conversion (the comment above says summing across JOs is
    // meaningless — it was still being done here, just for the scrap line).
    const woPkg = (wo as any).sku ?? null;
    const lastJO  = wo.jobOrders[wo.jobOrders.length - 1] ?? null;
    const liveGood  = toPieces(lastJO?.actualQtyGood ?? 0, (lastJO as any)?.outputUnit, woPkg);
    const liveScrap = sumInPieces(
      wo.jobOrders, (j) => j.actualQtyRejected, (j) => (j as any).outputUnit, () => woPkg,
    ).pieces;
    // Everything the order consumed = what left the line + everything lost getting
    // there. Charging only the LAST step's rejects understated it by every unit
    // scrapped upstream, which is most of them: a bag rejected at the filler never
    // reaches the palletiser to be counted.
    const liveActual = liveGood + liveScrap;
    const completedSteps = wo.jobOrders.filter(j => j.status === 'COMPLETE').length;
    const totalSteps     = wo.jobOrders.length;

    // A WO spans every machine in its routing — derive the distinct machine list
    // from the job-order steps (there is no single header machine).
    const machines = dedupeMachines(wo.jobOrders.map((jo) => jo.machine));

    // The PLANNED side has to be converted too, and it was not.
    //
    // liveGood/liveScrap above are in PIECES. `wo.plannedQty` is stored in the work
    // order's OWN unit — `wo.qtyUnit`, a real column — which for a packaging line is
    // typically PALLET. Returning the raw 150 next to a pieces figure and labelling
    // both with one derived unit made the progress bar compare pallets with pieces:
    // an order 100% complete rendered as 0.6%, and "150 PALLET" was displayed as
    // "150 INNER", understating the commitment by the whole packaging ladder.
    //
    // So: `plannedQtyBase` is the commitment in PIECES (comparable with the live
    // quantities), while `plannedQtyOrdered` + `plannedQtyOrderedUnit` keep the
    // number the planner actually typed, in the unit they typed it in. A screen can
    // show the operator "150 PALLET" and still draw a truthful bar.
    const joFactors = await this.jobOrderFactors(wo.jobOrders.map((j) => j.id));

    const plannedQtyBase = toPieces(wo.plannedQty ?? 0, (wo as any).qtyUnit, woPkg);

    return {
      ...wo,
      machines,
      // The unit those live quantities are denominated in, derived from the SKU.
      qtyUnit: smallestLadderUnit(woPkg),
      plannedQtyBase,
      plannedQtyOrdered: wo.plannedQty ?? 0,
      plannedQtyOrderedUnit: (wo as any).qtyUnit ?? null,
      liveGoodQty:    liveGood,
      liveScrapQty:   liveScrap,
      liveActualQty:  liveActual,
      // Step-based progress: how many routing steps are done (always unit-safe)
      liveProgress:   totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      completedSteps,
      totalSteps,
      jobOrders: wo.jobOrders.map((jo) => ({
        ...jo,
        ...(joFactors.get(jo.id) ?? this.noFactors()),
      })),
    };
  }

  async updateWorkOrder(factoryId: string | null, id: string, dto: UpdateWorkOrderDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');
    if (['COMPLETED', 'CANCELLED'].includes(wo.status)) {
      throw new BadRequestException(`Cannot update a ${wo.status} work order`);
    }

    const updated = await this.prisma.workOrder.update({
      where: { id },
      data: {
        ...(dto.plannedQty !== undefined && { plannedQty: dto.plannedQty }),
        ...(dto.plannedStart && { plannedStart: new Date(dto.plannedStart) }),
        ...(dto.plannedEnd && { plannedEnd: new Date(dto.plannedEnd) }),
        ...(dto.priority && { priority: dto.priority }),
        ...(dto.operatorId !== undefined && { operatorId: dto.operatorId }),
        ...(dto.supervisorId !== undefined && { supervisorId: dto.supervisorId }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
    });

    // Editing quantity or schedule can change material demand — re-evaluate the
    // shortage gate (and any open requests) for a WO that hasn't started yet.
    if ((dto.plannedQty !== undefined || dto.plannedStart) && ['PLANNED', 'RELEASED'].includes(updated.status)) {
      await this.checkWorkOrderMaterials(id, null);
    }

    return updated;
  }

  /**
   * Remove a work order. Production rule:
   *   • NOT started yet (no actualStart, status PLANNED/RELEASED) → DELETE it; its
   *     job orders disappear with it (the dispatch list filters out JOs of a
   *     deleted WO, so nothing is orphaned).
   *   • Work has STARTED (actualStart set, or IN_PROGRESS/COMPLETED, or a CANCELLED
   *     run that had begun) → ARCHIVE instead, to preserve the production history.
   */
  /**
   * Permanently remove work orders and EVERYTHING beneath them — job orders, their
   * material consumptions and production snapshots, plus any WO-level snapshots — in
   * one transaction. Used for not-started orders so a deleted WO/PO leaves nothing
   * behind (no orphan JOs lingering in APS or the DB). Self-reference (JO predecessor
   * chain) is broken first so the cascade can't hit a FK constraint.
   */
  private async purgeWorkOrders(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const jos = await this.prisma.jobOrder.findMany({ where: { workOrderId: { in: ids } }, select: { id: true } });
    const joIds = jos.map((j) => j.id);
    await this.prisma.$transaction([
      this.prisma.jobOrder.updateMany({ where: { id: { in: joIds } }, data: { predecessorId: null } }),
      this.prisma.materialConsumption.deleteMany({ where: { jobOrderId: { in: joIds } } }),
      this.prisma.jobOrder.deleteMany({ where: { workOrderId: { in: ids } } }),
      this.prisma.workOrder.deleteMany({ where: { id: { in: ids } } }),
    ]);
  }

  async deleteWorkOrder(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.workOrder.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
      select: { id: true, orderNumber: true, status: true, actualStart: true },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    /*
     * "Did anything actually happen?" — asked of the evidence, not of one field.
     *
     * `wo.actualStart` was the only test, and it is a weak proxy: a job order
     * carries its own actualStart, and starting one does not stamp the work
     * order. So a work order could look untouched while its steps had run,
     * booked minutes into oee_minutes and had scrap logged against them.
     *
     * That mattered because scrap_logs.jobOrderId is ON DELETE RESTRICT — the
     * only FK into job_orders that is. The purge deletes job orders without
     * clearing scrap, so Postgres refused, the whole transaction rolled back,
     * and the reader got an opaque foreign-key error with no way to act on it.
     * The delete simply did not work.
     *
     * Archiving instead is not a workaround; it is the existing rule applied to
     * the right question. Work that produced something has history, and history
     * is preserved rather than destroyed. Deleting the scrap log to force the
     * delete through would erase a record of waste to tidy a list.
     */
    const [startedJobOrders, scrapLogs] = await Promise.all([
      this.prisma.jobOrder.count({ where: { workOrderId: id, actualStart: { not: null } } }),
      this.prisma.scrapLog.count({ where: { jobOrder: { workOrderId: id } } }),
    ]);

    const started = !!wo.actualStart
      || ['IN_PROGRESS', 'COMPLETED'].includes(wo.status)
      || startedJobOrders > 0
      || scrapLogs > 0;
    if (started) {
      // Started work has production history — preserve it by archiving (hidden
      // everywhere, including APS) rather than destroying the audit trail.
      await this.prisma.workOrder.update({ where: { id }, data: { archivedAt: new Date() } });
      // Say WHICH evidence, so "why was this archived instead of deleted?" has
      // an answer without a database session.
      const why = [
        wo.actualStart ? 'the work order had started' : null,
        startedJobOrders > 0 ? `${startedJobOrders} job order(s) had started` : null,
        scrapLogs > 0 ? `${scrapLogs} scrap log(s) recorded` : null,
        ['IN_PROGRESS', 'COMPLETED'].includes(wo.status) ? `status ${wo.status}` : null,
      ].filter(Boolean).join(', ');
      this.logger.log(`WO ${wo.orderNumber} archived — history preserved (${why})`);
      return { action: 'archived' as const, orderNumber: wo.orderNumber, reason: why };
    }
    // Not started → hard-delete the WO and all its job orders (+ their children).
    await this.purgeWorkOrders([wo.id]);
    this.logger.log(`WO ${wo.orderNumber} deleted with its job orders (not started)`);
    return { action: 'deleted' as const, orderNumber: wo.orderNumber };
  }

  // ────────────────────────────────────────────────────────────
  // PRODUCTION ORDERS (ISA-95 Level 4 — ERP/Scheduling)
  // ────────────────────────────────────────────────────────────

  async createProductionOrder(factoryId: string | null, userId: string, dto: CreateProductionOrderDto) {
    if (!factoryId) throw new BadRequestException('Factory context required');

    const sku = await this.prisma.sKU.findFirst({ where: { id: dto.skuId, factoryId } });
    if (!sku) throw new NotFoundException('SKU not found');

    const existing = await this.prisma.productionOrder.findFirst({ where: { orderNumber: dto.orderNumber } });
    if (existing) throw new ConflictException(`Order number ${dto.orderNumber} already exists`);

    return this.prisma.productionOrder.create({
      data: {
        factoryId,
        orderNumber: dto.orderNumber,
        sapOrderNumber: dto.sapOrderNumber,
        skuId: dto.skuId,
        targetQty: dto.targetQty,
        unit: dto.unit ?? 'CARTON',
        priority: dto.priority as any,
        plannedStart: new Date(dto.plannedStart),
        plannedEnd: new Date(dto.plannedEnd),
        customer: dto.customer,
        notes: dto.notes,
        createdById: userId,
        status: 'PLANNED',
      },
      include: { sku: { select: { name: true, code: true, itemNumber: true } } },
    });
  }

  async findProductionOrders(factoryId: string | null, filters: ProductionOrderFiltersDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;

    // Scope: a PO is in-scope when it has a WO that — by its header machine OR any
    // of its job-order steps — runs on the selected area/line/machine. A PO that
    // has NO work orders yet (just created, not dispatched to a line) is not tied
    // to any line, so it must stay visible under every scope — otherwise newly
    // created production orders vanish until their WOs are generated.
    const woScopeOr =
      (filters.machineId || filters.lineId || filters.areaId)
        ? filters.machineId
          ? [{ jobOrders: { some: { machineId: filters.machineId } } }]
          : filters.lineId
            ? [{ lineId: filters.lineId }, { jobOrders: { some: { machine: { lineId: filters.lineId } } } }]
            : [{ line: { areaId: filters.areaId } }, { jobOrders: { some: { machine: { line: { areaId: filters.areaId } } } } }]
        : null;

    const scopeMatch: Prisma.ProductionOrderWhereInput | null = woScopeOr
      ? {
          OR: [
            { workOrders: { some: { deletedAt: null, OR: woScopeOr as any } } },
            { workOrders: { none: { deletedAt: null } } }, // not yet dispatched → always visible
          ],
        }
      : null;

    const searchMatch: Prisma.ProductionOrderWhereInput | null = filters.search
      ? {
          OR: [
            { orderNumber: { contains: filters.search, mode: 'insensitive' } },
            { sapOrderNumber: { contains: filters.search, mode: 'insensitive' } },
            { customer: { contains: filters.search, mode: 'insensitive' } },
            { sku: { name: { contains: filters.search, mode: 'insensitive' } } },
          ],
        }
      : null;

    const andConds = [scopeMatch, searchMatch].filter(Boolean) as Prisma.ProductionOrderWhereInput[];

    const where: Prisma.ProductionOrderWhereInput = {
      ...factoryFilter,
      deletedAt: null,
      ...archivedWhere(filters.archived),
      ...(filters.status && { status: filters.status as any }),
      ...(andConds.length > 0 && { AND: andConds }),
    };

    const [data, total] = await Promise.all([
      this.prisma.productionOrder.findMany({
        where,
        orderBy: { plannedStart: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          // Packaging is required to express the PO target in PIECES: the target is
          // stated in the ORDER unit (CARTON) while work-order output is counted in
          // pieces, and dividing one by the other produced a 361% completion that was
          // then hidden by a Math.min(99, …) cap.
          sku: { select: { id: true, name: true, code: true, itemNumber: true, brand: true, weight: true, weightUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } },
          workOrders: {
            where: { deletedAt: null },
            select: {
              // qtyUnit is what plannedQty is COUNTED IN. Without it the caller has a
              // bare 150 and no way to know it means pallets, which is how a work-order
              // progress bar came to divide pieces by pallets and read 160× high.
              id: true, orderNumber: true, status: true, plannedQty: true, qtyUnit: true,
              actualQty: true, goodQty: true,
              jobOrders: { select: { machine: { select: { name: true, code: true } } } },
            },
          },
        },
      }),
      this.prisma.productionOrder.count({ where }),
    ]);

    // targetQtyPieces puts the numerator and denominator of every completion figure
    // in the SAME unit. / are kept untouched for display.
    return {
      data: data.map((po) => ({
        ...po,
        targetQtyPieces: toPieces(po.targetQty, po.unit, po.sku),
        workOrders: withPlannedBase(po.workOrders, po.sku),
      })),
      total, page, limit,
    };
  }

  async findOneProductionOrder(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const po = await this.prisma.productionOrder.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
      include: {
        sku: { select: { id: true, name: true, code: true, itemNumber: true, brand: true, weight: true, weightUnit: true, packagingType: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } },
        workOrders: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
          include: {
            jobOrders: { select: { machine: { select: { id: true, name: true, code: true } } } },
            operator: { select: { id: true, name: true } },
            inspectionResults: {
              select: { id: true, inspectionNumber: true, type: true, result: true, totalQty: true, passQty: true, failQty: true, inspectedAt: true },
              orderBy: { inspectedAt: 'desc' },
              take: 5,
            },
          },
        },
      },
    });
    if (!po) throw new NotFoundException('Production order not found');
    return {
      ...po,
      targetQtyPieces: toPieces(po.targetQty, po.unit, po.sku),
      workOrders: withPlannedBase(po.workOrders, po.sku),
    };
  }

  async updateProductionOrder(factoryId: string | null, id: string, dto: UpdateProductionOrderDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const po = await this.prisma.productionOrder.findFirst({ where: { id, ...factoryFilter, deletedAt: null } });
    if (!po) throw new NotFoundException('Production order not found');
    if (['COMPLETED', 'CANCELLED'].includes(po.status)) {
      throw new BadRequestException(`Cannot modify a ${po.status} production order`);
    }

    return this.prisma.productionOrder.update({
      where: { id },
      data: {
        ...(dto.targetQty && { targetQty: dto.targetQty }),
        // `unit` is the rung `targetQty` is counted on, so the two travel
        // together — accepting it in the DTO without writing it here would
        // have swapped one silent failure for another: the save succeeds, the
        // dropdown snaps back, and nobody can say why.
        ...(dto.unit && { unit: dto.unit }),
        ...(dto.priority && { priority: dto.priority as any }),
        ...(dto.plannedStart && { plannedStart: new Date(dto.plannedStart) }),
        ...(dto.plannedEnd && { plannedEnd: new Date(dto.plannedEnd) }),
        ...(dto.customer !== undefined && { customer: dto.customer }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      },
      include: { sku: { select: { name: true, code: true } } },
    });
  }

  async releaseProductionOrder(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const po = await this.prisma.productionOrder.findFirst({ where: { id, ...factoryFilter, deletedAt: null } });
    if (!po) throw new NotFoundException('Production order not found');
    if (po.status !== 'PLANNED') throw new BadRequestException(`Only PLANNED orders can be released (current: ${po.status})`);

    return this.prisma.productionOrder.update({ where: { id }, data: { status: 'RELEASED' } });
  }

  async createWorkOrderFromPO(factoryId: string | null, userId: string, poId: string, dto: CreateWOFromPODto) {
    if (!factoryId) throw new BadRequestException('Factory context required');
    const factoryFilter = { factoryId };

    const po = await this.prisma.productionOrder.findFirst({
      where: { id: poId, ...factoryFilter, deletedAt: null }, include: { sku: true },
    });

    if (!po) throw new NotFoundException('Production order not found');
    if (po.status === 'CANCELLED') throw new BadRequestException('Cannot create WO for a cancelled production order');
    if (!po.skuId) throw new BadRequestException('Production order has no SKU assigned');

    // Generate WO number: WO-{YYYY}-{seq} — collision-safe (max suffix + 1).
    const year = new Date().getFullYear();
    const orderNumber = await this.nextYearlyWONumber(year);

    const wo = await this.prisma.workOrder.create({
      data: {
        factoryId,
        productionOrderId: poId,
        skuId: po.skuId,
        orderNumber,
        status: 'PLANNED',
        priority: (dto.priority ?? po.priority) as any,
        plannedQty: dto.plannedQty,
        plannedStart: new Date(dto.plannedStart),
        plannedEnd: new Date(dto.plannedEnd),
        operatorId: dto.operatorId,
        notes: dto.notes,
        createdById: userId,
      },
    });

    // Routed dispatch list across every machine in the product's process. Blocks
    // when the product has no approved process; roll back to avoid an orphan WO.
    try {
      await this.generateJobOrders(factoryId, wo.id, {
        plannedStart: dto.plannedStart,
        plannedEnd: dto.plannedEnd,
        clearExisting: false,
      });
    } catch (err) {
      await this.prisma.workOrder.delete({ where: { id: wo.id } }).catch(() => undefined);
      throw err;
    }

    // Update PO status to IN_PROGRESS if RELEASED
    if (po.status === 'RELEASED') {
      await this.prisma.productionOrder.update({ where: { id: poId }, data: { status: 'IN_PROGRESS', actualStart: new Date() } });
    }

    this.logger.log(`WO ${orderNumber} created from PO ${po.orderNumber}`);
    return this.getWorkOrderById(factoryId, wo.id);
  }

  async cancelProductionOrder(factoryId: string | null, id: string, reason: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const po = await this.prisma.productionOrder.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
      include: { workOrders: { where: { status: 'IN_PROGRESS', deletedAt: null } } },
    });
    if (!po) throw new NotFoundException('Production order not found');
    if (po.status === 'COMPLETED') throw new BadRequestException('Cannot cancel a completed production order');
    if (po.workOrders.length > 0) throw new BadRequestException('Cannot cancel PO with in-progress work orders');

    return this.prisma.productionOrder.update({
      where: { id },
      data: { status: 'CANCELLED', notes: po.notes ? `${po.notes}\n[Cancelled: ${reason}]` : `[Cancelled: ${reason}]` },
    });
  }

  async holdProductionOrder(factoryId: string | null, id: string, reason: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const po = await this.prisma.productionOrder.findFirst({ where: { id, ...factoryFilter, deletedAt: null } });
    if (!po) throw new NotFoundException('Production order not found');
    if (!['RELEASED', 'IN_PROGRESS'].includes(po.status)) {
      throw new BadRequestException(`Cannot hold a ${po.status} production order`);
    }
    return this.prisma.productionOrder.update({
      where: { id },
      data: { status: 'ON_HOLD', notes: po.notes ? `${po.notes}\n[Hold: ${reason}]` : `[Hold: ${reason}]` },
    });
  }

  async resumeProductionOrder(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const po = await this.prisma.productionOrder.findFirst({ where: { id, ...factoryFilter, deletedAt: null } });
    if (!po) throw new NotFoundException('Production order not found');
    if (po.status !== 'ON_HOLD') throw new BadRequestException('Only ON_HOLD orders can be resumed');
    // Resume: if actual start exists → IN_PROGRESS, otherwise → RELEASED
    const resumeStatus = po.actualStart ? 'IN_PROGRESS' : 'RELEASED';
    return this.prisma.productionOrder.update({ where: { id }, data: { status: resumeStatus } });
  }

  async completeProductionOrder(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const po = await this.prisma.productionOrder.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
      include: { workOrders: { where: { deletedAt: null } } },
    });
    if (!po) throw new NotFoundException('Production order not found');
    if (po.status !== 'IN_PROGRESS') throw new BadRequestException(`Only IN_PROGRESS orders can be completed (current: ${po.status})`);

    const completedQty = po.workOrders.reduce((s, w) => s + (w.goodQty || 0), 0);
    return this.prisma.productionOrder.update({
      where: { id },
      data: { status: 'COMPLETED', actualEnd: new Date(), completedQty },
    });
  }

  /**
   * Remove a production order and CASCADE to its work orders + job orders.
   * Per the production rule:
   *   • A WO that has NOT started → deleted (its job orders go with it).
   *   • A WO that HAS started → archived (history preserved).
   *   • The PO itself is archived if ANY of its WOs had started, else deleted.
   * Job orders are never orphaned — the dispatch list filters out JOs whose WO is
   * deleted/archived.
   */
  async deleteProductionOrder(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const po = await this.prisma.productionOrder.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
      include: { workOrders: { where: { deletedAt: null }, select: { id: true, status: true, actualStart: true } } },
    });
    if (!po) throw new NotFoundException('Production order not found');

    const isStarted = (w: { status: string; actualStart: Date | null }) =>
      !!w.actualStart || ['IN_PROGRESS', 'COMPLETED'].includes(w.status);
    const anyStarted = po.workOrders.some(isStarted);

    const now = new Date();
    // Archive started WOs (preserve history); hard-delete the not-started ones
    // together with all their job orders so nothing related is left behind.
    const notStartedIds = po.workOrders.filter((w) => !isStarted(w)).map((w) => w.id);
    for (const w of po.workOrders.filter(isStarted)) {
      await this.prisma.workOrder.update({ where: { id: w.id }, data: { archivedAt: now } });
    }
    await this.purgeWorkOrders(notStartedIds);

    if (anyStarted) {
      await this.prisma.productionOrder.update({ where: { id }, data: { archivedAt: now } });
      this.logger.log(`PO ${po.orderNumber} archived (${notStartedIds.length} not-started WO(s) purged, others archived)`);
      return { action: 'archived' as const };
    }
    // Nothing started → the PO and all its WOs/JOs are gone; remove the PO too.
    await this.prisma.productionOrder.delete({ where: { id } });
    this.logger.log(`PO ${po.orderNumber} deleted with ${po.workOrders.length} not-started WO(s) and their job orders`);
    return { action: 'deleted' as const };
  }

  // ─────────────────────────────────────────────────────────────
  // AUTO-GENERATE WORK ORDERS (ISA-95 — Recipe + Routing driven)
  // ─────────────────────────────────────────────────────────────

  /** Look up the StepDependency type between two routing steps.
   *  Returns 'FINISH_TO_START' (default) when no explicit record exists. */
  private async lookupDepType(
    fromStepId: string | null | undefined,
    toStepId: string | null | undefined,
  ): Promise<string> {
    if (!fromStepId || !toStepId) return 'FINISH_TO_START';
    const dep = await this.prisma.stepDependency.findFirst({
      where: { fromStepId, toStepId },
      select: { type: true },
    });
    return dep?.type ?? 'FINISH_TO_START';
  }

  /** Resolve the best machine for a routing step when machineId is null.
   *  Three attempts: name-prefix match → machine-name-in-WC-name → code-suffix match */
  private async resolveStepMachine(
    step: { machineId?: string | null; machine?: any; workCenterId?: string | null; workCenterRef?: any },
    factoryId: string | null,
  ): Promise<{ id: string; name: string; code: string; machineType: string } | null> {
    if (step.machine) return step.machine;

    const wc = step.workCenterRef;
    if (!wc) return null;

    const baseWhere = factoryId ? { factoryId, isActive: true } : { isActive: true };
    const sel = { id: true, name: true, code: true, machineType: true } as const;

    // Attempt 1: stripped WorkCenter name contained in machine name
    const stripped = wc.name
      .replace(/\s+cell$/i, '')
      .replace(/\s+work\s*center$/i, '')
      .trim();

    const m1 = await this.prisma.machine.findFirst({
      where: { ...baseWhere, name: { contains: stripped, mode: 'insensitive' } },
      select: sel,
    });
    if (m1) return m1;

    // Attempt 2: machine name contained within WorkCenter name
    const all = await this.prisma.machine.findMany({ where: baseWhere, select: sel });
    const m2 = all.find((m) => wc.name.toLowerCase().includes(m.name.toLowerCase())) ?? null;
    if (m2) return m2;

    // Attempt 3: WorkCenter code suffix (after "WC-") matches machine code
    const wcSuffix = (wc.code as string).replace(/^WC-/i, '');
    if (wcSuffix) {
      const m3 = all.find(
        (m) =>
          m.code.toLowerCase().includes(wcSuffix.toLowerCase()) ||
          wcSuffix.toLowerCase().includes(m.code.replace(/^SDPF-M\d+-/i, '').toLowerCase()),
      ) ?? null;
      if (m3) return m3;
    }

    return null;
  }

  /**
   * Latest moment the machine is occupied within/over [from, to]:
   * max planned end of active job orders overlapping the window and
   * end of overlapping planned downtime. null = machine is idle.
   */
  private async machineBusyUntil(machineId: string, from: Date, to: Date): Promise<Date | null> {
    const [busyJo, plannedDt] = await Promise.all([
      this.prisma.jobOrder.findFirst({
        where: {
          machineId,
          status: { in: ['SCHEDULED', 'READY', 'EXECUTING', 'PAUSED'] },
          plannedStart: { lt: to },
          plannedEnd: { gt: from },
        },
        orderBy: { plannedEnd: 'desc' },
        select: { plannedEnd: true },
      }),
      this.prisma.downtimeEvent.findFirst({
        where: {
          machineId,
          isPlanned: true,
          startTime: { lt: to },
          OR: [{ endTime: null }, { endTime: { gt: from } }],
        },
        orderBy: { endTime: 'desc' },
        select: { endTime: true },
      }),
    ]);
    const ends = [busyJo?.plannedEnd, plannedDt?.endTime].filter(Boolean) as Date[];
    if (ends.length === 0) return null;
    return new Date(Math.max(...ends.map((d) => d.getTime())));
  }

  /**
   * Intelligent workcenter allocation.
   * Candidates = the step's machine options (priority 0 = primary/default).
   * The default wins when idle in the planned window; otherwise every candidate
   * is scored earliest-finish (wait + setup + run) and the best ready machine wins.
   * Steps without options fall back to the legacy machine/WorkCenter resolution.
   */
  private async pickStepMachine(
    step: {
      machineId?: string | null;
      machine?: { id: string; name: string; code: string } | null;
      workCenterId?: string | null;
      workCenterRef?: unknown;
      cycleTimeSec?: number | null;
      machineOptions?: Array<{
        machineId: string;
        priority: number;
        isDefault: boolean;
        cycleTimeSec: number | null;
        setupTimeMins: number | null;
        machine: { id: string; name: string; code: string };
      }>;
    },
    factoryId: string | null,
    plannedStart: Date,
    plannedEnd: Date,
    qtyOut: number,
  ): Promise<{ machineId: string | null; cycleOverrideSec: number | null; reason: string }> {
    const options = (step.machineOptions ?? []).slice().sort((a, b) => a.priority - b.priority);

    if (options.length === 0) {
      // Legacy path: explicit machine or WorkCenter name-matching heuristic
      if (step.machineId) return { machineId: step.machineId, cycleOverrideSec: null, reason: 'MANUAL' };
      const resolved = await this.resolveStepMachine(step as any, factoryId);
      return { machineId: resolved?.id ?? null, cycleOverrideSec: null, reason: resolved ? 'HEURISTIC' : 'UNASSIGNED' };
    }

    const def = options.find((o) => o.isDefault) ?? options[0];

    // Score every candidate: wait (busy window) + setup (changeover) + run
    const scored = await Promise.all(options.map(async (o) => {
      const cycleSec = o.cycleTimeSec ?? step.cycleTimeSec ?? 60;
      const runMs = Math.max(0, qtyOut) * cycleSec * 1000;
      const busyUntil = await this.machineBusyUntil(o.machineId, plannedStart, plannedEnd);
      const waitMs = busyUntil ? Math.max(0, busyUntil.getTime() - plannedStart.getTime()) : 0;
      const setupMs = (o.setupTimeMins ?? 0) * 60_000;
      return { option: o, busyUntil, waitMs, score: waitMs + setupMs + runMs };
    }));

    const defScored = scored.find((s) => s.option.machineId === def.machineId)!;
    if (defScored.waitMs === 0) {
      return {
        machineId: def.machineId,
        cycleOverrideSec: def.cycleTimeSec,
        reason: 'DEFAULT_IDLE',
      };
    }

    const best = scored.reduce((a, b) => (b.score < a.score ? b : a));
    if (best.option.machineId === def.machineId) {
      return {
        machineId: def.machineId,
        cycleOverrideSec: def.cycleTimeSec,
        reason: `DEFAULT_BUSY_KEPT (busy until ${defScored.busyUntil?.toISOString() ?? '?'}, still earliest finish)`,
      };
    }
    return {
      machineId: best.option.machineId,
      cycleOverrideSec: best.option.cycleTimeSec,
      reason: `DEFAULT_BUSY_ALT_SELECTED (${best.option.machine.code}; default busy until ${defScored.busyUntil?.toISOString() ?? '?'})`,
    };
  }

  /** Map an operation name to its output unit (PIECE → CARTON → PALLET). */
  private resolveStepOutputUnit(operationName: string, prevUnit: string): string {
    const op = operationName.toLowerCase();
    if (/carton(?:ing)?|cartonPacker|boxing|carto\b/.test(op)) return 'CARTON';
    if (/palletiz(?:ing|er)?|palletis(?:ing|er)?|robot|stacking/.test(op)) return 'PALLET';
    // wrapping keeps the same unit (pallet stays pallet after shrink-wrap)
    return prevUnit;
  }

  /**
   * Convert a quantity between packaging-hierarchy units using the SKU spec:
   * PCS/PIECE → INNER (÷unitsPerInner) → CARTON (÷innersPerCarton) → PALLET (÷cartonsPerPallet).
   * This powers per-step qty flow AND duration = qtyOut × cycleTimeSec in scheduling.
   */
  private convertUnits(
    qty: number,
    fromUnit: string,
    toUnit: string,
    pkg: { unitsPerInner: number; innersPerCarton: number; cartonsPerPallet: number },
  ): number {
    // The ladder arithmetic lives in ONE place (common/units.util.ts). This wrapper
    // adds only the planning-specific rounding: a job order cannot be issued for
    // 0.5 of a carton, and rounding UP when moving to a coarser unit guarantees the
    // step still produces enough to satisfy the next one.
    if (!isConvertibleUnit(fromUnit) || !isConvertibleUnit(toUnit)) return qty;
    const converted = convertUnits(qty, fromUnit, toUnit, pkg);
    if (converted === qty) return qty;
    const coarser = piecesPer(pkg)[normaliseUnit(toUnit)!] > piecesPer(pkg)[normaliseUnit(fromUnit)!];
    return coarser ? Math.ceil(converted) : Math.round(converted);
  }

  /**
   * The same conversion WITHOUT the planning rounding.
   *
   * `convertUnits` above ceils when it coarsens, because a job order cannot be
   * issued for part of a pallet. That is right for the quantity and wrong for
   * the clock: the palletiser only ever sees 1500 cartons, so quoting it for a
   * ceiled 24 pallets bought 187 minutes of estimate for 180 minutes of work.
   * See step-duration.ts.
   */
  private exactUnits(
    qty: number,
    fromUnit: string,
    toUnit: string,
    pkg: { unitsPerInner: number; innersPerCarton: number; cartonsPerPallet: number },
  ): number {
    if (!isConvertibleUnit(fromUnit) || !isConvertibleUnit(toUnit)) return qty;
    return convertUnits(qty, fromUnit, toUnit, pkg);
  }

  /** Calculate the expected output quantity when the unit changes between steps. */
  private calcOutputQty(
    outputUnit: string,
    prevUnit: string,
    prevQty: number,
    pkg: { unitsPerInner: number; innersPerCarton: number; cartonsPerPallet: number },
  ): number {
    return this.convertUnits(prevQty, prevUnit, outputUnit, pkg);
  }

  async previewAutoGenerateWOs(factoryId: string | null, poId: string, fromIso?: string): Promise<any> {
    const factoryFilter = factoryId ? { factoryId } : {};
    const po = await this.prisma.productionOrder.findFirst({
      where: { id: poId, ...factoryFilter, deletedAt: null },
      include: { sku: true },
    });
    if (!po) throw new NotFoundException('Production order not found');
    if (!po.skuId) throw new BadRequestException('Production order has no SKU assigned');
    if (!['RELEASED', 'IN_PROGRESS'].includes(po.status)) {
      throw new BadRequestException(
        `Release the PO first before auto-generating (current: ${po.status})`,
      );
    }

    const stepIncludes = {
      where: { isOptional: false },
      orderBy: { stepNumber: 'asc' } as const,
      include: {
        machine: { select: { id: true, name: true, code: true, machineType: true } },
        workCenterRef: { select: { id: true, name: true, code: true, level: true } },
        // Typed precedence (FS/SS/SF/FF + lag) — drives overlap-aware scheduling
        predecessors: { select: { fromStepId: true, type: true, lagMins: true } },
      },
    };

    // APPROVED recipe first, then REVIEW as fallback
    const recipe: any = await this.prisma.recipe.findFirst({
      where: { skuId: po.skuId, status: { in: ['APPROVED', 'REVIEW'] as any }, ...factoryFilter },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { process: { include: { routingSteps: stepIncludes } } },
    });

    // Canonical scope-chain resolution (PRODUCT → LIST → CATEGORY → BASE_WEIGHT):
    // scoped routings (e.g. "2.25 Kg Standard Process") apply to this product
    // through their covered product ids, not a direct skuId column match.
    const process: any = recipe?.process ?? await findProcessForSku<any>(
      this.prisma, factoryId, po.skuId, { routingSteps: stepIncludes as any },
    );

    const rawSteps: any[] = (process?.routingSteps ?? []).filter((s: any) => !s.isOptional);

    // Packaging specs for unit-flow calculation
    const skuPkg = {
      unitsPerInner: (po.sku as any)?.unitsPerInner ?? 1,
      innersPerCarton: (po.sku as any)?.innersPerCarton ?? 1,
      cartonsPerPallet: (po.sku as any)?.cartonsPerPallet ?? 1,
    };
    // Normalise the order quantity to PIECES for the step-by-step flow.
    //
    // This used to be a hand-written if-chain that understood CARTON and PALLET and
    // let EVERY other unit fall through as if it were already pieces — so ordering in
    // INNER (which the routing steps actually use) silently produced the wrong
    // quantity, and BOX/KG from the UI dropdown did too, with no error. The shared
    // converter knows the whole ladder; anything off-ladder is rejected outright
    // rather than mis-planned.
    const poUnit = (po as any).unit ?? 'PIECE';
    if (!isConvertibleUnit(poUnit)) {
      throw new BadRequestException(
        `Production order unit "${poUnit}" is not a packaging unit, so it cannot be converted into `
        + `routing-step quantities. Use one of: ${UNIT_LADDER.join(', ')}.`,
      );
    }
    let prevQty = toPieces(po.targetQty, poUnit, skuPkg);
    let prevUnit = 'PIECE';

    // Sequential loop — prevQty/prevUnit must flow step-to-step.
    // Explicit step In/Out units win; the operation-name heuristic is the
    // legacy fallback. Duration = qtyOut × cycleTimeSec (+ setup).
    const jobOrdersToCreate: any[] = [];
    // Two chains, deliberately. `prevQty` is what gets ISSUED, rounded so no
    // job order asks for part of a pallet. `exactQty` is what actually passes
    // through the machines, and it is the only one the clock may use.
    let exactQty = prevQty;
    let exactUnit = prevUnit;
    for (const step of rawSteps) {
      const resolvedMachine = await this.resolveStepMachine(step as any, factoryId);
      const inputUnit  = (step as any).inUnit ?? prevUnit;
      const outputUnit = (step as any).outUnit ?? this.resolveStepOutputUnit((step as any).operationName, inputUnit);
      const inputQty   = this.convertUnits(prevQty, prevUnit, inputUnit, skuPkg);
      const outputQty  = this.convertUnits(inputQty, inputUnit, outputUnit, skuPkg);

      const exactIn  = this.exactUnits(exactQty, exactUnit, inputUnit, skuPkg);
      const exactOut = this.exactUnits(exactIn, inputUnit, outputUnit, skuPkg);

      prevUnit = outputUnit;
      prevQty  = outputQty;
      exactUnit = outputUnit;
      exactQty  = exactOut;

      const cycleSec: number | null = (step as any).cycleTimeSec
        ?? ((step as any).cycleTimeMins != null ? (step as any).cycleTimeMins * 60 : null);

      jobOrdersToCreate.push({
        stepId: (step as any).id,
        stepNumber: (step as any).stepNumber,
        operationName: (step as any).operationName,
        machine: resolvedMachine
          ? { id: resolvedMachine.id, name: resolvedMachine.name, code: resolvedMachine.code }
          : null,
        workCenter: (step as any).workCenterRef
          ? { name: (step as any).workCenterRef.name, code: (step as any).workCenterRef.code }
          : null,
        plannedQtyIn: inputQty,
        inputUnit,
        plannedQtyOut: outputQty,
        outputUnit,
        cycleTimeSec: cycleSec,
        // exactOut, NOT outputQty: the issued quantity carries a ceiling that
        // belongs to packaging, not to how long the machine runs.
        estimatedDurationMins: stepDurationMins(exactOut, cycleSec, (step as any).setupTimeMins ?? 0)
          ?? (process?.totalCycleTimeMins && rawSteps.length
            ? process.totalCycleTimeMins / rawSteps.length
            : null),
        setupTimeMins: (step as any).setupTimeMins ?? 0,
        // precedence for the overlap-aware finish-time estimate
        predecessors: (step as any).predecessors ?? [],
      });
    }

    // ── Smart finish-time: schedule the steps respecting their relationships
    // (overlap where SS/FF allow), seed each machine with its existing plan,
    // then add the planned stoppage (breaks/cleaning/planned downtime) that
    // intersects the run window. Surfaces a realistic completion time. ──
    const horizon = fromIso ? new Date(fromIso).getTime() : (po.plannedStart ? +po.plannedStart : Date.now());
    // The order's own cleaning / startup / changeover. Booked from the ACTUAL
    // start, so an order that has not begun has none of them on the calendar --
    // the estimate has to read the plan itself. See plannedStoppageMins.
    const orderStops = await this.prisma.productionOrderStop.findMany({
      where: { productionOrderId: po.id, isActive: true },
      orderBy: { sequence: 'asc' },
    }) as unknown as StopPlanItem[];
    let smart: {
      computedFinish: string | null;
      workContentMins: number;
      plannedStoppageMins: number;
      totalDurationMins: number;
      exceedsDue: boolean;
      dueDate: string | null;
    } | null = null;
    if (jobOrdersToCreate.length > 0) {
      const machineIds = [...new Set(jobOrdersToCreate.map((s) => s.machine?.id).filter(Boolean) as string[])];
      const machineFree = await this.seedMachineFree(factoryId, machineIds, horizon);
      const calendar = await this.buildWorkCalendar(factoryId);
      const ops: SchedOp[] = jobOrdersToCreate.map((s) => {
        const dep = (s.predecessors ?? []).find((d: any) => jobOrdersToCreate.some((x) => x.stepId === d.fromStepId));
        return {
          id: s.stepId,
          machineId: s.machine?.id ?? null,
          durationMs: Math.max((s.estimatedDurationMins ?? 5) * 60_000, 60_000),
          predecessorId: dep?.fromStepId ?? null,
          predecessorType: (dep?.type ?? 'FINISH_TO_START') as any,
          predecessorLagMins: dep?.lagMins ?? 0,
          sequenceOrder: s.stepNumber,
        };
      });
      // No routed deps → fall back to a sequential FS chain by step order
      if (ops.every((o) => !o.predecessorId)) {
        const bySeq = [...ops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        for (let i = 1; i < bySeq.length; i++) {
          bySeq[i].predecessorId = bySeq[i - 1].id;
          bySeq[i].predecessorType = 'FINISH_TO_START' as any;
        }
      }
      const sched = scheduleOps(ops, horizon, machineFree, calendar);
      const workContentMins = Math.round((sched.finish - horizon) / 60_000);
      const stoppage = await this.plannedStoppageMins(factoryId, horizon, sched.finish, machineIds, orderStops);
      const totalDurationMins = workContentMins + stoppage;
      const computedFinishMs = horizon + totalDurationMins * 60_000;
      // Attach the computed window onto each step for the preview table
      for (const s of jobOrdersToCreate) {
        const st = sched.start.get(s.stepId);
        const en = sched.end.get(s.stepId);
        s.plannedStart = st != null ? new Date(st).toISOString() : null;
        s.plannedEnd = en != null ? new Date(en).toISOString() : null;
      }
      const dueMs = po.plannedEnd ? +po.plannedEnd : null;
      smart = {
        computedFinish: new Date(computedFinishMs).toISOString(),
        workContentMins,
        plannedStoppageMins: stoppage,
        totalDurationMins,
        exceedsDue: dueMs != null && computedFinishMs > dueMs,
        dueDate: dueMs != null ? new Date(dueMs).toISOString() : null,
      };
    }

    const existingWOCount = await this.prisma.workOrder.count({
      where: { productionOrderId: poId, deletedAt: null },
    });

    if (jobOrdersToCreate.length === 0) {
      const fallback = await this.prisma.machine.findFirst({
        where: { ...(factoryId ? { factoryId } : {}), isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      return {
        recipe: recipe ? { id: recipe.id, code: recipe.code, version: recipe.version, name: recipe.name, status: recipe.status } : null,
        process: null,
        jobOrdersToCreate: fallback
          ? [{ stepNumber: 1, operationName: 'Production Run', machine: { id: fallback.id, name: fallback.name }, plannedQty: po.targetQty, estimatedDurationMins: null }]
          : [],
        workOrdersToCreate: fallback
          ? [{ stepNumber: 1, operationName: 'Production Run', machine: { id: fallback.id, name: fallback.name }, plannedQty: po.targetQty, estimatedDurationMins: null }]
          : [],
        existingWOCount,
        canGenerate: !!fallback,
        warning: 'No routing steps found — will create a single work order on the primary machine.',
        mode: 'fallback',
      };
    }

    const warnings: string[] = [];
    if (recipe?.status && recipe.status !== 'APPROVED') {
      warnings.push(`Recipe ${recipe.code} is in "${recipe.status}" status — not yet approved for production.`);
    }
    if (!recipe) {
      warnings.push('No recipe found — using manufacturing process routing only.');
    }
    if (existingWOCount > 0) {
      warnings.push(`This PO already has ${existingWOCount} work order(s).`);
    }
    const noMachine = jobOrdersToCreate.filter((s) => !s.machine);
    if (noMachine.length > 0) {
      warnings.push(
        `${noMachine.length} step(s) have no machine resolved (${noMachine.map((s) => s.operationName).join(', ')}). Assign machines after generation.`,
      );
    }

    return {
      recipe: recipe ? { id: recipe.id, code: recipe.code, version: recipe.version, name: recipe.name, status: recipe.status } : null,
      process: process ? { id: process.id, name: process.name, version: process.version, scopeType: process.scopeType, totalCycleTimeMins: process.totalCycleTimeMins } : null,
      // ISA-95: 1 Work Order + N Job Orders (dispatch list)
      jobOrdersToCreate,
      workOrdersToCreate: jobOrdersToCreate, // kept for backward compat
      existingWOCount,
      canGenerate: true,
      warning: warnings.length > 0 ? warnings.join(' | ') : null,
      mode: 'dispatch', // signals the UI that we create 1 WO + N JOs
      smart, // computed finish time + planned-stoppage breakdown + exceedsDue
    };
  }

  /**
   * Preview for a MANUAL work order (no production order): resolve the routing for
   * a SKU + quantity, compute the overlap-aware smart finish time, and the material
   * shortages — the same intelligence the PO auto-generate preview gives, so the
   * manual "Create Work Order" form can show the realistic end + step plan + any
   * material shortage before the WO is created.
   */
  async previewWorkOrderForSku(
    factoryId: string | null,
    skuId: string,
    qty: number,
    unit: string | undefined,
    fromIso?: string,
  ): Promise<any> {
    const factoryFilter = factoryId ? { factoryId } : {};
    const sku: any = await this.prisma.sKU.findFirst({ where: { id: skuId, ...factoryFilter } });
    if (!sku) throw new NotFoundException('Product (SKU) not found');
    if (!(qty > 0)) throw new BadRequestException('Quantity must be greater than zero');

    const stepIncludes = {
      where: { isOptional: false },
      orderBy: { stepNumber: 'asc' } as const,
      include: {
        machine: { select: { id: true, name: true, code: true, machineType: true } },
        workCenterRef: { select: { id: true, name: true, code: true, level: true } },
        predecessors: { select: { fromStepId: true, type: true, lagMins: true } },
        materials: { include: { rawMaterial: { select: { id: true, code: true, name: true, unit: true, currentStock: true, reservedStock: true } } } },
      },
    };

    const recipe: any = await this.prisma.recipe.findFirst({
      where: { skuId, status: { in: ['APPROVED', 'REVIEW'] as any }, ...factoryFilter },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      include: { process: { include: { routingSteps: stepIncludes } } },
    });
    const process: any = recipe?.process ?? await findProcessForSku<any>(
      this.prisma, factoryId, skuId, { routingSteps: stepIncludes as any },
    );
    const rawSteps: any[] = (process?.routingSteps ?? []).filter((s: any) => !s.isOptional);

    const skuPkg = {
      unitsPerInner: sku.unitsPerInner ?? 1,
      innersPerCarton: sku.innersPerCarton ?? 1,
      cartonsPerPallet: sku.cartonsPerPallet ?? 1,
    };
    const ppc = Math.max(1, skuPkg.unitsPerInner * skuPkg.innersPerCarton);
    let prevQty = unit === 'CARTON' ? qty * ppc : unit === 'PALLET' ? qty * ppc * skuPkg.cartonsPerPallet : qty;
    let prevUnit = 'PIECE';

    const round3 = (x: number) => Math.round(x * 1000) / 1000;
    const demand = new Map<string, { qty: number; code: string; name: string; unit: string; available: number }>();
    const jobOrdersToCreate: any[] = [];
    // Same two chains as previewAutoGenerateWOs: what is ISSUED carries the
    // packaging ceiling, what is WORKED does not. See step-duration.ts.
    let exactQty = prevQty;
    let exactUnit = prevUnit;
    for (const step of rawSteps) {
      const resolvedMachine = await this.resolveStepMachine(step as any, factoryId);
      const inputUnit = (step as any).inUnit ?? prevUnit;
      const outputUnit = (step as any).outUnit ?? this.resolveStepOutputUnit((step as any).operationName, inputUnit);
      const inputQty = this.convertUnits(prevQty, prevUnit, inputUnit, skuPkg);
      const outputQty = this.convertUnits(inputQty, inputUnit, outputUnit, skuPkg);
      const exactIn = this.exactUnits(exactQty, exactUnit, inputUnit, skuPkg);
      const exactOut = this.exactUnits(exactIn, inputUnit, outputUnit, skuPkg);
      prevUnit = outputUnit;
      prevQty = outputQty;
      exactUnit = outputUnit;
      exactQty = exactOut;
      const cycleSec: number | null = (step as any).cycleTimeSec ?? ((step as any).cycleTimeMins != null ? (step as any).cycleTimeMins * 60 : null);

      // Aggregate material demand from this step's routing materials.
      for (const m of (step as any).materials ?? []) {
        if (!m.rawMaterialId) continue;
        const add = (m.qtyPerOutputUnit ?? 0) * outputQty;
        const rm = m.rawMaterial;
        const cur = demand.get(m.rawMaterialId);
        if (cur) cur.qty = round3(cur.qty + add);
        else demand.set(m.rawMaterialId, { qty: round3(add), code: rm?.code ?? m.materialCode ?? '', name: rm?.name ?? m.name ?? '', unit: rm?.unit ?? m.unit ?? '', available: rm ? round3((rm.currentStock ?? 0) - (rm.reservedStock ?? 0)) : 0 });
      }

      jobOrdersToCreate.push({
        stepId: (step as any).id,
        stepNumber: (step as any).stepNumber,
        operationName: (step as any).operationName,
        machine: resolvedMachine ? { id: resolvedMachine.id, name: resolvedMachine.name, code: resolvedMachine.code } : null,
        plannedQtyIn: inputQty,
        inputUnit,
        plannedQtyOut: outputQty,
        outputUnit,
        cycleTimeSec: cycleSec,
        estimatedDurationMins: stepDurationMins(exactOut, cycleSec, (step as any).setupTimeMins ?? 0)
          ?? (process?.totalCycleTimeMins && rawSteps.length ? process.totalCycleTimeMins / rawSteps.length : null),
        setupTimeMins: (step as any).setupTimeMins ?? 0,
        predecessors: (step as any).predecessors ?? [],
      });
    }

    // Smart finish time (overlap-aware), identical engine to the PO preview.
    const horizon = fromIso ? new Date(fromIso).getTime() : Date.now();
    let smart: any = null;
    if (jobOrdersToCreate.length > 0) {
      const machineIds = [...new Set(jobOrdersToCreate.map((s) => s.machine?.id).filter(Boolean) as string[])];
      const machineFree = await this.seedMachineFree(factoryId, machineIds, horizon);
      const calendar = await this.buildWorkCalendar(factoryId);
      const ops: SchedOp[] = jobOrdersToCreate.map((s) => {
        const dep = (s.predecessors ?? []).find((d: any) => jobOrdersToCreate.some((x) => x.stepId === d.fromStepId));
        return {
          id: s.stepId,
          machineId: s.machine?.id ?? null,
          durationMs: Math.max((s.estimatedDurationMins ?? 5) * 60_000, 60_000),
          predecessorId: dep?.fromStepId ?? null,
          predecessorType: (dep?.type ?? 'FINISH_TO_START') as any,
          predecessorLagMins: dep?.lagMins ?? 0,
          sequenceOrder: s.stepNumber,
        };
      });
      if (ops.every((o) => !o.predecessorId)) {
        const bySeq = [...ops].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        for (let i = 1; i < bySeq.length; i++) { bySeq[i].predecessorId = bySeq[i - 1].id; bySeq[i].predecessorType = 'FINISH_TO_START' as any; }
      }
      const sched = scheduleOps(ops, horizon, machineFree, calendar);
      const workContentMins = Math.round((sched.finish - horizon) / 60_000);
      // No production order here, so no order stop plan to project -- this
      // preview answers "what would this SKU take", not "what will THIS order do".
      const stoppage = await this.plannedStoppageMins(factoryId, horizon, sched.finish, machineIds);
      const totalDurationMins = workContentMins + stoppage;
      const computedFinishMs = horizon + totalDurationMins * 60_000;
      for (const s of jobOrdersToCreate) {
        const stt = sched.start.get(s.stepId); const en = sched.end.get(s.stepId);
        s.plannedStart = stt != null ? new Date(stt).toISOString() : null;
        s.plannedEnd = en != null ? new Date(en).toISOString() : null;
      }
      smart = { computedFinish: new Date(computedFinishMs).toISOString(), workContentMins, plannedStoppageMins: stoppage, totalDurationMins };
    }

    // Material shortages (current − reserved vs gross requirement).
    const materialShortages = [...demand.values()]
      .filter((d) => d.qty > d.available + 1e-6)
      .map((d) => ({ code: d.code, name: d.name, unit: d.unit, needed: d.qty, available: Math.max(0, d.available), short: round3(d.qty - d.available) }));

    return {
      sku: { id: sku.id, code: sku.code, name: sku.name, itemNumber: sku.itemNumber, baseUnit: sku.baseUnit },
      recipe: recipe ? { id: recipe.id, code: recipe.code, version: recipe.version, name: recipe.name, status: recipe.status } : null,
      process: process ? { id: process.id, name: process.name, version: process.version } : null,
      jobOrdersToCreate,
      stepCount: jobOrdersToCreate.length,
      canGenerate: jobOrdersToCreate.length > 0,
      smart,
      materialShortages,
      warning: jobOrdersToCreate.length === 0 ? 'No approved routing/process found for this product — a single-step work order will be created on a default machine.' : null,
    };
  }

  /** Working-time calendar from shift templates — skips the rest day(s) / holidays. */
  private async buildWorkCalendar(factoryId: string | null) {
    const shifts = await this.prisma.shiftTemplate.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: { days: true },
    });
    const workingDays = [...new Set(
      shifts.flatMap((s) => (Array.isArray(s.days) ? (s.days as number[]) : [])),
    )];
    return makeWorkCalendar(workingDays);
  }

  /** Seed next-free instant per machine from its existing open plan (finite capacity). */
  private async seedMachineFree(
    factoryId: string | null, machineIds: string[], horizon: number,
  ): Promise<Map<string, number>> {
    const free = new Map<string, number>();
    if (machineIds.length === 0) return free;
    const open = await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        machineId: { in: machineIds },
        status: { in: ['SCHEDULED', 'READY', 'EXECUTING', 'PAUSED'] as any },
        plannedEnd: { not: null },
      },
      select: { machineId: true, plannedEnd: true },
    });
    for (const j of open) {
      if (!j.machineId || !j.plannedEnd) continue;
      const e = +j.plannedEnd;
      if (e > horizon) free.set(j.machineId, Math.max(free.get(j.machineId) ?? horizon, e));
    }
    return free;
  }

  /**
   * Planned stoppage (minutes) intersecting [fromMs, toMs]: shift breaks +
   * cleaning across the shifts the window spans, plus any planned downtime
   * events that overlap. This is added on top of the work content so the
   * displayed finish time reflects real planned non-productive time.
   */
  private async plannedStoppageMins(
    factoryId: string | null, fromMs: number, toMs: number, machineIds?: string[],
    orderStops?: StopPlanItem[],
  ): Promise<number> {
    if (toMs <= fromMs) return 0;
    // ── Two sources, one union ──────────────────────────────────
    // Planned stops that have HAPPENED, or are under way, are downtime events
    // with real start times. Planned stops not yet reached are still only a
    // shift template: a break becomes an event when its shift STARTS, so a work
    // order scheduled for tomorrow looks out on a calendar with none in it and
    // reports "+0m planned stoppage" for a plant that stops an hour every
    // morning. The operator is shown a finish time the line cannot hit.
    //
    // An earlier version answered this by averaging break minutes across
    // templates and ADDING the guess to the events. Wherever a break had
    // already been materialised the same minutes counted twice, and the
    // estimate drifted later the better the plant had configured itself. That
    // is why it was removed, and this is not a return to it.
    //
    // The difference: the projection produces SPANS at real clock times, which
    // go into the same merge as the events. A break that has already become an
    // event overlaps its own projection and counts ONCE. Union, not sum —
    // exactly the rule the events themselves already needed.
    const events = await this.prisma.downtimeEvent.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        isPlanned: true,
        startTime: { lt: new Date(toMs) },
        OR: [{ endTime: null }, { endTime: { gt: new Date(fromMs) } }],
        ...(machineIds && machineIds.length ? { machineId: { in: machineIds } } : {}),
      },
      select: { startTime: true, endTime: true, durationMinutes: true },
    });

    // ── The union of the windows, not the sum of them ───────────────────────
    //
    // This figure delays a FINISH TIME, so the only question it can answer is
    // "how much wall clock does the schedule take away". Summing each event
    // answered a different one — how many machine-minutes were stopped — and on
    // this plant the two are four times apart.
    //
    // The routing's steps run start-to-start: filling, cartoning, palletising
    // and wrapping are all live at once. A line-wide stop is therefore booked
    // against every one of them, at the SAME clock times, because downtime is
    // recorded per machine. Adding those four rows made one 60-minute cleaning
    // window read as 4h of delay, and the estimate got worse the more machines
    // the line had — which is precisely backwards.
    //
    // Merged first, so overlapping windows count once and windows that do not
    // overlap still both count: if M1 stops 10:00–10:30 and M2 stops 11:00–11:30
    // the line loses an hour, and it loses half an hour if they stop together.
    const spans: Span[] = [];
    for (const e of events) {
      const s = Math.max(+e.startTime, fromMs);
      const en = Math.min(e.endTime ? +e.endTime : toMs, toMs);
      if (en > s) spans.push([s, en]);
    }

    // The breaks the shift calendar says are coming, whether or not anything
    // has booked them yet.
    const templates = await this.prisma.shiftTemplate.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      select: {
        startTime: true, shiftDurationHours: true,
        breaks: { where: { isActive: true }, orderBy: { sequence: 'asc' } },
      },
    });
    for (const sp of projectBreaks(templates as unknown as ShiftShape[], fromMs, toMs)) {
      spans.push(sp as Span);
    }

    // ── The order's OWN stops ──────────────────────────────────────
    // The changeover and cleaning an order carries in its stop plan have the
    // same problem the shift breaks had, for the same reason: they are booked
    // from the order's ACTUAL start, so an order that has not begun has none of
    // them on the calendar and the estimate reads them as zero.
    //
    // They lay back to back from the start of this window, which IS the order's
    // start here — the preview is asking "if it began now, when would it
    // finish". Same merge as everything else, so a stop already booked counts
    // once.
    if (orderStops && orderStops.length > 0) {
      for (const st of layStops(orderStops, new Date(fromMs), 'FIRST_START')) {
        const a = Math.max(+st.from, fromMs);
        const b = Math.min(+st.to, toMs);
        if (b > a) spans.push([a, b] as Span);
      }
      // A per-shift stop recurs at every handover the order lives through, not
      // only the one it starts in.
      for (const [shiftStart] of shiftStartsBetween(
        templates as unknown as ShiftShape[], fromMs, toMs,
      )) {
        if (shiftStart <= fromMs) continue;
        for (const st of layStops(orderStops, new Date(shiftStart), 'SHIFT_CHANGE')) {
          const a = Math.max(+st.from, fromMs);
          const b = Math.min(+st.to, toMs);
          if (b > a) spans.push([a, b] as Span);
        }
      }
    }

    return Math.round(spanMinutes(merge(spans)));
  }

  async autoGenerateWorkOrders(
    factoryId: string | null, userId: string, poId: string,
    dto: { plannedStart: string; plannedEnd: string; rescheduleRequestId?: string; autoStart?: boolean; assignments?: Array<{ stepId: string; operatorId: string }> },
  ): Promise<any> {
    if (!factoryId) throw new BadRequestException('Factory context required');

    // Smart finish using the chosen start. If it overruns the PO due date, an
    // APPROVED reschedule request is required and its dates win.
    const preview = await this.previewAutoGenerateWOs(factoryId, poId, dto.plannedStart);
    if (!preview.canGenerate) throw new BadRequestException('Cannot auto-generate: no machines available');

    const po = await this.prisma.productionOrder.findFirst({
      where: { id: poId, factoryId, deletedAt: null },
    });
    if (!po) throw new NotFoundException('Production order not found');

    let start = new Date(dto.plannedStart);
    let end   = new Date(dto.plannedEnd);

    if (preview.smart?.exceedsDue) {
      if (!dto.rescheduleRequestId) {
        throw new BadRequestException(
          `Computed finish (${preview.smart.computedFinish}) exceeds the order due date. ` +
          'A reschedule request must be approved first.',
        );
      }
      const rr = await this.prisma.rescheduleRequest.findFirst({
        where: { id: dto.rescheduleRequestId, factoryId, productionOrderId: poId },
      });
      if (!rr) throw new NotFoundException('Reschedule request not found');
      if (rr.status !== 'APPROVED') {
        throw new BadRequestException(`Reschedule request is ${rr.status} — it must be APPROVED before generating.`);
      }
      // Approved proposal dates are authoritative
      start = rr.proposedStart;
      end = rr.proposedEnd;
    } else if (preview.smart?.computedFinish) {
      // Within due date — extend the WO end to the realistic computed finish
      const cf = new Date(preview.smart.computedFinish);
      if (cf > end) end = cf;
    }
    const year  = new Date().getFullYear();

    // ISA-95: 1 Work Order per Production Order (the production run)
    // N Job Orders are the dispatch list (one per routing step)
    // Derive the WO's line from the first routing step's machine (the WO itself
    // spans every step's machine via its job orders — no single header machine).
    const firstStep: any = preview.jobOrdersToCreate?.[0];
    const primaryMachineId: string | null = firstStep?.machine?.id ?? null;

    let lineId: string | null = null;
    if (primaryMachineId) {
      const m = await this.prisma.machine.findFirst({ where: { id: primaryMachineId }, select: { lineId: true } });
      lineId = m?.lineId ?? null;
    }

    // Robust, collision-safe numbering: derive from the max existing suffix and
    // retry on the rare concurrent-create unique clash instead of failing with 500.
    let wo: Awaited<ReturnType<typeof this.prisma.workOrder.create>> | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const orderNumber = await this.nextYearlyWONumber(year);
      try {
        wo = await this.prisma.workOrder.create({
          data: {
            factoryId,
            productionOrderId: poId,
            skuId: po.skuId!,
            lineId,
            orderNumber,
            status: 'PLANNED',
            priority: po.priority as any,
            autoStart: dto.autoStart ?? false,
            plannedQty: po.targetQty,
            plannedStart: start,
            plannedEnd: end,
            notes: `Auto-generated from PO ${po.orderNumber}${preview.process ? ` — Process: ${preview.process.name}` : ''}`,
            createdById: userId,
          },
          include: { sku: { select: { name: true, code: true } } },
        });
        break;
      } catch (e: any) {
        if (e?.code === 'P2002' && attempt < 4) continue; // number taken → recompute
        throw e;
      }
    }
    if (!wo) throw new BadRequestException('Could not allocate a unique work-order number, please retry');

    // Generate dispatch list (Job Orders) for each routing step
    const joResult = await this.generateJobOrders(factoryId, wo.id, {
      plannedStart: start.toISOString(),
      plannedEnd: end.toISOString(),
      clearExisting: false,
      assignments: dto.assignments,
    });

    // Advance PO to IN_PROGRESS
    if (po.status === 'RELEASED') {
      await this.prisma.productionOrder.update({
        where: { id: poId },
        data: { status: 'IN_PROGRESS', actualStart: new Date() },
      });
    }

    // Material-availability gate (same as manual creation): raise shortage requests
    // and flag the WO if any step material is short.
    const materialCheck = await this.checkWorkOrderMaterials(wo.id, userId);

    this.logger.log(
      `Auto-generated WO ${wo.orderNumber} + ${joResult.created} job orders for PO ${po.orderNumber}`,
    );
    return {
      workOrder: wo,
      jobOrdersCreated: joResult.created,
      jobOrders: joResult.jobOrders,
      process: preview.process,
      warning: preview.warning,
      materialShortages: materialCheck.shortages,
    };
  }

  // ────────────────────────────────────────────────────────────
  // RESCHEDULE REQUESTS (governance when smart finish overruns the due date)
  // ────────────────────────────────────────────────────────────

  async createRescheduleRequest(
    factoryId: string | null, userId: string, poId: string,
    dto: { proposedStart: string; proposedEnd: string; reason?: string; workContentMins?: number; plannedStoppageMins?: number; dueDate?: string },
  ) {
    if (!factoryId) throw new BadRequestException('Factory context required');
    const po = await this.prisma.productionOrder.findFirst({
      where: { id: poId, factoryId, deletedAt: null },
      select: { id: true, plannedEnd: true },
    });
    if (!po) throw new NotFoundException('Production order not found');

    // Reuse any still-pending request for this PO rather than piling up duplicates
    const existing = await this.prisma.rescheduleRequest.findFirst({
      where: { factoryId, productionOrderId: poId, status: 'PENDING' },
    });
    const data = {
      proposedStart: new Date(dto.proposedStart),
      proposedEnd: new Date(dto.proposedEnd),
      dueDate: dto.dueDate ? new Date(dto.dueDate) : po.plannedEnd,
      reason: dto.reason ?? null,
      workContentMins: dto.workContentMins ?? null,
      plannedStoppageMins: dto.plannedStoppageMins ?? null,
      // Auto-generate origin — store the smart-finish breakdown for display.
      source: 'AUTO_GENERATE',
      details: {
        origin: 'Auto-Generate Work Order',
        workContentMins: dto.workContentMins ?? null,
        plannedStoppageMins: dto.plannedStoppageMins ?? null,
      } as any,
    };
    if (existing) {
      return this.prisma.rescheduleRequest.update({ where: { id: existing.id }, data });
    }
    return this.prisma.rescheduleRequest.create({
      data: { factoryId, productionOrderId: poId, requestedById: userId, status: 'PENDING', ...data },
    });
  }

  async listRescheduleRequests(factoryId: string | null, filters: { status?: string; productionOrderId?: string } = {}) {
    return this.prisma.rescheduleRequest.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(filters.status ? { status: filters.status as any } : {}),
        ...(filters.productionOrderId ? { productionOrderId: filters.productionOrderId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        productionOrder: { select: { orderNumber: true, plannedEnd: true } },
        workOrder: { select: { orderNumber: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });
  }

  async reviewRescheduleRequest(
    factoryId: string | null, userId: string, id: string, approve: boolean, reason?: string,
  ) {
    const rr = await this.prisma.rescheduleRequest.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
    });
    if (!rr) throw new NotFoundException('Reschedule request not found');
    if (rr.status !== 'PENDING') throw new BadRequestException(`Request already ${rr.status}.`);

    const updated = await this.prisma.rescheduleRequest.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewedById: userId,
        reviewedAt: new Date(),
        ...(reason ? { reason } : {}),
      },
      include: {
        productionOrder: { select: { orderNumber: true } },
        requestedBy: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true } },
      },
    });

    // On approval the proposal becomes authoritative. APS_RECALC carries an exact
    // job-order plan in `details.updates` — apply it verbatim. AUTO_GENERATE shifts
    // the whole PO window (+ its WOs/JOs) to the proposed Start/End.
    if (approve) {
      const details = rr.details as any;
      const planUpdates: Array<{ id: string; start: string; end: string }> | undefined = details?.updates;
      if (rr.source === 'APS_RECALC' && Array.isArray(planUpdates) && planUpdates.length > 0) {
        await this.applyReschedulePlan(rr.factoryId, rr.workOrderId, planUpdates, rr.proposedStart, rr.proposedEnd, rr.productionOrderId);
      } else {
        await this.applyRescheduleWindow(rr.factoryId, rr.productionOrderId, rr.proposedStart, rr.proposedEnd);
      }
    }

    return updated;
  }

  /** Apply an APS_RECALC plan: write each job-order window, then sync WO + PO ends. */
  private async applyReschedulePlan(
    factoryId: string, workOrderId: string | null,
    updates: Array<{ id: string; start: string; end: string }>,
    proposedStart: Date, proposedEnd: Date, poId: string,
  ) {
    const ids = updates.map((u) => u.id);
    const owned = await this.prisma.jobOrder.findMany({
      where: { id: { in: ids }, factoryId, status: { in: ['SCHEDULED', 'READY', 'EXECUTING', 'PAUSED'] as any } },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((o) => o.id));
    const valid = updates.filter((u) => ownedIds.has(u.id));

    await this.prisma.$transaction([
      ...valid.map((u) =>
        this.prisma.jobOrder.update({
          where: { id: u.id },
          data: { plannedStart: new Date(u.start), plannedEnd: new Date(u.end) },
        }),
      ),
      ...(workOrderId ? [this.prisma.workOrder.update({
        where: { id: workOrderId },
        data: { plannedStart: proposedStart, plannedEnd: proposedEnd },
      })] : []),
      this.prisma.productionOrder.update({
        where: { id: poId },
        data: { plannedEnd: proposedEnd },
      }),
    ]);
  }

  /** Propagate an approved reschedule window to the PO + its open WOs + their JOs. */
  private async applyRescheduleWindow(
    factoryId: string, poId: string, start: Date, end: Date,
  ) {
    await this.prisma.productionOrder.update({
      where: { id: poId },
      data: { plannedStart: start, plannedEnd: end },
    });

    const wos = await this.prisma.workOrder.findMany({
      where: { productionOrderId: poId, deletedAt: null, status: { in: ['PLANNED', 'RELEASED', 'IN_PROGRESS'] } },
      select: { id: true },
    });
    for (const wo of wos) {
      await this.rescheduleWorkOrderToWindow(factoryId, wo.id, start.getTime(), end);
    }
  }

  /**
   * Shift a work order to a new window and re-lay its job orders from `startMs`
   * using the same overlap-aware engine (durations from ideal cycle × qty).
   * COMPLETE/CANCELLED job orders keep their actual times.
   */
  private async rescheduleWorkOrderToWindow(
    factoryId: string | null, woId: string, startMs: number, fallbackEnd: Date,
  ) {
    const jos = await this.prisma.jobOrder.findMany({
      where: { workOrderId: woId },
      select: {
        id: true, machineId: true, sequenceOrder: true,
        predecessorId: true, predecessorType: true, predecessorLagMins: true,
        idealCycleTimeSec: true, plannedQtyOut: true, plannedQtyIn: true, status: true,
      },
      orderBy: { sequenceOrder: 'asc' },
    });
    const open = jos.filter((j) => !['COMPLETE', 'CANCELLED'].includes(j.status));

    if (open.length === 0) {
      await this.prisma.workOrder.update({
        where: { id: woId },
        data: { plannedStart: new Date(startMs), plannedEnd: fallbackEnd },
      });
      return;
    }

    const ops: SchedOp[] = open.map((j) => {
      const qty = j.plannedQtyOut ?? j.plannedQtyIn ?? 1;
      const durMs = j.idealCycleTimeSec && j.idealCycleTimeSec > 0
        ? Math.max(qty * j.idealCycleTimeSec * 1000, 60_000)
        : 3_600_000;
      const predInSet = j.predecessorId && open.some((x) => x.id === j.predecessorId);
      return {
        id: j.id,
        machineId: j.machineId,
        durationMs: durMs,
        predecessorId: predInSet ? j.predecessorId : null,
        predecessorType: (j.predecessorType ?? 'FINISH_TO_START') as any,
        predecessorLagMins: j.predecessorLagMins ?? 0,
        sequenceOrder: j.sequenceOrder,
      };
    });
    const calendar = await this.buildWorkCalendar(factoryId);
    const sched = scheduleOps(ops, startMs, new Map(), calendar);

    await this.prisma.$transaction([
      ...open.map((j) =>
        this.prisma.jobOrder.update({
          where: { id: j.id },
          data: {
            plannedStart: new Date(sched.start.get(j.id) ?? startMs),
            plannedEnd: new Date(sched.end.get(j.id) ?? sched.finish),
          },
        }),
      ),
      this.prisma.workOrder.update({
        where: { id: woId },
        data: { plannedStart: new Date(startMs), plannedEnd: new Date(sched.finish) },
      }),
    ]);
  }

  // ────────────────────────────────────────────────────────────
  // STATE MACHINE
  // ────────────────────────────────────────────────────────────

  async startWorkOrder(factoryId: string | null, userId: string | null, workOrderId: string, operatorId?: string) {
    const wo = await this.assertTransition(factoryId, workOrderId, 'IN_PROGRESS');

    // Material gate: an Awaiting-Materials WO cannot start, and a delivery-scheduled
    // WO cannot start before its materialReadyDate (the supplier ETA).
    this.assertMaterialsClearedToStart(wo);

    const updated = await this.prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        status: 'IN_PROGRESS',
        actualStart: new Date(),
        // Materials accepted at start — clear the gate so its job orders can run.
        materialStatus: 'OK',
        materialReadyDate: null,
        ...(userId && { startedById: userId }),
        ...(operatorId && { operatorId }),
      },
      include: {
        sku: { select: { name: true, code: true } },
      },
    });

    // Record production event (WO-level; machine state is owned per job order
    // via syncMachineStateWithJobOrder as each step starts below).
    await this.recordProductionEvent(updated.factoryId, workOrderId, null, 'WO_STARTED');

    // Starting a WO dispatches its first executable operations: every job order
    // that is READY starts, and any START_TO_START-linked step starts in parallel.
    await this.autoStartReadyJobOrders(updated.factoryId, workOrderId);

    this.eventEmitter.emit('production.work-order.started', {
      workOrder: updated,
      factoryId: updated.factoryId,
    });

    this.logger.log(`WO ${wo.orderNumber} started`);
    return updated;
  }

  /**
   * Cascade-start every READY job order of a work order. Starting an op promotes
   * its START_TO_START successors to READY (via updateJobOrderStatus), so the next
   * pass starts them too — parallel-capable steps begin simultaneously. FS
   * successors stay SCHEDULED until their predecessor completes. Each op is
   * attempted once; dependency failures are skipped (not fatal).
   */
  private async autoStartReadyJobOrders(factoryId: string | null, workOrderId: string) {
    const attempted = new Set<string>();
    for (let guard = 0; guard < 50; guard++) {
      const ready = await this.prisma.jobOrder.findMany({
        where: { workOrderId, status: 'READY', id: { notIn: [...attempted] } },
        select: { id: true },
        orderBy: { sequenceOrder: 'asc' },
      });
      if (ready.length === 0) break;
      for (const r of ready) {
        attempted.add(r.id);
        try {
          await this.updateJobOrderStatus(factoryId, null, r.id, 'EXECUTING', {});
        } catch {
          /* start criteria not yet met — leave it READY for the operator */
        }
      }
    }
  }

  /**
   * Pause every EXECUTING job order of a work order. Each PAUSED transition runs
   * syncMachineStateWithJobOrder, which returns its machine to IDLE — so holding
   * or cancelling a routed WO stops all of its machines, not just one header machine.
   */
  private async pauseExecutingJobOrders(factoryId: string | null, workOrderId: string) {
    const running = await this.prisma.jobOrder.findMany({
      where: { workOrderId, status: 'EXECUTING' },
      select: { id: true },
    });
    for (const jo of running) {
      try {
        await this.updateJobOrderStatus(factoryId, null, jo.id, 'PAUSED', {});
      } catch {
        /* best-effort — leave the JO as-is if the transition is rejected */
      }
    }
  }

  async holdWorkOrder(factoryId: string | null, userId: string, workOrderId: string, dto: HoldWorkOrderDto) {
    const wo = await this.assertTransition(factoryId, workOrderId, 'ON_HOLD');

    const updated = await this.prisma.workOrder.update({
      where: { id: workOrderId },
      data: { status: 'ON_HOLD' },
    });

    // Machine state follows the job orders; pause any that are executing.
    await this.pauseExecutingJobOrders(wo.factoryId, workOrderId);

    await this.recordProductionEvent(
      wo.factoryId, workOrderId, null, 'WO_PAUSED', undefined, { reason: dto.reason, heldById: userId },
    );

    this.eventEmitter.emit('production.work-order.held', {
      workOrder: { id: workOrderId, orderNumber: wo.orderNumber, reason: dto.reason },
      factoryId: wo.factoryId,
    });

    this.logger.log(`WO ${wo.orderNumber} put on hold: ${dto.reason}`);
    return updated;
  }

  async releaseWorkOrder(factoryId: string | null, userId: string, workOrderId: string) {
    const wo = await this.assertTransition(factoryId, workOrderId, 'IN_PROGRESS');

    const updated = await this.prisma.workOrder.update({
      where: { id: workOrderId },
      data: { status: 'IN_PROGRESS' },
    });

    await this.recordProductionEvent(wo.factoryId, workOrderId, null, 'WO_STARTED', undefined, { releasedById: userId });

    // Soft-reserve step-material demand (CTP/MRP read availableStock = current − reserved)
    await this.adjustMaterialReservation(workOrderId, 1, userId);

    this.eventEmitter.emit('production.work-order.released', {
      workOrder: { id: workOrderId, orderNumber: wo.orderNumber },
      factoryId: wo.factoryId,
    });

    return updated;
  }

  async cancelWorkOrder(factoryId: string | null, userId: string, workOrderId: string, reason: string) {
    const wo = await this.assertTransition(factoryId, workOrderId, 'CANCELLED');

    const updated = await this.prisma.workOrder.update({
      where: { id: workOrderId },
      data: { status: 'CANCELLED', notes: reason },
    });

    // Stop all machines running this WO's steps (per-JO sync → IDLE).
    await this.pauseExecutingJobOrders(wo.factoryId, workOrderId);

    // Reservation only exists once the WO was released
    if (['IN_PROGRESS', 'ON_HOLD'].includes(wo.status)) {
      await this.adjustMaterialReservation(workOrderId, -1, userId);
    }

    await this.recordProductionEvent(wo.factoryId, workOrderId, null, 'WO_PAUSED', undefined, { reason, cancelledById: userId });

    this.eventEmitter.emit('production.work-order.cancelled', {
      workOrder: { id: workOrderId, orderNumber: wo.orderNumber, reason },
      factoryId: wo.factoryId,
    });

    return updated;
  }

  async completeWorkOrder(
    factoryId: string | null,
    userId: string,
    workOrderId: string,
    dto: CompleteWorkOrderDto,
  ) {
    const wo = await this.assertTransition(factoryId, workOrderId, 'COMPLETED');

    const goodQty = dto.goodQty ?? dto.actualQty;
    const scrapQty = dto.scrapQty ?? Math.max(0, dto.actualQty - goodQty);

    const actualEnd = new Date();
    const updated = await this.prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        status: 'COMPLETED',
        actualQty: dto.actualQty,
        goodQty,
        scrapQty,
        actualEnd,
        completedById: userId,
        ...(dto.notes && { notes: dto.notes }),
      },
    });

    // Auto-calculate OEE — calculateAndStoreOEE persists the machine-grain OEERecord
    // (history/hierarchy), then the engine rolls JO→WO→PO and owns the WO/PO OEE.
    const oeeResult = await this.calculateAndStoreOEE(wo, dto.actualQty, goodQty, actualEnd);
    await this.kpiService.recomputeWorkOrderAndPO(workOrderId);

    // Traceability & genealogy: output batch + per-step trace events +
    // per-step material consumptions (linked to lots when available)
    await this.recordTraceability(wo, userId, dto.actualQty, goodQty, scrapQty, actualEnd);

    await this.recordProductionEvent(wo.factoryId, workOrderId, null, 'WO_COMPLETED', dto.actualQty);

    this.eventEmitter.emit('production.work-order.completed', {
      workOrder: { ...updated, oee: oeeResult?.oee },
      factoryId: wo.factoryId,
    });

    this.logger.log(`WO ${wo.orderNumber} completed — OEE: ${oeeResult?.oee?.toFixed(1) ?? 'N/A'}%`);
    return { ...updated, oeeResult };
  }

  // ────────────────────────────────────────────────────────────
  // PRODUCTION COUNT UPDATES
  // ────────────────────────────────────────────────────────────

  async recordCount(factoryId: string | null, workOrderId: string, dto: RecordCountDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, ...factoryFilter, status: 'IN_PROGRESS', deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Active work order not found');

    const totalGood = wo.goodQty + dto.goodCount;
    const totalReject = wo.reworkQty + (dto.rejectCount ?? 0);
    const totalActual = totalGood + totalReject;

    const updated = await this.prisma.workOrder.update({
      where: { id: workOrderId },
      data: {
        actualQty: totalActual,
        goodQty: totalGood,
        reworkQty: totalReject,
      },
    });

    // Per-machine counters are maintained per job order; this WO-level count only
    // updates WO totals (machine attribution happens via the job-order counts).
    await this.recordProductionEvent(
      wo.factoryId, workOrderId, null, 'COUNT_UPDATE', totalActual,
      { goodCount: dto.goodCount, rejectCount: dto.rejectCount ?? 0 },
    );

    this.eventEmitter.emit('production.count.updated', {
      workOrderId,
      factoryId: wo.factoryId,
      actualQty: totalActual,
      goodQty: totalGood,
      progress: Math.min(Math.round((totalActual / wo.plannedQty) * 100), 100),
    });

    return updated;
  }

  // ────────────────────────────────────────────────────────────
  // KPIs
  // ────────────────────────────────────────────────────────────

  async getKPIs(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
    timeframe?: string,
    dateFrom?: string,
    dateTo?: string,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machineIds = await this.kpiService.resolveScopeMachineIds(factoryId, scope);
    // WO "belongs to" a machine via any of its job-order steps (routed WOs).
    const woScope: Prisma.WorkOrderWhereInput = scope?.machineId
      ? { jobOrders: { some: { machineId: scope.machineId } } }
      : scope?.lineId
        ? { OR: [{ lineId: scope.lineId }, { jobOrders: { some: { machine: { lineId: scope.lineId } } } }] }
        : scope?.areaId
          ? { OR: [{ line: { areaId: scope.areaId } }, { jobOrders: { some: { machine: { line: { areaId: scope.areaId } } } } }] }
          : {};
    /**
     * The window this reports on.
     *
     * It used to be today, always: the endpoint accepted no date parameters at
     * all, so a page set to the running SHIFT still showed a card measuring
     * since midnight, under the shift's heading. The arithmetic was never
     * wrong — it matched both engines exactly over its own window — but the
     * window was not the one the reader had chosen, and no card said so.
     *
     * Resolved the same way every other production endpoint resolves it, so
     * the same filter means the same hours here as everywhere else. Today
     * remains the default when nothing is asked for.
     */
    const kpiNow = new Date();
    const tf = String(timeframe || '').toLowerCase();
    let winFrom: Date;
    let winTo: Date = kpiNow;
    let winSlotTo: Date;
    if (tf === 'shift') {
      const shift = await currentShiftWindow(this.prisma, factoryId);
      winFrom = shift?.start ?? new Date(new Date().setHours(0, 0, 0, 0));
      winSlotTo = shift?.end ?? endOfLocalDay(kpiNow);
    } else if (dateFrom || dateTo) {
      const parsed = resolveLocalRange(dateFrom, dateTo, 1, kpiNow);
      winFrom = parsed.from; winTo = parsed.to; winSlotTo = parsed.slotTo;
    } else {
      winFrom = new Date(); winFrom.setHours(0, 0, 0, 0);
      winSlotTo = endOfLocalDay(kpiNow);
    }

    const [oee, totalOrders, inProgressOrders, completedOrders, plannedOrders, heldOrders] =
      await Promise.all([
        this.kpiService.oeeAnalytics(factoryId, winFrom, winTo, machineIds, 'hour', { slotTo: winSlotTo }),
        this.prisma.workOrder.count({ where: { ...factoryFilter, ...woScope, deletedAt: null } }),
        this.prisma.workOrder.count({ where: { ...factoryFilter, ...woScope, status: 'IN_PROGRESS' } }),
        this.prisma.workOrder.count({ where: { ...factoryFilter, ...woScope, status: 'COMPLETED' } }),
        this.prisma.workOrder.count({ where: { ...factoryFilter, ...woScope, status: { in: ['PLANNED', 'RELEASED'] } } }),
        this.prisma.workOrder.count({ where: { ...factoryFilter, ...woScope, status: 'ON_HOLD' } }),
      ]);

    return {
      oee: oee.current.oee,
      availability: oee.current.availability,
      performance: oee.current.performance,
      quality: oee.current.quality,
      // Time-based (OEE-TB) variant — surfaced alongside schedule-based OEE.
      oeeTb: oee.current.oeeTb,
      availabilityTb: oee.current.availabilityTb,
      totalOrders,
      inProgressOrders,
      completedOrders,
      plannedOrders,
      heldOrders,
    };
  }

  async getOEESummary(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
    timeframe: string = 'day',
    dateFrom?: string,
    dateTo?: string,
    drill: { workOrderId?: string; productionOrderId?: string } = {},
    /** Bucket size for the trend. Omitted = chosen from the timeframe. */
    bucketPref?: string,
  ) {
    // Per-machine OEE comes from JOB ORDERS (a routed WO spans many machines), so
    // every machine that ran a step is counted — not just the WO header machine.
    const machineIds = await this.kpiService.resolveScopeMachineIds(factoryId, scope);
    // Normalise the timeframe (accepts Day/Week/Month/Shift, any case) or an explicit range.
    const tf = String(timeframe || 'day').toLowerCase();
    const now = new Date();
    let from: Date;
    let to: Date;
    /**
     * How far the committed slot reaches — set on every branch.
     *
     * Not derivable from `to`, which is clamped to now. Guessing it as the end
     * of the plant day containing `to` is right for a whole-day window and
     * wrong for a shift, which is precisely the window this endpoint is asked
     * for most often.
     */
    let slotTo: Date;
    if (tf === 'shift') {
      // The REAL current shift window (start → now), resolved from shift templates —
      // not "since midnight". Falls back to today if no shift is configured.
      to = now;
      const shift = await currentShiftWindow(this.prisma, factoryId);
      from = shift?.start ?? new Date(new Date().setHours(0, 0, 0, 0));
      // The slot a shift's orders were committed to runs to the end of the
      // SHIFT. Ending it at `now` would drop the unreached remainder, which is
      // the whole difference between the two bases.
      slotTo = shift?.end ?? endOfLocalDay(now);
    } else {
      // Parse date-only strings in SERVER-LOCAL time, not UTC.
      //
      // The web deliberately builds these from LOCAL calendar components — its own
      // comment warns that toISOString shifts local midnight into the previous day.
      // `new Date('2026-08-09')` parses as midnight UTC, which is 03:00 in Riyadh, so
      // between local midnight and 03:00 the entire "Today" window sat in the FUTURE
      // and every KPI on the page read 0.0% while "Shift" and "Week" were fine.
      //
      // The upper bound never runs past now, for the same reason planned production
      // time does not accrue for hours that have not happened yet.
      // Parsed by the shared helper, not by hand. This was a fourth copy of the
      // day-edge logic and it had the bug the shared one exists to prevent: it
      // appended "T23:59:59.999" unconditionally, so a caller asking for
      // "2026-08-21T19:00:00" produced "2026-08-21T19:00:00T23:59:59.999" — an
      // Invalid Date that travelled into the SQL as a null parameter and came
      // back as a 500. Any window narrower than a whole day broke this endpoint.
      const parsed = resolveLocalRange(dateFrom, dateTo, 1, now);
      to = parsed.to;
      slotTo = parsed.slotTo;
      if (dateFrom) from = parsed.from;
      else {
        from = new Date(to);
        if (tf === 'week') from.setDate(to.getDate() - 7);
        else if (tf === 'month') from.setDate(to.getDate() - 30);
        else from.setHours(0, 0, 0, 0); // day → today
      }
    }
    // The caller may name a bucket; otherwise the timeframe picks a sensible
    // default. An explicit choice always wins — that is the whole point of the
    // control, and a page that silently overrode it would be back to a switch
    // that does nothing.
    const bucket: TrendBucket = isTrendBucket(bucketPref)
      ? bucketPref
      : (tf === 'day' || tf === 'shift' ? 'hour' : 'day');

    const a = await this.kpiService.oeeAnalytics(factoryId, from, to, machineIds, bucket, { ...drill, slotTo });
    return {
      current: a.current, // includes oee/availability/performance/quality + oeeTb/availabilityTb
      // flat aliases for the Machine OEE view + legacy consumers
      oee: a.current.oee, availability: a.current.availability, performance: a.current.performance, quality: a.current.quality,
      oeeTb: a.current.oeeTb, availabilityTb: a.current.availabilityTb,
      totalCount: a.totalOutput, goodCount: a.goodOutput, downtime: a.downtimeMin,
      trend: a.trend, // [{ period, oee, oeeTb }]
      byEquipment: a.byEquipment.map((e) => ({
        machineId: e.machineId, name: e.name, code: e.code, output: e.output,
        oee: e.oee, availability: e.availability, performance: e.performance, quality: e.quality,
        oeeTb: e.oeeTb, availabilityTb: e.availabilityTb,
      })),
      equipmentBreakdown: a.byEquipment.map((e) => ({
        machineId: e.machineId, machineName: e.name, output: e.output,
        oee: e.oee, availability: e.availability, performance: e.performance, quality: e.quality,
        oeeTb: e.oeeTb, availabilityTb: e.availabilityTb,
      })),
    };
  }

  /** OEE grouped by Production Order / Work Order / Shift / Machine for the trend chart. */
  async getOeeGroupedTrend(
    factoryId: string | null,
    scope: { areaId?: string; lineId?: string; machineId?: string },
    groupBy: string,
    timeframe: string = 'week',
    dateFrom?: string,
    dateTo?: string,
    drill: { workOrderId?: string; productionOrderId?: string } = {},
  ) {
    const machineIds = await this.kpiService.resolveScopeMachineIds(factoryId, scope);
    const tf = String(timeframe || 'week').toLowerCase();
    const now = new Date();
    let from: Date;
    let to: Date;
    if (tf === 'shift') {
      to = now;
      from = (await currentShiftStart(this.prisma, factoryId)) ?? new Date(new Date().setHours(0, 0, 0, 0));
    } else {
      // Local calendar dates, clamped to now — see resolveLocalRange.
      const r = resolveLocalRange(dateFrom, dateTo, 7, now);
      to = r.to;
      if (dateFrom) from = r.from;
      else {
        from = new Date(to);
        if (tf === 'month') from.setDate(to.getDate() - 30);
        else if (tf === 'day') from.setHours(0, 0, 0, 0);
        else from.setDate(to.getDate() - 7); // week (default)
      }
    }
    const gb = (['machine', 'workOrder', 'productionOrder', 'shift'].includes(groupBy) ? groupBy : 'workOrder') as any;
    const rows = await this.kpiService.oeeGroupedTrend(factoryId, from, to, machineIds, gb, drill);
    return { groupBy: gb, from: from.toISOString(), to: to.toISOString(), rows };
  }

  async getOEERecords(factoryId: string | null, filters: {
    machineId?: string;
    areaId?: string;
    lineId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const { machineId, areaId, lineId, dateFrom, dateTo, page = 1, limit = 20 } = filters;
    // Per-machine OEE rows are derived from JOB ORDERS so routed WOs contribute on
    // every machine they ran a step on (not just the WO header machine).
    const machineIds = await this.kpiService.resolveScopeMachineIds(factoryId, { machineId, areaId, lineId });
    // Inclusive end-of-day for a date-only `dateTo` so today/single-day ranges aren't empty.
    // Local calendar dates, clamped to now — the same convention as every other
    // window. Parsing these as UTC made "Today" start three hours in the future in
    // Riyadh, so the list was empty until 03:00 every morning.
    const recNow = new Date();
      // Parsed by the shared helper: a bare date keeps its day edge, anything
      // longer is the instant it names. Appending the suffix unconditionally
      // made any sub-day window an Invalid Date and a 500.
    const recRawTo = plantBound(dateTo, 'end') ?? recNow;
    const to = recRawTo > recNow ? recNow : recRawTo;
    const from = plantBound(dateFrom, 'start') ?? new Date(to.getTime() - 90 * 86_400_000);

    const data = await this.kpiService.oeeRecordsFromJobOrders(factoryId, from, to, machineIds, limit);
    return { data, total: data.length, page, limit, totalPages: 1 };
  }

  // ────────────────────────────────────────────────────────────
  // BATCH RECORDS CRUD
  // ────────────────────────────────────────────────────────────

  async findBatches(factoryId: string | null, filters: {
    search?: string;
    status?: string;
    workOrderId?: string;
    skuId?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, workOrderId, skuId, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: Prisma.BatchRecordWhereInput = {
      ...factoryFilter,
      ...(status && { status: status as any }),
      ...(workOrderId && { workOrderId }),
      ...(skuId && { skuId }),
      ...(search && {
        OR: [
          { batchNumber: { contains: search, mode: 'insensitive' as const } },
          { lotNumber: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.batchRecord.count({ where }),
      this.prisma.batchRecord.findMany({
        where,
        include: {
          workOrder: { select: { orderNumber: true, jobOrders: { select: { machine: { select: { name: true } } } } } },
          sku: { select: { name: true, code: true, itemNumber: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    // Resolve every linked WO once (for display + live AUTO quantity roll-up).
    const allWoIds = [...new Set(data.flatMap((b) => ((b.workOrderIds as string[] | null) ?? [])))];
    const wos = allWoIds.length
      ? await this.prisma.workOrder.findMany({
          where: { id: { in: allWoIds } },
          select: { id: true, orderNumber: true, plannedQty: true, goodQty: true, scrapQty: true },
        })
      : [];
    const woById = new Map(wos.map((w) => [w.id, w]));

    return {
      data: data.map(b => {
        const woIds = (b.workOrderIds as string[] | null) ?? (b.workOrderId ? [b.workOrderId] : []);
        const linked = woIds.map((id) => woById.get(id)).filter(Boolean) as Array<{ id: string; orderNumber: string; plannedQty: number; goodQty: number | null; scrapQty: number | null }>;
        const linkedWorkOrders = linked.map((w) => ({ id: w.id, orderNumber: w.orderNumber }));
        const isAuto = b.quantitySource === 'AUTO';
        // AUTO batches roll up LIVE from their linked WOs: quantity = Σ plannedQty,
        // good/scrap = Σ actual good/scrap (so yield reflects real WO output instead of
        // staying at the stored 0). MANUAL batches keep their entered/adjusted values.
        const quantity = isAuto ? linked.reduce((s, w) => s + (w.plannedQty ?? 0), 0) : b.quantity;
        const goodQuantity = isAuto ? linked.reduce((s, w) => s + (w.goodQty ?? 0), 0) : b.goodQuantity;
        const scrapQuantity = isAuto ? linked.reduce((s, w) => s + (w.scrapQty ?? 0), 0) : b.scrapQuantity;
        // Yield/scrap are clamped to [0,100] so display never exceeds 100% on overproduction.
        const clamp = (n: number) => Math.max(0, Math.min(100, n));
        return {
          ...b,
          quantity,
          goodQuantity,
          scrapQuantity,
          linkedWorkOrders,
          workOrderIds: woIds,
          yieldPct: quantity > 0 ? clamp(parseFloat(((goodQuantity / quantity) * 100).toFixed(1))) : 0,
          scrapPct: quantity > 0 ? clamp(parseFloat(((scrapQuantity / quantity) * 100).toFixed(1))) : 0,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** Sum of planned quantities of the given work orders (for AUTO batch quantity). */
  private async sumWorkOrderPlannedQty(factoryId: string | null, woIds: string[]): Promise<number> {
    if (!woIds.length) return 0;
    const r = await this.prisma.workOrder.aggregate({
      where: { id: { in: woIds }, ...(factoryId ? { factoryId } : {}) },
      _sum: { plannedQty: true },
    });
    return Math.round(r._sum.plannedQty ?? 0);
  }

  async createBatch(factoryId: string, dto: {
    workOrderId?: string;
    workOrderIds?: string[];
    quantitySource?: 'AUTO' | 'MANUAL';
    skuId?: string;
    batchNumber: string;
    lotNumber?: string;
    quantity?: number;
    unit?: string;
    notes?: string;
  }) {
    // One-or-more linked WOs (accept the new array, fall back to the legacy single id).
    const woIds = (dto.workOrderIds?.length ? dto.workOrderIds : (dto.workOrderId ? [dto.workOrderId] : []))
      .filter(Boolean);
    const source: 'AUTO' | 'MANUAL' = dto.quantitySource === 'AUTO' ? 'AUTO' : 'MANUAL';
    // AUTO → quantity is the live sum of the linked WOs' planned quantities.
    const quantity = source === 'AUTO'
      ? await this.sumWorkOrderPlannedQty(factoryId, woIds)
      : (dto.quantity ?? 0);

    return this.prisma.batchRecord.create({
      data: {
        factoryId,
        batchNumber: dto.batchNumber,
        lotNumber: dto.lotNumber,
        workOrderId: woIds[0] ?? null,
        workOrderIds: woIds,
        quantitySource: source,
        skuId: dto.skuId,
        quantity,
        unit: dto.unit ?? 'CARTON',
        notes: dto.notes,
        status: 'ACTIVE',
      },
      include: {
        workOrder: { select: { orderNumber: true } },
        sku: { select: { name: true, code: true } },
      },
    });
  }

  async updateBatch(factoryId: string | null, id: string, dto: {
    status?: string;
    quantity?: number;
    quantitySource?: 'AUTO' | 'MANUAL';
    workOrderIds?: string[];
    goodQuantity?: number;
    scrapQuantity?: number;
    notes?: string;
    lotNumber?: string;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const batch = await this.prisma.batchRecord.findFirst({ where: { id, ...factoryFilter } });
    if (!batch) throw new NotFoundException('Batch record not found');

    // ── Status state-machine: only allow sane transitions ──────────────
    if (dto.status && dto.status !== batch.status) {
      const VALID_BATCH_TRANSITIONS: Record<string, string[]> = {
        ACTIVE:     ['COMPLETED', 'ON_HOLD', 'QUARANTINE', 'REJECTED', 'RELEASED'],
        ON_HOLD:    ['ACTIVE', 'QUARANTINE', 'REJECTED', 'RELEASED'],
        QUARANTINE: ['RELEASED', 'REJECTED', 'ON_HOLD'],
        COMPLETED:  ['RELEASED', 'QUARANTINE', 'REJECTED'],
        RELEASED:   ['QUARANTINE', 'REJECTED'], // recall path
        REJECTED:   [],
        DEPLETED:   [],
      };
      const allowed = VALID_BATCH_TRANSITIONS[batch.status] ?? [];
      if (!(batch.status in VALID_BATCH_TRANSITIONS)) {
        throw new BadRequestException(`Unknown batch status "${dto.status}"`);
      }
      if (!allowed.includes(dto.status)) {
        throw new BadRequestException(`Cannot change batch status from ${batch.status} to ${dto.status}`);
      }
    }

    // Effective linked WOs + source (use the incoming values, else keep existing).
    const woIds = dto.workOrderIds !== undefined
      ? dto.workOrderIds.filter(Boolean)
      : ((batch.workOrderIds as string[] | null) ?? (batch.workOrderId ? [batch.workOrderId] : []));
    const source: 'AUTO' | 'MANUAL' = (dto.quantitySource ?? (batch.quantitySource as 'AUTO' | 'MANUAL')) === 'AUTO' ? 'AUTO' : 'MANUAL';
    // AUTO → recompute live from linked WOs; MANUAL → use the entered value if provided.
    const quantity = source === 'AUTO'
      ? await this.sumWorkOrderPlannedQty(factoryId, woIds)
      : dto.quantity;

    // ── Count sanity for MANUAL batches: good + scrap must not exceed quantity ──
    if (source === 'MANUAL' && (dto.goodQuantity !== undefined || dto.scrapQuantity !== undefined)) {
      const effQty = quantity ?? batch.quantity;
      const good = dto.goodQuantity ?? batch.goodQuantity;
      const scrap = dto.scrapQuantity ?? batch.scrapQuantity;
      if (good < 0 || scrap < 0) throw new BadRequestException('Good and scrap quantities cannot be negative');
      if (effQty > 0 && good + scrap > effQty) {
        throw new BadRequestException(`Good (${good}) + scrap (${scrap}) cannot exceed batch quantity (${effQty})`);
      }
    }

    return this.prisma.batchRecord.update({
      where: { id },
      data: {
        ...(dto.status && { status: dto.status as any }),
        ...(dto.workOrderIds !== undefined && { workOrderIds: woIds, workOrderId: woIds[0] ?? null }),
        ...(dto.quantitySource !== undefined && { quantitySource: source }),
        ...(quantity !== undefined && { quantity }),
        ...(dto.goodQuantity !== undefined && { goodQuantity: dto.goodQuantity }),
        ...(dto.scrapQuantity !== undefined && { scrapQuantity: dto.scrapQuantity }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.lotNumber !== undefined && { lotNumber: dto.lotNumber }),
      },
    });
  }

  async deleteBatch(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const batch = await this.prisma.batchRecord.findFirst({ where: { id, ...factoryFilter } });
    if (!batch) throw new NotFoundException('Batch record not found');
    if (batch.status === 'ACTIVE') {
      throw new BadRequestException('Cannot delete an active batch. Complete or reject it first.');
    }
    await this.prisma.batchRecord.delete({ where: { id } });
  }

  /**
   * Traceability & genealogy backbone, written at WO completion:
   *  1. Output BatchRecord (idempotent per WO) with real quantities.
   *  2. Per job-order step: STEP_COMPLETED TraceEvent carrying the unit flow
   *     (qtyIn/inUnit → qtyOut/outUnit, machine, cycle time).
   *  3. Per routing-step input material: MaterialConsumption
   *     (planned = qtyPerOutputUnit × step planned output; actual scaled by
   *     the WO's actual/planned ratio), FIFO-linked to the oldest ACTIVE
   *     MaterialLot of that material code, plus a CONSUMED TraceEvent —
   *     this is what the Genealogy explorer walks.
   */
  private async recordTraceability(
    wo: { id: string; factoryId: string; orderNumber: string; skuId: string | null; plannedQty: number; actualStart: Date | null; productionOrderId: string | null },
    userId: string | null,
    actualQty: number,
    goodQty: number,
    scrapQty: number,
    actualEnd: Date,
  ) {
    try {
      const sku = wo.skuId
        ? await this.prisma.sKU.findUnique({ where: { id: wo.skuId }, select: { baseUnit: true, name: true, itemNumber: true } })
        : null;

      // 1) Output batch (idempotent)
      const batchNumber = `BATCH-${wo.orderNumber}`;
      const batch = await this.prisma.batchRecord.upsert({
        where: { batchNumber },
        update: {
          quantity: Math.round(actualQty),
          goodQuantity: Math.round(goodQty),
          scrapQuantity: Math.round(scrapQty),
          endTime: actualEnd,
          status: 'COMPLETED',
        },
        create: {
          factoryId: wo.factoryId,
          workOrderId: wo.id,
          skuId: wo.skuId,
          batchNumber,
          lotNumber: `LOT-${wo.orderNumber}`,
          status: 'COMPLETED',
          quantity: Math.round(actualQty),
          goodQuantity: Math.round(goodQty),
          scrapQuantity: Math.round(scrapQty),
          unit: sku?.baseUnit ?? 'CARTON',
          startTime: wo.actualStart ?? undefined,
          endTime: actualEnd,
        },
      });

      // 1b) Post the produced good qty into a FINISHED_GOODS storage location
      // (base-unit converted), bump SKU on-hand + write the RECEIPT movement/link.
      await this.postFinishedGoods(wo, batch, goodQty, userId, actualEnd);

      // 2+3) Steps — STEP_COMPLETED trace events + idempotent material consumption
      const jos = await this.prisma.jobOrder.findMany({
        where: { workOrderId: wo.id },
        orderBy: { sequenceOrder: 'asc' },
        include: {
          machine: { select: { name: true, code: true } },
        },
      });

      for (const jo of jos) {
        await this.prisma.traceEvent.create({
          data: {
            factoryId: wo.factoryId,
            entityType: 'PROD_WO',
            entityId: wo.id,
            entityCode: wo.orderNumber,
            eventType: 'STEP_COMPLETED',
            quantity: jo.plannedQtyOut ?? null,
            eventData: {
              step: jo.sequenceOrder,
              operation: jo.operationName,
              machine: jo.machine?.name ?? null,
              machineCode: jo.machine?.code ?? null,
              qtyIn: jo.plannedQtyIn,
              inUnit: jo.inputUnit,
              qtyOut: jo.plannedQtyOut,
              outUnit: jo.outputUnit,
              cycleTimeSec: jo.idealCycleTimeSec,
              batchNumber,
            },
            performedById: userId,
            performedAt: actualEnd,
            relatedType: 'BATCH',
            relatedId: batch.id,
          },
        });

        // Consume this step's materials — idempotent per job order, so steps already
        // consumed incrementally at their own COMPLETE are skipped (no double-count);
        // steps never completed individually are consumed here as a fallback.
        await this.consumeStepMaterials(
          {
            id: jo.id, factoryId: wo.factoryId, workOrderId: wo.id,
            sequenceOrder: jo.sequenceOrder, operationName: jo.operationName,
            actualQtyGood: jo.actualQtyGood, plannedQtyOut: jo.plannedQtyOut, routingStepId: jo.routingStepId,
          },
          userId,
          { batchId: batch.id, batchNumber, consumedAt: actualEnd },
        );
      }

      // Batch-level completion event (genealogy root)
      await this.prisma.traceEvent.create({
        data: {
          factoryId: wo.factoryId,
          entityType: 'BATCH',
          entityId: batch.id,
          entityCode: batchNumber,
          eventType: 'BATCH_COMPLETED',
          quantity: actualQty,
          eventData: {
            workOrder: wo.orderNumber,
            sku: sku ? `${sku.itemNumber} ${sku.name}` : null,
            goodQty,
            scrapQty,
            unit: sku?.baseUnit ?? 'CARTON',
            steps: jos.length,
          },
          performedById: userId,
          performedAt: actualEnd,
          relatedType: 'PROD_WO',
          relatedId: wo.id,
        },
      });
    } catch (err) {
      // Traceability must never block production completion
      this.logger.error('Failed to record traceability for WO completion', err);
    }
  }

  /**
   * Soft-reserve (direction = 1) or release (direction = -1) the step-material
   * demand of a work order on RawMaterial.reservedStock, with a RESERVATION /
   * RELEASE ledger entry per material. Completion releases via consumeMaterialFifo.
   */
  private async adjustMaterialReservation(workOrderId: string, direction: 1 | -1, userId: string) {
    try {
      const jos = await this.prisma.jobOrder.findMany({
        where: { workOrderId },
        include: { routingStep: { include: { materials: true } } },
      });
      const round3 = (x: number) => Math.round(x * 1000) / 1000;
      const demand = new Map<string, number>();
      for (const jo of jos) {
        for (const m of jo.routingStep?.materials ?? []) {
          if (!m.rawMaterialId) continue;
          demand.set(m.rawMaterialId, (demand.get(m.rawMaterialId) ?? 0) + m.qtyPerOutputUnit * (jo.plannedQtyOut ?? 0));
        }
      }
      for (const [rmId, qty] of demand) {
        const rm = await this.prisma.rawMaterial.findUnique({ where: { id: rmId } });
        if (!rm || qty <= 0) continue;
        const next = direction === 1 ? rm.reservedStock + qty : Math.max(0, rm.reservedStock - qty);
        await this.prisma.rawMaterial.update({ where: { id: rmId }, data: { reservedStock: round3(next) } });
        await this.prisma.stockMovement.create({
          data: {
            factoryId: rm.factoryId,
            entityType: 'RAW_MATERIAL',
            entityId: rm.id,
            entityCode: rm.code,
            entityName: rm.name,
            movementType: direction === 1 ? 'RESERVATION' : 'RELEASE',
            quantity: direction === 1 ? qty : -qty,
            stockBefore: rm.currentStock,
            stockAfter: rm.currentStock, // soft reserve — physical stock unchanged
            referenceType: 'PRODUCTION_WO',
            referenceId: workOrderId,
            performedById: userId,
            notes: direction === 1 ? 'Soft reservation at WO release' : 'Reservation released (WO cancelled)',
          },
        });
      }
    } catch (err) {
      // Reservation is advisory — never block the WO lifecycle
      this.logger.error('Material reservation adjustment failed', err);
    }
  }

  // ────────────────────────────────────────────────────────────
  // MATERIAL-SHORTAGE GATE  (block WO start until raw materials available)
  // ────────────────────────────────────────────────────────────

  private static readonly OPEN_REQUEST_STATUSES = ['PENDING', 'ACKNOWLEDGED', 'PARTIALLY_FULFILLED'] as const;

  /** Base-unit conversion via the SKU packaging ladder (PIECE/INNER/CARTON/PALLET). */
  private toBaseUnits(
    qty: number,
    fromUnit: string | null | undefined,
    baseUnit: string | null | undefined,
    pkg: { unitsPerInner?: number | null; innersPerCarton?: number | null; cartonsPerPallet?: number | null },
  ): number {
    const inner = pkg.unitsPerInner || 1;
    const carton = (pkg.innersPerCarton || 1) * inner;
    const pallet = (pkg.cartonsPerPallet || 1) * carton;
    const ladder: Record<string, number> = { PIECE: 1, EA: 1, PCS: 1, UNIT: 1, INNER: inner, CARTON: carton, PALLET: pallet };
    const norm = (u: string | null | undefined) => ladder[(u || '').toUpperCase()] ?? 1;
    return Math.round((qty * norm(fromUnit)) / norm(baseUnit) * 1000) / 1000;
  }

  /** Aggregate step-material demand of a WO from its job orders' routing-step materials. */
  private async computeStepMaterialDemand(workOrderId: string) {
    const jos = await this.prisma.jobOrder.findMany({
      where: { workOrderId },
      include: { routingStep: { include: { materials: true } } },
    });
    const round3 = (x: number) => Math.round(x * 1000) / 1000;
    const demand = new Map<string, { qty: number; code: string; name: string; unit: string }>();
    for (const jo of jos) {
      for (const m of jo.routingStep?.materials ?? []) {
        if (!m.rawMaterialId) continue;
        const add = m.qtyPerOutputUnit * (jo.plannedQtyOut ?? 0);
        const cur = demand.get(m.rawMaterialId);
        if (cur) cur.qty = round3(cur.qty + add);
        else demand.set(m.rawMaterialId, { qty: round3(add), code: m.materialCode ?? m.rawMaterialId, name: m.name ?? m.materialCode ?? '', unit: m.unit ?? '' });
      }
    }
    return demand;
  }

  /**
   * Compute material shortages for a WO and (optionally) raise PENDING material
   * requests to inventory for every short raw material. Never throws — material
   * gating must not break WO creation. Refreshes the WO's materialStatus at the end.
   */
  async checkWorkOrderMaterials(
    workOrderId: string,
    userId: string | null,
    opts: { createRequests?: boolean } = {},
  ): Promise<{ shortages: Array<{ rawMaterialId: string; code: string; name: string; unit: string; needed: number; available: number; short: number }> }> {
    const round3 = (x: number) => Math.round(x * 1000) / 1000;
    try {
      const wo = await this.prisma.workOrder.findUnique({
        where: { id: workOrderId },
        select: { id: true, factoryId: true, orderNumber: true, productionOrderId: true, priority: true },
      });
      if (!wo) return { shortages: [] };

      const demand = await this.computeStepMaterialDemand(workOrderId);
      const shortages: Array<{ rawMaterialId: string; code: string; name: string; unit: string; needed: number; available: number; short: number }> = [];

      for (const [rmId, d] of demand) {
        if (d.qty <= 0) continue;
        const rm = await this.prisma.rawMaterial.findUnique({
          where: { id: rmId },
          select: { id: true, code: true, name: true, unit: true, currentStock: true, reservedStock: true },
        });
        if (!rm) continue;
        const available = round3(rm.currentStock - rm.reservedStock);
        if (d.qty > available + 1e-6) {
          shortages.push({ rawMaterialId: rmId, code: rm.code, name: rm.name, unit: rm.unit ?? d.unit, needed: d.qty, available: Math.max(0, available), short: round3(d.qty - available) });
        }
      }

      if (opts.createRequests !== false && shortages.length > 0) {
        for (const s of shortages) {
          const existing = await this.prisma.materialRequest.findFirst({
            where: { workOrderId, rawMaterialId: s.rawMaterialId, status: { in: ProductionService.OPEN_REQUEST_STATUSES as any } },
          });
          if (existing) {
            await this.prisma.materialRequest.update({
              where: { id: existing.id },
              data: { quantityNeeded: s.needed, quantityAvailable: s.available, quantityShort: s.short, unit: s.unit },
            });
          } else {
            const requestNumber = await this.generateMaterialRequestNumber(wo.factoryId);
            await this.prisma.materialRequest.create({
              data: {
                factoryId: wo.factoryId,
                workOrderId,
                productionOrderId: wo.productionOrderId,
                rawMaterialId: s.rawMaterialId,
                requestNumber,
                quantityNeeded: s.needed,
                quantityAvailable: s.available,
                quantityShort: s.short,
                unit: s.unit,
                status: 'PENDING',
                priority: wo.priority as any,
                requestedById: userId,
              },
            });
            await this.prisma.traceEvent.create({
              data: {
                factoryId: wo.factoryId,
                entityType: 'RAW_MATERIAL',
                entityId: s.rawMaterialId,
                entityCode: s.code,
                eventType: 'MATERIAL_REQUESTED',
                quantity: s.short,
                eventData: { workOrder: wo.orderNumber, needed: s.needed, available: s.available, shortBy: s.short, unit: s.unit, requestNumber },
                performedById: userId,
                relatedType: 'PROD_WO',
                relatedId: workOrderId,
              },
            }).catch(() => undefined);
          }
        }
        this.eventEmitter.emit('production.material-shortage.raised', { workOrderId, factoryId: wo.factoryId, shortages });
        this.logger.warn(`WO ${wo.orderNumber} — ${shortages.length} material shortage(s) raised to inventory`);
      }

      await this.refreshWorkOrderMaterialStatus(workOrderId);
      return { shortages };
    } catch (err) {
      this.logger.error('Material shortage check failed', err as Error);
      return { shortages: [] };
    }
  }

  /** Derive a WO's materialStatus + materialReadyDate from its open material requests. */
  async refreshWorkOrderMaterialStatus(workOrderId: string): Promise<void> {
    const open = await this.prisma.materialRequest.findMany({
      where: { workOrderId, status: { in: ProductionService.OPEN_REQUEST_STATUSES as any } },
      select: { deliveryDate: true },
    });
    if (open.length === 0) {
      await this.prisma.workOrder.update({ where: { id: workOrderId }, data: { materialStatus: 'OK', materialReadyDate: null } });
      return;
    }
    const dates = open.map((o) => o.deliveryDate).filter((d): d is Date => !!d);
    if (dates.length === open.length && dates.length > 0) {
      const max = new Date(Math.max(...dates.map((d) => +d)));
      await this.prisma.workOrder.update({ where: { id: workOrderId }, data: { materialStatus: 'SCHEDULED_FOR_DELIVERY', materialReadyDate: max } });
    } else {
      await this.prisma.workOrder.update({ where: { id: workOrderId }, data: { materialStatus: 'AWAITING_MATERIALS', materialReadyDate: null } });
    }
  }

  /**
   * When inventory commits delivery dates and the latest ETA pushes the WO start
   * out, we DO NOT shift the work order directly. Instead we raise a PENDING
   * reschedule request on the parent PO (with the full material/ETA breakdown) for
   * approval. Only on approval (reviewRescheduleRequest → applyRescheduleWindow)
   * are the PO + WO + job-order dates moved to the new window. The WO meanwhile
   * stays blocked from starting via its materialStatus / materialReadyDate gate.
   *
   * A WO with no parent PO has no PO governance, so it is shifted directly.
   */
  async scheduleWorkOrderForDelivery(workOrderId: string, userId: string | null = null): Promise<void> {
    const wo = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      select: { id: true, orderNumber: true, factoryId: true, productionOrderId: true, status: true, plannedStart: true, plannedEnd: true },
    });
    if (!wo) return;

    // Always refresh the gate first (sets SCHEDULED_FOR_DELIVERY + materialReadyDate
    // so the WO/JOs cannot start before the latest ETA).
    await this.refreshWorkOrderMaterialStatus(workOrderId);

    const open = await this.prisma.materialRequest.findMany({
      where: { workOrderId, status: { in: ProductionService.OPEN_REQUEST_STATUSES as any } },
      include: { rawMaterial: { select: { code: true, name: true } } },
    });
    const withEta = open.filter((o) => !!o.deliveryDate);
    if (withEta.length === 0) return;

    const maxDate = new Date(Math.max(...withEta.map((o) => +o.deliveryDate!)));
    // Only relevant while the WO has not started and the ETA actually delays it.
    if (!['PLANNED', 'RELEASED'].includes(wo.status)) return;
    if (+maxDate <= +wo.plannedStart) return;

    const delta = +maxDate - +wo.plannedStart;
    const proposedStart = maxDate;
    const proposedEnd = new Date(+wo.plannedEnd + delta);

    // No parent PO → no PO-level governance; shift the WO + its JOs directly.
    if (!wo.productionOrderId) {
      const jos = await this.prisma.jobOrder.findMany({ where: { workOrderId }, select: { id: true, plannedStart: true, plannedEnd: true } });
      for (const jo of jos) {
        await this.prisma.jobOrder.update({
          where: { id: jo.id },
          data: {
            ...(jo.plannedStart && { plannedStart: new Date(+jo.plannedStart + delta) }),
            ...(jo.plannedEnd && { plannedEnd: new Date(+jo.plannedEnd + delta) }),
          },
        });
      }
      await this.prisma.workOrder.update({ where: { id: workOrderId }, data: { plannedStart: proposedStart, plannedEnd: proposedEnd } });
      return;
    }

    // Raise (or update) a PENDING PO reschedule request for approval. Do NOT move
    // any dates yet — approval is what applies the new window.
    const po = await this.prisma.productionOrder.findUnique({ where: { id: wo.productionOrderId }, select: { plannedEnd: true, orderNumber: true } });
    const reason =
      `Material delivery: latest supplier ETA ${maxDate.toISOString().slice(0, 10)} for ${withEta.length} short material(s) — ` +
      `WO ${wo.orderNumber} start deferred from ${wo.plannedStart.toISOString().slice(0, 10)} to ${maxDate.toISOString().slice(0, 10)}.`;
    const details = {
      origin: 'Material Shortage Delivery',
      workOrder: wo.orderNumber,
      originalStart: wo.plannedStart.toISOString(),
      originalEnd: wo.plannedEnd.toISOString(),
      deliveryEta: maxDate.toISOString(),
      delayDays: Math.round(delta / 86_400_000),
      materials: withEta.map((o) => ({
        requestNumber: o.requestNumber,
        code: (o.rawMaterial as any)?.code ?? null,
        name: (o.rawMaterial as any)?.name ?? null,
        shortBy: o.quantityShort,
        unit: o.unit,
        eta: o.deliveryDate?.toISOString() ?? null,
      })),
    } as any;

    const existing = await this.prisma.rescheduleRequest.findFirst({
      where: { factoryId: wo.factoryId, productionOrderId: wo.productionOrderId, status: 'PENDING' },
    });
    const data = {
      proposedStart,
      proposedEnd,
      dueDate: po?.plannedEnd ?? null,
      reason,
      source: 'MATERIAL_DELIVERY',
      workOrderId: wo.id,
      details,
    };
    if (existing) {
      await this.prisma.rescheduleRequest.update({ where: { id: existing.id }, data });
    } else {
      await this.prisma.rescheduleRequest.create({
        data: { factoryId: wo.factoryId, productionOrderId: wo.productionOrderId, requestedById: userId, status: 'PENDING', ...data },
      });
    }
    this.eventEmitter.emit('production.reschedule.requested', {
      workOrderId, productionOrderId: wo.productionOrderId, factoryId: wo.factoryId, source: 'MATERIAL_DELIVERY', proposedStart, proposedEnd,
    });
    this.logger.warn(`Material delivery reschedule request raised for PO ${po?.orderNumber ?? wo.productionOrderId} (WO ${wo.orderNumber} → ${maxDate.toISOString().slice(0, 10)})`);
  }

  /** Throw if a WO cannot start yet because of an open material gate. */
  private assertMaterialsClearedToStart(wo: { orderNumber: string; materialStatus: string; materialReadyDate: Date | null }) {
    if (wo.materialStatus === 'AWAITING_MATERIALS') {
      throw new BadRequestException(
        `Work order ${wo.orderNumber} is awaiting materials — it cannot start until the open material request(s) are fulfilled by inventory.`,
      );
    }
    if (wo.materialStatus === 'SCHEDULED_FOR_DELIVERY' && wo.materialReadyDate && new Date() < wo.materialReadyDate) {
      throw new BadRequestException(
        `Work order ${wo.orderNumber} is scheduled to start after the material delivery date (${wo.materialReadyDate.toISOString().slice(0, 16).replace('T', ' ')}). It cannot start before then.`,
      );
    }
  }

  private async generateMaterialRequestNumber(factoryId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.prisma.materialRequest.count({ where: { factoryId } });
    return `MR-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Post produced finished goods into a FINISHED_GOODS storage location on WO
   * completion: create a FinishedGoodsLot (base-unit converted), bump SKU on-hand,
   * write a RECEIPT stock movement + PRODUCED_FROM trace link. Idempotent per WO.
   */
  private async postFinishedGoods(
    wo: { id: string; factoryId: string; orderNumber: string; skuId: string | null; productionOrderId: string | null },
    batch: { id: string; batchNumber: string; lotNumber: string | null },
    goodQty: number,
    userId: string | null,
    producedAt: Date,
  ): Promise<void> {
    try {
      if (!wo.skuId || goodQty <= 0) return;
      const already = await this.prisma.finishedGoodsLot.findFirst({ where: { workOrderId: wo.id }, select: { id: true } });
      if (already) return; // idempotent — re-completion must not double-post

      const sku = await this.prisma.sKU.findUnique({
        where: { id: wo.skuId },
        select: { id: true, code: true, name: true, baseUnit: true, currentStock: true, storageLocationId: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true },
      });
      if (!sku) return;

      // Production unit: the PO unit (e.g. CARTON) when linked, else the base unit.
      let producedUnit = sku.baseUnit;
      if (wo.productionOrderId) {
        const po = await this.prisma.productionOrder.findUnique({ where: { id: wo.productionOrderId }, select: { unit: true } });
        if (po?.unit) producedUnit = po.unit;
      }
      const baseQty = this.toBaseUnits(goodQty, producedUnit, sku.baseUnit, sku);

      // Resolve a finished-goods location: the SKU's own, else the factory's FG zone.
      let locId = sku.storageLocationId;
      if (!locId) {
        const loc = await this.prisma.storageLocation.findFirst({ where: { factoryId: wo.factoryId, zone: 'FINISHED_GOODS', isActive: true }, select: { id: true } });
        locId = loc?.id ?? null;
      }

      const fgLot = await this.prisma.finishedGoodsLot.create({
        data: {
          factoryId: wo.factoryId,
          skuId: sku.id,
          workOrderId: wo.id,
          batchRecordId: batch.id,
          storageLocationId: locId,
          lotNumber: batch.lotNumber ?? `FG-${wo.orderNumber}`,
          quantity: baseQty,
          remainingQty: baseQty,
          unit: sku.baseUnit,
          producedQty: goodQty,
          producedUnit,
          status: 'ACTIVE',
          producedAt,
        },
      });

      const stockBefore = sku.currentStock ?? 0;
      await this.prisma.sKU.update({ where: { id: sku.id }, data: { currentStock: { increment: baseQty } } });

      await this.prisma.stockMovement.create({
        data: {
          factoryId: wo.factoryId,
          entityType: 'PRODUCT',
          entityId: sku.id,
          entityCode: sku.code,
          entityName: sku.name,
          movementType: 'RECEIPT',
          quantity: baseQty,
          stockBefore,
          stockAfter: Math.round((stockBefore + baseQty) * 1000) / 1000,
          referenceType: 'PRODUCTION_WO',
          referenceId: wo.id,
          referenceNumber: wo.orderNumber,
          performedById: userId,
          notes: `Finished goods received from ${batch.batchNumber} (${goodQty} ${producedUnit} → ${baseQty} ${sku.baseUnit})`,
        },
      });

      await this.prisma.traceabilityLink.create({
        data: {
          factoryId: wo.factoryId,
          parentType: 'WORK_ORDER',
          parentId: wo.id,
          childType: 'FINISHED_GOODS_LOT',
          childId: fgLot.id,
          linkType: 'PRODUCED_FROM',
          qty: baseQty,
          unit: sku.baseUnit,
        },
      }).catch(() => undefined);

      await this.prisma.traceEvent.create({
        data: {
          factoryId: wo.factoryId,
          entityType: 'PRODUCT',
          entityId: sku.id,
          entityCode: sku.code,
          eventType: 'STOCK_IN',
          quantity: baseQty,
          eventData: {
            lot: fgLot.lotNumber,
            storageLocationId: locId,
            producedQty: goodQty,
            producedUnit,
            baseUnit: sku.baseUnit,
            workOrder: wo.orderNumber,
            batchNumber: batch.batchNumber,
          },
          performedById: userId,
          performedAt: producedAt,
          relatedType: 'PROD_WO',
          relatedId: wo.id,
        },
      }).catch(() => undefined);

      this.logger.log(`WO ${wo.orderNumber} — posted ${baseQty} ${sku.baseUnit} finished goods to inventory`);
    } catch (err) {
      // Finished-goods posting must never block production completion
      this.logger.error('Finished-goods posting failed', err as Error);
    }
  }

  /**
   * FEFO→FIFO multi-lot consumption engine.
   * Orders lots by earliest expiry (never expired), then oldest receipt; splits the
   * demand across as many lots as needed, decrementing each lot's remainingQty
   * (status → DEPLETED at zero). Writes one MaterialConsumption row PER lot slice
   * (the genealogy feed), a stock-ledger ISSUE entry, releases the soft reservation,
   * and raises a LOT_SHORTAGE trace event when lot stock can't cover the demand.
   */
  private async consumeMaterialFifo(params: {
    factoryId: string;
    workOrderId: string;
    orderNumber: string;
    batchId: string | null;
    batchNumber: string;
    userId: string | null;
    consumedAt: Date;
    material: { rawMaterialId: string | null; materialCode: string | null; name: string; unit: string };
    step: { sequenceOrder: number; operationName: string };
    plannedQty: number;
    actualQty: number;
    jobOrderId?: string | null;
  }) {
    const { factoryId, material } = params;
    const round3 = (x: number) => Math.round(x * 1000) / 1000;

    const lots = (material.rawMaterialId || material.materialCode)
      ? await this.prisma.materialLot.findMany({
          where: {
            factoryId,
            status: 'ACTIVE',
            remainingQty: { gt: 0 },
            OR: [{ expiryDate: null }, { expiryDate: { gte: params.consumedAt } }],
            ...(material.rawMaterialId
              ? { rawMaterialId: material.rawMaterialId }
              : { materialCode: material.materialCode! }),
          },
          orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
        })
      : [];

    // Split demand across lots (FEFO first, FIFO tiebreak)
    let remaining = round3(params.actualQty);
    const slices: Array<{ lotId: string | null; lotNumber: string | null; qty: number }> = [];
    for (const lot of lots) {
      if (remaining <= 0) break;
      const take = round3(Math.min(lot.remainingQty, remaining));
      const left = round3(lot.remainingQty - take);
      await this.prisma.materialLot.update({
        where: { id: lot.id },
        data: { remainingQty: left, ...(left <= 0 && { status: 'DEPLETED' }) },
      });
      slices.push({ lotId: lot.id, lotNumber: lot.lotNumber, qty: take });
      remaining = round3(remaining - take);
    }
    const shortage = remaining > 0;
    if (shortage || slices.length === 0) {
      // Unlotted remainder still recorded so the ledger stays complete
      slices.push({ lotId: null, lotNumber: null, qty: round3(Math.max(remaining, 0)) });
    }

    // One consumption row per lot slice — planned qty distributed pro-rata
    const totalActual = params.actualQty > 0 ? params.actualQty : 1;
    for (const slice of slices) {
      await this.prisma.materialConsumption.create({
        data: {
          factoryId,
          workOrderId: params.workOrderId,
          batchRecordId: params.batchId,
          jobOrderId: params.jobOrderId ?? null,
          materialLotId: slice.lotId,
          materialCode: material.materialCode ?? material.name,
          materialName: material.name,
          quantityPlanned: round3(params.plannedQty * (slice.qty / totalActual)),
          quantityActual: slice.qty,
          unit: material.unit,
          consumedAt: params.consumedAt,
          consumedById: params.userId,
        },
      });
    }

    // Stock ledger + reservation release on the raw-material master
    if (material.rawMaterialId) {
      const rm = await this.prisma.rawMaterial.findUnique({ where: { id: material.rawMaterialId } });
      if (rm) {
        const stockBefore = rm.currentStock;
        const stockAfter = round3(Math.max(0, stockBefore - params.actualQty));
        await this.prisma.rawMaterial.update({
          where: { id: rm.id },
          data: {
            currentStock: stockAfter,
            reservedStock: round3(Math.max(0, rm.reservedStock - params.plannedQty)),
          },
        });
        await this.prisma.stockMovement.create({
          data: {
            factoryId,
            entityType: 'RAW_MATERIAL',
            entityId: rm.id,
            entityCode: rm.code,
            entityName: rm.name,
            movementType: 'CONSUMPTION',
            quantity: -params.actualQty,
            unitCost: rm.unitCost,
            totalCost: rm.unitCost != null ? round3(rm.unitCost * params.actualQty) : null,
            stockBefore,
            stockAfter,
            referenceType: 'PRODUCTION_WO',
            referenceId: params.workOrderId,
            referenceNumber: params.orderNumber,
            performedById: params.userId,
            notes: `${params.step.operationName} (step ${params.step.sequenceOrder}) → ${params.batchNumber}`,
          },
        });
      }
    }

    // CONSUMED trace event carrying the full lot split
    await this.prisma.traceEvent.create({
      data: {
        factoryId,
        entityType: 'RAW_MATERIAL',
        entityId: material.rawMaterialId ?? material.materialCode ?? material.name,
        entityCode: material.materialCode ?? material.name,
        eventType: 'CONSUMED',
        quantity: round3(params.actualQty),
        eventData: {
          material: material.name,
          unit: material.unit,
          step: params.step.sequenceOrder,
          operation: params.step.operationName,
          lots: slices.map((s) => ({ lotNumber: s.lotNumber, qty: s.qty })),
          batchNumber: params.batchNumber,
          workOrder: params.orderNumber,
        },
        performedById: params.userId,
        performedAt: params.consumedAt,
        relatedType: 'PROD_WO',
        relatedId: params.workOrderId,
      },
    });

    if (shortage) {
      await this.prisma.traceEvent.create({
        data: {
          factoryId,
          entityType: 'RAW_MATERIAL',
          entityId: material.rawMaterialId ?? material.materialCode ?? material.name,
          entityCode: material.materialCode ?? material.name,
          eventType: 'LOT_SHORTAGE',
          quantity: round3(remaining),
          eventData: {
            material: material.name,
            unit: material.unit,
            required: round3(params.actualQty),
            coveredByLots: round3(params.actualQty - remaining),
            shortBy: round3(remaining),
            workOrder: params.orderNumber,
            batchNumber: params.batchNumber,
          },
          performedById: params.userId,
          performedAt: params.consumedAt,
          relatedType: 'PROD_WO',
          relatedId: params.workOrderId,
        },
      });
    }
  }

  /**
   * Incremental ("أول بأول") consumption for ONE completed routing step. Consumes
   * every routing-step material at the step's ACTUAL good output (FEFO/FIFO lot
   * depletion + raw-material stock + ledger), so stock falls as each step finishes
   * rather than in one lump at WO completion.
   *
   * Idempotent per job order: if this step already has consumption rows it is a
   * no-op — so the WO-completion pass can safely call it as a fallback for any
   * step that was never completed individually, with zero double-counting.
   */
  async consumeStepMaterials(
    jo: {
      id: string; factoryId: string; workOrderId: string;
      sequenceOrder: number; operationName: string;
      actualQtyGood: number; plannedQtyOut: number | null; routingStepId: string | null;
    },
    userId: string | null,
    opts?: { batchId?: string | null; batchNumber?: string; consumedAt?: Date },
  ): Promise<boolean> {
    try {
      if (!jo.routingStepId) return false;

      // Idempotency guard — never consume the same step twice.
      const already = await this.prisma.materialConsumption.count({ where: { jobOrderId: jo.id } });
      if (already > 0) return false;

      const materials = await this.prisma.routingStepMaterial.findMany({
        where: { stepId: jo.routingStepId },
      });
      if (materials.length === 0) return false;

      const wo = await this.prisma.workOrder.findUnique({
        where: { id: jo.workOrderId },
        select: { orderNumber: true },
      });
      const orderNumber = wo?.orderNumber ?? jo.workOrderId;
      const consumedAt = opts?.consumedAt ?? new Date();
      // Consume against the step's real good output (fallback to planned if 0).
      const output = jo.actualQtyGood > 0 ? jo.actualQtyGood : (jo.plannedQtyOut ?? 0);

      for (const m of materials) {
        const plannedQty = m.qtyPerOutputUnit * (jo.plannedQtyOut ?? 0);
        const actualUsed = m.qtyPerOutputUnit * output;
        if (actualUsed <= 0) continue;
        await this.consumeMaterialFifo({
          factoryId: jo.factoryId,
          workOrderId: jo.workOrderId,
          orderNumber,
          batchId: opts?.batchId ?? null,
          batchNumber: opts?.batchNumber ?? `BATCH-${orderNumber}`,
          userId,
          consumedAt,
          material: { rawMaterialId: m.rawMaterialId, materialCode: m.materialCode, name: m.name, unit: m.unit },
          step: { sequenceOrder: jo.sequenceOrder, operationName: jo.operationName },
          plannedQty,
          actualQty: actualUsed,
          jobOrderId: jo.id,
        });
      }

      // Let the inventory/raw-material views refresh live as stock falls.
      this.eventEmitter.emit('inventory.consumption.recorded', {
        factoryId: jo.factoryId, workOrderId: jo.workOrderId, jobOrderId: jo.id,
      });
      return true;
    } catch (err) {
      // Consumption must never block the job-order transition.
      this.logger.error(`consumeStepMaterials failed for JO ${jo.id}`, err as any);
      return false;
    }
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ────────────────────────────────────────────────────────────

  private async assertTransition(
    factoryId: string | null,
    workOrderId: string,
    targetStatus: WorkOrderStatus,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    const allowed = VALID_TRANSITIONS[wo.status];
    if (!allowed.includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot transition work order from ${wo.status} to ${targetStatus}. Allowed: [${allowed.join(', ')}]`,
      );
    }
    return wo;
  }

  private async updateMachineStatus(
    machineId: string,
    state: string,
    currentWOId: string | null,
    currentSKUId: string | null | undefined,
  ) {
    try {
      await this.prisma.machineCurrentStatus.upsert({
        where: { machineId },
        create: {
          machineId,
          state: state as 'RUNNING' | 'IDLE',
          currentWOId,
          currentSKUId: currentSKUId ?? null,
          goodCount: 0,
          rejectCount: 0,
        },
        update: {
          state: state as 'RUNNING' | 'IDLE',
          currentWOId,
          currentSKUId: currentSKUId ?? null,
          lastEventAt: new Date(),
          ...(state === 'IDLE' && { goodCount: 0, rejectCount: 0, downtimeMinutes: 0, runtimeMinutes: 0 }),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to update machine status for ${machineId}`, err);
    }
  }

  private async recordProductionEvent(
    factoryId: string,
    workOrderId: string | null,
    machineId: string | null | undefined,
    eventType: 'WO_STARTED' | 'WO_COMPLETED' | 'WO_PAUSED' | 'COUNT_UPDATE' | 'SCRAP_RECORDED',
    value?: number,
    metadata?: Record<string, unknown>,
  ) {
    try {
      await this.prisma.productionEvent.create({
        data: {
          factoryId,
          workOrderId,
          machineId: machineId ?? null,
          eventType,
          value: value ?? null,
          metadata: metadata as Prisma.InputJsonValue ?? undefined,
        },
      });
    } catch (err) {
      this.logger.error('Failed to record production event', err);
    }
  }

  private async calculateAndStoreOEE(
    wo: {
      factoryId: string;
      id: string;
      skuId: string | null;
      plannedStart: Date;
      plannedEnd: Date;
      actualStart: Date | null;
      plannedCycleTime: number | null;
    },
    totalOutput: number,
    goodOutput: number,
    actualEnd: Date,
  ) {
    if (!wo.actualStart) return null;

    // Routed WOs carry machines on their job orders, not the header — use the
    // first routed machine so the machine-grain OEE record is still anchored.
    const firstJo = await this.prisma.jobOrder.findFirst({
      where: { workOrderId: wo.id, machineId: { not: null } },
      orderBy: { sequenceOrder: 'asc' },
      select: { machineId: true },
    });
    const machineId = firstJo?.machineId ?? null;
    if (!machineId) return null;

    try {
      const plannedStart = wo.actualStart;
      const plannedEnd = actualEnd;
      const plannedMinutes = (plannedEnd.getTime() - plannedStart.getTime()) / 60_000;

      // Calculate downtime during this WO
      const downtimeEvents = await this.prisma.downtimeEvent.findMany({
        where: {
          workOrderId: wo.id,
          isPlanned: false,
          endTime: { not: null },
        },
      });
      const downtimeMinutes = downtimeEvents.reduce((s, e) => s + (e.durationMinutes ?? 0), 0);

      const idealCycleTime = wo.plannedCycleTime
        ? wo.plannedCycleTime / 60   // convert seconds → minutes
        : null;

      const result = this.oeeService.calculate({
        plannedProductionTime: plannedMinutes,
        downtime: downtimeMinutes,
        idealCycleTime: idealCycleTime ?? (plannedMinutes / (totalOutput || 1)),
        totalCount: totalOutput,
        goodCount: goodOutput,
      });

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      await this.prisma.oEERecord.create({
        data: {
          factoryId: wo.factoryId,
          machineId,
          recordDate: today,
          plannedProductionMin: plannedMinutes,
          actualProductionMin: plannedMinutes - downtimeMinutes,
          uptimeMin: result.actualRunTime,
          downtimeMin: downtimeMinutes,
          totalOutput,
          goodOutput,
          scrapOutput: totalOutput - goodOutput,
          idealCycleTime: idealCycleTime ?? null,
          availability: result.availability,
          performance: result.performance,
          quality: result.quality,
          oee: result.oee,
        },
      });

      // Update work order with OEE values
      await this.prisma.workOrder.update({
        where: { id: wo.id },
        data: {
          oee: result.oee,
          availability: result.availability,
          performance: result.performance,
          quality: result.quality,
          downtimeMinutes,
        },
      });

      return result;
    } catch (err) {
      this.logger.error('Failed to calculate/store OEE', err);
      return null;
    }
  }

  private mapWorkOrder(wo: any) {
    // Machine scope derives from the routing steps (job orders), not a header machine.
    const machines = dedupeMachines((wo.jobOrders ?? []).map((jo: any) => jo.machine));
    return {
      id: wo.id,
      orderNumber: wo.orderNumber,
      poNumber: wo.productionOrder?.orderNumber ?? null,
      productName: wo.sku?.name ?? '',
      productCode: wo.sku?.code ?? '',
      itemNumber: wo.sku?.itemNumber ?? '',
      status: wo.status,
      priority: wo.priority,
      plannedQty: wo.plannedQty,
      actualQty: wo.actualQty ?? 0,
      goodQty: wo.goodQty ?? 0,
      scrapQty: wo.scrapQty ?? 0,
      reworkQty: wo.reworkQty ?? 0,
      progress: this.calcProgress(wo),
      plannedStart: wo.plannedStart.toISOString(),
      actualStart: wo.actualStart?.toISOString(),
      plannedEnd: wo.plannedEnd.toISOString(),
      actualEnd: wo.actualEnd?.toISOString(),
      // Distinct machines across the routing; `machine`/`machineCode` kept as a
      // short summary (first step) for backward-compatible callers.
      machines,
      machine: machines.length ? (machines.length === 1 ? machines[0].name : `${machines.length} machines`) : '',
      machineCode: machines[0]?.code ?? '',
      line: wo.line?.name ?? '',
      // Both needed by the auto-start indicator: whether it is armed, and which
      // line it would contend for. Without the id the browser cannot tell two
      // lines apart by name alone, and "is something blocking it" is exactly
      // the question the indicator exists to answer.
      lineId: wo.lineId ?? null,
      autoStart: wo.autoStart ?? false,
      operator: wo.operator?.name ?? '',
      supervisor: wo.supervisor?.name ?? '',
      oee: wo.oee,
      availability: wo.availability,
      performance: wo.performance,
      quality: wo.quality,
      // Material-availability gate
      materialStatus: wo.materialStatus ?? 'OK',
      materialReadyDate: wo.materialReadyDate?.toISOString?.() ?? wo.materialReadyDate ?? null,
    };
  }

  private calcProgress(wo: { status: string; actualQty: number; plannedQty: number }): number {
    if (wo.status === 'COMPLETED') return 100;
    if (wo.status === 'CANCELLED') return 0;
    if (!wo.actualQty) return 0;
    return Math.min(Math.round((wo.actualQty / wo.plannedQty) * 100), 100);
  }

  /**
   * Next `WO-<year>-NNNN` number — robust to gaps, soft-deleted rows and other
   * factories (orderNumber is GLOBALLY unique). Derives the sequence from the highest
   * existing suffix + 1, NOT a live row count (which collides when numbers are skipped
   * or a soft-deleted WO still holds its number).
   */
  private async nextYearlyWONumber(year: number): Promise<string> {
    const last = await this.prisma.workOrder.findFirst({
      where: { orderNumber: { startsWith: `WO-${year}-` } },
      orderBy: { orderNumber: 'desc' },
      select: { orderNumber: true },
    });
    const seq = last ? (parseInt(last.orderNumber.split('-').pop() || '0', 10) || 0) + 1 : 1;
    return `WO-${year}-${String(seq).padStart(4, '0')}`;
  }

  private async generateOrderNumber(factoryId: string): Promise<string> {
    const today = new Date();
    const prefix = `WO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

    const lastOrder = await this.prisma.workOrder.findFirst({
      where: { factoryId, orderNumber: { startsWith: prefix } },
      orderBy: { orderNumber: 'desc' },
    });

    const seq = lastOrder ? parseInt(lastOrder.orderNumber.slice(-4), 10) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  }

  // ────────────────────────────────────────────────────────────
  // JOB ORDERS (ISA-95 Dispatch List — per RoutingStep per WO)
  // ────────────────────────────────────────────────────────────

  async listAllJobOrders(
    factoryId: string | null,
    filters: {
      status?: string; workOrderId?: string; productionOrderId?: string; machineIds?: string;
      areaId?: string; lineId?: string; machineId?: string;
    },
  ) {
    // machineIds: comma-separated multi-machine filter from the shop-floor smart filter
    const machineIdList = (filters.machineIds ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    // Global analysis scope (area/line/machine) → machine ids, intersected with any
    // explicit machineIds filter so the JO panel respects the active dashboard scope.
    const scopeIds = await this.kpiService.resolveScopeMachineIds(factoryId, {
      areaId: filters.areaId, lineId: filters.lineId, machineId: filters.machineId,
    });
    let machineFilter: string[] | undefined;
    if (scopeIds && machineIdList.length) machineFilter = scopeIds.filter((id) => machineIdList.includes(id));
    else if (scopeIds) machineFilter = scopeIds;
    else if (machineIdList.length) machineFilter = machineIdList;

    const where: any = {
      ...(factoryId ? { factoryId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.workOrderId ? { workOrderId: filters.workOrderId } : {}),
      ...(machineFilter ? { machineId: { in: machineFilter } } : {}),
      // Never show job orders of a deleted or archived work order — otherwise the
      // dispatch list keeps rendering the steps of WOs that were removed/cancelled.
      workOrder: {
        deletedAt: null,
        archivedAt: null,
        ...(filters.productionOrderId ? { productionOrderId: filters.productionOrderId } : {}),
      },
    };

    const jos = await this.prisma.jobOrder.findMany({
      where,
      orderBy: [{ workOrderId: 'asc' }, { sequenceOrder: 'asc' }],
      include: {
        machine: { select: { id: true, name: true, code: true } },
        workCenter: { select: { id: true, name: true, code: true } },
        workOrder: {
          select: {
            id: true, orderNumber: true,
            sku: { select: { name: true, code: true } },
            productionOrder: { select: { id: true, orderNumber: true } },
          },
        },
        operator: { select: { id: true, name: true, nameAr: true } },
        predecessor: {
          select: { id: true, operationName: true, status: true, routingStepId: true, actualStart: true },
        },
      },
    });

    const withDep = await this.attachDepTypes(jos);
    const joFactors = await this.jobOrderFactors(withDep.map((j: any) => j.id));
    const withOee = withDep.map((jo: any) => ({ ...jo, ...(joFactors.get(jo.id) ?? this.noFactors()) }));
    return this.attachTimeBasedOEE(withOee);
  }

  /**
   * Bulk-attach the SECOND availability method (time-based = Uptime ÷ (Uptime +
   * Downtime)) and its OEE to a list of job orders, using one batched downtime
   * query. The classic schedule-based values from calcJobOrderOEE are untouched.
   */
  private async attachTimeBasedOEE(jos: any[]): Promise<any[]> {
    const active = jos.filter((j) => j.machineId && j.actualStart);
    if (!active.length) {
      return jos.map((j) => ({ ...j, joAvailabilityTimeBased: null, joOEETimeBased: null }));
    }
    const machineIds = [...new Set(active.map((j) => j.machineId))];
    const earliest = active.reduce((m, j) => Math.min(m, new Date(j.actualStart).getTime()), Date.now());
    const events = await this.prisma.downtimeEvent.findMany({
      where: {
        machineId: { in: machineIds },
        isPlanned: false,
        startTime: { lte: new Date() },
        OR: [{ endTime: null }, { endTime: { gte: new Date(earliest) } }],
      },
      select: { machineId: true, startTime: true, endTime: true },
    });
    const now = Date.now();

    return jos.map((jo) => {
      if (!jo.machineId || !jo.actualStart) {
        return { ...jo, joAvailabilityTimeBased: null, joOEETimeBased: null };
      }
      const start = new Date(jo.actualStart).getTime();
      const end = jo.actualEnd ? new Date(jo.actualEnd).getTime() : now;
      const operatingMin = Math.max(0, (end - start) / 60_000);
      let downMin = 0;
      for (const ev of events) {
        if (ev.machineId !== jo.machineId) continue;
        const from = Math.max(ev.startTime.getTime(), start);
        const to = Math.min((ev.endTime ?? new Date(now)).getTime(), end);
        if (to > from) downMin += (to - from) / 60_000;
      }
      const runMin = Math.max(0, operatingMin - downMin);
      const availTb = (runMin + downMin) > 0 ? (runMin / (runMin + downMin)) * 100 : null;
      const joAvailabilityTimeBased = availTb != null ? parseFloat(availTb.toFixed(1)) : null;
      const joOEETimeBased =
        availTb != null && jo.joPerformance != null && jo.joQuality != null
          ? parseFloat((oeeIdentityOf(availTb, jo.joPerformance, jo.joQuality)).toFixed(1))
          : availTb != null && jo.joQuality != null
          ? parseFloat(((availTb / 100) * (jo.joQuality / 100) * 100).toFixed(1))
          : null;
      return { ...jo, joAvailabilityTimeBased, joOEETimeBased };
    });
  }

  /** Bulk-attach depType to a list of job orders without N+1 queries */
  private async attachDepTypes(jos: any[]): Promise<any[]> {
    const pairs = jos
      .filter((j) => j.routingStepId && j.predecessor?.routingStepId)
      .map((j) => ({ from: j.predecessor.routingStepId as string, to: j.routingStepId as string }));

    const recs = pairs.length
      ? await this.prisma.stepDependency.findMany({
          where: { OR: pairs.map((p) => ({ fromStepId: p.from, toStepId: p.to })) },
          select: { fromStepId: true, toStepId: true, type: true },
        })
      : [];

    const depMap = new Map(recs.map((r) => [`${r.fromStepId}:${r.toStepId}`, r.type as string]));

    return jos.map((jo) => ({
      ...jo,
      depType: jo.predecessor?.routingStepId && jo.routingStepId
        ? (depMap.get(`${jo.predecessor.routingStepId as string}:${jo.routingStepId as string}`) ?? 'FINISH_TO_START')
        : null,
    }));
  }

  async getJobOrders(factoryId: string | null, workOrderId: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    const jos = await this.prisma.jobOrder.findMany({
      where: { workOrderId },
      include: {
        machine: { select: { name: true, code: true, machineType: true } },
        workCenter: { select: { name: true, code: true } },
        routingStep: { select: { stepNumber: true, operationName: true } },
        materials: true,
        operator: { select: { id: true, name: true, nameAr: true } },
        predecessor: {
          select: { id: true, operationName: true, status: true, routingStepId: true, actualStart: true },
        },
        successors: { select: { id: true, operationName: true, status: true } },
      },
      orderBy: { sequenceOrder: 'asc' },
    });

    const withDep = await this.attachDepTypes(jos);
    const joFactors = await this.jobOrderFactors(withDep.map((j: any) => j.id));
    return withDep.map((jo: any) => ({ ...jo, ...(joFactors.get(jo.id) ?? this.noFactors()) }));
  }

  async generateJobOrders(
    factoryId: string | null,
    workOrderId: string,
    dto: { plannedStart?: string; plannedEnd?: string; clearExisting?: boolean; assignments?: Array<{ stepId: string; operatorId: string }> },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    // Per-routing-step operator pre-assignment (chosen in the auto-generate form)
    const operatorByStep = new Map((dto.assignments ?? []).filter((a) => a.operatorId).map((a) => [a.stepId, a.operatorId]));

    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, ...factoryFilter, deletedAt: null },
      include: {
        sku: true,
        productionOrder: { select: { orderNumber: true, unit: true } },
      },
    });
    if (!wo) throw new NotFoundException('Work order not found');
    if (!wo.skuId) throw new BadRequestException('Work order has no product (SKU) assigned');

    // Resolve manufacturing process for this SKU by scope priority:
    // 1) PRODUCT (direct)  2) PRODUCT_LIST (membership)
    // 3) CATEGORY (same category)  4) BASE_WEIGHT (same base weight)
    const stepsInclude = {
      routingSteps: {
        include: {
          machine: { select: { id: true, name: true, code: true } },
          workCenterRef: { select: { id: true, name: true, code: true } },
          // Primary + alternative machines for intelligent allocation
          machineOptions: {
            where: { isActive: true },
            orderBy: { priority: 'asc' as const },
            include: { machine: { select: { id: true, name: true, code: true, machineType: true } } },
          },
          // Typed routing relations (FS/SS/SF/FF + lag) — copied onto job orders
          predecessors: { select: { fromStepId: true, type: true, lagMins: true } },
        },
        orderBy: { stepNumber: 'asc' as const },
      },
    };
    // Canonical scope-chain resolution (PRODUCT → LIST → CATEGORY → BASE_WEIGHT)
    // — the process's covered product ids are the single source of truth.
    const process = await findProcessForSku<
      Prisma.ManufacturingProcessGetPayload<{ include: typeof stepsInclude }>
    >(this.prisma, factoryId, wo.skuId, stepsInclude);

    if (!process || process.routingSteps.length === 0) {
      throw new BadRequestException(
        'No active manufacturing process with routing steps found for this product. ' +
        'Configure a Manufacturing Process first.',
      );
    }

    const resolvedFactoryId = factoryId ?? wo.factoryId;

    if (dto.clearExisting) {
      await this.prisma.jobOrder.deleteMany({ where: { workOrderId } });
    } else {
      const existing = await this.prisma.jobOrder.count({ where: { workOrderId } });
      if (existing > 0) {
        throw new BadRequestException(
          `Work order already has ${existing} job orders. ` +
          'Pass clearExisting:true to regenerate.',
        );
      }
    }

    // Compute time window for distributing JOs
    const startMs = dto.plannedStart
      ? new Date(dto.plannedStart).getTime()
      : wo.plannedStart.getTime();
    const endMs = dto.plannedEnd
      ? new Date(dto.plannedEnd).getTime()
      : wo.plannedEnd.getTime();
    const steps = process.routingSteps;
    const slotMs = steps.length > 0 ? (endMs - startMs) / steps.length : 0;

    // Packaging specs for unit-flow calculation
    const skuPkg = {
      unitsPerInner: wo.sku?.unitsPerInner ?? 1,
      innersPerCarton: wo.sku?.innersPerCarton ?? 1,
      cartonsPerPallet: wo.sku?.cartonsPerPallet ?? 1,
    };
    const ppc = Math.max(1, skuPkg.unitsPerInner * skuPkg.innersPerCarton);
    const poUnit = (wo.productionOrder as any)?.unit ?? 'PIECE';
    // Normalise WO.plannedQty to PIECE base
    let prevOutputQty: number = poUnit === 'CARTON' ? wo.plannedQty * ppc
      : poUnit === 'PALLET' ? wo.plannedQty * ppc * skuPkg.cartonsPerPallet
      : wo.plannedQty;
    let prevOutputUnit = 'PIECE';

    const created: any[] = [];
    let prevId: string | null = null;
    const stepToJo = new Map<string, string>(); // routingStepId → created JO id

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Routing-defined predecessor (typed FS/SS/SF/FF + lag); falls back to
      // the sequential chain when the routing has no dependency rows.
      const routedDep = step.predecessors?.find((d) => stepToJo.has(d.fromStepId));
      const predecessorId = routedDep ? stepToJo.get(routedDep.fromStepId)! : prevId;
      const predecessorType = routedDep?.type ?? 'FINISH_TO_START';
      const predecessorLagMins = routedDep?.lagMins ?? 0;

      const jPlannedStart = new Date(startMs + i * slotMs);
      const jPlannedEnd = new Date(startMs + (i + 1) * slotMs);

      // Unit flow: the routing step's explicit In/Out units win;
      // the operation-name heuristic is only a fallback for legacy routings.
      const inputUnit  = step.inUnit ?? prevOutputUnit;
      const outputUnit = step.outUnit ?? this.resolveStepOutputUnit(step.operationName, inputUnit);
      const inputQty   = this.convertUnits(prevOutputQty, prevOutputUnit, inputUnit, skuPkg);
      const outputQty  = this.convertUnits(inputQty, inputUnit, outputUnit, skuPkg);

      // Intelligent allocation: default machine if idle in the window,
      // otherwise the earliest-finishing ready alternative.
      const pick = await this.pickStepMachine(step as any, factoryId, jPlannedStart, jPlannedEnd, outputQty);
      const resolvedMachineId = pick.machineId;

      // Look up ideal cycle time for this machine × product
      const cycleTime = resolvedMachineId
        ? await this.prisma.machineCycleTime.findFirst({
            where: { machineId: resolvedMachineId, skuId: wo.skuId, isActive: true },
          })
        : null;

      // ── Where the cycle time comes from ──────────────────────────────────
      // `RoutingStep.cycleTimeSec`, defined on the Manufacturing Process, is THE
      // reference for a step and for the machine running it. Everything below it
      // is either an explicit exception or a legacy field:
      //
      //   1. cycleOverrideSec  an ALTERNATIVE machine that genuinely runs at a
      //                        different rate. A deliberate, per-machine entry.
      //   2. step.cycleTimeSec the reference.
      //   3. machine x SKU     an older table, kept only so an order routed
      //   4. cycleTimeMins     before the routing carried seconds still gets a
      //                        denominator instead of a null Performance.
      //
      // Performance divides by this, so a job order that reaches (3) or (4) is
      // being graded against a number nobody has confirmed. It is logged rather
      // than left silent — an unvalidated denominator that nobody can see is how
      // Performance came to read 162% on this line.
      const idealCycleTimeSec: number | null = pick.cycleOverrideSec
        ?? step.cycleTimeSec
        ?? cycleTime?.cycleTimeSeconds
        ?? (step.cycleTimeMins != null ? step.cycleTimeMins * 60 : null);

      if (pick.cycleOverrideSec == null && step.cycleTimeSec == null) {
        this.logger.warn(
          `Routing step "${step.operationName ?? step.id}" has no cycleTimeSec; Performance for this `
          + `job order will be graded against ${idealCycleTimeSec == null
            ? 'nothing (Performance will be unmeasurable)'
            : `a fallback of ${idealCycleTimeSec}s`}. Set it on the Manufacturing Process.`,
        );
      }

      const jo: Record<string, unknown> = await this.prisma.jobOrder.create({
        data: {
          factoryId: resolvedFactoryId,
          workOrderId,
          routingStepId: step.id,
          machineId: resolvedMachineId,
          workCenterId: step.workCenterId ?? null,
          sequenceOrder: step.stepNumber,
          operationName: step.operationName,
          status: i === 0 ? 'READY' : 'SCHEDULED',
          predecessorId,
          predecessorType: predecessorType as any,
          predecessorLagMins,
          plannedStart: jPlannedStart,
          plannedEnd: jPlannedEnd,
          plannedQtyIn: inputQty,
          plannedQtyOut: outputQty,
          inputUnit,
          outputUnit,
          idealCycleTimeSec,
          assignmentReason: pick.reason,
          operatorId: operatorByStep.get(step.id) ?? null,
        },
        include: {
          machine: { select: { name: true, code: true } },
          workCenter: { select: { name: true, code: true } },
        },
      });

      prevOutputUnit = outputUnit;
      prevOutputQty  = outputQty;
      created.push(jo);
      prevId = jo['id'] as string;
      stepToJo.set(step.id, prevId);
    }

    this.logger.log(
      `Generated ${created.length} job orders for WO ${wo.orderNumber} ` +
      `(Process: ${process.name} v${process.version})`,
    );

    // Recalculate the plan for THIS work order only: finite-capacity forward
    // scheduling honouring FS/SS/SF/FF (SS = synchronized line, bottleneck end)
    // around the other open jobs' existing windows.
    let scheduled = 0;
    try {
      const res = await this.apsService.runSchedule(resolvedFactoryId, {
        workOrderId,
        startFrom: dto.plannedStart ?? wo.plannedStart.toISOString(),
      });
      scheduled = res.scheduled ?? 0;
    } catch (err) {
      this.logger.warn(`Scoped APS recalculation skipped for WO ${wo.orderNumber}: ${(err as any)?.message}`);
    }

    // Return the freshly scheduled windows
    const jobOrders = scheduled > 0
      ? await this.prisma.jobOrder.findMany({
          where: { workOrderId },
          orderBy: { sequenceOrder: 'asc' },
          include: {
            machine: { select: { name: true, code: true } },
            workCenter: { select: { name: true, code: true } },
          },
        })
      : created;

    // Keep the WORK ORDER window consistent with its scheduled JOB ORDERS — the JOs
    // are the schedule of record (finite-capacity + calendar), so the WO must reflect
    // their real span instead of the raw user-input window they diverged from.
    const jStarts = jobOrders.map((j: any) => (j.plannedStart ? +new Date(j.plannedStart) : null)).filter((x: number | null): x is number => x != null);
    const jEnds = jobOrders.map((j: any) => (j.plannedEnd ? +new Date(j.plannedEnd) : null)).filter((x: number | null): x is number => x != null);
    if (jStarts.length && jEnds.length) {
      await this.prisma.workOrder.update({
        where: { id: workOrderId },
        data: { plannedStart: new Date(Math.min(...jStarts)), plannedEnd: new Date(Math.max(...jEnds)) },
      }).catch(() => { /* non-fatal: keep the WO's original window if the sync fails */ });
    }

    return {
      created: created.length,
      scheduled,
      jobOrders,
      process: { name: process.name, version: process.version },
    };
  }

  /**
   * Per-step machine recommendation preview for a work order: every candidate
   * (default + alternatives) ranked by earliest finish (wait + setup + run),
   * with busy-until visibility — lets the UI show "M3 busy until 14:20 →
   * recommended: M4 (ready now)" before committing a (re)generation.
   */
  async recommendMachines(factoryId: string | null, workOrderId: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, ...factoryFilter, deletedAt: null },
      select: { id: true, orderNumber: true, plannedStart: true, plannedEnd: true },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    const jos = await this.prisma.jobOrder.findMany({
      where: { workOrderId },
      orderBy: { sequenceOrder: 'asc' },
      include: {
        machine: { select: { id: true, code: true, name: true } },
        routingStep: {
          include: {
            machineOptions: {
              where: { isActive: true },
              orderBy: { priority: 'asc' },
              include: { machine: { select: { id: true, code: true, name: true } } },
            },
          },
        },
      },
    });

    const steps = [] as any[];
    for (const jo of jos) {
      const from = jo.plannedStart ?? wo.plannedStart;
      const to = jo.plannedEnd ?? wo.plannedEnd;
      const options = jo.routingStep?.machineOptions ?? [];
      const candidates = await Promise.all(options.map(async (o) => {
        const cycleSec = o.cycleTimeSec ?? jo.routingStep?.cycleTimeSec ?? jo.idealCycleTimeSec ?? 60;
        const runMs = (jo.plannedQtyOut ?? 0) * cycleSec * 1000;
        const busyUntil = await this.machineBusyUntil(o.machineId, from, to);
        const waitMs = busyUntil ? Math.max(0, busyUntil.getTime() - from.getTime()) : 0;
        const setupMs = (o.setupTimeMins ?? 0) * 60_000;
        return {
          machineId: o.machineId,
          machineCode: o.machine.code,
          machineName: o.machine.name,
          isDefault: o.isDefault,
          priority: o.priority,
          cycleTimeSec: cycleSec,
          busyUntil,
          waitMins: Math.round(waitMs / 60_000),
          estFinish: new Date(from.getTime() + waitMs + setupMs + runMs),
          score: waitMs + setupMs + runMs,
        };
      }));
      candidates.sort((a, b) => a.score - b.score);
      steps.push({
        jobOrderId: jo.id,
        step: jo.sequenceOrder,
        operation: jo.operationName,
        assignedMachine: jo.machine,
        assignmentReason: jo.assignmentReason,
        recommended: candidates[0] ?? null,
        candidates,
      });
    }
    return { workOrder: { id: wo.id, orderNumber: wo.orderNumber }, steps };
  }

  /**
   * What this job order's routing says its cycle time is RIGHT NOW.
   *
   * Deliberately the same precedence `generateJobOrders` uses, in the same
   * order, so an order that starts later cannot be graded against a different
   * rule than one that started at generation time:
   *
   *   1. the machine's own override, for an alternative that runs differently
   *   2. the routing step — the reference
   *   3. the legacy minutes field
   *
   * Returns null when the routing has nothing to say, which leaves whatever the
   * order already carried. A missing reference is not a reason to erase a
   * denominator that was once resolved.
   */
  private async currentCycleTimeFor(
    jo: { routingStepId: string | null; machineId: string | null },
  ): Promise<number | null> {
    if (!jo.routingStepId) return null;

    const step = await this.prisma.routingStep.findUnique({
      where: { id: jo.routingStepId },
      select: { cycleTimeSec: true, cycleTimeMins: true },
    });
    if (!step) return null;

    if (jo.machineId) {
      const option = await this.prisma.routingStepMachineOption.findFirst({
        where: { stepId: jo.routingStepId, machineId: jo.machineId, isActive: true },
        select: { cycleTimeSec: true },
      });
      if (option?.cycleTimeSec != null) return option.cycleTimeSec;
    }

    return step.cycleTimeSec ?? (step.cycleTimeMins != null ? step.cycleTimeMins * 60 : null);
  }

  // ── An order's own planned stops ────────────────────────────────────────

  async getStopPlan(factoryId: string | null, productionOrderId: string) {
    const po = await this.prisma.productionOrder.findFirst({
      where: { id: productionOrderId, ...(factoryId ? { factoryId } : {}) },
      select: { id: true },
    });
    if (!po) throw new NotFoundException('Production order not found');
    return this.prisma.productionOrderStop.findMany({
      where: { productionOrderId, isActive: true },
      orderBy: { sequence: 'asc' },
    });
  }

  /**
   * Replace an order's stop plan.
   *
   * A wholesale replace rather than per-row edits, because the plan is a
   * SEQUENCE — the order of cleaning, startup and changeover is part of what it
   * says, and patching one row at a time makes that order something the caller
   * has to maintain by hand.
   *
   * Rows are soft-retired rather than deleted, and events already booked are
   * never touched. Editing this tomorrow says what happens NEXT time; a plan
   * that silently moved yesterday's booked cleaning would make every historical
   * report unreproducible — and the plant has just spent a week finding out
   * what unreproducible numbers cost.
   */
  async setStopPlan(
    factoryId: string | null,
    productionOrderId: string,
    items: Array<{
      kind?: string; label: string; durationMin: number;
      sequence?: number; recurrence?: string; affectsOEE?: boolean;
    }>,
  ) {
    const po = await this.prisma.productionOrder.findFirst({
      where: { id: productionOrderId, ...(factoryId ? { factoryId } : {}) },
      select: { id: true, orderNumber: true },
    });
    if (!po) throw new NotFoundException('Production order not found');

    const RECURRENCES = ['ONCE', 'PER_SHIFT', 'PER_RESTART'];
    for (const [i, it] of items.entries()) {
      if (!it.label?.trim()) throw new BadRequestException(`Stop ${i + 1} has no name`);
      if (!Number.isFinite(it.durationMin) || it.durationMin <= 0) {
        throw new BadRequestException(`"${it.label}" needs a duration in minutes`);
      }
      if (it.recurrence && !RECURRENCES.includes(it.recurrence)) {
        throw new BadRequestException(
          `"${it.label}": ${it.recurrence} is not a recurrence — use ${RECURRENCES.join(', ')}`,
        );
      }
    }

    await this.prisma.$transaction([
      // Retired, not deleted: a booked event names the plan row it came from,
      // and a hard delete would orphan that reference on every past occurrence.
      this.prisma.productionOrderStop.updateMany({
        where: { productionOrderId }, data: { isActive: false },
      }),
      ...items.map((it, i) => this.prisma.productionOrderStop.create({
        data: {
          productionOrderId,
          kind: it.kind ?? 'OTHER',
          label: it.label.trim(),
          durationMin: Math.round(it.durationMin),
          sequence: it.sequence ?? i,
          recurrence: (it.recurrence ?? 'ONCE') as any,
          // A changeover costs the reading; a meal break does not. Defaulted
          // from the kind rather than assumed, so an unnamed kind still has to
          // state its own answer.
          affectsOEE: it.affectsOEE ?? (it.kind !== 'CLEANING'),
        },
      })),
    ]);

    this.logger.log(`PO ${po.orderNumber}: stop plan set to ${items.length} item(s)`);
    return this.getStopPlan(factoryId, productionOrderId);
  }

  /**
   * Move EVERY step of a work order at once.
   *
   * ── Why this exists ─────────────────────────────────────────────────────
   * A line's four steps run start-to-start: the operator starts them together,
   * pauses them together and finishes them together. Doing that one card at a
   * time is four taps that must all land, and on 25 Aug 2026 they did not — one
   * machine ended up in a different state from its siblings and nothing said
   * so. The tablet asked for one button; this is the one call behind it.
   *
   * Each step is transitioned through the SAME path a single card uses, so
   * every guard, every stop plan and every state sync applies exactly as it
   * would have. This is a loop, deliberately, not a bulk UPDATE: a batch that
   * skipped those rules would be a second way to start production.
   *
   * A step that legitimately cannot move — already complete, dependency unmet —
   * is REPORTED rather than failing the batch. The operator asked for the line
   * to start; a step that was already running is not an error worth refusing
   * the other three for.
   */
  // ── Taking a step out of the line ───────────────────────────────────

  /**
   * What the tablet needs to draw the bypass control and its confirmation:
   * every step of this work order, which are bypassed, and which one the line's
   * output is read from right now.
   */
  async getStepBypass(factoryId: string | null, workOrderId: string) {
    const steps = await this.prisma.jobOrder.findMany({
      where: { workOrderId, ...(factoryId ? { factoryId } : {}) },
      orderBy: { sequenceOrder: 'asc' },
      select: {
        id: true, sequenceOrder: true, operationName: true, status: true,
        bypassedAt: true, bypassedBy: true, bypassReason: true,
        actualQtyGood: true, actualQtyRejected: true,
        machine: { select: { code: true, name: true } },
      },
    });
    const lite: BypassStep[] = steps.map((s) => ({
      id: s.id, sequenceOrder: s.sequenceOrder, operationName: s.operationName,
      machineCode: s.machine?.code ?? null, bypassedAt: s.bypassedAt,
    }));
    const current = outputStepAfter(lite);
    return {
      workOrderId,
      outputStepId: current?.id ?? null,
      steps: steps.map((s) => ({
        id: s.id,
        sequenceOrder: s.sequenceOrder,
        operationName: s.operationName,
        status: s.status,
        machineCode: s.machine?.code ?? null,
        machineName: s.machine?.name ?? null,
        good: s.actualQtyGood,
        rejected: s.actualQtyRejected,
        bypassedAt: s.bypassedAt,
        bypassedBy: s.bypassedBy,
        bypassReason: s.bypassReason,
        isOutputStep: current?.id === s.id,
        // What the confirmation dialog reads out before asking for a password.
        outputMovesTo: s.bypassedAt ? null : (outputStepAfter(lite, s.id)?.id ?? null),
      })),
    };
  }

  /**
   * Bypass a step, or put it back.
   *
   * This changes which machine the WHOLE LINE's output is read from, on every
   * screen and in both engines at once — so it is gated on a password, refuses
   * to leave an order with no counting step, and records who did it and why.
   */
  async setStepBypass(
    factoryId: string | null,
    userId: string | null,
    jobOrderId: string,
    dto: { bypassed: boolean; password: string; reason?: string },
  ) {
    const jo = await this.prisma.jobOrder.findFirst({
      where: { id: jobOrderId, ...(factoryId ? { factoryId } : {}) },
      select: { id: true, workOrderId: true },
    });
    if (!jo) throw new NotFoundException('Job order not found');

    const gate = checkBypassPassword(dto.password);
    if (!gate.ok) throw new BadRequestException(gate.reason);

    const steps = await this.prisma.jobOrder.findMany({
      where: { workOrderId: jo.workOrderId, ...(factoryId ? { factoryId } : {}) },
      orderBy: { sequenceOrder: 'asc' },
      select: {
        id: true, sequenceOrder: true, operationName: true, bypassedAt: true,
        machine: { select: { code: true } },
      },
    });
    const lite: BypassStep[] = steps.map((x) => ({
      id: x.id, sequenceOrder: x.sequenceOrder, operationName: x.operationName,
      machineCode: x.machine?.code ?? null, bypassedAt: x.bypassedAt,
    }));

    const verdict = dto.bypassed ? canBypass(lite, jobOrderId) : canRestore(lite, jobOrderId);
    if (!verdict.ok) throw new BadRequestException(verdict.reason);

    await this.prisma.jobOrder.update({
      where: { id: jobOrderId },
      data: dto.bypassed
        ? { bypassedAt: new Date(), bypassedBy: userId, bypassReason: dto.reason?.trim() || null }
        : { bypassedAt: null, bypassedBy: null, bypassReason: null },
    });

    return this.getStepBypass(factoryId, jo.workOrderId);
  }

  async setWorkOrderJobStatuses(
    factoryId: string | null,
    userId: string | null,
    workOrderId: string,
    status: string,
    dto: { notes?: string } = {},
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const jos = await this.prisma.jobOrder.findMany({
      where: { workOrderId, ...factoryFilter },
      orderBy: { sequenceOrder: 'asc' },
      select: { id: true, status: true, operationName: true, sequenceOrder: true },
    });
    if (jos.length === 0) throw new NotFoundException('No job orders on this work order');

    const moved: string[] = [];
    const skipped: Array<{ step: string; reason: string }> = [];

    for (const jo of jos) {
      if (jo.status === status) {
        skipped.push({ step: jo.operationName, reason: `already ${status}` });
        continue;
      }
      try {
        await this.updateJobOrderStatus(factoryId, userId, jo.id, status, dto);
        moved.push(jo.operationName);
      } catch (e) {
        skipped.push({ step: jo.operationName, reason: (e as Error).message });
      }
    }

    this.logger.log(
      `WO ${workOrderId} → ${status}: ${moved.length} step(s) moved`
      + (skipped.length ? `, ${skipped.length} skipped` : ''),
    );
    return { status, moved, skipped, total: jos.length };
  }

  async updateJobOrderStatus(
    factoryId: string | null,
    userId: string | null,
    jobOrderId: string,
    status: string,
    dto: { actualQtyGood?: number; actualQtyRejected?: number; handoverQty?: number; notes?: string },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const jo = await this.prisma.jobOrder.findFirst({
      where: { id: jobOrderId, ...factoryFilter },
      include: {
        predecessor: {
          select: {
            id: true, operationName: true, status: true,
            routingStepId: true, actualStart: true,
          },
        },
        workOrder: { select: { orderNumber: true, materialStatus: true, materialReadyDate: true } },
      },
    });
    if (!jo) throw new NotFoundException('Job order not found');

    // Material gate: a job order cannot start while its WO is awaiting materials or
    // is scheduled to start after a (future) supplier delivery date.
    if (status === 'EXECUTING' && (jo as any).workOrder) {
      this.assertMaterialsClearedToStart((jo as any).workOrder);
    }

    const VALID_JO_TRANSITIONS: Record<string, string[]> = {
      SCHEDULED: ['READY', 'CANCELLED'],
      READY:     ['EXECUTING', 'CANCELLED'],
      EXECUTING: ['PAUSED', 'COMPLETE', 'CANCELLED'],
      PAUSED:    ['EXECUTING', 'CANCELLED'],
      COMPLETE:  [],
      CANCELLED: [],
    };

    const allowed = VALID_JO_TRANSITIONS[jo.status] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `Cannot transition job order from ${jo.status} to ${status}. ` +
        `Allowed: [${allowed.join(', ')}]`,
      );
    }

    // ── One EXECUTING job order per machine ──────────────────────────────
    //
    // Not a policy preference — the counters cannot honour more than one. The
    // edge resolves which order to credit with:
    //
    //   findMany({ where: { machineId, status: 'EXECUTING' },
    //              orderBy: { actualStart: 'desc' } })   → keeps the FIRST
    //
    // (counter.service.ts). So a second EXECUTING order on the same machine
    // does not split the count or raise an error; it silently receives NOTHING,
    // and every figure derived from it — Performance, Quality, the whole OEE —
    // is computed against a denominator with no numerator. On this plant's
    // schedule that is the ordinary case, not an exotic one: two products a day
    // change over on the same line, and starting the second before closing the
    // first is one click.
    //
    // Refused here rather than repaired later, because the lost pulses cannot be
    // reconstructed after the fact.
    if (status === 'EXECUTING' && jo.machineId) {
      const busy = await this.prisma.jobOrder.findFirst({
        where: { machineId: jo.machineId, status: 'EXECUTING', id: { not: jobOrderId } },
        select: { id: true, operationName: true, workOrder: { select: { orderNumber: true } } },
      });
      if (busy) {
        throw new BadRequestException(
          `This machine is already running job order "${busy.operationName}"`
          + `${busy.workOrder?.orderNumber ? ` (${busy.workOrder.orderNumber})` : ''}. `
          + 'Complete or pause it first — the machine counters can only be credited to one '
          + 'running job order, so the second would silently record zero output.',
        );
      }
    }

    // ── Dependency-aware start validation (→ EXECUTING) ──────────────────
    if (status === 'EXECUTING' && (jo as any).predecessor) {
      const pred = (jo as any).predecessor;
      const dep = await this.lookupDepType(pred.routingStepId, jo.routingStepId);

      if (dep === 'FINISH_TO_START' && pred.status !== 'COMPLETE') {
        throw new BadRequestException(
          `FS dependency: "${pred.operationName}" must FINISH before "${jo.operationName}" can start.`,
        );
      }
      if (dep === 'START_TO_START' && !['EXECUTING', 'COMPLETE'].includes(pred.status)) {
        throw new BadRequestException(
          `SS dependency: "${pred.operationName}" must START before "${jo.operationName}" can start.`,
        );
      }
      // SF and FF impose NO start restriction — B can start independently
    }

    // ── Dependency-aware complete validation (→ COMPLETE) ────────────────
    if (status === 'COMPLETE' && (jo as any).predecessor) {
      const pred = (jo as any).predecessor;
      const dep = await this.lookupDepType(pred.routingStepId, jo.routingStepId);

      if (dep === 'FINISH_TO_FINISH' && pred.status !== 'COMPLETE') {
        throw new BadRequestException(
          `FF dependency: "${pred.operationName}" must FINISH before "${jo.operationName}" can complete.`,
        );
      }
      if (dep === 'START_TO_FINISH' && !pred.actualStart) {
        throw new BadRequestException(
          `SF dependency: "${pred.operationName}" must START before "${jo.operationName}" can complete.`,
        );
      }
    }

    // ── Re-read the cycle time at the moment it starts to matter ─────────
    //
    // `idealCycleTimeSec` is copied onto the job order when the order is
    // GENERATED, and nothing updated it afterwards. Correcting a routing —
    // which this plant needs to do, its filler is recorded at 30 s/unit
    // against a schedule that says 1.2 — left every already-generated order
    // dividing by the old number, and the only way out was to delete the
    // orders and generate them again.
    //
    // Taken here instead, on the transition to EXECUTING, and only when the
    // order has never started. Before that instant the figure is inert; from
    // it, the figure IS Performance's denominator. So a routing fixed at any
    // point before the operator presses start now simply applies.
    //
    // A running or finished order keeps what it had. Rewriting the denominator
    // under minutes already measured against it would change published
    // readings retroactively, which is not a correction — it is a different
    // number wearing the same date.
    const freshCycle = status === 'EXECUTING' && !jo.actualStart
      ? await this.currentCycleTimeFor(jo)
      : null;

    const updated = await this.prisma.jobOrder.update({
      where: { id: jobOrderId },
      data: {
        status: status as any,
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(status === 'EXECUTING' && !jo.actualStart && { actualStart: new Date() }),
        ...(freshCycle != null && freshCycle !== jo.idealCycleTimeSec
          && { idealCycleTimeSec: freshCycle }),
        ...(status === 'COMPLETE' && {
          actualEnd: new Date(),
          // auto-set handoverQty so successor step receives the right qty
          handoverQty: dto.handoverQty ?? dto.actualQtyGood ?? (jo as any).plannedQtyOut ?? 0,
        }),
        ...(dto.actualQtyGood !== undefined && { actualQtyGood: dto.actualQtyGood }),
        ...(dto.actualQtyRejected !== undefined && { actualQtyRejected: dto.actualQtyRejected }),
        ...(dto.handoverQty !== undefined && { handoverQty: dto.handoverQty }),
      },
    });

    // Keep the machine state + live snapshot consistent with the JO it runs
    if (jo.machineId) {
      await this.syncMachineStateWithJobOrder(jo.factoryId, jo.machineId, status, jo.workOrderId, jo.actualStart ?? updated.actualStart);
    }

    // Work-order stop rules — changeover and the like. Fired on the transition
    // INTO execution, not on every save, because that is the one moment the
    // system can see both the incoming order and what ran on the machine before
    // it. Failures are swallowed: a changeover rule that cannot be evaluated
    // must never stop a production order from starting.
    if (status === 'EXECUTING' && !jo.actualStart) {
      // Emitted rather than called directly: ShiftModule already imports
      // ProductionModule for the KPI engine, so injecting the other way would
      // close a dependency cycle. An event keeps the direction one-way.
      this.eventEmitter.emit('production.job-order.started', {
        factoryId: jo.factoryId,
        jobOrderId,
        machineId: jo.machineId,
        workOrderId: jo.workOrderId,
        startedAt: updated.actualStart ?? new Date(),
      });
    }

    // ── The order's own planned stops ───────────────────────────────────────
    // Booked from the ACTUAL start, which is the whole point: the order that
    // ran two hours late on 25 Aug 2026 had its changeover booked against the
    // planned time, and 108 machine-minutes were credited to a changeover that
    // never happened.
    //
    // A first start and a resume are different occurrences and bring different
    // stops with them — a resumed order does not clean the line again, but it
    // may well need bringing back up to speed. Swallowed on failure: a stop
    // plan that cannot be laid must never stop production from starting.
    if (status === 'EXECUTING') {
      const trigger = jo.actualStart ? 'RESTART' : 'FIRST_START';
      const startedAt = trigger === 'FIRST_START'
        ? (updated.actualStart ?? new Date())
        : new Date();
      await this.autoStops.onJobOrderStart(jobOrderId, trigger, startedAt)
        .then((n) => {
          if (n > 0) this.logger.log(`JO ${jobOrderId}: booked ${n} planned stop(s) on ${trigger}`);
        })
        .catch((e) => this.logger.warn(`stop plan for JO ${jobOrderId} not laid: ${(e as Error).message}`));
    }

    // Incremental ("أول بأول") material consumption when a routing step finishes:
    // deplete this step's materials/lots now, not in one lump at WO completion.
    if (status === 'COMPLETE') {
      await this.consumeStepMaterials({
        id: updated.id,
        factoryId: updated.factoryId,
        workOrderId: updated.workOrderId,
        sequenceOrder: updated.sequenceOrder,
        operationName: updated.operationName,
        actualQtyGood: updated.actualQtyGood,
        plannedQtyOut: updated.plannedQtyOut,
        routingStepId: updated.routingStepId,
      }, null);
    }

    // ── Auto-promote successors based on their dep type ───────────────────
    const successors = await this.prisma.jobOrder.findMany({
      where: { predecessorId: jobOrderId, status: 'SCHEDULED' },
    });

    for (const succ of successors) {
      const dep = await this.lookupDepType(jo.routingStepId, succ.routingStepId);
      let shouldPromote = false;

      // FS: promote on predecessor COMPLETE
      if (status === 'COMPLETE' && dep === 'FINISH_TO_START') shouldPromote = true;
      // SS: promote on predecessor EXECUTING (parallel start!)
      if (status === 'EXECUTING' && dep === 'START_TO_START') shouldPromote = true;
      // FF: B can start anytime → promote immediately on first transition of predecessor
      if (dep === 'FINISH_TO_FINISH' && ['EXECUTING', 'COMPLETE'].includes(status)) shouldPromote = true;
      // SF: B must start before A → promote immediately (unusual ordering)
      if (dep === 'START_TO_FINISH') shouldPromote = true;

      if (shouldPromote) {
        const transferQty = dto.handoverQty ?? updated.actualQtyGood ?? 0;
        if (transferQty >= (succ.handoverCriteria ?? 0)) {
          await this.prisma.jobOrder.update({ where: { id: succ.id }, data: { status: 'READY' } });
          this.logger.log(`[${dep}] "${succ.operationName}" promoted READY after "${jo.operationName}" → ${status}`);
        }
      }
    }

    // Timeline event for the live dashboard (start / pause / resume / complete)
    const evType =
      status === 'EXECUTING' ? (jo.status === 'PAUSED' ? 'DOWNTIME_END' : 'WO_STARTED')
      : status === 'PAUSED' ? 'WO_PAUSED'
      : status === 'COMPLETE' ? 'WO_COMPLETED'
      : null;
    if (evType) {
      await this.prisma.productionEvent.create({
        data: {
          factoryId: jo.factoryId,
          workOrderId: jo.workOrderId,
          machineId: jo.machineId,
          eventType: evType as any,
          value: updated.actualQtyGood,
          metadata: { jobOrderId: jo.id, joStatus: status, operationName: jo.operationName },
        },
      }).catch(() => undefined);
    }

    // Roll up live OEE + propagate WO/PO status & broadcast
    await this.kpiService.propagateFromJobOrder(jobOrderId);

    // Step-driven completion: when the last step finishes, the KPI rollup flips the
    // WO to COMPLETED but does NOT post output to inventory (that lives in the
    // explicit complete-WO endpoint). Mirror it here so the produced quantity,
    // unit, and storage location reach finished-goods stock. Idempotent per WO.
    if (status === 'COMPLETE') {
      await this.finalizeWorkOrderProduction(factoryId, userId, jo.workOrderId);
    }

    return updated;
  }

  /**
   * Finalize a work order that completed through the job-order workflow (every step
   * COMPLETE → status auto-rolled to COMPLETED by the KPI propagation). Unlike the
   * explicit completeWorkOrder() endpoint, the step-driven path only rolls up
   * status/OEE — so without this, produced quantities never reach finished-goods
   * inventory. Persists the real header quantities (final-step good output; scrap
   * summed across steps), posts finished goods + genealogy, then refreshes the PO
   * rollup so completedQty reflects the output. Idempotent (safe on every COMPLETE).
   */
  private async finalizeWorkOrderProduction(
    factoryId: string | null,
    userId: string | null,
    workOrderId: string,
  ): Promise<void> {
    try {
      const wo = await this.prisma.workOrder.findFirst({
        where: { id: workOrderId, ...(factoryId ? { factoryId } : {}) },
        include: {
          jobOrders: {
            orderBy: { sequenceOrder: 'asc' },
            select: { actualQtyGood: true, actualQtyRejected: true },
          },
        },
      });
      // Only finalize once the WO has actually rolled to COMPLETED.
      if (!wo || wo.status !== 'COMPLETED' || wo.jobOrders.length === 0) return;

      // ISA-95 unit-safe output: the final step's good qty is the WO's product
      // output; scrap is the sum of rejects at every step (units lost anywhere).
      // Persisted in PIECES so the header quantities, the PO roll-up that sums them
      // and every report downstream all share one unit.
      const finPkg = (wo as any).sku ?? null;
      const lastJo = wo.jobOrders[wo.jobOrders.length - 1];
      const goodQty = Math.round(
        toPieces(lastJo?.actualQtyGood ?? wo.goodQty ?? 0, (lastJo as any)?.outputUnit, finPkg),
      );
      const scrapQty = Math.round(sumInPieces(
        wo.jobOrders, (j) => j.actualQtyRejected, (j) => (j as any).outputUnit, () => finPkg,
      ).pieces);
      const actualQty = goodQty + Math.round(
        toPieces(lastJo?.actualQtyRejected ?? 0, (lastJo as any)?.outputUnit, finPkg),
      );
      const actualEnd = wo.actualEnd ?? new Date();

      // Persist real header quantities so PO completedQty (Σ wo.goodQty) + reports
      // reflect the output instead of staying at the planning defaults.
      await this.prisma.workOrder.update({
        where: { id: wo.id },
        data: {
          goodQty,
          scrapQty,
          actualQty,
          ...(wo.actualEnd ? {} : { actualEnd }),
          ...(wo.completedById || !userId ? {} : { completedById: userId }),
        },
      });

      // Genealogy + finished-goods posting (creates FinishedGoodsLot at the SKU's
      // storage location, bumps SKU on-hand, writes the RECEIPT movement). Idempotent.
      await this.recordTraceability(wo, userId, actualQty, goodQty, scrapQty, actualEnd);

      // Refresh the PO rollup now that WO.goodQty is set so completedQty is correct.
      if (wo.productionOrderId) await this.kpiService.recomputeWorkOrderAndPO(workOrderId);
    } catch (err) {
      // Never let finished-goods finalization block the job-order transition.
      this.logger.error(`finalizeWorkOrderProduction(${workOrderId}) failed`, err as Error);
    }
  }

  /**
   * Set the ABSOLUTE output totals for a job order — the tablet's "Correct total".
   *
   * ── The bug this exists for ─────────────────────────────────────────────────
   * This wrote `actualQty*` and nothing else. The gateway re-derives rejected on
   * EVERY flush, absolutely:
   *
   *     actualQtyRejected = max(0, totalAcc - goodAcc) + jo.manualQtyRejected
   *
   * so a corrected figure was overwritten within seconds and the operator saw the
   * old number reappear. `addJobOrderCount` had always maintained
   * `manualQty*` for exactly this reason; this path never did, and the two
   * behaved differently for no reason anybody had decided.
   *
   * Measured on the plant on 25 Aug 2026: M3 and M4 both carried a
   * `manualQtyRejected` the operator had entered (2 and 4) with
   * `actualQtyRejected = 0` — the entry recorded and erased at the same time.
   *
   * So a correction now states the MANUAL SHARE it implies: the difference
   * between the total the operator wants and what the sensor has counted on its
   * own. The gateway's next stamp then reproduces the operator's number instead
   * of erasing it, because that stamp adds `manualQtyRejected` back.
   *
   * Does NOT change status — a pure quantity update, so partial progress and
   * end-of-run corrections use one path.
   */
  async reportJobOrderOutput(
    factoryId: string | null,
    jobOrderId: string,
    dto: {
      actualQtyGood: number;
      actualQtyRejected?: number;
      scrapReason?: string;
      scrapCategory?: string;
    },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const jo = await this.prisma.jobOrder.findFirst({ where: { id: jobOrderId, ...factoryFilter } });
    if (!jo) throw new NotFoundException('Job order not found');
    if (!['EXECUTING', 'PAUSED', 'COMPLETE'].includes(jo.status)) {
      throw new BadRequestException(
        `Can only report output for EXECUTING, PAUSED, or COMPLETE job orders (current: ${jo.status})`,
      );
    }

    const newGood = Math.max(0, dto.actualQtyGood);
    const newRejected = Math.max(0, dto.actualQtyRejected ?? jo.actualQtyRejected);
    const delta = Math.max(0, newRejected - jo.actualQtyRejected);
    const goodDelta = newGood - jo.actualQtyGood;

    // What the SENSOR has counted on its own, with the operator's previous
    // corrections taken back out. Everything else in the requested total is the
    // manual share, and it is that share the gateway adds back on each flush.
    //
    // Clamped at zero rather than allowed to go negative: a machine whose
    // manual figure exceeds its automatic one is a real state (an operator
    // counting by hand while the sensor is down), and a negative "automatic"
    // count would make the next stamp subtract from the total.
    const autoGood = Math.max(0, jo.actualQtyGood - jo.manualQtyGood);
    const autoRejected = Math.max(0, jo.actualQtyRejected - jo.manualQtyRejected);

    const updated = await this.prisma.jobOrder.update({
      where: { id: jobOrderId },
      data: {
        actualQtyGood: newGood,
        actualQtyRejected: newRejected,
        // THE FIX. Without these two lines the gateway's next flush restores the
        // old rejected figure and the operator's correction vanishes.
        manualQtyGood: Math.max(0, newGood - autoGood),
        manualQtyRejected: Math.max(0, newRejected - autoRejected),
        ...(dto.scrapReason !== undefined && { scrapReason: dto.scrapReason }),
      },
    });

    // Real time-series for the live dashboard: every count report becomes a
    // COUNT_UPDATE production event (cumulative totals in metadata).
    if (goodDelta !== 0 || delta > 0) {
      const shiftId = await this.resolveActiveShiftId(jo.factoryId, jo.machineId);
      await this.prisma.productionEvent.create({
        data: {
          factoryId: jo.factoryId,
          workOrderId: jo.workOrderId,
          machineId: jo.machineId,
          shiftId,
          eventType: 'COUNT_UPDATE',
          value: goodDelta,
          metadata: {
            jobOrderId: jo.id,
            good: newGood,
            rejected: newRejected,
            goodDelta,
            scrapDelta: delta,
          },
        },
      }).catch(() => undefined);
    }

    // Create audit trail entry whenever new scrap is added
    if (delta > 0) {
      const validCategories = ['QUALITY','SETUP','DAMAGE','OVERRUN','MATERIAL','MACHINE','OPERATOR','OTHER'];
      const category = (validCategories.includes(dto.scrapCategory ?? '') ? dto.scrapCategory : 'OTHER') as any;
      await this.prisma.scrapLog.create({
        data: {
          factoryId: jo.factoryId,
          workOrderId: jo.workOrderId,
          jobOrderId: jo.id,
          operatorId: jo.operatorId ?? null,
          qty: delta,
          reason: dto.scrapReason || 'Not specified',
          category,
        },
      });
    }

    // Roll up live OEE from the new counts + propagate
    await this.kpiService.propagateFromJobOrder(jobOrderId);

    return updated;
  }

  /** The shift instance covering this machine's line right now: IN_PROGRESS first, else today's. */
  private async resolveActiveShiftId(factoryId: string, machineId: string | null): Promise<string | null> {
    const lineId = machineId
      ? (await this.prisma.machine.findUnique({ where: { id: machineId }, select: { lineId: true } }).catch(() => null))?.lineId ?? null
      : null;
    const lineWhere = lineId ? { OR: [{ lineId }, { lineId: null }] } : {};
    const inProgress = await this.prisma.shiftInstance.findFirst({
      where: { factoryId, status: 'IN_PROGRESS', ...lineWhere },
      orderBy: { startTime: 'desc' }, select: { id: true },
    }).catch(() => null);
    if (inProgress) return inProgress.id;
    // Fallback: today's planned/active instance (operators may not have pressed Start).
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const today = await this.prisma.shiftInstance.findFirst({
      where: { factoryId, shiftDate: { gte: dayStart }, ...lineWhere },
      orderBy: { startTime: 'desc' }, select: { id: true },
    }).catch(() => null);
    return today?.id ?? null;
  }

  /**
   * Smart incremental count entry from the shop-floor card. Each call ADDS to the
   * running totals (never replaces): goodDelta increments good output, scrapDelta
   * increments rejected (bad) qty AND creates a ScrapLog entry (so quality drops
   * accordingly). handoverQty is the operator-controlled quantity passed to the
   * next step. Every entry is journalled as a COUNT_UPDATE production event.
   */
  async addJobOrderCount(
    factoryId: string | null,
    jobOrderId: string,
    dto: {
      goodDelta?: number;
      scrapDelta?: number;
      scrapReason?: string;
      scrapCategory?: string;
      handoverQty?: number;
    },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const jo = await this.prisma.jobOrder.findFirst({ where: { id: jobOrderId, ...factoryFilter } });
    if (!jo) throw new NotFoundException('Job order not found');
    if (!['EXECUTING', 'PAUSED', 'COMPLETE'].includes(jo.status)) {
      throw new BadRequestException(
        `Can only record counts for EXECUTING, PAUSED or COMPLETE job orders (current: ${jo.status})`,
      );
    }

    // Negative deltas are ALLOWED, and this is deliberate.
    //
    // Both clamped at zero, the tablet had no way to take a count away: an
    // operator who added 150 to the wrong field could only add more. The plant
    // hit exactly this on 25 Aug 2026 and ended up editing the database by hand
    // — four tables, and it still did not hold.
    //
    // The RESULTING totals are still floored at zero below, so a machine can
    // never carry a negative count however the deltas arrive.
    const goodDelta = Math.trunc(dto.goodDelta ?? 0);
    const scrapDelta = Math.trunc(dto.scrapDelta ?? 0);
    if (goodDelta === 0 && scrapDelta === 0 && dto.handoverQty === undefined) {
      throw new BadRequestException('Nothing to record — provide a good, scrap or handover quantity.');
    }

    const newGood = Math.max(0, jo.actualQtyGood + goodDelta);
    const newRejected = Math.max(0, jo.actualQtyRejected + scrapDelta);
    // Handover defaults to "all good so far" but is operator-overridable; never exceeds good output.
    let handoverQty = jo.handoverQty;
    if (dto.handoverQty !== undefined) {
      handoverQty = Math.max(0, Math.min(dto.handoverQty, newGood));
    }

    const updated = await this.prisma.jobOrder.update({
      where: { id: jobOrderId },
      data: {
        actualQtyGood: newGood,
        actualQtyRejected: newRejected,
        // Track the manual portion separately so the gateway counter never
        // overwrites it. Set rather than incremented: the totals above are
        // floored at zero, and an increment that ignored that floor would let
        // the manual share exceed the total it is a share OF.
        manualQtyGood: Math.max(0, jo.manualQtyGood + goodDelta),
        manualQtyRejected: Math.max(0, jo.manualQtyRejected + scrapDelta),
        ...(dto.handoverQty !== undefined && { handoverQty }),
        ...(dto.scrapReason !== undefined && scrapDelta > 0 && { scrapReason: dto.scrapReason }),
      },
    });

    // Each scrap increment is a real ScrapLog row (drives Quality & Scrap
    // analysis). A NEGATIVE delta takes scrap back and writes no row — the
    // journal below records the correction, and inventing a scrap log with a
    // negative quantity would corrupt every Pareto that reads this table.
    if (scrapDelta > 0) {
      const validCategories = ['QUALITY', 'SETUP', 'DAMAGE', 'OVERRUN', 'MATERIAL', 'MACHINE', 'OPERATOR', 'OTHER'];
      const category = (validCategories.includes(dto.scrapCategory ?? '') ? dto.scrapCategory : 'OTHER') as any;
      await this.prisma.scrapLog.create({
        data: {
          factoryId: jo.factoryId,
          workOrderId: jo.workOrderId,
          jobOrderId: jo.id,
          operatorId: jo.operatorId ?? null,
          qty: scrapDelta,
          reason: dto.scrapReason || 'Not specified',
          category,
        },
      });
    }

    // Journal the increment for the live time-series (production-over-time / rejects),
    // attributed to the active shift so per-shift production is queryable.
    if (goodDelta > 0 || scrapDelta > 0) {
      const shiftId = await this.resolveActiveShiftId(jo.factoryId, jo.machineId);
      await this.prisma.productionEvent.create({
        data: {
          factoryId: jo.factoryId,
          workOrderId: jo.workOrderId,
          machineId: jo.machineId,
          shiftId,
          eventType: 'COUNT_UPDATE',
          value: goodDelta,
          metadata: { jobOrderId: jo.id, good: newGood, rejected: newRejected, goodDelta, scrapDelta },
        },
      }).catch(() => undefined);
    }

    // Roll up live OEE (good/scrap changed → quality changes) + propagate + historian
    await this.kpiService.propagateFromJobOrder(jobOrderId);
    await this.historian.sampleActiveJobOrders().catch(() => undefined);

    return updated;
  }

  async listScrapLogs(
    factoryId: string | null,
    filters: { workOrderId?: string; jobOrderId?: string; category?: string; from?: string; to?: string; limit?: number },
  ) {
    const where: any = {
      ...(factoryId ? { factoryId } : {}),
      ...(filters.workOrderId ? { workOrderId: filters.workOrderId } : {}),
      ...(filters.jobOrderId  ? { jobOrderId: filters.jobOrderId }   : {}),
      ...(filters.category    ? { category: filters.category }        : {}),
      ...((filters.from || filters.to) ? {
        createdAt: {
          ...(filters.from ? { gte: new Date(filters.from) } : {}),
          ...(filters.to   ? { lte: new Date(filters.to)   } : {}),
        },
      } : {}),
    };

    return this.prisma.scrapLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(filters.limit ?? 200, 500),
      include: {
        jobOrder:  { select: { operationName: true, sequenceOrder: true, outputUnit: true } },
        workOrder: { select: { orderNumber: true, sku: { select: { name: true, code: true } } } },
        operator:  { select: { name: true } },
      },
    });
  }

  async assignJobOrderOperator(
    factoryId: string | null,
    jobOrderId: string,
    operatorId: string | null,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const jo = await this.prisma.jobOrder.findFirst({ where: { id: jobOrderId, ...factoryFilter } });
    if (!jo) throw new NotFoundException('Job order not found');

    if (operatorId) {
      const user = await this.prisma.user.findUnique({ where: { id: operatorId } });
      if (!user) throw new NotFoundException('Operator not found');
    }

    return this.prisma.jobOrder.update({
      where: { id: jobOrderId },
      data: { operatorId },
      include: { operator: { select: { id: true, name: true, nameAr: true } } },
    });
  }

  /**
   * Keep MachineCurrentStatus + the MachineStateRecord timeline aligned with the
   * job order actually running on the machine. Called on every JO transition so the
   * shop-floor card, the live dashboard and the machine-status strip never disagree:
   *   EXECUTING → RUNNING (open a RUNNING record from the JO start)
   *   PAUSED    → IDLE    (close the open record)
   *   COMPLETE / CANCELLED → IDLE unless another JO is still EXECUTING here
   * Down states (BREAKDOWN/SETUP/…) are owned by DowntimeService.setMachineState and
   * left untouched here.
   */
  private async syncMachineStateWithJobOrder(
    factoryId: string,
    machineId: string,
    joStatus: string,
    workOrderId: string,
    joStart?: Date | null,
  ) {
    try {
      const DOWN = new Set(['BREAKDOWN', 'PLANNED_STOP', 'SETUP', 'CHANGEOVER', 'STARVED', 'BLOCKED', 'MAINTENANCE']);
      const current = await this.prisma.machineCurrentStatus.findUnique({ where: { machineId } });
      // Don't override an operator-declared downtime — that's resolved via setMachineState.
      if (current && DOWN.has(current.state as string)) return;

      let target: string | null = null;
      if (joStatus === 'EXECUTING') target = 'RUNNING';
      else if (joStatus === 'PAUSED') target = 'IDLE';
      else if (joStatus === 'COMPLETE' || joStatus === 'CANCELLED') {
        const stillRunning = await this.prisma.jobOrder.count({
          where: { machineId, status: 'EXECUTING', id: { not: undefined } },
        });
        target = stillRunning > 0 ? 'RUNNING' : 'IDLE';
      }
      if (!target) return;
      if (current?.state === target) {
        // Still ensure a RUNNING record is open while executing
        if (target !== 'RUNNING') return;
      }

      const now = new Date();
      // Close any open state record
      const open = await this.prisma.machineStateRecord.findFirst({
        where: { machineId, endTime: null },
        orderBy: { startTime: 'desc' },
      });
      if (open && open.state !== target) {
        await this.prisma.machineStateRecord.update({
          where: { id: open.id },
          data: { endTime: now, durationMinutes: (now.getTime() - open.startTime.getTime()) / 60_000 },
        });
      }
      // Open a new record for the target state (RUNNING anchored to the JO start)
      if (!open || open.state !== target) {
        await this.prisma.machineStateRecord.create({
          data: {
            factoryId,
            machineId,
            state: target as any,
            startTime: target === 'RUNNING' && joStart ? joStart : now,
            workOrderId,
            isPlannedStop: false,
            source: 'SYSTEM',
          },
        });
      }
      await this.prisma.machineCurrentStatus.upsert({
        where: { machineId },
        create: { machineId, state: target as any, currentWOId: target === 'RUNNING' ? workOrderId : null, lastEventAt: now },
        update: { state: target as any, currentWOId: target === 'RUNNING' ? workOrderId : null, lastEventAt: now },
      });
    } catch (err) {
      this.logger.error('syncMachineStateWithJobOrder failed', err as any);
    }
  }

  // ────────────────────────────────────────────────────────────
  // OEE PER JOB ORDER
  // ────────────────────────────────────────────────────────────

  /**
   * A/P/Q/OEE for a set of job orders, from the fact store.
   *
   * ── What this replaces ──────────────────────────────────────────────────
   * `calcJobOrderOEE` computed these from the job-order row alone: availability
   * as elapsed-since-start over planned duration, with NO downtime subtracted.
   * That is the fail-open assumption removed from the fact store weeks ago, still
   * running here in its own corner — so the shop-floor live page and the per-step
   * badges reported an availability that could not fall below 100% for a machine
   * that merely kept reporting, and disagreed with every other screen.
   *
   * It also derived quality from the step's own counters, so a routed order was
   * graded five times over instead of on the units that actually left the line.
   *
   * The fact store keys on jobOrderId, so the real minutes were always one query
   * away. Batched deliberately: a list of forty steps is one round trip.
   */
  private async jobOrderFactors(
    jobOrderIds: string[],
  ): Promise<Map<string, { joAvailability: number | null; joPerformance: number | null; joQuality: number | null; joOEE: number | null }>> {
    const out = new Map<string, { joAvailability: number | null; joPerformance: number | null; joQuality: number | null; joOEE: number | null }>();
    if (jobOrderIds.length === 0) return out;
    const facts = await this.kpiService.jobOrderFactTotals(jobOrderIds);
    for (const id of jobOrderIds) {
      const f = this.kpiService.factorsFromFacts(facts.get(id));
      out.set(id, {
        joAvailability: f.availability,
        joPerformance: f.performance,
        joQuality: f.quality,
        joOEE: f.oee,
      });
    }
    return out;
  }

  /** The empty shape, for a step the fact store has never seen. */
  private noFactors() {
    return { joAvailability: null, joPerformance: null, joQuality: null, joOEE: null };
  }

  async deleteJobOrders(factoryId: string | null, workOrderId: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    const active = await this.prisma.jobOrder.count({
      where: { workOrderId, status: { in: ['EXECUTING', 'PAUSED'] } },
    });
    if (active > 0) {
      throw new ConflictException('Cannot delete job orders while any are EXECUTING or PAUSED.');
    }

    const { count } = await this.prisma.jobOrder.deleteMany({ where: { workOrderId } });
    return { deleted: count };
  }

  // ────────────────────────────────────────────────────────────
  // JOB ORDER LIVE DASHBOARD
  // One comprehensive, real-data payload for the shop-floor live page:
  // OEE (ISO 22400) + benchmark class, six big losses, time model
  // waterfall, downtime Pareto + MTTR/MTBF/MTTA, production trend,
  // scrap analysis, machine state timeline, alarms, maintenance.
  // ────────────────────────────────────────────────────────────

  async getJobOrderLiveDashboard(factoryId: string | null, jobOrderId: string) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const jo = await this.prisma.jobOrder.findFirst({
      where: { id: jobOrderId, ...factoryFilter },
      include: {
        machine: {
          include: {
            currentStatus: true,
            line: { select: { id: true, name: true, code: true } },
            area: { select: { id: true, name: true, code: true } },
          },
        },
        workCenter: { select: { id: true, name: true, code: true } },
        routingStep: { select: { stepNumber: true, operationName: true, cycleTimeSec: true, setupTimeMins: true } },
        operator: { select: { id: true, name: true, nameAr: true } },
        materials: true,
        predecessor: { select: { id: true, operationName: true, status: true, routingStepId: true, actualStart: true } },
        successors: { select: { id: true, operationName: true, status: true, sequenceOrder: true } },
        workOrder: {
          select: {
            id: true, orderNumber: true, status: true, plannedQty: true,
            plannedStart: true, plannedEnd: true, actualStart: true, actualEnd: true,
            sku: { select: { id: true, name: true, code: true } },
            productionOrder: { select: { id: true, orderNumber: true, targetQty: true, unit: true, plannedEnd: true, customer: true } },
          },
        },
      },
    });
    if (!jo) throw new NotFoundException('Job order not found');

    const [withDep] = await this.attachDepTypes([jo]);
    // From the fact store, like every other surface. This page used to grade the
    // step from its own row and reported an availability that could not fall below
    // 100% for a machine that simply kept reporting.
    const oee = (await this.jobOrderFactors([jo.id])).get(jo.id) ?? this.noFactors();

    // ── Analysis window: actual start (or planned) → actual end (or now) ──
    const now = new Date();
    const windowStart = jo.actualStart ?? jo.plannedStart ?? jo.createdAt;
    const windowEnd = jo.actualEnd ?? now;
    const windowMins = Math.max(0, (windowEnd.getTime() - windowStart.getTime()) / 60_000);

    const machineId = jo.machineId;
    const machineHistoryFrom = new Date(now.getTime() - 30 * 86_400_000); // 30-day reliability window

    const [
      downtimeEvents,
      scrapLogs,
      countEvents,
      stateRecords,
      alarms,
      maintenanceWOs,
      reliabilityEvents,
      oeeTrendRecords,
    ] = await Promise.all([
      // Downtime overlapping the JO window — scoped to THIS machine (a WO spans
      // multiple machines, one per step, so machine-scoping keeps the per-JO view
      // about this operation only). Falls back to the WO when no machine is set.
      this.prisma.downtimeEvent.findMany({
        where: {
          ...(factoryId ? { factoryId } : {}),
          ...(machineId ? { machineId } : { workOrderId: jo.workOrderId }),
          startTime: { lte: windowEnd },
          OR: [{ endTime: null }, { endTime: { gte: windowStart } }],
        },
        include: {
          cause: { select: { code: true, name: true, nameAr: true, category: true } },
          operator: { select: { name: true } },
        },
        orderBy: { startTime: 'desc' },
      }),
      this.prisma.scrapLog.findMany({
        where: { jobOrderId: jo.id },
        orderBy: { createdAt: 'desc' },
        include: { operator: { select: { name: true } } },
      }),
      // COUNT_UPDATE + transition events for this JO (real recorded series)
      this.prisma.productionEvent.findMany({
        where: {
          workOrderId: jo.workOrderId,
          timestamp: { gte: windowStart },
          metadata: { path: ['jobOrderId'], equals: jo.id },
        },
        orderBy: { timestamp: 'asc' },
        take: 1000,
      }),
      // Machine state timeline strip
      machineId
        ? this.prisma.machineStateRecord.findMany({
            where: {
              machineId,
              startTime: { lte: windowEnd },
              OR: [{ endTime: null }, { endTime: { gte: windowStart } }],
            },
            include: { downtimeCause: { select: { name: true, code: true } } },
            orderBy: { startTime: 'asc' },
            take: 500,
          })
        : Promise.resolve([] as any[]),
      // Alarms: machine alarms in window + alarms explicitly tagged with this JO
      this.prisma.alarmEvent.findMany({
        where: {
          ...(factoryId ? { factoryId } : {}),
          OR: [
            ...(machineId ? [{ machineId, triggeredAt: { gte: windowStart } }] : []),
            { metadata: { path: ['jobOrderId'], equals: jo.id } },
          ],
        },
        orderBy: { triggeredAt: 'desc' },
        take: 100,
        include: { machine: { select: { name: true, code: true } } },
      }),
      // Maintenance on this machine: open + recent
      machineId
        ? this.prisma.maintenanceWO.findMany({
            where: {
              machineId,
              deletedAt: null,
              OR: [
                { status: { in: ['OPEN', 'AWAITING_PARTS', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'] } },
                { createdAt: { gte: machineHistoryFrom } },
              ],
            },
            orderBy: { createdAt: 'desc' },
            take: 50,
            include: {
              assignedTo: { select: { name: true } },
              requestedBy: { select: { name: true } },
            },
          })
        : Promise.resolve([] as any[]),
      // 30-day unplanned downtime history → MTTR / MTBF
      machineId
        ? this.prisma.downtimeEvent.findMany({
            where: {
              machineId,
              isPlanned: false,
              startTime: { gte: machineHistoryFrom },
            },
            orderBy: { startTime: 'asc' },
            select: {
              startTime: true, endTime: true, durationMinutes: true,
              acknowledgedAt: true, reasonCode: true,
            },
          })
        : Promise.resolve([] as Array<{ startTime: Date; endTime: Date | null; durationMinutes: number | null; acknowledgedAt: Date | null; reasonCode: string }>),
      // OEE history for trend lines (last 14 days, this machine + this SKU when known)
      machineId
        ? this.prisma.oEERecord.findMany({
            where: {
              machineId,
              recordDate: { gte: new Date(now.getTime() - 14 * 86_400_000) },
            },
            orderBy: { recordDate: 'asc' },
            take: 400,
            select: {
              recordDate: true, shiftCode: true,
              availability: true, performance: true, quality: true, oee: true,
            },
          })
        : Promise.resolve([] as Array<{ recordDate: Date; shiftCode: string | null; availability: number; performance: number; quality: number; oee: number }>),
    ]);

    // ── Downtime aggregation within the JO window ──────────────
    const clampMins = (s: Date, e: Date | null) => {
      const from = Math.max(s.getTime(), windowStart.getTime());
      const to = Math.min((e ?? now).getTime(), windowEnd.getTime());
      return Math.max(0, (to - from) / 60_000);
    };

    let plannedStopMins = 0;
    let unplannedStopMins = 0;
    let microStopMins = 0;
    let changeoverMins = 0;
    const paretoMap = new Map<string, { label: string; mins: number; count: number; category: string }>();

    for (const ev of downtimeEvents) {
      const mins = clampMins(ev.startTime, ev.endTime);
      if (mins <= 0) continue;
      if (ev.isPlanned) plannedStopMins += mins;
      else unplannedStopMins += mins;
      if (ev.reasonCode === 'MICRO_STOP') microStopMins += mins;
      if (ev.reasonCode === 'CHANGEOVER') changeoverMins += mins;

      const key = ev.cause?.name ?? ev.reason ?? ev.reasonCode ?? 'Unspecified';
      const cur = paretoMap.get(key) ?? { label: key, mins: 0, count: 0, category: ev.category as string };
      cur.mins += mins;
      cur.count += 1;
      paretoMap.set(key, cur);
    }
    const pareto = [...paretoMap.values()].sort((a, b) => b.mins - a.mins);
    const totalDowntimeMins = plannedStopMins + unplannedStopMins;
    const openDowntime = downtimeEvents.find((e) => !e.endTime) ?? null;

    // ── ISO 22400 time model (minutes, within the JO window) ───
    const totalProduced = (jo.actualQtyGood ?? 0) + (jo.actualQtyRejected ?? 0);
    const ict = jo.idealCycleTimeSec ?? null;
    const operationalMins = Math.max(0, windowMins - plannedStopMins);
    const netProductionMins = Math.max(0, operationalMins - unplannedStopMins);
    const idealProductionMins = ict ? (ict * totalProduced) / 60 : null;
    // Performance loss = running slower than ideal (excl. recorded micro stops)
    const performanceLossMins = idealProductionMins != null
      ? Math.max(0, netProductionMins - idealProductionMins)
      : null;
    const netOperatingMins = idealProductionMins != null
      ? Math.min(netProductionMins, idealProductionMins)
      : netProductionMins;
    const qualityLossMins = ict ? (ict * (jo.actualQtyRejected ?? 0)) / 60 : null;
    const usedOperationalMins = qualityLossMins != null
      ? Math.max(0, netOperatingMins - qualityLossMins)
      : null;

    // ── Six Big Losses (ISO/TPM) — all from recorded data ──────
    const setupScrap = scrapLogs.filter((s) => s.category === 'SETUP').reduce((t, s) => t + s.qty, 0);
    const processScrap = (jo.actualQtyRejected ?? 0) - setupScrap;
    const sixLosses = {
      availability: {
        equipmentFailure: {
          mins: Math.round(Math.max(0, unplannedStopMins - microStopMins) * 10) / 10,
          count: downtimeEvents.filter((e) => !e.isPlanned && e.reasonCode !== 'MICRO_STOP').length,
        },
        setupAdjustments: {
          mins: Math.round((changeoverMins + plannedStopMins) * 10) / 10,
          count: downtimeEvents.filter((e) => e.isPlanned || e.reasonCode === 'CHANGEOVER').length,
        },
      },
      performance: {
        idlingMinorStops: {
          mins: Math.round(microStopMins * 10) / 10,
          count: downtimeEvents.filter((e) => e.reasonCode === 'MICRO_STOP').length,
        },
        reducedSpeed: {
          mins: performanceLossMins != null ? Math.round(performanceLossMins * 10) / 10 : null,
        },
      },
      quality: {
        processDefects: {
          qty: Math.max(0, processScrap),
          mins: ict ? Math.round(((ict * Math.max(0, processScrap)) / 60) * 10) / 10 : null,
        },
        startupRejects: {
          qty: setupScrap,
          mins: ict ? Math.round(((ict * setupScrap) / 60) * 10) / 10 : null,
        },
      },
    };

    // ── Reliability (30-day machine history): MTTR / MTBF / MTTA ──
    const closed = reliabilityEvents.filter((e) => e.endTime && (e.durationMinutes ?? 0) > 0);
    const mttrMins = closed.length
      ? closed.reduce((t, e) => t + (e.durationMinutes ?? 0), 0) / closed.length
      : null;
    let mtbfMins: number | null = null;
    if (reliabilityEvents.length >= 2) {
      let gaps = 0;
      let gapTotal = 0;
      for (let i = 1; i < reliabilityEvents.length; i++) {
        const prevEnd = reliabilityEvents[i - 1].endTime;
        if (!prevEnd) continue;
        const gap = (reliabilityEvents[i].startTime.getTime() - prevEnd.getTime()) / 60_000;
        if (gap > 0) { gaps++; gapTotal += gap; }
      }
      mtbfMins = gaps ? gapTotal / gaps : null;
    }
    const acked = reliabilityEvents.filter((e) => e.acknowledgedAt);
    // MTTA / MTTD — mean time from failure to acknowledgement (detect + respond)
    const mttaMins = acked.length
      ? acked.reduce((t, e) => t + (e.acknowledgedAt!.getTime() - e.startTime.getTime()) / 60_000, 0) / acked.length
      : null;
    // Repair time — mean time from acknowledgement to resume (the wrench-on time)
    const repairCandidates = closed.filter((e) => e.acknowledgedAt && e.endTime);
    const repairTimeMins = repairCandidates.length
      ? repairCandidates.reduce((t, e) => t + (e.endTime!.getTime() - e.acknowledgedAt!.getTime()) / 60_000, 0) / repairCandidates.length
      : null;

    // ── Downtime statistics within the window (occurrence/total/median/average) ──
    const windowDurations = downtimeEvents
      .map((e) => clampMins(e.startTime, e.endTime))
      .filter((m) => m > 0)
      .sort((a, b) => a - b);
    const dtMedianMins = windowDurations.length
      ? windowDurations[Math.floor(windowDurations.length / 2)]
      : null;
    const dtAvgMins = windowDurations.length
      ? windowDurations.reduce((t, m) => t + m, 0) / windowDurations.length
      : null;

    // ── Microstop Pareto (Performance loss category, separate from breakdowns) ──
    const microMap = new Map<string, { label: string; mins: number; count: number; category: string }>();
    for (const ev of downtimeEvents) {
      if (ev.reasonCode !== 'MICRO_STOP') continue;
      const mins = clampMins(ev.startTime, ev.endTime);
      if (mins <= 0) continue;
      const key = ev.cause?.name ?? ev.reason ?? 'Micro-stop';
      const cur = microMap.get(key) ?? { label: key, mins: 0, count: 0, category: ev.category as string };
      cur.mins += mins; cur.count += 1;
      microMap.set(key, cur);
    }
    const microstopPareto = [...microMap.values()].sort((a, b) => b.mins - a.mins);

    // ── Machine state distribution (time-model: Run / Idle / Down split) ──
    const stateMap = new Map<string, { state: string; mins: number; count: number }>();
    for (const r of stateRecords) {
      const mins = clampMins(r.startTime, r.endTime);
      if (mins <= 0) continue;
      const cur = stateMap.get(r.state) ?? { state: r.state, mins: 0, count: 0 };
      cur.mins += mins; cur.count += 1;
      stateMap.set(r.state, cur);
    }
    const stateDurations = [...stateMap.values()].map((s) => s.mins).sort((a, b) => a - b);
    const stateOccurrences = [...stateMap.values()].reduce((t, s) => t + s.count, 0);
    const stateTotalMins = [...stateMap.values()].reduce((t, s) => t + s.mins, 0);
    const stateDistribution = {
      occurrences: stateOccurrences,
      totalMins: Math.round(stateTotalMins * 10) / 10,
      medianMins: stateDurations.length ? Math.round(stateDurations[Math.floor(stateDurations.length / 2)] * 10) / 10 : null,
      avgMins: stateDurations.length ? Math.round((stateTotalMins / [...stateMap.values()].length) * 10) / 10 : null,
      byState: [...stateMap.values()]
        .sort((a, b) => b.mins - a.mins)
        .map((s) => ({ ...s, mins: Math.round(s.mins * 10) / 10 })),
    };

    // ── Top reject reasons + when rejects peaked ──────────────
    const rejectMap = new Map<string, { reason: string; qty: number; count: number; category: string }>();
    for (const s of scrapLogs) {
      const key = s.reason || 'Not specified';
      const cur = rejectMap.get(key) ?? { reason: key, qty: 0, count: 0, category: s.category as string };
      cur.qty += s.qty; cur.count += 1;
      rejectMap.set(key, cur);
    }
    const topRejectReasons = [...rejectMap.values()].sort((a, b) => b.qty - a.qty).slice(0, 8);
    const highestRejectLog = scrapLogs.reduce<any>((max, s) => (!max || s.qty > max.qty ? s : max), null);

    // ── Production trend from recorded COUNT_UPDATE events ─────
    const trend = countEvents.map((ev) => {
      const meta = (ev.metadata ?? {}) as any;
      return {
        t: ev.timestamp,
        type: ev.eventType,
        delta: ev.value ?? 0,
        good: meta.good ?? null,
        rejected: meta.rejected ?? null,
        scrapDelta: meta.scrapDelta ?? 0,
      };
    });

    // ── Pace / ETA ─────────────────────────────────────────────
    const elapsedHrs = jo.actualStart ? Math.max(0.001, (windowEnd.getTime() - jo.actualStart.getTime()) / 3_600_000) : null;
    const paceGoodPerHr = elapsedHrs && jo.actualQtyGood > 0 ? jo.actualQtyGood / elapsedHrs : null;
    const remainingQty = Math.max(0, (jo.plannedQtyOut ?? 0) - jo.actualQtyGood);
    const etaMins = paceGoodPerHr && remainingQty > 0 ? (remainingQty / paceGoodPerHr) * 60 : null;
    const idealRatePerHr = ict ? 3600 / ict : null;

    // ── OEE benchmark classification (world-class ≥85 / good / fair / poor) ──
    const benchmark = (v: number | null) =>
      v == null ? null : v >= 85 ? 'WORLD_CLASS' : v >= 70 ? 'GOOD' : v >= 60 ? 'FAIR' : 'POOR';

    const r1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);

    // ── TEEP = OEE × Utilization (utilization = scheduled/operational vs all time) ──
    const utilizationPct = windowMins > 0 ? Math.min(100, (operationalMins / windowMins) * 100) : null;
    const teepPct = oee.joOEE != null && utilizationPct != null
      ? (oee.joOEE * utilizationPct) / 100
      : null;

    // ── Time-Based Availability = Uptime ÷ (Uptime + Downtime) ──
    // A SECOND availability method shown alongside the classic schedule-based one.
    // Uptime = running time (net production); Downtime = unplanned stops.
    const uptimeMins = netProductionMins;
    const availabilityTimeBased = (uptimeMins + unplannedStopMins) > 0
      ? (uptimeMins / (uptimeMins + unplannedStopMins)) * 100
      : null;
    // Time-based OEE reuses the same Performance & Quality, only Availability differs.
    const oeeTimeBased = availabilityTimeBased != null && oee.joPerformance != null && oee.joQuality != null
      ? oeeIdentityOf(availabilityTimeBased, oee.joPerformance, oee.joQuality)
      : null;
    const teepTimeBasedPct = oeeTimeBased != null && utilizationPct != null
      ? (oeeTimeBased * utilizationPct) / 100
      : null;

    // ── OEE trend — from the persisted fact store (production_snapshots), the
    // canonical classified source, so the machine's 14-day trend matches every
    // other dashboard exactly. (Was InfluxDB / OEERecord; now single-sourced.)
    let oeeTrend: any[] = [];
    if (machineId) {
      oeeTrend = await this.kpiService.snapshotMachineTrend(
        null, // machineId is globally unique → no factory filter needed
        machineId,
        new Date(now.getTime() - 14 * 86_400_000),
        now,
      );
    }
    if (!oeeTrend.length) {
      // Fallback: relational OEERecord history (classic availability only) — only
      // used before the fact store has been backfilled for this machine.
      oeeTrend = oeeTrendRecords.map((o) => ({
        date: o.recordDate,
        availability: r1(o.availability),
        availabilityTb: null,
        performance: r1(o.performance),
        quality: r1(o.quality),
        oee: r1(o.oee),
        oeeTb: null,
      }));
    }

    return {
      generatedAt: now,
      jobOrder: { ...withDep, ...oee },
      window: { start: windowStart, end: jo.actualEnd ?? null, isLive: !jo.actualEnd, minutes: r1(windowMins) },
      oee: {
        ...oee,
        oeeClass: benchmark(oee.joOEE),
        availabilityClass: benchmark(oee.joAvailability),
        performanceClass: benchmark(oee.joPerformance),
        qualityClass: benchmark(oee.joQuality),
        utilizationPct: r1(utilizationPct),
        teepPct: r1(teepPct),
        teepClass: benchmark(teepPct),
        // Second availability method (time-based) + its OEE, shown side by side
        availabilityTimeBased: r1(availabilityTimeBased),
        availabilityTimeBasedClass: benchmark(availabilityTimeBased),
        oeeTimeBased: r1(oeeTimeBased),
        oeeTimeBasedClass: benchmark(oeeTimeBased),
        teepTimeBasedPct: r1(teepTimeBasedPct),
        uptimeMins: r1(uptimeMins),
        downtimeMins: r1(unplannedStopMins),
        trend: oeeTrend,
      },
      production: {
        plannedQty: jo.plannedQtyOut,
        good: jo.actualQtyGood,
        rejected: jo.actualQtyRejected,
        total: totalProduced,
        unit: jo.outputUnit,
        progressPct: (jo.plannedQtyOut ?? 0) > 0 ? r1(Math.min(100, (jo.actualQtyGood / jo.plannedQtyOut!) * 100)) : null,
        rejectRatePct: totalProduced > 0 ? r1((jo.actualQtyRejected / totalProduced) * 100) : null,
        paceGoodPerHr: r1(paceGoodPerHr),
        idealRatePerHr: r1(idealRatePerHr),
        etaMins: r1(etaMins),
        idealCycleTimeSec: ict,
        trend,
      },
      timeModel: {
        totalMins: r1(windowMins),
        plannedStopMins: r1(plannedStopMins),
        operationalMins: r1(operationalMins),
        availabilityLossMins: r1(unplannedStopMins),
        netProductionMins: r1(netProductionMins),
        performanceLossMins: r1(performanceLossMins),
        microStopMins: r1(microStopMins),
        netOperatingMins: r1(netOperatingMins),
        qualityLossMins: r1(qualityLossMins),
        usedOperationalMins: r1(usedOperationalMins),
        utilizationPct: r1(utilizationPct),
        teepPct: r1(teepPct),
      },
      sixLosses,
      stateDistribution,
      downtime: {
        totalMins: r1(totalDowntimeMins),
        plannedMins: r1(plannedStopMins),
        unplannedMins: r1(unplannedStopMins),
        occurrences: downtimeEvents.length,
        medianMins: r1(dtMedianMins),
        avgMins: r1(dtAvgMins),
        open: openDowntime,
        events: downtimeEvents,
        pareto: pareto.map((p) => ({ ...p, mins: r1(p.mins) })),
        microstopPareto: microstopPareto.map((p) => ({ ...p, mins: r1(p.mins) })),
        mttrMins: r1(mttrMins),
        mtbfMins: r1(mtbfMins),
        mttaMins: r1(mttaMins),
        repairTimeMins: r1(repairTimeMins),
        reliabilityWindowDays: 30,
      },
      scrap: {
        total: jo.actualQtyRejected,
        logs: scrapLogs,
        highestRejectAt: highestRejectLog?.createdAt ?? null,
        highestRejectQty: highestRejectLog?.qty ?? null,
        topReasons: topRejectReasons,
        byCategory: Object.entries(
          scrapLogs.reduce((acc: Record<string, number>, s) => {
            acc[s.category] = (acc[s.category] ?? 0) + s.qty;
            return acc;
          }, {}),
        ).map(([category, qty]) => ({ category, qty })).sort((a, b) => (b.qty as number) - (a.qty as number)),
      },
      machine: jo.machine
        ? {
            id: jo.machine.id,
            name: jo.machine.name,
            code: jo.machine.code,
            line: jo.machine.line,
            area: jo.machine.area,
            designCapacity: jo.machine.designCapacity,
            criticality: jo.machine.criticality,
            currentStatus: jo.machine.currentStatus,
            stateTimeline: stateRecords,
          }
        : null,
      alarms: {
        events: alarms,
        active: alarms.filter((a) => !a.resolvedAt).length,
        unacknowledged: alarms.filter((a) => !a.acknowledgedAt && !a.resolvedAt).length,
        bySeverity: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].map((sev) => ({
          severity: sev,
          count: alarms.filter((a) => a.severity === sev).length,
        })).filter((s) => s.count > 0),
      },
      maintenance: {
        workOrders: maintenanceWOs,
        open: maintenanceWOs.filter((m) =>
          ['OPEN', 'AWAITING_PARTS', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD'].includes(m.status as string),
        ).length,
      },
    };
  }
}

/**
 * Distinct, order-preserving list of the machines a work order touches, derived
 * from its job-order steps. Replaces the removed single header machine.
 */
function dedupeMachines(
  machines: Array<{ id: string; name: string; code: string } | null | undefined>,
): Array<{ id: string; name: string; code: string }> {
  const seen = new Set<string>();
  const out: Array<{ id: string; name: string; code: string }> = [];
  for (const m of machines) {
    if (!m || seen.has(m.id)) continue;
    seen.add(m.id);
    out.push({ id: m.id, name: m.name, code: m.code });
  }
  return out;
}

/**
 * Attach `plannedQtyBase` — a work order's commitment converted to PIECES.
 *
 * `WorkOrder.plannedQty` is counted in `WorkOrder.qtyUnit`, which on a packaging
 * line is PALLET, while every produced quantity the API reports is in pieces.
 * Handing a caller both without a conversion is how a work-order bar came to divide
 * pieces by pallets and show 11.3% for an order the production order beside it —
 * correctly — showed at 0.1%. 160 pieces to a pallet, 160× the truth.
 *
 * The ordered figure is kept alongside, in its own unit, because "150 PALLET" is
 * what the planner typed and what the operator recognises on the floor.
 */
function withPlannedBase<
  T extends { plannedQty?: number | null; qtyUnit?: string | null },
>(workOrders: T[] | null | undefined, pkg: SkuPackaging | null | undefined) {
  return (workOrders ?? []).map((wo) => ({
    ...wo,
    plannedQtyBase: toPieces(wo.plannedQty ?? 0, wo.qtyUnit, pkg),
    plannedQtyOrdered: wo.plannedQty ?? 0,
    plannedQtyOrderedUnit: wo.qtyUnit ?? null,
  }));
}
