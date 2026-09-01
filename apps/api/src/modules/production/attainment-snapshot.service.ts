import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../database/prisma.service';
import { plantDayKey, plantWallClockToUtc } from '../../common/plant-time.util';
import { toBaseUnits, type SkuPackaging } from '../../common/units.util';

/**
 * Freezes Master Schedule Attainment, one row per production order per day.
 *
 * ── Why attainment needs freezing and capacity does not ─────────────────────
 * Capacity utilisation divides produced units by rated units, both derived from
 * `oee_minutes`. A closed minute never changes, so recomputing that tomorrow
 * gives today's answer and storing it would be a second copy of a settled fact.
 *
 * Attainment divides what was produced by what was PLANNED, and the plan is
 * editable. Change a production order's `targetQty`, or move its
 * `plannedStart`, and every past day's attainment silently rewrites itself —
 * the trend chart on the Schedule & Capacity page redraws history because
 * somebody corrected a typo. A KPI whose past moves is the same failure this
 * consolidation exists to end, with the two disagreeing screens being one
 * screen on two days.
 *
 * ── The grain, and why it is the order ──────────────────────────────────────
 * MSA credits each order at most its own scheduled quantity, so over-producing
 * one order cannot mask a shortfall on another. That rule has to be applied
 * BEFORE anything is summed. Storing pre-credited rows per order makes every
 * roll-up — line, product, factory — a plain sum that cannot forget it.
 */
@Injectable()
export class AttainmentSnapshotService {
  private readonly logger = new Logger(AttainmentSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Hourly, not nightly.
   *
   * A nightly job means today's trend point does not exist until tomorrow, so
   * the page falls back to live derivation for the current day and shows a
   * figure computed a different way from every point beside it. Re-upserting
   * the open day each hour keeps the whole series on one definition; the row is
   * finalised once the day has closed.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    try {
      await this.captureDay(new Date());
      // The previous day too, so a gateway outage or a restart across midnight
      // does not leave a permanent hole in the series.
      await this.captureDay(new Date(Date.now() - 24 * 3_600_000));
    } catch (err) {
      this.logger.error('attainment snapshot failed', err as Error);
    }
  }

  /** Freeze one plant-local day for every order whose planned window touches it. */
  async captureDay(at: Date): Promise<number> {
    const dayStart = plantWallClockToUtc(at, '00:00');
    const dayEnd = plantWallClockToUtc(at, '00:00', 1);
    const closed = dayEnd.getTime() <= Date.now();

    const orders = await this.prisma.productionOrder.findMany({
      where: {
        status: { not: 'CANCELLED' },
        plannedStart: { lt: dayEnd },
        plannedEnd: { gte: dayStart },
      },
      select: {
        id: true, factoryId: true, targetQty: true, unit: true, skuId: true,
        sku: {
          select: {
            baseUnit: true, unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true,
          },
        },
        workOrders: {
          select: {
            lineId: true,
            jobOrders: {
              select: { sequenceOrder: true, actualQtyGood: true, outputUnit: true },
            },
          },
        },
      },
    });

    let written = 0;
    for (const o of orders) {
      const pkg: SkuPackaging = {
        unitsPerInner: o.sku?.unitsPerInner ?? null,
        innersPerCarton: o.sku?.innersPerCarton ?? null,
        cartonsPerPallet: o.sku?.cartonsPerPallet ?? null,
      };
      const base = o.sku?.baseUnit ?? 'PIECE';
      const scheduledQty = toBaseUnits(o.targetQty ?? 0, o.unit ?? base, pkg);

      // The order's OUTPUT is its final routing step, not the sum of its steps —
      // the same rule the engines use. One unit passing four stations is one
      // unit; summing the steps counts it four times.
      let actualQty = 0;
      for (const w of o.workOrders) {
        const steps = [...w.jobOrders].sort((a, b) => a.sequenceOrder - b.sequenceOrder);
        const last = steps[steps.length - 1];
        if (!last) continue;
        actualQty += toBaseUnits(last.actualQtyGood ?? 0, last.outputUnit ?? base, pkg);
      }

      const lineId = o.workOrders.find((w) => w.lineId)?.lineId ?? null;

      await this.prisma.scheduleAttainmentDaily.upsert({
        where: { productionOrderId_day: { productionOrderId: o.id, day: dayStart } },
        create: {
          day: dayStart,
          factoryId: o.factoryId,
          productionOrderId: o.id,
          lineId,
          skuId: o.skuId ?? null,
          scheduledQty,
          actualQty,
          // The credit rule, applied before storage so no reader can forget it.
          creditedQty: Math.min(actualQty, scheduledQty),
          isFinalized: closed,
        },
        update: {
          // A finalised row is never rewritten: that is the whole point. An edit
          // to the plan changes tomorrow's rows, not yesterday's.
          ...(closed ? {} : { scheduledQty, actualQty, creditedQty: Math.min(actualQty, scheduledQty), lineId }),
          isFinalized: closed,
        },
      });
      written += 1;
    }

    this.logger.debug(`attainment ${plantDayKey(dayStart)}: ${written} order(s)${closed ? ' (finalised)' : ''}`);
    return written;
  }

