import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

/**
 * Planned stops that belong to a work order rather than to the calendar.
 *
 * Changeover is the case that matters. A line switching from one SKU to another
 * needs a full changeover; a new order for the SAME product usually needs only a
 * short setup, or nothing. Charging both the same way — which is what a fixed
 * `CHANGEOVER` figure does — makes the single largest controllable loss on a
 * packing line untraceable.
 *
 * So the trigger is part of the rule:
 *
 *   PRODUCT_CHANGE  the SKU differs from the last order on that machine
 *   ORDER_CHANGE    any new order, including the same SKU
 *   ALWAYS          every order, unconditionally
 *
 * The rule is evaluated when a job order STARTS, because that is the only moment
 * the system can see both the incoming order and what ran before it.
 */
@Injectable()
export class WorkOrderStopService {
  private readonly logger = new Logger(WorkOrderStopService.name);

  constructor(private readonly prisma: PrismaService) {}

  private requireFactory(factoryId: string | null): string {
    if (!factoryId) throw new BadRequestException('Factory context required');
    return factoryId;
  }

  async list(factoryId: string | null) {
    const fid = this.requireFactory(factoryId);
    return this.prisma.workOrderStopRule.findMany({
      where: { factoryId: fid },
      include: {
        cause: { select: { id: true, code: true, name: true } },
        line: { select: { id: true, code: true, name: true } },
        machine: { select: { id: true, code: true, name: true } },
        sku: { select: { id: true, code: true, name: true } },
      },
      orderBy: { code: 'asc' },
    });
  }

  async create(factoryId: string | null, dto: any) {
    const fid = this.requireFactory(factoryId);
    if (!dto?.code || !dto?.name) throw new BadRequestException('A code and a name are required');
    const mins = Number(dto.durationMinutes);
    if (!Number.isFinite(mins) || mins <= 0) {
      throw new BadRequestException('Enter how many minutes the stop lasts');
    }
    return this.prisma.workOrderStopRule.create({
      data: {
        factoryId: fid,
        code: String(dto.code).trim(),
        name: String(dto.name).trim(),
        trigger: (dto.trigger ?? 'PRODUCT_CHANGE') as never,
        durationMinutes: mins,
        causeId: dto.causeId ?? null,
        category: (dto.category ?? 'CHANGEOVER') as never,
        // Changeover is planned but still a loss in most plants, so this
        // defaults the opposite way to a break. Editable because plants differ.
        affectsOEE: dto.affectsOEE !== false,
        isPlanned: dto.isPlanned !== false,
        lineId: dto.lineId ?? null,
        machineId: dto.machineId ?? null,
        skuId: dto.skuId ?? null,
        description: dto.description ?? null,
        isActive: dto.isActive !== false,
      },
    });
  }

