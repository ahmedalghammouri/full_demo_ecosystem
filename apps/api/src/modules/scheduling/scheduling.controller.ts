import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SchedulingService } from './scheduling.service';

@ApiTags('Scheduling')
@ApiBearerAuth('JWT-auth')
@Controller('scheduling')
export class SchedulingController {
  constructor(private readonly service: SchedulingService) {}

  @Get('unified')
  @ApiOperation({ summary: 'Unified schedule (production orders, work orders, maintenance, planned downtime, shifts) for a date range' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'types', required: false, description: 'csv: PRODUCTION_ORDER,WORK_ORDER,MAINTENANCE,PLANNED_DOWNTIME,UNPLANNED_DOWNTIME,SHIFT' })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  getUnified(
    @CurrentUser() user: User,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('types') types?: string,
    @Query('machineId') machineId?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
  ) {
    return this.service.getUnified(user.factoryId, { dateFrom, dateTo, types, machineId, areaId, lineId });
  }
}
