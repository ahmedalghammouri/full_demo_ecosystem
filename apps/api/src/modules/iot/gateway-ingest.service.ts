import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';

import { PrismaService } from '../../database/prisma.service';
import { toPieces } from '../../common/units.util';
import { MqttDriverService } from './drivers/mqtt-driver.service';
import { EnergyContextService } from './energy-context.service';
import { KpiService } from '../production/kpi.service';

/** Coalesce window (ms) for counter-driven production events — one journalled row
 *  per job order per window instead of one per MQTT message. Override via env. */
const COUNT_FLUSH_MS = Math.max(5_000, parseInt(process.env.PRODUCTION_EVENT_FLUSH_MS ?? '60000', 10) || 60_000);

interface CountAccumulator {
  factoryId: string;
  workOrderId: string | null;
  machineId: string | null;
  good: number;        // latest cumulative good
  rejected: number;    // latest cumulative rejected
  goodDelta: number;   // summed since last flush
  scrapDelta: number;  // summed since last flush
}

/**
 * Subscribes to the edge gateways' MQTT topics and applies MES business logic:
 *  - `industry360/<factory>/jo/<jobOrderId>/count`  → roll counts up to the Work Order
 *  - `industry360/<factory>/energy/<meterId>`       → enrich the EnergyReading (WO/WorkCenter/state) + anomaly check
 * This keeps the gateway thin (it owns raw writes) while MES roll-up/enrichment stays in the API.
 */
