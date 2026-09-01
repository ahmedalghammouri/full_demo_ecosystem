import { Injectable } from '@nestjs/common';
import {
  DowntimeCategory,
  DowntimeReasonCode,
  MachineState,
  MaintStatus,
  MaintType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';

export interface ReliabilityScope {
  areaId?: string;
  lineId?: string;
  machineId?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification constants — the single place where "what counts as a failure"
// is decided. Every MTBF/MTTR surface in the platform reads these, so the
// Maintenance Reports, the Maintenance cockpit and the Downtime Command Center
// can no longer drift apart.
// ─────────────────────────────────────────────────────────────────────────────

/** Stops that are planned work by definition — excluded from failures and from MTTR. */
export const PLANNED_DOWNTIME_CATEGORIES: DowntimeCategory[] = [
  DowntimeCategory.PLANNED_MAINTENANCE,
  DowntimeCategory.PLANNED_CLEANING,
  DowntimeCategory.PLANNED_BREAK,
  DowntimeCategory.CHANGEOVER,
];

/** Reason codes that mark a stop as a genuine equipment breakdown. */
export const FAILURE_REASON_CODES: DowntimeReasonCode[] = [
  DowntimeReasonCode.UNPLANNED_BREAKDOWN,
];

/** Asset-failure categories — a stop here is an equipment failure even under a generic reason code. */
export const FAILURE_DOWNTIME_CATEGORIES: DowntimeCategory[] = [
  DowntimeCategory.MECHANICAL,
  DowntimeCategory.ELECTRICAL,
  DowntimeCategory.UTILITY,
];

/**
 * Unplanned stops that are NOT asset failures: they are supply, demand, quality or
 * speed losses. They hit OEE Availability/Performance but must never enter MTBF/MTTR,
 * otherwise the failure count is inflated and MTBF collapses.
 */
export const NON_FAILURE_DOWNTIME_CATEGORIES: DowntimeCategory[] = [
  DowntimeCategory.MATERIAL,
  DowntimeCategory.OPERATOR,
  DowntimeCategory.QUALITY,
  DowntimeCategory.PROCESS,
  DowntimeCategory.EXTERNAL,
  DowntimeCategory.OTHER,
];

/** Reason codes excluded from failure counting (short interruptions and flow losses). */
export const NON_FAILURE_REASON_CODES: DowntimeReasonCode[] = [
  DowntimeReasonCode.MICRO_STOP,
  DowntimeReasonCode.STARVED,
  DowntimeReasonCode.BLOCKED,
  DowntimeReasonCode.EXTERNAL,
  DowntimeReasonCode.CHANGEOVER,
  DowntimeReasonCode.PLANNED_MAINTENANCE,
];

/** Work-order types that represent an unplanned failure intervention. */
export const FAILURE_WO_TYPES: MaintType[] = [MaintType.CORRECTIVE, MaintType.EMERGENCY];

/** Work-order types that are planned maintenance work (never counted as failures). */
export const PLANNED_WO_TYPES: MaintType[] = [
  MaintType.PREVENTIVE,
  MaintType.INSPECTION,
  MaintType.LUBRICATION,
];

export interface EquipmentReliability {
  /** Breakdown stops in the window (see FAILURE_* constants). */
  failures: number;
  /** Unplanned stops of every kind — the wider set, for reconciliation only. */
  unplannedStops: number;
  failureDowntimeHours: number;
  unplannedDowntimeHours: number;
  plannedDowntimeHours: number;
  totalDowntimeHours: number;
  capacityHours: number;
  uptimeHours: number;
  mttrHours: number;
  mtbfHours: number;
  machineCount: number;
  windowHours: number;
}

export interface MaintenanceReliability {
  /** Corrective + emergency WOs raised in the window. */
  failures: number;
  /** Corrective + emergency WOs completed in the window (the MTTR sample). */
  repairs: number;
  repairHours: number;
  operatingHours: number;
  operatingHoursSource: 'MACHINE_STATE' | 'CALENDAR';
  mttrHours: number;
  mtbfHours: number;
  machineCount: number;
  windowHours: number;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Canonical MTBF / MTTR engine.
 *
 * Two lenses over the same window, because the plant genuinely tracks two things:
 *
 *  • `equipment` — reliability as seen by the line: derived from DowntimeEvent
 *    breakdown stops. This is what the Downtime Command Center shows.
 *  • `maintenance` — reliability as seen by the maintenance function: derived from
 *    corrective/emergency MaintenanceWO records. This is what the Maintenance
 *    Reports and the Maintenance cockpit show.
 *
 * They can legitimately differ (a stop cleared by the operator never becomes a WO;
 * a WO can be raised for an asset that never stopped production), but both now use
 * one set of inclusion rules, one window and one denominator convention, so the
 * difference is explainable instead of arbitrary.
 */
@Injectable()
export class ReliabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolve an analysis scope (area/line/machine) to machine ids (undefined = whole factory). */
  async scopeMachineIds(
    factoryId: string | null,
    scope?: ReliabilityScope,
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

  /** Active machines in scope — the capacity basis for both lenses. */
  private async countMachines(
    factoryId: string | null,
    machineIds: string[] | undefined,
  ): Promise<number> {
    return this.prisma.machine.count({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(machineIds ? { id: { in: machineIds } } : {}),
        isActive: true,
      },
    });
  }

  /**
   * Actual operating (RUNNING) machine-hours in a window, from MachineStateRecord.
   * This is the true MTBF denominator (uptime), not calendar time. Returns 0 when no
   * state segments exist — callers fall back to calendar machine-hours so the metric
   * degrades gracefully until machine-state tracking is populated.
   */
  async sumRunningHours(
    factoryId: string | null,
    machineIds: string[] | undefined,
    start: Date,
    end: Date,
  ): Promise<number> {
    const agg = await this.prisma.machineStateRecord.aggregate({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(machineIds ? { machineId: { in: machineIds } } : {}),
        state: MachineState.RUNNING,
        startTime: { gte: start, lt: end },
      },
      _sum: { durationMinutes: true },
    });
    return (agg._sum.durationMinutes ?? 0) / 60;
  }

  /** True when a downtime event is planned work (planned flag or planned category). */
  isPlannedStop(e: { isPlanned?: boolean | null; category: DowntimeCategory }): boolean {
    return e.isPlanned === true || PLANNED_DOWNTIME_CATEGORIES.includes(e.category);
  }

  /** True when a downtime event is an equipment breakdown → counts toward MTBF/MTTR. */
  isFailureStop(e: {
    isPlanned?: boolean | null;
    category: DowntimeCategory;
    reasonCode?: DowntimeReasonCode | null;
  }): boolean {
    if (this.isPlannedStop(e)) return false;
    if (e.reasonCode && NON_FAILURE_REASON_CODES.includes(e.reasonCode)) return false;
    if (e.reasonCode && FAILURE_REASON_CODES.includes(e.reasonCode)) return true;
    return FAILURE_DOWNTIME_CATEGORIES.includes(e.category);
  }

  /**
   * Equipment lens — MTBF/MTTR from downtime breakdown events.
   *
   *   MTTR = Σ breakdown stop hours ÷ breakdown stop count
   *   MTBF = (capacity hours − all downtime hours) ÷ breakdown stop count
   *   capacity hours = window hours × active machines in scope
   */
  async equipmentReliability(
    factoryId: string | null,
    scope: ReliabilityScope | undefined,
    from: Date,
    to: Date,
    machineIdsIn?: string[],
  ): Promise<EquipmentReliability> {
    const machineIds = machineIdsIn ?? (await this.scopeMachineIds(factoryId, scope));
    const now = new Date();
    const windowEnd = new Date(Math.min(to.getTime(), now.getTime()));

    const [events, machineCount] = await Promise.all([
      this.prisma.downtimeEvent.findMany({
        where: {
          ...(factoryId ? { factoryId } : {}),
          ...(machineIds ? { machineId: { in: machineIds } } : {}),
          startTime: { lte: to },
          OR: [{ endTime: null }, { endTime: { gte: from } }],
        },
        select: {
          startTime: true, endTime: true, durationMinutes: true,
          category: true, reasonCode: true, isPlanned: true, affectsOEE: true,
        },
      }),
      this.countMachines(factoryId, machineIds),
    ]);

    // Clamp every stop to the window so partially-overlapping events are not double counted.
    const clampMin = (e: { startTime: Date; endTime: Date | null }) => {
      const s = Math.max(new Date(e.startTime).getTime(), from.getTime());
      const en = Math.min((e.endTime ? new Date(e.endTime) : now).getTime(), to.getTime());
      return Math.max(0, (en - s) / 60_000);
    };

    let totalMin = 0, plannedMin = 0, unplannedMin = 0, failureMin = 0;
    let failures = 0, unplannedStops = 0;

    for (const e of events) {
      const min = clampMin(e);
      if (min <= 0 && e.endTime) continue;
      totalMin += min;
      if (this.isPlannedStop(e)) {
        plannedMin += min;
        continue;
      }
      unplannedMin += min;
      unplannedStops += 1;
      if (this.isFailureStop(e)) {
        failureMin += min;
        failures += 1;
      }
    }

    const windowHours = Math.max(0.001, (windowEnd.getTime() - from.getTime()) / 3_600_000);
    const capacityHours = windowHours * Math.max(machineCount, 1);
    const uptimeHours = Math.max(0, capacityHours - totalMin / 60);

    return {
      failures,
      unplannedStops,
      failureDowntimeHours: r1(failureMin / 60),
      unplannedDowntimeHours: r1(unplannedMin / 60),
      plannedDowntimeHours: r1(plannedMin / 60),
      totalDowntimeHours: r1(totalMin / 60),
      capacityHours: r1(capacityHours),
      uptimeHours: r1(uptimeHours),
      mttrHours: failures > 0 ? r1(failureMin / 60 / failures) : 0,
      mtbfHours: failures > 0 ? r1(uptimeHours / failures) : r1(uptimeHours),
      machineCount,
      windowHours: r1(windowHours),
    };
  }

  /**
   * Maintenance lens — MTBF/MTTR from corrective/emergency work orders.
   *
   *   MTTR = Σ repair hours ÷ completed corrective+emergency WOs in window
   *   MTBF = operating hours ÷ corrective+emergency WOs raised in window
   *   operating hours = Σ RUNNING machine-state hours, else machines × window hours
   */
  async maintenanceReliability(
    factoryId: string | null,
    scope: ReliabilityScope | undefined,
    from: Date,
    to: Date,
    machineIdsIn?: string[],
  ): Promise<MaintenanceReliability> {
    const machineIds = machineIdsIn ?? (await this.scopeMachineIds(factoryId, scope));
    const factoryFilter = factoryId ? { factoryId } : {};
    const woScope = machineIds ? { machineId: { in: machineIds } } : {};
    const now = new Date();
    const windowEnd = new Date(Math.min(to.getTime(), now.getTime()));

    const [repaired, failures, machineCount, runningHours] = await Promise.all([
      // MTTR sample: repairs actually finished inside the window.
      this.prisma.maintenanceWO.findMany({
        where: {
          ...factoryFilter, ...woScope,
          type: { in: FAILURE_WO_TYPES },
          status: MaintStatus.COMPLETED,
          completedAt: { gte: from, lte: to },
          deletedAt: null,
        },
        select: { actualHours: true, startedAt: true, completedAt: true },
      }),
      // MTBF numerator: failures that occurred (were raised) inside the window.
      this.prisma.maintenanceWO.count({
        where: {
          ...factoryFilter, ...woScope,
          type: { in: FAILURE_WO_TYPES },
          createdAt: { gte: from, lte: to },
          deletedAt: null,
        },
      }),
      this.countMachines(factoryId, machineIds),
      this.sumRunningHours(factoryId, machineIds, from, windowEnd),
    ]);

    // Repair hours: logged actual hours, else the started→completed elapsed time.
    let repairHours = 0;
    let repairs = 0;
    for (const w of repaired) {
      const elapsed = w.startedAt && w.completedAt
        ? (w.completedAt.getTime() - w.startedAt.getTime()) / 3_600_000
        : null;
      const hours = w.actualHours ?? elapsed;
      if (hours == null || hours < 0) continue;
      repairHours += hours;
      repairs += 1;
    }

    const windowHours = Math.max((windowEnd.getTime() - from.getTime()) / 3_600_000, 1);
    const calendarHours = Math.max(machineCount, 1) * windowHours;
    const operatingHours = runningHours > 0 ? runningHours : calendarHours;

    return {
      failures,
      repairs,
      repairHours: r1(repairHours),
      operatingHours: r1(operatingHours),
      operatingHoursSource: runningHours > 0 ? 'MACHINE_STATE' : 'CALENDAR',
      mttrHours: repairs > 0 ? r1(repairHours / repairs) : 0,
      mtbfHours: failures > 0 ? r1(operatingHours / failures) : r1(operatingHours),
      machineCount,
      windowHours: r1(windowHours),
    };
  }

  /** Both lenses over one window, plus the delta that explains any discrepancy. */
  async compute(
    factoryId: string | null,
    scope: ReliabilityScope | undefined,
    from: Date,
    to: Date,
  ) {
    const machineIds = await this.scopeMachineIds(factoryId, scope);
    const [maintenance, equipment] = await Promise.all([
      this.maintenanceReliability(factoryId, scope, from, to, machineIds),
      this.equipmentReliability(factoryId, scope, from, to, machineIds),
    ]);

    return {
      maintenance,
      equipment,
      variance: {
        mtbfHours: r1(maintenance.mtbfHours - equipment.mtbfHours),
        mttrHours: r1(maintenance.mttrHours - equipment.mttrHours),
        failures: maintenance.failures - equipment.failures,
        /** Breakdown stops with no corrective/emergency WO behind them (or vice versa). */
        unlinkedFailures: Math.abs(maintenance.failures - equipment.failures),
      },
      methodology: this.methodology(),
    };
  }

  /**
   * Machine-readable statement of the calculation rules, surfaced in the report UI and
   * the API so the definitions travel with the numbers.
   */
  methodology() {
    return {
      maintenance: {
        source: 'MaintenanceWO (work orders)',
        mttr: 'Σ repair hours ÷ completed CORRECTIVE+EMERGENCY work orders completed in window',
        mtbf: 'Operating hours ÷ CORRECTIVE+EMERGENCY work orders raised in window',
        operatingHours: 'Σ RUNNING machine-state hours in window; falls back to active machines × window hours when no state history exists',
        repairHours: 'WO actual hours when logged, otherwise started→completed elapsed time',
        includes: FAILURE_WO_TYPES,
        excludes: [...PLANNED_WO_TYPES, 'CANCELLED work orders', 'soft-deleted work orders'],
      },
      equipment: {
        source: 'DowntimeEvent (machine stops)',
        mttr: 'Σ breakdown stop hours ÷ breakdown stop count',
        mtbf: '(Capacity hours − all downtime hours) ÷ breakdown stop count',
        capacityHours: 'Window hours × active machines in scope',
        includesReasonCodes: FAILURE_REASON_CODES,
        includesCategories: FAILURE_DOWNTIME_CATEGORIES,
        excludesReasonCodes: NON_FAILURE_REASON_CODES,
        excludesCategories: [...PLANNED_DOWNTIME_CATEGORIES, ...NON_FAILURE_DOWNTIME_CATEGORIES],
        note: 'Open (unclosed) stops are clamped to "now"; stops overlapping the window edges are clamped to the window.',
      },
      whyTheyDiffer: [
        'Different event source: a stop cleared by the operator never becomes a work order, and a work order can be raised without a production stop.',
        'MTTR basis: equipment MTTR is the production time lost; maintenance MTTR is the technician wrench time logged on the work order.',
        'MTBF denominator: equipment MTBF uses capacity minus all downtime; maintenance MTBF uses RUNNING machine-state hours.',
        'Window: both lenses use the report window; the Maintenance cockpit KPI cards use month-to-date by design.',
      ],
    };
  }
}
