import {
  Controller, Get, Post, Delete, Query, Param, Body, Res,
  UploadedFile, UseInterceptors, BadRequestException, HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiConsumes, ApiQuery } from '@nestjs/swagger';
import type { Response } from 'express';

import { AttachmentsService } from './attachments.service';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditLog } from '../../common/decorators/audit-log.decorator';

interface RequestUser { id: string; factoryId: string | null; name?: string | null }

const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB per file

@ApiTags('Attachments')
@ApiBearerAuth('JWT-auth')
@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Get()
  @ApiOperation({ summary: 'List attachments for an entity' })
  @ApiQuery({ name: 'entityType', required: true })
  @ApiQuery({ name: 'entityId', required: true })
  @ApiQuery({ name: 'category', required: false })
  async list(
    @CurrentUser() user: RequestUser,
    @Query('entityType') entityType: string,
    @Query('entityId') entityId: string,
    @Query('category') category?: string,
  ) {
    if (!entityType || !entityId) throw new BadRequestException('entityType and entityId are required');
    return this.attachments.list(user.factoryId, entityType, entityId, category);
  }

  @Post()
  @AuditLog('ATTACHMENT_UPLOAD')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Upload an attachment (instruction file or work evidence)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }))
  async upload(
    @CurrentUser() user: RequestUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadAttachmentDto,
  ) {
    if (!file) throw new BadRequestException('No file provided');
    return this.attachments.create(user, dto, file);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Stream an attachment for inline view/download' })
  async download(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const att = await this.attachments.getOne(user.factoryId, id);
    res.setHeader('Content-Type', att.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(att.originalName)}`);
    res.setHeader('Cache-Control', 'private, max-age=300');
    this.attachments.stream(att.storageKey).pipe(res);
  }

  @Delete(':id')
  @AuditLog('ATTACHMENT_DELETE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an attachment' })
  async remove(@CurrentUser() user: RequestUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.attachments.remove(user.factoryId, id);
  }
}
