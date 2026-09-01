import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { EnergyService } from './energy.service';
import { EnergyWoMachineService } from './energy-wo-machine.service';
import { EnergyAnalyticsService, EnergyGroupBy } from './energy-analytics.service';
import { CarbonService } from './carbon.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveLocalRange } from '../../common/plant-time.util';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

const ANALYTICS_GROUP_BY = [
  'sku', 'workOrder', 'productionOrder', 'machine', 'line', 'area', 'shift', 'hour', 'day', 'week',
] as const;

/** `dateFrom`/`dateTo` are plain dates; default to the trailing 30 days. */
function resolveRange(dateFrom?: string, dateTo?: string): { from: Date; to: Date } {
  // Delegates to the ONE definition of a local analysis window. Parsing these as
  // UTC put energy three hours out of step with every production KPI beside it,
  // and made a "Today" window start in the future at a +03 plant.
  return resolveLocalRange(dateFrom, dateTo, 30);
}

@ApiTags('Energy')
@ApiBearerAuth('JWT-auth')
@Controller('energy')
export class EnergyController {
  constructor(
    private readonly energyService: EnergyService,
    private readonly energyWoMachine: EnergyWoMachineService,
    private readonly energyAnalytics: EnergyAnalyticsService,
    private readonly carbon: CarbonService,
  ) {}

  // ────────────────────────────────────────────────────────────
  // SCOPE 2 CARBON — purchased-electricity emissions
  // ────────────────────────────────────────────────────────────

  @Get('carbon/scope2')
  @ApiOperation({
    summary: 'Scope 2 carbon footprint (kg CO2e) for a scope and period',
    description:
      'kg CO2e = kWh purchased electricity × grid emission factor. kWh is read from the same ' +
      'source as the Energy dashboard so the two always reconcile. The response carries the ' +
      'factor actually applied, its unit, source and effective date, and flags when no factor ' +
      'is configured and the KSA default was used.',
  })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getScope2(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    const { from, to } = resolveRange(dateFrom, dateTo);
    return this.carbon.scope2(user.factoryId, { areaId, lineId, machineId }, from, to);
  }