  async update(factoryId: string | null, id: string, dto: any) {
    const fid = this.requireFactory(factoryId);
    const existing = await this.prisma.workOrderStopRule.findFirst({ where: { id, factoryId: fid }, select: { id: true } });
    if (!existing) throw new NotFoundException('Work-order stop rule not found');
    return this.prisma.workOrderStopRule.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: String(dto.name).trim() }),
        ...(dto.trigger !== undefined && { trigger: dto.trigger as never }),
        ...(dto.durationMinutes !== undefined && { durationMinutes: Number(dto.durationMinutes) }),
        ...(dto.causeId !== undefined && { causeId: dto.causeId }),
        ...(dto.category !== undefined && { category: dto.category as never }),
        ...(dto.affectsOEE !== undefined && { affectsOEE: dto.affectsOEE }),
        ...(dto.isPlanned !== undefined && { isPlanned: dto.isPlanned }),
        ...(dto.lineId !== undefined && { lineId: dto.lineId }),
        ...(dto.machineId !== undefined && { machineId: dto.machineId }),
        ...(dto.skuId !== undefined && { skuId: dto.skuId }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.isActive !== undefined && { isActive: dto.isActive }),
      },
    });
  }

  async remove(factoryId: string | null, id: string) {
    const fid = this.requireFactory(factoryId);
    const existing = await this.prisma.workOrderStopRule.findFirst({ where: { id, factoryId: fid }, select: { id: true } });
    if (!existing) throw new NotFoundException('Work-order stop rule not found');
    await this.prisma.workOrderStopRule.delete({ where: { id } });
  }

  /**
   * Job order entered execution — evaluate the rules.
   *
   * A listener rather than a direct call because ShiftModule already depends on
   * ProductionModule; calling back the other way would close a cycle.
   *
   * Failures are logged and swallowed. A changeover rule that cannot be
   * evaluated must never stop a production order from starting — the worst
   * outcome here is a missing planned stop, which an operator can add by hand.
   */
  @OnEvent('production.job-order.started')
  async onJobOrderStarted(payload: {
    factoryId: string;
    jobOrderId: string;
    machineId: string | null;
    workOrderId: string | null;
    startedAt: Date;
  }): Promise<void> {
    try {
      await this.applyOnJobOrderStart(payload.factoryId, {
        id: payload.jobOrderId,
        machineId: payload.machineId,
        workOrderId: payload.workOrderId,
        startedAt: payload.startedAt,
      });
    } catch (err) {
      this.logger.warn(
        `work-order stop rules failed for job order ${payload.jobOrderId}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Decide which rules fire for a job order that is starting, and record them.
   *
   * Returns the events created. Deliberately forgiving: any failure is logged
   * and swallowed by the caller's try/catch, because a changeover rule that
   * cannot be evaluated must never stop a production order from starting.
   */
  async applyOnJobOrderStart(
    factoryId: string,
    jobOrder: { id: string; machineId: string | null; workOrderId: string | null; startedAt?: Date },
  ): Promise<Array<{ ruleCode: string; minutes: number }>> {
    if (!jobOrder.machineId) return [];

    const rules = await this.prisma.workOrderStopRule.findMany({
      where: {
        factoryId, isActive: true,
        OR: [{ machineId: jobOrder.machineId }, { machineId: null }],
      },
    });
    if (rules.length === 0) return [];

    const context = await this.contextFor(jobOrder);
    const at = jobOrder.startedAt ?? new Date();
    const applied: Array<{ ruleCode: string; minutes: number }> = [];

    for (const rule of rules) {
      if (!this.matches(rule, context)) continue;

      // One stop per rule per job order. A retried start must not book the
      // changeover twice — that is time removed from production on paper only.
      const exists = await this.prisma.downtimeEvent.findFirst({
        where: { jobOrderId: jobOrder.id, category: rule.category, isPlanned: rule.isPlanned },
        select: { id: true },
      });
      if (exists) continue;

      // Booked BEFORE the order starts running: a changeover is the time spent
      // getting ready, not time taken out of the middle of the run.
      const start = new Date(at.getTime() - rule.durationMinutes * 60_000);
      await this.prisma.downtimeEvent.create({
        data: {
          factoryId,
          machineId: jobOrder.machineId,
          jobOrderId: jobOrder.id,
          workOrderId: jobOrder.workOrderId ?? null,
          causeId: rule.causeId,
          category: rule.category,
          reasonCode: 'CHANGEOVER' as never,
          startTime: start,
          endTime: at,
          durationMinutes: rule.durationMinutes,
          isPlanned: rule.isPlanned,
          affectsOEE: rule.affectsOEE,
          notes: `Work-order stop: ${rule.name} (${rule.code}, ${rule.trigger})`,
        },
      });
      applied.push({ ruleCode: rule.code, minutes: rule.durationMinutes });
    }

    if (applied.length) {
      this.logger.log(
        `job order ${jobOrder.id}: ${applied.length} work-order stop(s) booked — ` +
        applied.map((a) => `${a.ruleCode} ${a.minutes}m`).join(', '),
      );
    }
    return applied;
  }

  /** What ran on this machine before, and what is running now. */
  private async contextFor(jobOrder: { id: string; machineId: string | null; workOrderId: string | null }) {
    const current = await this.prisma.jobOrder.findUnique({
      where: { id: jobOrder.id },
      select: { workOrder: { select: { id: true, skuId: true, lineId: true } } },
    });

    const previous = await this.prisma.jobOrder.findFirst({
      where: {
        machineId: jobOrder.machineId ?? undefined,
        id: { not: jobOrder.id },
        actualStart: { not: null },
      },
      orderBy: { actualStart: 'desc' },
      select: { workOrder: { select: { id: true, skuId: true } } },
    });

    return {
      machineId: jobOrder.machineId,
      lineId: current?.workOrder?.lineId ?? null,
      skuId: current?.workOrder?.skuId ?? null,
      workOrderId: current?.workOrder?.id ?? null,
      previousSkuId: previous?.workOrder?.skuId ?? null,
      previousWorkOrderId: previous?.workOrder?.id ?? null,
      // Nothing ran here before: the machine is starting cold. That is a setup,
      // not a change from something, so a PRODUCT_CHANGE rule does not fire.
      isFirstRun: !previous,
    };
  }

  private matches(
    rule: { trigger: string; lineId: string | null; machineId: string | null; skuId: string | null },
    ctx: Awaited<ReturnType<WorkOrderStopService['contextFor']>>,
  ): boolean {
    // Narrowing first — a rule scoped to another line or SKU never applies.
    if (rule.machineId && rule.machineId !== ctx.machineId) return false;
    if (rule.lineId && rule.lineId !== ctx.lineId) return false;
    if (rule.skuId && rule.skuId !== ctx.skuId) return false;

    switch (rule.trigger) {
      case 'ALWAYS':
        return true;

      case 'ORDER_CHANGE':
        // Any different order, including the same product again.
        return ctx.isFirstRun || ctx.workOrderId !== ctx.previousWorkOrderId;

      case 'PRODUCT_CHANGE':
      default:
        // A cold start is not a product change: there is nothing to change from,
        // and booking a full changeover there would invent loss every morning.
        if (ctx.isFirstRun) return false;
        if (!ctx.skuId || !ctx.previousSkuId) return false;
        return ctx.skuId !== ctx.previousSkuId;
    }
  }
}
