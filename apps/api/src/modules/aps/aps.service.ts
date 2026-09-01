import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { JobOrderStatus, WorkOrderStatus, Priority, DependencyType } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { RunScheduleDto, RescheduleJobDto, CtpDto } from './dto/aps.dto';
import { scheduleOps, makeWorkCalendar, type SchedOp } from '../scheduling/op-scheduler';

const HOUR = 3_600_000;
const PRIORITY_WEIGHT: Record<Priority, number> = {
  CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1,
};
// Job orders that still consume capacity (not finished/cancelled)
const OPEN_JO: JobOrderStatus[] = [
  JobOrderStatus.SCHEDULED, JobOrderStatus.READY, JobOrderStatus.EXECUTING, JobOrderStatus.PAUSED,
];
const OPEN_WO: WorkOrderStatus[] = [
  WorkOrderStatus.PLANNED, WorkOrderStatus.RELEASED, WorkOrderStatus.IN_PROGRESS,
];

type JOWithRefs = {
  id: string;
  workOrderId: string;
  machineId: string | null;
  predecessorId: string | null;
  predecessorType: DependencyType;
  predecessorLagMins: number;
  sequenceOrder: number;
  operationName: string;
  status: JobOrderStatus;
  plannedQtyOut: number | null;
  plannedQtyIn: number | null;
  idealCycleTimeSec: number | null;
  plannedStart: Date | null;
  plannedEnd: Date | null;
  actualStart: Date | null;
  machine: { id: string; name: string; code: string; designCapacity: number | null } | null;
  workOrder: {
    id: string; orderNumber: string; priority: Priority; plannedQty: number; plannedEnd: Date | null; skuId: string | null;
    materialStatus: string | null; materialReadyDate: Date | null;
    productionOrder: { id: string; orderNumber: string } | null;
  };
};

@Injectable()
export class ApsService {
  constructor(private readonly prisma: PrismaService) {}

  private requireFactory(factoryId: string | null): string {
    if (!factoryId) throw new BadRequestException('A factory context is required for APS');
    return factoryId;
  }

  /** Operation duration in ms: cycle-time × qty, else machine design capacity, else 1h. */
  private durationMs(jo: JOWithRefs): number {
    const qty = jo.plannedQtyOut ?? jo.plannedQtyIn ?? jo.workOrder.plannedQty ?? 1;
    if (jo.idealCycleTimeSec && jo.idealCycleTimeSec > 0) return Math.max(qty * jo.idealCycleTimeSec * 1000, 5 * 60_000);
    const cap = jo.machine?.designCapacity ?? 0;
    if (cap > 0) return Math.max((qty / cap) * HOUR, 5 * 60_000);
    return HOUR;
  }

  private async loadOpenJobs(factoryId: string): Promise<JOWithRefs[]> {
    return this.prisma.jobOrder.findMany({
      where: {
        factoryId, status: { in: OPEN_JO }, machineId: { not: null },
        // Never schedule operations whose work order was deleted/archived (or whose
        // production order was removed) — they must not reappear in the plan.
        workOrder: { is: { deletedAt: null, archivedAt: null } },
      },
      select: {
        id: true, workOrderId: true, machineId: true, predecessorId: true,
        predecessorType: true, predecessorLagMins: true, sequenceOrder: true,
        operationName: true, status: true, plannedQtyOut: true, plannedQtyIn: true, idealCycleTimeSec: true,
        plannedStart: true, plannedEnd: true, actualStart: true,
        machine: { select: { id: true, name: true, code: true, designCapacity: true } },
        workOrder: {
          select: {
            id: true, orderNumber: true, priority: true, plannedQty: true, plannedEnd: true, skuId: true,
            // Material gate: the WO cannot start before the supplier delivery ETA.
            materialStatus: true, materialReadyDate: true,
            productionOrder: { select: { id: true, orderNumber: true } },
          },
        },
      },
    }) as unknown as Promise<JOWithRefs[]>;
  }

  // ────────────────────────────────────────────────────────────
  // FINITE-CAPACITY FORWARD SCHEDULER (the "Factory Navigator")
  // ────────────────────────────────────────────────────────────

