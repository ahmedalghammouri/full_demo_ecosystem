import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { DowntimeService } from './downtime.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { resolveLocalRange } from '../../common/plant-time.util';
import {
  CreateDowntimeEventDto,
  UpdateDowntimeEventDto,
  EndDowntimeEventDto,
  AcknowledgeDowntimeDto,
} from './dto/downtime.dto';

// A minimal DTO for the "close" alias used by the frontend
class CloseDowntimeDto {
  endTime?: string;
}

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Downtime')
@ApiBearerAuth('JWT-auth')
@Controller('production/downtime')
export class DowntimeController {
  constructor(private readonly downtimeService: DowntimeService) {}

  @Get('events')
  @ApiOperation({ summary: 'List downtime events with filters' })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'isPlanned', required: false, type: Boolean })
  @ApiQuery({ name: 'isOpen', required: false, type: Boolean })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findEvents(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('isPlanned') isPlanned?: string,
    @Query('isOpen') isOpen?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.downtimeService.findDowntimeEvents(user.factoryId, {
      machineId,
      workOrderId,
      isPlanned: isPlanned !== undefined ? isPlanned === 'true' : undefined,
      isOpen: isOpen !== undefined ? isOpen === 'true' : undefined,
      dateFrom,
      dateTo,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Post('events')
  @RequirePermissions('production:execute')
  @AuditLog('DOWNTIME_EVENT_CREATE')
  @ApiOperation({ summary: 'Create a new downtime event for a machine' })
  async createEvent(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateDowntimeEventDto,
  ) {
    return this.downtimeService.createDowntimeEvent(user.factoryId, user.id, dto);
  }

  @Patch('events/:id')
  @RequirePermissions('production:execute')
  @AuditLog('DOWNTIME_EVENT_UPDATE')
  @ApiOperation({ summary: 'Update downtime event (cause, category, notes)' })
  async updateEvent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDowntimeEventDto,
  ) {
    return this.downtimeService.updateDowntimeEvent(user.factoryId, id, dto);
  }

  @Patch('events/:id/end')
  @RequirePermissions('production:execute')
  @AuditLog('DOWNTIME_EVENT_END')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'End an open downtime event (set end time, record resolution)' })
  async endEvent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EndDowntimeEventDto,
  ) {
    return this.downtimeService.endDowntimeEvent(user.factoryId, id, user.id, dto);
  }

  @Patch('events/:id/acknowledge')
  @RequirePermissions('production:execute')
  @AuditLog('DOWNTIME_EVENT_ACK')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge a downtime event' })
  async acknowledgeEvent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AcknowledgeDowntimeDto,
  ) {
    return this.downtimeService.acknowledgeDowntimeEvent(user.factoryId, id, user.id, dto.notes);
  }

  // ── Frontend-friendly flat routes (no /events/ prefix) ──────

  @Get()
  @ApiOperation({ summary: 'List downtime events (flat route)' })
  async findEventsFlat(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('isOpen') isOpen?: string,
    @Query('includeOpen') includeOpen?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    const openFlag = isOpen === 'true' || includeOpen === 'true' ? true : undefined;
    return this.downtimeService.findDowntimeEvents(user.factoryId, {
      machineId,
      workOrderId,
      isOpen: openFlag,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create downtime event (flat route)' })
  async createEventFlat(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateDowntimeEventDto,
  ) {
    return this.downtimeService.createDowntimeEvent(user.factoryId, user.id, dto);
  }

  @Patch(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close/end an open downtime event' })
  async closeEvent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CloseDowntimeDto,
  ) {
    return this.downtimeService.endDowntimeEvent(user.factoryId, id, user.id, {
      endTime: dto.endTime,
    } as EndDowntimeEventDto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions('production:execute')
  @AuditLog('DOWNTIME_EVENT_DELETE')
  @ApiOperation({ summary: 'Delete a downtime event (supervisor only, for data correction)' })
  async deleteEvent(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.downtimeService.deleteDowntimeEvent(user.factoryId, id);
  }

  // ──────────────────────────────────────────────────────────────

  @Get('causes')
  @ApiOperation({ summary: 'Get downtime cause codes (reference data)' })
  @ApiQuery({ name: 'machineId', required: false })
  async getCauses(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
  ) {
    return this.downtimeService.findDowntimeCauses(user.factoryId, machineId);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Get downtime summary for a date range' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getSummary(
    @CurrentUser() user: RequestUser,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    // Local dates, clamped to now — the same window convention as every other KPI.
    const sumNow = new Date();
    const { from, to } = dateFrom || dateTo
      ? resolveLocalRange(dateFrom, dateTo, 1, sumNow)
      : { from: new Date(new Date().setHours(0, 0, 0, 0)), to: sumNow };
    return this.downtimeService.getDowntimeSummary(user.factoryId, from, to, { areaId, lineId, machineId });
  }

  @Get('cockpit')
  @ApiOperation({ summary: 'Downtime Command Center — KPIs, trend, Pareto, machines, live + recent events' })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getCockpit(
    @CurrentUser() user: RequestUser,
    @Query('timeframe') timeframe?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    const cockNow = new Date();
    const { from, to } = dateFrom || dateTo
      ? resolveLocalRange(dateFrom, dateTo, 1, cockNow)
      : { from: new Date(new Date().setHours(0, 0, 0, 0)), to: cockNow };
    return this.downtimeService.getDowntimeCockpit(user.factoryId, { areaId, lineId, machineId }, from, to, timeframe);
  }

  // ── Machine state (operator, shop floor) ──────────────────────

  @Patch('machines/:id/state')
  @RequirePermissions('production:execute')
  @AuditLog('MACHINE_STATE_CHANGE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Operator machine-state change — syncs state timeline, downtime event and linked job order' })
  async setMachineState(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: {
      state: string;
      downtimeCauseId?: string;
      reasonCode?: string;
      category?: string;
      reason?: string;
      notes?: string;
      jobOrderId?: string;
      workOrderId?: string;
    },
  ) {
    return this.downtimeService.setMachineState(user.factoryId, user.id, id, dto);
  }

  // ── Reason Tree ────────────────────────────────────────────────

  @Get('reasons/tree')
  @ApiOperation({ summary: 'Get 3-level downtime reason tree (L1 → L2 → L3 leaf codes)' })
  async getReasonTree(@CurrentUser() user: RequestUser) {
    return this.downtimeService.getReasonTree(user.factoryId);
  }

  @Post('reasons')
  @ApiOperation({ summary: 'Create a reason tree node (L1, L2, or L3)' })
  async createReason(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.downtimeService.createReasonNode(user.factoryId ?? '', dto);
  }

  @Patch('reasons/:id')
  @ApiOperation({ summary: 'Update a reason node (name, active, sortOrder, etc.)' })
  async updateReason(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.downtimeService.updateReasonNode(user.factoryId ?? '', id, dto);
  }

  @Delete('reasons/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a leaf reason node (only if unused)' })
  async deleteReason(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.downtimeService.deleteReasonNode(user.factoryId ?? '', id);
  }
}
