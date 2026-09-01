import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';

import { PrismaService } from '../../database/prisma.service';
import { InfluxService } from '../historian/influx.service';
import { MqttMonitorService } from '../iot/mqtt-monitor.service';
import { ResetSystemDto } from './dto/reset.dto';
import { UNIT_LADDER, normaliseUnit } from '../../common/units.util';

const CONFIRM_PHRASE = 'RESET';
/** Broker-wide control topic the edge gateway subscribes to (retained). */
const HISTORIAN_CONTROL_TOPIC = 'industry360/control/historian';

interface ActingUser {
  id: string;
  email: string;
  passwordHash: string;
  factoryId?: string | null;
}

@Injectable()
export class SystemService {
  private readonly logger = new Logger(SystemService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly influx: InfluxService,
    private readonly mqtt: MqttMonitorService,
  ) {}

  /**
   * Snapshot of how much data each resettable subsystem currently holds —
   * drives the Danger-Zone status panel.
   */
  async getStatus() {
    const [
      productionOrders,
      workOrders,
      jobOrders,
      productionEvents,
      batchRecords,
      materialConsumptions,
      jobOrderMaterials,
      scrapLogs,
      rescheduleRequests,
      genealogyLinks,
      energyWoSummaries,
      energyWoMachineKpis,
      oeeRecords,
      machineStateRecords,
      machineRuntimeHours,
      traceabilityLinks,
      traceEvents,
      finishedGoodsLots,
      shiftInstances,
      // energy meter history — its own scope
      energyReadings,
      energySummaries,
      // kept / unlinked
      inspections,
      maintenanceOrders,
      downtimeEvents,
      spcMeasurements,
    ] = await this.prisma.$transaction([
      this.prisma.productionOrder.count(),
      this.prisma.workOrder.count(),
      this.prisma.jobOrder.count(),
      this.prisma.productionEvent.count(),
      this.prisma.batchRecord.count(),
      this.prisma.materialConsumption.count(),
      this.prisma.jobOrderMaterial.count(),
      this.prisma.scrapLog.count(),
      this.prisma.rescheduleRequest.count(),
      this.prisma.genealogyLink.count(),
      this.prisma.energyWOSummary.count(),
      this.prisma.energyWOMachineKpi.count(),
      this.prisma.oEERecord.count(),
      this.prisma.machineStateRecord.count(),
      this.prisma.machineRuntimeHours.count(),
      this.prisma.traceabilityLink.count(),
      this.prisma.traceEvent.count(),
      this.prisma.finishedGoodsLot.count(),
      this.prisma.shiftInstance.count(),
      this.prisma.energyReading.count(),
      this.prisma.energySummary.count(),
      this.prisma.inspectionResult.count(),
      this.prisma.maintenanceWO.count(),
      this.prisma.downtimeEvent.count(),
      this.prisma.sPCMeasurement.count(),
    ]);

    const influxPoints = await this.influx.countPoints();

    const production = {
      productionOrders,
      workOrders,
      jobOrders,
      productionEvents,
      batchRecords,
      materialConsumptions,
      jobOrderMaterials,
      scrapLogs,
      rescheduleRequests,
      genealogyLinks,
      energyWoSummaries,
      energyWoMachineKpis,
      oeeRecords,
      machineStateRecords,
      machineRuntimeHours,
      traceabilityLinks,
      traceEvents,
      finishedGoodsLots,
      shiftInstances,
    };
    const productionTotal = Object.values(production).reduce((a, b) => a + b, 0);

    // Energy meter history is reported and reset separately — see resetEnergy().
    const energy = { energyReadings, energySummaries, energyWoSummaries, energyWoMachineKpis };
    const energyTotal = Object.values(energy).reduce((a, b) => a + b, 0);

    // Per-subsystem totals for the individually resettable areas. Counted with
    // cheap COUNT(*) queries rather than derived from the numbers above, because
    // the scopes overlap: downtime events belong to both the downtime reset and
    // the shift reset, and a derived figure would disagree with what the reset
    // actually deletes.
    const counts = await this.subsystemCounts();

    return {
      production,
      productionTotal,
      energy,
      energyTotal,
      counts,
      preserved: { inspections, maintenanceOrders, downtimeEvents, spcMeasurements },
      timeseries: {
        enabled: this.influx.isEnabled(),
        bucket: this.influx.getBucket(),
        points: influxPoints,
        paused: this.influx.isPaused(),
      },
    };
  }