  /**
   * Recalculate a feasible production plan: sequence every open operation onto
   * its machine respecting finite capacity (no overlap per machine), operation
   * precedence (predecessor must finish), work-order priority and due dates.
   * Persists plannedStart/plannedEnd on each job order.
   */
  async runSchedule(factoryId: string | null, dto: RunScheduleDto) {
    const fid = this.requireFactory(factoryId);
    const horizon = dto.startFrom ? new Date(dto.startFrom).getTime() : Date.now();

    const allJobs = await this.loadOpenJobs(fid);
    // Scoped mode: recalculate ONE work order only — every other open job keeps
    // its plan and its window pre-occupies the machine.
    const jobs = dto.workOrderId ? allJobs.filter((j) => j.workOrderId === dto.workOrderId) : allJobs;
    if (jobs.length === 0) {
      throw new BadRequestException(
        dto.workOrderId
          ? 'This work order has no open operations to schedule.'
          : 'No open operations to schedule. Release work orders first.',
      );
    }

    // Group operations by work order, ordered by priority → due date.
    const byWo = new Map<string, JOWithRefs[]>();
    for (const j of jobs) {
      if (!byWo.has(j.workOrderId)) byWo.set(j.workOrderId, []);
      byWo.get(j.workOrderId)!.push(j);
    }
    const woOrder = [...byWo.values()].sort((a, b) => {
      const wa = a[0].workOrder, wb = b[0].workOrder;
      const p = PRIORITY_WEIGHT[wb.priority] - PRIORITY_WEIGHT[wa.priority];
      if (p !== 0) return p;
      const da = wa.plannedEnd ? +wa.plannedEnd : Infinity;
      const db = wb.plannedEnd ? +wb.plannedEnd : Infinity;
      return da - db;
    });

    const machineFree = new Map<string, number>(); // next free instant per machine
    if (dto.workOrderId) {
      for (const j of allJobs) {
        if (j.workOrderId === dto.workOrderId || !j.machineId || !j.plannedEnd) continue;
        const e = +j.plannedEnd;
        if (e > horizon) machineFree.set(j.machineId, Math.max(machineFree.get(j.machineId) ?? horizon, e));
      }
    }

    // Planned downtime deliberately does NOT pre-occupy a machine.
    //
    // A break, a cleaning slot or a PM window does not move the moment a work
    // order can BEGIN — it interrupts the run once it is under way. So planned
    // stoppage belongs to the order's DURATION (pushing its finish out), never to
    // its start. It is already accounted for that way, as planned-stoppage
    // minutes added to the finish-time estimate.
    //
    // Seeding it into `machineFree` counted it twice AND applied it to the wrong
    // end of the window. Worse, `machineFree` keeps a single "next free instant"
    // per machine, so taking MAX(endTime) over every future stop turned a series
    // of short recurring breaks into one continuous outage: on the production
    // data, 22 planned stops per machine collapsed into "free from 07 Aug" and
    // pushed a work order requested for 02 Aug out to 08 Aug — six days, from
    // stoppages totalling a few hours.
    //
    // `machineFree` now reflects real occupancy only: other work orders' job
    // orders (seeded above).
    // Working-time calendar from the factory's shift templates — the scheduler
    // skips the weekly rest day(s) / holidays instead of planning work on them.
    const shifts = await this.prisma.shiftTemplate.findMany({
      where: { factoryId: fid, isActive: true },
      select: { days: true },
    });
    const workingDays = [...new Set(
      shifts.flatMap((s) => (Array.isArray(s.days) ? (s.days as number[]) : [])),
    )];
    const calendar = makeWorkCalendar(workingDays);

    const jobStart = new Map<string, number>();      // computed start per operation
    const jobEnd = new Map<string, number>();        // computed end per operation
    const updates: { id: string; start: number; end: number }[] = [];

    // Manual drag/resize overrides pin an op at the user-dropped {start,end};
    // everything else reflows around it respecting relationships + calendar.
    const ovr = new Map((dto.overrides ?? []).map((o) => [o.id, o]));
    const isDrag = ovr.size > 0; // a drag (overrides present) vs a full recalculate

    for (const woJobs of woOrder) {
      // A work order that has already started is re-anchored to the EARLIEST
      // started op (clamped to "now"), then its whole line reflows from there —
      // SS steps run in parallel, durations come from the expected cycle×qty.
      // Plain (not-yet-started) work orders start at the global horizon.
      const startedActuals = woJobs
        .filter((j) => j.status === JobOrderStatus.EXECUTING || j.status === JobOrderStatus.PAUSED || !!j.actualStart)
        .map((j) => +(j.actualStart ?? j.plannedStart ?? new Date(horizon)));
      // SUPPLY GATE: a not-yet-started WO cannot begin before its material is
      // available (the supplier delivery ETA). Recalculate honours that floor so
      // the plan never starts an order before its raw materials arrive.
      const woRef = woJobs[0].workOrder;
      const materialFloor = woRef.materialReadyDate ? +woRef.materialReadyDate : 0;
      const woHorizon = startedActuals.length
        ? Math.max(Math.min(...startedActuals), horizon)
        : Math.max(horizon, materialFloor);

      // ── Dependency-aware drag: only TRUE successors of a dragged op reflow ──
      // For a drag we keep every other op fixed at its current planned position
      // (a soft pin) and let only the operations that are downstream-dependent on a
      // dragged op move — so dragging one step no longer shifts unrelated steps or
      // its own predecessors. A full recalculate (no overrides) reflows everything.
      let downstream = new Set<string>();
      if (isDrag) {
        const successorsOf = new Map<string, string[]>();
        for (const j of woJobs) {
          if (j.predecessorId) {
            if (!successorsOf.has(j.predecessorId)) successorsOf.set(j.predecessorId, []);
            successorsOf.get(j.predecessorId)!.push(j.id);
          }
        }
        const stack = woJobs.filter((j) => ovr.has(j.id)).map((j) => j.id);
        while (stack.length) {
          const cur = stack.pop()!;
          for (const succ of successorsOf.get(cur) ?? []) {
            if (!downstream.has(succ) && !ovr.has(succ)) { downstream.add(succ); stack.push(succ); }
          }
        }
      }

      const schedInput: SchedOp[] = woJobs.map((j) => {
        const o = ovr.get(j.id); // only a manual drag pins an op in place
        const dur = o ? Math.max(+new Date(o.end) - +new Date(o.start), 60_000) : this.durationMs(j);
        // Pin: the dragged op at its dropped start; on a drag, also soft-pin every
        // op that is NOT a downstream successor of a drag (keep it where it is).
        let pinnedStart: number | undefined;
        if (o) pinnedStart = +new Date(o.start);
        else if (isDrag && !downstream.has(j.id) && j.plannedStart) pinnedStart = +j.plannedStart;
        return {
          id: j.id,
          machineId: j.machineId,
          durationMs: dur,
          predecessorId: j.predecessorId,
          predecessorType: j.predecessorType,
          predecessorLagMins: j.predecessorLagMins,
          sequenceOrder: j.sequenceOrder,
          pinnedStart,
        };
      });

      const res = scheduleOps(schedInput, woHorizon, machineFree, calendar);
      for (const op of schedInput) {
        const s = res.start.get(op.id);
        const e = res.end.get(op.id);
        if (s == null || e == null) continue;
        jobStart.set(op.id, s);
        jobEnd.set(op.id, e);
        updates.push({ id: op.id, start: s, end: e });
      }
    }

    // Dry-run: return the computed plan for review on the Gantt WITHOUT writing.
    // The user reviews (undo/redo) and commits explicitly via saveSchedule.
    if (dto.dryRun) {
      return {
        dryRun: true,
        scheduled: updates.length,
        scopedToWorkOrder: dto.workOrderId ?? null,
        updates: updates.map((u) => ({ id: u.id, start: new Date(u.start).toISOString(), end: new Date(u.end).toISOString() })),
        ...this.metricsFrom(jobs, jobEnd, horizon),
      };
    }

    await this.prisma.$transaction(
      updates.map((u) =>
        this.prisma.jobOrder.update({
          where: { id: u.id },
          data: { plannedStart: new Date(u.start), plannedEnd: new Date(u.end) },
        }),
      ),
    );

    return { dryRun: false, scheduled: updates.length, scopedToWorkOrder: dto.workOrderId ?? null, ...this.metricsFrom(jobs, jobEnd, horizon) };
  }

