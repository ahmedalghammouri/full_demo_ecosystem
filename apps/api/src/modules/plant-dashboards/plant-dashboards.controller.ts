import {
  Controller, Get, Post, Put, Delete, Param, Query, Body, ParseUUIDPipe, HttpCode, HttpStatus,
  UseInterceptors, UploadedFile, Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
import type { Response } from 'express';

import { PlantDashboardsService } from './plant-dashboards.service';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  CreatePlantDashboardDto, UpdatePlantDashboardDto, LiveDataDto,
} from './dto/plant-dashboard.dto';

const MAX_BG_BYTES = 8 * 1024 * 1024; // 8 MB background cap

type RequestUser = { id: string; factoryId: string | null; role: string };

@ApiTags('Plant Dashboards')
@ApiBearerAuth('JWT-auth')
@Controller('plant-dashboards')
export class PlantDashboardsController {
  constructor(private readonly svc: PlantDashboardsService) {}

  // ── Metadata (place BEFORE :dashboardId routes) ────────────────────────────
  @Get('kpi-catalog')
  @RequirePermissions('plant_dashboard:view')
  @ApiOperation({ summary: 'KPI catalog for the card picker' })
  kpiCatalog() { return this.svc.kpiCatalog(); }

  @Get('scope-options')
  @RequirePermissions('plant_dashboard:view')
  @ApiOperation({ summary: 'Hierarchy options for scope pickers' })
  scopeOptions(@CurrentUser() user: RequestUser) { return this.svc.scopeOptions(user); }

  @Get('default')
  @RequirePermissions('plant_dashboard:view')
  @ApiOperation({ summary: 'The factory default landing live view (or null)' })
  getDefault(@CurrentUser() user: RequestUser) { return this.svc.getDefault(user); }

  @Get('entity/:entityType/:entityId')
  @RequirePermissions('plant_dashboard:view')
  @ApiOperation({ summary: 'List dashboards for a hierarchy entity' })
  listByEntity(
    @CurrentUser() user: RequestUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.svc.listByEntity(user, entityType, entityId);
  }

  @Get('published')
  @RequirePermissions('plant_dashboard:view')
  @ApiOperation({ summary: 'List published dashboards (optionally by entity type)' })
  listPublished(@CurrentUser() user: RequestUser, @Query('entityType') entityType?: string) {
    return this.svc.listPublished(user, entityType);
  }

  @Get('published/:entityType/:entityId')
  @RequirePermissions('plant_dashboard:view')
  @ApiOperation({ summary: 'Published dashboard for the Live View' })
  getPublished(
    @CurrentUser() user: RequestUser,
    @Param('entityType') entityType: string,
    @Param('entityId') entityId: string,
  ) {
    return this.svc.getPublished(user, entityType, entityId);
  }

