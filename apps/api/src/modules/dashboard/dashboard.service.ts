import { Injectable, ForbiddenException } from '@nestjs/common';
import { plantBound } from '../../common/plant-time.util';
import { PrismaService } from '../../database/prisma.service';
import { toPieces } from '../../common/units.util';
import { KpiService } from '../production/kpi.service';
import { ShiftService } from '../shift/shift.service';
import { currentShiftStart, currentShiftWindow } from '../../common/shift-window.util';
import { EnergyService } from '../energy/energy.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kpi: KpiService,
    private readonly shift: ShiftService,
    private readonly energy: EnergyService,
  ) {}

  /**
   * Command Center — the unified flagship cockpit. Composes the existing engines in
   * one round-trip so the native React command-center page renders production OEE,
   * losses, energy and an executive (cross-unit) rollup from a single call. Honors
   * the active analysis scope (area/line/machine) + time window, exactly like every
   * other dashboard surface.
   */
  async getCommandCenter(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
    range?: { timeframe?: string; dateFrom?: string; dateTo?: string },
  ) {
    const [ops, energyOverview, livePower, executive] = await Promise.all([
      this.getOverview(factoryId, scope, range),
      this.energy.getOverview(factoryId, scope).catch(() => null),
      this.energy.getLivePower(factoryId, scope).catch(() => null),
      this.getExecutiveBreakdown(factoryId, range).catch(() => null),
    ]);

    return {
      scope: scope && (scope.areaId || scope.lineId || scope.machineId) ? scope : null,
      ops,
      energy: energyOverview ? { ...energyOverview, live: livePower } : null,
      executive,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Executive "zoom-out" comparison for the Command Center. When the caller has no
   * factory context (enterprise / SUPER_ADMIN) it compares OEE + output + energy cost
   * across all active factories; within a factory it compares the factory's areas.
   * Intentionally ignores the area/line/machine scope (this IS the wide-angle view).
   */
  private async getExecutiveBreakdown(
    factoryId: string | null,
    range?: { timeframe?: string; dateFrom?: string; dateTo?: string },
  ) {
    const win = await this.resolveWindow(factoryId, range);
    const bucket: 'hour' | 'day' = win.multiDay ? 'day' : 'hour';

    if (!factoryId) {
      const factories = await this.prisma.factory.findMany({
        where: { isActive: true },
        select: { id: true, code: true, name: true, nameAr: true },
      });
      const rows = await Promise.all(
        factories.map(async (f) => {
          const [a, e] = await Promise.all([
            this.kpi.oeeAnalytics(f.id, win.from, win.to, undefined, bucket, { slotTo: win.slotTo }),
            this.energy.getOverview(f.id).catch(() => null),
          ]);
          return {
            id: f.id, code: f.code, name: f.name, nameAr: f.nameAr,
            oee: a.current.oee, output: a.totalOutput, costMtd: e?.totalCostMtd ?? 0,
          };
        }),
      );
      return { dimension: 'factory' as const, rows: rows.sort((x, y) => y.oee - x.oee) };
    }

    const areas = await this.prisma.area.findMany({
      where: { factoryId, isActive: true },
      select: { id: true, code: true, name: true, nameAr: true },
    });
    const rows = await Promise.all(
      areas.map(async (ar) => {
        const machineIds = await this.scopeMachineIds(factoryId, { areaId: ar.id });
        if (!machineIds || machineIds.length === 0) {
          return { id: ar.id, code: ar.code, name: ar.name, nameAr: ar.nameAr, oee: 0, output: 0, costMtd: 0 };
        }
        const a = await this.kpi.oeeAnalytics(factoryId, win.from, win.to, machineIds, bucket, { slotTo: win.slotTo });
        return { id: ar.id, code: ar.code, name: ar.name, nameAr: ar.nameAr, oee: a.current.oee, output: a.totalOutput, costMtd: 0 };
      }),
    );
    return { dimension: 'area' as const, rows: rows.sort((x, y) => y.oee - x.oee) };
  }

  /** Resolve an analysis scope (area/line/machine) to the machine ids it covers. */
  private async scopeMachineIds(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
  ): Promise<string[] | undefined> {
    if (!scope || (!scope.areaId && !scope.lineId && !scope.machineId)) return undefined;
    const ms = await this.prisma.machine.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(scope.machineId ? { id: scope.machineId } : {}),
        ...(scope.lineId ? { lineId: scope.lineId } : {}),
        ...(scope.areaId ? { line: { areaId: scope.areaId } } : {}),
      },
      select: { id: true },
    });
    return ms.map((m) => m.id);
  }

  /**
   * Resolve the requested analysis window. Defaults to "today" (00:00 → now)
   * when no range is given, and derives an equal-length previous window for trends.
   */
  private async resolveWindow(
    factoryId: string | null,
    range?: { timeframe?: string; dateFrom?: string; dateTo?: string },
  ) {
    const now = new Date();
    let from: Date;
    let to: Date = now;
    /**
     * How far the committed slot reaches.
     *
     * `to` is clamped to now so planned time does not accrue for hours that
     * have not happened; the schedule basis needs the unclamped end, because
     * the part of a slot an order has not reached yet is exactly what makes
     * that reading climb. Left unset, the KPI layer guessed it as the end of
     * the plant day, which is wrong for a shift — these dashboards read OEE
     * 6.0% / A 17.1% against /oee-schedule's 28.3% / 80.9% for one request.
     */
    let slotTo: Date = now;

    if ((range?.timeframe ?? '').toLowerCase() === 'shift') {
      // Real current-shift window (start → now), resolved from shift templates.
      const shift = await currentShiftWindow(this.prisma, factoryId);
      from = shift?.start ?? (() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; })();
      // The slot runs to the end of the SHIFT, not to now.
      slotTo = shift?.end ?? (() => { const d = new Date(now); d.setHours(23, 59, 59, 999); return d; })();
    } else if (range?.dateFrom) {
      from = plantBound(range.dateFrom, 'start') ?? new Date();
      if (range.dateTo) {
        const end = plantBound(range.dateTo, 'end') ?? new Date();
        to = end < now ? end : now;
        slotTo = end;
      }
    } else {
      from = new Date(now);
      from.setHours(0, 0, 0, 0); // today
    }
    if (isNaN(from.getTime())) {
      from = new Date(now);
      from.setHours(0, 0, 0, 0);
    }

    const spanMs = Math.max(to.getTime() - from.getTime(), 3_600_000);
    const prevTo = new Date(from.getTime());
    const prevFrom = new Date(from.getTime() - spanMs);
    const multiDay = spanMs > 36 * 3_600_000;
    return { from, to, slotTo, prevFrom, prevTo, spanMs, multiDay };
  }

  /**
   * Executive multi-plant cockpit — enterprise rollup across factories. For each active
   * factory: window OEE (+ A/P/Q) and output, energy cost/consumption MTD, and open
   * alarm / NCR / maintenance counts, plus enterprise totals. A factory-scoped user
   * sees only their own factory row (the page still renders).
   */
  async getExecutive(
    factoryId: string | null,
    range?: { timeframe?: string; dateFrom?: string; dateTo?: string },
  ) {
    const win = await this.resolveWindow(factoryId, range);
    const bucket: 'hour' | 'day' = win.multiDay ? 'day' : 'hour';
    const r1 = (n: number) => Math.round(n * 10) / 10;
    const r2 = (n: number) => Math.round(n * 100) / 100;

    const factories = await this.prisma.factory.findMany({
      where: { isActive: true, ...(factoryId ? { id: factoryId } : {}) },
      select: { id: true, code: true, name: true, nameAr: true },
    });

    const rows = await Promise.all(
      factories.map(async (f) => {
        const [a, e, alarms, ncrs, maint] = await Promise.all([
          this.kpi.oeeAnalytics(f.id, win.from, win.to, undefined, bucket, { slotTo: win.slotTo }),
          this.energy.getOverview(f.id).catch(() => null),
          this.prisma.alarmEvent.count({ where: { factoryId: f.id, resolvedAt: null } }),
          this.prisma.nCR.count({ where: { factoryId: f.id, status: 'OPEN' } }),
          this.prisma.maintenanceWO.count({ where: { factoryId: f.id, status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] }, deletedAt: null } }),
        ]);
        return {
          id: f.id, code: f.code, name: f.name, nameAr: f.nameAr,
          oee: a.current.oee, availability: a.current.availability, performance: a.current.performance, quality: a.current.quality,
          // Time-based twin, so the executive table honours the schedule-vs-time-based
          // toggle instead of being the one screen frozen on the schedule basis.
          oeeTb: a.current.oeeTb, availabilityTb: a.current.availabilityTb,
          output: a.totalOutput,
          costMtd: e?.totalCostMtd ?? 0,
          electricalMtd: e?.totalConsumptionMtd ?? 0,
          activeAlarms: alarms, openNCRs: ncrs, openMaintenance: maint,
        };
      }),
    );
    rows.sort((x, y) => y.oee - x.oee);

    const totalOutput = rows.reduce((s, r) => s + r.output, 0);
    const weight = rows.reduce((s, r) => s + (r.output || 1), 0);
    const avgOee = rows.length ? r1(rows.reduce((s, r) => s + r.oee * (r.output || 1), 0) / weight) : 0;
    // Output-weighted on the same weights, so the headline honours the toggle without
    // switching averaging method underneath it.
    const avgOeeTb = rows.length ? r1(rows.reduce((s, r) => s + (r.oeeTb ?? r.oee) * (r.output || 1), 0) / weight) : 0;

    return {
      rows,
      totals: {
        factories: rows.length,
        avgOee,
        avgOeeTb,
        totalOutput,
        totalCostMtd: r2(rows.reduce((s, r) => s + r.costMtd, 0)),
        totalElectricalMtd: r2(rows.reduce((s, r) => s + r.electricalMtd, 0)),
        totalAlarms: rows.reduce((s, r) => s + r.activeAlarms, 0),
        totalOpenNCRs: rows.reduce((s, r) => s + r.openNCRs, 0),
        totalOpenMaintenance: rows.reduce((s, r) => s + r.openMaintenance, 0),
      },
      generatedAt: new Date().toISOString(),
    };
  }

  async getOverview(
    factoryId: string | null,
    scope?: { areaId?: string; lineId?: string; machineId?: string },
    range?: { timeframe?: string; dateFrom?: string; dateTo?: string },
  ) {
    const machineIds = await this.scopeMachineIds(factoryId, scope);
    const win = await this.resolveWindow(factoryId, range);
    // Compute the window's OEE analytics ONCE and feed both the KPI strip and the
    // machine grid — so per-machine OEE is LIVE (from job orders) instead of the stale
    // MachineCurrentStatus.oee snapshot.
    const bucket: 'hour' | 'day' = win.multiDay ? 'day' : 'hour';
    const analytics = await this.kpi.oeeAnalytics(factoryId, win.from, win.to, machineIds, bucket, { slotTo: win.slotTo });
    const [kpis, machines, productionStatus, alarms] = await Promise.all([
      this.getKPIs(factoryId, machineIds, win, analytics),
      this.getMachineStatus(factoryId, machineIds, analytics),
      this.getProductionStatus(factoryId, machineIds, win),
      this.getActiveAlarms(factoryId),
    ]);

    const [productionTrend, qualityTrend, downtimePareto, shiftSummary] = await Promise.all([
      this.getProductionTrend(factoryId, machineIds, win),
      this.getQualityTrend(factoryId, machineIds, win),
      this.getDowntimePareto(factoryId, win, machineIds),
      this.getCurrentShiftSummary(factoryId, analytics),
    ]);

    return {
      kpis,
      machines,
      productionStatus,
      alarms,
      productionTrend,
      qualityTrend,
      downtimePareto,
      shiftSummary,
    };
  }

  /** First-pass-yield / scrap trend bucketed over the window (from job-order output). */
  private async getQualityTrend(
    factoryId: string | null,
    machineIds: string[] | undefined,
    win: Awaited<ReturnType<DashboardService['resolveWindow']>>,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machineScope = machineIds ? { machineId: { in: machineIds } } : {};
    const { from, to, multiDay } = win;

    const buckets: { start: Date; label: string }[] = [];
    if (multiDay) {
      const d = new Date(from);
      d.setHours(0, 0, 0, 0);
      while (d <= to && buckets.length < 60) {
        buckets.push({ start: new Date(d), label: `${d.getMonth() + 1}/${d.getDate()}` });
        d.setDate(d.getDate() + 1);
      }
    } else {
      const h = new Date(from);
      h.setMinutes(0, 0, 0);
      while (h <= to && buckets.length < 24) {
        buckets.push({ start: new Date(h), label: `${h.getHours()}:00` });
        h.setHours(h.getHours() + 1);
      }
    }

    const jos = await this.prisma.jobOrder.findMany({
      where: { ...factoryFilter, ...machineScope, actualStart: { gte: from, lte: to } },
      // outputUnit + SKU packaging are required: routing steps count in different
      // units, so these quantities cannot be added before conversion to pieces.
      select: {
        actualStart: true, actualQtyGood: true, actualQtyRejected: true, outputUnit: true,
        workOrder: { select: { sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } } } },
      },
    });
    const stepMs = multiDay ? 86_400_000 : 3_600_000;
    const r1 = (n: number) => Math.round(n * 10) / 10;
    return buckets.map((b) => {
      const next = b.start.getTime() + stepMs;
      let good = 0;
      let rejected = 0;
      for (const jo of jos) {
        const t = jo.actualStart ? jo.actualStart.getTime() : 0;
        if (t >= b.start.getTime() && t < next) {
          const pkg = jo.workOrder?.sku ?? null;
          good += toPieces(jo.actualQtyGood ?? 0, jo.outputUnit, pkg);
          rejected += toPieces(jo.actualQtyRejected ?? 0, jo.outputUnit, pkg);
        }
      }
      const total = good + rejected;
      // FPY = good/total; scrap = rejected/total. Rework is not tracked at job-order level → 0.
      return {
        time: b.label,
        fpy: total > 0 ? r1((good / total) * 100) : 0,
        rework: 0,
        scrap: total > 0 ? r1((rejected / total) * 100) : 0,
      };
    });
  }

  private async getKPIs(
    factoryId: string | null,
    machineIds: string[] | undefined,
    win: Awaited<ReturnType<DashboardService['resolveWindow']>>,
    today: Awaited<ReturnType<KpiService['oeeAnalytics']>>,
  ) {
    const { prevFrom, prevTo, multiDay } = win;
    const bucket: 'hour' | 'day' = multiDay ? 'day' : 'hour';

    const factoryFilter = factoryId ? { factoryId } : {};
    const r1 = (n: number) => Math.round(n * 10) / 10;

    // `today` is computed once in getOverview and shared. Only the previous-window
    // comparison + alarm counts are fetched here.
    const [prev, activeAlarms, prevAlarms] = await Promise.all([
      this.kpi.oeeAnalytics(factoryId, prevFrom, prevTo, machineIds, bucket, { slotTo: prevTo }),
      this.prisma.alarmEvent.count({ where: { ...factoryFilter, acknowledgedAt: null, resolvedAt: null } }),
      this.prisma.alarmEvent.count({ where: { ...factoryFilter, triggeredAt: { gte: prevFrom, lt: prevTo } } }),
    ]);

    const hasData = today.totalOutput > 0 && prev.totalOutput > 0;
    const trend = (t: number, p: number) => (hasData ? r1(t - p) : 0);

    return {
      oee: today.current.oee,
      availability: today.current.availability,
      performance: today.current.performance,
      quality: today.current.quality,
      // Time-based (OEE-TB) variant — exposed everywhere alongside schedule-based OEE.
      oeeTb: today.current.oeeTb,
      availabilityTb: today.current.availabilityTb,
      totalOutput: today.totalOutput,
      activeAlarms,
      oeeTrend: trend(today.current.oee, prev.current.oee),
      oeeTbTrend: trend(today.current.oeeTb, prev.current.oeeTb),
      availabilityTrend: trend(today.current.availability, prev.current.availability),
      availabilityTbTrend: trend(today.current.availabilityTb, prev.current.availabilityTb),
      performanceTrend: trend(today.current.performance, prev.current.performance),
      qualityTrend: trend(today.current.quality, prev.current.quality),
      outputTrend: trend(today.totalOutput, prev.totalOutput),
      alarmTrend: activeAlarms - prevAlarms,
    };
  }

  private async getMachineStatus(
    factoryId: string | null,
    machineIds: string[] | undefined,
    analytics: Awaited<ReturnType<KpiService['oeeAnalytics']>>,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const scopeFilter = machineIds ? { id: { in: machineIds } } : {};

    // Live per-machine OEE from the engine (job orders in the window), keyed by machine id.
    // The MachineCurrentStatus.oee snapshot is only used as a fallback when a machine ran
    // no job orders in the window.
    const liveOee = new Map(analytics.byEquipment.map((e) => [e.machineId, e]));

    const machines = await this.prisma.machine.findMany({
      where: { ...factoryFilter, ...scopeFilter, isActive: true },
      include: {
        currentStatus: true,
        line: {
          include: {
            area: { select: { name: true } },
          },
        },
      },
      take: 20,
    });

    // A WorkOrder is routed across MANY machines (one JobOrder per step). The WO shown
    // on a machine card must be the WO of the JOB ORDER currently running on THAT machine
    // — not the WO header's machine. Resolve per-machine via the active (EXECUTING) JO.
    const machineIdList = machines.map((m) => m.id);
    const activeJos = machineIdList.length
      ? await this.prisma.jobOrder.findMany({
          where: { ...factoryFilter, machineId: { in: machineIdList }, status: { in: ['EXECUTING', 'PAUSED'] } },
          select: { machineId: true, actualStart: true, workOrder: { select: { orderNumber: true } } },
          orderBy: { actualStart: 'desc' },
        })
      : [];
    const woByMachine = new Map<string, string>();
    for (const jo of activeJos) {
      if (jo.machineId && !woByMachine.has(jo.machineId) && jo.workOrder?.orderNumber) {
        woByMachine.set(jo.machineId, jo.workOrder.orderNumber);
      }
    }

    return machines.map((m) => {
      const live = liveOee.get(m.id);
      return {
        id: m.id,
        name: m.name,
        code: m.code,
        state: m.currentStatus?.state ?? 'OFFLINE',
        // Prefer live job-order OEE; fall back to the stored snapshot.
        oee: live ? live.oee : (m.currentStatus?.oee ?? 0),
        oeeTb: live ? live.oeeTb : null,
        // WO of the job order running on this machine (correct for routed WOs).
        currentOrder: woByMachine.get(m.id),
        throughput: m.currentStatus?.actualSpeed ?? 0,
        runtime: m.currentStatus?.runtimeMinutes ?? 0,
        lastUpdate: m.currentStatus?.updatedAt?.toISOString() ?? new Date().toISOString(),
        area: m.line?.area?.name ?? 'Unknown',
      };
    });
  }

  private async getProductionStatus(
    factoryId: string | null,
    machineIds: string[] | undefined,
    win: Awaited<ReturnType<DashboardService['resolveWindow']>>,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machineScope = machineIds ? { machineId: { in: machineIds } } : {};
    const idScope = machineIds ? { id: { in: machineIds } } : {};
    // WorkOrder has no machineId column — it links to machines through its job orders.
    const woMachineScope = machineIds ? { jobOrders: { some: { machineId: { in: machineIds } } } } : {};
    const { from, to } = win;

    const [totalMachines, activeWOs, completedToday, shiftTargets, outputToday] = await Promise.all([
      this.prisma.machine.count({ where: { ...factoryFilter, ...idScope, isActive: true } }),
      // Running lines/active orders are an instantaneous snapshot (not range-bound)
      this.prisma.workOrder.count({ where: { ...factoryFilter, ...woMachineScope, status: 'IN_PROGRESS' } }),
      this.prisma.workOrder.count({
        where: { ...factoryFilter, ...woMachineScope, status: 'COMPLETED', actualEnd: { gte: from, lte: to } },
      }),
      // Planned output = sum of the window's shift targets (real shift model)
      this.prisma.shiftInstance.aggregate({
        where: { ...factoryFilter, startTime: { gte: from, lte: to } },
        _sum: { targetQty: true },
      }),
      // Actual output within the window — from the fact store (final-step, no
      // routed-WO double-counting) when enabled, else the legacy OEERecord sum.
      this.kpi.snapshotsEnabled()
        ? this.kpi.snapshotScope(factoryId, from, to, machineIds).then((b) => ({ _sum: { totalOutput: b.totalCount } }))
        : this.prisma.oEERecord.aggregate({
            where: { ...factoryFilter, ...machineScope, recordDate: { gte: from, lte: to } },
            _sum: { totalOutput: true },
          }),
    ]);

    return {
      runningLines: Math.min(activeWOs, totalMachines),
      totalLines: totalMachines,
      activeOrders: activeWOs,
      completedToday,
      plannedOutput: shiftTargets._sum.targetQty ?? 0,
      actualOutput: outputToday._sum.totalOutput ?? 0,
    };
  }

  private async getActiveAlarms(factoryId: string | null) {
    const factoryFilter = factoryId ? { factoryId } : {};

    return this.prisma.alarmEvent.findMany({
      where: { ...factoryFilter, resolvedAt: null },
      orderBy: [{ severity: 'desc' }, { triggeredAt: 'desc' }],
      take: 10,
      include: { machine: { select: { name: true } } },
    }).then((alarms) =>
      alarms.map((a) => ({
        id: a.id,
        code: a.code,
        description: a.description,
        severity: a.severity,
        machine: a.machine?.name ?? 'Unknown',
        triggeredAt: a.triggeredAt.toISOString(),
        acknowledged: !!a.acknowledgedAt,
      })),
    );
  }

  /**
   * Current-shift summary for the Home card. Built from the SAME engine as the
   * shop-floor Shift Analysis band (template-clock window + real COUNT_UPDATE
   * production), so it works even when no ShiftInstance has been "started".
   */
  private async getCurrentShiftSummary(
    factoryId: string | null,
    analytics?: { current?: { oee?: number | null } },
  ) {
    const analysis = await this.shift.getShiftAnalysis(factoryId).catch(() => null);
    if (!analysis?.status?.active) return null; // no shift window now — UI renders idle state
    const { status, totals } = analysis;

    // Operator from the IN_PROGRESS instance if one was started (optional).
    const instance = await this.prisma.shiftInstance
      .findFirst({
        where: { ...(factoryId ? { factoryId } : {}), status: 'IN_PROGRESS' },
        select: { operator: { select: { name: true } } },
        orderBy: { startTime: 'desc' },
      })
      .catch(() => null);

    return {
      shiftName: status.active.name ?? 'Shift',
      operator: instance?.operator?.name ?? null,
      startTime: status.shiftStart,
      elapsed: Math.round(status.elapsedMin ?? 0),
      // finished output this shift + any work-in-process, in the shift's target unit
      output: totals?.good ?? 0,
      inProcess: totals?.inProcess ?? 0,
      unit: totals?.unit ?? null,
      target: totals?.target ?? null,
      // shift OEE = the window OEE already computed for the KPI strip (single source)
      oee: analytics?.current?.oee ?? null,
      downtime: Math.round(totals?.downtimeMins ?? 0),
      defects: totals?.scrap ?? 0,
    };
  }

  private async getProductionTrend(
    factoryId: string | null,
    machineIds: string[] | undefined,
    win: Awaited<ReturnType<DashboardService['resolveWindow']>>,
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const machineScope = machineIds ? { machineId: { in: machineIds } } : {};
    const { from, to, multiDay } = win;

    // Multi-day windows bucket by day; same-day windows bucket by hour.
    const buckets: { start: Date; label: string }[] = [];
    if (multiDay) {
      const d = new Date(from);
      d.setHours(0, 0, 0, 0);
      while (d <= to && buckets.length < 60) {
        buckets.push({ start: new Date(d), label: `${d.getMonth() + 1}/${d.getDate()}` });
        d.setDate(d.getDate() + 1);
      }
    } else {
      const h = new Date(from);
      h.setMinutes(0, 0, 0);
      while (h <= to && buckets.length < 24) {
        buckets.push({ start: new Date(h), label: `${h.getHours()}:00` });
        h.setHours(h.getHours() + 1);
      }
    }

    // Real production from job orders (source of truth): actual = good + scrap,
    // target = planned output, efficiency = actual / target. One query, bucketed in-memory.
    const jos = await this.prisma.jobOrder.findMany({
      where: { ...factoryFilter, ...machineScope, actualStart: { gte: from, lte: to } },
      select: {
        actualStart: true, actualQtyGood: true, actualQtyRejected: true, plannedQtyOut: true,
        outputUnit: true,
        workOrder: { select: { sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } } } },
      },
    });
    const stepMs = multiDay ? 86_400_000 : 3_600_000;
    return buckets.map((b) => {
      const next = b.start.getTime() + stepMs;
      let actual = 0;
      let target = 0;
      for (const jo of jos) {
        const t = jo.actualStart ? jo.actualStart.getTime() : 0;
        if (t >= b.start.getTime() && t < next) {
          // Converted to pieces first — a filler counting inners and a palletiser
          // counting pallets cannot be added raw.
          const pkg = jo.workOrder?.sku ?? null;
          actual += toPieces((jo.actualQtyGood ?? 0) + (jo.actualQtyRejected ?? 0), jo.outputUnit, pkg);
          target += toPieces(jo.plannedQtyOut ?? 0, jo.outputUnit, pkg);
        }
      }
      const efficiency = target > 0 ? Math.round(Math.min(100, (actual / target) * 100)) : 0;
      return { time: b.label, actual, target, efficiency };
    });
  }

  private async getDowntimePareto(
    factoryId: string | null,
    win: Awaited<ReturnType<DashboardService['resolveWindow']>>,
    machineIds?: string[],
  ) {
    const factoryFilter = factoryId ? { factoryId } : {};
    const { from, to } = win;

    const events = await this.prisma.downtimeEvent.findMany({
      // Unplanned-loss Pareto only — planned downtime (break/cleaning) is excluded.
      // Respects the dashboard scope (area/line/machine) like every other section.
      where: {
        ...factoryFilter,
        ...(machineIds ? { machineId: { in: machineIds } } : {}),
        startTime: { gte: from, lte: to },
        durationMinutes: { not: null },
        isPlanned: false,
      },
      select: { category: true, durationMinutes: true },
    });

    const grouped: Record<string, { duration: number; frequency: number }> = {};
    for (const e of events) {
      const key = e.category ?? 'UNKNOWN';
      if (!grouped[key]) grouped[key] = { duration: 0, frequency: 0 };
      grouped[key].duration += e.durationMinutes ?? 0;
      grouped[key].frequency += 1;
    }

    const sorted = Object.entries(grouped)
      .map(([reason, v]) => ({ reason, ...v }))
      .sort((a, b) => b.duration - a.duration);

    const total = sorted.reduce((s, r) => s + r.duration, 0);
    let cum = 0;
    return sorted.map((r) => {
      cum += r.duration;
      return { ...r, cumulative: total > 0 ? Math.round((cum / total) * 100) : 0 };
    });
  }


  /**
   * The plant floor as it is laid out, with each cell's live state.
   *
   * Only served to a factory whose classification declares DIGITAL_TWIN — the
   * footprint data exists nowhere else, and a twin drawn from machines with no
   * surveyed position would be a diagram of nothing.
   *
   * The counts are today's, taken from the same measured-minute store the OEE
   * screens read, so the number on a cell and the number on the KPI page are
   * one fact rather than two estimates.
   */
  async plantLayout(factoryId: string) {
    const factory = await this.prisma.factory.findUnique({
      where: { id: factoryId },
      select: { id: true, code: true, name: true, nameAr: true, metadata: true },
    });
    if (!factory) throw new ForbiddenException('Unknown factory');

    const caps = (factory.metadata as { capabilities?: string[] } | null)?.capabilities ?? [];
    if (!caps.includes('DIGITAL_TWIN')) {
      throw new ForbiddenException(
        `${factory.code} has no digital twin. Its classification does not include a surveyed floor plan.`,
      );
    }

    const machines = await this.prisma.machine.findMany({
      where: { factoryId, isActive: true, archivedAt: null },
      select: {
        id: true, code: true, name: true, nameAr: true, machineType: true,
        sortOrder: true, metadata: true,
        currentStatus: { select: { state: true, goodCount: true, rejectCount: true } },
        line: { select: { code: true, name: true } },
        area: { select: { code: true, name: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);

    // Today's output per machine, from the measured-minute store.
    const today = await this.prisma.oeeMinute.groupBy({
      by: ['machineId'],
      where: { factoryId, bucketStart: { gte: dayStart } },
      _sum: { goodParts: true, rejectedParts: true, operatingMin: true },
    });
    const todayBy = new Map(today.map((t) => [t.machineId, t]));

    const openAlarms = await this.prisma.alarmEvent.groupBy({
      by: ['machineId'],
      where: { factoryId, resolvedAt: null },
      _count: true,
    });
    const alarmsBy = new Map(openAlarms.map((a) => [a.machineId ?? '', a._count]));

    const assets = machines
      .map((m) => {
        const meta = (m.metadata ?? {}) as Record<string, unknown>;
        const grid = meta.grid as { x: number; y: number; w: number; h: number } | undefined;
        if (!grid) return null; // no surveyed position, nothing to draw
        const t = todayBy.get(m.id);
        const state = m.currentStatus?.state ?? 'OFFLINE';
        return {
          code: m.code,
          name: m.name,
          nameAr: m.nameAr,
          kind: m.machineType,
          sequence: m.sortOrder,
          grid,
          state,
          producing: state === 'RUNNING',
          alarms: alarmsBy.get(m.id) ?? 0,
          line: m.line?.code ?? null,
          area: m.area?.name ?? null,
          // Null, not zero: a cell that has not run today has no rate to show,
          // and 0 would read as "running and producing nothing".
          headline: t?._sum.operatingMin
            ? {
                label: 'Today',
                value: Math.round(t._sum.goodParts ?? 0),
                unit: (meta.countUnit as string) ?? 'pcs',
              }
            : null,
          goodCount: Math.round(t?._sum.goodParts ?? 0),
        };
      })
      .filter((a): a is NonNullable<typeof a> => a !== null);

    const byState = assets.reduce<Record<string, number>>((acc, a) => {
      acc[a.state] = (acc[a.state] ?? 0) + 1;
      return acc;
    }, {});

    return {
      factory: { code: factory.code, name: factory.name, nameAr: factory.nameAr },
      assets,
      byState,
      producing: assets.filter((a) => a.producing).length,
      total: assets.length,
    };
  }

}
