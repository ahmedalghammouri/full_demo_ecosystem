import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { PlannedStopService } from './planned-stop.service';
import { WorkOrderStopService } from './work-order-stop.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

/**
 * Planned stops, their schedules, and the work-order rules that create them.
 *
 * Everything here removes time from the OEE availability denominator, so it is
 * gated on `shifts:manage` rather than on read access: seeing when the plant
 * takes a break and deciding it are different privileges.
 */
@ApiTags('Planned Stops')
@ApiBearerAuth('JWT-auth')
@Controller('planned-stops')
export class PlannedStopController {
  constructor(
    private readonly plannedStops: PlannedStopService,
    private readonly workOrderStops: WorkOrderStopService,
  ) {}

  // ── Schedules ─────────────────────────────────────────────────────────────

  @Get('schedules')
  @ApiOperation({ summary: 'Recurrence rules for shifts and planned stops' })
  async listSchedules(@CurrentUser() user: RequestUser) {
    return this.plannedStops.listScheduleRules(user.factoryId);
  }

  @Post('schedules')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('shifts:manage')
  @AuditLog('CREATE_SCHEDULE_RULE')
  @ApiOperation({ summary: 'Create a recurrence: weekdays + range, perpetual, or a one-off date' })
  async createSchedule(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.plannedStops.createScheduleRule(user.factoryId, dto);
  }

  @Patch('schedules/:id')
  @RequirePermissions('shifts:manage')
  @AuditLog('UPDATE_SCHEDULE_RULE')
  async updateSchedule(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.plannedStops.updateScheduleRule(user.factoryId, id, dto);
  }

  @Delete('schedules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('shifts:manage')
  @AuditLog('DELETE_SCHEDULE_RULE')
  async deleteSchedule(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.plannedStops.deleteScheduleRule(user.factoryId, id);
  }

  // ── Planned stop templates ────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Planned stop templates' })
  @ApiQuery({ name: 'shiftTemplateId', required: false })
  async list(@CurrentUser() user: RequestUser, @Query('shiftTemplateId') shiftTemplateId?: string) {
    return this.plannedStops.listTemplates(user.factoryId, shiftTemplateId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('shifts:manage')
  @AuditLog('CREATE_PLANNED_STOP')
  @ApiOperation({ summary: 'Create a planned stop — inside a shift, or on its own schedule' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.plannedStops.createTemplate(user.factoryId, dto);
  }

  @Patch(':id')
  @RequirePermissions('shifts:manage')
  @AuditLog('UPDATE_PLANNED_STOP')
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.plannedStops.updateTemplate(user.factoryId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('shifts:manage')
  @AuditLog('DELETE_PLANNED_STOP')
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.plannedStops.deleteTemplate(user.factoryId, id);
  }

  @Post('materialise')
  @RequirePermissions('shifts:manage')
  @AuditLog('MATERIALISE_PLANNED_STOPS')
  @ApiOperation({ summary: 'Create the downtime events for a date range (idempotent)' })
  async materialise(
    @CurrentUser() user: RequestUser,
    @Body() dto: { dateFrom: string; dateTo?: string; templateIds?: string[] },
  ) {
    return this.plannedStops.materialise(user.factoryId, dto);
  }

  // ── Work-order stop rules ─────────────────────────────────────────────────

  @Get('work-order-rules')
  @ApiOperation({ summary: 'Stops that run with a work order, such as changeover' })
  async listWorkOrderRules(@CurrentUser() user: RequestUser) {
    return this.workOrderStops.list(user.factoryId);
  }

  @Post('work-order-rules')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('shifts:manage')
  @AuditLog('CREATE_WO_STOP_RULE')
  @ApiOperation({ summary: 'Create a rule triggered by a product change, an order change, or always' })
  async createWorkOrderRule(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.workOrderStops.create(user.factoryId, dto);
  }

  @Patch('work-order-rules/:id')
  @RequirePermissions('shifts:manage')
  @AuditLog('UPDATE_WO_STOP_RULE')
  async updateWorkOrderRule(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.workOrderStops.update(user.factoryId, id, dto);
  }

  @Delete('work-order-rules/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('shifts:manage')
  @AuditLog('DELETE_WO_STOP_RULE')
  async deleteWorkOrderRule(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrderStops.remove(user.factoryId, id);
  }
}
