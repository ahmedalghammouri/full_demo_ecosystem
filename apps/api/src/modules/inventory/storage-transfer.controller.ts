import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StorageTransferService, CreateTransferDto } from './storage-transfer.service';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('Storage Transfers')
@ApiBearerAuth('JWT-auth')
@Controller('inventory/storage-transfers')
export class StorageTransferController {
  constructor(private readonly service: StorageTransferService) {}

  @Get()
  @ApiOperation({ summary: 'List storage-location transfers (movements between locations)' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'locationId', required: false })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async list(
    @CurrentUser() user: RequestUser,
    @Query('search') search?: string,
    @Query('locationId') locationId?: string,
    @Query('entityType') entityType?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.list(user.factoryId, {
      search, locationId, entityType,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Transfer KPIs' })
  async stats(@CurrentUser() user: RequestUser) {
    return this.service.stats(user.factoryId);
  }

  @Post()
  @ApiOperation({ summary: 'Execute a transfer of an item between two storage locations' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: CreateTransferDto) {
    return this.service.create(user.factoryId, user.id, dto);
  }
}
