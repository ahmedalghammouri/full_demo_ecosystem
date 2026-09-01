import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { ChangeRequestStatus } from '@prisma/client';

import { PlmService } from './plm.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

@ApiTags('PLM')
@ApiBearerAuth('JWT-auth')
@Controller('plm')
export class PlmController {
  constructor(private readonly plmService: PlmService) {}

  @Get('change-requests')
  @ApiOperation({ summary: 'List engineering change requests with status/type counts' })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'search', required: false })
  async list(
    @CurrentUser() user: RequestUser,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
  ) {
    return this.plmService.listChangeRequests(user.factoryId, {
      status, type, search,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Post('change-requests')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a change request (auto ECR number, DRAFT)' })
  async create(@CurrentUser() user: RequestUser, @Body() dto: any) {
    return this.plmService.createChangeRequest(user.factoryId, user.id, dto);
  }

  @Patch('change-requests/:id')
  @ApiOperation({ summary: 'Update a change request (not allowed when implemented)' })
  async update(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: any,
  ) {
    return this.plmService.updateChangeRequest(user.factoryId, id, dto);
  }

  @Post('change-requests/:id/transition')
  @ApiOperation({ summary: 'Move a CR through its workflow (DRAFT→SUBMITTED→UNDER_REVIEW→APPROVED→IMPLEMENTED / REJECTED)' })
  async transition(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { status: ChangeRequestStatus },
  ) {
    return this.plmService.transitionChangeRequest(user.factoryId, user.id, id, dto.status);
  }

  @Delete('change-requests/:id')
  @ApiOperation({ summary: 'Delete a draft change request' })
  async remove(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plmService.deleteChangeRequest(user.factoryId, id);
  }
}
