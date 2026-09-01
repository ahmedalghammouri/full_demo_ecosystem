import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';
import { findProcessForSku } from '../../common/process-scope.util';
import { currentShiftStart } from '../../common/shift-window.util';
import type { Prisma } from '@prisma/client';
import { DowntimeCategory } from '@prisma/client';
import type {
  CreateDowntimeEventDto, UpdateDowntimeEventDto, EndDowntimeEventDto,
} from './dto/downtime.dto';
import { ReliabilityService } from '../reliability/reliability.service';

// ── Constants ─────────────────────────────────────────────────

const DOWNTIME_THRESHOLD_SECONDS = 60; // plant requirement

// Reason codes that do NOT count against OEE Availability
const OEE_EXCLUDED_REASON_CODES = new Set(['PLANNED_MAINTENANCE', 'EXTERNAL']);

// Reason codes that ARE Planned Stops (reduce net planned time, not OEE)
const PLANNED_STOP_CODES = new Set(['PLANNED_MAINTENANCE', 'CHANGEOVER']);

@Injectable()
export class DowntimeService {
  private readonly logger = new Logger(DowntimeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly reliability: ReliabilityService,
  ) {}

  // ── Create ───────────────────────────────────────────────────

  async createDowntimeEvent(factoryId: string | null, userId: string, dto: CreateDowntimeEventDto) {
    const factoryFilter = factoryId ? { factoryId } : {};

    let machine: { id: string; factoryId: string; name: string; code: string } | null = null;
    if (dto.machineId) {
      machine = await this.prisma.machine.findFirst({
        where: { id: dto.machineId, ...factoryFilter },
        select: { id: true, factoryId: true, name: true, code: true },
      });
      if (!machine) throw new NotFoundException('Machine not found');

      const existing = await this.prisma.downtimeEvent.findFirst({
        where: { machineId: dto.machineId, endTime: null },
      });
      if (existing) {
        throw new BadRequestException(
          `Machine already has an open downtime event (started ${existing.startTime.toISOString()}).`,
        );
      }

      // Auto-link to active work order if caller didn't specify one
      if (!dto.workOrderId) {
        const activeWO = await this.prisma.workOrder.findFirst({
          where: { status: 'IN_PROGRESS', jobOrders: { some: { machineId: dto.machineId } } },
          select: { id: true },
        });
        if (activeWO) (dto as any).workOrderId = activeWO.id;
      }
    }

    const resolvedFactoryId = factoryId ?? machine?.factoryId ?? (await this.getDefaultFactoryId());
    const startTime = dto.startTime ? new Date(dto.startTime) : new Date();
    const endTime = dto.endTime ? new Date(dto.endTime) : undefined;
    const durationMinutes = endTime
      ? (endTime.getTime() - startTime.getTime()) / 60_000
      : undefined;

    // When the operator picks a specific the pilot site reason, inherit its category +
    // planned flag so the stop is classified (and counted against OEE) correctly.
    let cause: { category: DowntimeCategory; isPlanned: boolean; name: string } | null = null;
    if (dto.causeId) {
      cause = await this.prisma.downtimeCause.findUnique({
        where: { id: dto.causeId },
        select: { category: true, isPlanned: true, name: true },
      });
    }

    const category = (dto.category as DowntimeCategory) ?? cause?.category ?? DowntimeCategory.OTHER;
    const reasonCode = (dto as any).reasonCode
      ?? (cause?.isPlanned ? 'PLANNED_MAINTENANCE' : 'UNPLANNED_BREAKDOWN');
    const affectsOEE = !OEE_EXCLUDED_REASON_CODES.has(reasonCode);
    const isPlanned = dto.isPlanned ?? cause?.isPlanned ?? PLANNED_STOP_CODES.has(reasonCode);

    const event = await this.prisma.downtimeEvent.create({
      data: {
        factoryId: resolvedFactoryId,
        ...(dto.machineId && { machineId: dto.machineId }),
        workCenterId: (dto as any).workCenterId ?? null,
        workOrderId: dto.workOrderId,
        causeId: dto.causeId,
        operatorId: (dto as any).operatorId ?? null,
        reason: (dto as any).description ?? (dto as any).reason ?? cause?.name,
        category,
        reasonCode: reasonCode as any,
        startTime,
        endTime,
        durationMinutes,
        affectsOEE,
        isPlanned,
        reportedById: userId,
        notes: dto.notes,
      } as any,
      include: {
        machine: { select: { name: true, code: true } },
        cause: { select: { code: true, name: true, category: true } },
        workCenter: { select: { id: true, code: true, name: true, level: true } },
      },
    });

    if (dto.machineId) {
      await this.updateMachineStateForDowntime(dto.machineId, isPlanned);
    }

    this.eventEmitter.emit('downtime.event.created', {
      event,
      factoryId: resolvedFactoryId,
      machineName: machine?.name,
      reasonCode,
      affectsOEE,
    });

    this.logger.log(`Downtime event created${machine ? ` for machine ${machine.code}` : ''}: ${reasonCode}`);
    return event;
  }

  // ── End ──────────────────────────────────────────────────────