  @Get('carbon/work-orders/:workOrderId')
  @ApiOperation({ summary: 'Scope 2 emissions and carbon intensity for one work order' })
  async getScope2ByWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param('workOrderId') workOrderId: string,
  ) {
    return this.carbon.scope2ByWorkOrder(user.factoryId, workOrderId);
  }

  @Get('carbon/emission-factors')
  @ApiOperation({ summary: 'List configured grid emission factors (newest effective date first)' })
  async listEmissionFactors(@CurrentUser() user: RequestUser) {
    return this.carbon.listFactors(user.factoryId);
  }

  @Get('carbon/emission-factor')
  @ApiOperation({ summary: 'The grid emission factor currently in force' })
  async getActiveEmissionFactor(@CurrentUser() user: RequestUser) {
    return this.carbon.resolveFactor(user.factoryId);
  }

  @Post('carbon/emission-factors')
  @ApiOperation({
    summary: 'Add a new grid emission factor version',
    description:
      'Closes the currently-open version at the new effective date instead of overwriting it, ' +
      'so historical carbon reports stay reproducible.',
  })
  async createEmissionFactor(
    @CurrentUser() user: RequestUser,
    @Body() dto: { factorKgPerKwh: number; source?: string; effectiveFrom?: string; notes?: string; unit?: string },
  ) {
    return this.carbon.createFactor(user.factoryId as string, dto);
  }

  // ────────────────────────────────────────────────────────────
  // ANALYTICS — kWh per product / WO / shift / machine / time
  // ────────────────────────────────────────────────────────────

  @Get('analytics')
  @ApiOperation({
    summary: 'Multi-dimensional energy analysis (kWh and kWh per unit by any dimension)',
    description:
      'Groups consumption by product, work order, production order, machine, line, ' +
      'area, shift or time bucket, with the per-unit ratio, idle/downtime waste share ' +
      'and cost. Honours the same area/line/machine scope as the rest of the platform.',
  })
  @ApiQuery({ name: 'groupBy', required: false, enum: ANALYTICS_GROUP_BY })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  async getAnalytics(
    @CurrentUser() user: RequestUser,
    @Query('groupBy') groupBy?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('skuId') skuId?: string,
    @Query('workOrderId') workOrderId?: string,
  ) {
    const g = (ANALYTICS_GROUP_BY as readonly string[]).includes(groupBy ?? '')
      ? (groupBy as EnergyGroupBy)
      : 'machine';
    const { from, to } = resolveRange(dateFrom, dateTo);
    return this.energyAnalytics.analyse(user.factoryId, g, {
      from,
      to,
      areaId,
      lineId,
      machineId,
      skuId,
      workOrderId,
    });
  }

  @Get('analytics/filter-options')
  @ApiOperation({ summary: 'Products and work orders that have energy data in the window' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getAnalyticsFilterOptions(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const { from, to } = resolveRange(dateFrom, dateTo);
    return this.energyAnalytics.getFilterOptions(user.factoryId, from, to);
  }

  // ────────────────────────────────────────────────────────────
  // ENERGY RATIO — per work order × machine
  // ────────────────────────────────────────────────────────────

  // `workOrderId` accepts the UUID *or* the order number ("WO-2026-0007") — no
  // ParseUUIDPipe, because the order number is what operators actually read and type.
  @Get('work-orders/:workOrderId/machine-kpis')
  @ApiOperation({
    summary: 'Energy ratio (kWh per unit) per machine for a work order',
    description:
      'Specific energy consumption resolved to each machine that ran the order, ' +
      'with the idle/downtime share and the variance against the best previously ' +
      'demonstrated ratio for that machine and product. Computes on first request ' +
      'if it has not been persisted yet. Accepts a work order UUID or order number.',
  })
  async getWorkOrderMachineKpis(@Param('workOrderId') workOrderId: string) {
    return this.energyWoMachine.getForWorkOrder(workOrderId);
  }

  @Post('work-orders/:workOrderId/machine-kpis/recompute')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Force a recompute of a work order’s per-machine energy ratios',
    description: 'Accepts a work order UUID or order number.',
  })
  async recomputeWorkOrderMachineKpis(@Param('workOrderId') workOrderId: string) {
    const machines = await this.energyWoMachine.recomputeForWorkOrder(workOrderId);
    return { workOrderId, machines, recomputed: machines.length };
  }

  @Get('machines/:machineId/energy-ratio-trend')
  @ApiOperation({ summary: 'Energy-ratio trend for one machine across its recent work orders' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max work orders to return (default 20, max 100)' })
  async getMachineEnergyTrend(
    @CurrentUser() user: RequestUser,
    @Param('machineId', ParseUUIDPipe) machineId: string,
    @Query('limit') limit?: string,
  ) {
    return this.energyWoMachine.getMachineTrend(machineId, user.factoryId, limit ? Number(limit) : 20);
  }

  @Get('energy-ratio-leaderboard')
  @ApiOperation({ summary: 'Machines ranked by specific energy consumption in a window' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async getEnergyRatioLeaderboard(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('limit') limit?: string,
  ) {
    const { from, to } = resolveLocalRange(dateFrom, dateTo, 30);
    return this.energyWoMachine.getLeaderboard(user.factoryId, from, to, limit ? Number(limit) : 10);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Energy management overview KPIs' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getOverview(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.energyService.getOverview(user.factoryId, { areaId, lineId, machineId });
  }

  @Get('cockpit')
  @ApiOperation({ summary: 'Energy Command Center cockpit (overview + live + consumption + waste + specific energy)' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getCockpit(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.energyService.getEnergyCockpit(user.factoryId, { areaId, lineId, machineId }, { dateFrom, dateTo });
  }

  @Get('live')
  @ApiOperation({ summary: 'Live power per meter + standby/no-production detection' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getLive(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.energyService.getLivePower(user.factoryId, { areaId, lineId, machineId });
  }

  @Get('meters')
  @ApiOperation({ summary: 'List all energy meters with last reading' })
  async findMeters(@CurrentUser() user: RequestUser) {
    return this.energyService.findMeters(user.factoryId);
  }

  @Post('meters')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an energy meter' })
  async createMeter(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.energyService.createMeter(user.factoryId, dto);
  }

  @Patch('meters/:id')
  @ApiOperation({ summary: 'Update an energy meter' })
  async updateMeter(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.energyService.updateMeter(user.factoryId, id, dto);
  }

  @Delete('meters/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deactivate an energy meter' })
  async deleteMeter(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.energyService.deleteMeter(user.factoryId, id);
  }

  @Get('meter-templates')
  @ApiOperation({ summary: 'List built-in power-meter register templates' })
  getMeterTemplates() {
    return this.energyService.getMeterTemplates();
  }

  @Get('meters/:id/tags')
  @ApiOperation({ summary: 'List a meter’s ENERGY tags (separate from machine tags)' })
  async getMeterTags(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.energyService.getMeterTags(user.factoryId, id);
  }

  @Post('meters/:id/apply-template')
  @ApiOperation({ summary: 'Set the meter template; the edge gateway materializes the tags' })
  async applyTemplate(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { templateKey: string },
  ) {
    return this.energyService.updateMeter(user.factoryId, id, { templateKey: dto.templateKey });
  }

  @Post('readings')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add manual energy reading' })
  async addReading(
    @CurrentUser() user: RequestUser,
    @Body() dto: { meterId: string; value: number; timestamp?: string; source?: string },
  ) {
    return this.energyService.addReading(user.factoryId, dto);
  }

  @Get('tariffs')
  @ApiOperation({ summary: 'List configured energy cost tariffs (scoped rates)' })
  async listTariffs(@CurrentUser() user: RequestUser) {
    return this.energyService.listTariffs(user.factoryId);
  }

  @Post('tariffs')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an energy cost tariff (factory/area/line/machine scope)' })
  async createTariff(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.energyService.createTariff(user.factoryId, dto);
  }

  @Patch('tariffs/:id')
  @ApiOperation({ summary: 'Update an energy cost tariff' })
  async updateTariff(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.energyService.updateTariff(user.factoryId, id, dto);
  }

  @Delete('tariffs/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an energy cost tariff' })
  async deleteTariff(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.energyService.deleteTariff(user.factoryId, id);
  }

  @Get('consumption')
  @ApiOperation({ summary: 'Energy consumption data for charts' })
  @ApiQuery({ name: 'from', required: true })
  @ApiQuery({ name: 'to', required: true })
  @ApiQuery({ name: 'periodType', required: false })
  @ApiQuery({ name: 'meterId', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getConsumption(
    @CurrentUser() user: RequestUser,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('periodType') periodType?: string,
    @Query('meterId') meterId?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.energyService.getConsumption(user.factoryId, { from, to, periodType, meterId, areaId, lineId, machineId });
  }
}
