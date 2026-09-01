import {
  Put,
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe, NotFoundException,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiResponse,
} from '@nestjs/swagger';

import { ProductionService } from './production.service';
import { AttainmentSnapshotService } from './attainment-snapshot.service';
import { plantBound } from '../../common/plant-time.util';
import { OEEService } from './oee.service';
import { KpiService } from './kpi.service';
import { ScheduleKpiService } from './schedule-kpi.service';
import { PrismaService } from '../../database/prisma.service';
import { currentShiftStart } from '../../common/shift-window.util';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateWorkOrderDto,
  UpdateWorkOrderDto,
  StartWorkOrderDto,
  CompleteWorkOrderDto,
  HoldWorkOrderDto,
  CancelWorkOrderDto,
  RecordCountDto,
  CreateProductionOrderDto,
  UpdateProductionOrderDto,
  CreateWOFromPODto,
  ProductionOrderFiltersDto,
  HoldProductionOrderDto,
  CancelProductionOrderDto,
  AutoGenerateWOsDto,
  CreateRescheduleRequestDto,
  ReviewRescheduleRequestDto,
} from './dto/work-order.dto';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

/**
 * Resolve an analysis window, on the SAME terms as every other endpoint.
 *
 * Two things used to make these endpoints disagree with the cards beside them:
 *
 *  1. `timeframe` was ignored. `getOEESummary` resolves 'shift' from the shift
 *     templates (shift start → now); these endpoints silently used a calendar day
 *     instead, so Overall Line OEE covered a different period than the OEE card
 *     directly above it on the same screen.
 *
 *  2. The dates were parsed as UTC (`...T00:00:00.000Z`) while the web builds them
 *     from LOCAL calendar components on purpose — its own comment warns that
 *     `toISOString` shifts local midnight into the previous day. In Riyadh (UTC+3)
 *     that put a three-hour offset between two numbers on one screen. Dropping the
 *     `Z` parses in server-local time, matching the rest of the system.
 *
 * The upper bound never runs past NOW: a KPI cannot cover hours that have not
 * happened, and charging planned time for them is what made Availability read 14%.
 */
async function resolveRange(
  prisma: PrismaService,
  factoryId: string | null,
  timeframe: string | undefined,
  dateFrom?: string,
  dateTo?: string,
  defaultDays = 7,
): Promise<{ from: Date; to: Date }> {
  const now = new Date();

  if (String(timeframe ?? '').toLowerCase() === 'shift') {
    const start = (await currentShiftStart(prisma, factoryId))
      ?? new Date(new Date().setHours(0, 0, 0, 0));
    return { from: start, to: now };
  }

      // Parsed by the shared helper: a bare date keeps its day edge, anything
      // longer is the instant it names. Appending the suffix unconditionally
      // made any sub-day window an Invalid Date and a 500.
  const rawTo = plantBound(dateTo, 'end') ?? now;
  const to = rawTo > now ? now : rawTo;
  const from = dateFrom
    ? (plantBound(dateFrom, 'start') as Date)
    : new Date(to.getTime() - defaultDays * 86_400_000);
  return { from, to };
}