@Injectable()
export class GatewayIngestService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GatewayIngestService.name);
  /** Pending counter deltas keyed by jobOrderId, flushed in batches (anti-bloat). */
  private readonly countBuffer = new Map<string, CountAccumulator>();
  private flushTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttDriverService,
    private readonly eventEmitter: EventEmitter2,
    private readonly energyContext: EnergyContextService,
    private readonly kpi: KpiService,
  ) {}

  onModuleInit() {
    // Ensure the broker forwards gateway messages; concrete topics surface via
    // the driver's 'iot.tag.value' event which we filter below.
    try {
      this.mqtt.subscribeToTag('industry360/+/jo/+/count', () => undefined);
      this.mqtt.subscribeToTag('industry360/+/energy/+', () => undefined);
      this.logger.log('Subscribed to edge-gateway JO count + energy topics');
    } catch (err) {
      this.logger.warn(`Could not subscribe to gateway topics: ${(err as Error).message}`);
    }
    // Periodically flush coalesced counter events to Postgres. High-frequency raw
    // telemetry already streams to InfluxDB on the edge; Postgres only needs the
    // aggregated journal (which the shift/JO trends SUM), so 1 row/JO/window is plenty.
    this.flushTimer = setInterval(() => { void this.flushCounts(); }, COUNT_FLUSH_MS);
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  async onModuleDestroy() {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flushCounts(); // persist whatever is buffered on shutdown
  }

  @OnEvent('iot.tag.value')
  async onMqttMessage(payload: { topic: string; value: unknown }) {
    const body = payload.value && typeof payload.value === 'object' ? (payload.value as Record<string, unknown>) : {};

    const jo = payload.topic?.match(/\/jo\/([^/]+)\/count$/);
    if (jo) {
      const jobOrderId = jo[1];
      try {
        await this.rollUpWorkOrder(jobOrderId);
        // Journal the auto count so the JO-live "Production / Rejects over time" trend
        // includes counter-driven units (one event per count message ≈ poll cadence).
        await this.recordAutoCount(jobOrderId, body);
        // Reflect the auto change EVERYWHERE: recompute WO + PO OEE and emit
        // `production.kpi.updated` (→ live dashboards + historian linkage). Without this
        // the gateway only updated raw WO quantities, not OEE/PO/live trends.
        await this.kpi.propagateFromJobOrder(jobOrderId);
        this.eventEmitter.emit('iot.jo.count', { jobOrderId, ...body });
      } catch (err) {
        this.logger.error(`JO count roll-up failed for ${jobOrderId}`, err as Error);
      }
      return;
    }

    const en = payload.topic?.match(/\/energy\/([^/]+)$/);
    if (en) {
      const readingId = body.readingId as string | undefined;
      const machineId = (body.machineId as string | null | undefined) ?? null;
      if (!readingId) return;
      try {
        await this.energyContext.enrichEnergyReading(readingId, machineId);
        const anomaly = await this.energyContext.detectPowerAnomaly(readingId);
        this.eventEmitter.emit('iot.energy.reading', { meterId: en[1], readingId, ...body, anomaly });
      } catch (err) {
        this.logger.error(`Energy enrich failed for reading ${readingId}`, err as Error);
      }
    }
  }

  /**
   * Buffer a counter-driven count in memory. We DO NOT write a Postgres row per
   * MQTT message (that bloated `production_events` with millions of rows). Instead
   * deltas accumulate per job order and a single coalesced COUNT_UPDATE row is
   * flushed every `COUNT_FLUSH_MS`. Totals are preserved because the shift/JO
   * trends SUM goodDelta/scrapDelta — bucketing by a minute keeps sums exact while
   * cutting row volume by ~60–300×. Raw per-poll telemetry still lives in InfluxDB.
   */
  private async recordAutoCount(jobOrderId: string, body: Record<string, unknown>): Promise<void> {
    const goodDelta = typeof body.goodDelta === 'number' ? body.goodDelta : 0;
    const scrapDelta = typeof body.scrapDelta === 'number' ? body.scrapDelta : 0;
    if (goodDelta === 0 && scrapDelta === 0) return; // nothing new to journal

    const jo = await this.prisma.jobOrder.findUnique({
      where: { id: jobOrderId },
      select: { factoryId: true, workOrderId: true, machineId: true, actualQtyGood: true, actualQtyRejected: true },
    });
    if (!jo) return;
    const good = typeof body.good === 'number' ? body.good : jo.actualQtyGood;
    const rejected = typeof body.rejected === 'number' ? body.rejected : jo.actualQtyRejected;

    const acc = this.countBuffer.get(jobOrderId);
    if (acc) {
      acc.good = good;
      acc.rejected = rejected;
      acc.goodDelta += goodDelta;
      acc.scrapDelta += scrapDelta;
    } else {
      this.countBuffer.set(jobOrderId, {
        factoryId: jo.factoryId,
        workOrderId: jo.workOrderId,
        machineId: jo.machineId,
        good, rejected, goodDelta, scrapDelta,
      });
    }
  }

  /** Persist all buffered counter deltas as one COUNT_UPDATE row per job order. */
  private async flushCounts(): Promise<void> {
    if (this.countBuffer.size === 0) return;
    const batch = [...this.countBuffer.entries()];
    this.countBuffer.clear();
    for (const [jobOrderId, acc] of batch) {
      if (acc.goodDelta === 0 && acc.scrapDelta === 0) continue;
      try {
        const shiftId = await this.resolveActiveShiftId(acc.factoryId, acc.machineId);
        await this.prisma.productionEvent.create({
          data: {
            factoryId: acc.factoryId,
            workOrderId: acc.workOrderId,
            machineId: acc.machineId,
            shiftId,
            eventType: 'COUNT_UPDATE',
            value: acc.goodDelta,
            metadata: { jobOrderId, good: acc.good, rejected: acc.rejected, goodDelta: acc.goodDelta, scrapDelta: acc.scrapDelta, source: 'COUNTER' },
          },
        });
      } catch (err) {
        this.logger.warn(`Failed to flush counter event for JO ${jobOrderId}: ${(err as Error).message}`);
      }
    }
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
    const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
    const today = await this.prisma.shiftInstance.findFirst({
      where: { factoryId, shiftDate: { gte: dayStart }, ...lineWhere },
      orderBy: { startTime: 'desc' }, select: { id: true },
    }).catch(() => null);
    return today?.id ?? null;
  }

  /**
   * Recompute the Work Order's live quantities from its Job Orders:
   *  - goodQty  = good output of the LAST routing step (finished output)
   *  - scrapQty = sum of rejects across all steps
   *  - actualQty = good + scrap
   *
   * All three are written in PIECES (qtyUnit = 'PIECE'), because the steps being
   * combined count in different packaging units and only pieces can add safely.
   */
  private async rollUpWorkOrder(jobOrderId: string): Promise<void> {
    const jo = await this.prisma.jobOrder.findUnique({
      where: { id: jobOrderId },
      select: { workOrderId: true },
    });
    if (!jo?.workOrderId) return;

    const steps = await this.prisma.jobOrder.findMany({
      where: { workOrderId: jo.workOrderId },
      // outputUnit is essential: each step counts in its own packaging level.
      select: {
        sequenceOrder: true, actualQtyGood: true, actualQtyRejected: true, outputUnit: true,
        workOrder: { select: { sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } } } },
      },
    });
    if (!steps.length) return;

    // Everything is normalised to PIECES before it is stored.
    //
    // This is the LIVE write path, so the raw cross-step sum that used to live here
    // did not just produce one bad row — it rewrote goodQty/scrapQty on every counter
    // tick, adding inners to cartons to pallets. Any repair of historical data would
    // have been overwritten within seconds.
    const pkg = steps[0]?.workOrder?.sku ?? null;
    const last = steps.reduce((a, b) => (b.sequenceOrder > a.sequenceOrder ? b : a));
    const good = Math.round(toPieces(last.actualQtyGood ?? 0, last.outputUnit, pkg));
    const scrap = Math.round(
      steps.reduce((s, j) => s + toPieces(j.actualQtyRejected ?? 0, j.outputUnit, pkg), 0),
    );

    await this.prisma.workOrder.update({
      where: { id: jo.workOrderId },
      data: { goodQty: good, scrapQty: scrap, actualQty: good + scrap, qtyUnit: 'PIECE' },
    });
  }
}