  /**
   * Commit a reviewed plan (from a dry-run). Per work order:
   *  • if its new finish stays within the due date → its job orders are saved now;
   *  • if it overruns the due date → NOTHING is written; instead an APS_RECALC
   *    reschedule request is raised carrying the proposed plan, to be approved on
   *    the Reschedule Requests page (which then applies it).
   * Direct WOs with no production order are committed regardless (nothing to gate).
   */
  async saveSchedule(
    factoryId: string | null,
    userId: string | null,
    updates: Array<{ id: string; start: string; end: string }>,
  ) {
    const fid = this.requireFactory(factoryId);
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new BadRequestException('No plan changes to save.');
    }
    const ids = updates.map((u) => u.id);
    const jos = await this.prisma.jobOrder.findMany({
      where: { id: { in: ids }, factoryId: fid, status: { in: OPEN_JO } },
      select: {
        id: true, workOrderId: true,
        workOrder: { select: { id: true, orderNumber: true, productionOrderId: true, plannedEnd: true } },
      },
    });
    const joById = new Map(jos.map((j) => [j.id, j]));
    const valid = updates.filter((u) => joById.has(u.id));
    if (valid.length === 0) throw new BadRequestException('No matching open operations to update.');

    // Group the plan by work order
    const byWo = new Map<string, { wo: (typeof jos)[number]['workOrder']; ups: typeof valid }>();
    for (const u of valid) {
      const jo = joById.get(u.id)!;
      const key = jo.workOrderId;
      if (!byWo.has(key)) byWo.set(key, { wo: jo.workOrder, ups: [] });
      byWo.get(key)!.ups.push(u);
    }

