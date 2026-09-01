import { Controller, Get, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { User } from '@prisma/client';

import { ApsService } from './aps.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RunScheduleDto, RescheduleJobDto, CtpDto, SaveScheduleDto } from './dto/aps.dto';

@ApiTags('APS — Advanced Planning & Scheduling')
@ApiBearerAuth('JWT-auth')
@Controller('aps')
export class ApsController {
  constructor(private readonly aps: ApsService) {}

  @Get('plan')
  @ApiOperation({ summary: 'Current finite-capacity plan: machine-row Gantt items + KPIs + late orders' })
  getPlan(@CurrentUser() user: User) {
    return this.aps.getPlan(user.factoryId);
  }

  @Post('schedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Recalculate a feasible plan (finite capacity, precedence, priority, due dates)' })
  runSchedule(@CurrentUser() user: User, @Body() dto: RunScheduleDto) {
    return this.aps.runSchedule(user.factoryId, dto);
  }

  @Post('save-schedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Commit a reviewed (dry-run) plan to the database' })
  saveSchedule(@CurrentUser() user: User, @Body() dto: SaveScheduleDto) {
    return this.aps.saveSchedule(user.factoryId, user.id, dto.updates);
  }

  @Post('reschedule-job')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Interactive drag & drop reschedule of one operation (ripples successors)' })
  rescheduleJob(@CurrentUser() user: User, @Body() dto: RescheduleJobDto) {
    return this.aps.rescheduleJob(user.factoryId, dto);
  }

  @Post('ctp')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Capable-to-Promise: earliest feasible delivery date for a SKU + quantity' })
  ctp(@CurrentUser() user: User, @Body() dto: CtpDto) {
    return this.aps.ctp(user.factoryId, dto);
  }

  @Get('mrp')
  @ApiOperation({ summary: 'Material Requirements Planning: BOM explosion vs stock → shortages with order dates' })
  mrp(@CurrentUser() user: User) {
    return this.aps.mrp(user.factoryId);
  }
}