  @Post('live-data')
  @RequirePermissions('plant_dashboard:view')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Batched live KPI values for a set of card subscriptions' })
  liveData(@CurrentUser() user: RequestUser, @Body() dto: LiveDataDto) {
    return this.svc.liveData(user, dto.subscriptions);
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────
  @Post()
  @RequirePermissions('plant_dashboard:create')
  @AuditLog('PLANT_DASHBOARD_CREATE')
  @ApiOperation({ summary: 'Create a plant dashboard' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreatePlantDashboardDto) {
    return this.svc.create(user, dto);
  }

  @Get(':dashboardId')
  @RequirePermissions('plant_dashboard:view')
  @ApiOperation({ summary: 'Get a dashboard (with widgets)' })
  getById(@CurrentUser() user: RequestUser, @Param('dashboardId', ParseUUIDPipe) id: string) {
    return this.svc.getById(user, id);
  }

  @Put(':dashboardId')
  @RequirePermissions('plant_dashboard:edit')
  @AuditLog('PLANT_DASHBOARD_UPDATE')
  @ApiOperation({ summary: 'Save (draft) a dashboard + its widgets' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('dashboardId', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlantDashboardDto,
  ) {
    return this.svc.update(user, id, dto);
  }

  @Delete(':dashboardId')
  @RequirePermissions('plant_dashboard:delete')
  @AuditLog('PLANT_DASHBOARD_DELETE')
  @ApiOperation({ summary: 'Delete a dashboard' })
  remove(@CurrentUser() user: RequestUser, @Param('dashboardId', ParseUUIDPipe) id: string) {
    return this.svc.remove(user, id);
  }

  @Get(':dashboardId/validate')
  @RequirePermissions('plant_dashboard:edit')
  @ApiOperation({ summary: 'Validate a dashboard for publishing (per-widget error list)' })
  validate(@CurrentUser() user: RequestUser, @Param('dashboardId', ParseUUIDPipe) id: string) {
    return this.svc.validate(user, id);
  }

  @Post(':dashboardId/publish')
  @RequirePermissions('plant_dashboard:publish')
  @HttpCode(HttpStatus.OK)
  @AuditLog('PLANT_DASHBOARD_PUBLISH')
  @ApiOperation({ summary: 'Publish the draft (snapshot for the Live View)' })
  publish(@CurrentUser() user: RequestUser, @Param('dashboardId', ParseUUIDPipe) id: string) {
    return this.svc.publish(user, id);
  }

  @Post(':dashboardId/default')
  @RequirePermissions('plant_dashboard:edit')
  @HttpCode(HttpStatus.OK)
  @AuditLog('PLANT_DASHBOARD_SET_DEFAULT')
  @ApiOperation({ summary: 'Set this dashboard as the factory default landing view' })
  setDefault(@CurrentUser() user: RequestUser, @Param('dashboardId', ParseUUIDPipe) id: string) {
    return this.svc.setDefault(user, id);
  }

  @Delete(':dashboardId/default')
  @RequirePermissions('plant_dashboard:edit')
  @AuditLog('PLANT_DASHBOARD_CLEAR_DEFAULT')
  @ApiOperation({ summary: 'Clear this dashboard as the default landing view' })
  clearDefault(@CurrentUser() user: RequestUser, @Param('dashboardId', ParseUUIDPipe) id: string) {
    return this.svc.clearDefault(user, id);
  }

  @Post(':dashboardId/duplicate')
  @RequirePermissions('plant_dashboard:create')
  @HttpCode(HttpStatus.OK)
  @AuditLog('PLANT_DASHBOARD_DUPLICATE')
  @ApiOperation({ summary: 'Duplicate a dashboard' })
  duplicate(@CurrentUser() user: RequestUser, @Param('dashboardId', ParseUUIDPipe) id: string) {
    return this.svc.duplicate(user, id);
  }

  // ── Background image ─────────────────────────────────────────────────────────
  @Post(':dashboardId/background')
  @RequirePermissions('plant_dashboard:edit')
  @AuditLog('PLANT_DASHBOARD_BACKGROUND_SET')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BG_BYTES } }))
  @ApiOperation({ summary: 'Upload/replace the dashboard background image (PNG/JPG/WEBP)' })
  setBackground(
    @CurrentUser() user: RequestUser,
    @Param('dashboardId', ParseUUIDPipe) id: string,
    @UploadedFile() file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
  ) {
    return this.svc.setBackground(user, id, file);
  }

  @Delete(':dashboardId/background')
  @RequirePermissions('plant_dashboard:edit')
  @AuditLog('PLANT_DASHBOARD_BACKGROUND_REMOVE')
  @ApiOperation({ summary: 'Remove the dashboard background image' })
  removeBackground(@CurrentUser() user: RequestUser, @Param('dashboardId', ParseUUIDPipe) id: string) {
    return this.svc.removeBackground(user, id);
  }

  @Get(':dashboardId/background')
  @RequirePermissions('plant_dashboard:view')
  @ApiOperation({ summary: 'Stream the dashboard background image' })
  async getBackground(
    @CurrentUser() user: RequestUser,
    @Param('dashboardId', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const { stream, mime } = await this.svc.backgroundStream(user, id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=60');
    stream.pipe(res);
  }
}