@ApiTags('Production')
@ApiBearerAuth('JWT-auth')
@Controller('production')
export class ProductionController {
  constructor(
    private readonly productionService: ProductionService,
    private readonly oeeService: OEEService,
    private readonly kpiService: KpiService,
    private readonly scheduleKpi: ScheduleKpiService,
    private readonly attainment: AttainmentSnapshotService,
    // Needed to resolve the CURRENT shift from its template, the same way
    // getOEESummary does — otherwise these endpoints answer for a different period.
    private readonly prisma: PrismaService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // KPIs & OEE
  // ────────────────────────────────────────────────────────────

  @Get('kpis')
  @ApiOperation({ summary: 'Production KPIs over the selected period (defaults to today)' })
  @ApiQuery({ name: 'timeframe', required: false, description: 'shift | day | week | month' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getKPIs(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.productionService.getKPIs(
      user.factoryId, { areaId, lineId, machineId }, timeframe, dateFrom, dateTo,
    );
  }

  @Get('oee/calculate')
  @ApiOperation({ summary: 'Get current OEE summary with trend and per-equipment breakdown' })
  @ApiQuery({ name: 'timeframe', required: false, description: 'day | week | month | shift (any case)' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'bucket', required: false, enum: ['hour', 'day', 'week', 'month'] })
  async getOEESummary(
    @CurrentUser() user: RequestUser,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    /** hour | day | week | month. Omitted = chosen from the timeframe. */
    @Query('bucket') bucket?: string,
  ) {
    return this.productionService.getOEESummary(
      user.factoryId, { areaId, lineId, machineId }, timeframe ?? 'day', dateFrom, dateTo,
      { workOrderId, productionOrderId }, bucket,
    );
  }

  @Get('oee/trend')
  @ApiOperation({ summary: 'OEE grouped by machine | workOrder | productionOrder | shift for the trend chart' })
  @ApiQuery({ name: 'groupBy', required: false, description: 'machine | workOrder | productionOrder | shift' })
  @ApiQuery({ name: 'timeframe', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getOeeGroupedTrend(
    @CurrentUser() user: RequestUser,
    @Query('groupBy') groupBy?: string,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('productionOrderId') productionOrderId?: string,
  ) {
    return this.productionService.getOeeGroupedTrend(user.factoryId, { areaId, lineId, machineId }, groupBy ?? 'workOrder', timeframe ?? 'week', dateFrom, dateTo, { workOrderId, productionOrderId });
  }

  @Post('oee/calculate')
  @ApiOperation({ summary: 'Calculate OEE from manual input values' })
  calculateOEE(@Body() body: {
    plannedProductionTime: number;
    downtime: number;
    idealCycleTime: number;
    totalCount: number;
    goodCount: number;
  }) {
    return this.oeeService.calculate(body);
  }

  @Get('oee/hierarchy')
  @ApiOperation({ summary: 'Weighted OEE rolled up Factory→Area→Line→Machine + six-loss + Pareto' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  getOeeHierarchy(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.kpiService.hierarchyOEE(user.factoryId, dateFrom, dateTo, { areaId, lineId, machineId });
  }

  @Get('oee/line')
  @ApiOperation({
    summary: 'Overall Line OEE by the bottleneck method',
    description:
      'Line OEE = Bottleneck Availability × Bottleneck Performance × Final Outfeed Quality. ' +
      'The constraint and outfeed machines are nominated on the production line; when unset ' +
      'the API falls back to lowest design capacity / last machine in line order and reports ' +
      'which rule it used in basis.resolvedBy. Per-machine values are returned alongside as ' +
      'diagnostics — they are not the line KPI.',
  })
  @ApiQuery({ name: 'lineId', required: true })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getLineOee(
    @CurrentUser() user: RequestUser,
    @Query('lineId') lineId: string,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const { from, to } = await resolveRange(this.prisma, user.factoryId, timeframe, dateFrom, dateTo, 7);
    return this.kpiService.lineOeeAnalytics(user.factoryId, lineId, from, to);
  }

  /**
   * Freeze one day of attainment on demand.
   *
   * The cron runs hourly, which is right for a plant and useless for a check
   * that has to happen now — the same reason the OEE writer exposes a capture.
   * Also the backfill route: a plant that installs this today has no history
   * until somebody walks it backwards.
   */
  @Post('kpi/attainment/capture')
  @RequirePermissions('production:write')
  @ApiOperation({ summary: 'Freeze Master Schedule Attainment for a day (defaults to today)' })
  @ApiQuery({ name: 'day', required: false, description: 'YYYY-MM-DD, plant-local. Defaults to today.' })
  @ApiQuery({ name: 'days', required: false, description: 'Also walk back this many days from it.' })
  async captureAttainment(@Query('day') day?: string, @Query('days') days?: string) {
    const at = plantBound(day, 'start') ?? new Date();
    const back = Math.min(Math.max(Number(days) || 0, 0), 400);
    const out: Array<{ day: string; orders: number }> = [];
    for (let i = 0; i <= back; i++) {
      const d = new Date(at.getTime() - i * 24 * 3_600_000);
      out.push({ day: d.toISOString().slice(0, 10), orders: await this.attainment.captureDay(d) });
    }
    return { captured: out.length, days: out };
  }

  @Get('kpi/master-schedule-attainment')
  @ApiOperation({
    summary: 'Master Schedule Attainment (MSA)',
    description:
      'MSA = Σ min(Actual Qty, Scheduled Qty) ÷ Total Scheduled Qty × 100. Each order is ' +
      'credited at most its scheduled quantity, so over-producing one order cannot mask a ' +
      'shortfall on another. Returns the per-order lines behind the figure.',
  })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  async getMasterScheduleAttainment(
    @CurrentUser() user: RequestUser,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('lineId') lineId?: string,
    @Query('skuId') skuId?: string,
  ) {
    const { from, to } = await resolveRange(this.prisma, user.factoryId, timeframe, dateFrom, dateTo, 30);
    // The trend travels with the headline. It is derived from the fact store, not
    // stored, so it costs a query rather than a nightly job — and it can never
    // drift from the figure it sits under.
    const [headline, trend] = await Promise.all([
      // The snapshot is the source when it has rows: it converts units before
      // summing and takes each order's output from its final routing step, both
      // of which the live derivation does not. Without this the headline and the
      // trend directly beneath it read 100% and 5% on the same page.
      this.attainment.headline(user.factoryId, from, to, { lineId, skuId })
        .then((snap) => snap ?? this.scheduleKpi.masterScheduleAttainment(user.factoryId, from, to, { lineId, skuId })),
      // Frozen rows first. A day's attainment divides by a PLAN, and a plan is
      // editable — so a series re-derived on every request redraws its own
      // history the moment somebody corrects a target quantity. Days that were
      // captured come from the snapshot; anything older than the snapshot
      // itself falls back to live derivation, and the response says which.
      this.attainment.trend(user.factoryId, from, to, { lineId, skuId })
        .then(async (stored) => {
          if (stored.length > 0) return stored;
          return this.scheduleKpi.attainmentTrend(user.factoryId, from, to, { lineId, skuId });
        })
        .catch(() => []),
    ]);
    return { ...headline, trend };
  }

  @Get('kpi/capacity-utilization')
  @ApiOperation({
    summary: 'Volume-based capacity utilization',
    description:
      'Actual Units Produced ÷ Maximum Designed Unit Capacity × 100, where the denominator is ' +
      'machine design capacity (units/hour) × calendar hours in the window. Reports any machine ' +
      'in scope without a design capacity, since it contributes nothing to the denominator.',
  })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getCapacityUtilization(
    @CurrentUser() user: RequestUser,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    const { from, to } = await resolveRange(this.prisma, user.factoryId, timeframe, dateFrom, dateTo, 30);
    const [headline, trend] = await Promise.all([
      this.scheduleKpi.volumeCapacityUtilization(user.factoryId, from, to, { areaId, lineId, machineId }),
      this.scheduleKpi.capacityTrend(user.factoryId, from, to, { areaId, lineId, machineId }).catch(() => []),
    ]);
    return { ...headline, trend };
  }

  @Get('oee-records')
  @ApiOperation({ summary: 'Get stored OEE records' })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getOEERecords(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.productionService.getOEERecords(user.factoryId, {
      machineId,
      areaId,
      lineId,
      dateFrom,
      dateTo,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  // ────────────────────────────────────────────────────────────
  // WORK ORDER CRUD
  // ────────────────────────────────────────────────────────────

  @Get('work-orders')
  @ApiOperation({ summary: 'List work orders with filters' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findWorkOrders(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('machineId') machineId?: string,
    @Query('lineId') lineId?: string,
    @Query('areaId') areaId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.productionService.findWorkOrders(user.factoryId, {
      search,
      status: status as any,
      priority,
      machineId,
      lineId,
      areaId,
      dateFrom,
      dateTo,
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get('work-orders/:id')
  @ApiOperation({ summary: 'Get a work order by ID with full detail' })
  async getWorkOrderById(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.getWorkOrderById(user.factoryId, id);
  }

  @Get('work-orders/preview')
  @ApiOperation({ summary: 'Smart preview for a manual work order: routing, smart finish, material shortages' })
  @ApiQuery({ name: 'skuId', required: true })
  @ApiQuery({ name: 'qty', required: true })
  @ApiQuery({ name: 'unit', required: false })
  @ApiQuery({ name: 'from', required: false })
  async previewWorkOrder(
    @CurrentUser() user: RequestUser,
    @Query('skuId') skuId: string,
    @Query('qty') qty: string,
    @Query('unit') unit?: string,
    @Query('from') from?: string,
  ) {
    return this.productionService.previewWorkOrderForSku(user.factoryId, skuId, parseInt(qty, 10), unit, from);
  }

  @Post('work-orders')
  @RequirePermissions('production:write')
  @AuditLog('PRODUCTION_WO_CREATE')
  @ApiOperation({ summary: 'Create a new work order' })
  @ApiResponse({ status: 201, description: 'Work order created' })
  async createWorkOrder(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateWorkOrderDto,
  ) {
    return this.productionService.createWorkOrder(user.factoryId, user.id, dto);
  }

  @Patch('work-orders/:id')
  @RequirePermissions('production:write')
  @AuditLog('PRODUCTION_WO_UPDATE')
  @ApiOperation({ summary: 'Update work order metadata (not status)' })
  async updateWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkOrderDto,
  ) {
    return this.productionService.updateWorkOrder(user.factoryId, id, dto);
  }

  @Delete('work-orders/:id')
  @RequirePermissions('production:write')
  @AuditLog('PRODUCTION_WO_DELETE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a work order (cannot delete IN_PROGRESS)' })
  async deleteWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.productionService.deleteWorkOrder(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // STATE MACHINE TRANSITIONS
  // ────────────────────────────────────────────────────────────

  @Patch('work-orders/:id/start')
  @RequirePermissions('production:execute')
  @AuditLog('PRODUCTION_WO_START')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a planned/released work order → IN_PROGRESS' })
  async startWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartWorkOrderDto,
  ) {
    return this.productionService.startWorkOrder(user.factoryId, user.id, id, dto.operatorId);
  }

  @Patch('work-orders/:id/hold')
  @RequirePermissions('production:execute')
  @AuditLog('PRODUCTION_WO_HOLD')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Hold an in-progress work order → ON_HOLD' })
  async holdWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldWorkOrderDto,
  ) {
    return this.productionService.holdWorkOrder(user.factoryId, user.id, id, dto);
  }

  @Patch('work-orders/:id/release')
  @RequirePermissions('production:execute')
  @AuditLog('PRODUCTION_WO_RELEASE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release a held work order → IN_PROGRESS' })
  async releaseWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.releaseWorkOrder(user.factoryId, user.id, id);
  }

  @Patch('work-orders/:id/cancel')
  @RequirePermissions('production:write')
  @AuditLog('PRODUCTION_WO_CANCEL')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a work order' })
  async cancelWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelWorkOrderDto,
  ) {
    return this.productionService.cancelWorkOrder(user.factoryId, user.id, id, dto.reason);
  }

  @Patch('work-orders/:id/complete')
  @RequirePermissions('production:execute')
  @AuditLog('PRODUCTION_WO_COMPLETE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete an in-progress work order (triggers OEE calculation)' })
  async completeWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteWorkOrderDto,
  ) {
    return this.productionService.completeWorkOrder(user.factoryId, user.id, id, dto);
  }

  // ────────────────────────────────────────────────────────────
  // PRODUCTION COUNT RECORDING
  // ────────────────────────────────────────────────────────────

  @Post('work-orders/:id/count')
  @RequirePermissions('production:execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record production count update (called periodically during production)' })
  async recordCount(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordCountDto,
  ) {
    return this.productionService.recordCount(user.factoryId, id, dto);
  }

  // ────────────────────────────────────────────────────────────
  // BATCH RECORDS
  // ────────────────────────────────────────────────────────────

  @Get('batches')
  @ApiOperation({ summary: 'List batch records' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findBatches(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('skuId') skuId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.productionService.findBatches(user.factoryId, {
      search, status, workOrderId, skuId,
      page: parseInt(page, 10), limit: parseInt(limit, 10),
    });
  }

  @Post('batches')
  @ApiOperation({ summary: 'Create batch record' })
  async createBatch(@CurrentUser() user: RequestUser, @Body() dto: any) {
    const factoryId = user.factoryId ?? dto.factoryId;
    if (!factoryId) throw new Error('Factory context required');
    return this.productionService.createBatch(factoryId, dto);
  }

  @Patch('batches/:id')
  @ApiOperation({ summary: 'Update batch record' })
  async updateBatch(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.productionService.updateBatch(user.factoryId, id, dto);
  }

  @Delete('batches/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a non-active batch record' })
  async deleteBatch(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.deleteBatch(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // PRODUCTION ORDERS (ISA-95 Level 4 — ERP/Scheduling)
  // ────────────────────────────────────────────────────────────

  @Get('production-orders')
  @ApiOperation({ summary: 'List production orders with optional filters' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findProductionOrders(
    @CurrentUser() user: RequestUser,
    @Query() filters: ProductionOrderFiltersDto,
  ) {
    return this.productionService.findProductionOrders(user.factoryId, filters);
  }

  @Post('production-orders')
  @RequirePermissions('production:manage')
  @AuditLog('PRODUCTION_ORDER_CREATE')
  @ApiOperation({ summary: 'Create a new production order (ISA-95 Level 4)' })
  async createProductionOrder(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateProductionOrderDto,
  ) {
    return this.productionService.createProductionOrder(user.factoryId, user.id, dto);
  }

  @Get('production-orders/:id')
  @ApiOperation({ summary: 'Get production order detail with linked work orders' })
  async findOneProductionOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.findOneProductionOrder(user.factoryId, id);
  }

  @Patch('production-orders/:id')
  @RequirePermissions('production:manage')
  @AuditLog('PRODUCTION_ORDER_UPDATE')
  @ApiOperation({ summary: 'Update a production order (blocked once COMPLETED/CANCELLED)' })
  async updateProductionOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductionOrderDto,
  ) {
    return this.productionService.updateProductionOrder(user.factoryId, id, dto);
  }

  @Patch('production-orders/:id/release')
  @RequirePermissions('production:manage')
  @AuditLog('PRODUCTION_ORDER_RELEASE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Release a PLANNED production order → RELEASED (authorises WO creation)' })
  async releaseProductionOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.releaseProductionOrder(user.factoryId, id);
  }

  @Post('production-orders/:id/work-orders')
  @RequirePermissions('production:manage')
  @AuditLog('PRODUCTION_ORDER_WO_CREATE')
  @ApiOperation({ summary: 'Convert a released production order into a work order (ISA-95 PO→WO)' })
  async createWorkOrderFromPO(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWOFromPODto,
  ) {
    return this.productionService.createWorkOrderFromPO(user.factoryId, user.id, id, dto);
  }

  @Patch('production-orders/:id/cancel')
  @RequirePermissions('production:manage')
  @AuditLog('PRODUCTION_ORDER_CANCEL')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a production order (blocked if IN_PROGRESS WOs exist)' })
  async cancelProductionOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelProductionOrderDto,
  ) {
    return this.productionService.cancelProductionOrder(user.factoryId, id, dto.reason);
  }

  @Patch('production-orders/:id/hold')
  @RequirePermissions('production:manage')
  @AuditLog('PRODUCTION_ORDER_HOLD')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put a RELEASED or IN_PROGRESS production order on hold' })
  async holdProductionOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldProductionOrderDto,
  ) {
    return this.productionService.holdProductionOrder(user.factoryId, id, dto.reason);
  }

  @Patch('production-orders/:id/resume')
  @RequirePermissions('production:manage')
  @AuditLog('PRODUCTION_ORDER_RESUME')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume an ON_HOLD production order' })
  async resumeProductionOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.resumeProductionOrder(user.factoryId, id);
  }

  @Patch('production-orders/:id/complete')
  @RequirePermissions('production:manage')
  @AuditLog('PRODUCTION_ORDER_COMPLETE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete an IN_PROGRESS production order' })
  async completeProductionOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.completeProductionOrder(user.factoryId, id);
  }

  @Delete('production-orders/:id')
  @RequirePermissions('production:manage')
  @AuditLog('PRODUCTION_ORDER_DELETE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a PLANNED or CANCELLED production order' })
  async deleteProductionOrder(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.deleteProductionOrder(user.factoryId, id);
  }

  @Get('production-orders/:id/auto-generate-preview')
  @ApiOperation({ summary: 'Preview work orders + smart finish time (overlap-aware schedule + planned stoppage) — no changes made' })
  @ApiQuery({ name: 'from', required: false, description: 'Schedule from this instant (defaults to PO planned start)' })
  async previewAutoGenerateWOs(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('from') from?: string,
  ) {
    return this.productionService.previewAutoGenerateWOs(user.factoryId, id, from);
  }

  // ── Reschedule requests (governance for over-due smart finish) ──
  @Get('reschedule-requests')
  @ApiOperation({ summary: 'List reschedule requests (optionally by status / production order)' })
  async listRescheduleRequests(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('productionOrderId') productionOrderId?: string,
  ) {
    return this.productionService.listRescheduleRequests(user.factoryId, { status, productionOrderId });
  }

  @Post('production-orders/:id/reschedule-requests')
  @AuditLog('RESCHEDULE_REQUEST_CREATE')
  @ApiOperation({ summary: 'Raise a reschedule request when the smart finish exceeds the due date' })
  async createRescheduleRequest(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateRescheduleRequestDto,
  ) {
    return this.productionService.createRescheduleRequest(user.factoryId, user.id, id, dto);
  }

  @Patch('reschedule-requests/:id/review')
  @RequirePermissions('production:manage')
  @AuditLog('RESCHEDULE_REQUEST_REVIEW')
  @ApiOperation({ summary: 'Approve or reject a reschedule request' })
  async reviewRescheduleRequest(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewRescheduleRequestDto,
  ) {
    return this.productionService.reviewRescheduleRequest(user.factoryId, user.id, id, dto.approve, dto.reason);
  }

  @Post('production-orders/:id/auto-generate-work-orders')
  // production:write (not :manage) so Production Supervisors — not only Managers —
  // can generate work orders + pre-assign operators from the auto-generate flow.
  @RequirePermissions('production:write')
  @AuditLog('PRODUCTION_ORDER_AUTO_GENERATE_WOS')
  @ApiOperation({ summary: 'Auto-generate work orders from recipe routing steps (ISA-95 Control Recipe instantiation)' })
  async autoGenerateWorkOrders(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AutoGenerateWOsDto,
  ) {
    return this.productionService.autoGenerateWorkOrders(user.factoryId, user.id, id, dto);
  }

  // ────────────────────────────────────────────────────────────
  // JOB ORDERS (ISA-95 Dispatch List — per RoutingStep per WO)
  // ────────────────────────────────────────────────────────────

  @Get('job-orders')
  @ApiOperation({ summary: 'List all job orders for the factory (dispatch list overview)' })
  @ApiQuery({ name: 'machineIds', required: false, description: 'Comma-separated machine ids (multi-machine filter)' })
  @ApiQuery({ name: 'productionOrderId', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async listAllJobOrders(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    @Query('machineIds') machineIds?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.productionService.listAllJobOrders(user.factoryId, {
      status, workOrderId, productionOrderId, machineIds, areaId, lineId, machineId,
    });
  }

  @Get('job-orders/:id/live')
  @ApiOperation({ summary: 'Live job-order dashboard payload — OEE, six losses, downtime, scrap, trends, alarms, maintenance' })
  async jobOrderLiveDashboard(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.getJobOrderLiveDashboard(user.factoryId, id);
  }

  @Get('work-orders/:id/job-orders')
  @ApiOperation({ summary: 'Get job orders (dispatch list) for a work order' })
  async getJobOrders(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.getJobOrders(user.factoryId, id);
  }

  @Get('work-orders/:id/machine-recommendations')
  @ApiOperation({ summary: 'Per-step machine candidates ranked by earliest finish (default vs ready alternatives)' })
  async machineRecommendations(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.recommendMachines(user.factoryId, id);
  }

  @Post('work-orders/:id/job-orders/generate')
  @RequirePermissions('production:manage')
  @AuditLog('JOB_ORDERS_GENERATE')
  @ApiOperation({ summary: 'Auto-generate job orders from manufacturing process routing steps' })
  async generateJobOrders(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { plannedStart?: string; plannedEnd?: string; clearExisting?: boolean },
  ) {
    return this.productionService.generateJobOrders(user.factoryId, id, dto);
  }

  @Delete('work-orders/:id/job-orders')
  @RequirePermissions('production:manage')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Delete all job orders for a work order (none must be EXECUTING)' })
  async deleteJobOrders(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.productionService.deleteJobOrders(user.factoryId, id);
  }

  @Patch('job-orders/:id/output')
  @RequirePermissions('production:execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Report actual output quantities for an executing/paused/complete job order (no status change)' })
  async reportJobOrderOutput(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { actualQtyGood: number; actualQtyRejected?: number; scrapReason?: string; scrapCategory?: string },
  ) {
    return this.productionService.reportJobOrderOutput(user.factoryId, id, body);
  }

  @Patch('job-orders/:id/add-count')
  @RequirePermissions('production:execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Smart incremental count — ADDS good / scrap(bad) qty to the running totals (each scrap → ScrapLog), and controls handover qty. Deltas may be NEGATIVE to take a count back; the resulting totals are floored at zero.' })
  async addJobOrderCount(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { goodDelta?: number; scrapDelta?: number; scrapReason?: string; scrapCategory?: string; handoverQty?: number },
  ) {
    return this.productionService.addJobOrderCount(user.factoryId, id, body);
  }

  @Get('scrap-logs')
  @ApiOperation({ summary: 'List scrap log entries with optional filters' })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'jobOrderId', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async listScrapLogs(
    @CurrentUser() user: RequestUser,
    @Query('workOrderId') workOrderId?: string,
    @Query('jobOrderId') jobOrderId?: string,
    @Query('category') category?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    return this.productionService.listScrapLogs(user.factoryId, {
      workOrderId,
      jobOrderId,
      category,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Patch('job-orders/:id/operator')
  @RequirePermissions('production:execute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign or unassign an operator to a job order' })
  async assignJobOrderOperator(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { operatorId: string | null },
  ) {
    return this.productionService.assignJobOrderOperator(user.factoryId, id, body.operatorId);
  }

  /**
   * Start, pause, resume or complete EVERY step of a work order together.
   *
   * The line's steps run start-to-start; the operator treats them as one thing
   * and the tablet should too. Four separate taps is four chances for one to be
   * missed, which is exactly what left one machine out of step on 25 Aug 2026.
   */
  @Patch('work-orders/:id/job-orders/status')
  @RequirePermissions('production:execute')
  @AuditLog('WORK_ORDER_JOB_STATUS')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Transition EVERY job order of a work order at once. Steps that cannot move are '
      + 'reported in `skipped` rather than failing the batch.',
  })
  async setWorkOrderJobStatuses(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: string; notes?: string },
  ) {
    return this.productionService.setWorkOrderJobStatuses(
      user.factoryId, user.id, id, body.status, { notes: body.notes },
    );
  }

