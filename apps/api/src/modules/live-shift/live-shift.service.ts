import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service';
import { OeeStandardService, type OeeScope } from '../oee-standard/oee-standard.service';
import { StateTimelineService, type TimelineSegment } from '../oee-standard/state-timeline.service';
import { RejectReasonService } from '../oee-standard/reject-reason.service';
import { toPieces, type SkuPackaging } from '../../common/units.util';

/**
 * How much of the shift a widget is showing.
 *
 * A closed set rather than a free date pair. This screen answers "what is
 * happening now", and a free range turns it back into the analysis page — which
 * already exists, and which is where an arbitrary window belongs. Every option
 * here is a TAIL of the current shift, so no widget can wander outside the shift
 * its header names.
 */
export const LIVE_WINDOWS: Record<string, { label: string; minutes: number | null }> = {
  shift: { label: 'Whole shift', minutes: null },
  '120': { label: 'Last 2 hours', minutes: 120 },
  '60': { label: 'Last hour', minutes: 60 },
  '30': { label: 'Last 30 min', minutes: 30 },
  '15': { label: 'Last 15 min', minutes: 15 },
};
export type LiveWindow = string;

export const isLiveWindow = (v: string | undefined): boolean =>
  !!v && Object.prototype.hasOwnProperty.call(LIVE_WINDOWS, v);

export interface ShiftHeader {
  templateId: string | null;
  code: string;
  name: string;
  start: Date;
  end: Date;
  now: Date;
  elapsedMin: number;
  remainingMin: number;
  plannedMin: number;
  progressPct: number;
  /** False when no template covers this moment — a real gap, not a shift of zero. */
  resolved: boolean;
}

interface TemplateRow {
  id: string; code: string; name: string;
  startTime: string; endTime: string; crossesMidnight: boolean;
}

const hhmm = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + (m || 0);
};

/**
 * The current shift, and everything that happened inside it — from one engine.
 *
 * ── Why this reads `oee_minutes` rather than computing its own totals ───────
 * The plant already had two surfaces answering "how are we doing" from different
 * arithmetic, and reconciling them cost more than building either had. This
 * screen is a WINDOW onto the standard engine, not a third engine: it resolves
 * the shift, then asks `OeeStandardService` the same questions the analysis page
 * asks, with the same scope. So "the current shift" here and "this shift" on the
 * analysis page are the same number by construction, and there is nothing left
 * to reconcile.
 *
 * What it adds is only what a live screen needs and history cannot answer: which
 * shift, how far into it, which orders are open right now, and what each machine
 * is doing this second.
 */