  /** Pause/resume ALL historian writes — both the API's own scheduler AND the
   *  edge gateway (via a retained MQTT control message it subscribes to). Lets the
   *  owner keep the bucket empty after a wipe. Retained so a gateway that restarts
   *  picks up the current state on reconnect. */
  setHistorianPaused(paused: boolean) {
    this.influx.setPaused(paused);
    // Broadcast to the edge gateway(s), which write to InfluxDB directly.
    this.mqtt.publish(HISTORIAN_CONTROL_TOPIC, { paused }, true);
    return { paused: this.influx.isPaused() };
  }

  /**
   * Execute a destructive reset. Re-verifies the owner's password and the
   * safety phrase, performs the deletion in a single committed transaction,
   * optionally wipes the historian, and records an audit log.
   */
  async reset(user: ActingUser, dto: ResetSystemDto, ctx: { ip?: string; userAgent?: string }) {
    // 1. Re-authenticate — password must be re-entered for any destructive action.
    const passwordOk = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordOk) throw new UnauthorizedException('Password is incorrect');

    // 2. Typed safety phrase must match exactly.
    if ((dto.confirmation ?? '').trim() !== CONFIRM_PHRASE) {
      throw new BadRequestException(`Confirmation phrase must be exactly "${CONFIRM_PHRASE}"`);
    }

    const summary: Record<string, number> = {};
    let timeseriesWiped = false;

    if (dto.scope === 'energy') {
      Object.assign(summary, await this.resetEnergy());
    } else if (dto.scope === 'production') {
      Object.assign(summary, await this.resetProduction());
      if (dto.wipeTimeseries) {
        timeseriesWiped = await this.influx.wipeBucket();
      }
    } else if (dto.scope === 'timeseries') {
      timeseriesWiped = await this.influx.wipeBucket();
    } else if (dto.scope === 'quality') {
      Object.assign(summary, await this.resetQuality());
    } else if (dto.scope === 'maintenance') {
      Object.assign(summary, await this.resetMaintenance());
    } else if (dto.scope === 'downtime') {
      Object.assign(summary, await this.resetDowntime());
    } else if (dto.scope === 'plannedDowntime') {
      Object.assign(summary, await this.resetPlannedDowntime(dto.from, dto.to));
    } else if (dto.scope === 'alarms') {
      Object.assign(summary, await this.resetAlarms());
    } else if (dto.scope === 'inventory') {
      Object.assign(summary, await this.resetInventory());
    } else if (dto.scope === 'shifts') {
      Object.assign(summary, await this.resetShifts());
    } else if (dto.scope === 'notifications') {
      Object.assign(summary, await this.resetNotifications());
    }

    // 3. Audit trail (best-effort — never blocks the reset result).
    try {
      await this.prisma.auditLog.create({
        data: {
          factoryId: user.factoryId ?? null,
          userId: user.id,
          action: 'SYSTEM_RESET',
          module: 'system',
          entityType: 'System',
          entityId: dto.scope,
          metadata: {
            scope: dto.scope,
            wipeTimeseries: !!dto.wipeTimeseries,
            timeseriesWiped,
            deleted: summary,
            actor: user.email,
            ip: ctx.ip ?? null,
            userAgent: ctx.userAgent ?? null,
          },
        },
      });
    } catch (err) {
      this.logger.error('Failed to write SYSTEM_RESET audit log', err as any);
    }

    this.logger.warn(
      `SYSTEM_RESET scope=${dto.scope} by ${user.email} — deleted ${JSON.stringify(summary)} timeseriesWiped=${timeseriesWiped}`,
    );

