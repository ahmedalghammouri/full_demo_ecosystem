import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { Prisma } from '@prisma/client';

export interface LogEventDto {
  factoryId?: string | null;
  entityType: string;
  entityId: string;
  entityCode?: string;
  eventType: string;
  fromValue?: string;
  toValue?: string;
  quantity?: number;
  eventData?: Record<string, unknown>;
  performedById?: string | null;
  notes?: string;
  relatedType?: string;
  relatedId?: string;
}

@Injectable()
export class TraceabilityService {
  private readonly logger = new Logger(TraceabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ────────────────────────────────────────────────────────────
  // LOG EVENT (called internally from other services)
  // ────────────────────────────────────────────────────────────

  async logEvent(dto: LogEventDto): Promise<void> {
    try {
      await this.prisma.traceEvent.create({
        data: {
          factoryId: dto.factoryId ?? null,
          entityType: dto.entityType,
          entityId: dto.entityId,
          entityCode: dto.entityCode ?? null,
          eventType: dto.eventType,
          fromValue: dto.fromValue ?? null,
          toValue: dto.toValue ?? null,
          quantity: dto.quantity ?? null,
          eventData: (dto.eventData as Prisma.InputJsonValue) ?? Prisma.JsonNull,
          performedById: dto.performedById ?? null,
          notes: dto.notes ?? null,
          relatedType: dto.relatedType ?? null,
          relatedId: dto.relatedId ?? null,
        },
      });
    } catch (err) {
      // Never let traceability writes crash the calling service
      this.logger.error('Failed to log trace event', err);
    }
  }

  // ────────────────────────────────────────────────────────────
  // ENTITY HISTORY
  // ────────────────────────────────────────────────────────────

  async getEntityHistory(
    entityType: string,
    entityId: string,
    page = 1,
    limit = 50,
  ) {
    const where: Prisma.TraceEventWhereInput = { entityType, entityId };

    const [total, data] = await Promise.all([
      this.prisma.traceEvent.count({ where }),
      this.prisma.traceEvent.findMany({
        where,
        include: {
          performedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { performedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map(this.formatEvent),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ────────────────────────────────────────────────────────────
  // FACTORY-WIDE EVENTS WITH FILTERS
  // ────────────────────────────────────────────────────────────

  async findEvents(
    factoryId: string | null,
    filters: {
      entityType?: string;
      eventType?: string;
      performedById?: string;
      dateFrom?: string;
      dateTo?: string;
      search?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const {
      entityType,
      eventType,
      performedById,
      dateFrom,
      dateTo,
      search,
      page = 1,
      limit = 50,
    } = filters;

    const where: Prisma.TraceEventWhereInput = {
      ...(factoryId !== null ? { factoryId } : {}),
      ...(entityType && { entityType }),
      ...(eventType && { eventType }),
      ...(performedById && { performedById }),
      ...(dateFrom || dateTo
        ? {
            performedAt: {
              ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
              ...(dateTo ? { lte: new Date(dateTo) } : {}),
            },
          }
        : {}),
      ...(search && {
        OR: [
          { entityCode: { contains: search, mode: 'insensitive' as const } },
          { notes: { contains: search, mode: 'insensitive' as const } },
          { entityType: { contains: search, mode: 'insensitive' as const } },
          { eventType: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await Promise.all([
      this.prisma.traceEvent.count({ where }),
      this.prisma.traceEvent.findMany({
        where,
        include: {
          performedBy: { select: { id: true, name: true, email: true } },
        },
        orderBy: { performedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      data: data.map(this.formatEvent),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  // ────────────────────────────────────────────────────────────
  // MATERIAL CONSUMPTION LEDGER (fed by routing-step materials on WO completion)
  // ────────────────────────────────────────────────────────────

  async listConsumption(factoryId: string | null, filters: {
    search?: string; workOrderId?: string; page?: number; limit?: number;
  }) {
    const { search, workOrderId, page = 1, limit = 50 } = filters;
    const where = {
      ...(factoryId ? { factoryId } : {}),
      ...(workOrderId && { workOrderId }),
      ...(search && {
        OR: [
          { materialCode: { contains: search, mode: 'insensitive' as const } },
          { materialName: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };
    const [total, data, totals] = await Promise.all([
      this.prisma.materialConsumption.count({ where }),
      this.prisma.materialConsumption.findMany({
        where,
        include: {
          workOrder: { select: { id: true, orderNumber: true } },
          batchRecord: { select: { id: true, batchNumber: true, lotNumber: true } },
          materialLot: { select: { id: true, lotNumber: true } },
        },
        orderBy: { consumedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.materialConsumption.aggregate({
        where, _sum: { quantityPlanned: true, quantityActual: true },
      }),
    ]);
    return {
      data, total, page, limit,
      totalPages: Math.ceil(total / limit),
      totalPlanned: totals._sum.quantityPlanned ?? 0,
      totalActual: totals._sum.quantityActual ?? 0,
    };
  }

  // ────────────────────────────────────────────────────────────
  // DASHBOARD STATS
  // ────────────────────────────────────────────────────────────

  async getDashboardStats(factoryId: string | null) {
    const factoryFilter =
      factoryId !== null ? { factoryId } : {};

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalEvents,
      events24h,
      events7d,
      byEntityTypeRaw,
      byEventTypeRaw,
    ] = await Promise.all([
      this.prisma.traceEvent.count({ where: factoryFilter }),
      this.prisma.traceEvent.count({
        where: { ...factoryFilter, performedAt: { gte: last24h } },
      }),
      this.prisma.traceEvent.count({
        where: { ...factoryFilter, performedAt: { gte: last7d } },
      }),
      this.prisma.traceEvent.groupBy({
        by: ['entityType'],
        where: factoryFilter,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
      this.prisma.traceEvent.groupBy({
        by: ['eventType'],
        where: factoryFilter,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
      }),
    ]);

    return {
      totalEvents,
      events24h,
      events7d,
      byEntityType: byEntityTypeRaw.map((r) => ({
        entityType: r.entityType,
        count: r._count.id,
      })),
      byEventType: byEventTypeRaw.map((r) => ({
        eventType: r.eventType,
        count: r._count.id,
      })),
    };
  }

  // ────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ────────────────────────────────────────────────────────────

  private formatEvent(e: any) {
    return {
      id: e.id,
      factoryId: e.factoryId,
      entityType: e.entityType,
      entityId: e.entityId,
      entityCode: e.entityCode,
      eventType: e.eventType,
      fromValue: e.fromValue,
      toValue: e.toValue,
      quantity: e.quantity,
      eventData: e.eventData,
      notes: e.notes,
      relatedType: e.relatedType,
      relatedId: e.relatedId,
      performedAt: e.performedAt.toISOString(),
      performedBy: e.performedBy
        ? { id: e.performedBy.id, name: e.performedBy.name, email: e.performedBy.email }
        : null,
    };
  }
}