  // ── Taking a broken machine out of the line ─────────────────────────

  @Get('work-orders/:id/step-bypass')
  @RequirePermissions('production:read')
  @ApiOperation({
    summary: 'Every step of the order, which are bypassed, and which one the line output '
      + 'is currently read from',
  })
  async getStepBypass(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.productionService.getStepBypass(user.factoryId, id);
  }

  /**
   * Bypass a step whose machine has gone out of service, or put it back.
   *
   * Password-gated: this moves the point the WHOLE LINE's good output is read
   * from, on every screen and in both calculation engines at once. The gate is
   * a deliberate pause, not authentication — `production:execute` and the audit
   * record are what say who did it.
   */
  @Patch('job-orders/:id/bypass')
  @RequirePermissions('production:execute')
  @AuditLog('JOB_ORDER_BYPASS')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Take a step out of the line (or put it back). Requires the supervisor password, '
      + 'and refuses to leave an order with no step counting.',
  })
  async setStepBypass(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { bypassed: boolean; password: string; reason?: string },
  ) {
    return this.productionService.setStepBypass(user.factoryId, user.id, id, {
      bypassed: !!body.bypassed,
      password: body.password,
      reason: body.reason,
    });
  }

  // ── An order's own planned stops ─────────────────────────────────────────

  @Get('production-orders/:id/stop-plan')
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'Cleaning, startup and changeover this order will take, in order' })
  async getStopPlan(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.productionService.getStopPlan(user.factoryId, id);
  }

  @Put('production-orders/:id/stop-plan')
  @RequirePermissions('production:write')
  @AuditLog('PRODUCTION_ORDER_STOP_PLAN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Replace the order\'s stop plan. Editing it never rewrites stops already booked — '
      + 'the plan says what happens NEXT time.',
  })
  async setStopPlan(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { items: Array<{
      kind?: string; label: string; durationMin: number;
      sequence?: number; recurrence?: string; affectsOEE?: boolean;
    }> },
  ) {
    return this.productionService.setStopPlan(user.factoryId, id, body.items ?? []);
  }

  @Patch('job-orders/:id/status')
  @RequirePermissions('production:execute')
  @AuditLog('JOB_ORDER_STATUS')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition a job order status (READY → EXECUTING → COMPLETE etc.)' })
  async updateJobOrderStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: {
      status: string;
      actualQtyGood?: number;
      actualQtyRejected?: number;
      handoverQty?: number;
      notes?: string;
    },
  ) {
    return this.productionService.updateJobOrderStatus(user.factoryId, user.id, id, body.status, body);
  }
}