  async endDowntimeEvent(factoryId: string | null, eventId: string, userId: string, dto: EndDowntimeEventDto) {
    const factoryFilter = factoryId ? { factoryId } : {};

    const event = await this.prisma.downtimeEvent.findFirst({
      where: { id: eventId, ...factoryFilter },
      include: { machine: { select: { name: true, code: true, lineId: true } } },
    });
    if (!event) throw new NotFoundException('Downtime event not found');
    if (event.endTime) throw new BadRequestException('Downtime event already ended');

    // Use server time if no endTime provided or if client clock is behind server (Docker clock skew)
    const requestedEnd = dto.endTime ? new Date(dto.endTime) : new Date();
    const endTime = requestedEnd <= event.startTime ? new Date() : requestedEnd;

    const durationMinutes = (endTime.getTime() - event.startTime.getTime()) / 60_000;

    const updated = await this.prisma.downtimeEvent.update({
      where: { id: eventId },
      data: {
        endTime,
        durationMinutes,
        ...(dto.causeId && { causeId: dto.causeId }),
        ...(dto.resolution && { notes: dto.resolution }),
      } as any,
      include: {
        machine: { select: { name: true, code: true } },
        cause: { select: { code: true, name: true } },
        workCenter: { select: { id: true, code: true, name: true } },
      },
    });

    // Restore machine state — the active WO on this machine is the one with a
    // job order routed here (WOs have no header machine).
    const activeWO = await this.prisma.workOrder.findFirst({
      where: { status: 'IN_PROGRESS', jobOrders: { some: { machineId: event.machineId } } },
    });
    await this.prisma.machineCurrentStatus.upsert({
      where: { machineId: event.machineId },
      create: { machineId: event.machineId, state: activeWO ? 'RUNNING' : 'IDLE', currentWOId: activeWO?.id ?? null },
      update: { state: activeWO ? 'RUNNING' : 'IDLE', lastEventAt: new Date() },
    });

    // Accumulate WO downtime
    if (event.workOrderId) {
      await this.prisma.workOrder.update({
        where: { id: event.workOrderId },
        data: { downtimeMinutes: { increment: durationMinutes } },
      });
    }

    // Compute and store scheduling impact on dependent routing steps
    if (event.workOrderId && (event as any).reasonCode !== 'MICRO_STOP') {
      const impact = await this.computeSchedulingImpact(
        event.workOrderId,
        (event as any).workCenterId,
        durationMinutes,
      );
      if (impact > 0) {
        await this.prisma.downtimeEvent.update({
          where: { id: eventId },
          data: { schedulingImpactMins: impact } as any,
        });
      }
    }

    this.eventEmitter.emit('downtime.event.ended', {
      eventId,
      machineId: event.machineId,
      factoryId: event.factoryId,
      durationMinutes,
    });

    this.logger.log(`Downtime ended for machine ${event.machine.code}: ${durationMinutes.toFixed(1)} min`);
    return updated;
  }

  // ── Delete ───────────────────────────────────────────────────

  async deleteDowntimeEvent(factoryId: string | null, eventId: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const event = await this.prisma.downtimeEvent.findFirst({
      where: { id: eventId, ...factoryFilter },
    });
    if (!event) throw new NotFoundException('Downtime event not found');
    await this.prisma.downtimeEvent.delete({ where: { id: eventId } });
    this.logger.log(`Downtime event ${eventId} deleted`);
  }

  // ── Scheduling Impact (FS/SS/SF/FF cascade) ──────────────────

  /**
   * When a downtime event closes on workCenterId X, find all active routing steps
   * at that WorkCenter and forward-propagate the delay through their successors.
   *
   * Logic by dependency type:
   *  FS (Finish-to-Start): successor start delayed by full downtime duration
   *  SS (Start-to-Start):  successor already started → logs a STARVED/BLOCKED risk
   *  SF/FF:                successor finish deadline pushed forward by downtime duration
   *
   * Returns the maximum cascade delay in minutes (used for dashboard alerting).
   */
  async computeSchedulingImpact(
    workOrderId: string,
    workCenterId: string | null,
    downtimeMins: number,
  ): Promise<number> {
    if (!workCenterId || downtimeMins < 1) return 0;

    try {
      // Find routing steps at this WorkCenter for the active WO's process.
      // Resolution goes through the canonical scope chain so CATEGORY /
      // BASE_WEIGHT / PRODUCT_LIST scoped routings cascade too — never only
      // the legacy direct sku.manufacturingProcesses relation.
      const wo = await this.prisma.workOrder.findUnique({
        where: { id: workOrderId },
        select: { skuId: true, factoryId: true },
      });
      if (!wo?.skuId) return 0;

      const process = await findProcessForSku<any>(this.prisma, wo.factoryId, wo.skuId, {
        routingSteps: { include: { successors: true } },
      });
      if (!process) return 0;

      const affectedSteps = process.routingSteps.filter(
        (s: any) => s.workCenterId === workCenterId,
      );

      let maxCascade = 0;
      for (const step of affectedSteps) {
        for (const dep of (step as any).successors) {
          let cascadeDelay = 0;
          if (dep.type === 'FINISH_TO_START' || dep.type === 'FINISH_TO_FINISH') {
            cascadeDelay = downtimeMins + (dep.lagMins ?? 0);
          } else if (dep.type === 'START_TO_START') {
            // If successor already started, the downtime creates a STARVED condition
            cascadeDelay = Math.max(0, downtimeMins - (dep.lagMins ?? 0));
          } else {
            cascadeDelay = downtimeMins;
          }
          maxCascade = Math.max(maxCascade, cascadeDelay);
        }
      }

      if (maxCascade > 0) {
        this.logger.warn(
          `Downtime cascade: WO ${workOrderId} → ${maxCascade.toFixed(1)} min delay on dependent steps`,
        );
        // Emit event so scheduling service / dashboard can pick it up
        this.eventEmitter.emit('downtime.scheduling.impact', {
          workOrderId,
          workCenterId,
          downtimeMins,
          cascadeDelayMins: maxCascade,
        });
      }
      return maxCascade;
    } catch (err) {
      this.logger.error('Failed to compute scheduling impact', err);
      return 0;
    }
  }

