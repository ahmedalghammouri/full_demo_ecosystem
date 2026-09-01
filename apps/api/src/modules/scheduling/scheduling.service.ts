import { Injectable, BadRequestException } from '@nestjs/common';
import { utcBound } from '../../common/plant-time.util';
import { PrismaService } from '../../database/prisma.service';

export type ScheduleItemType =
  | 'PRODUCTION_ORDER' | 'WORK_ORDER' | 'MAINTENANCE' | 'PLANNED_DOWNTIME' | 'UNPLANNED_DOWNTIME' | 'SHIFT';

export interface ScheduleItem {
  id: string;
  type: ScheduleItemType;
  title: string;
  subtitle?: string;
  status?: string;
  resourceId: string;
  resourceName: string;
  start: string;
  end: string;
  progress?: number;
  color: string;
}

const COLORS: Record<ScheduleItemType, string> = {
  PRODUCTION_ORDER: '#6366f1',
  WORK_ORDER: '#22c55e',
  MAINTENANCE: '#f59e0b',
  PLANNED_DOWNTIME: '#06b6d4',
  UNPLANNED_DOWNTIME: '#ef4444',
  SHIFT: '#64748b',
};

const TYPE_LABELS: Record<ScheduleItemType, string> = {
  PRODUCTION_ORDER: 'Production Orders',
  WORK_ORDER: 'Work Orders',
  MAINTENANCE: 'Maintenance',
  PLANNED_DOWNTIME: 'Planned Downtime',
  UNPLANNED_DOWNTIME: 'Unplanned Downtime',
  SHIFT: 'Shifts',
};

interface UnifiedQuery {
  dateFrom?: string;
  dateTo?: string;
  types?: string;       // csv of ScheduleItemType
  machineId?: string;
  areaId?: string;
  lineId?: string;
}

@Injectable()
export class SchedulingService {
  constructor(private readonly prisma: PrismaService) {}

  private requireFactory(factoryId: string | null): string {
    if (!factoryId) throw new BadRequestException('A factory context is required');
    return factoryId;
  }

