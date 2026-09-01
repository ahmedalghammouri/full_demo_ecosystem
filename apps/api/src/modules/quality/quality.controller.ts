import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery, ApiResponse } from '@nestjs/swagger';

import { QualityService } from './quality.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreateInspectionDto,
  RecordSpcDto,
  UpdateInspectionDto,
  CreateNCRDto,
  UpdateNCRDto,
  UpdateNCRStatusDto,
  CreateCAPADto,
  UpdateCAPADto,
  AddCAPAActionDto,
  VerifyCAPADto,
  CreateQualityPlanDto,
  UpdateQualityPlanDto,
  CreateQualityParameterDto,
  UpdateQualityParameterDto,
} from './dto/quality.dto';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Quality')
@ApiBearerAuth('JWT-auth')
@Controller('quality')
export class QualityController {
  constructor(private readonly qualityService: QualityService) {}

  // ────────────────────────────────────────────────────────────
  // KPIs
  // ────────────────────────────────────────────────────────────

  @Get('kpis')
  @ApiOperation({ summary: 'Get quality KPIs for current day' })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  async getKPIs(
    @CurrentUser() user: RequestUser,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('machineId') machineId?: string,
  ) {
    return this.qualityService.getKPIs(user.factoryId, { areaId, lineId, machineId });
  }