  /**
   * The headline for a window, from the same frozen rows as the trend.
   *
   * ── Why the headline had to move too ────────────────────────────────────
   * The live version summed `targetQty` across orders WITHOUT converting units,
   * and took actual output from `ProductionOrder.completedQty` — a cumulative
   * field maintained elsewhere rather than derived from the final routing step.
   * On this plant that produced 100% against a trend of 5% on the same page:
   * one order measured in pallets and one in inners were added together, and
   * the numerator came from a different source than the denominator.
   *
   * Reading the snapshot fixes both, and guarantees the number and the chart
   * beneath it can never disagree again — they are the same rows.
   */
  async headline(
    factoryId: string | null,
    from: Date,
    to: Date,
    opts: { lineId?: string; skuId?: string } = {},
  ) {
    const rows = await this.prisma.scheduleAttainmentDaily.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(opts.lineId ? { lineId: opts.lineId } : {}),
        ...(opts.skuId ? { skuId: opts.skuId } : {}),
        day: { gte: from, lte: to },
      },
      select: {
        productionOrderId: true, scheduledQty: true, actualQty: true, creditedQty: true,
        productionOrder: { select: { orderNumber: true, status: true, sku: { select: { name: true, code: true } } } },
      },
    });
    if (rows.length === 0) return null;

    // One order can span several days in the window; the credit rule applies to
    // the order, not to the day, so the days are summed back per order first.
    const byOrder = new Map<string, { scheduled: number; actual: number; row: (typeof rows)[number] }>();
    for (const r of rows) {
      const hit = byOrder.get(r.productionOrderId) ?? { scheduled: 0, actual: 0, row: r };
      hit.scheduled = Math.max(hit.scheduled, r.scheduledQty); // the plan, not a sum of itself
      hit.actual += r.actualQty;
      byOrder.set(r.productionOrderId, hit);
    }

    const lines = [...byOrder.entries()].map(([id, v]) => {
      const credited = Math.min(v.actual, v.scheduled);
      return {
        productionOrderId: id,
        orderNumber: v.row.productionOrder?.orderNumber ?? null,
        sku: v.row.productionOrder?.sku?.name ?? v.row.productionOrder?.sku?.code ?? null,
        scheduledQty: v.scheduled,
        actualQty: v.actual,
        creditedQty: credited,
        attainmentPct: v.scheduled > 0 ? Math.round((credited / v.scheduled) * 1000) / 10 : 0,
        status: v.row.productionOrder?.status ?? null,
      };
    });

    const totalScheduledQty = lines.reduce((a, l) => a + l.scheduledQty, 0);
    const totalCreditedQty = lines.reduce((a, l) => a + l.creditedQty, 0);
    const totalActualQty = lines.reduce((a, l) => a + l.actualQty, 0);

    return {
      msaPct: totalScheduledQty > 0 ? Math.round((totalCreditedQty / totalScheduledQty) * 1000) / 10 : 0,
      totalScheduledQty,
      totalCreditedQty,
      totalActualQty,
      orderCount: lines.length,
      window: { from: from.toISOString(), to: to.toISOString() },
      lines: lines.sort((a, b) => a.attainmentPct - b.attainmentPct),
      source: 'snapshot' as const,
      method: {
        formula: 'MSA = Σ min(Actual Qty, Scheduled Qty) ÷ Total Scheduled Qty × 100',
        note:
          'Read from frozen daily rows, so the figure cannot change when somebody edits a plan. '
          + "Quantities are in each product's base unit before they are added, and each order's "
          + 'output is its FINAL routing step — a unit passing four stations is one unit. Each '
          + 'order is credited at most its scheduled quantity, so over-producing one cannot mask '
          + 'a shortfall on another.',
      },
    };
  }

  /**
   * The stored daily series, for the trend.
   *
   * Returns only days that were actually frozen. The caller fills any gap from
   * the live derivation and says which points came from where — a series that
   * silently mixes two definitions is what this was built to stop.
   */
  async trend(
    factoryId: string | null,
    from: Date,
    to: Date,
    opts: { lineId?: string; skuId?: string } = {},
  ): Promise<Array<{ date: Date; day: string; msaPct: number; credited: number; scheduled: number; orders: number }>> {
    const rows = await this.prisma.scheduleAttainmentDaily.groupBy({
      by: ['day'],
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(opts.lineId ? { lineId: opts.lineId } : {}),
        ...(opts.skuId ? { skuId: opts.skuId } : {}),
        day: { gte: from, lte: to },
      },
      _sum: { creditedQty: true, scheduledQty: true },
      _count: { _all: true },
      orderBy: { day: 'asc' },
    });

    return rows.map((r) => {
      const credited = r._sum.creditedQty ?? 0;
      const scheduled = r._sum.scheduledQty ?? 0;
      return {
        date: r.day,
        // The PLANT's day, not the reader's. `day` is stored as the plant-local
        // midnight expressed in UTC — for Riyadh that is 21:00 the evening
        // before, so a browser formatting the instant in its own zone labels the
        // point a day early anywhere west of the plant. The label has to be
        // decided where the day is defined.
        day: plantDayKey(r.day),
        credited,
        scheduled,
        orders: r._count._all,
        msaPct: scheduled > 0 ? Math.round((credited / scheduled) * 1000) / 10 : 0,
      };
    });
  }
}