    const commit: typeof valid = [];
    const gated: Array<{ orderNumber: string; requestId: string; lateHours: number }> = [];

    for (const { wo, ups } of byWo.values()) {
      const newStart = Math.min(...ups.map((u) => +new Date(u.start)));
      const newFinish = Math.max(...ups.map((u) => +new Date(u.end)));
      const due = wo.plannedEnd ? +wo.plannedEnd : null;
      const overruns = due !== null && newFinish > due;

      if (overruns && wo.productionOrderId) {
        // Gate: raise an APS_RECALC reschedule request carrying this WO's plan.
        const rr = await this.prisma.rescheduleRequest.create({
          data: {
            factoryId: fid,
            productionOrderId: wo.productionOrderId,
            workOrderId: wo.id,
            source: 'APS_RECALC',
            status: 'PENDING',
            proposedStart: new Date(newStart),
            proposedEnd: new Date(newFinish),
            dueDate: wo.plannedEnd,
            requestedById: userId ?? undefined,
            reason: `Recalculated plan finishes ${Math.round((newFinish - (due ?? newFinish)) / HOUR * 10) / 10}h after the due date.`,
            details: { updates: ups, makespanHours: Math.round((newFinish - newStart) / HOUR * 10) / 10 },
          },
          select: { id: true },
        });
        gated.push({ orderNumber: wo.orderNumber, requestId: rr.id, lateHours: Math.round((newFinish - (due ?? newFinish)) / HOUR * 10) / 10 });
      } else {
        commit.push(...ups);
      }
    }

