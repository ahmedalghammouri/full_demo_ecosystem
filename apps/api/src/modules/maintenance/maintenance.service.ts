import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { MaintStatus, MaintType, Priority, SpareIssueStatus, DowntimeCategory, type Prisma } from '@prisma/client';
import type {
  CreateMaintenanceWODto, UpdateMaintenanceWODto, AssignWODto,
  StartWODto, CompleteWODto, CancelWODto,
  SparePartRequestItemDto, IssueSparePartDto,
  CreateFailureModeDto, UpdateFailureModeDto,
} from './dto/maintenance.dto';
import { TraceabilityService } from '../traceability/traceability.service';
import { ReliabilityService } from '../reliability/reliability.service';
import { archivedWhere } from '../../common/archive.util';

const VALID_MAINT_TRANSITIONS: Record<MaintStatus, MaintStatus[]> = {
  OPEN: ['ASSIGNED', 'AWAITING_PARTS', 'IN_PROGRESS', 'CANCELLED'],
  AWAITING_PARTS: ['ASSIGNED', 'IN_PROGRESS', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'AWAITING_PARTS', 'ON_HOLD', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'AWAITING_PARTS', 'COMPLETED', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly traceability: TraceabilityService,
    private readonly reliability: ReliabilityService,
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

  // Operating (RUNNING) machine-hours — the true MTBF denominator — now lives on
  // ReliabilityService.sumRunningHours so every KPI surface shares one definition.

  async getKPIs(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    // Scope → machine-id filter applied to every machine-bound metric (WOs + machine count).
    const machineIds = await this.scopeMachineIds(factoryId, scope);
    const woScope = machineIds ? { machineId: { in: machineIds } } : {};

    const [
      openWOs,
      overdueWOs,
      completedWOs,
      totalWOs,
      reliability,
      pmTotal,
      pmCompleted,
    ] = await Promise.all([
      this.prisma.maintenanceWO.count({
        where: {
          ...factoryFilter, ...woScope,
          status: { in: [MaintStatus.OPEN, MaintStatus.ASSIGNED, MaintStatus.IN_PROGRESS] },
          deletedAt: null,
        },
      }),
      this.prisma.maintenanceWO.count({
        where: {
          ...factoryFilter, ...woScope,
          status: { notIn: [MaintStatus.COMPLETED, MaintStatus.CANCELLED] },
          dueDate: { lt: now },
          deletedAt: null,
        },
      }),
      this.prisma.maintenanceWO.count({
        where: { ...factoryFilter, ...woScope, status: MaintStatus.COMPLETED, deletedAt: null },
      }),
      this.prisma.maintenanceWO.count({ where: { ...factoryFilter, ...woScope, deletedAt: null } }),
      // MTTR/MTBF from the canonical engine (maintenance lens) — month-to-date window.
      // Same definitions the Analytics → Maintenance Reports page uses, so the two agree
      // whenever the report window is month-to-date.
      this.reliability.maintenanceReliability(factoryId, scope, monthStart, now, machineIds),
      // PM compliance: preventive WOs due this month vs completed
      this.prisma.maintenanceWO.count({
        where: {
          ...factoryFilter, ...woScope,
          type: { in: [MaintType.PREVENTIVE, MaintType.INSPECTION, MaintType.LUBRICATION] },
          dueDate: { gte: monthStart, lte: now },
          deletedAt: null,
        },
      }),
      this.prisma.maintenanceWO.count({
        where: {
          ...factoryFilter, ...woScope,
          type: { in: [MaintType.PREVENTIVE, MaintType.INSPECTION, MaintType.LUBRICATION] },
          dueDate: { gte: monthStart, lte: now },
          status: MaintStatus.COMPLETED,
          deletedAt: null,
        },
      }),
    ]);

    const mttr = reliability.mttrHours;
    const mtbf = reliability.mtbfHours;

    // Availability = MTBF / (MTBF + MTTR) — standard reliability formula
    const availabilityRate = mtbf + mttr > 0 ? (mtbf / (mtbf + mttr)) * 100 : 100;

    const completionRate = totalWOs > 0 ? (completedWOs / totalWOs) * 100 : 0;
    const pmCompliance = pmTotal > 0 ? (pmCompleted / pmTotal) * 100 : 100;

    return {
      openWOs,
      overdueWOs,
      completionRate: parseFloat(completionRate.toFixed(1)),
      mttr: parseFloat(mttr.toFixed(1)),
      mtbf: parseFloat(mtbf.toFixed(0)),
      availabilityRate: parseFloat(availabilityRate.toFixed(1)),
      pmCompliance: parseFloat(pmCompliance.toFixed(1)),
      // What went into MTTR/MTBF — window, sample sizes and the operating-hours source.
      reliabilityBasis: {
        lens: 'maintenance' as const,
        windowFrom: monthStart.toISOString(),
        windowTo: now.toISOString(),
        ...reliability,
      },
    };
  }

  /**
   * MTTR / MTBF reliability trend for the last N months (default 6). Each bucket uses the
   * canonical maintenance-lens calculation, so a month in the trend equals the KPI cards
   * and the Analytics report for the same window.
   */
  async getReliabilityTrend(
    factoryId: string | null,
    months = 6,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ) {
    const now = new Date();
    // Apply the same area/line/machine scope as the KPI cards.
    const machineIds = await this.scopeMachineIds(factoryId, scope);

    const windows = Array.from({ length: months }, (_, idx) => {
      const i = months - 1 - idx;
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      return { start, end: end > now ? now : end };
    });

    const results = await Promise.all(
      windows.map((w) =>
        this.reliability.maintenanceReliability(factoryId, scope, w.start, w.end, machineIds),
      ),
    );

    return windows.map((w, i) => ({
      month: w.start.toLocaleString('en-US', { month: 'short' }),
      mttr: parseFloat(results[i].mttrHours.toFixed(1)),
      mtbf: parseFloat(results[i].mtbfHours.toFixed(0)),
    }));
  }

  /**
   * Reliability cockpit — the native Maintenance command-center payload. Composes the
   * existing reliability KPIs + MTTR/MTBF trend with WO status/type breakdowns, an
   * asset-reliability ranking (failures + per-machine MTTR), open-WO aging buckets and
   * the top failure modes by RPN. Scope-aware (area/line/machine) like every KPI surface.
   */
  async getReliabilityCockpit(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
    months = 6,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machineIds = await this.scopeMachineIds(factoryId, scope);
    const woScope = machineIds ? { machineId: { in: machineIds } } : {};
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const r1 = (n: number) => Math.round(n * 10) / 10;

    const [kpis, reliabilityTrend, statusGroups, typeGroups, correctiveWOs, openWOs, failureModes, failureOccurrences] = await Promise.all([
      this.getKPIs(factoryId, scope),
      this.getReliabilityTrend(factoryId, months, scope),
      this.prisma.maintenanceWO.groupBy({
        by: ['status'], where: { ...factoryFilter, ...woScope, deletedAt: null }, _count: { _all: true },
      }),
      this.prisma.maintenanceWO.groupBy({
        by: ['type'], where: { ...factoryFilter, ...woScope, deletedAt: null, createdAt: { gte: periodStart } }, _count: { _all: true },
      }),
      this.prisma.maintenanceWO.findMany({
        where: {
          ...factoryFilter, ...woScope,
          type: { in: [MaintType.CORRECTIVE, MaintType.EMERGENCY] },
          createdAt: { gte: periodStart }, deletedAt: null,
        },
        select: { machineId: true, actualHours: true, status: true, machine: { select: { name: true, code: true } } },
      }),
      this.prisma.maintenanceWO.findMany({
        where: {
          ...factoryFilter, ...woScope,
          status: { in: [MaintStatus.OPEN, MaintStatus.ASSIGNED, MaintStatus.IN_PROGRESS, MaintStatus.AWAITING_PARTS, MaintStatus.ON_HOLD] },
          deletedAt: null,
        },
        select: { createdAt: true, dueDate: true },
      }),
      this.prisma.failureMode.findMany({
        where: { ...factoryFilter, ...(machineIds ? { machineId: { in: machineIds } } : {}), isActive: true },
        select: {
          id: true, code: true, description: true,
          severityScore: true, occurrenceScore: true, detectionScore: true,
          machine: { select: { name: true } },
        },
      }),
      // Real occurrence — how many actual maintenance failures referenced each mode in the window.
      this.prisma.maintenanceWOFailureMode.groupBy({
        by: ['failureModeId'],
        where: {
          wo: {
            ...factoryFilter, ...woScope, deletedAt: null,
            type: { in: [MaintType.CORRECTIVE, MaintType.EMERGENCY] },
            createdAt: { gte: periodStart },
          },
        },
        _count: { _all: true },
      }),
    ]);

    // FMEA occurrence score (1-10) banded from the REAL failure count in the window — so RPN
    // reflects what actually happened, not a static seed. Severity & detection stay as the
    // engineer-defined FMEA register inputs (they are judgments, not measurable from events).
    const occCount = new Map<string, number>(failureOccurrences.map((o) => [o.failureModeId, o._count._all]));
    const occScoreFromCount = (n: number): number =>
      n <= 0 ? 1 : n === 1 ? 3 : n <= 2 ? 5 : n <= 4 ? 7 : n <= 8 ? 9 : 10;
    const topFailureModesReal = failureModes
      .map((f) => {
        const observed = occCount.get(f.id) ?? 0;
        const occurrence = occScoreFromCount(observed);
        return {
          id: f.id, code: f.code, description: f.description, machine: f.machine?.name ?? null,
          severity: f.severityScore, occurrence, detection: f.detectionScore,
          rpn: f.severityScore * occurrence * f.detectionScore,
          observed,
        };
      })
      .sort((a, b) => b.rpn - a.rpn || b.observed - a.observed)
      .slice(0, 8);

    // Asset reliability — failures + per-machine MTTR over the window.
    const byMachine = new Map<string, { machineId: string; name: string; code: string | null; failures: number; repairHours: number; repairs: number }>();
    for (const w of correctiveWOs) {
      if (!w.machineId) continue;
      const e = byMachine.get(w.machineId) ?? { machineId: w.machineId, name: w.machine?.name ?? '—', code: w.machine?.code ?? null, failures: 0, repairHours: 0, repairs: 0 };
      e.failures += 1;
      if (w.status === MaintStatus.COMPLETED && w.actualHours != null) { e.repairHours += w.actualHours; e.repairs += 1; }
      byMachine.set(w.machineId, e);
    }
    const assetReliability = [...byMachine.values()]
      .map((e) => ({ machineId: e.machineId, name: e.name, code: e.code, failures: e.failures, mttr: e.repairs > 0 ? r1(e.repairHours / e.repairs) : 0 }))
      .sort((a, b) => b.failures - a.failures)
      .slice(0, 10);

    // Open-WO aging buckets + overdue count.
    const aging = { lt1d: 0, d1to3: 0, d3to7: 0, gt7d: 0 };
    let overdue = 0;
    for (const w of openWOs) {
      const days = (now.getTime() - w.createdAt.getTime()) / 86_400_000;
      if (days < 1) aging.lt1d += 1;
      else if (days < 3) aging.d1to3 += 1;
      else if (days < 7) aging.d3to7 += 1;
      else aging.gt7d += 1;
      if (w.dueDate && w.dueDate < now) overdue += 1;
    }

    return {
      scope: scope && (scope.areaId || scope.lineId || scope.machineId) ? scope : null,
      kpis,
      reliabilityTrend,
      woByStatus: statusGroups.map((g) => ({ status: g.status, count: g._count._all })),
      woByType: typeGroups.map((g) => ({ type: g.type, count: g._count._all })),
      assetReliability,
      topFailureModes: topFailureModesReal,
      aging,
      openTotal: openWOs.length,
      overdue,
      generatedAt: now.toISOString(),
    };
  }

  // ────────────────────────────────────────────────────────────
  // WORK ORDER CRUD
  // ────────────────────────────────────────────────────────────

  async createMaintenanceWO(factoryId: string | null, userId: string, dto: CreateMaintenanceWODto) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const machine = await this.prisma.machine.findFirst({
      where: { id: dto.machineId, ...factoryFilter },
    });
    if (!machine) throw new NotFoundException('Machine not found');

    const resolvedFactoryId = factoryId ?? machine.factoryId;
    const woNumber = await this.generateWONumber(resolvedFactoryId);

    // If spare parts are requested, WO starts in AWAITING_PARTS until inventory issues them
    const hasParts = !!(dto.spareParts?.length);
    const initialStatus: MaintStatus = hasParts
      ? MaintStatus.AWAITING_PARTS
      : dto.assignedToId
        ? MaintStatus.ASSIGNED
        : MaintStatus.OPEN;

    // Validate ALL requested spare parts up-front so a bad id can't leave behind a
    // work order with no parts attached (the create + spares are then atomic).
    if (dto.spareParts?.length) {
      const ids = [...new Set(dto.spareParts.map((sp) => sp.sparePartId))];
      const found = await this.prisma.sparePart.findMany({
        where: { id: { in: ids }, ...factoryFilter },
        select: { id: true },
      });
      const foundIds = new Set(found.map((p) => p.id));
      const missing = ids.filter((id) => !foundIds.has(id));
      if (missing.length) throw new NotFoundException(`Spare part(s) not found: ${missing.join(', ')}`);
    }

    // Normalise the failure-mode selection: prefer the multi-select list, fall
    // back to the legacy single field. The first id is mirrored onto the legacy
    // column for backward compatibility; the join table holds the full set.
    const failureModeIds = [...new Set(
      dto.failureModeIds?.length ? dto.failureModeIds : (dto.failureModeId ? [dto.failureModeId] : []),
    )];

    const wo = await this.prisma.$transaction(async (tx) => {
      const created = await tx.maintenanceWO.create({
        data: {
          factoryId: resolvedFactoryId,
          woNumber,
          type: dto.type as MaintType,
          priority: dto.priority as Priority,
          status: initialStatus,
          machineId: dto.machineId,
          failureModeId: failureModeIds[0] ?? null,
          triggeredByDowntimeId: dto.triggeredByDowntimeId,
          title: dto.title,
          description: dto.description,
          estimatedHours: dto.estimatedHours,
          assignedToId: dto.assignedToId,
          requestedById: userId,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          notes: dto.notes,
          productionWOId: dto.productionWOId,
        },
        include: {
          machine: { select: { name: true, code: true } },
          assignedTo: { select: { name: true, email: true } },
          requestedBy: { select: { name: true } },
          productionWO: { select: { id: true, orderNumber: true, status: true, sku: { select: { name: true, code: true } } } },
        },
      });

      if (dto.spareParts?.length) {
        await tx.maintWOSparePart.createMany({
          data: dto.spareParts.map((sp) => ({
            woId: created.id,
            sparePartId: sp.sparePartId,
            quantityRequested: sp.quantityRequested,
            notes: sp.notes,
          })),
        });
      }
      if (failureModeIds.length) {
        await tx.maintenanceWOFailureMode.createMany({
          data: failureModeIds.map((failureModeId) => ({ woId: created.id, failureModeId })),
          skipDuplicates: true,
        });
      }
      return created;
    });

    if (dto.spareParts?.length) {
      this.logger.log(`WO ${woNumber} created with ${dto.spareParts.length} spare part request(s) — status: ${initialStatus}`);
    }

    // If EMERGENCY type, immediately update machine state to MAINTENANCE
    if (dto.type === 'EMERGENCY') {
      await this.prisma.machineCurrentStatus.upsert({
        where: { machineId: dto.machineId },
        create: { machineId: dto.machineId, state: 'MAINTENANCE' },
        update: { state: 'MAINTENANCE', lastEventAt: new Date() },
      });
    }

    this.eventEmitter.emit('maintenance.wo.created', {
      wo,
      factoryId: resolvedFactoryId,
      isEmergency: dto.type === 'EMERGENCY',
    });

    void this.traceability.logEvent({
      factoryId: resolvedFactoryId,
      entityType: 'MAINT_WO',
      entityId: wo.id,
      entityCode: woNumber,
      eventType: 'CREATED',
      toValue: initialStatus,
      performedById: userId,
      notes: `${dto.type} - ${dto.priority}${hasParts ? ' | Parts requested' : ''}`,
      eventData: { type: dto.type, priority: dto.priority, machineId: dto.machineId },
    });

    this.logger.log(`Maintenance WO ${woNumber} created (${dto.type} - ${dto.priority})`);
    return wo;
  }

  async getWOById(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.maintenanceWO.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
      include: {
        machine: { include: { area: true, line: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        requestedBy: { select: { id: true, name: true } },
        productionWO: { select: { id: true, orderNumber: true, status: true, sku: { select: { name: true, code: true } } } },
        sparesUsed: {
          include: {
            sparePart: { select: { partNumber: true, name: true, unitCost: true } },
          },
        },
        failureModes: {
          include: {
            failureMode: { select: { id: true, code: true, description: true, category: true, rpn: true, recommendedAction: true } },
          },
        },
      },
    });
    if (!wo) throw new NotFoundException('Maintenance work order not found');
    return {
      ...wo,
      failureModeIds: (wo.failureModes ?? []).map((f) => f.failureModeId),
    };
  }

  async updateWO(factoryId: string | null, id: string, dto: UpdateMaintenanceWODto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.maintenanceWO.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');
    if (['COMPLETED', 'CANCELLED'].includes(wo.status)) {
      throw new BadRequestException(`Cannot update a ${wo.status} work order`);
    }

    // Resolve whether the failure-mode set is being changed in this update.
    const failureModesProvided = dto.failureModeIds !== undefined || dto.failureModeId !== undefined;
    const failureModeIds = failureModesProvided
      ? [...new Set(dto.failureModeIds?.length ? dto.failureModeIds : (dto.failureModeId ? [dto.failureModeId] : []))]
      : [];

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.maintenanceWO.update({
        where: { id },
        data: {
          ...(dto.type && { type: dto.type }),
          ...(dto.priority && { priority: dto.priority as Priority }),
          ...(dto.title && { title: dto.title }),
          ...(dto.description !== undefined && { description: dto.description }),
          ...(dto.estimatedHours !== undefined && { estimatedHours: dto.estimatedHours }),
          ...(dto.dueDate && { dueDate: new Date(dto.dueDate) }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...(dto.machineId && { machineId: dto.machineId }),
          ...(dto.assignedToId !== undefined && {
            assignedToId: dto.assignedToId || null,
            status: dto.assignedToId && wo.status === 'OPEN' ? 'ASSIGNED' : wo.status,
          }),
          ...(dto.productionWOId !== undefined && { productionWOId: dto.productionWOId || null }),
          ...(failureModesProvided && { failureModeId: failureModeIds[0] ?? null }),
        },
      });

      if (failureModesProvided) {
        // Replace the linked set with the new selection.
        await tx.maintenanceWOFailureMode.deleteMany({ where: { woId: id } });
        if (failureModeIds.length) {
          await tx.maintenanceWOFailureMode.createMany({
            data: failureModeIds.map((failureModeId) => ({ woId: id, failureModeId })),
            skipDuplicates: true,
          });
        }
      }
      return updated;
    });
  }

  async deleteWO(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.maintenanceWO.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');
    if (wo.status === 'IN_PROGRESS') {
      throw new BadRequestException('Cannot delete an in-progress work order');
    }
    await this.prisma.maintenanceWO.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async findWorkOrders(factoryId: string | null, filters: {
    search?: string;
    status?: string;
    type?: string;
    priority?: string;
    machineId?: string;
    assignedToId?: string;
    archived?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, status, type, priority, machineId, assignedToId, archived, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: Prisma.MaintenanceWOWhereInput = {
      ...archivedWhere(archived),
      ...factoryFilter,
      deletedAt: null,
      ...(status && { status: status as MaintStatus }),
      ...(type && { type: type as MaintType }),
      ...(priority && { priority: priority as Priority }),
      ...(machineId && { machineId }),
      ...(assignedToId && { assignedToId }),
      ...(search && {
        OR: [
          { woNumber: { contains: search, mode: 'insensitive' as const } },
          { title: { contains: search, mode: 'insensitive' as const } },
          { machine: { name: { contains: search, mode: 'insensitive' as const } } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.maintenanceWO.count({ where }),
      this.prisma.maintenanceWO.findMany({
        where,
        include: {
          machine: { select: { name: true, code: true } },
          assignedTo: { select: { name: true } },
          requestedBy: { select: { name: true } },
          productionWO: { select: { id: true, orderNumber: true, status: true } },
          sparesUsed: { select: { id: true, status: true } },
          failureModes: { select: { failureModeId: true } },
        },
        orderBy: [{ priority: 'desc' }, { dueDate: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: (data as any[]).map((wo) => ({
        id: wo.id,
        woNumber: wo.woNumber,
        title: wo.title,
        type: wo.type,
        priority: wo.priority,
        status: wo.status,
        asset: wo.machine.name,
        assetCode: wo.machine.code,
        machineId: wo.machineId,
        assignedTo: wo.assignedTo?.name ?? null,
        requestedBy: wo.requestedBy?.name ?? null,
        createdAt: wo.createdAt.toISOString(),
        dueDate: wo.dueDate?.toISOString() ?? null,
        startedAt: wo.startedAt?.toISOString() ?? null,
        completedAt: wo.completedAt?.toISOString() ?? null,
        estimatedHours: wo.estimatedHours,
        actualHours: wo.actualHours,
        totalCost: wo.totalCost,
        description: wo.description,
        isOverdue: wo.dueDate ? wo.dueDate < new Date() && !['COMPLETED', 'CANCELLED'].includes(wo.status) : false,
        sparePartsCount: wo.sparesUsed?.length ?? 0,
        hasPendingParts: (wo.sparesUsed ?? []).some((s: any) => s.status === 'PENDING'),
        archivedAt: wo.archivedAt ?? null,
        failureModeId: wo.failureModeId ?? null,
        failureModeIds: (wo.failureModes ?? []).map((f: any) => f.failureModeId),
        productionWOId: wo.productionWOId ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ────────────────────────────────────────────────────────────
  // STATE MACHINE
  // ────────────────────────────────────────────────────────────

  async assignWO(factoryId: string | null, id: string, dto: AssignWODto) {
    const wo = await this.assertTransition(factoryId, id, MaintStatus.ASSIGNED);

    const user = await this.prisma.user.findUnique({ where: { id: dto.assignedToId } });
    if (!user) throw new NotFoundException('Technician not found');

    const updated = await this.prisma.maintenanceWO.update({
      where: { id },
      data: {
        status: MaintStatus.ASSIGNED,
        assignedToId: dto.assignedToId,
        ...(dto.notes && { notes: dto.notes }),
      },
      include: { assignedTo: { select: { name: true, email: true } } },
    });

    this.eventEmitter.emit('maintenance.wo.assigned', {
      wo: updated,
      technicianName: user.name,
      factoryId: wo.factoryId,
    });

    void this.traceability.logEvent({
      factoryId: wo.factoryId,
      entityType: 'MAINT_WO',
      entityId: id,
      entityCode: wo.woNumber,
      eventType: 'STATUS_CHANGED',
      fromValue: wo.status,
      toValue: MaintStatus.ASSIGNED,
      notes: `Assigned to ${user.name}`,
      eventData: { assignedToId: dto.assignedToId, technicianName: user.name },
    });

    return updated;
  }

  async startWO(factoryId: string | null, id: string, dto: StartWODto) {
    const wo = await this.assertTransition(factoryId, id, MaintStatus.IN_PROGRESS);

    // Block start if there are still pending (un-issued) spare parts
    const pendingParts = await this.prisma.maintWOSparePart.count({
      where: { woId: id, status: SpareIssueStatus.PENDING },
    });
    if (pendingParts > 0) {
      throw new BadRequestException(
        `Cannot start work order: ${pendingParts} spare part(s) are still pending inventory approval. ` +
        'All requested parts must be issued or cancelled before starting.',
      );
    }

    const updated = await this.prisma.maintenanceWO.update({
      where: { id },
      data: {
        status: MaintStatus.IN_PROGRESS,
        startedAt: new Date(),
        ...(dto.runtimeHoursAtService !== undefined && { runtimeHoursAtService: dto.runtimeHoursAtService }),
        ...(dto.notes && { notes: dto.notes }),
      },
    });

    // Set machine to MAINTENANCE state
    await this.prisma.machineCurrentStatus.upsert({
      where: { machineId: wo.machineId },
      create: { machineId: wo.machineId, state: 'MAINTENANCE' },
      update: { state: 'MAINTENANCE', lastEventAt: new Date() },
    });

    this.eventEmitter.emit('maintenance.wo.started', {
      wo: updated,
      factoryId: wo.factoryId,
    });

    void this.traceability.logEvent({
      factoryId: wo.factoryId,
      entityType: 'MAINT_WO',
      entityId: id,
      entityCode: wo.woNumber,
      eventType: 'STATUS_CHANGED',
      fromValue: wo.status,
      toValue: MaintStatus.IN_PROGRESS,
      notes: dto.notes,
      eventData: { runtimeHoursAtService: dto.runtimeHoursAtService, machineId: wo.machineId },
    });

    return updated;
  }

  async completeWO(factoryId: string | null, id: string, dto: CompleteWODto) {
    const wo = await this.assertTransition(factoryId, id, MaintStatus.COMPLETED);

    const partsCost = dto.partsCost ?? 0;
    const laborCost = dto.laborCost ?? 0;
    const totalCost = partsCost + laborCost;
    const completedAt = new Date();

    // Handle additional (unplanned) spare parts logged at completion time
    if (dto.sparesUsed?.length) {
      for (const spare of dto.sparesUsed) {
        const part = await this.prisma.sparePart.findFirst({
          where: { id: spare.sparePartId },
        });
        if (!part) {
          throw new NotFoundException(`Spare part ${spare.sparePartId} not found`);
        }
        if (part.stockQty < spare.quantity) {
          throw new BadRequestException(
            `Insufficient stock for part ${part.partNumber}: ${part.stockQty} available, ${spare.quantity} required`,
          );
        }

        // Check if a PENDING request already exists for this part on this WO
        const existing = await this.prisma.maintWOSparePart.findFirst({
          where: { woId: id, sparePartId: spare.sparePartId, status: SpareIssueStatus.PENDING },
        });
        if (existing) {
          // Update the existing request to ISSUED
          await this.prisma.maintWOSparePart.update({
            where: { id: existing.id },
            data: {
              quantityIssued: spare.quantity,
              status: SpareIssueStatus.ISSUED,
              issuedAt: new Date(),
              unitCost: spare.unitCost ?? part.unitCost ?? 0,
            },
          });
        } else {
          // Create a new ISSUED record for the unplanned part
          await this.prisma.maintWOSparePart.create({
            data: {
              woId: id,
              sparePartId: spare.sparePartId,
              quantityRequested: spare.quantity,
              quantityIssued: spare.quantity,
              unitCost: spare.unitCost ?? part.unitCost ?? 0,
              status: SpareIssueStatus.ISSUED,
              issuedAt: new Date(),
            },
          });
        }

        // Deduct stock
        await this.prisma.sparePart.update({
          where: { id: spare.sparePartId },
          data: { stockQty: { decrement: spare.quantity } },
        });
      }
    }

    const updated = await this.prisma.maintenanceWO.update({
      where: { id },
      data: {
        status: MaintStatus.COMPLETED,
        completedAt,
        actualHours: dto.actualHours,
        laborCost,
        partsCost,
        totalCost,
        ...(dto.runtimeHoursAtService !== undefined && { runtimeHoursAtService: dto.runtimeHoursAtService }),
        ...(dto.notes && { notes: dto.notes }),
      },
    });

    // Restore machine state to IDLE
    await this.prisma.machineCurrentStatus.upsert({
      where: { machineId: wo.machineId },
      create: { machineId: wo.machineId, state: 'IDLE' },
      update: { state: 'IDLE', lastEventAt: new Date() },
    });

    this.eventEmitter.emit('maintenance.wo.completed', {
      wo: updated,
      factoryId: wo.factoryId,
      actualHours: dto.actualHours,
      totalCost,
    });

    void this.traceability.logEvent({
      factoryId: wo.factoryId,
      entityType: 'MAINT_WO',
      entityId: id,
      entityCode: wo.woNumber,
      eventType: 'STATUS_CHANGED',
      fromValue: wo.status,
      toValue: MaintStatus.COMPLETED,
      notes: dto.notes ?? `Completed in ${dto.actualHours}h`,
      eventData: { actualHours: dto.actualHours, laborCost, partsCost, totalCost },
    });

    this.logger.log(`Maintenance WO ${wo.woNumber} completed in ${dto.actualHours}h`);
    return updated;
  }

  async cancelWO(factoryId: string | null, id: string, userId: string, dto: CancelWODto) {
    const wo = await this.assertTransition(factoryId, id, MaintStatus.CANCELLED);

    const updated = await this.prisma.maintenanceWO.update({
      where: { id },
      data: {
        status: MaintStatus.CANCELLED,
        notes: dto.reason,
      },
    });

    // Restore machine if it was in MAINTENANCE state
    if (['IN_PROGRESS', 'ASSIGNED'].includes(wo.status)) {
      await this.prisma.machineCurrentStatus.upsert({
        where: { machineId: wo.machineId },
        create: { machineId: wo.machineId, state: 'IDLE' },
        update: { state: 'IDLE', lastEventAt: new Date() },
      });
    }

    void this.traceability.logEvent({
      factoryId: wo.factoryId,
      entityType: 'MAINT_WO',
      entityId: id,
      entityCode: wo.woNumber,
      eventType: 'STATUS_CHANGED',
      fromValue: wo.status,
      toValue: MaintStatus.CANCELLED,
      performedById: userId,
      notes: dto.reason,
    });

    return updated;
  }

  async holdWO(factoryId: string | null, id: string, reason?: string) {
    const wo = await this.assertTransition(factoryId, id, MaintStatus.ON_HOLD);
    const updated = await this.prisma.maintenanceWO.update({
      where: { id },
      data: { status: MaintStatus.ON_HOLD, ...(reason && { notes: reason }) },
    });
    void this.traceability.logEvent({
      factoryId: wo.factoryId,
      entityType: 'MAINT_WO',
      entityId: id,
      entityCode: wo.woNumber,
      eventType: 'STATUS_CHANGED',
      fromValue: wo.status,
      toValue: MaintStatus.ON_HOLD,
      notes: reason,
    });
    return updated;
  }

  async resumeWO(factoryId: string | null, id: string) {
    const wo = await this.assertTransition(factoryId, id, MaintStatus.IN_PROGRESS);
    const resumeStatus = wo.startedAt ? MaintStatus.IN_PROGRESS : MaintStatus.ASSIGNED;
    const updated = await this.prisma.maintenanceWO.update({
      where: { id },
      data: { status: resumeStatus },
    });
    void this.traceability.logEvent({
      factoryId: wo.factoryId,
      entityType: 'MAINT_WO',
      entityId: id,
      entityCode: wo.woNumber,
      eventType: 'STATUS_CHANGED',
      fromValue: MaintStatus.ON_HOLD,
      toValue: resumeStatus,
      notes: 'Work order resumed',
    });
    return updated;
  }

  // ────────────────────────────────────────────────────────────
  // SPARE PARTS
  // ────────────────────────────────────────────────────────────

  async findSpareParts(factoryId: string | null, filters: {
    search?: string;
    category?: string;
    lowStock?: boolean;
    page?: number;
    limit?: number;
  }) {
    const { search, category, lowStock, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where2: any = {
      ...factoryFilter,
      isActive: true,
      ...(category && { category }),
      ...(search && {
        OR: [
          { partNumber: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };
    if (lowStock) {
      // stockQty <= minStockQty
      where2.AND = [{ stockQty: { lte: 0 } }];
      // Use raw approach
    }

    const [total, data] = await Promise.all([
      this.prisma.sparePart.count({ where: where2 }),
      this.prisma.sparePart.findMany({
        where: where2,
        orderBy: [{ category: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((p) => ({
        ...p,
        isLowStock: p.stockQty <= p.minStockQty,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ────────────────────────────────────────────────────────────
  // SPARE PART REQUESTS (per WO)
  // ────────────────────────────────────────────────────────────

  async getWOSpareParts(factoryId: string | null, woId: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.maintenanceWO.findFirst({
      where: { id: woId, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    return this.prisma.maintWOSparePart.findMany({
      where: { woId },
      include: {
        sparePart: { select: { partNumber: true, name: true, unitCost: true, stockQty: true, storageLocation: true } },
        issuedBy: { select: { name: true } },
      },
      orderBy: { requestedAt: 'asc' },
    });
  }

  async addSpareParts(
    factoryId: string | null,
    woId: string,
    parts: SparePartRequestItemDto[],
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.maintenanceWO.findFirst({
      where: { id: woId, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');
    if (['COMPLETED', 'CANCELLED'].includes(wo.status)) {
      throw new BadRequestException(`Cannot add parts to a ${wo.status} work order`);
    }

    const created = [];
    for (const p of parts) {
      const part = await this.prisma.sparePart.findFirst({ where: { id: p.sparePartId } });
      if (!part) throw new NotFoundException(`Spare part ${p.sparePartId} not found`);

      const record = await this.prisma.maintWOSparePart.create({
        data: {
          woId,
          sparePartId: p.sparePartId,
          quantityRequested: p.quantityRequested,
          notes: p.notes,
          status: SpareIssueStatus.PENDING,
        },
        include: {
          sparePart: { select: { partNumber: true, name: true, stockQty: true } },
        },
      });
      created.push(record);
    }

    // If WO is OPEN or ASSIGNED and now has pending parts → move to AWAITING_PARTS
    const openOrAssigned: string[] = [MaintStatus.OPEN, MaintStatus.ASSIGNED];
    if (openOrAssigned.includes(wo.status)) {
      await this.prisma.maintenanceWO.update({
        where: { id: woId },
        data: { status: MaintStatus.AWAITING_PARTS },
      });
    }

    return created;
  }

  /** For the inventory team — all PENDING spare part requests across all active WOs */
  async getPendingPartsRequests(factoryId: string | null, filters: {
    search?: string;
    page?: number;
    limit?: number;
  }) {
    const { search, page = 1, limit = 50 } = filters;
    const factoryFilter = factoryId ? { wo: { factoryId } } : {};

    const where: Prisma.MaintWOSparePartWhereInput = {
      ...factoryFilter,
      status: SpareIssueStatus.PENDING,
      wo: {
        ...((factoryId) ? { factoryId } : {}),
        deletedAt: null,
      },
      ...(search && {
        OR: [
          { sparePart: { name: { contains: search, mode: 'insensitive' as const } } },
          { sparePart: { partNumber: { contains: search, mode: 'insensitive' as const } } },
          { wo: { woNumber: { contains: search, mode: 'insensitive' as const } } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.maintWOSparePart.count({ where }),
      this.prisma.maintWOSparePart.findMany({
        where,
        include: {
          sparePart: {
            select: { partNumber: true, name: true, category: true, stockQty: true, minStockQty: true, storageLocation: true, unitCost: true },
          },
          wo: {
            select: { woNumber: true, title: true, priority: true, dueDate: true, machine: { select: { name: true, code: true } } },
          },
          issuedBy: { select: { name: true } },
        },
        orderBy: [{ wo: { priority: 'desc' } }, { requestedAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((r) => ({
        id: r.id,
        woId: r.woId,
        woNumber: (r.wo as any).woNumber,
        woTitle: (r.wo as any).title,
        woPriority: (r.wo as any).priority,
        woDueDate: (r.wo as any).dueDate,
        machine: (r.wo as any).machine,
        sparePartId: r.sparePartId,
        partNumber: (r.sparePart as any).partNumber,
        partName: (r.sparePart as any).name,
        category: (r.sparePart as any).category,
        stockQty: (r.sparePart as any).stockQty,
        minStockQty: (r.sparePart as any).minStockQty,
        storageLocation: (r.sparePart as any).storageLocation,
        unitCost: (r.sparePart as any).unitCost,
        quantityRequested: r.quantityRequested,
        quantityIssued: r.quantityIssued,
        status: r.status,
        requestedAt: r.requestedAt,
        notes: r.notes,
        insufficientStock: (r.sparePart as any).stockQty < r.quantityRequested,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async issueSparePart(
    factoryId: string | null,
    woId: string,
    requestId: string,
    userId: string,
    dto: IssueSparePartDto,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.maintenanceWO.findFirst({
      where: { id: woId, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    const request = await this.prisma.maintWOSparePart.findFirst({
      where: { id: requestId, woId },
      include: { sparePart: true },
    });
    if (!request) throw new NotFoundException('Spare part request not found');
    if (request.status === SpareIssueStatus.ISSUED) {
      throw new BadRequestException('This part request has already been fully issued');
    }
    if (request.status === SpareIssueStatus.CANCELLED) {
      throw new BadRequestException('This part request has been cancelled');
    }

    const part = request.sparePart;
    if (part.stockQty < dto.quantityIssued) {
      throw new BadRequestException(
        `Insufficient stock for ${part.partNumber}: ${part.stockQty} available, ${dto.quantityIssued} requested`,
      );
    }

    const newIssuedQty = request.quantityIssued + dto.quantityIssued;
    const newStatus: SpareIssueStatus =
      newIssuedQty >= request.quantityRequested
        ? SpareIssueStatus.ISSUED
        : SpareIssueStatus.PARTIAL;

    const [updated] = await this.prisma.$transaction([
      this.prisma.maintWOSparePart.update({
        where: { id: requestId },
        data: {
          quantityIssued: newIssuedQty,
          status: newStatus,
          issuedAt: new Date(),
          issuedById: userId,
          notes: dto.notes ?? request.notes,
        },
        include: {
          sparePart: { select: { partNumber: true, name: true, stockQty: true } },
          issuedBy: { select: { name: true } },
        },
      }),
      this.prisma.sparePart.update({
        where: { id: part.id },
        data: { stockQty: { decrement: dto.quantityIssued } },
      }),
    ]);

    // Auto-transition WO from AWAITING_PARTS once all parts are issued or cancelled
    if (wo.status === MaintStatus.AWAITING_PARTS) {
      const remainingPending = await this.prisma.maintWOSparePart.count({
        where: {
          woId,
          status: { notIn: [SpareIssueStatus.ISSUED, SpareIssueStatus.CANCELLED] },
        },
      });
      if (remainingPending === 0) {
        // All parts resolved → transition to OPEN (or ASSIGNED if technician already set)
        const nextStatus = wo.assignedToId ? MaintStatus.ASSIGNED : MaintStatus.OPEN;
        await this.prisma.maintenanceWO.update({
          where: { id: woId },
          data: { status: nextStatus },
        });
        this.logger.log(`WO ${wo.woNumber} auto-transitioned from AWAITING_PARTS → ${nextStatus} (all parts issued)`);
        this.eventEmitter.emit('maintenance.wo.parts_ready', {
          woId,
          woNumber: wo.woNumber,
          nextStatus,
          factoryId: wo.factoryId,
        });
      }
    }

    this.eventEmitter.emit('maintenance.spare_part.issued', {
      woId,
      woNumber: wo.woNumber,
      partNumber: part.partNumber,
      partName: part.name,
      quantityIssued: dto.quantityIssued,
      issuedByUserId: userId,
      factoryId: wo.factoryId,
    });

    void this.traceability.logEvent({
      factoryId: wo.factoryId,
      entityType: 'SPARE_PART',
      entityId: part.id,
      entityCode: part.partNumber,
      eventType: 'PARTS_ISSUED',
      quantity: dto.quantityIssued,
      performedById: userId,
      notes: `Issued for MO ${wo.woNumber}`,
      relatedType: 'MAINT_WO',
      relatedId: woId,
      eventData: { partName: part.name, woNumber: wo.woNumber, newStatus },
    });

    this.logger.log(`Spare part ${part.partNumber} x${dto.quantityIssued} issued for WO ${wo.woNumber}`);
    return updated;
  }

  async cancelSparePartRequest(
    factoryId: string | null,
    woId: string,
    requestId: string,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.maintenanceWO.findFirst({
      where: { id: woId, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    const request = await this.prisma.maintWOSparePart.findFirst({
      where: { id: requestId, woId },
    });
    if (!request) throw new NotFoundException('Spare part request not found');
    if (request.status !== SpareIssueStatus.PENDING) {
      throw new BadRequestException('Only PENDING requests can be cancelled');
    }

    return this.prisma.maintWOSparePart.update({
      where: { id: requestId },
      data: { status: SpareIssueStatus.CANCELLED },
    });
  }

  // ────────────────────────────────────────────────────────────
  // PM PLANS
  // ────────────────────────────────────────────────────────────

  async findPMPlans(factoryId: string | null, filters: {
    machineId?: string;
    page?: number;
    limit?: number;
  }) {
    const { machineId, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: any = {
      ...factoryFilter,
      isActive: true,
      ...(machineId && { machineId }),
    };

    const [total, data] = await Promise.all([
      this.prisma.pMPlan.count({ where }),
      this.prisma.pMPlan.findMany({
        where,
        include: {
          machine: { select: { name: true, code: true } },
          tasks: {
            where: { status: { in: ['SCHEDULED', 'OVERDUE'] } },
            orderBy: { scheduledDate: 'asc' },
            take: 3,
          },
        },
        orderBy: { nextDueAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((p) => ({
        ...p,
        isOverdue: p.nextDueAt ? p.nextDueAt < new Date() : false,
        nextTask: p.tasks[0] ?? null,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findPMTasks(factoryId: string | null, filters: {
    machineId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const { machineId, status, dateFrom, dateTo, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: any = {
      ...factoryFilter,
      ...(machineId && { machineId }),
      ...(status && { status }),
      ...(dateFrom && { scheduledDate: { gte: new Date(dateFrom) } }),
      ...(dateTo && { scheduledDate: { lte: new Date(dateTo) } }),
    };

    const [total, data] = await Promise.all([
      this.prisma.pMTask.count({ where }),
      this.prisma.pMTask.findMany({
        where,
        include: {
          machine: { select: { name: true, code: true } },
          plan: { select: { name: true, code: true, type: true } },
          assignedTo: { select: { name: true } },
        },
        orderBy: [{ scheduledDate: 'asc' }, { status: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  // ────────────────────────────────────────────────────────────
  // PREVENTIVE MAINTENANCE (PMPlan-based /preventive alias)
  // ────────────────────────────────────────────────────────────

  /** FMEA failure modes — for the maintenance-order Failure Mode picker. */
  async findFailureModes(factoryId: string | null, machineId?: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    return this.prisma.failureMode.findMany({
      where: { ...factoryFilter, isActive: true, ...(machineId ? { machineId } : {}) },
      select: {
        id: true, code: true, description: true, category: true, rpn: true,
        machineId: true, recommendedAction: true,
        causeDescription: true, effectDescription: true,
        severityScore: true, occurrenceScore: true, detectionScore: true,
      },
      orderBy: [{ rpn: 'desc' }, { code: 'asc' }],
    });
  }

  /** Validate the machine exists in the caller's factory and return its resolved factoryId. */
  private async resolveMachineFactory(factoryId: string | null, machineId: string): Promise<string> {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machine = await this.prisma.machine.findFirst({
      where: { id: machineId, ...factoryFilter },
      select: { id: true, factoryId: true },
    });
    if (!machine) throw new NotFoundException('Machine not found');
    return factoryId ?? machine.factoryId;
  }

  /** Next FM-### code for a machine (per-machine sequence). */
  private async nextFailureModeCode(machineId: string): Promise<string> {
    const count = await this.prisma.failureMode.count({ where: { machineId } });
    return `FM-${String(count + 1).padStart(3, '0')}`;
  }

  async createFailureMode(factoryId: string | null, dto: CreateFailureModeDto) {
    const resolvedFactoryId = await this.resolveMachineFactory(factoryId, dto.machineId);
    const severity = dto.severityScore ?? 1;
    const occurrence = dto.occurrenceScore ?? 1;
    const detection = dto.detectionScore ?? 1;
    const code = dto.code?.trim() || (await this.nextFailureModeCode(dto.machineId));

    return this.prisma.failureMode.create({
      data: {
        factoryId: resolvedFactoryId,
        machineId: dto.machineId,
        code,
        description: dto.description.trim(),
        category: (dto.category as DowntimeCategory) ?? DowntimeCategory.MECHANICAL,
        causeDescription: dto.causeDescription ?? null,
        effectDescription: dto.effectDescription ?? null,
        severityScore: severity,
        occurrenceScore: occurrence,
        detectionScore: detection,
        rpn: severity * occurrence * detection,
        recommendedAction: dto.recommendedAction ?? null,
      },
    });
  }

  async updateFailureMode(factoryId: string | null, id: string, dto: UpdateFailureModeDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const existing = await this.prisma.failureMode.findFirst({ where: { id, ...factoryFilter } });
    if (!existing) throw new NotFoundException('Failure mode not found');

    const severity = dto.severityScore ?? existing.severityScore;
    const occurrence = dto.occurrenceScore ?? existing.occurrenceScore;
    const detection = dto.detectionScore ?? existing.detectionScore;

    return this.prisma.failureMode.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: dto.code.trim() }),
        ...(dto.description !== undefined && { description: dto.description.trim() }),
        ...(dto.category !== undefined && { category: dto.category as DowntimeCategory }),
        ...(dto.causeDescription !== undefined && { causeDescription: dto.causeDescription || null }),
        ...(dto.effectDescription !== undefined && { effectDescription: dto.effectDescription || null }),
        ...(dto.recommendedAction !== undefined && { recommendedAction: dto.recommendedAction || null }),
        severityScore: severity,
        occurrenceScore: occurrence,
        detectionScore: detection,
        rpn: severity * occurrence * detection,
      },
    });
  }

  /** Delete a failure mode, or disable it if it is referenced by any work order. */
  async deleteFailureMode(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const existing = await this.prisma.failureMode.findFirst({ where: { id, ...factoryFilter } });
    if (!existing) throw new NotFoundException('Failure mode not found');

    const [legacyUses, linkUses] = await Promise.all([
      this.prisma.maintenanceWO.count({ where: { failureModeId: id } }),
      this.prisma.maintenanceWOFailureMode.count({ where: { failureModeId: id } }),
    ]);
    const usedBy = Math.max(legacyUses, linkUses);
    if (usedBy > 0) {
      await this.prisma.failureMode.update({ where: { id }, data: { isActive: false } });
      return { disabled: true, usedBy };
    }
    await this.prisma.failureMode.delete({ where: { id } });
    return { deleted: true };
  }

  /** Standard FMEA library — generic failure modes applicable to most equipment. */
  private static readonly STANDARD_FAILURE_MODES: Array<{
    description: string;
    category: DowntimeCategory;
    causeDescription: string;
    effectDescription: string;
    severityScore: number;
    occurrenceScore: number;
    detectionScore: number;
    recommendedAction: string;
  }> = [
    { description: 'Bearing wear / failure', category: DowntimeCategory.MECHANICAL, causeDescription: 'Inadequate lubrication, contamination, fatigue', effectDescription: 'Excessive vibration, noise, eventual seizure', severityScore: 7, occurrenceScore: 4, detectionScore: 4, recommendedAction: 'Vibration monitoring; lubricate per schedule; replace at wear limit' },
    { description: 'Belt slip / breakage', category: DowntimeCategory.MECHANICAL, causeDescription: 'Improper tension, misalignment, wear', effectDescription: 'Loss of drive, line stop', severityScore: 6, occurrenceScore: 5, detectionScore: 3, recommendedAction: 'Inspect tension & alignment monthly; replace worn belts' },
    { description: 'Motor overheating', category: DowntimeCategory.ELECTRICAL, causeDescription: 'Overload, blocked cooling, bearing drag', effectDescription: 'Thermal trip, winding damage', severityScore: 8, occurrenceScore: 3, detectionScore: 4, recommendedAction: 'Monitor temperature & current; clean cooling fins' },
    { description: 'Seal / gasket leak', category: DowntimeCategory.MECHANICAL, causeDescription: 'Aging elastomer, over-pressure, wear', effectDescription: 'Fluid loss, contamination, pressure loss', severityScore: 5, occurrenceScore: 5, detectionScore: 3, recommendedAction: 'Inspect seals; replace at PM interval' },
    { description: 'Sensor drift / failure', category: DowntimeCategory.ELECTRICAL, causeDescription: 'Calibration loss, wiring fault, contamination', effectDescription: 'False readings, mis-control, scrap', severityScore: 6, occurrenceScore: 4, detectionScore: 5, recommendedAction: 'Periodic calibration; verify wiring; clean sensor face' },
    { description: 'Pneumatic / hydraulic pressure loss', category: DowntimeCategory.UTILITY, causeDescription: 'Leaks, compressor fault, valve failure', effectDescription: 'Slow or failed actuation', severityScore: 6, occurrenceScore: 4, detectionScore: 3, recommendedAction: 'Leak test; inspect valves & fittings' },
    { description: 'Lubrication system failure', category: DowntimeCategory.MECHANICAL, causeDescription: 'Pump failure, blocked line, low reservoir', effectDescription: 'Accelerated wear of moving parts', severityScore: 7, occurrenceScore: 3, detectionScore: 5, recommendedAction: 'Monitor lube level/flow; clean lines; verify pump' },
    { description: 'Control / PLC fault', category: DowntimeCategory.ELECTRICAL, causeDescription: 'Software fault, power glitch, I/O failure', effectDescription: 'Unexpected stop, mis-operation', severityScore: 8, occurrenceScore: 2, detectionScore: 6, recommendedAction: 'UPS protection; firmware updates; I/O diagnostics' },
    { description: 'Material jam / misfeed', category: DowntimeCategory.PROCESS, causeDescription: 'Out-of-spec material, guide misalignment', effectDescription: 'Stoppage, product damage', severityScore: 4, occurrenceScore: 6, detectionScore: 2, recommendedAction: 'Verify material spec; adjust guides; clean feed path' },
    { description: 'Coupling / shaft misalignment', category: DowntimeCategory.MECHANICAL, causeDescription: 'Improper installation, thermal growth, wear', effectDescription: 'Vibration, bearing & coupling wear', severityScore: 6, occurrenceScore: 3, detectionScore: 4, recommendedAction: 'Laser-align at install; recheck after thermal cycling' },
  ];

  /** Seed the standard FMEA library onto a machine (skips entries that already exist). */
  async seedStandardFailureModes(factoryId: string | null, machineId: string) {
    const resolvedFactoryId = await this.resolveMachineFactory(factoryId, machineId);

    const existing = await this.prisma.failureMode.findMany({
      where: { machineId },
      select: { description: true },
    });
    const existingDesc = new Set(existing.map((e) => e.description.trim().toLowerCase()));

    const toCreate = MaintenanceService.STANDARD_FAILURE_MODES.filter(
      (fm) => !existingDesc.has(fm.description.trim().toLowerCase()),
    );
    if (toCreate.length === 0) return { created: 0, skipped: MaintenanceService.STANDARD_FAILURE_MODES.length };

    let seq = await this.prisma.failureMode.count({ where: { machineId } });
    await this.prisma.failureMode.createMany({
      data: toCreate.map((fm) => {
        seq += 1;
        return {
          factoryId: resolvedFactoryId,
          machineId,
          code: `FM-${String(seq).padStart(3, '0')}`,
          description: fm.description,
          category: fm.category,
          causeDescription: fm.causeDescription,
          effectDescription: fm.effectDescription,
          severityScore: fm.severityScore,
          occurrenceScore: fm.occurrenceScore,
          detectionScore: fm.detectionScore,
          rpn: fm.severityScore * fm.occurrenceScore * fm.detectionScore,
          recommendedAction: fm.recommendedAction,
        };
      }),
    });

    return { created: toCreate.length, skipped: MaintenanceService.STANDARD_FAILURE_MODES.length - toCreate.length };
  }

  async findPreventiveSchedules(factoryId: string | null, filters: { search?: string; page: number; limit: number; archived?: string }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const where: any = {
      ...factoryFilter,
      ...archivedWhere(filters.archived),
      isActive: true,
      ...(filters.search ? {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' as const } },
          { code: { contains: filters.search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 86400000);

    const [data, total] = await Promise.all([
      this.prisma.pMPlan.findMany({
        where,
        orderBy: { nextDueAt: 'asc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        include: {
          machine: { select: { name: true, code: true } },
        },
      }),
      this.prisma.pMPlan.count({ where }),
    ]);

    const mapped = data.map(p => ({
      id: p.id,
      equipment: p.machine.name,
      task: p.name,
      frequency: p.frequencyDays ? `Every ${p.frequencyDays}d` : p.type,
      frequencyDays: p.frequencyDays,
      lastDone: p.lastExecutedAt?.toISOString() ?? null,
      nextDue: p.nextDueAt?.toISOString() ?? null,
      estimatedHours: p.estimatedHours,
      runtimeHours: p.runtimeHours,
      description: p.description,
      instructions: p.instructions,
      assignedTo: '',
      status: !p.nextDueAt ? 'SCHEDULED'
        : p.nextDueAt < now ? 'OVERDUE'
        : p.nextDueAt < weekLater ? 'DUE'
        : 'SCHEDULED',
      machineId: p.machineId,
      code: p.code,
      type: p.type,
      archivedAt: (p as any).archivedAt ?? null,
    }));

    return { data: mapped, total };
  }

  async getPreventiveKPIs(factoryId: string | null) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const now = new Date();
    const weekLater = new Date(now.getTime() + 7 * 86400000);

    const [total, overdue, dueThisWeek, completed] = await Promise.all([
      this.prisma.pMPlan.count({ where: { ...factoryFilter, isActive: true } }),
      this.prisma.pMPlan.count({ where: { ...factoryFilter, isActive: true, nextDueAt: { lt: now } } }),
      this.prisma.pMPlan.count({ where: { ...factoryFilter, isActive: true, nextDueAt: { gte: now, lt: weekLater } } }),
      this.prisma.pMTask.count({ where: { ...factoryFilter, status: 'COMPLETED' } }),
    ]);

    return { total, overdue, dueThisWeek, completed };
  }

  private static readonly FREQ_DAYS: Record<string, number> = {
    DAILY: 1, WEEKLY: 7, MONTHLY: 30, QUARTERLY: 91, YEARLY: 365,
  };

  /** Resolve the effective recurrence interval (explicit days win over a named frequency). */
  private resolveFreqDays(frequency?: string, frequencyDays?: number): number | null {
    if (frequencyDays && frequencyDays > 0) return Math.round(frequencyDays);
    if (frequency && MaintenanceService.FREQ_DAYS[frequency]) return MaintenanceService.FREQ_DAYS[frequency];
    return null;
  }

  async createPreventiveSchedule(factoryId: string | null, dto: {
    machineId?: string; equipment?: string; task: string;
    type?: string; frequency?: string; frequencyDays?: number;
    estimatedHours?: number; runtimeHours?: number;
    description?: string; instructions?: string; nextDueAt?: string; assignedTo?: string;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};

    // Prefer an explicit machineId; fall back to a fuzzy name/code match for legacy callers.
    const machine = dto.machineId
      ? await this.prisma.machine.findFirst({ where: { id: dto.machineId, ...factoryFilter } })
      : (dto.equipment
        ? await this.prisma.machine.findFirst({
            where: { ...factoryFilter, OR: [{ name: { contains: dto.equipment, mode: 'insensitive' as const } }, { code: { contains: dto.equipment, mode: 'insensitive' as const } }] },
          })
        : null);
    if (!machine) throw new BadRequestException('Machine not found — select a valid machine.');

    const resolvedFactoryId = factoryId ?? machine.factoryId ?? await this.getDefaultFactoryId();
    const code = `PM-${Date.now().toString(36).toUpperCase()}`;
    const type = (dto.type ?? 'TIME_BASED') as any;
    const freqDays = this.resolveFreqDays(dto.frequency, dto.frequencyDays);
    // Time/calendar plans are date-driven; runtime/condition plans may have no calendar due date.
    const nextDueAt = dto.nextDueAt
      ? new Date(dto.nextDueAt)
      : (freqDays ? new Date(Date.now() + freqDays * 86400000) : null);

    const plan = await this.prisma.pMPlan.create({
      data: {
        factoryId: resolvedFactoryId,
        machineId: machine.id,
        code,
        name: dto.task,
        type,
        description: dto.description || null,
        instructions: dto.instructions || null,
        frequencyDays: freqDays,
        runtimeHours: dto.runtimeHours ?? null,
        estimatedHours: dto.estimatedHours ?? null,
        isActive: true,
        nextDueAt,
      },
      include: { machine: { select: { name: true, code: true } } },
    });

    return {
      id: plan.id,
      equipment: plan.machine.name,
      task: plan.name,
      frequency: dto.frequency ?? (freqDays ? `Every ${freqDays}d` : plan.type),
      estimatedHours: plan.estimatedHours,
      assignedTo: dto.assignedTo ?? '',
      status: 'SCHEDULED',
    };
  }

  async updatePreventiveSchedule(factoryId: string | null, id: string, dto: {
    machineId?: string; equipment?: string; task?: string;
    type?: string; frequency?: string; frequencyDays?: number;
    estimatedHours?: number; runtimeHours?: number;
    description?: string; instructions?: string; nextDueAt?: string; assignedTo?: string;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const plan = await this.prisma.pMPlan.findFirst({ where: { id, ...factoryFilter } });
    if (!plan) throw new NotFoundException('PM plan not found');

    const updateData: any = {};
    if (dto.machineId) {
      const m = await this.prisma.machine.findFirst({ where: { id: dto.machineId, ...factoryFilter } });
      if (!m) throw new BadRequestException('Machine not found');
      updateData.machineId = m.id;
    }
    if (dto.task) updateData.name = dto.task;
    if (dto.type) updateData.type = dto.type as any;
    if (dto.description !== undefined) updateData.description = dto.description || null;
    if (dto.instructions !== undefined) updateData.instructions = dto.instructions || null;
    if (dto.estimatedHours !== undefined) updateData.estimatedHours = dto.estimatedHours;
    if (dto.runtimeHours !== undefined) updateData.runtimeHours = dto.runtimeHours;

    const freqDays = this.resolveFreqDays(dto.frequency, dto.frequencyDays);
    if (freqDays) updateData.frequencyDays = freqDays;
    if (dto.nextDueAt) updateData.nextDueAt = new Date(dto.nextDueAt);

    return this.prisma.pMPlan.update({
      where: { id },
      data: updateData,
      include: { machine: { select: { name: true, code: true } } },
    });
  }

  async deletePreventiveSchedule(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const plan = await this.prisma.pMPlan.findFirst({ where: { id, ...factoryFilter } });
    if (!plan) throw new NotFoundException('PM plan not found');
    await this.prisma.pMPlan.delete({ where: { id } });
  }

  // ────────────────────────────────────────────────────────────
  // ASSETS (Machine-based)
  // ────────────────────────────────────────────────────────────

  async findAssets(factoryId: string | null, filters: { search?: string; page: number; limit: number; archived?: string }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const where: any = {
      ...factoryFilter,
      ...archivedWhere(filters.archived),
      isActive: true,
      ...(filters.search ? {
        OR: [
          { name: { contains: filters.search, mode: 'insensitive' as const } },
          { code: { contains: filters.search, mode: 'insensitive' as const } },
        ],
      } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.machine.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        include: {
          area: { select: { id: true, name: true, code: true } },
          line: { select: { id: true, name: true, code: true } },
          currentStatus: { select: { state: true } },
        },
      }),
      this.prisma.machine.count({ where }),
    ]);

    return {
      data: data.map(m => ({
        id: m.id,
        code: m.code,
        name: m.name,
        machineType: m.machineType,
        manufacturer: m.manufacturer,
        model: m.model,
        serialNumber: m.serialNumber,
        criticality: m.criticality,
        installDate: m.installDate?.toISOString() ?? null,
        warrantyExpiry: m.warrantyExpiry?.toISOString() ?? null,
        area: m.area ? { id: m.area.id, name: m.area.name, code: m.area.code } : null,
        line: m.line ? { id: m.line.id, name: m.line.name, code: m.line.code } : null,
        status: m.currentStatus?.state ?? 'OFFLINE',
        isActive: m.isActive,
        archivedAt: (m as any).archivedAt ?? null,
      })),
      total,
    };
  }

  async createAsset(factoryId: string | null, dto: {
    name: string; code: string; machineType?: string; manufacturer?: string;
    model?: string; serialNumber?: string; areaId?: string; lineId?: string;
    criticality?: string; installDate?: string; warrantyExpiry?: string;
  }) {
    const resolvedFactoryId = factoryId ?? await this.getDefaultFactoryId();
    const { MachineType, Criticality } = await import('@prisma/client');

    const machine = await this.prisma.machine.create({
      data: {
        factoryId: resolvedFactoryId,
        code: dto.code,
        name: dto.name,
        machineType: (MachineType[dto.machineType as keyof typeof MachineType] ?? MachineType.MACHINE),
        manufacturer: dto.manufacturer,
        model: dto.model,
        serialNumber: dto.serialNumber,
        areaId: dto.areaId || undefined,
        lineId: dto.lineId || undefined,
        criticality: (Criticality[dto.criticality as keyof typeof Criticality] ?? Criticality.MEDIUM),
        installDate: dto.installDate ? new Date(dto.installDate) : undefined,
        warrantyExpiry: dto.warrantyExpiry ? new Date(dto.warrantyExpiry) : undefined,
      },
      include: {
        area: { select: { id: true, name: true, code: true } },
        line: { select: { id: true, name: true, code: true } },
      },
    });
    return machine;
  }

  async updateAsset(factoryId: string | null, id: string, dto: {
    name?: string; machineType?: string; manufacturer?: string; model?: string;
    serialNumber?: string; areaId?: string; lineId?: string; criticality?: string;
    installDate?: string; warrantyExpiry?: string;
  }) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machine = await this.prisma.machine.findFirst({ where: { id, ...factoryFilter } });
    if (!machine) throw new NotFoundException('Asset not found');
    const { MachineType, Criticality } = await import('@prisma/client');

    return this.prisma.machine.update({
      where: { id },
      data: {
        ...(dto.name && { name: dto.name }),
        ...(dto.machineType && { machineType: MachineType[dto.machineType as keyof typeof MachineType] ?? MachineType.MACHINE }),
        ...(dto.manufacturer !== undefined && { manufacturer: dto.manufacturer }),
        ...(dto.model !== undefined && { model: dto.model }),
        ...(dto.serialNumber !== undefined && { serialNumber: dto.serialNumber }),
        ...(dto.areaId !== undefined && { areaId: dto.areaId || null }),
        ...(dto.lineId !== undefined && { lineId: dto.lineId || null }),
        ...(dto.criticality && { criticality: Criticality[dto.criticality as keyof typeof Criticality] ?? Criticality.MEDIUM }),
        ...(dto.installDate !== undefined && { installDate: dto.installDate ? new Date(dto.installDate) : null }),
        ...(dto.warrantyExpiry !== undefined && { warrantyExpiry: dto.warrantyExpiry ? new Date(dto.warrantyExpiry) : null }),
      },
      include: {
        area: { select: { id: true, name: true, code: true } },
        line: { select: { id: true, name: true, code: true } },
      },
    });
  }

  async deleteAsset(factoryId: string | null, id: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machine = await this.prisma.machine.findFirst({ where: { id, ...factoryFilter } });
    if (!machine) throw new NotFoundException('Asset not found');
    await this.prisma.machine.update({ where: { id }, data: { isActive: false } });
  }

  // ────────────────────────────────────────────────────────────
  // SPARE PARTS KPIs
  // ────────────────────────────────────────────────────────────

  async getSparePartsKPIs(factoryId: string | null) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const [total, allParts] = await Promise.all([
      this.prisma.sparePart.count({ where: factoryFilter }),
      this.prisma.sparePart.findMany({
        where: factoryFilter,
        select: { stockQty: true, minStockQty: true, unitCost: true },
      }),
    ]);

    const lowStock = allParts.filter(p => p.stockQty <= p.minStockQty).length;
    const totalValue = allParts.reduce((sum, p) => sum + (p.unitCost ?? 0) * p.stockQty, 0);

    return { total, lowStock, totalValue: parseFloat(totalValue.toFixed(2)) };
  }

  private async getDefaultFactoryId(): Promise<string> {
    const factory = await this.prisma.factory.findFirst({ where: { isActive: true } });
    if (!factory) throw new BadRequestException('No active factory found');
    return factory.id;
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE
  // ────────────────────────────────────────────────────────────

  private async assertTransition(
    factoryId: string | null,
    id: string,
    targetStatus: MaintStatus,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const wo = await this.prisma.maintenanceWO.findFirst({
      where: { id, ...factoryFilter, deletedAt: null },
    });
    if (!wo) throw new NotFoundException('Work order not found');

    const allowed = VALID_MAINT_TRANSITIONS[wo.status];
    if (!allowed.includes(targetStatus)) {
      throw new BadRequestException(
        `Cannot transition from ${wo.status} to ${targetStatus}. Allowed: [${allowed.join(', ')}]`,
      );
    }
    return wo;
  }

  private async generateWONumber(factoryId: string): Promise<string> {
    const today = new Date();
    const prefix = `MWO-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;

    const last = await this.prisma.maintenanceWO.findFirst({
      where: { factoryId, woNumber: { startsWith: prefix } },
      orderBy: { woNumber: 'desc' },
    });

    const seq = last ? parseInt(last.woNumber.slice(-4), 10) + 1 : 1;
    return `${prefix}-${String(seq).padStart(4, '0')}`;
  }
}