@Injectable()
export class LiveShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oee: OeeStandardService,
    private readonly timeline: StateTimelineService,
    private readonly rejects: RejectReasonService,
  ) {}

  /**
   * Which shift occurrence is running, from the templates alone.
   *
   * Derived from the clock rather than from a `ShiftInstance` row, for the reason
   * `shift-window.util` documents at length: nothing reliably creates those rows,
   * and a screen that waits for one shows an empty shift on a running line.
   */
  async currentShift(factoryId: string | null, now = new Date()): Promise<ShiftHeader> {
    const blank = (): ShiftHeader => {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      return {
        templateId: null,
        code: '—',
        name: 'No shift template covers this time',
        start, end, now, resolved: false,
        elapsedMin: Math.round((now.getTime() - start.getTime()) / 60_000),
        remainingMin: Math.round((end.getTime() - now.getTime()) / 60_000),
        plannedMin: 1440,
        progressPct: 0,
      };
    };
    // ── Why a factory-less user is not turned away ─────────────────────────
    // A SUPER_ADMIN has no `factoryId`, and returning early here showed them
    // "no shift is running" on a working line at half past eleven at night. It
    // is the same account shape that hid an earlier 42702 from every check,
    // because it is the ONE shape that skips the branch under test. A user with
    // no factory sees every factory, so the shift is resolved from every active
    // template rather than from none.
    const templates = (await this.prisma.shiftTemplate.findMany({
      where: { ...(factoryId ? { factoryId } : {}), isActive: true },
      orderBy: { startTime: 'asc' },
      select: { id: true, code: true, name: true, startTime: true, endTime: true, crossesMidnight: true },
    })) as TemplateRow[];
    if (templates.length === 0) return blank();

    const nowMin = now.getHours() * 60 + now.getMinutes();
    const covers = (t: TemplateRow) => {
      const s = hhmm(t.startTime);
      const e = hhmm(t.endTime);
      return t.crossesMidnight ? nowMin >= s || nowMin < e : nowMin >= s && nowMin < e;
    };
    const active = templates.find(covers);
    // A genuine gap between shifts is reported as a gap. Falling back to the
    // first template would put a confident shift name on an hour nobody worked.
    if (!active) return blank();

    const s = hhmm(active.startTime);
    const e = hhmm(active.endTime);
    const start = new Date(now);
    start.setHours(Math.floor(s / 60), s % 60, 0, 0);
    // The post-midnight tail of an overnight shift belongs to yesterday's occurrence.
    if (active.crossesMidnight && nowMin < e) start.setDate(start.getDate() - 1);

    const end = new Date(start);
    end.setHours(Math.floor(e / 60), e % 60, 0, 0);
    if (end <= start) end.setDate(end.getDate() + 1);

    const plannedMin = Math.round((end.getTime() - start.getTime()) / 60_000);
    const elapsedMin = Math.max(0, Math.round((now.getTime() - start.getTime()) / 60_000));
    return {
      templateId: active.id,
      code: active.code,
      name: active.name,
      start, end, now, resolved: true, plannedMin, elapsedMin,
      remainingMin: Math.max(0, plannedMin - elapsedMin),
      progressPct: plannedMin > 0 ? Math.min(100, (elapsedMin / plannedMin) * 100) : 0,
    };
  }

  /**
   * Clamp a requested tail to the shift.
   *
   * Twenty minutes into a shift, "last hour" cannot mean the previous shift's
   * last forty minutes — a live screen that silently borrows from the shift
   * before it reports a number nobody can act on. The window is truncated, and
   * says that it was, rather than reaching back.
   */
  windowOf(shift: ShiftHeader, w: LiveWindow) {
    const to = shift.now < shift.end ? shift.now : shift.end;
    const want = LIVE_WINDOWS[w]?.minutes ?? null;
    const from = want == null
      ? shift.start
      : new Date(Math.max(shift.start.getTime(), to.getTime() - want * 60_000));
    const minutes = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
    return {
      from, to, minutes,
      key: w,
      label: LIVE_WINDOWS[w]?.label ?? 'Whole shift',
      /** True when the shift is younger than the tail asked for. */
      clamped: want != null && minutes < want,
    };
  }

  /**
   * The job orders open in the window, with their product and their progress.
   *
   * Anything that OVERLAPS the window, not only what is EXECUTING this second:
   * an order that closed twenty minutes ago produced part of this shift's output,
   * and a screen that drops it the moment it closes shows a shift whose totals
   * have no visible source.
   */
  async jobOrders(factoryId: string | null, from: Date, to: Date, scope: OeeScope = {}) {
    const rows = await this.prisma.jobOrder.findMany({
      where: {
        ...(factoryId ? { factoryId } : {}),
        ...(scope.machineId ? { machineId: scope.machineId } : {}),
        ...(scope.lineId ? { machine: { lineId: scope.lineId } } : {}),
        ...(scope.areaId
          ? { machine: { OR: [{ areaId: scope.areaId }, { line: { areaId: scope.areaId } }] } }
          : {}),
        actualStart: { not: null, lt: to },
        OR: [{ actualEnd: null }, { actualEnd: { gt: from } }],
      },
      select: {
        id: true, operationName: true, status: true, sequenceOrder: true,
        plannedQtyOut: true, actualQtyGood: true, actualQtyRejected: true,
        outputUnit: true, plannedStart: true, plannedEnd: true,
        actualStart: true, actualEnd: true,
        machine: { select: { id: true, name: true, code: true } },
        workOrder: {
          select: {
            id: true, orderNumber: true,
            sku: {
              select: {
                id: true, code: true, name: true,
                unitsPerInner: true, innersPerCarton: true, cartonsPerPallet: true,
              },
            },
            productionOrder: { select: { id: true, orderNumber: true } },
          },
        },
      },
      orderBy: [{ sequenceOrder: 'asc' }],
    });

    return rows.map((j) => {
      const sku = j.workOrder?.sku;
      const pkg: SkuPackaging = {
        unitsPerInner: sku?.unitsPerInner ?? null,
        innersPerCarton: sku?.innersPerCarton ?? null,
        cartonsPerPallet: sku?.cartonsPerPallet ?? null,
      };
      const unit = j.outputUnit || 'PIECE';
      const good = j.actualQtyGood ?? 0;
      const rejected = j.actualQtyRejected ?? 0;
      const planned = j.plannedQtyOut ?? null;
      return {
        id: j.id,
        operation: j.operationName,
        step: j.sequenceOrder,
        status: j.status,
        machineId: j.machine?.id ?? null,
        machine: j.machine?.name ?? '—',
        machineCode: j.machine?.code ?? null,
        workOrderId: j.workOrder?.id ?? null,
        workOrder: j.workOrder?.orderNumber ?? '—',
        productionOrder: j.workOrder?.productionOrder?.orderNumber ?? null,
        product: sku ? `${sku.code} · ${sku.name}` : '—',
        skuId: sku?.id ?? null,
        // Both the step's own unit and the common one. The raw quantity is what
        // the operator reads off the machine; the piece figure is the only one
        // comparable across steps, and printing one without the other is how a
        // scrapped pallet came to look like a rounding error beside an inner.
        unit,
        plannedQty: planned,
        goodQty: good,
        rejectedQty: rejected,
        goodPieces: toPieces(good, unit, pkg),
        rejectedPieces: toPieces(rejected, unit, pkg),
        progressPct: planned && planned > 0 ? Math.min(100, (good / planned) * 100) : null,
        plannedStart: j.plannedStart,
        plannedEnd: j.plannedEnd,
        actualStart: j.actualStart,
        actualEnd: j.actualEnd,
      };
    });
  }

  /**
   * What each machine is doing this second.
   *
   * `MachineCurrentStatus` rather than the last minute of history: a minute row
   * is up to sixty seconds old and is an AVERAGE of that minute, which is the
   * wrong answer to "is it running right now".
   */
  async machineNow(factoryId: string | null, scope: OeeScope = {}) {
    const where: Prisma.Sql[] = [Prisma.sql`m."isActive" = TRUE`];
    if (factoryId) where.push(Prisma.sql`m."factoryId" = ${factoryId}`);
    if (scope.machineId) where.push(Prisma.sql`m.id = ${scope.machineId}`);
    if (scope.lineId) where.push(Prisma.sql`m."lineId" = ${scope.lineId}`);
    if (scope.areaId) {
      where.push(Prisma.sql`(m."areaId" = ${scope.areaId} OR m."lineId" IN (
        SELECT l2.id FROM production_lines l2 WHERE l2."areaId" = ${scope.areaId}))`);
    }

    return this.prisma.$queryRaw<Array<{
      machineId: string; code: string; name: string;
      state: string | null; since: Date | null; line: string | null;
    }>>(Prisma.sql`
      SELECT m.id AS "machineId", m.code, m.name,
             s."state"::text AS state,
             -- The OPEN state record is the true "since": it is when this state
             -- began. \`lastEventAt\` is only when the row was last touched, which
             -- a restart or a heartbeat moves without the state having changed.
             COALESCE(r."startTime", s."lastEventAt") AS since,
             l.name AS line
      FROM machines m
      LEFT JOIN machine_current_status s ON s."machineId" = m.id
      LEFT JOIN LATERAL (
        SELECT r2."startTime" FROM machine_state_records r2
        WHERE r2."machineId" = m.id AND r2."endTime" IS NULL
        ORDER BY r2."startTime" DESC LIMIT 1
      ) r ON TRUE
      LEFT JOIN production_lines l ON l.id = m."lineId"
      WHERE ${Prisma.join(where, ' AND ')}
      ORDER BY m.code
    `);
  }

  /**
   * Bucket width for a window that may be minutes long.
   *
   * The analysis page buckets by hour or day, which for a fifteen-minute window
   * is a single bar — a trend with one point is not a trend. The width is chosen
   * from the window's own length, and is always a whole number of minutes so the
   * buckets tile the window exactly rather than leaving a ragged last one.
   */
  bucketMinutesFor(windowMin: number): number {
    if (windowMin <= 20) return 1;
    if (windowMin <= 45) return 2;
    if (windowMin <= 90) return 5;
    if (windowMin <= 240) return 10;
    if (windowMin <= 600) return 20;
    return 30;
  }

  async timelineSegments(factoryId: string | null, from: Date, to: Date, scope: OeeScope) {
    return this.timeline.segments(factoryId, from, to, {
      areaId: scope.areaId, lineId: scope.lineId, machineId: scope.machineId,
    });
  }

  /**
   * What the plant BOOKED over the same window.
   *
   * Read on both bases and from the same service the analysis pages use, for
   * the same reason the timeline is: the schedule is a record of a decision,
   * not an output of either minute store, so switching the basis toggle must
   * not appear to change what was planned.
   */
  async plannedSegments(factoryId: string | null, from: Date, to: Date, scope: OeeScope) {
    return this.timeline.plannedSegments(factoryId, from, to, {
      areaId: scope.areaId, lineId: scope.lineId, machineId: scope.machineId,
    });
  }

  /**
   * The same minutes with booked schedule time taking precedence — display only.
   *
   * Pure, over the two arrays the controller already holds. Kept here so the
   * controller reaches one service, and so the projection sits beside the two
   * readings it reconciles rather than in a third place.
   */
  scheduleFirstStates(segments: TimelineSegment[], planned: TimelineSegment[]) {
    return this.timeline.scheduleFirst(segments, planned);
  }

  async rejectReasons(factoryId: string | null, from: Date, to: Date, scope: OeeScope) {
    return this.rejects.topReasons(factoryId, from, to, {
      areaId: scope.areaId, lineId: scope.lineId, machineId: scope.machineId,
    });
  }
}
