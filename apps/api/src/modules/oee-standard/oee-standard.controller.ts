import { BadRequestException, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { OeeStandardService, type OeeScope } from './oee-standard.service';
import { OeeStandardWriter } from './oee-standard.writer';
import { RejectReasonService } from './reject-reason.service';
import { LineBasisService, type LineMethod } from './line-basis.service';
import { StateTimelineService } from './state-timeline.service';
import { PrismaService } from '../../database/prisma.service';
import { currentShiftWindow } from '../../common/shift-window.util';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { resolveLocalRange } from '../../common/plant-time.util';
import { isTrendBucket, defaultTrendBucket, type TrendBucket } from '../../common/trend-bucket.util';

interface RequestUser { id: string; factoryId: string | null }

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
 * The standard OEE engine, exposed on its own path.
 *
 * Deliberately parallel to the existing endpoints rather than replacing them.
 * Two engines answering the same question from the same raw data is how a plant
 * finds out which one is wrong — and until it has, retiring either one would be
 * removing the evidence.
 */
@ApiTags('OEE Standard')
@ApiBearerAuth('JWT-auth')


@Controller('oee-standard')
export class OeeStandardController {
  constructor(
    private readonly service: OeeStandardService,
    /** Only for resolving `timeframe=shift` — see resolveRequestWindow. */
    private readonly prisma: PrismaService,
    private readonly writer: OeeStandardWriter,
    private readonly timeline: StateTimelineService,
    private readonly rejects: RejectReasonService,
    private readonly lineBasis: LineBasisService,
  ) {}

  private scope(q: Record<string, string | undefined>): OeeScope {
    return {
      areaId: q.areaId || undefined,
      machineId: q.machineId || undefined,
      lineId: q.lineId || undefined,
      jobOrderId: q.jobOrderId || undefined,
      workOrderId: q.workOrderId || undefined,
      shiftTemplateId: q.shiftTemplateId || undefined,
      // The shift by CODE, as the minute rows carry it: nothing creates
      // ShiftInstance rows here, so the writer derives a code per minute and the
      // grouped views key on that — a template id matches nothing for them.
      shiftCode: q.shiftCode || undefined,
      skuId: q.skuId || undefined,
      productionOrderId: q.productionOrderId || undefined,
      productionOrderNumber: q.productionOrderNumber || undefined,
    };
  }

  /** Everything one screen needs, from one window, in one round trip. */
  @Get()
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'Time model, factors, per-machine and per-shift breakdown, trend and audit' })
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
    const { from, to } = await resolveRequestWindow(this.prisma, user.factoryId, timeframe, dateFrom, dateTo);
    const scope = this.scope({
      areaId, machineId, lineId, jobOrderId, shiftTemplateId, shiftCode,
      skuId, productionOrderId, productionOrderNumber, workOrderId,
    });
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
    // constraint and where units are counted. Anything unrecognised means "use
    // what the line is set to" rather than a guess.
    const basisMethod: LineMethod | null =
      lineBasis === 'bottleneck' ? 'BOTTLENECK' : lineBasis === 'rollup' ? 'ROLLUP' : null;

    const [overview, machines, jobOrders, shifts, trend, states, segments, plannedTimeline, rejectReasons] = await Promise.all([
      this.service.overview(f, from, to, scope),
      this.service.byMachine(f, from, to, scope),
      this.service.byJobOrder(f, from, to, scope),
      this.service.byShift(f, from, to, scope),
      this.service.trend(f, from, to, g, scope),
      this.service.stateBreakdown(f, from, to, scope),
      this.timeline.segments(f, from, to, { areaId, lineId, machineId }),
      // The SCHEDULE for the same window, drawn as a second track above the
      // state track: what the plant intended, over what the machine did.
      this.timeline.plannedSegments(f, from, to, { areaId, lineId, machineId }),
      this.rejects.topReasons(f, from, to, { areaId, lineId, machineId }),
    ]);

    // What the LINE (or the area, or the factory) scored, as opposed to what its
    // machines did. Computed after the aggregate above rather than instead of it:
    // the machine table is unchanged either way, and a reader comparing the two
    // is doing exactly what this page is for.
    const lineOee = await this.lineBasis.forScope(f, scope, basisMethod,
      (s2) => this.service.overview(f, from, to, s2), overview);

    // The episode counts come from the same segments the chart draws, so the
    // number under the bar and the blocks in it can never tell two stories.
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

  /**
   * What the filter is allowed to offer, for this window and this scope.
   *
   * Served from the same rows the page reads, so every option returns something.
   */
  /**
   * What the plan says is happening RIGHT NOW, per machine.
   *
   * The operator tablet needs one sentence -- "Lunch Break until 13:30" -- and
   * the Machine status timeline already draws exactly this from
   * `plannedSegments`. Rather than a second query with its own idea of a
   * planned stop, this asks the same function for a narrow window around now
   * and returns whichever band covers it. One definition, two screens.
   */
  @Get('planned-now')
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'The planned stop covering this instant, per machine' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async plannedNow(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    const now = Date.now();
    // Wide enough to catch a band that started before this instant, narrow
    // enough that the query stays cheap on a tablet polling it.
    const from = new Date(now - 12 * 3600_000);
    const to = new Date(now + 12 * 3600_000);
    // Scope arrives as area / line / machine and is resolved server-side, the
    // way every other endpoint here does it. An earlier version took a raw
    // `machineIds` list from the client -- which `scope-reachable.spec.ts`
    // exists to forbid, and caught. A client-supplied id list walks straight
    // past the scope resolution that decides what this user may see.
    const segments = await this.timeline.plannedSegments(
      user.factoryId, from, to, this.scope({ areaId, lineId, machineId }),
    );

    // `plannedSegments` encodes whether a stop COSTS the reading in its kind:
    // an excluded stop is 'planned' and a charged one -- changeover, startup --
    // is 'downtime'. Filtering on 'planned' alone silently dropped every
    // changeover, which is the stop the line most wants warning about.
    // 'running' is the production band and is not a stop at all.
    const isStop = (sg: { kind: string }) => sg.kind === 'planned' || sg.kind === 'downtime';
    const stamp = (sg: { kind: string }) => ({ charged: sg.kind === 'downtime' });

    const active = segments
      .filter((sg) => isStop(sg)
        && +new Date(sg.from) <= now && +new Date(sg.to) > now)
      .map((sg) => ({ ...sg, ...stamp(sg) }));

    // Next up, so a tablet can say "Lunch Break in 20 minutes" rather than only
    // reporting a stop once the line has already gone quiet.
    const upcoming = segments
      .filter((sg) => isStop(sg) && +new Date(sg.from) > now)
      .sort((a, b) => +new Date(a.from) - +new Date(b.from))
      .slice(0, 4)
      .map((sg) => ({ ...sg, ...stamp(sg) }));

    return { now: new Date(now).toISOString(), active, upcoming };
  }

  @Get('dimensions')
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'Products, production orders, work orders and shifts present in the window' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async dimensions(
    @CurrentUser() user: RequestUser,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('machineId') machineId?: string,
    @Query('lineId') lineId?: string,
    @Query('shiftTemplateId') shiftTemplateId?: string,
    @Query('skuId') skuId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    @Query('productionOrderNumber') productionOrderNumber?: string,
    @Query('workOrderId') workOrderId?: string,
  ) {
    // The same resolver as the overview above. The dimension lists populate
    // the scope tree's filters, so they must cover the hours the page covers —
    // otherwise Shift offers products and orders that only ran earlier today.
    const { from, to } = await resolveRequestWindow(this.prisma, user.factoryId, timeframe, dateFrom, dateTo);
    return this.service.dimensions(user.factoryId, from, to, this.scope({
      areaId, machineId, lineId, shiftTemplateId, skuId, productionOrderId, productionOrderNumber, workOrderId,
    }));
  }

  /**
   * Capture one minute on demand.
   *
   * The writer is on a cron, but a simulation that compresses an eight-hour
   * shift into ten minutes needs to drive it directly — otherwise a test of the
   * arithmetic becomes a test of how long you are willing to wait.
   */
  @Post('capture')
  @RequirePermissions('production:write')
  @ApiOperation({ summary: 'Capture the just-closed minute now (for simulation and verification)' })
  @ApiQuery({
    name: 'at', required: false,
    description: 'ISO instant to capture the minute BEFORE. Simulation only — lets a scenario ' +
      'replay eight hours in seconds instead of waiting for them.',
  })
  async capture(@Query('at') at?: string) {
    // A synthetic instant is accepted so a verification run can compress time.
    // It is validated rather than trusted: an unparseable value silently falling
    // back to "now" would write a minute in the wrong bucket and make the
    // verification pass against the wrong data.
    let when = new Date();
    if (at) {
      const parsed = new Date(at);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(`'at' is not a valid instant: ${at}`);
      }
      when = parsed;
    }
    const written = await this.writer.captureMinute(when);
    return { written, at: when.toISOString() };
  }
}
