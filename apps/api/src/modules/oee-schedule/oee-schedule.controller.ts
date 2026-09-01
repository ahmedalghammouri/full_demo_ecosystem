import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { OeeScheduleService, type ScheduleScope } from './oee-schedule.service';
import { OeeScheduleWriter } from './oee-schedule.writer';
import { RejectReasonService } from '../oee-standard/reject-reason.service';
import { LineBasisService, type LineMethod } from '../oee-standard/line-basis.service';
import { StateTimelineService } from '../oee-standard/state-timeline.service';
import { PrismaService } from '../../database/prisma.service';
import { currentShiftWindow } from '../../common/shift-window.util';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { plantBound, resolveLocalRange } from '../../common/plant-time.util';
import { isTrendBucket, defaultTrendBucket, type TrendBucket } from '../../common/trend-bucket.util';

interface RequestUser { id: string; factoryId: string | null }

/** Last instant of the plant-local day `d` falls in. */
function endOfLocalDay(d: Date): Date {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

/**
 * The window a request asks for, honouring `timeframe=shift`.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * The filter panel's "Shift" and "Today" buttons sent IDENTICAL dates: the web
 * helper derives dateFrom by rounding down to midnight for both presets, and
 * distinguishes them only by a `timeframe` these controllers did not read. So
 * the two buttons produced the same window, the same charts and the same
 * numbers, and the night shift's first four and a half hours were missing from
 * the view that claimed to show it.
 *
 * A shift is not a client-side concept — only the server knows the templates —
 * so it is resolved here, by the same helper Live Shift and the production
 * endpoints use. One resolver, or "the shift" means different hours per route.
 *
 * The slot end matters as much as the window: the schedule basis divides by the
 * slot an order was committed to, and for a shift that slot runs to the END of
 * the shift, not to now.
 */
async function resolveRequestWindow(
  prisma: PrismaService,
  factoryId: string | null,
  timeframe: string | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): Promise<{ from: Date; to: Date; slotTo: Date }> {
  const now = new Date();
  if (String(timeframe ?? '').toLowerCase() === 'shift') {
    const shift = await currentShiftWindow(prisma, factoryId);
    if (shift) return { from: shift.start, to: now, slotTo: shift.end };
    // No templates configured. Fall through to the dates rather than invent a
    // shift — a made-up window is worse than the one the client asked for.
  }
  const { from, to, slotTo } = resolveLocalRange(dateFrom, dateTo, 1, now);
  return { from, to, slotTo };
}

/**
 * The schedule basis, on its own path.
 *
 * Third engine, third store, third page. It reads the same signals as the other
 * two and divides them by a different denominator, so a disagreement between any
 * pair of them is information rather than a bug — and none of them can be
 * quietly corrected into agreeing with another.
 */
@ApiTags('OEE Schedule')
@ApiBearerAuth('JWT-auth')


@Controller('oee-schedule')
export class OeeScheduleController {
  constructor(
    private readonly service: OeeScheduleService,
    /** Only for resolving `timeframe=shift` — see resolveRequestWindow. */
    private readonly prisma: PrismaService,
    private readonly writer: OeeScheduleWriter,
    private readonly timeline: StateTimelineService,
    private readonly rejects: RejectReasonService,
    private readonly lineBasis: LineBasisService,
  ) {}

  @Get()
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'The committed-slot time model, per machine, job order and shift' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'YYYY-MM-DD, plant-local' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'YYYY-MM-DD, plant-local' })
  @ApiQuery({
    name: 'bucket', required: false,
    description: 'hour | day | week | month — the trend granularity. Absent means a size picked '
      + 'from how wide the window is (see defaultTrendBucket).',
  })
  @ApiQuery({ name: 'granularity', required: false, description: 'Deprecated alias for `bucket`, and only ever hour | day.' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'jobOrderId', required: false })
  @ApiQuery({ name: 'timeframe', required: false, description: "shift — the RUNNING shift, resolved server-side. Otherwise the dates are used as given." })
  @ApiQuery({ name: 'shiftTemplateId', required: false })
  @ApiQuery({ name: 'shiftCode', required: false, description: 'The shift by code, as the minute rows carry it.' })
  @ApiQuery({
    name: 'lineBasis', required: false,
    description: 'bottleneck | rollup — how a LINE is scored. Ignored when the scope is a '
      + 'single machine. Absent means the method each line is configured with.',
  })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'skuId', required: false, description: 'Product' })
  @ApiQuery({ name: 'productionOrderId', required: false })
  @ApiQuery({ name: 'productionOrderNumber', required: false })
  async overview(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('timeframe') timeframe?: string,
    @Query('bucket') bucketQuery?: string,
    @Query('granularity') granularity?: string,
    @Query('areaId') areaId?: string,
    @Query('machineId') machineId?: string,
    @Query('lineId') lineId?: string,
    @Query('jobOrderId') jobOrderId?: string,
    @Query('shiftTemplateId') shiftTemplateId?: string,
    @Query('shiftCode') shiftCode?: string,
    @Query('skuId') skuId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    @Query('productionOrderNumber') productionOrderNumber?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('lineBasis') lineBasis?: string,
  ) {
    // The window AND the slot end together: `to` is capped at now, because rows
    // only exist once time has passed; the slot is not, because the part of it
    // an order has not reached yet is what makes this basis climb to true.
    const { from, to, slotTo } = await resolveRequestWindow(
      this.prisma, user.factoryId, timeframe, dateFrom, dateTo,
    );
    const scope: ScheduleScope = {
      areaId: areaId || undefined,
      machineId: machineId || undefined,
      lineId: lineId || undefined,
      jobOrderId: jobOrderId || undefined,
      shiftTemplateId: shiftTemplateId || undefined,
      shiftCode: shiftCode || undefined,
      workOrderId: workOrderId || undefined,
      skuId: skuId || undefined,
      productionOrderId: productionOrderId || undefined,
      productionOrderNumber: productionOrderNumber || undefined,
    };
    const f = user.factoryId;

    // `bucket` is the name the web app's own bucket-size menu sends;
    // `granularity` is kept as an alias but was always capped at hour|day —
    // widened here to the full set `trend()` already supports. Neither given
    // means the window's own width picks the size, not a hardcoded hour.
    const requestedBucket = bucketQuery ?? granularity;
    const g: TrendBucket = isTrendBucket(requestedBucket)
      ? requestedBucket
      : defaultTrendBucket(to.getTime() - from.getTime());
    // The request picks the METHOD; the line keeps deciding which machine is its
    // constraint and where units are counted.
    const basisMethod: LineMethod | null =
      lineBasis === 'bottleneck' ? 'BOTTLENECK' : lineBasis === 'rollup' ? 'ROLLUP' : null;

    const [overview, machines, jobOrders, shifts, trend, states, segments, plannedTimeline, rejectReasons] = await Promise.all([
      this.service.overview(f, from, to, slotTo, scope),
      this.service.byMachine(f, from, to, slotTo, scope),
      this.service.byJobOrder(f, from, to, slotTo, scope),
      this.service.byShift(f, from, to, slotTo, scope),
      this.service.trend(f, from, to, slotTo, g, scope),
      this.service.stateBreakdown(f, from, to, scope),
      this.timeline.segments(f, from, to, { areaId, lineId, machineId }),
      // The SCHEDULE for the same window, drawn as a second track above the
      // state track: what the plant intended, over what the machine did.
      this.timeline.plannedSegments(f, from, to, { areaId, lineId, machineId }),
      this.rejects.topReasons(f, from, to, { areaId, lineId, machineId }),
    ]);
    const lineOee = await this.lineBasis.forScope(f, scope, basisMethod,
      (s2) => this.service.overview(f, from, to, slotTo, s2), overview);

    return {
      ...overview, machines, jobOrders, shifts, trend, states, granularity: g,
      lineOee,
      timeline: segments,
      plannedTimeline,
      production: this.timeline.details(segments),
      distribution: this.timeline.distribution(segments),
      rejectReasons,
    };
  }

  /** Capture one minute on demand, for a compressed verification run. */
  @Post('capture')
  @RequirePermissions('production:write')
  @ApiOperation({ summary: 'Capture the just-closed minute now (for simulation and verification)' })
  @ApiQuery({ name: 'at', required: false, description: 'ISO instant to capture the minute BEFORE. Simulation only.' })
  async capture(@Query('at') at?: string) {
    let when = new Date();
    if (at) {
      const parsed = new Date(at);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`'at' is not a valid instant: ${at}`);
      when = parsed;
    }
    const written = await this.writer.captureMinute(when);
    return { written, at: when.toISOString() };
  }
}
