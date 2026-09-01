import {
  Controller, Get, Post, Put, Patch, Delete, Body, Param, Query,
  HttpCode, HttpStatus, ParseUUIDPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import {
  IsString, IsOptional, IsArray, IsBoolean, IsEnum, MinLength, MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { NotificationsService } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';

interface RequestUser {
  id: string;
  factoryId: string | null;
}

class CreateNotificationRuleDto {
  @ApiProperty({ example: 'Critical NCR Alert' })
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  name!: string;

  @ApiProperty({ example: 'quality.ncr.critical' })
  @IsString()
  eventType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  conditions?: Record<string, unknown>;

  @ApiProperty({ example: ['in_app', 'email'] })
  @IsArray()
  channels!: string[];

  @ApiPropertyOptional({ example: ['uuid-user-id'] })
  @IsOptional()
  @IsArray()
  recipientUserIds?: string[];

  @ApiPropertyOptional({ example: ['FACTORY_MANAGER', 'QUALITY_MANAGER'] })
  @IsOptional()
  @IsArray()
  recipientRoles?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

class UpdatePreferenceDto {
  @ApiProperty({ example: 'quality' })
  @IsString()
  category!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  inApp?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  email?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sms?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  push?: boolean;

  @ApiPropertyOptional({ example: 'warning' })
  @IsOptional()
  @IsString()
  minSeverity?: string;
}

class UpdateNotificationRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  conditions?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  channels?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  recipientUserIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  recipientRoles?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@ApiTags('Notifications')
@ApiBearerAuth('JWT-auth')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // ────────────────────────────────────────────────────────────
  // IN-APP NOTIFICATIONS (current user)
  // ────────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Get notifications for the current user' })
  @ApiQuery({ name: 'isRead', required: false, type: Boolean })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'category', required: false })
  @ApiQuery({ name: 'severity', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async findForUser(
    @CurrentUser() user: RequestUser,
    @Query('isRead') isRead?: string,
    @Query('type') type?: string,
    @Query('category') category?: string,
    @Query('severity') severity?: string,
    @Query('page') page = '1',
    @Query('limit') limit = '20',
  ) {
    return this.notificationsService.findForUser(user.id, user.factoryId, {
      isRead: isRead !== undefined ? isRead === 'true' : undefined,
      type,
      category,
      severity,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
    });
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Get unread notification count for the current user' })
  async getUnreadCount(@CurrentUser() user: RequestUser) {
    const count = await this.notificationsService.getUnreadCount(user.id);
    return { count };
  }

  @Post('test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send a test notification to the current user (verifies the pipeline)' })
  async sendTest(@CurrentUser() user: RequestUser) {
    await this.notificationsService.sendTestNotification(user.id, user.factoryId);
    return { sent: true };
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark a single notification as read' })
  async markAsRead(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.markAsRead(user.id, id);
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark all notifications as read for the current user' })
  async markAllAsRead(@CurrentUser() user: RequestUser) {
    await this.notificationsService.markAllAsRead(user.id, user.factoryId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification' })
  async deleteNotification(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notificationsService.deleteNotification(user.id, id);
  }

  // ────────────────────────────────────────────────────────────
  // PREFERENCES (current user, per-category channels)
  // ────────────────────────────────────────────────────────────

  @Get('preferences')
  @ApiOperation({ summary: 'Get the current user notification channel preferences' })
  async getPreferences(@CurrentUser() user: RequestUser) {
    return this.notificationsService.getPreferences(user.id);
  }

  @Put('preferences')
  @ApiOperation({ summary: 'Update channel preferences for a single category' })
  async updatePreference(
    @CurrentUser() user: RequestUser,
    @Body() dto: UpdatePreferenceDto,
  ) {
    return this.notificationsService.updatePreference(user.id, dto);
  }

  // ────────────────────────────────────────────────────────────
  // NOTIFICATION RULES (admin/manager)
  // ────────────────────────────────────────────────────────────

  @Get('rules')
  @RequirePermissions('notifications:manage')
  @ApiOperation({ summary: 'List notification rules for this factory' })
  async findRules(@CurrentUser() user: RequestUser) {
    return this.notificationsService.findNotificationRules(user.factoryId);
  }

  @Post('rules')
  @RequirePermissions('notifications:manage')
  @ApiOperation({ summary: 'Create a notification rule' })
  async createRule(
    @CurrentUser() user: RequestUser,
    @Body() dto: CreateNotificationRuleDto,
  ) {
    return this.notificationsService.createNotificationRule(user.factoryId, dto);
  }

  @Patch('rules/:id')
  @RequirePermissions('notifications:manage')
  @ApiOperation({ summary: 'Update a notification rule' })
  async updateRule(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateNotificationRuleDto,
  ) {
    return this.notificationsService.updateNotificationRule(user.factoryId, id, dto);
  }

  @Delete('rules/:id')
  @RequirePermissions('notifications:manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a notification rule' })
  async deleteRule(
    @CurrentUser() user: RequestUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.notificationsService.deleteNotificationRule(user.factoryId, id);
  }
}
