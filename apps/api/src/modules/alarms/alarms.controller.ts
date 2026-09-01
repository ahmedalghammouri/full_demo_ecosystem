import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { AlarmsService } from './alarms.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { CreateAlarmDto, ResolveAlarmDto } from './dto/alarms.dto';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Alarms')
@ApiBearerAuth('JWT-auth')
@Controller('alarms')
export class AlarmsController {
  constructor(private readonly alarms: AlarmsService) {}

  @Get()
  @ApiOperation({ summary: 'List alarm events with filters' })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'severity', required: false })
  @ApiQuery({ name: 'active', required: false, type: Boolean })
  @ApiQuery({ name: 'jobOrderId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size, capped at 500.' })
  @ApiQuery({ name: 'page', required: false, description: '1-based. Supplying it returns { data, total, page, limit, totalPages }.' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  list(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('severity') severity?: string,
    @Query('active') active?: string,
    @Query('jobOrderId') jobOrderId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('page') page?: string,
  ) {
    return this.alarms.list(user.factoryId, {
      machineId,
      severity,
      active: active === 'true',
      jobOrderId,
      workOrderId,
      from,
      to,
      limit: limit ? parseInt(limit, 10) : undefined,
      // Opt-in: supplying `page` switches the response to { data, total, … }.
      // Omitting it keeps the bare array the other callers expect.
      page: page ? parseInt(page, 10) : undefined,
    });
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Alarm KPIs (active, unacknowledged, critical, last 24h, avg resolution)' })
  kpis(@CurrentUser() user: RequestUser) {
    return this.alarms.kpis(user.factoryId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @AuditLog('ALARM_CREATE')
  @ApiOperation({ summary: 'Raise a manual alarm from the shop floor (tagged to machine / job order)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateAlarmDto) {
    return this.alarms.create(user.factoryId, user.id, dto);
  }

  @Patch(':id/acknowledge')
  @HttpCode(HttpStatus.OK)
  @AuditLog('ALARM_ACK')
  @ApiOperation({ summary: 'Acknowledge an alarm' })
  acknowledge(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.alarms.acknowledge(user.factoryId, id, user.id);
  }

  @Patch(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @AuditLog('ALARM_RESOLVE')
  @ApiOperation({ summary: 'Resolve an alarm (auto-acknowledges, records duration)' })
  resolve(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveAlarmDto,
  ) {
    return this.alarms.resolve(user.factoryId, id, user.id, dto);
  }
  // ────────────────────────────────────────────────────────────
  // ALARM DEFINITIONS — the rules that RAISE the events above
  //
  // Bound to a tag with a condition and a threshold. The edge gateway evaluates
  // them on every reading, so a threshold crossing between two API polls is not
  // missed and alarms keep firing while the link to the API is down.
  // ────────────────────────────────────────────────────────────

  @Get('definitions')
  @RequirePermissions('iot:signals')
  @ApiOperation({ summary: 'List alarm definitions' })
  @ApiQuery({ name: 'tagId', required: false })
  async listDefinitions(@CurrentUser() user: RequestUser, @Query('tagId') tagId?: string) {
    return this.alarms.listDefinitions(user.factoryId, tagId);
  }

  @Post('definitions')
  @RequirePermissions('iot:signals')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an alarm definition' })
  @AuditLog('CREATE_ALARM_DEFINITION')
  async createDefinition(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.alarms.createDefinition(user.factoryId, dto);
  }

  @Patch('definitions/:id')
  @RequirePermissions('iot:signals')
  @ApiOperation({ summary: 'Update an alarm definition' })
  @AuditLog('UPDATE_ALARM_DEFINITION')
  async updateDefinition(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.alarms.updateDefinition(user.factoryId, id, dto);
  }

  @Delete('definitions/:id')
  @RequirePermissions('iot:signals')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an alarm definition' })
  @AuditLog('DELETE_ALARM_DEFINITION')
  async deleteDefinition(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.alarms.deleteDefinition(user.factoryId, id);
  }
}
