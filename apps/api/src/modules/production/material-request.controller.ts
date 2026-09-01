import { Controller, Get, Post, Param, Query, Body, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MaterialRequestService, RespondMaterialRequestDto } from './material-request.service';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Material Requests')
@ApiBearerAuth('JWT-auth')
@Controller('production/material-requests')
export class MaterialRequestController {
  constructor(private readonly service: MaterialRequestService) {}

  @Get()
  @ApiOperation({ summary: 'List material-shortage requests raised to inventory' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'archived', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async list(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('archived') archived?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(user.factoryId, {
      search,
      status,
      archived,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Post('bulk')
  @ApiOperation({ summary: 'Bulk action on material requests: cancel / archive / unarchive / delete' })
  async bulk(
    @CurrentUser() user: RequestUser,
    @Body() dto: { action: 'cancel' | 'archive' | 'unarchive' | 'delete'; ids: string[] },
  ) {
    return this.service.bulk(user.factoryId, user.id, dto.action, dto.ids);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Material-request queue KPIs' })
  async stats(@CurrentUser() user: RequestUser) {
    return this.service.stats(user.factoryId);
  }

  @Post(':id/respond')
  @ApiOperation({ summary: 'Inventory response: fulfill stock, commit a delivery date, or cancel' })
  async respond(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondMaterialRequestDto,
  ) {
    return this.service.respond(user.factoryId, user.id, id, dto);
  }
}
