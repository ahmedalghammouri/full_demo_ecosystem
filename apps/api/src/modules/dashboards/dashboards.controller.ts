import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, ParseUUIDPipe, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DashboardsService, RequestUser } from './dashboards.service';
import {
  CreateDashboardDto, UpdateDashboardDto, ListDashboardsQueryDto,
  CreateCategoryDto, GrantPermissionDto, EmbedQueryDto,
} from './dto/dashboard.dto';

@ApiTags('Dashboard Center')
@ApiBearerAuth('JWT-auth')
@Controller('dashboards')
export class DashboardsController {
  constructor(private readonly service: DashboardsService) {}

  // ── Catalog ───────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List / search dashboards in the catalog (visibility-filtered)' })
  list(@CurrentUser() user: RequestUser, @Query() query: ListDashboardsQueryDto) {
    return this.service.list(user, query);
  }

  @Get('categories')
  @ApiOperation({ summary: 'List dashboard categories with counts' })
  listCategories(@CurrentUser() user: RequestUser) {
    return this.service.listCategories(user);
  }

  @Post('categories')
  @ApiOperation({ summary: 'Create a dashboard category (admin)' })
  createCategory(@CurrentUser() user: RequestUser, @Body() dto: CreateCategoryDto) {
    return this.service.createCategory(user, dto);
  }

  // ── Grafana discovery / health (admin) ────────────────────────
  @Get('grafana/health')
  @ApiOperation({ summary: 'Grafana integration health' })
  grafanaHealth() {
    return this.service.grafanaHealth();
  }

  @Get('grafana/available')
  @ApiOperation({ summary: 'Browse Grafana dashboards available to import (admin)' })
  @ApiQuery({ name: 'query', required: false })
  @ApiQuery({ name: 'tag', required: false })
  grafanaAvailable(
    @CurrentUser() user: RequestUser,
    @Query('query') query?: string,
    @Query('tag') tag?: string,
  ) {
    return this.service.listGrafanaDashboards(user, query, tag);
  }

  // ── Single dashboard ──────────────────────────────────────────
  @Get(':id')
  @ApiOperation({ summary: 'Get a single dashboard' })
  getById(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.getById(user, id);
  }

  @Get(':id/embed')
  @ApiOperation({ summary: 'Resolve how to open/embed a dashboard with factory context' })
  getEmbed(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: EmbedQueryDto,
  ) {
    return this.service.getEmbed(user, id, q);
  }

  @Post()
  @ApiOperation({ summary: 'Create a dashboard / catalog entry' })
  create(@CurrentUser() user: RequestUser, @Body() dto: CreateDashboardDto) {
    return this.service.create(user, dto);
  }

  @Post(':id/clone')
  @ApiOperation({ summary: 'Clone a template / dashboard into a new private dashboard' })
  clone(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.cloneTemplate(user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a dashboard' })
  update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDashboardDto,
  ) {
    return this.service.update(user, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete (soft) a dashboard' })
  remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(user, id);
  }

  // ── Favorites ─────────────────────────────────────────────────
  @Post(':id/favorite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle favorite for the current user' })
  toggleFavorite(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.toggleFavorite(user, id);
  }

  // ── Permissions ───────────────────────────────────────────────
  @Get(':id/permissions')
  @ApiOperation({ summary: 'List permission grants for a dashboard' })
  listPermissions(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.listPermissions(user, id);
  }

  @Post(':id/permissions')
  @ApiOperation({ summary: 'Grant a permission (role or user) on a dashboard' })
  grantPermission(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GrantPermissionDto,
  ) {
    return this.service.grantPermission(user, id, dto);
  }

  @Delete(':id/permissions/:permissionId')
  @ApiOperation({ summary: 'Revoke a permission grant' })
  revokePermission(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
  ) {
    return this.service.revokePermission(user, id, permissionId);
  }
}