    if (commit.length > 0) {
      await this.prisma.$transaction(
        commit.map((u) =>
          this.prisma.jobOrder.update({
            where: { id: u.id },
            data: { plannedStart: new Date(u.start), plannedEnd: new Date(u.end) },
          }),
        ),
      );
    }
    return { saved: commit.length, gated };
  }

  /** Aggregate schedule KPIs from computed ends. */
  private metricsFrom(jobs: JOWithRefs[], jobEnd: Map<string, number>, horizon: number) {
    const ends = [...jobEnd.values()];
    const makespanH = ends.length ? (Math.max(...ends) - horizon) / HOUR : 0;

    // On-time: a WO is late if its last op finishes after the WO due date.
    const woLast = new Map<string, { end: number; due: number | null; order: string }>();
    for (const j of jobs) {
      const e = jobEnd.get(j.id);
      if (e === undefined) continue;
      const cur = woLast.get(j.workOrderId);
      const due = j.workOrder.plannedEnd ? +j.workOrder.plannedEnd : null;
      if (!cur || e > cur.end) woLast.set(j.workOrderId, { end: e, due, order: j.workOrder.orderNumber });
    }
    let onTime = 0, late = 0;
    const lateOrders: { orderNumber: string; finish: string; due: string | null; lateHours: number }[] = [];
    for (const w of woLast.values()) {
      if (w.due !== null && w.end > w.due) {
        late++;
        lateOrders.push({ orderNumber: w.order, finish: new Date(w.end).toISOString(), due: new Date(w.due).toISOString(), lateHours: Math.round((w.end - w.due) / HOUR * 10) / 10 });
      } else onTime++;
    }
    const totalWo = onTime + late;

    // Utilization: busy time / (machines × makespan)
    const machines = new Set(jobs.map((j) => j.machineId));
    let busy = 0;
    for (const j of jobs) busy += this.durationMs(j);
    const cap = machines.size * makespanH * HOUR;
    const utilization = cap > 0 ? Math.round((busy / cap) * 1000) / 10 : 0;

    return {
      makespanHours: Math.round(makespanH * 10) / 10,
      onTimeOrders: onTime,
      lateOrderCount: late,
      onTimePct: totalWo ? Math.round((onTime / totalWo) * 1000) / 10 : 100,
      machinesUsed: machines.size,
      utilizationPct: utilization,
      lateOrders: lateOrders.sort((a, b) => b.lateHours - a.lateHours).slice(0, 20),
    };
  }

  // ────────────────────────────────────────────────────────────
  // CURRENT PLAN (resource Gantt rows + metrics)
  // ────────────────────────────────────────────────────────────

  async getPlan(factoryId: string | null) {
    const fid = this.requireFactory(factoryId);
    const jobs = await this.loadOpenJobs(fid);

    const scheduled = jobs.filter((j) => j.plannedStart && j.plannedEnd);
    const unscheduled = jobs.length - scheduled.length;
    const horizon = scheduled.length ? Math.min(...scheduled.map((j) => +j.plannedStart!)) : Date.now();

    const jobEnd = new Map<string, number>();
    for (const j of scheduled) jobEnd.set(j.id, +j.plannedEnd!);

    const statusColor: Record<JobOrderStatus, string> = {
      SCHEDULED: '#6366f1', READY: '#0ea5e9', EXECUTING: '#22c55e',
      PAUSED: '#f59e0b', COMPLETE: '#94a3b8', CANCELLED: '#94a3b8',
    };

    // Stable colour per work order (operations of one order share a hue).
    const palette = ['#6366f1', '#f59e0b', '#22c55e', '#ec4899', '#0ea5e9', '#a855f7', '#ef4444', '#14b8a6', '#eab308', '#8b5cf6'];
    const woColor = new Map<string, string>();
    let ci = 0;
    for (const j of scheduled) if (!woColor.has(j.workOrderId)) woColor.set(j.workOrderId, palette[ci++ % palette.length]);

    // Resource (machine) rows for the Gantt
    const machineMap = new Map<string, { id: string; name: string; code: string }>();
    const items = scheduled.map((j) => {
      if (j.machine) machineMap.set(j.machine.id, { id: j.machine.id, name: j.machine.name, code: j.machine.code });
      return {
        id: j.id,
        type: 'job_order',
        title: `${j.workOrder.orderNumber} · ${j.operationName}`,
        subtitle: j.operationName,
        operation: j.operationName,
        sequenceOrder: j.sequenceOrder,
        orderNumber: j.workOrder.orderNumber,
        workOrderId: j.workOrderId,
        productionOrderId: j.workOrder.productionOrder?.id ?? null,
        productionOrderNumber: j.workOrder.productionOrder?.orderNumber ?? null,
        predecessorId: j.predecessorId,
        predecessorType: j.predecessorType,
        predecessorLagMins: j.predecessorLagMins,
        status: j.status,
        resourceId: j.machineId!,
        resourceName: j.machine ? `${j.machine.name}` : 'Unassigned',
        start: j.plannedStart!.toISOString(),
        end: j.plannedEnd!.toISOString(),
        qty: j.plannedQtyOut ?? j.plannedQtyIn ?? null,
        progress: j.status === JobOrderStatus.COMPLETE ? 100 : j.status === JobOrderStatus.EXECUTING ? 50 : 0,
        color: woColor.get(j.workOrderId) ?? statusColor[j.status],
        statusColor: statusColor[j.status],
        priority: j.workOrder.priority,
      };
    });

    // Demand lane: one marker per work order at its due date + scheduled finish.
    const demandMap = new Map<string, { orderNumber: string; color: string; due: number | null; finish: number; priority: Priority }>();
    for (const j of scheduled) {
      const finish = jobEnd.get(j.id) ?? +j.plannedEnd!;
      const cur = demandMap.get(j.workOrderId);
      const due = j.workOrder.plannedEnd ? +j.workOrder.plannedEnd : null;
      if (!cur || finish > cur.finish) {
        demandMap.set(j.workOrderId, { orderNumber: j.workOrder.orderNumber, color: woColor.get(j.workOrderId)!, due, finish, priority: j.workOrder.priority });
      }
    }
    const demand = [...demandMap.values()].map((d) => ({
      orderNumber: d.orderNumber,
      color: d.color,
      dueDate: d.due ? new Date(d.due).toISOString() : null,
      scheduledFinish: new Date(d.finish).toISOString(),
      late: d.due !== null && d.finish > d.due,
      priority: d.priority,
    })).sort((a, b) => +new Date(a.scheduledFinish) - +new Date(b.scheduledFinish));

    return {
      items,
      machines: [...machineMap.values()].sort((a, b) => a.name.localeCompare(b.name)),
      demand,
      unscheduled,
      range: items.length
        ? { from: new Date(horizon).toISOString(), to: new Date(Math.max(...scheduled.map((j) => +j.plannedEnd!))).toISOString() }
        : { from: new Date(horizon).toISOString(), to: new Date(horizon + 7 * 24 * HOUR).toISOString() },
      metrics: this.metricsFrom(scheduled, jobEnd, horizon),
    };
  }

  // ────────────────────────────────────────────────────────────
  // INTERACTIVE RESCHEDULE (drag & drop) — ripples successors
  // ────────────────────────────────────────────────────────────

  async rescheduleJob(factoryId: string | null, dto: RescheduleJobDto) {
    const fid = this.requireFactory(factoryId);
    const jo = await this.prisma.jobOrder.findFirst({
      where: { id: dto.jobId, factoryId: fid },
      select: { id: true, plannedStart: true, plannedEnd: true, machineId: true },
    });
    if (!jo) throw new NotFoundException('Job order not found');

    const start = new Date(dto.start);
    const prevDur = jo.plannedStart && jo.plannedEnd ? +jo.plannedEnd - +jo.plannedStart : HOUR;
    const end = dto.end ? new Date(dto.end) : new Date(+start + prevDur);

    await this.prisma.jobOrder.update({
      where: { id: jo.id },
      data: { plannedStart: start, plannedEnd: end, ...(dto.machineId ? { machineId: dto.machineId } : {}) },
    });

    // Ripple: push any successors that now start before this op ends.
    let rippled = 0;
    let frontier = [{ id: jo.id, end: +end }];
    const seen = new Set<string>([jo.id]);
    while (frontier.length) {
      const next: { id: string; end: number }[] = [];
      for (const f of frontier) {
        const succs = await this.prisma.jobOrder.findMany({
          where: { predecessorId: f.id, factoryId: fid, status: { in: OPEN_JO } },
          select: { id: true, plannedStart: true, plannedEnd: true },
        });
        for (const s of succs) {
          if (seen.has(s.id) || !s.plannedStart || !s.plannedEnd) continue;
          if (+s.plannedStart >= f.end) continue; // no conflict
          const dur = +s.plannedEnd - +s.plannedStart;
          const ns = f.end, ne = f.end + dur;
          await this.prisma.jobOrder.update({ where: { id: s.id }, data: { plannedStart: new Date(ns), plannedEnd: new Date(ne) } });
          seen.add(s.id); rippled++;
          next.push({ id: s.id, end: ne });
        }
      }
      frontier = next;
    }

    return { id: jo.id, start: start.toISOString(), end: end.toISOString(), rippledSuccessors: rippled };
  }

  // ────────────────────────────────────────────────────────────
  // CAPABLE-TO-PROMISE (CTP)
  // ────────────────────────────────────────────────────────────

  async ctp(factoryId: string | null, dto: CtpDto) {
    const fid = this.requireFactory(factoryId);
    const sku = await this.prisma.sKU.findFirst({ where: { id: dto.skuId, factoryId: fid }, select: { id: true, code: true, name: true } });
    if (!sku) throw new NotFoundException('SKU not found');

    // Candidate machines: those that have produced this SKU before, else any with capacity.
    const priorJobs = await this.prisma.jobOrder.findMany({
      where: { factoryId: fid, workOrder: { skuId: dto.skuId }, machineId: { not: null } },
      select: { machineId: true }, take: 50,
    });
    const machineIds = [...new Set(priorJobs.map((j) => j.machineId!).filter(Boolean))];
    const machines = await this.prisma.machine.findMany({
      where: { factoryId: fid, isActive: true, designCapacity: { gt: 0 }, ...(machineIds.length ? { id: { in: machineIds } } : {}) },
      select: { id: true, name: true, code: true, designCapacity: true },
    });
    if (machines.length === 0) {
      return { sku, feasible: false, reason: 'No capable machine with a defined capacity for this SKU' };
    }

    // Current load per machine from the scheduled plan.
    const load = await this.prisma.jobOrder.groupBy({
      by: ['machineId'],
      where: { factoryId: fid, status: { in: OPEN_JO }, machineId: { in: machines.map((m) => m.id) } },
      _max: { plannedEnd: true },
    });
    const freeAt = new Map<string, number>();
    for (const l of load) if (l.machineId) freeAt.set(l.machineId, l._max.plannedEnd ? +l._max.plannedEnd : Date.now());

    // Pick the machine that can finish soonest.
    let best: { machine: typeof machines[number]; start: number; end: number } | null = null;
    for (const m of machines) {
      const start = Math.max(Date.now(), freeAt.get(m.id) ?? Date.now());
      const durH = dto.quantity / (m.designCapacity || 1);
      const end = start + durH * HOUR;
      if (!best || end < best.end) best = { machine: m, start, end };
    }

    const promise = best!;
    const due = dto.dueDate ? +new Date(dto.dueDate) : null;
    const feasible = due === null ? true : promise.end <= due;
    return {
      sku,
      quantity: dto.quantity,
      machine: { id: promise.machine.id, name: promise.machine.name, code: promise.machine.code, capacityPerHour: promise.machine.designCapacity },
      earliestStart: new Date(promise.start).toISOString(),
      promiseDate: new Date(promise.end).toISOString(),
      runtimeHours: Math.round((promise.end - promise.start) / HOUR * 10) / 10,
      requestedDate: dto.dueDate ?? null,
      feasible,
      slackHours: due !== null ? Math.round((due - promise.end) / HOUR * 10) / 10 : null,
    };
  }

  // ────────────────────────────────────────────────────────────
  // MATERIAL REQUIREMENTS PLANNING (MRP)
  // ────────────────────────────────────────────────────────────

  async mrp(factoryId: string | null) {
    const fid = this.requireFactory(factoryId);
    const wos = await this.prisma.workOrder.findMany({
      where: { factoryId: fid, status: { in: OPEN_WO }, skuId: { not: null }, deletedAt: null },
      select: {
        id: true, orderNumber: true, skuId: true, plannedQty: true, plannedStart: true,
        productionOrder: { select: { unit: true } },
        sku: { select: { unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true, baseUnit: true } },
      },
    });
    if (wos.length === 0) return { requirements: [], shortages: 0, ordersConsidered: 0 };

    // Active BOM per SKU.
    const skuIds = [...new Set(wos.map((w) => w.skuId!))];
    const boms = await this.prisma.bOMHeader.findMany({
      where: { factoryId: fid, skuId: { in: skuIds }, isActive: true },
      select: { skuId: true, items: { select: { rawMaterialId: true, quantityPer: true, scrapFactor: true, unit: true } } },
    });
    const bomBySku = new Map<string, typeof boms[number]['items']>();
    for (const b of boms) if (!bomBySku.has(b.skuId)) bomBySku.set(b.skuId, b.items);

    // BOM quantityPer is expressed per ONE SKU base unit (e.g. per carton), but
    // a work order's plannedQty is in the PO unit (often PALLET). Convert through
    // the packaging ladder (piece → inner → carton → pallet) before exploding,
    // otherwise 10 pallets is mistaken for 10 cartons and requirements collapse.
    const piecesPer = (pkg: any) => {
      const inner = pkg?.unitsPerInner || 1;
      const carton = (pkg?.innersPerCarton || 1) * inner;
      const pallet = (pkg?.cartonsPerPallet || 1) * carton;
      return { PIECE: 1, EA: 1, PCS: 1, UNIT: 1, INNER: inner, CARTON: carton, PALLET: pallet } as Record<string, number>;
    };
    const toBaseUnits = (qty: number, fromUnit: string, baseUnit: string, pkg: any) => {
      const f = piecesPer(pkg);
      const norm = (u: string) => f[(u || '').toUpperCase()] ?? 1;
      return (qty * norm(fromUnit)) / norm(baseUnit);
    };

    // Aggregate gross requirement per material + earliest need date.
    const need = new Map<string, { required: number; date: number }>();
    for (const wo of wos) {
      const items = bomBySku.get(wo.skuId!);
      if (!items) continue;
      const when = wo.plannedStart ? +wo.plannedStart : Date.now();
      const baseUnit = wo.sku?.baseUnit ?? 'CARTON';
      const woUnit = wo.productionOrder?.unit ?? baseUnit;
      const qtyInBase = toBaseUnits(wo.plannedQty, woUnit, baseUnit, wo.sku);
      for (const it of items) {
        const gross = qtyInBase * it.quantityPer * (1 + (it.scrapFactor ?? 0));
        const cur = need.get(it.rawMaterialId);
        if (cur) { cur.required += gross; cur.date = Math.min(cur.date, when); }
        else need.set(it.rawMaterialId, { required: gross, date: when });
      }
    }

    const mats = await this.prisma.rawMaterial.findMany({
      where: { id: { in: [...need.keys()] } },
      select: { id: true, code: true, name: true, unit: true, currentStock: true, reservedStock: true, leadTimeDays: true },
    });

    const requirements = mats.map((m) => {
      const n = need.get(m.id)!;
      const available = (m.currentStock ?? 0) - (m.reservedStock ?? 0);
      const shortage = Math.max(0, n.required - available);
      const requiredDate = new Date(n.date);
      const orderBy = m.leadTimeDays ? new Date(n.date - m.leadTimeDays * 24 * HOUR) : null;
      return {
        materialId: m.id, code: m.code, name: m.name, unit: m.unit,
        required: Math.round(n.required * 100) / 100,
        available: Math.round(available * 100) / 100,
        shortage: Math.round(shortage * 100) / 100,
        requiredDate: requiredDate.toISOString(),
        suggestedOrderDate: orderBy ? orderBy.toISOString() : null,
        leadTimeDays: m.leadTimeDays ?? null,
      };
    }).sort((a, b) => b.shortage - a.shortage);

    return {
      requirements,
      shortages: requirements.filter((r) => r.shortage > 0).length,
      ordersConsidered: wos.length,
    };
  }
}
