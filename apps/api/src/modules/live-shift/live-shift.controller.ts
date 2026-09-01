import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { LiveShiftService, LIVE_WINDOWS, isLiveWindow } from './live-shift.service';
import { OeeStandardService, type OeeScope } from '../oee-standard/oee-standard.service';
import { OeeScheduleService } from '../oee-schedule/oee-schedule.service';
import { LineBasisService, type LineMethod } from '../oee-standard/line-basis.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

interface RequestUser { id: string; factoryId: string | null }

/**
 * The current shift, live.
 *
 * ── Why there is no dateFrom/dateTo here ────────────────────────────────────
 * The window is the shift, and the shift is decided by the clock. Accepting a
 * date pair would let this screen be pointed at last Tuesday, at which point it
 * is the analysis page with a worse filter — and the two would start to disagree
 * about the same Tuesday, which is the failure this split exists to end.
 *
 * A widget may narrow to a TAIL of the shift (`window=60`), and the service
 * clamps that to the shift start, so nothing on the page can show minutes that
 * belong to the shift before.
 */
@ApiTags('Live Shift')
@ApiBearerAuth('JWT-auth')
@Controller('live-shift')
export class LiveShiftController {
  constructor(
    private readonly live: LiveShiftService,
    private readonly oee: OeeStandardService,
    private readonly schedule: OeeScheduleService,
    private readonly lineBasis: LineBasisService,
  ) {}

  private scope(q: Record<string, string | undefined>): OeeScope {
    return {
      areaId: q.areaId || undefined,
      lineId: q.lineId || undefined,
      machineId: q.machineId || undefined,
      skuId: q.skuId || undefined,
      workOrderId: q.workOrderId || undefined,
      productionOrderId: q.productionOrderId || undefined,
      productionOrderNumber: q.productionOrderNumber || undefined,
      // Accepted for parity with the analysis pages. The live window is the
      // RUNNING shift, so this narrows within it rather than selecting a
      // different one — a widget scoped to the code the minutes carry.
      shiftCode: q.shiftCode || undefined,
    };
  }

