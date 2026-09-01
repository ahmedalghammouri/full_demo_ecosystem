import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiResponse,
} from '@nestjs/swagger';

import { MaintenanceService } from './maintenance.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateMaintenanceWODto,
  UpdateMaintenanceWODto,
  AssignWODto,
  StartWODto,
  CompleteWODto,
  CancelWODto,
  HoldWODto,
  AddSparePartsToWODto,
  IssueSparePartDto,
  CreateFailureModeDto,
  UpdateFailureModeDto,
  SeedStandardFailureModesDto,
} from './dto/maintenance.dto';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Maintenance')
@ApiBearerAuth('JWT-auth')
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenanceService: MaintenanceService) {}

  // ────────────────────────────────────────────────────────────
  // KPIs
  // ────────────────────────────────────────────────────────────

  @Get('kpis')
  @ApiOperation({ summary: 'Get maintenance KPIs' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getKPIs(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.maintenanceService.getKPIs(user.factoryId, { areaId, lineId, machineId });
  }

  @Get('reliability-trend')
  @ApiOperation({ summary: 'Get MTTR/MTBF reliability trend (monthly)' })
  @ApiQuery({ name: 'months', required: false, type: Number })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getReliabilityTrend(
    @CurrentUser() user: RequestUser,
    @Query('months') months?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    const n = months ? Math.min(Math.max(parseInt(months, 10) || 6, 1), 24) : 6;
    return this.maintenanceService.getReliabilityTrend(user.factoryId, n, { areaId, lineId, machineId });
  }

  @Get('reliability-cockpit')
  @ApiOperation({ summary: 'Maintenance & Reliability command-center cockpit' })
  @ApiQuery({ name: 'months', required: false, type: Number })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getReliabilityCockpit(
    @CurrentUser() user: RequestUser,
    @Query('months') months?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    const n = months ? Math.min(Math.max(parseInt(months, 10) || 6, 1), 24) : 6;
    return this.maintenanceService.getReliabilityCockpit(user.factoryId, { areaId, lineId, machineId }, n);
  }

  // ────────────────────────────────────────────────────────────
  // WORK ORDERS
  // ────────────────────────────────────────────────────────────

  @Get('work-orders')
  @ApiOperation({ summary: 'List maintenance work orders' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'priority', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'assignedToId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findWorkOrders(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('priority') priority?: string,
    @Query('machineId') machineId?: string,
    @Query('assignedToId') assignedToId?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.maintenanceService.findWorkOrders(user.factoryId, {
      search,
      status,
      type,
      priority,
      machineId,
      assignedToId,
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get('work-orders/:id')
  @ApiOperation({ summary: 'Get maintenance work order by ID' })
  async getWOById(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.maintenanceService.getWOById(user.factoryId, id);
  }

  @Post('work-orders')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_WO_CREATE')
  @ApiOperation({ summary: 'Create a new maintenance work order' })
  @ApiResponse({ status: 201 })
  async createWO(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateMaintenanceWODto,
  ) {
    return this.maintenanceService.createMaintenanceWO(user.factoryId, user.id, dto);
  }

  // Operator/shop-floor maintenance request — creates a CORRECTIVE work order in
  // OPEN state, requested by the caller. Gated by production:execute (which
  // operators hold) so they can raise a request without full maintenance:write.
  @Post('requests')
  @RequirePermissions('production:execute')
  @AuditLog('MAINTENANCE_REQUEST_CREATE')
  @ApiOperation({ summary: 'Raise a maintenance request from the shop floor (operator)' })
  @ApiResponse({ status: 201 })
  async createRequest(
    @CurrentUser() user: RequestUser,
    @Body() body: { machineId: string; title: string; description?: string; priority?: string },
  ) {
    return this.maintenanceService.createMaintenanceWO(user.factoryId, user.id, {
      type: 'CORRECTIVE',
      priority: (body.priority ?? 'MEDIUM'),
      machineId: body.machineId,
      title: body.title,
      description: body.description,
    } as CreateMaintenanceWODto);
  }

  @Patch('work-orders/:id')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_WO_UPDATE')
  @ApiOperation({ summary: 'Update maintenance work order details' })
  async updateWO(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMaintenanceWODto,
  ) {
    return this.maintenanceService.updateWO(user.factoryId, id, dto);
  }

  @Delete('work-orders/:id')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_WO_DELETE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete a maintenance work order' })
  async deleteWO(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.maintenanceService.deleteWO(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // STATE MACHINE TRANSITIONS
  // ────────────────────────────────────────────────────────────

  @Patch('work-orders/:id/assign')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_WO_ASSIGN')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign WO to a technician → ASSIGNED' })
  async assignWO(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignWODto,
  ) {
    return this.maintenanceService.assignWO(user.factoryId, id, dto);
  }

  @Patch('work-orders/:id/start')
  @RequirePermissions('maintenance:execute')
  @AuditLog('MAINTENANCE_WO_START')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start a maintenance work order → IN_PROGRESS (sets machine to MAINTENANCE state)' })
  async startWO(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: StartWODto,
  ) {
    return this.maintenanceService.startWO(user.factoryId, id, dto);
  }

  @Patch('work-orders/:id/complete')
  @RequirePermissions('maintenance:execute')
  @AuditLog('MAINTENANCE_WO_COMPLETE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a maintenance WO (logs time, cost, spare parts consumption)' })
  async completeWO(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteWODto,
  ) {
    return this.maintenanceService.completeWO(user.factoryId, id, dto);
  }

  @Patch('work-orders/:id/hold')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_WO_HOLD')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Put a maintenance WO on hold → ON_HOLD' })
  async holdWO(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HoldWODto,
  ) {
    return this.maintenanceService.holdWO(user.factoryId, id, dto.reason);
  }

  @Patch('work-orders/:id/resume')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_WO_RESUME')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resume a WO from ON_HOLD → IN_PROGRESS or ASSIGNED' })
  async resumeWO(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.maintenanceService.resumeWO(user.factoryId, id);
  }

  @Patch('work-orders/:id/cancel')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_WO_CANCEL')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a maintenance work order' })
  async cancelWO(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelWODto,
  ) {
    return this.maintenanceService.cancelWO(user.factoryId, id, user.id, dto);
  }

  // ────────────────────────────────────────────────────────────
  // SPARE PART REQUESTS (per WO)
  // ────────────────────────────────────────────────────────────

  @Get('work-orders/:id/spare-parts')
  @ApiOperation({ summary: 'Get spare part requests for a work order' })
  async getWOSpareParts(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.maintenanceService.getWOSpareParts(user.factoryId, id);
  }

  @Post('work-orders/:id/spare-parts')
  @RequirePermissions('maintenance:write')
  @ApiOperation({ summary: 'Add spare part requests to a work order' })
  async addSpareParts(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddSparePartsToWODto,
  ) {
    return this.maintenanceService.addSpareParts(user.factoryId, id, dto.parts);
  }

  @Patch('work-orders/:id/spare-parts/:requestId/issue')
  @RequirePermissions('maintenance:write')
  @AuditLog('SPARE_PART_ISSUED')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inventory confirms issuing spare parts to the work order' })
  async issueSparePart(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @Body() dto: IssueSparePartDto,
  ) {
    return this.maintenanceService.issueSparePart(user.factoryId, id, requestId, user.id, dto);
  }

  @Patch('work-orders/:id/spare-parts/:requestId/cancel')
  @RequirePermissions('maintenance:write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel a pending spare part request' })
  async cancelSparePartRequest(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('requestId', ParseUUIDPipe) requestId: string,
  ) {
    return this.maintenanceService.cancelSparePartRequest(user.factoryId, id, requestId);
  }

  // ────────────────────────────────────────────────────────────
  // PENDING PARTS REQUESTS (inventory team view)
  // ────────────────────────────────────────────────────────────

  @Get('pending-parts')
  @ApiOperation({ summary: 'List all pending spare part requests across active WOs (for inventory team)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getPendingPartsRequests(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.maintenanceService.getPendingPartsRequests(user.factoryId, {
      search,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  // ────────────────────────────────────────────────────────────
  // SPARE PARTS INVENTORY
  // ────────────────────────────────────────────────────────────

  @Get('spare-parts')
  @ApiOperation({ summary: 'List spare parts inventory' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'lowStock', required: false, type: Boolean })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findSpareParts(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('category') category?: string,
    @Query('lowStock') lowStock?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.maintenanceService.findSpareParts(user.factoryId, {
      search,
      category,
      lowStock: lowStock === 'true',
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  // ────────────────────────────────────────────────────────────
  // PM PLANS & TASKS
  // ────────────────────────────────────────────────────────────

  @Get('failure-modes')
  @ApiOperation({ summary: 'List FMEA failure modes (optionally by machine)' })
  @ApiQuery({ name: 'machineId', required: false })
  async findFailureModes(@CurrentUser() user: RequestUser, @Query('machineId') machineId?: string) {
    return this.maintenanceService.findFailureModes(user.factoryId, machineId);
  }

  @Post('failure-modes')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_FAILURE_MODE_CREATE')
  @ApiOperation({ summary: 'Create an FMEA failure mode for a machine' })
  @ApiResponse({ status: 201 })
  async createFailureMode(@CurrentUser() user: RequestUser, @Body() dto: CreateFailureModeDto) {
    return this.maintenanceService.createFailureMode(user.factoryId, dto);
  }

  @Post('failure-modes/seed-standard')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_FAILURE_MODE_SEED')
  @ApiOperation({ summary: 'Seed the standard FMEA library onto a machine' })
  async seedStandardFailureModes(@CurrentUser() user: RequestUser, @Body() dto: SeedStandardFailureModesDto) {
    return this.maintenanceService.seedStandardFailureModes(user.factoryId, dto.machineId);
  }

  @Patch('failure-modes/:id')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_FAILURE_MODE_UPDATE')
  @ApiOperation({ summary: 'Update an FMEA failure mode' })
  async updateFailureMode(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateFailureModeDto,
  ) {
    return this.maintenanceService.updateFailureMode(user.factoryId, id, dto);
  }

  @Delete('failure-modes/:id')
  @RequirePermissions('maintenance:write')
  @AuditLog('MAINTENANCE_FAILURE_MODE_DELETE')
  @ApiOperation({ summary: 'Delete (or disable if in use) an FMEA failure mode' })
  async deleteFailureMode(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.maintenanceService.deleteFailureMode(user.factoryId, id);
  }

  @Get('pm-plans')
  @ApiOperation({ summary: 'List preventive maintenance plans' })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findPMPlans(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.maintenanceService.findPMPlans(user.factoryId, {
      machineId,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  // ────────────────────────────────────────────────────────────
  // PREVENTIVE MAINTENANCE (/preventive alias for PM Plans)
  // ────────────────────────────────────────────────────────────

  @Get('preventive/kpis')
  @ApiOperation({ summary: 'Get preventive maintenance KPIs' })
  async getPreventiveKPIs(@CurrentUser() user: RequestUser) {
    return this.maintenanceService.getPreventiveKPIs(user.factoryId);
  }

  @Get('preventive')
  @ApiOperation({ summary: 'List preventive maintenance schedules' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findPreventive(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.maintenanceService.findPreventiveSchedules(user.factoryId, {
      search,
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Post('preventive')
  @ApiOperation({ summary: 'Create a preventive maintenance schedule' })
  async createPreventive(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.maintenanceService.createPreventiveSchedule(user.factoryId, dto);
  }

  @Patch('preventive/:id')
  @ApiOperation({ summary: 'Update a preventive maintenance schedule' })
  async updatePreventive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.maintenanceService.updatePreventiveSchedule(user.factoryId, id, dto);
  }

  @Delete('preventive/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a preventive maintenance schedule' })
  async deletePreventive(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.maintenanceService.deletePreventiveSchedule(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // ASSETS (Machine-based)
  // ────────────────────────────────────────────────────────────

  @Get('assets')
  @ApiOperation({ summary: 'List machines / assets' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findAssets(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.maintenanceService.findAssets(user.factoryId, {
      search,
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Post('assets')
  @ApiOperation({ summary: 'Register a new asset (machine)' })
  async createAsset(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.maintenanceService.createAsset(user.factoryId, dto);
  }

  @Patch('assets/:id')
  @ApiOperation({ summary: 'Update asset details' })
  async updateAsset(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.maintenanceService.updateAsset(user.factoryId, id, dto);
  }

  @Delete('assets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete an asset' })
  async deleteAsset(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.maintenanceService.deleteAsset(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // SPARE PARTS KPIs
  // ────────────────────────────────────────────────────────────

  @Get('spare-parts/kpis')
  @ApiOperation({ summary: 'Get spare parts KPIs' })
  async getSparePartsKPIs(@CurrentUser() user: RequestUser) {
    return this.maintenanceService.getSparePartsKPIs(user.factoryId);
  }

  @Get('pm-tasks')
  @ApiOperation({ summary: 'List PM task schedule' })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findPMTasks(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('status') status?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.maintenanceService.findPMTasks(user.factoryId, {
      machineId,
      status,
      dateFrom,
      dateTo,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }
}