    return { scope: dto.scope, deleted: summary, timeseriesWiped };
  }

  /**
   * Replicates the verified production-data wipe: removes all production orders,
   * work orders, job orders and every dependent record, while preserving and
   * unlinking quality inspections, maintenance work orders, downtime events and
   * SPC measurements. Runs as one committed transaction.
   */
  /**
   * How many records each scoped reset would remove.
   *
   * Every count is individually guarded: a model missing from this deployment's
   * schema reports zero rather than failing the whole status call, which is the
   * only thing standing between one optional table and a blank Danger Zone.
   */
  private async subsystemCounts(): Promise<Record<string, number>> {
    const p = this.prisma as any;
    const safe = async (fn: () => Promise<number>) => {
      try {
        return await fn();
      } catch {
        // Model absent from this deployment's schema, or the table is not
        // there yet. Zero is the truthful answer for "nothing to delete".
        return 0;
      }
    };

    const [
      downtimeEvents, machineStates, plannedEvents, plannedStates,
      inspections, spc, ncrs,
      maintenanceOrders, alarms, shiftInstances, stockMoves, notifications,
    ] = await Promise.all([
      safe(() => p.downtimeEvent.count()),
      safe(() => p.machineStateRecord.count()),
      safe(() => p.downtimeEvent.count({ where: { isPlanned: true } })),
      safe(() => p.machineStateRecord.count({ where: { isPlannedStop: true } })),
      safe(() => p.inspectionResult.count()),
      safe(() => p.sPCMeasurement.count()),
      safe(() => p.nCR.count()),
      safe(() => p.maintenanceWO.count()),
      safe(() => p.alarmEvent.count()),
      safe(() => p.shiftInstance.count()),
      safe(() => p.stockMovement.count()),
      safe(() => p.notification.count()),
    ]);

    return {
      downtime: downtimeEvents + machineStates,
      // The whole-history figure, shown until a window is chosen. Picking a
      // range replaces it with what that range actually holds — a fixed number
      // beside a range control invites reading it as the range's total.
      plannedDowntime: plannedEvents + plannedStates,
      quality: inspections + spc + ncrs,
      maintenance: maintenanceOrders,
      alarms,
      shifts: shiftInstances,
      inventory: stockMoves,
      notifications,
    };
  }

  /**
   * A counting delete that survives a model this deployment does not have.
   *
   * The `.catch()` this replaces did not work. `tx.someModel.deleteMany({})`
   * throws SYNCHRONOUSLY when the delegate is undefined — there is no promise yet
   * for `.catch` to attach to — so one wrong model name took down the whole scope
   * with "Cannot read properties of undefined (reading 'deleteMany')" instead of
   * quietly counting zero. Exactly the failure the guard existed to prevent, and
   * it went unnoticed because the guard looked like it was there.
   *
   * try/catch covers both: a delegate that is absent, and a delete that fails.
   */
  private deleter(out: Record<string, number>) {
    return async (name: string, fn: () => Promise<{ count: number }>) => {
      try {
        out[name] = (await fn()).count;
      } catch (err) {
        this.logger.warn(`reset: ${name} skipped — ${(err as Error).message}`);
        out[name] = 0;
      }
    };
  }

  // ── Scoped resets ─────────────────────────────────────────────────────────
  // Each clears one self-contained subsystem's HISTORY and leaves its
  // CONFIGURATION alone. They are separate because "reset everything" is almost
  // never what somebody wants: clearing a demo's production history should not
  // cost the plant its quality catalogue or its maintenance plan.
  //
  // Prisma has no "delete if the table exists", so optional models are wrapped
  // in a catch that yields zero — a schema without CAPA must not fail a quality
  // reset that would otherwise have succeeded.

  /** Inspections, non-conformances, CAPAs and SPC measurements. */
  private async resetQuality(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx: any) => {
      const out: Record<string, number> = {};
      const del = this.deleter(out);
      await del('spcMeasurements', () => tx.sPCMeasurement.deleteMany({}));
      await del('inspectionResults', () => tx.inspectionResult.deleteMany({}));
      await del('capaActions', () => tx.cAPAAction.deleteMany({}));
      await del('capas', () => tx.cAPA.deleteMany({}));
      await del('ncrs', () => tx.nCR.deleteMany({}));
      return out;
    }, { timeout: 120_000 });
  }

  /** Maintenance work orders and scheduled PM tasks. Assets and PM plans stay. */
  private async resetMaintenance(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx: any) => {
      const out: Record<string, number> = {};
      const del = this.deleter(out);
      // PMTask is a SCHEDULED OCCURRENCE of a PM plan, not part of the plan — the
      // plan survives and can regenerate them. The delegate is `pMTask`: Prisma
      // lowercases only the first character, so `PMTask` becomes `pMTask`, and the
      // `maintenanceTask` this used to call has never existed.
      await del('pmTasks', () => tx.pMTask.deleteMany({}));
      // Spare-part lines and failure-mode links cascade from the work order.
      await del('maintenanceOrders', () => tx.maintenanceWO.deleteMany({}));
      return out;
    }, { timeout: 120_000 });
  }

  /**
   * Downtime events AND the machine state timeline behind them.
   *
   * Cleared together deliberately: the two describe the same minutes from two
   * angles, and clearing one alone leaves the OEE engine with a timeline that
   * has no reasons, or reasons with no timeline. Causes stay — they are
   * configuration.
   */
  private async resetDowntime(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx: any) => {
      const out: Record<string, number> = {};
      out.downtimeEvents = (await tx.downtimeEvent.deleteMany({})).count;
      out.machineStateRecords = (await tx.machineStateRecord.deleteMany({})).count;
      return out;
    }, { timeout: 120_000 });
  }

  /**
   * Planned downtime in a window — the only reset that deletes part of a
   * history rather than all of it.
   *
   * ── Why it needs to exist ───────────────────────────────────────────────
   * A schedule entered wrong for two days is an ordinary mistake, and the
   * remedies before this were both bad: reset ALL downtime, losing every real
   * breakdown around it, or run SQL against production by hand. Planned time is
   * the one history a plant routinely needs to correct in part, because it is
   * the one it AUTHORS rather than measures.
   *
   * ── What it removes ─────────────────────────────────────────────────────
   * Both halves of the same minutes, for the same reason the full downtime
   * reset clears both: the planned EVENT is what the plant booked, and the
   * PLANNED_STOP state record is that minute on the timeline. Clearing one
   * leaves the other describing a stop with no counterpart — a band with no
   * reason, or a reason that draws nowhere.
   *
   * Unplanned downtime inside the same window is untouched. So is every sensor
   * record: a machine that genuinely broke down during a cancelled cleaning
   * window still broke down, and that is a measurement, not a plan.
   */
  private async resetPlannedDowntime(from?: string, to?: string): Promise<Record<string, number>> {
    if (!from || !to) {
      throw new BadRequestException(
        'A date range is required for this reset. Deleting planned downtime with no window '
        + 'would clear the whole history, which is what the full Downtime reset is for.',
      );
    }
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('The date range could not be read.');
    }
    if (end <= start) {
      throw new BadRequestException('The range ends before it starts.');
    }

    // Overlap, not containment: a stop that began before the window and runs
    // into it is inside the period the operator drew, and leaving it because it
    // started five minutes early is not a distinction anyone means.
    const overlaps = {
      startTime: { lt: end },
      OR: [{ endTime: null }, { endTime: { gt: start } }],
    };

    return this.prisma.$transaction(async (tx: any) => {
      const out: Record<string, number> = {};
      out.plannedDowntimeEvents = (await tx.downtimeEvent.deleteMany({
        where: { isPlanned: true, ...overlaps },
      })).count;
      out.plannedStateRecords = (await tx.machineStateRecord.deleteMany({
        where: {
          isPlannedStop: true,
          ...overlaps,
        },
      })).count;
      return out;
    }, { timeout: 120_000 });
  }

  /**
   * How much a given window actually holds, before anything is deleted.
   *
   * The Danger Zone prints "Affected records" beside every reset, and for a
   * scope with a date range a whole-history number would be a lie in the one
   * place it matters most. Same overlap rule the delete uses, so the figure the
   * operator confirms is the figure that goes.
   */
  async previewPlannedDowntime(from?: string, to?: string): Promise<{
    from: string | null; to: string | null;
    plannedDowntimeEvents: number; plannedStateRecords: number; total: number;
  }> {
    if (!from || !to) return { from: null, to: null, plannedDowntimeEvents: 0, plannedStateRecords: 0, total: 0 };
    const start = new Date(from);
    const end = new Date(to);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      return { from: null, to: null, plannedDowntimeEvents: 0, plannedStateRecords: 0, total: 0 };
    }

    const overlaps = {
      startTime: { lt: end },
      OR: [{ endTime: null }, { endTime: { gt: start } }],
    };
    const p = this.prisma as any;
    const [events, states] = await Promise.all([
      p.downtimeEvent.count({ where: { isPlanned: true, ...overlaps } }),
      p.machineStateRecord.count({ where: { isPlannedStop: true, ...overlaps } }),
    ]);
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      plannedDowntimeEvents: events,
      plannedStateRecords: states,
      total: events + states,
    };
  }

  /** Alarm history. Alarm DEFINITIONS are configuration and are preserved. */
  private async resetAlarms(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx: any) => {
      const out: Record<string, number> = {};
      out.alarmEvents = (await tx.alarmEvent.deleteMany({})).count;
      return out;
    }, { timeout: 120_000 });
  }

  /** Stock movement history. Items, locations and levels are master data. */
  private async resetInventory(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx: any) => {
      const out: Record<string, number> = {};
      const del = this.deleter(out);
      // StockMovement IS the transaction log — there is no second `InventoryTransaction`
      // model and there never was, so the call that used to sit here could only ever
      // throw. Stock LEVELS are master data and are deliberately left alone.
      await del('stockMovements', () => tx.stockMovement.deleteMany({}));
      return out;
    }, { timeout: 120_000 });
  }

  /**
   * Shift instances and the planned stops materialised from them.
   *
   * Shift templates, schedules and planned-stop definitions survive — they are
   * how the plant is configured to run. This clears only what was generated, so
   * a fresh range can be materialised cleanly.
   */
  private async resetShifts(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx: any) => {
      const out: Record<string, number> = {};
      out.plannedDowntimeEvents = (await tx.downtimeEvent.deleteMany({ where: { isPlanned: true } })).count;
      out.shiftInstances = (await tx.shiftInstance.deleteMany({})).count;
      return out;
    }, { timeout: 120_000 });
  }

  /** Notification history — noise that accumulates over a long demo. */
  private async resetNotifications(): Promise<Record<string, number>> {
    return this.prisma.$transaction(async (tx: any) => {
      const out: Record<string, number> = {};
      const del = this.deleter(out);
      await del('notifications', () => tx.notification.deleteMany({}));
      return out;
    }, { timeout: 120_000 });
  }

  private async resetProduction(): Promise<Record<string, number>> {
    return this.prisma.$transaction(
      async (tx) => {
        // a. Detach records we keep so the parent deletions don't cascade them away.
        await tx.inspectionResult.updateMany({ data: { workOrderId: null, batchRecordId: null } });
        await tx.downtimeEvent.updateMany({ data: { workOrderId: null } });
        await tx.maintenanceWO.updateMany({ data: { productionWOId: null } });
        await tx.sPCMeasurement.updateMany({ data: { workOrderId: null } });

        // b. Delete dependent children first, then parents.
        const jobOrderMaterials = (await tx.jobOrderMaterial.deleteMany({})).count;
        const scrapLogs = (await tx.scrapLog.deleteMany({})).count;
        const materialConsumptions = (await tx.materialConsumption.deleteMany({})).count;
        const productionEvents = (await tx.productionEvent.deleteMany({})).count;
        const genealogyLinks = (await tx.genealogyLink.deleteMany({})).count;
        const energyWoSummaries = (await tx.energyWOSummary.deleteMany({})).count;
        // Per work-order × machine energy ratios. These cascade from workOrder,
        // but are deleted (and counted) explicitly so the reported blast radius
        // matches what actually goes.
        const energyWoMachineKpis = (await tx.energyWOMachineKpi.deleteMany({})).count;
        const rescheduleRequests = (await tx.rescheduleRequest.deleteMany({})).count;

        // c. Production KPI history. None of this cascades from the work order —
        //    it is keyed on machine/shift/date — so without deleting it here a
        //    "reset" left OEE charts, machine-state timelines and the snapshot
        //    fact store fully populated against orders that no longer exist.
        const oeeRecords = (await tx.oEERecord.deleteMany({})).count;
        const machineStateRecords = (await tx.machineStateRecord.deleteMany({})).count;
        const machineRuntimeHours = (await tx.machineRuntimeHours.deleteMany({})).count;

        // d. Traceability + finished goods produced by those orders.
        const traceabilityLinks = (await tx.traceabilityLink.deleteMany({})).count;
        const traceEvents = (await tx.traceEvent.deleteMany({})).count;
        const finishedGoodsLots = (await tx.finishedGoodsLot.deleteMany({})).count;

        const batchRecords = (await tx.batchRecord.deleteMany({})).count;
        const jobOrders = (await tx.jobOrder.deleteMany({})).count;
        const workOrders = (await tx.workOrder.deleteMany({})).count;
        const productionOrders = (await tx.productionOrder.deleteMany({})).count;

        // e. Shift instances last — work orders, OEE records, machine states and
        //    snapshots all reference them, so they can only go once those are gone.
        //    They carry their own actualQty/goodQty/OEE, i.e. production history.
        const shiftInstances = (await tx.shiftInstance.deleteMany({})).count;

        return {
          productionOrders,
          workOrders,
          jobOrders,
          productionEvents,
          batchRecords,
          materialConsumptions,
          jobOrderMaterials,
          scrapLogs,
          rescheduleRequests,
          genealogyLinks,
          energyWoSummaries,
          energyWoMachineKpis,
          oeeRecords,
          machineStateRecords,
          machineRuntimeHours,
          traceabilityLinks,
          traceEvents,
          finishedGoodsLots,
          shiftInstances,
        };
      },
      { timeout: 120_000 },
    );
  }

  /**
   * Energy meter history in PostgreSQL: raw readings, period summaries and the
   * derived per-WO / per-machine ratios.
   *
   * Deliberately a scope of its own rather than part of the production reset:
   * these are real measurements streamed from physical meters and are keyed on
   * the meter, not on a work order. Sweeping them up with a production wipe would
   * silently destroy metering history that has nothing to do with the orders
   * being cleared. Meters, tariffs and device bindings are configuration and are
   * always preserved.
   */
  private async resetEnergy(): Promise<Record<string, number>> {
    return this.prisma.$transaction(
      async (tx) => {
        const energyWoMachineKpis = (await tx.energyWOMachineKpi.deleteMany({})).count;
        const energyWoSummaries = (await tx.energyWOSummary.deleteMany({})).count;
        const energySummaries = (await tx.energySummary.deleteMany({})).count;
        const energyReadings = (await tx.energyReading.deleteMany({})).count;
        return { energyReadings, energySummaries, energyWoSummaries, energyWoMachineKpis };
      },
      { timeout: 120_000 },
    );
  }
  /**
   * The factory's DISPLAY unit — how quantities are presented, nothing more.
   *
   * All stored quantities and all internal arithmetic are in PIECES (see
   * common/units.util.ts), because that is the only unit in which output from
   * different routing steps can be added. This setting therefore cannot change a
   * calculation; it only decides the rung the user reads totals on.
   */
  async getDisplayUnit(factoryId: string | null): Promise<{ displayUnit: string; ladder: string[] }> {
    const ladder = [...UNIT_LADDER];
    if (!factoryId) return { displayUnit: 'PIECE', ladder };
    const f = await this.prisma.factory.findUnique({
      where: { id: factoryId },
      select: { displayUnit: true },
    });
    return { displayUnit: f?.displayUnit ?? 'PIECE', ladder };
  }

  // ────────────────────────────────────────────────────────────
  // PLANNED-STOP MATERIALISATION — off unless a plant asks for it
  // ────────────────────────────────────────────────────────────

  async getPlannedStopMaterialisation(factoryId: string | null): Promise<{ enabled: boolean }> {
    if (!factoryId) return { enabled: false };
    const f = await this.prisma.factory.findUnique({
      where: { id: factoryId },
      select: { plannedStopMaterialisation: true },
    });
    return { enabled: f?.plannedStopMaterialisation ?? false };
  }

  /**
   * Turn the writer on or off.
   *
   * Switching OFF stops the hourly job and leaves the rows it already wrote.
   * Deleting them here would be a second, unasked-for action hiding behind a
   * toggle — and on a plant that had been running this for weeks it would
   * rewrite the timeline for every one of those weeks. Removing them is the
   * materialiser's own job, run deliberately.
   */
  async setPlannedStopMaterialisation(factoryId: string | null, enabled: boolean) {
    if (!factoryId) throw new BadRequestException('No factory in scope.');
    const f = await this.prisma.factory.update({
      where: { id: factoryId },
      data: { plannedStopMaterialisation: enabled },
      select: { plannedStopMaterialisation: true },
    });
    return { enabled: f.plannedStopMaterialisation };
  }

  async setDisplayUnit(factoryId: string | null, unit: string) {
    if (!factoryId) throw new BadRequestException('No factory in scope.');
    const rung = normaliseUnit(unit);
    if (!rung) {
      throw new BadRequestException(
        `"${unit}" is not a packaging unit. Choose one of: ${UNIT_LADDER.join(', ')}.`,
      );
    }
    const f = await this.prisma.factory.update({
      where: { id: factoryId },
      data: { displayUnit: rung },
      select: { displayUnit: true },
    });
    return { displayUnit: f.displayUnit };
  }

}
