import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { findProcessForSku } from '../../common/process-scope.util';

/**
 * Keeping a not-yet-started job order on the CURRENT approved routing.
 *
 * ── The problem ─────────────────────────────────────────────────────────────
 * `idealCycleTimeSec` is copied onto a job order when the order is generated,
 * and it is Performance's denominator. Nothing revisited it. So the sequence
 * that actually happens in a plant —
 *
 *   generate next week's orders → find the cycle time is wrong →
 *   correct the routing → get the correction approved
 *
 * — left every already-generated order still dividing by the old figure, and
 * the only way out was to delete the orders and generate them again. On this
 * line the gap is not subtle: a filler recorded at 30 s/unit against a
 * schedule that says 1.2 makes Performance cap at 100% and hide every speed
 * loss there is.
 *
 * The transition to EXECUTING already re-reads the figure, which covers an
 * order about to start. This covers the rest of the horizon: orders sitting in
 * the schedule for days while master data is still being corrected.
 *
 * ── What "current" means ────────────────────────────────────────────────────
 * The latest APPROVED version, not merely the latest active one. A routing
 * somebody is still editing is not a rule the floor should be graded against,
 * and `findProcessForSku` orders by version and filters on isActive without
 * ever looking at `approvedAt`. Approval is checked here, and a plant that
 * does not use approval at all still works: when no version of a routing has
 * ever been approved, the active one is used, because grading against an
 * unapproved routing is still better than grading against a stale one.
 *
 * ── What is never touched ───────────────────────────────────────────────────
 * Anything with an `actualStart`. Minutes have already been measured against
 * that denominator; changing it now would restate published readings. A
 * correction that reaches backwards is not a correction — it is a different
 * number wearing the same date.
 */
@Injectable()
export class CycleTimeSyncService {
  private readonly log = new Logger(CycleTimeSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hourly. Master data changes at human pace — somebody edits a routing and
   * somebody else approves it — so sampling faster buys nothing, and the
   * EXECUTING transition already catches the case where minutes are about to
   * start being measured.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    try {
      const factories = await this.prisma.factory.findMany({ select: { id: true } });
      for (const f of factories) await this.sync(f.id);
    } catch (err) {
      // Logged, not thrown: a failed sync leaves the previous figures in place,
      // which is stale rather than wrong, and taking the scheduler down would
      // stop every later attempt from repairing it.
      this.log.error('Cycle-time sync failed', err as Error);
    }
  }

  async sync(factoryId: string): Promise<{
    examined: number; updated: number;
    changes: Array<{ jobOrder: string; operation: string; from: number | null; to: number }>;
  }> {
    // Only orders that have never run. `actualStart` rather than status,
    // because status is a label and actualStart is the fact.
    const candidates = await this.prisma.jobOrder.findMany({
      where: {
        factoryId,
        actualStart: null,
        status: { in: ['SCHEDULED', 'READY', 'PAUSED'] },
        routingStepId: { not: null },
      },
      select: {
        id: true, operationName: true, idealCycleTimeSec: true,
        machineId: true, routingStepId: true,
        workOrder: { select: { skuId: true } },
      },
    });
    if (candidates.length === 0) return { examined: 0, updated: 0, changes: [] };

    // The step a job order points at belongs to the process version it was
    // generated from. A NEWER approved version has different step rows, so the
    // old id resolves to the old number — which is the whole defect. Re-resolve
    // from the product, then match on step NUMBER, which is what survives a
    // version bump.
    const stepNumberOf = new Map<string, number>();
    const steps = await this.prisma.routingStep.findMany({
      where: { id: { in: candidates.map((c) => c.routingStepId!) } },
      select: { id: true, stepNumber: true },
    });
    for (const s of steps) stepNumberOf.set(s.id, s.stepNumber);

    const changes: Array<{ jobOrder: string; operation: string; from: number | null; to: number }> = [];
    const bySku = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const skuId = c.workOrder?.skuId;
      if (!skuId) continue;
      const list = bySku.get(skuId) ?? [];
      list.push(c);
      bySku.set(skuId, list);
    }

