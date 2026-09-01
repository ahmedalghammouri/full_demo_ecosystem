import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../../database/prisma.service';
import { CreateAlarmDto, ResolveAlarmDto } from './dto/alarms.dto';

@Injectable()
export class AlarmsService {
  private readonly logger = new Logger(AlarmsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async list(
    factoryId: string | null,
    filters: {
      machineId?: string;
      severity?: string;
      active?: boolean;
      jobOrderId?: string;
      workOrderId?: string;
      from?: string;
      to?: string;
      limit?: number;
      /** 1-based. Supplying it switches the response to the paged shape. */
      page?: number;
    },
  ) {
    const where: any = {
      ...(factoryId ? { factoryId } : {}),
      ...(filters.machineId ? { machineId: filters.machineId } : {}),
      ...(filters.severity ? { severity: filters.severity } : {}),
      ...(filters.active ? { resolvedAt: null } : {}),
      ...(filters.jobOrderId ? { metadata: { path: ['jobOrderId'], equals: filters.jobOrderId } } : {}),
      ...(filters.workOrderId ? { metadata: { path: ['workOrderId'], equals: filters.workOrderId } } : {}),
      ...((filters.from || filters.to)
        ? {
            triggeredAt: {
              ...(filters.from ? { gte: new Date(filters.from) } : {}),
              ...(filters.to ? { lte: new Date(filters.to) } : {}),
            },
          }
        : {}),
    };

    const take = Math.min(filters.limit ?? 100, 500);
    const include = { machine: { select: { id: true, name: true, code: true } } };
    const orderBy = { triggeredAt: 'desc' } as const;

    /**
     * Paging is OPT-IN, and the response shape follows it.
     *
     * Without `page` this returns the bare array it always has, because two
     * other callers consume it that way and a shape change would empty their
     * lists silently. With `page` it returns the count too — which a table
     * cannot page without: this plant holds 22,572 alarm events, so a client
     * paging through a capped fetch would put page buttons on a truncated list
     * and call it pagination.
     */
    if (filters.page == null) {
      return this.prisma.alarmEvent.findMany({ where, orderBy, take, include });
    }

    const page = Math.max(1, Math.floor(filters.page));
    const [data, total] = await Promise.all([
      this.prisma.alarmEvent.findMany({ where, orderBy, take, skip: (page - 1) * take, include }),
      this.prisma.alarmEvent.count({ where }),
    ]);
    return { data, total, page, limit: take, totalPages: Math.max(1, Math.ceil(total / take)) };
  }

  async kpis(factoryId: string | null) {
    const where = factoryId ? { factoryId } : {};
    const dayAgo = new Date(Date.now() - 86_400_000);

    const [active, unacked, critical, last24h, resolved] = await Promise.all([
      this.prisma.alarmEvent.count({ where: { ...where, resolvedAt: null } }),
      this.prisma.alarmEvent.count({ where: { ...where, resolvedAt: null, acknowledgedAt: null } }),
      this.prisma.alarmEvent.count({ where: { ...where, resolvedAt: null, severity: 'CRITICAL' } }),
      this.prisma.alarmEvent.count({ where: { ...where, triggeredAt: { gte: dayAgo } } }),
      this.prisma.alarmEvent.findMany({
        where: { ...where, resolvedAt: { not: null }, triggeredAt: { gte: new Date(Date.now() - 30 * 86_400_000) } },
        select: { triggeredAt: true, resolvedAt: true },
        take: 500,
      }),
    ]);

    const avgResolutionMins = resolved.length
      ? Math.round(
          resolved.reduce((t, a) => t + (a.resolvedAt!.getTime() - a.triggeredAt.getTime()) / 60_000, 0) /
            resolved.length * 10,
        ) / 10
      : null;

    return { active, unacknowledged: unacked, critical, last24h, avgResolutionMins };
  }

  /** Manual alarm raised from the shop floor (job-order card / live dashboard). */
  async create(factoryId: string | null, userId: string, dto: CreateAlarmDto) {
    let resolvedFactoryId = factoryId;
    if (dto.machineId) {
      const machine = await this.prisma.machine.findFirst({
        where: { id: dto.machineId, ...(factoryId ? { factoryId } : {}) },
        select: { id: true, factoryId: true, name: true },
      });
      if (!machine) throw new NotFoundException('Machine not found');
      resolvedFactoryId = machine.factoryId;
    }
    if (!resolvedFactoryId) {
      const first = await this.prisma.factory.findFirst({ select: { id: true } });
      if (!first) throw new BadRequestException('No factory configured');
      resolvedFactoryId = first.id;
    }

    const alarm = await this.prisma.alarmEvent.create({
      data: {
        factoryId: resolvedFactoryId,
        machineId: dto.machineId ?? null,
        code: dto.code ?? 'OPERATOR_ALARM',
        description: dto.description,
        severity: (dto.severity ?? 'HIGH') as any,
        category: dto.category ?? 'OPERATOR',
        triggeredAt: new Date(),
        notes: dto.notes,
        metadata: {
          source: 'SHOP_FLOOR',
          raisedById: userId,
          ...(dto.jobOrderId ? { jobOrderId: dto.jobOrderId } : {}),
          ...(dto.workOrderId ? { workOrderId: dto.workOrderId } : {}),
        },
      },
      include: { machine: { select: { id: true, name: true, code: true } } },
    });

    this.eventEmitter.emit('alarm.created', { alarm, factoryId: resolvedFactoryId });
    this.logger.log(`Shop-floor alarm raised (${alarm.severity}): ${alarm.description}`);
    return alarm;
  }

  async acknowledge(factoryId: string | null, id: string, userId: string) {
    const alarm = await this.prisma.alarmEvent.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
    });
    if (!alarm) throw new NotFoundException('Alarm not found');
    if (alarm.acknowledgedAt) throw new BadRequestException('Alarm already acknowledged');

