import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { ProductionService } from './production.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  NotificationType, NotificationCategory, NotificationSeverity,
} from '@prisma/client';

/**
 * How late an auto-start may fire, in minutes.
 *
 * A work order planned for last Tuesday must not start itself on Friday because
 * nobody noticed. The window says "this slot is still recognisably now"; past
 * it, the plant is told rather than obeyed. Four hours is one shift's half —
 * long enough to survive a delayed handover, short enough that yesterday's plan
 * cannot run itself today.
 */
const AUTO_START_GRACE_MIN = 4 * 60;

/**
 * Auto-start scheduler. Every minute it starts what is genuinely due.
 *
 * ── What it refuses, and why ────────────────────────────────────────────────
 * The first version asked one question — `plannedStart <= now` — and started
 * whatever answered yes. On 25 Aug 2026 that put WO-2026-0004 into EXECUTING
 * while WO-2026-0003 was still running on the same four machines, and the two
 * orders then shared a line that can only make one product at a time. Nothing
 * was said to anybody; the plant found it hours later in the numbers.
 *
 * So it now refuses two things and REPORTS both:
 *
 *   BUSY LINE   another order is IN_PROGRESS on the same line. The plan said
 *               start; the floor says there is nowhere to start. Skipping
 *               silently would repeat 25 Aug, so a notification goes out and
 *               the order stays exactly where it was — still due, still
 *               waiting, nothing consumed.
 *
 *   STALE SLOT  the planned start is further behind than the grace window. An
 *               order this late is a scheduling decision, not an automation
 *               one: someone has to look at it. It is reported ONCE and then
 *               left alone, because a stale order that notifies every minute is
 *               a stale order everybody learns to ignore.
 *
 * Everything runs as the "system" actor (no userId). Failures are logged and
 * never throw — one stuck order must not block the rest of the batch.
 */
@Injectable()
export class WorkOrderSchedulerService {
  private readonly logger = new Logger(WorkOrderSchedulerService.name);

  /** Orders already reported as blocked or stale, so the plant is told once. */
  private readonly told = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly production: ProductionService,
    private readonly notifications: NotificationsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    const now = new Date();
    const earliest = new Date(now.getTime() - AUTO_START_GRACE_MIN * 60_000);

    // 1) Due auto-start work orders
    const dueWOs = await this.prisma.workOrder.findMany({
      where: {
        autoStart: true,
        deletedAt: null,
        status: { in: ['PLANNED', 'RELEASED'] },
        plannedStart: { lte: now },
      },
      select: {
        id: true, factoryId: true, orderNumber: true, plannedStart: true, lineId: true,
      },
    });

    for (const wo of dueWOs) {
      // ── Stale slot ──────────────────────────────────────────────────────
      if (wo.plannedStart && wo.plannedStart < earliest) {
        const lateMin = Math.round((now.getTime() - wo.plannedStart.getTime()) / 60_000);
        await this.reportOnce(wo.id, 'stale', wo.factoryId,
          `${wo.orderNumber} was due ${this.humanMins(lateMin)} ago and will not auto-start`,
          `Its planned start is further behind than the ${this.humanMins(AUTO_START_GRACE_MIN)} `
          + 'auto-start window, so starting it now would put yesterday\'s plan on today\'s line. '
          + 'Start it by hand if it is still wanted, or reschedule it.');
        continue;
      }

      // ── Busy line ───────────────────────────────────────────────────────
      const blocker = await this.lineBlocker(wo);
      if (blocker) {
        await this.reportOnce(wo.id, `busy:${blocker.id}`, wo.factoryId,
          `${wo.orderNumber} should have started, but the line is running ${blocker.orderNumber}`,
          'Auto-start held it back rather than putting two orders on one line. '
          + `It stays due and will start on its own as soon as ${blocker.orderNumber} finishes.`);
        continue;
      }

      try {
        await this.production.startWorkOrder(wo.factoryId, null, wo.id);
        this.told.delete(wo.id);
        this.logger.log(`Auto-started WO ${wo.orderNumber} (plannedStart reached)`);
      } catch (e) {
        this.logger.warn(`Auto-start of WO ${wo.orderNumber} skipped: ${(e as Error).message}`);
      }
    }

    // 2) Due READY job orders of running auto-start work orders
    const dueJOs = await this.prisma.jobOrder.findMany({
      where: {
        status: 'READY',
        plannedStart: { lte: now },
        workOrder: { autoStart: true, status: 'IN_PROGRESS', deletedAt: null },
      },
      select: { id: true, factoryId: true, operationName: true },
    });
    for (const jo of dueJOs) {
      try {
        await this.production.updateJobOrderStatus(jo.factoryId, null, jo.id, 'EXECUTING', {});
        this.logger.log(`Auto-started job order "${jo.operationName}" (plannedStart reached)`);
      } catch {
        /* dependency not met yet — try again next tick */
      }
    }
  }

  /**
   * The order already occupying this one's line, if any.
   *
   * Scoped by LINE rather than by machine: a line runs one product at a time,
   * and two orders sharing even one machine of it is the same fault. An order
   * with no line recorded is not blocked by this — it cannot be shown to
   * collide with anything, and refusing to start it on a guess would be its own
   * kind of wrong.
   */
  private async lineBlocker(wo: { id: string; factoryId: string; lineId: string | null }) {
    if (!wo.lineId) return null;
    return this.prisma.workOrder.findFirst({
      where: {
        id: { not: wo.id },
        factoryId: wo.factoryId,
        lineId: wo.lineId,
        status: 'IN_PROGRESS',
        deletedAt: null,
      },
      select: { id: true, orderNumber: true },
    }).catch(() => null);
  }

  /**
   * Tell the plant once per reason, not once per minute.
   *
   * The reason is part of the key, so an order that was blocked and then goes
   * stale is reported again — the situation changed, and that is news.
   */
  private async reportOnce(
    workOrderId: string, reason: string, factoryId: string,
    title: string, message: string,
  ): Promise<void> {
    if (this.told.get(workOrderId) === reason) return;
    this.told.set(workOrderId, reason);
    this.logger.warn(`${title} — ${message}`);
    await this.notifications.dispatch({
      factoryId,
      type: NotificationType.PRODUCTION,
      category: NotificationCategory.PRODUCTION,
      severity: NotificationSeverity.WARNING,
      title,
      message,
      link: '/scheduling/production',
      data: { workOrderId, reason },
    }).catch((e) => this.logger.debug(`auto-start notice failed: ${(e as Error).message}`));
  }

  private humanMins(m: number): string {
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }
}