  // ── OEE Loss Breakdown ────────────────────────────────────────

  /**
   * Returns a waterfall breakdown of OEE losses for a given time window.
   * Used to populate the Six Big Losses / Waterfall chart.
   *
   * Returns:
   *  - plannedStopMins   (PLANNED_MAINTENANCE + CHANGEOVER — excluded from OEE)
   *  - availabilityLoss  (UNPLANNED_BREAKDOWN — reduces availability)
   *  - speedLoss         (MICRO_STOP, STARVED, BLOCKED — reduces performance)
   *  - externalLoss      (EXTERNAL — informational)
   *  - oeeAvailability   (computed %)
   */
  async getOEELossBreakdown(factoryId: string | null, dateFrom: Date, dateTo: Date, machineId?: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machineFilter = machineId ? { machineId } : {};

    const events = await this.prisma.downtimeEvent.findMany({
      where: {
        ...factoryFilter,
        ...machineFilter,
        startTime: { gte: dateFrom },
        OR: [{ endTime: { lte: dateTo } }, { endTime: null }],
      },
      select: {
        durationMinutes: true,
        reasonCode: true,
        affectsOEE: true,
        isPlanned: true,
        machine: { select: { name: true, code: true } },
      },
    });

    const breakdown = {
      plannedStopMins: 0,
      availabilityLossMins: 0,
      speedLossMins: 0,
      externalLossMins: 0,
      totalDowntimeMins: 0,
      eventCount: events.length,
      byReasonCode: {} as Record<string, number>,
    };

    for (const e of events) {
      const mins = e.durationMinutes ?? 0;
      const rc = (e as any).reasonCode ?? 'UNPLANNED_BREAKDOWN';
      breakdown.totalDowntimeMins += mins;
      breakdown.byReasonCode[rc] = (breakdown.byReasonCode[rc] ?? 0) + mins;

      if (rc === 'PLANNED_MAINTENANCE' || rc === 'CHANGEOVER') {
        breakdown.plannedStopMins += mins;
      } else if (rc === 'UNPLANNED_BREAKDOWN') {
        breakdown.availabilityLossMins += mins;
      } else if (rc === 'MICRO_STOP' || rc === 'STARVED' || rc === 'BLOCKED') {
        breakdown.speedLossMins += mins;
      } else if (rc === 'EXTERNAL') {
        breakdown.externalLossMins += mins;
      }
    }

    return breakdown;
  }

  // ── Acknowledge ───────────────────────────────────────────────

  async acknowledgeDowntimeEvent(factoryId: string | null, eventId: string, userId: string, notes?: string) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const event = await this.prisma.downtimeEvent.findFirst({ where: { id: eventId, ...factoryFilter } });
    if (!event) throw new NotFoundException('Downtime event not found');

