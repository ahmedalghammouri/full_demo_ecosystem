import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { MachineStatusService } from './machine-status.service';
import { OeeAnalyticsService } from './oee-analytics.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

/**
 * Machine status analytics — availability, performance and quality over a window.
 *
 * All three take the SAME scope and date parameters and resolve them through the
 * same helpers, so the three tabs of the screen cannot end up describing
 * different machines or different seconds. That divergence is what made the
 * dashboards disagree in the first place.
 */
@ApiTags('Machine Status')
@ApiBearerAuth('JWT-auth')
@Controller('machine-status')
export class MachineStatusController {
  constructor(
    private readonly service: MachineStatusService,
    private readonly lossTree: OeeAnalyticsService,
  ) {}

  @Get('availability')
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'State timeline, minutes by state, and the downtime Pareto' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'YYYY-MM-DD, plant-local' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'YYYY-MM-DD, plant-local' })
  @ApiQuery({ name: 'timeframe', required: false, description: "shift | today | week | month — 'shift' resolves the real shift window from the templates" })
  async availability(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.service.availability(user.factoryId, { areaId, lineId, machineId }, dateFrom, dateTo, timeframe);
  }

  @Get('performance')
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'Pace against ideal cycle time, per machine and per day' })
  async performance(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.service.performance(user.factoryId, { areaId, lineId, machineId }, dateFrom, dateTo, timeframe);
  }

  @Get('quality')
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'Good, scrap and rework, per machine and per day' })
  async quality(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.service.quality(user.factoryId, { areaId, lineId, machineId }, dateFrom, dateTo, timeframe);
  }

  /**
   * The full OEE loss tree: waterfall, losses, TEEP and the factor detail.
   *
   * ONE endpoint feeds the Availability, Performance, Quality and combined
   * analytics pages. They slice the same payload rather than each computing its
   * own version of a shared quantity — which is exactly how the dashboards came
   * to disagree with one another in the first place.
   */
  @Get('analytics')
  @RequirePermissions('production:read')
  @ApiOperation({ summary: 'OEE loss waterfall, TEEP and per-factor detail' })
  async analytics(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('timeframe') timeframe?: string,
  ) {
    return this.lossTree.analytics(user.factoryId, { areaId, lineId, machineId }, dateFrom, dateTo, timeframe);
  }
}
