import { Controller, Get, Query, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardService } from './dashboard.service';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Dashboard')
@ApiBearerAuth('JWT-auth')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get real-time operations dashboard data' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'timeframe', required: false, description: 'today | shift | week | month | custom' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'ISO date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'ISO date (YYYY-MM-DD)' })
  async getOverview(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getOverview(
      user.factoryId,
      { areaId, lineId, machineId },
      { timeframe, dateFrom, dateTo },
    );
  }

  @Get('command-center')
  @ApiOperation({ summary: 'Unified Command Center cockpit (OEE + production + losses + energy + executive rollup)' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'timeframe', required: false, description: 'today | shift | week | month | custom' })
  @ApiQuery({ name: 'dateFrom', required: false, description: 'ISO date (YYYY-MM-DD)' })
  @ApiQuery({ name: 'dateTo', required: false, description: 'ISO date (YYYY-MM-DD)' })
  async getCommandCenter(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getCommandCenter(
      user.factoryId,
      { areaId, lineId, machineId },
      { timeframe, dateFrom, dateTo },
    );
  }

  @Get('executive')
  @ApiOperation({ summary: 'Executive multi-plant cockpit (enterprise rollup across factories)' })
  @ApiQuery({ name: 'timeframe', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getExecutive(
    @CurrentUser() user: RequestUser,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.dashboardService.getExecutive(user.factoryId, { timeframe, dateFrom, dateTo });
  }

  @Get('plant-layout')
  @ApiOperation({ summary: 'Floor plan with each cell live state — the digital twin' })
  @ApiQuery({ name: 'factoryId', required: false })
  plantLayout(@CurrentUser() user: RequestUser, @Query('factoryId') factoryId?: string) {
    const id = factoryId ?? user.factoryId;
    if (!id) {
      throw new ForbiddenException(
        'No factory in scope. Select a factory, or pass ?factoryId= when signed in at enterprise level.',
      );
    }
    return this.dashboardService.plantLayout(id);
  }

  @Get('kpis')
  @ApiOperation({
    summary: 'KPI strip for a scope and period',
    description:
      'Honours the same timeframe/dateFrom/dateTo as every other analysis endpoint.',
  })
  @ApiQuery({ name: 'timeframe', required: false, description: 'day | week | month | shift | custom' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getKPIs(
    @CurrentUser() user: RequestUser,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    // The period was NOT forwarded here. The web sent timeframe/dateFrom/dateTo and
    // this endpoint discarded them, so getOverview fell back to "today" — a KPI strip
    // showing today's 8,017 units under a filter the user had set to 01–09 Aug
    // (19,266). The numbers were right for a window nobody asked for.
    const data = await this.dashboardService.getOverview(
      user.factoryId,
      { areaId, lineId, machineId },
      { timeframe, dateFrom, dateTo },
    );
    return data.kpis;
  }
}