  /** Unified schedule across all schedulable domains, filtered by date range + type. */
  async getUnified(factoryId: string | null, query: UnifiedQuery) {
    const fid = this.requireFactory(factoryId);

    // Default window = current week (Sat → Fri, 7 days from today)
    const now = new Date();
    const from = utcBound(query.dateFrom, 'start') ?? new Date(now.getTime() - 1 * 86_400_000);
    const to = utcBound(query.dateTo, 'end') ?? new Date(from.getTime() + 8 * 86_400_000);
    if (to < from) throw new BadRequestException('dateTo must be on or after dateFrom');

    const wanted = new Set<ScheduleItemType>(
      (query.types?.split(',').map((t) => t.trim()).filter(Boolean) as ScheduleItemType[] | undefined)
        ?? ['PRODUCTION_ORDER', 'WORK_ORDER', 'MAINTENANCE', 'PLANNED_DOWNTIME', 'UNPLANNED_DOWNTIME', 'SHIFT'],
    );

    // Overlap filter: start <= to AND end >= from
    const overlap = (startField: string, endField: string) => ({
      [startField]: { lte: to },
      [endField]: { gte: from },
    });
    // Scope filter (area/line/machine) → applies to machine-bound items (WO, maintenance, downtime).
    let machineFilter: Record<string, unknown> = {};
    if (query.machineId) {
      machineFilter = { machineId: query.machineId };
    } else if (query.lineId || query.areaId) {
      const ms = await this.prisma.machine.findMany({
        where: {
          factoryId: fid,
          ...(query.lineId ? { lineId: query.lineId } : {}),
          ...(query.areaId ? { line: { areaId: query.areaId } } : {}),
        },
        select: { id: true },
      });
      machineFilter = { machineId: { in: ms.map((m) => m.id) } };
    }

    const tasks: Promise<ScheduleItem[]>[] = [];

    if (wanted.has('PRODUCTION_ORDER')) {
      tasks.push(this.prisma.productionOrder.findMany({
        where: { factoryId: fid, plannedStart: { lte: to }, plannedEnd: { gte: from } },
        select: { id: true, orderNumber: true, status: true, plannedStart: true, plannedEnd: true, actualStart: true, actualEnd: true, sku: { select: { name: true } } },
        orderBy: { plannedStart: 'asc' },
        take: 300,
      }).then((rows) => rows.map((o): ScheduleItem => ({
        id: o.id, type: 'PRODUCTION_ORDER', title: o.orderNumber, subtitle: o.sku?.name ?? undefined,
        status: o.status, resourceId: 'production-orders', resourceName: 'Production Orders',
        start: (o.actualStart ?? o.plannedStart).toISOString(),
        end: (o.actualEnd ?? o.plannedEnd).toISOString(),
        progress: o.status === 'COMPLETED' ? 100 : o.actualStart ? 50 : 0,
        color: COLORS.PRODUCTION_ORDER,
      }))));
    }

    if (wanted.has('WORK_ORDER')) {
      // A WO has no header machine — scope it by any job order on the machine(s),
      // and anchor the timeline row on its first routing step's machine.
      const woMachineFilter = Object.keys(machineFilter).length ? { jobOrders: { some: machineFilter } } : {};
      tasks.push(this.prisma.workOrder.findMany({
        where: { factoryId: fid, ...woMachineFilter, plannedStart: { lte: to }, plannedEnd: { gte: from } },
        select: {
          id: true, orderNumber: true, status: true, plannedStart: true, plannedEnd: true, actualStart: true, actualEnd: true,
          jobOrders: { orderBy: { sequenceOrder: 'asc' }, take: 1, select: { machine: { select: { id: true, name: true } } } },
        },
        orderBy: { plannedStart: 'asc' },
        take: 500,
      }).then((rows) => rows.map((w): ScheduleItem => {
        const m = w.jobOrders[0]?.machine ?? null;
        return {
          id: w.id, type: 'WORK_ORDER', title: w.orderNumber, subtitle: m?.name ?? undefined,
          status: w.status, resourceId: m?.id ?? 'unassigned', resourceName: m?.name ?? 'Unassigned',
          start: (w.actualStart ?? w.plannedStart).toISOString(),
          end: (w.actualEnd ?? w.plannedEnd).toISOString(),
          progress: w.status === 'COMPLETED' ? 100 : w.actualStart ? 50 : 0,
          color: COLORS.WORK_ORDER,
        };
      })));
    }

    if (wanted.has('MAINTENANCE')) {
      tasks.push(this.prisma.maintenanceWO.findMany({
        where: {
          factoryId: fid, ...machineFilter,
          OR: [
            { dueDate: { gte: from, lte: to } },
            { startedAt: { gte: from, lte: to } },
            { AND: [{ startedAt: { lte: to } }, { completedAt: { gte: from } }] },
          ],
        },
        select: { id: true, woNumber: true, title: true, status: true, type: true, priority: true, estimatedHours: true, dueDate: true, startedAt: true, completedAt: true, machine: { select: { id: true, name: true } } },
        orderBy: { dueDate: 'asc' },
        take: 300,
      }).then((rows) => rows.map((m): ScheduleItem => {
        const estMs = (m.estimatedHours ?? 2) * 3_600_000;
        const start = m.startedAt ?? (m.dueDate ? new Date(m.dueDate.getTime() - estMs) : from);
        const end = m.completedAt ?? m.dueDate ?? new Date(start.getTime() + estMs);
        return {
          id: m.id, type: 'MAINTENANCE', title: m.woNumber, subtitle: `${m.title} · ${m.machine?.name ?? ''}`.trim(),
          status: m.status, resourceId: m.machine?.id ?? 'maintenance', resourceName: m.machine?.name ?? 'Maintenance',
          start: start.toISOString(), end: end.toISOString(),
          progress: m.status === 'COMPLETED' ? 100 : m.startedAt ? 50 : 0,
          color: COLORS.MAINTENANCE,
        };
      })));
    }

    if (wanted.has('PLANNED_DOWNTIME')) {
      tasks.push(this.prisma.downtimeEvent.findMany({
        where: { factoryId: fid, isPlanned: true, ...machineFilter, ...overlap('startTime', 'endTime') },
        select: { id: true, startTime: true, endTime: true, durationMinutes: true, machine: { select: { id: true, name: true } }, cause: { select: { name: true } } },
        orderBy: { startTime: 'asc' },
        take: 800,
      }).then((rows) => rows.map((d): ScheduleItem => ({
        id: d.id, type: 'PLANNED_DOWNTIME', title: d.cause?.name ?? 'Planned downtime',
        subtitle: d.machine?.name ?? undefined, status: 'PLANNED',
        resourceId: d.machine?.id ?? 'plant', resourceName: d.machine?.name ?? 'Plant',
        start: d.startTime.toISOString(),
        end: (d.endTime ?? new Date(d.startTime.getTime() + (d.durationMinutes ?? 30) * 60_000)).toISOString(),
        color: COLORS.PLANNED_DOWNTIME,
      }))));
    }

    if (wanted.has('UNPLANNED_DOWNTIME')) {
      tasks.push(this.prisma.downtimeEvent.findMany({
        where: { factoryId: fid, isPlanned: false, ...machineFilter, ...overlap('startTime', 'endTime') },
        select: { id: true, startTime: true, endTime: true, durationMinutes: true, machine: { select: { id: true, name: true } }, cause: { select: { name: true } } },
        orderBy: { startTime: 'asc' },
        take: 800,
      }).then((rows) => rows.map((d): ScheduleItem => ({
        id: d.id, type: 'UNPLANNED_DOWNTIME', title: d.cause?.name ?? 'Unplanned downtime',
        subtitle: d.machine?.name ?? undefined, status: d.endTime ? 'RESOLVED' : 'ONGOING',
        resourceId: d.machine?.id ?? 'plant', resourceName: d.machine?.name ?? 'Plant',
        start: d.startTime.toISOString(),
        end: (d.endTime ?? new Date(d.startTime.getTime() + (d.durationMinutes ?? 30) * 60_000)).toISOString(),
        color: COLORS.UNPLANNED_DOWNTIME,
      }))));
    }

    if (wanted.has('SHIFT')) {
      tasks.push(this.prisma.shiftInstance.findMany({
        where: { factoryId: fid, startTime: { lte: to }, OR: [{ endTime: { gte: from } }, { endTime: null }] },
        select: { id: true, startTime: true, endTime: true, status: true, shiftTemplate: { select: { code: true, name: true } } },
        orderBy: { startTime: 'asc' },
        take: 200,
      }).then((rows) => rows.map((s): ScheduleItem => ({
        id: s.id, type: 'SHIFT', title: s.shiftTemplate?.name ?? 'Shift', subtitle: s.shiftTemplate?.code,
        status: s.status, resourceId: 'shifts', resourceName: 'Shifts',
        start: s.startTime.toISOString(),
        end: (s.endTime ?? new Date(s.startTime.getTime() + 12 * 3_600_000)).toISOString(),
        color: COLORS.SHIFT,
      }))));
    }

    const groups = await Promise.all(tasks);
    const items = groups.flat();

    // Counts per type (for filter chips)
    const counts: Record<string, number> = {};
    for (const t of Object.keys(TYPE_LABELS) as ScheduleItemType[]) counts[t] = 0;
    for (const it of items) counts[it.type]++;

    return {
      items,
      range: { from: from.toISOString(), to: to.toISOString() },
      counts,
      typeMeta: (Object.keys(TYPE_LABELS) as ScheduleItemType[]).map((t) => ({ type: t, label: TYPE_LABELS[t], color: COLORS[t] })),
    };
  }
}