  /**
   * Everything the live screen needs, for one window, in one round trip.
   *
   * The per-widget range controls each call this again with their own `window`,
   * which costs a request but keeps every widget's numbers self-consistent — a
   * shared payload sliced client-side would have each widget re-deriving totals,
   * and that is exactly how the counts drifted before.
   */
  @Get()
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'Current shift: header, orders, machines, totals, trend and timeline' })
  @ApiQuery({
    name: 'window', required: false,
    description: `Tail of the shift to show: ${Object.keys(LIVE_WINDOWS).join(' | ')}`,
  })
  @ApiQuery({
    name: 'basis', required: false,
    description: 'standard (OEE-TB, time that went by) | schedule (OEE, the committed slot). '
      + 'The same switch the analysis page honours.',
  })
  @ApiQuery({
    name: 'lineBasis', required: false,
    description: 'bottleneck | rollup — how a LINE is scored. Ignored for a single machine.',
  })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'productionOrderId', required: false })
  @ApiQuery({ name: 'productionOrderNumber', required: false })
  @ApiQuery({ name: 'shiftCode', required: false, description: 'The shift by code, as the minute rows carry it.' })
  async overview(
    @CurrentUser() user: RequestUser,
    @Query('window') windowKey?: string,
    @Query('basis') basisKey?: string,
    @Query('lineBasis') lineBasis?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('skuId') skuId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    @Query('productionOrderNumber') productionOrderNumber?: string,
    @Query('shiftCode') shiftCode?: string,
  ) {
    const f = user.factoryId;
    const scope = this.scope({ areaId, lineId, machineId, skuId, workOrderId, productionOrderId, productionOrderNumber, shiftCode });
    // An unknown window falls back to the whole shift rather than 400-ing: a
    // stale bookmark should show the shift, not an error page.
    const w = isLiveWindow(windowKey) ? (windowKey as string) : 'shift';

    // Anything other than an explicit 'schedule' is the standard basis. The two
    // are not interchangeable readings of one number, so an unrecognised value
    // has to land somewhere definite rather than being guessed at.
    const basis: 'standard' | 'schedule' = basisKey === 'schedule' ? 'schedule' : 'standard';
    const basisMethod: LineMethod | null =
      lineBasis === 'bottleneck' ? 'BOTTLENECK' : lineBasis === 'rollup' ? 'ROLLUP' : null;

    const shift = await this.live.currentShift(f);
    const win = this.live.windowOf(shift, w);
    // The shift is also a scope dimension — without it the totals would cover
    // whatever minutes fall in the window regardless of which shift claimed them,
    // which at a shift boundary is two shifts added together.
    const scoped: OeeScope = { ...scope, shiftTemplateId: shift.templateId ?? undefined };
    const slotTo = w === 'shift' ? shift.end : win.to;

    // ── Bucket width comes from what is CHARTED, not from what is measured ──
    // The standard basis charts the window, so the two are the same. The
    // schedule basis charts the whole committed slot, including the part not
    // yet reached — so 24 minutes of data on a 12-hour shift was being drawn at
    // the 2-minute width the 24 minutes deserved, and generated 360 buckets, 348
    // of them empty. The payload went from 124 KB to 622 KB and the chart became
    // unreadable, for a window the reader had narrowed on purpose.
    const chartedMin = basis === 'schedule'
      ? Math.max(win.minutes, (slotTo.getTime() - win.from.getTime()) / 60_000)
      : win.minutes;
    const bucketMin = this.live.bucketMinutesFor(chartedMin);

    // A window that has not started yet (the first seconds of a shift) has no
    // rows and no meaningful trend. Returning the header alone is honest; running
    // six aggregates over an empty range to print zeros is not.
    if (win.minutes <= 0) {
      return {
        shift, window: win, bucketMin, basis, empty: true, lineOee: null,
        totals: null, machines: [], jobOrders: [], machineNow: [],
        trend: [], timeline: [], plannedTimeline: [], states: [], statesScheduleFirst: [],
        rejectReasons: null,
        production: null, windows: LIVE_WINDOWS,
      };
    }

    /**
     * How far the committed slot reaches, on the schedule basis.
     *
     * The rule is the same one the analysis page uses — the slot is clipped to
     * the window being shown — applied to what "the window" means here. For the
     * whole shift that is the whole shift, INCLUDING the part still ahead: the
     * unreached remainder is the term that makes a schedule reading climb from
     * low to true as the shift runs, and dropping it would turn this basis into
     * the standard one wearing a different name. For a tail there is no ahead,
     * so the slot stops where the tail does.
     */

    const [totals, machines, jobOrders, machineNow, trend, states, timeline, plannedTimeline, rejectReasons] =
      await Promise.all([
        basis === 'schedule'
          ? this.schedule.overview(f, win.from, win.to, slotTo, scoped)
          : this.oee.overview(f, win.from, win.to, scoped),
        basis === 'schedule'
          ? this.schedule.byMachine(f, win.from, win.to, slotTo, scoped)
          : this.oee.byMachine(f, win.from, win.to, scoped),
        this.live.jobOrders(f, win.from, win.to, scope),
        this.live.machineNow(f, scope),
        basis === 'schedule'
          ? this.schedule.trendByMinutes(f, win.from, win.to, slotTo, bucketMin, scoped)
          : this.oee.trendByMinutes(f, win.from, win.to, bucketMin, scoped),
        basis === 'schedule'
          ? this.schedule.stateBreakdown(f, win.from, win.to, scoped)
          : this.oee.stateBreakdown(f, win.from, win.to, scoped),
        // The timeline and the reject reasons read machine states and scrap
        // logs, not either minute store, so they are the same on both bases —
        // and must be, or switching the toggle would appear to rewrite history.
        this.live.timelineSegments(f, win.from, win.to, scope),
        // The SCHEDULE for the same window, drawn as a second band above each
        // machine's own — what was booked, over what the sensor reported.
        this.live.plannedSegments(f, win.from, win.to, scope),
        this.live.rejectReasons(f, win.from, win.to, scope),
      ]);

    // `overview()` carries its own `window` (the bare from/to it was given). The
    // live window is spread AFTER it on purpose: it is the same span plus the
    // label and the clamp flag, and the page needs to be able to say "last hour,
    // truncated to 20 min" rather than just showing two timestamps.
    // What the line scored this shift, on whichever basis the page is showing.
    // The aggregate closure is bound to the SAME engine as everything above it,
    // so the line figure and the machine rows can never come from different
    // stores.
    const lineOee = await this.lineBasis.forScope(f, scoped, basisMethod,
      (s2) => (basis === 'schedule'
        ? this.schedule.overview(f, win.from, win.to, slotTo, s2)
        : this.oee.overview(f, win.from, win.to, s2)),
      totals);

    return {
      ...totals,
      shift, window: win, bucketMin, basis, empty: false,
      lineOee,
      slotTo,
      machines, jobOrders, machineNow, trend, states, timeline, plannedTimeline, rejectReasons,
      // The same minutes with booked schedule time taking precedence, for the
      // one panel that reads them that way. Derived here from the two arrays
      // above rather than queried, so it cannot diverge from what the timeline
      // draws -- and cannot reach anything that computes an OEE figure.
      statesScheduleFirst: this.live.scheduleFirstStates(timeline, plannedTimeline),
      windows: LIVE_WINDOWS,
    };
  }
}