  @Get('cockpit')
  @ApiOperation({ summary: 'Quality Intelligence command-center cockpit' })
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
    return this.qualityService.getQualityCockpit(user.factoryId, { areaId, lineId, machineId }, { dateFrom, dateTo });
  }

  // ────────────────────────────────────────────────────────────
  // INSPECTIONS
  // ────────────────────────────────────────────────────────────

  @Get('inspections')
  @ApiOperation({ summary: 'List inspection results' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'result', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findInspections(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('result') result?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('machineId') machineId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('archived') archived?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.qualityService.findInspections(user.factoryId, {
      search,
      type,
      result,
      workOrderId,
      productionOrderId,
      machineId,
      areaId,
      lineId,
      dateFrom,
      dateTo,
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get('inspections/:id')
  @ApiOperation({ summary: 'Get inspection by ID' })
  async getInspectionById(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.getInspectionById(user.factoryId, id);
  }

  @Post('inspections')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_INSPECTION_CREATE')
  @ApiOperation({ summary: 'Create a new inspection result' })
  @ApiResponse({ status: 201 })
  async createInspection(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateInspectionDto,
  ) {
    return this.qualityService.createInspection(user.factoryId, user.id, dto);
  }

  @Patch('inspections/:id')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_INSPECTION_UPDATE')
  @ApiOperation({ summary: 'Update an inspection result' })
  async updateInspection(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateInspectionDto,
  ) {
    return this.qualityService.updateInspection(user.factoryId, id, dto);
  }

  // ────────────────────────────────────────────────────────────
  // NCRs
  // ────────────────────────────────────────────────────────────

  @Get('ncr')
  @ApiOperation({ summary: 'List non-conformance reports' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'severity', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findNCRs(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('machineId') machineId?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('skuId') skuId?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.qualityService.findNCRs(user.factoryId, {
      search,
      status,
      severity,
      dateFrom,
      dateTo,
      machineId,
      areaId,
      lineId,
      skuId,
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get('ncr/:id')
  @ApiOperation({ summary: 'Get NCR by ID with linked CAPAs' })
  async getNCRById(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.getNCRById(user.factoryId, id);
  }

  @Post('ncr')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_NCR_CREATE')
  @ApiOperation({ summary: 'Create a non-conformance report' })
  @ApiResponse({ status: 201 })
  async createNCR(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateNCRDto,
  ) {
    return this.qualityService.createNCR(user.factoryId, user.id, dto);
  }

  @Patch('ncr/:id')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_NCR_UPDATE')
  @ApiOperation({ summary: 'Update NCR details' })
  async updateNCR(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNCRDto,
  ) {
    return this.qualityService.updateNCR(user.factoryId, id, dto);
  }

  @Patch('ncr/:id/status')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_NCR_STATUS')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition NCR workflow status (OPEN → IN_REVIEW → CAPA_PENDING → RESOLVED → CLOSED)' })
  async updateNCRStatus(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNCRStatusDto,
  ) {
    return this.qualityService.updateNCRStatus(user.factoryId, id, user.id, dto);
  }

  // ────────────────────────────────────────────────────────────
  // CAPAs
  // ────────────────────────────────────────────────────────────

  @Get('capa')
  @ApiOperation({ summary: 'List corrective/preventive actions' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'ncrId', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findCAPAs(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('ncrId') ncrId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('archived') archived?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.qualityService.findCAPAs(user.factoryId, {
      search,
      status,
      type,
      ncrId,
      dateFrom,
      dateTo,
      archived,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get('capa/:id')
  @ApiOperation({ summary: 'Get CAPA by ID with actions' })
  async getCAPAById(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.getCAPAById(user.factoryId, id);
  }

  @Post('capa')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_CAPA_CREATE')
  @ApiOperation({ summary: 'Create a corrective/preventive action (optionally linked to NCR)' })
  @ApiResponse({ status: 201 })
  async createCAPA(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateCAPADto,
  ) {
    return this.qualityService.createCAPA(user.factoryId, user.id, dto);
  }

  @Patch('capa/:id')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_CAPA_UPDATE')
  @ApiOperation({ summary: 'Update CAPA details' })
  async updateCAPA(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCAPADto,
  ) {
    return this.qualityService.updateCAPA(user.factoryId, id, dto);
  }

  @Post('capa/:id/actions')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_CAPA_ACTION_ADD')
  @ApiOperation({ summary: 'Add an action item to a CAPA' })
  async addCAPAAction(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddCAPAActionDto,
  ) {
    return this.qualityService.addCAPAAction(user.factoryId, id, dto);
  }

  @Patch('capa/:capaId/actions/:actionId/complete')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_CAPA_ACTION_COMPLETE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a CAPA action as completed' })
  async completeCAPAAction(
    @CurrentUser() user: RequestUser,
    @Param('capaId', ParseUUIDPipe) capaId: string,
    @Param('actionId', ParseUUIDPipe) actionId: string,
  ) {
    return this.qualityService.completeCAPAAction(user.factoryId, capaId, actionId);
  }

  @Patch('capa/:id/verify')
  @RequirePermissions('quality:approve')
  @AuditLog('QUALITY_CAPA_VERIFY')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Verify CAPA effectiveness (all actions must be completed)' })
  async verifyCAPA(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: VerifyCAPADto,
  ) {
    return this.qualityService.verifyCAPA(user.factoryId, id, user.id, dto);
  }

  @Patch('capa/:id/close')
  @RequirePermissions('quality:approve')
  @AuditLog('QUALITY_CAPA_CLOSE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Close a verified CAPA' })
  async closeCAPA(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.closeCAPA(user.factoryId, id);
  }

  @Delete('capa/:id')
  @RequirePermissions('quality:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an open CAPA' })
  async deleteCAPA(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.deleteCAPA(user.factoryId, id);
  }

  @Delete('ncr/:id')
  @RequirePermissions('quality:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an open NCR' })
  async deleteNCR(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.deleteNCR(user.factoryId, id);
  }

  @Delete('inspections/:id')
  @RequirePermissions('quality:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an inspection result' })
  async deleteInspection(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.deleteInspection(user.factoryId, id);
  }

  // ────────────────────────────────────────────────────────────
  // QUALITY PLANS (ISA-95 QualityTest definitions)
  // ────────────────────────────────────────────────────────────

  @Get('plans')
  @ApiOperation({ summary: 'List quality plans with parameters (ISA-95 QualityTestSpecification)' })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  async findQualityPlans(
    @CurrentUser() user: RequestUser,
    @Query('skuId') skuId?: string,
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
    @Query('archived') archived?: string,
    @Query('machineId') machineId?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
  ) {
    const activeFilter = isActive === 'false' ? false : isActive === 'true' ? true : undefined;
    return this.qualityService.findQualityPlans(user.factoryId, { skuId, type, isActive: activeFilter, archived, machineId, areaId, lineId });
  }

  @Get('plans/:id')
  @ApiOperation({ summary: 'Get quality plan by ID with parameters' })
  async getQualityPlanById(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.getQualityPlanById(user.factoryId, id);
  }

  @Post('plans')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_PLAN_CREATE')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a quality plan (ISA-95 QualityTestSpecification)' })
  async createQualityPlan(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateQualityPlanDto,
  ) {
    if (!user.factoryId) throw new Error('Factory context required');
    return this.qualityService.createQualityPlan(user.factoryId, dto);
  }

  @Patch('plans/:id')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_PLAN_UPDATE')
  @ApiOperation({ summary: 'Update a quality plan' })
  async updateQualityPlan(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateQualityPlanDto,
  ) {
    return this.qualityService.updateQualityPlan(user.factoryId, id, dto);
  }

  @Delete('plans/:id')
  @RequirePermissions('quality:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a quality plan (only if no inspection records)' })
  async deleteQualityPlan(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.deleteQualityPlan(user.factoryId, id);
  }

  @Patch('plans/:id/approve')
  @RequirePermissions('quality:approve')
  @AuditLog('QUALITY_PLAN_APPROVE')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a quality plan' })
  async approveQualityPlan(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.qualityService.approveQualityPlan(user.factoryId, id, user.id);
  }

  // ── Parameters ──────────────────────────────────────────────

  @Post('plans/:planId/parameters')
  @RequirePermissions('quality:write')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a check-point parameter to a quality plan' })
  async addParameter(
    @CurrentUser() user: RequestUser,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() dto: CreateQualityParameterDto,
  ) {
    return this.qualityService.addParameter(user.factoryId, planId, dto);
  }

  @Patch('plans/:planId/parameters/:paramId')
  @RequirePermissions('quality:write')
  @ApiOperation({ summary: 'Update a quality plan parameter' })
  async updateParameter(
    @CurrentUser() user: RequestUser,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Param('paramId', ParseUUIDPipe) paramId: string,
    @Body() dto: UpdateQualityParameterDto,
  ) {
    return this.qualityService.updateParameter(user.factoryId, planId, paramId, dto);
  }

  @Delete('plans/:planId/parameters/:paramId')
  @RequirePermissions('quality:write')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a quality plan parameter' })
  async deleteParameter(
    @CurrentUser() user: RequestUser,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Param('paramId', ParseUUIDPipe) paramId: string,
  ) {
    return this.qualityService.deleteParameter(user.factoryId, planId, paramId);
  }

  @Get('work-orders/:workOrderId/inspections')
  @ApiOperation({ summary: 'Get all inspections linked to a work order (ISA-95 data flow)' })
  async getInspectionsByWorkOrder(
    @CurrentUser() user: RequestUser,
    @Param('workOrderId', ParseUUIDPipe) workOrderId: string,
  ) {
    return this.qualityService.getInspectionsByWorkOrder(user.factoryId, workOrderId);
  }

  // ────────────────────────────────────────────────────────────
  // SPC — STATISTICAL PROCESS CONTROL
  // ────────────────────────────────────────────────────────────

  @Get('spc')
  @ApiOperation({ summary: 'List SPC parameters (scope/time/order aware)' })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'productionOrderId', required: false })
  @ApiQuery({ name: 'dateFrom', required: false })
  @ApiQuery({ name: 'dateTo', required: false })
  async getSPCParameters(
    @CurrentUser() user: RequestUser,
    @Query('machineId') machineId?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('skuId') skuId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.qualityService.getSPCParameters(user.factoryId, { machineId, areaId, lineId, skuId, workOrderId, productionOrderId, from: dateFrom, to: dateTo });
  }

  @Get('spc/measurements')
  @ApiOperation({ summary: 'Get SPC measurement data (scope/time/order aware)' })
  @ApiQuery({ name: 'parameterId', required: false })
  @ApiQuery({ name: 'machineId', required: false })
  @ApiQuery({ name: 'areaId', required: false })
  @ApiQuery({ name: 'lineId', required: false })
  @ApiQuery({ name: 'skuId', required: false })
  @ApiQuery({ name: 'workOrderId', required: false })
  @ApiQuery({ name: 'productionOrderId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async getSPCMeasurements(
    @CurrentUser() user: RequestUser,
    @Query('parameterId') parameterId?: string,
    @Query('machineId') machineId?: string,
    @Query('areaId') areaId?: string,
    @Query('lineId') lineId?: string,
    @Query('skuId') skuId?: string,
    @Query('workOrderId') workOrderId?: string,
    @Query('productionOrderId') productionOrderId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit = '50',
  ) {
    return this.qualityService.getSPCMeasurements(user.factoryId, {
      parameterId, machineId, areaId, lineId, skuId, workOrderId, productionOrderId, from, to, limit: parseInt(limit, 10),
    });
  }

  @Post('spc/measurements')
  @RequirePermissions('quality:write')
  @AuditLog('QUALITY_SPC_RECORD')
  @ApiOperation({ summary: 'Quick-record SPC measurement(s) for a machine (SPC page / Quality Floor)' })
  async recordSPC(
    @CurrentUser() user: RequestUser,
    @Body() dto: RecordSpcDto,
  ) {
    return this.qualityService.recordSpcMeasurements(user.factoryId, user.id, dto);
  }
}