    return this.prisma.downtimeEvent.update({
      where: { id: eventId },
      data: {
        acknowledged: true,
        acknowledgedById: userId,
        acknowledgedAt: new Date(),
        ...(notes && { notes }),
      },
    });
  }

  async updateDowntimeEvent(factoryId: string | null, eventId: string, dto: UpdateDowntimeEventDto) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const event = await this.prisma.downtimeEvent.findFirst({ where: { id: eventId, ...factoryFilter } });
    if (!event) throw new NotFoundException('Downtime event not found');

    const endTime = dto.endTime ? new Date(dto.endTime) : undefined;
    const durationMinutes = endTime
      ? (endTime.getTime() - event.startTime.getTime()) / 60_000
      : undefined;

    return this.prisma.downtimeEvent.update({
      where: { id: eventId },
      data: {
        ...(dto.causeId !== undefined && { causeId: dto.causeId }),
        ...(dto.reason !== undefined && { reason: dto.reason }),
        ...(dto.category && { category: dto.category as DowntimeCategory }),
        ...(endTime && { endTime, durationMinutes }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
      } as any,
      include: {
        machine: { select: { name: true, code: true } },
        cause: { select: { code: true, name: true } },
      },
    });
  }

  // ── List ──────────────────────────────────────────────────────

  async findDowntimeEvents(factoryId: string | null, filters: {
    machineId?: string;
    workCenterId?: string;
    workOrderId?: string;
    reasonCode?: string;
    isPlanned?: boolean;
    isOpen?: boolean;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) {
    const { machineId, workCenterId, workOrderId, reasonCode, isPlanned, isOpen, dateFrom, dateTo, page = 1, limit = 20 } = filters;
    const factoryFilter = factoryId ? { factoryId } : {};

    const where: any = {
      ...factoryFilter,
      ...(machineId && { machineId }),
      ...(workCenterId && { workCenterId }),
      ...(workOrderId && { workOrderId }),
      ...(reasonCode && { reasonCode }),
      ...(isPlanned !== undefined && { isPlanned }),
      ...(isOpen === true && { endTime: null }),
      ...(isOpen === false && { endTime: { not: null } }),
      ...(dateFrom && { startTime: { gte: new Date(dateFrom) } }),
      ...(dateTo && { startTime: { lte: new Date(dateTo) } }),
    };

    const [total, data] = await Promise.all([
      this.prisma.downtimeEvent.count({ where }),
      this.prisma.downtimeEvent.findMany({
        where,
        include: {
          machine: { select: { id: true, name: true, code: true } },
          cause: {
            select: {
              id: true, code: true, name: true, category: true, level: true,
              parent: { select: { name: true, parent: { select: { name: true } } } },
            },
          },
          workCenter: { select: { id: true, code: true, name: true } },
          workOrder: { select: { id: true, orderNumber: true, status: true } },
          operator: { select: { id: true, name: true } },
        },
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map((e: any) => ({
        id: e.id,
        machineId: e.machineId,
        machine: e.machine ? { id: e.machine.id, name: e.machine.name, code: e.machine.code } : null,
        workCenter: e.workCenter ? { id: e.workCenter.id, code: e.workCenter.code, name: e.workCenter.name } : null,
        workOrder: e.workOrder ? { id: e.workOrder.id, orderNumber: e.workOrder.orderNumber, status: e.workOrder.status } : null,
        operator: e.operator ? { id: e.operator.id, name: e.operator.name } : null,
        cause: e.cause ? {
          id: e.cause.id,
          code: e.cause.code,
          name: e.cause.name,
          level: e.cause.level,
          parent: e.cause.parent,
        } : null,
        category: e.category,
        reasonCode: e.reasonCode,
        reason: e.reason,
        startTime: e.startTime.toISOString(),
        endTime: e.endTime?.toISOString() ?? null,
        durationMinutes: e.durationMinutes,
        affectsOEE: e.affectsOEE,
        isPlanned: e.isPlanned,
        isOpen: !e.endTime,
        acknowledged: e.acknowledged,
        schedulingImpactMins: e.schedulingImpactMins,
        notes: e.notes,
      })),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ── Causes ────────────────────────────────────────────────────

  async findDowntimeCauses(factoryId: string | null, machineId?: string) {
    const fId = factoryId ?? await this.getDefaultFactoryId();
    // Make sure the the pilot site reasons are organised into the tree before listing.
    await this.ensureReasonHierarchy(fId).catch(() => undefined);
    // Operators pick LEAF reasons (specific causes) — never the category/machine
    // grouping nodes. A leaf is any active cause with no children.
    return this.prisma.downtimeCause.findMany({
      where: {
        factoryId: fId,
        isActive: true,
        children: { none: {} },
        OR: [{ machineId: machineId ?? null }, { machineId: null }],
      },
      include: { parent: { select: { name: true, parent: { select: { name: true } } } } },
      orderBy: [{ isPlanned: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  // ── Auto-detection ────────────────────────────────────────────

  async detectAndCreateAutoDowntime(factoryId: string) {
    const thresholdMs = DOWNTIME_THRESHOLD_SECONDS * 1000;
    const cutoff = new Date(Date.now() - thresholdMs);

    const idleMachines = await this.prisma.machineCurrentStatus.findMany({
      where: {
        machine: { factoryId, isActive: true },
        state: 'IDLE',
        lastEventAt: { lt: cutoff },
        currentWOId: { not: null },
      },
      include: { machine: { select: { id: true, code: true, name: true, factoryId: true } } },
    });

    for (const status of idleMachines) {
      const existing = await this.prisma.downtimeEvent.findFirst({
        where: { machineId: status.machineId, endTime: null },
      });
      if (existing) continue;

      try {
        await this.prisma.downtimeEvent.create({
          data: {
            factoryId: status.machine.factoryId,
            machineId: status.machineId,
            workOrderId: status.currentWOId,
            category: 'OTHER',
            reasonCode: 'MICRO_STOP',
            reason: `Auto-detected: machine idle > ${DOWNTIME_THRESHOLD_SECONDS}s`,
            startTime: status.lastEventAt ?? new Date(),
            isPlanned: false,
            affectsOEE: true,
          } as any,
        });
        this.eventEmitter.emit('downtime.auto.created', {
          machineId: status.machineId,
          machineName: status.machine.name,
          factoryId: status.machine.factoryId,
        });
      } catch (err) {
        this.logger.error(`Failed to auto-create downtime for machine ${status.machine.code}`, err);
      }
    }
  }

  // ── Summary (legacy + enhanced) ───────────────────────────────

  /** Resolve an analysis scope (area/line/machine) to a downtime where-fragment. */
  private async scopeWhere(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ): Promise<Record<string, unknown>> {
    if (!scope || (!scope.areaId && !scope.lineId && !scope.machineId)) return {};
    if (scope.machineId) return { machineId: scope.machineId };
    const ms = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(scope.lineId ? { lineId: scope.lineId } : {}),
        ...(scope.areaId ? { line: { areaId: scope.areaId } } : {}),
      },
      select: { id: true },
    });
    return { machineId: { in: ms.map((m) => m.id) } };
  }

  async getDowntimeSummary(
    factoryId: string | null,
    dateFrom: Date,
    dateTo: Date,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const scopeFilter = await this.scopeWhere(factoryId, scope);

    const events = await this.prisma.downtimeEvent.findMany({
      where: {
        ...factoryFilter,
        ...scopeFilter,
        startTime: { gte: dateFrom },
        endTime: { lte: dateTo },
      },
      include: {
        machine: { select: { name: true, code: true } },
        cause: { select: { code: true, name: true, category: true } },
      },
    });

    const byCategory: Record<string, number> = {};
    const byReasonCode: Record<string, number> = {};
    const byMachine: Record<string, number> = {};
    let totalMinutes = 0;
    let oeeImpactMinutes = 0;

    for (const e of events) {
      const min = e.durationMinutes ?? 0;
      totalMinutes += min;
      byCategory[e.category] = (byCategory[e.category] ?? 0) + min;
      byMachine[e.machine.name] = (byMachine[e.machine.name] ?? 0) + min;
      const rc = (e as any).reasonCode ?? 'UNPLANNED_BREAKDOWN';
      byReasonCode[rc] = (byReasonCode[rc] ?? 0) + min;
      if ((e as any).affectsOEE !== false) oeeImpactMinutes += min;
    }

    return {
      totalEvents: events.length,
      totalMinutes,
      oeeImpactMinutes,
      plannedMinutes: totalMinutes - oeeImpactMinutes,
      byCategory,
      byReasonCode,
      byMachine,
      topCauses: Object.entries(byReasonCode).sort(([, a], [, b]) => b - a).slice(0, 5),
    };
  }

  /**
   * Rich, real-data aggregation powering the Downtime Command Center dashboard:
   * headline KPIs (total/planned/unplanned/OEE-impact minutes, open events, MTTR/MTBF,
   * availability loss), a planned-vs-unplanned time trend, downtime by machine, a
   * category Pareto, the top root causes, currently-open stops and a recent log.
   * Scope- and window-aware like every other KPI surface.
   */
  async getDowntimeCockpit(
    factoryId: string | null,
    scope: { areaId?: string; lineId?: string; machineId?: string } | undefined,
    dateFrom: Date,
    dateTo: Date,
    timeframe?: string,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const scopeFilter = await this.scopeWhere(factoryId, scope);
    const now = new Date();
    // Real current-shift window when requested (start → now), else the given range.
    if ((timeframe ?? '').toLowerCase() === 'shift') {
      const ss = await currentShiftStart(this.prisma, factoryId);
      if (ss) { dateFrom = ss; dateTo = now; }
    }

    const events = await this.prisma.downtimeEvent.findMany({
      where: {
        ...factoryFilter,
        ...scopeFilter,
        startTime: { lte: dateTo },
        OR: [{ endTime: null }, { endTime: { gte: dateFrom } }],
      },
      include: {
        machine: { select: { name: true, code: true } },
        cause: { select: { code: true, name: true, category: true } },
      },
      orderBy: { startTime: 'desc' },
    });

    // Planned/failure classification comes from the canonical reliability engine so this
    // cockpit, the Maintenance cockpit and the Analytics reports share one rule set.
    const planned = (e: any) => this.reliability.isPlannedStop(e);
    const clampMin = (e: any) => {
      const s = Math.max(new Date(e.startTime).getTime(), dateFrom.getTime());
      const en = Math.min((e.endTime ? new Date(e.endTime) : now).getTime(), dateTo.getTime());
      return Math.max(0, (en - s) / 60_000);
    };
    const r1 = (n: number) => Math.round(n * 10) / 10;

    let totalMin = 0, plannedMin = 0, unplannedMin = 0, oeeImpactMin = 0, unplannedStops = 0;
    const byMachine = new Map<string, number>();
    const byCategory = new Map<string, number>();
    const byCause = new Map<string, { minutes: number; count: number }>();
    const trendMap = new Map<string, { planned: number; unplanned: number }>();
    const dayMs = 86_400_000;
    const hourly = (dateTo.getTime() - dateFrom.getTime()) <= dayMs * 1.5;
    const bucketKey = (d: Date) => hourly
      ? `${String(d.getHours()).padStart(2, '0')}:00`
      : `${d.getMonth() + 1}/${d.getDate()}`;

    for (const e of events as any[]) {
      const min = clampMin(e);
      if (min <= 0 && e.endTime) continue;
      const isP = planned(e);
      totalMin += min;
      if (isP) plannedMin += min;
      else { unplannedMin += min; unplannedStops += 1; }
      if (e.affectsOEE !== false && !isP) oeeImpactMin += min;
      byMachine.set(e.machine.name, (byMachine.get(e.machine.name) ?? 0) + min);
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + min);
      const causeLabel = e.cause?.name ?? e.reason ?? e.reasonCode ?? 'Unspecified';
      const c = byCause.get(causeLabel) ?? { minutes: 0, count: 0 };
      c.minutes += min; c.count += 1; byCause.set(causeLabel, c);
      const k = bucketKey(new Date(Math.max(new Date(e.startTime).getTime(), dateFrom.getTime())));
      const tb = trendMap.get(k) ?? { planned: 0, unplanned: 0 };
      if (isP) tb.planned += min; else tb.unplanned += min;
      trendMap.set(k, tb);
    }

    // MTTR/MTBF come from the canonical engine (equipment lens): breakdown stops only —
    // micro-stops, starved/blocked, material, operator and quality stops are unplanned
    // losses but not asset failures, and counting them here is what previously drove the
    // Downtime Command Center apart from the Maintenance Reports.
    const rel = await this.reliability.equipmentReliability(factoryId, scope, dateFrom, dateTo);
    const { mttrHours, mtbfHours, capacityHours, machineCount } = rel;

    const liveOpen = (events as any[]).filter((e) => !e.endTime).map((e) => ({
      machine: e.machine.name, code: e.machine.code,
      reason: e.cause?.name ?? e.reason ?? e.reasonCode ?? 'Unspecified', category: e.category,
      startedAt: e.startTime, elapsedMin: r1((now.getTime() - new Date(e.startTime).getTime()) / 60_000),
      planned: planned(e),
    }));

    const recent = (events as any[]).slice(0, 12).map((e) => ({
      machine: e.machine.name,
      reason: e.cause?.name ?? e.reason ?? e.reasonCode ?? 'Unspecified', category: e.category,
      start: e.startTime, end: e.endTime, durationMin: r1(e.durationMinutes ?? clampMin(e)),
      planned: planned(e), oeeImpact: e.affectsOEE !== false && !planned(e),
    }));

    const sortedCat = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
    const catTotal = sortedCat.reduce((s, [, m]) => s + m, 0) || 1;
    let cum = 0;
    const byCategoryPareto = sortedCat.map(([category, minutes]) => {
      cum += minutes;
      return { category, minutes: r1(minutes), cumulativePct: r1((cum / catTotal) * 100) };
    });

    return {
      scope: scope ?? null,
      generatedAt: now,
      kpis: {
        totalEvents: events.length,
        totalDowntimeMin: r1(totalMin),
        plannedMin: r1(plannedMin),
        unplannedMin: r1(unplannedMin),
        oeeImpactMin: r1(oeeImpactMin),
        openEvents: liveOpen.length,
        mttrHours, mtbfHours,
        // Reliability basis, exposed so the cockpit figure can be reconciled against the
        // Maintenance Reports without guessing what went into it.
        breakdownStops: rel.failures,
        unplannedStops,
        machineCount,
        capacityHours,
        uptimeHours: rel.uptimeHours,
        availabilityLossPct: capacityHours > 0 ? r1((oeeImpactMin / 60 / capacityHours) * 100) : 0,
      },
      reliabilityBasis: { lens: 'equipment', ...rel },
      trend: [...trendMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))
        .map(([date, v]) => ({ date, planned: r1(v.planned), unplanned: r1(v.unplanned) })),
      byMachine: [...byMachine.entries()].map(([name, minutes]) => ({ name, minutes: r1(minutes) }))
        .sort((a, b) => b.minutes - a.minutes),
      byCategory: byCategoryPareto,
      topCauses: [...byCause.entries()].map(([reason, v]) => ({ reason, minutes: r1(v.minutes), count: v.count }))
        .sort((a, b) => b.minutes - a.minutes).slice(0, 8),
      plannedVsUnplanned: { planned: r1(plannedMin), unplanned: r1(unplannedMin) },
      liveOpen,
      recent,
    };
  }

  // ── Reason Tree (3-Level) ─────────────────────────────────────

  /**
   * Self-healing 3-level reason hierarchy (plant standard). The seed loads reasons
   * as flat level-3 leaves, so the tree would be empty. This idempotently builds
   * the grouping parents and re-parents the leaves:
   *   • PLANNED categories (cleaning / break / changeover / planned maintenance)
   *     → ONE "Planned Downtime" L1  →  the category as L2  →  the reason (L3)
   *   • everything else (mechanical / electrical / material / …)
   *     → the category as L1  →  the machine as L2  →  the reason (L3)
   * Synthetic grouping nodes use `L1-`/`L2-` codes; leaves keep their the pilot site codes.
   */
  private async ensureReasonHierarchy(factoryId: string) {
    const PLANNED = new Set(['PLANNED_CLEANING', 'PLANNED_BREAK', 'CHANGEOVER', 'PLANNED_MAINTENANCE']);
    // Old per-category planned L1s created by the previous version — migrate away.
    const OLD_PLANNED_L1 = [...PLANNED].map((c) => `L1-${c}`);

    const needsWork = await this.prisma.downtimeCause.count({
      where: {
        factoryId,
        OR: [
          { level: 3, parentId: null },          // fresh, unparented leaves
          { code: { in: OLD_PLANNED_L1 } },      // old structure → restructure
        ],
      },
    });
    if (!needsWork) return;

    const machines = await this.prisma.machine.findMany({
      where: { factoryId }, select: { id: true, code: true, name: true },
    });
    const machineMap = new Map(machines.map((m) => [m.id, m]));
    const title = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const cache = new Map<string, string>();
    let sort = 0;
    const node = async (
      code: string, name: string, level: number, category: string,
      parentId: string | null, machineId: string | null, isPlanned: boolean,
    ): Promise<string> => {
      if (cache.has(code)) return cache.get(code)!;
      const existing = await this.prisma.downtimeCause.findFirst({ where: { factoryId, code } });
      const id = existing
        ? (await this.prisma.downtimeCause.update({ where: { id: existing.id }, data: { name, level, parentId, isActive: true } })).id
        : (await this.prisma.downtimeCause.create({
            data: { factoryId, code, name, category: category as DowntimeCategory, level, parentId, machineId, isPlanned, sortOrder: sort++, isActive: true },
          })).id;
      cache.set(code, id);
      return id;
    };

    // Real reason leaves = causes that are not synthetic grouping nodes.
    const reasons = await this.prisma.downtimeCause.findMany({
      where: { factoryId, NOT: { OR: [{ code: { startsWith: 'L1-' } }, { code: { startsWith: 'L2-' } }] } },
    });

    for (const r of reasons) {
      const cat = r.category as string;
      let parentId: string;
      if (PLANNED.has(cat)) {
        const l1 = await node('L1-PLANNED', 'Planned Downtime', 1, 'PLANNED_MAINTENANCE', null, null, true);
        parentId = await node(`L2-PLANNED-${cat}`, title(cat), 2, cat, l1, null, true);
      } else {
        const l1 = await node(`L1-${cat}`, title(cat), 1, cat, null, null, false);
        const m = r.machineId ? machineMap.get(r.machineId) : null;
        const mCode = m?.code ?? 'GEN';
        const mName = m ? `${m.name} (${m.code})` : 'General';
        parentId = await node(`L2-${cat}-${mCode}`, mName, 2, cat, l1, r.machineId ?? null, false);
      }
      if (r.parentId !== parentId || r.level !== 3) {
        await this.prisma.downtimeCause.update({ where: { id: r.id }, data: { parentId, level: 3 } });
      }
    }

    // Drop synthetic grouping nodes that no longer have children (e.g. the old
    // per-category planned L1s and their General L2s). Two passes: L2s, then L1s.
    for (let pass = 0; pass < 2; pass++) {
      const childless = await this.prisma.downtimeCause.findMany({
        where: {
          factoryId,
          OR: [{ code: { startsWith: 'L1-' } }, { code: { startsWith: 'L2-' } }],
          children: { none: {} },
        },
        select: { id: true },
      });
      if (!childless.length) break;
      await this.prisma.downtimeCause.deleteMany({ where: { id: { in: childless.map((c) => c.id) } } });
    }
    this.logger.log(`Reconciled downtime reason hierarchy for factory ${factoryId} (${reasons.length} reasons).`);
  }

  async getReasonTree(factoryId: string | null) {
    const fId = factoryId ?? await this.getDefaultFactoryId();
    await this.ensureReasonHierarchy(fId);
    const roots = await this.prisma.downtimeCause.findMany({
      where: { factoryId: fId, level: 1, parentId: null },
      orderBy: { sortOrder: 'asc' },
      include: {
        children: {
          orderBy: { sortOrder: 'asc' },
          include: {
            children: {
              orderBy: { sortOrder: 'asc' },
              include: { machine: { select: { id: true, name: true, code: true } } },
            },
          },
        },
      },
    });
    return roots;
  }

  async createReasonNode(factoryId: string, dto: {
    code: string; name: string; nameAr?: string;
    category: DowntimeCategory; level: number; parentId?: string;
    machineId?: string; isPlanned?: boolean; sortOrder?: number;
  }) {
    if (dto.parentId) {
      const parent = await this.prisma.downtimeCause.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('Parent reason not found');
      if (parent.level !== dto.level - 1) {
        throw new BadRequestException(`Parent is level ${parent.level}; child must be level ${parent.level + 1}`);
      }
    }
    return this.prisma.downtimeCause.create({
      data: { factoryId, ...dto, isActive: true },
    });
  }

  async updateReasonNode(factoryId: string, id: string, dto: Partial<{
    name: string; nameAr: string; category: DowntimeCategory;
    machineId: string | null; isPlanned: boolean; sortOrder: number; isActive: boolean;
  }>) {
    const node = await this.prisma.downtimeCause.findFirst({ where: { id, factoryId } });
    if (!node) throw new NotFoundException('Reason node not found');
    return this.prisma.downtimeCause.update({ where: { id }, data: dto });
  }

  async deleteReasonNode(factoryId: string, id: string) {
    const node = await this.prisma.downtimeCause.findFirst({
      where: { id, factoryId },
      include: { _count: { select: { downtimeEvents: true, children: true } } },
    });
    if (!node) throw new NotFoundException('Reason node not found');
    if ((node as any)._count.downtimeEvents > 0) {
      throw new BadRequestException('Cannot delete: reason is used in existing downtime events. Deactivate it instead.');
    }
    if ((node as any)._count.children > 0) {
      throw new BadRequestException('Cannot delete: reason has child nodes. Remove children first.');
    }
    await this.prisma.downtimeCause.delete({ where: { id } });
  }

  // ── Private ───────────────────────────────────────────────────

  private async getDefaultFactoryId(): Promise<string> {
    const factory = await this.prisma.factory.findFirst({ where: { isActive: true }, select: { id: true } });
    if (!factory) throw new NotFoundException('No active factory found');
    return factory.id;
  }

  private async updateMachineStateForDowntime(machineId: string, isPlanned: boolean) {
    try {
      const newState = isPlanned ? 'PLANNED_STOP' : 'BREAKDOWN';
      await this.prisma.machineCurrentStatus.upsert({
        where: { machineId },
        create: { machineId, state: newState },
        update: { state: newState, lastEventAt: new Date() },
      });
    } catch (err) {
      this.logger.error('Failed to update machine state for downtime', err);
    }
  }

  // ── Operator machine-state change (shop floor) ────────────────
  // One smart action: updates MachineCurrentStatus, closes/opens the
  // MachineStateRecord timeline, opens/closes the matching DowntimeEvent,
  // and optionally pauses/resumes the linked job order.

  async setMachineState(
    factoryId: string | null,
    userId: string,
    machineId: string,
    dto: {
      state: string;
      downtimeCauseId?: string;
      reasonCode?: string;
      category?: string;
      reason?: string;
      notes?: string;
      jobOrderId?: string;
      workOrderId?: string;
    },
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machine = await this.prisma.machine.findFirst({
      where: { id: machineId, ...factoryFilter },
      select: { id: true, factoryId: true, name: true, code: true },
    });
    if (!machine) throw new NotFoundException('Machine not found');

    const VALID_STATES = [
      'RUNNING', 'IDLE', 'PLANNED_STOP', 'BREAKDOWN', 'SETUP',
      'CHANGEOVER', 'STARVED', 'BLOCKED', 'OFFLINE', 'MAINTENANCE',
    ];
    if (!VALID_STATES.includes(dto.state)) {
      throw new BadRequestException(`Invalid machine state: ${dto.state}`);
    }

    const DOWN_STATES = new Set(['PLANNED_STOP', 'BREAKDOWN', 'SETUP', 'CHANGEOVER', 'STARVED', 'BLOCKED', 'MAINTENANCE']);
    const isDown = DOWN_STATES.has(dto.state);

    // Default ISA-95 reason-code / category per state (overridable from the dialog)
    const STATE_DEFAULTS: Record<string, { reasonCode: string; category: string; planned: boolean }> = {
      BREAKDOWN:    { reasonCode: 'UNPLANNED_BREAKDOWN', category: 'MECHANICAL', planned: false },
      PLANNED_STOP: { reasonCode: 'PLANNED_MAINTENANCE', category: 'PLANNED_BREAK', planned: true },
      MAINTENANCE:  { reasonCode: 'PLANNED_MAINTENANCE', category: 'PLANNED_MAINTENANCE', planned: true },
      SETUP:        { reasonCode: 'CHANGEOVER', category: 'CHANGEOVER', planned: true },
      CHANGEOVER:   { reasonCode: 'CHANGEOVER', category: 'CHANGEOVER', planned: true },
      STARVED:      { reasonCode: 'STARVED', category: 'MATERIAL', planned: false },
      BLOCKED:      { reasonCode: 'BLOCKED', category: 'PROCESS', planned: false },
    };
    const defaults = STATE_DEFAULTS[dto.state];
    const now = new Date();

    // 1. Close the open state-timeline record + start the new one
    const openRecord = await this.prisma.machineStateRecord.findFirst({
      where: { machineId, endTime: null },
      orderBy: { startTime: 'desc' },
    });
    if (openRecord) {
      await this.prisma.machineStateRecord.update({
        where: { id: openRecord.id },
        data: {
          endTime: now,
          durationMinutes: (now.getTime() - openRecord.startTime.getTime()) / 60_000,
        },
      });
    }
    await this.prisma.machineStateRecord.create({
      data: {
        factoryId: machine.factoryId,
        machineId,
        state: dto.state as any,
        startTime: now,
        isPlannedStop: isDown ? (defaults?.planned ?? false) : false,
        downtimeCauseId: dto.downtimeCauseId ?? null,
        workOrderId: dto.workOrderId ?? null,
        notes: dto.reason ?? dto.notes ?? null,
        source: 'OPERATOR',
      },
    });

    // 2. Live snapshot
    await this.prisma.machineCurrentStatus.upsert({
      where: { machineId },
      create: { machineId, state: dto.state as any, lastEventAt: now },
      update: { state: dto.state as any, lastEventAt: now },
    });

    // 3. Downtime-event integration
    const openDowntime = await this.prisma.downtimeEvent.findFirst({
      where: { machineId, endTime: null },
    });

    let downtimeEvent: any = null;
    if (isDown && !openDowntime) {
      downtimeEvent = await this.createDowntimeEvent(machine.factoryId, userId, {
        machineId,
        workOrderId: dto.workOrderId,
        causeId: dto.downtimeCauseId,
        reasonCode: (dto.reasonCode ?? defaults?.reasonCode ?? 'UNPLANNED_BREAKDOWN') as any,
        category: (dto.category ?? defaults?.category ?? 'OTHER') as any,
        description: dto.reason,
        notes: dto.notes,
        isPlanned: defaults?.planned ?? false,
      } as any);
    } else if (!isDown && openDowntime) {
      downtimeEvent = await this.endDowntimeEvent(machine.factoryId, openDowntime.id, userId, {
        resolution: dto.reason ?? `Machine set to ${dto.state}`,
      } as any);
    }

    // 4. Job-order integration: pause on stop, resume on run
    let jobOrder: any = null;
    if (dto.jobOrderId) {
      const jo = await this.prisma.jobOrder.findFirst({
        where: { id: dto.jobOrderId, factoryId: machine.factoryId },
        select: { id: true, status: true },
      });
      if (jo) {
        if (isDown && jo.status === 'EXECUTING') {
          jobOrder = await this.prisma.jobOrder.update({
            where: { id: jo.id },
            data: { status: 'PAUSED', notes: dto.reason ?? `Paused: machine ${dto.state}` },
          });
        } else if (dto.state === 'RUNNING' && jo.status === 'PAUSED') {
          jobOrder = await this.prisma.jobOrder.update({
            where: { id: jo.id },
            data: { status: 'EXECUTING' },
          });
        }
      }
    }

    this.eventEmitter.emit('machine.state.changed', {
      machineId, machineName: machine.name, state: dto.state, factoryId: machine.factoryId,
    });
    this.logger.log(`Machine ${machine.code} state → ${dto.state} (by operator)`);

    return {
      machineId,
      state: dto.state,
      stateRecordClosed: !!openRecord,
      downtimeEvent,
      jobOrder,
    };
  }
}