    for (const [skuId, orders] of bySku) {
      const process = await this.currentApprovedProcess(factoryId, skuId);
      if (!process) continue;

      const byNumber = new Map<number, { cycleTimeSec: number | null; cycleTimeMins: number | null; id: string }>();
      for (const s of process.routingSteps ?? []) {
        byNumber.set(s.stepNumber, { cycleTimeSec: s.cycleTimeSec, cycleTimeMins: s.cycleTimeMins, id: s.id });
      }

      for (const o of orders) {
        const n = stepNumberOf.get(o.routingStepId!);
        if (n == null) continue;
        const step = byNumber.get(n);
        if (!step) continue;

        const target = await this.resolve(step, o.machineId);
        if (target == null) continue;
        // Float equality is fine here: both sides come from the same stored
        // column, so an unchanged routing yields the identical double.
        if (target === o.idealCycleTimeSec) continue;

        await this.prisma.jobOrder.update({
          where: { id: o.id },
          data: { idealCycleTimeSec: target, routingStepId: step.id },
        });
        changes.push({
          jobOrder: o.id, operation: o.operationName,
          from: o.idealCycleTimeSec, to: target,
        });
      }
    }

    if (changes.length > 0) {
      this.log.log(
        `Cycle times re-synced from the approved routing: ${changes.length} job order(s) — `
        + changes.slice(0, 5).map((c) => `${c.operation} ${c.from ?? '—'}s → ${c.to}s`).join(', ')
        + (changes.length > 5 ? `, +${changes.length - 5} more` : ''),
      );
    }
    return { examined: candidates.length, updated: changes.length, changes };
  }

  /**
   * The routing to grade against: latest APPROVED, else latest active.
   *
   * Two queries rather than one clever one — the approved lookup has to be able
   * to find nothing, and an `OR` that quietly returns an unapproved version
   * when an approved one exists would defeat the point of asking.
   */
  private async currentApprovedProcess(factoryId: string, skuId: string) {
    const include = {
      routingSteps: {
        select: { id: true, stepNumber: true, cycleTimeSec: true, cycleTimeMins: true },
        orderBy: { stepNumber: 'asc' as const },
      },
    };

    const approved = await this.prisma.manufacturingProcess.findFirst({
      where: { factoryId, skuId, isActive: true, approvedAt: { not: null } },
      include,
      orderBy: [{ approvedAt: 'desc' }, { version: 'desc' }],
    });
    if (approved) return approved;

    // No version of this routing has ever been approved. Fall back to whatever
    // the scope resolver picks, so a plant that does not use the approval step
    // still gets corrections — grading against an unapproved routing beats
    // grading against a stale one.
    return findProcessForSku<{
      routingSteps: Array<{ id: string; stepNumber: number; cycleTimeSec: number | null; cycleTimeMins: number | null }>;
    }>(this.prisma, factoryId, skuId, include);
  }

  /**
   * Same precedence as generation and as the EXECUTING transition, in the same
   * order — a machine override, then the step, then the legacy minutes field.
   * Three call sites resolving this differently is how a denominator comes to
   * depend on which one ran last.
   */
  private async resolve(
    step: { cycleTimeSec: number | null; cycleTimeMins: number | null; id: string },
    machineId: string | null,
  ): Promise<number | null> {
    if (machineId) {
      const option = await this.prisma.routingStepMachineOption.findFirst({
        where: { stepId: step.id, machineId, isActive: true },
        select: { cycleTimeSec: true },
      });
      if (option?.cycleTimeSec != null) return option.cycleTimeSec;
    }
    return step.cycleTimeSec ?? (step.cycleTimeMins != null ? step.cycleTimeMins * 60 : null);
  }
}
