import {
  Controller, Get, Patch, Post, Body, Param, Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsArray, IsString } from 'class-validator';

import { ArchiveService } from './archive.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

interface RequestUser { id: string; factoryId: string | null }

class BulkIdsDto {
  @IsArray() @IsString({ each: true })
  ids!: string[];
}

@ApiTags('Archive')
@ApiBearerAuth('JWT-auth')
@Controller('archive')
export class ArchiveController {
  constructor(private readonly archive: ArchiveService) {}

  @Get('entities')
  @ApiOperation({ summary: 'List entities that support archive/restore' })
  listEntities() {
    return this.archive.listEntities();
  }

  @Get('counts')
  @ApiOperation({ summary: 'Archived-row counts per entity' })
  counts(@CurrentUser() user: RequestUser) {
    return this.archive.counts(user.factoryId);
  }

  @Get(':entity')
  @ApiOperation({ summary: 'List archived rows of an entity' })
  list(
    @CurrentUser() user: RequestUser,
    @Param('entity') entity: string,
    @Query('search') search?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.archive.listArchived(user.factoryId, entity, {
      search,
      page: parseInt(page, 10) || 1,
      limit: Math.min(parseInt(limit, 10) || 20, 100),
    });
  }

  @Patch(':entity/:id/archive')
  @AuditLog('ENTITY_ARCHIVE')
  @ApiOperation({ summary: 'Archive a single record' })
  archiveOne(@CurrentUser() user: RequestUser, @Param('entity') entity: string, @Param('id') id: string) {
    return this.archive.archive(user.factoryId, entity, id);
  }

  @Patch(':entity/:id/restore')
  @AuditLog('ENTITY_RESTORE')
  @ApiOperation({ summary: 'Restore a single archived record' })
  restoreOne(@CurrentUser() user: RequestUser, @Param('entity') entity: string, @Param('id') id: string) {
    return this.archive.restore(user.factoryId, entity, id);
  }

  @Post(':entity/bulk-archive')
  @AuditLog('ENTITY_BULK_ARCHIVE')
  @ApiOperation({ summary: 'Archive many records' })
  bulkArchive(@CurrentUser() user: RequestUser, @Param('entity') entity: string, @Body() dto: BulkIdsDto) {
    return this.archive.bulkArchive(user.factoryId, entity, dto.ids);
  }

  @Post(':entity/bulk-restore')
  @AuditLog('ENTITY_BULK_RESTORE')
  @ApiOperation({ summary: 'Restore many archived records' })
  bulkRestore(@CurrentUser() user: RequestUser, @Param('entity') entity: string, @Body() dto: BulkIdsDto) {
    return this.archive.bulkRestore(user.factoryId, entity, dto.ids);
  }
}