    return this.prisma.alarmEvent.update({
      where: { id },
      data: { acknowledgedAt: new Date(), acknowledgedById: userId },
      include: { machine: { select: { id: true, name: true, code: true } } },
    });
  }

  async resolve(factoryId: string | null, id: string, userId: string, dto: ResolveAlarmDto) {
    const alarm = await this.prisma.alarmEvent.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
    });
    if (!alarm) throw new NotFoundException('Alarm not found');
    if (alarm.resolvedAt) throw new BadRequestException('Alarm already resolved');

    const resolvedAt = new Date();
    return this.prisma.alarmEvent.update({
      where: { id },
      data: {
        resolvedAt,
        resolvedById: userId,
        // First resolution implies acknowledgement
        ...(alarm.acknowledgedAt ? {} : { acknowledgedAt: resolvedAt, acknowledgedById: userId }),
        durationMinutes: (resolvedAt.getTime() - alarm.triggeredAt.getTime()) / 60_000,
        ...(dto.notes ? { notes: dto.notes } : {}),
      },
      include: { machine: { select: { id: true, name: true, code: true } } },
    });
  }
  // ────────────────────────────────────────────────────────────
  // ALARM DEFINITIONS
  // ────────────────────────────────────────────────────────────

  async listDefinitions(factoryId: string | null, tagId?: string) {
    return this.prisma.alarmDefinition.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(tagId ? { tagId } : {}),
      },
      include: {
        tag: {
          select: {
            id: true, code: true, name: true, unit: true,
            machine: { select: { id: true, code: true, name: true } },
          },
        },
      },
      orderBy: [{ severity: 'asc' }, { code: 'asc' }],
    });
  }

  /**
   * A definition with no threshold can never fire — the gateway refuses to
   * compare against an unknown rather than inventing a fault. Rejecting it here
   * means the customer finds out at save time instead of wondering later why a
   * configured alarm is silent.
   */
  async createDefinition(factoryId: string | null, dto: any) {
    if (!factoryId) throw new BadRequestException('A factory context is required');
    if (!dto?.code || !dto?.name) throw new BadRequestException('code and name are required');
    if (!dto?.tagId) throw new BadRequestException('An alarm must be bound to a tag');
    if (dto.threshold === null || dto.threshold === undefined || Number.isNaN(Number(dto.threshold))) {
      throw new BadRequestException('A numeric threshold is required, otherwise the alarm can never fire');
    }

    return this.prisma.alarmDefinition.create({
      data: {
        factoryId,
        tagId: dto.tagId,
        code: String(dto.code).trim(),
        name: String(dto.name).trim(),
        severity: (dto.severity ?? 'HIGH') as any,
        category: dto.category ?? 'PROCESS',
        condition: (dto.condition ?? 'GT').toUpperCase(),
        threshold: Number(dto.threshold),
        deadband: dto.deadband != null ? Number(dto.deadband) : null,
        delaySeconds: Number(dto.delaySeconds ?? 0),
        autoAck: !!dto.autoAck,
        notifyRoles: dto.notifyRoles ?? [],
        isActive: dto.isActive !== false,
      },
    });
  }

  async updateDefinition(factoryId: string | null, id: string, dto: any) {
    const existing = await this.prisma.alarmDefinition.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Alarm definition not found');

    if (dto.threshold !== undefined && (dto.threshold === null || Number.isNaN(Number(dto.threshold)))) {
      throw new BadRequestException('A numeric threshold is required, otherwise the alarm can never fire');
    }

    return this.prisma.alarmDefinition.update({
      where: { id },
      data: {
        ...(dto.code !== undefined && { code: String(dto.code).trim() }),
        ...(dto.name !== undefined && { name: String(dto.name).trim() }),
        ...(dto.tagId !== undefined && { tagId: dto.tagId }),
        ...(dto.severity !== undefined && { severity: dto.severity as any }),
        ...(dto.category !== undefined && { category: dto.category }),
        ...(dto.condition !== undefined && { condition: String(dto.condition).toUpperCase() }),
        ...(dto.threshold !== undefined && { threshold: Number(dto.threshold) }),
        ...(dto.deadband !== undefined && { deadband: dto.deadband != null ? Number(dto.deadband) : null }),
        ...(dto.delaySeconds !== undefined && { delaySeconds: Number(dto.delaySeconds) }),
        ...(dto.autoAck !== undefined && { autoAck: !!dto.autoAck }),
        ...(dto.notifyRoles !== undefined && { notifyRoles: dto.notifyRoles }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  /**
   * Deleting a definition keeps its past events — an alarm history that
   * disappears when somebody edits a rule is not a history.
   */
  async deleteDefinition(factoryId: string | null, id: string) {
    const existing = await this.prisma.alarmDefinition.findFirst({
      where: { id, ...(factoryId ? { factoryId } : {}) },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Alarm definition not found');

    await this.prisma.alarmEvent.updateMany({
      where: { alarmDefinitionId: id },
      data: { alarmDefinitionId: null },
    });
    await this.prisma.alarmDefinition.delete({ where: { id } });
  }
}
