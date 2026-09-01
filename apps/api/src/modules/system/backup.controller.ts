import {
  Body, Controller, Delete, Get, Param, Post, Res, UploadedFile, UseGuards,
  UseInterceptors, StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import type { Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SystemOwnerGuard } from '../../common/guards/system-owner.guard';
import { BackupService, UPLOAD_LIMIT_BYTES, UPLOAD_STAGING_DIR } from './backup.service';

interface RequestUser {
  id: string;
  email: string;
  role: string;
  passwordHash: string;
  factoryId?: string | null;
}

/**
 * Database backup & restore.
 *
 * Owner-only, like the rest of the danger zone — a full dump is every record in
 * the plant in one downloadable file, and a restore replaces all of it.
 */
@ApiTags('System')
@ApiBearerAuth('JWT-auth')
@Controller('system/backups')
@UseGuards(SystemOwnerGuard)
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  @ApiOperation({ summary: 'List stored database backups (owner only)' })
  list() {
    return this.backups.list();
  }

  @Post()
  @ApiOperation({ summary: 'Take a new full database backup (owner only)' })
  create(@CurrentUser() user: RequestUser, @Body() dto: { label?: string }) {
    return this.backups.create(user as never, dto?.label);
  }

  /**
   * Upload an archive from the operator's machine.
   *
   * Staged to DISK, never to memory: the API container runs with a 768 MB cap and a
   * multi-gigabyte dump buffered in RAM would take the whole service down. multer
   * writes it under the backups volume and the service validates the header before
   * filing it — see BackupService.importArchive.
   */
  @Post('import')
  @ApiOperation({ summary: 'Upload a .dump archive and file it as a restorable backup (owner only)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        label: { type: 'string' },
      },
    },
  })
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: (_req, _file, cb) => {
        mkdirSync(UPLOAD_STAGING_DIR, { recursive: true });
        cb(null, UPLOAD_STAGING_DIR);
      },
      // The client's filename never reaches the filesystem — it would be a path
      // traversal straight out of the staging directory. The real name is preserved
      // in the label instead.
      filename: (_req, _file, cb) => cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.part`),
    }),
    limits: { fileSize: UPLOAD_LIMIT_BYTES, files: 1 },
  }))
  importArchive(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: { label?: string },
  ) {
    return this.backups.importArchive(user as never, file, dto?.label);
  }

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore the database from a backup — destructive (owner only)' })
  restore(
    @CurrentUser() user: RequestUser,
    @Param('id') id: string,
    @Body() dto: { password: string; confirmation: string },
  ) {
    return this.backups.restore(user as never, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a stored backup (owner only)' })
  remove(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.backups.remove(user as never, id);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download the archive (owner only)' })
  async download(@Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    const { stream, meta } = await this.backups.streamFor(id);
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${meta.filename}"`,
      'Content-Length': String(meta.sizeBytes),
    });
    return new StreamableFile(stream);
  }
}
