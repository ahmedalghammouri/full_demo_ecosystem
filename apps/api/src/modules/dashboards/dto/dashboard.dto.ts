import {
  IsString, IsOptional, IsEnum, IsBoolean, IsArray, IsInt, IsUUID,
  MaxLength, MinLength, IsUrl, ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DashboardSource {
  Industry360_NATIVE = 'Industry360_NATIVE',
  GRAFANA = 'GRAFANA',
  REPORT = 'REPORT',
  EXTERNAL = 'EXTERNAL',
  TEMPLATE = 'TEMPLATE',
}

export enum DashboardType {
  OPERATIONAL = 'OPERATIONAL',
  KPI = 'KPI',
  ANALYTICS = 'ANALYTICS',
  REPORT = 'REPORT',
  EXECUTIVE = 'EXECUTIVE',
  ENERGY = 'ENERGY',
  QUALITY = 'QUALITY',
  MAINTENANCE = 'MAINTENANCE',
  PRODUCTION = 'PRODUCTION',
  CUSTOM = 'CUSTOM',
}

export enum DashboardVisibility {
  PRIVATE = 'PRIVATE',
  FACTORY = 'FACTORY',
  ENTERPRISE = 'ENTERPRISE',
  PUBLIC = 'PUBLIC',
}

export enum DashboardPermissionLevel {
  VIEW = 'VIEW',
  EDIT = 'EDIT',
  MANAGE = 'MANAGE',
}

export class ListDashboardsQueryDto {
  @ApiPropertyOptional({ description: 'Full-text search across title, description, tags' })
  @IsOptional() @IsString() @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ enum: DashboardSource })
  @IsOptional() @IsEnum(DashboardSource)
  source?: DashboardSource;

  @ApiPropertyOptional({ enum: DashboardType })
  @IsOptional() @IsEnum(DashboardType)
  type?: DashboardType;

  @ApiPropertyOptional({ description: 'Category key or id' })
  @IsOptional() @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Only dashboards favorited by the current user' })
  @IsOptional() @IsString()
  favorites?: string; // "true"

  @ApiPropertyOptional({ description: 'Only dashboard templates' })
  @IsOptional() @IsString()
  templates?: string; // "true"

  @ApiPropertyOptional({ description: 'Comma-separated tags filter' })
  @IsOptional() @IsString()
  tags?: string;
}

export class CreateDashboardDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160)
  title!: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160)
  titleAr?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: DashboardSource })
  @IsEnum(DashboardSource)
  source!: DashboardSource;

  @ApiPropertyOptional({ enum: DashboardType })
  @IsOptional() @IsEnum(DashboardType)
  type?: DashboardType;

  @ApiPropertyOptional({ enum: DashboardVisibility })
  @IsOptional() @IsEnum(DashboardVisibility)
  visibility?: DashboardVisibility;

  @ApiPropertyOptional({ description: 'Category id or key' })
  @IsOptional() @IsString()
  categoryId?: string;

  // Routing — required form depends on source
  @ApiPropertyOptional({ description: 'Internal route for Industry360_NATIVE / REPORT' })
  @ValidateIf(o => o.source === DashboardSource.Industry360_NATIVE || o.source === DashboardSource.REPORT)
  @IsOptional() @IsString() @MaxLength(300)
  route?: string;

  @ApiPropertyOptional({ description: 'External embeddable URL for EXTERNAL source' })
  @ValidateIf(o => o.source === DashboardSource.EXTERNAL)
  @IsOptional() @IsUrl({ require_tld: false })
  externalUrl?: string;

  @ApiPropertyOptional({ description: 'Grafana dashboard UID for GRAFANA source' })
  @ValidateIf(o => o.source === DashboardSource.GRAFANA)
  @IsOptional() @IsString()
  grafanaUid?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  grafanaSlug?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt()
  grafanaOrgId?: number;

  @ApiPropertyOptional() @IsOptional() @IsString()
  grafanaFolder?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60)
  icon?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  isFactoryAware?: boolean;

  @ApiPropertyOptional({ type: [String], description: 'FACTORY|AREA|LINE|MACHINE|SHIFT|PRODUCT|BATCH' })
  @IsOptional() @IsArray() @IsString({ each: true })
  supportedScopes?: string[];

  @ApiPropertyOptional({ default: 'now-24h' })
  @IsOptional() @IsString()
  defaultTimeRange?: string;

  @ApiPropertyOptional({ default: '30s' })
  @IsOptional() @IsString()
  refreshInterval?: string;

  @ApiPropertyOptional({ description: 'Register this dashboard as a reusable template' })
  @IsOptional() @IsBoolean()
  isTemplate?: boolean;
}

export class UpdateDashboardDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) @MaxLength(160)
  title?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160)
  titleAr?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: DashboardType })
  @IsOptional() @IsEnum(DashboardType)
  type?: DashboardType;

  @ApiPropertyOptional({ enum: DashboardVisibility })
  @IsOptional() @IsEnum(DashboardVisibility)
  visibility?: DashboardVisibility;

  @ApiPropertyOptional() @IsOptional() @IsString()
  categoryId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300)
  route?: string;

  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_tld: false })
  externalUrl?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  grafanaUid?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60)
  icon?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  thumbnailUrl?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  tags?: string[];

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isFactoryAware?: boolean;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() @IsString({ each: true })
  supportedScopes?: string[];

  @ApiPropertyOptional() @IsOptional() @IsString()
  defaultTimeRange?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  refreshInterval?: string;

  @ApiPropertyOptional() @IsOptional() @IsBoolean()
  isPublished?: boolean;
}

export class CreateCategoryDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(60)
  name!: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  key?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  nameAr?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  description?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  icon?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  color?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt()
  sortOrder?: number;
}

export class GrantPermissionDto {
  @ApiPropertyOptional({ description: 'Target role (mutually exclusive with userId)' })
  @IsOptional() @IsString()
  role?: string;

  @ApiPropertyOptional({ description: 'Target user id (mutually exclusive with role)' })
  @IsOptional() @IsUUID()
  userId?: string;

  @ApiProperty({ enum: DashboardPermissionLevel })
  @IsEnum(DashboardPermissionLevel)
  level!: DashboardPermissionLevel;
}

export class EmbedQueryDto {
  @ApiPropertyOptional({ description: 'Override factory scope (defaults to user factory)' })
  @IsOptional() @IsString()
  factoryId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  areaId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  lineId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  machineId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  shiftId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  productId?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  batchId?: string;

  @ApiPropertyOptional({ description: 'Grafana time range from, e.g. now-24h' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  to?: string;

  @ApiPropertyOptional({ description: 'Theme: light | dark' })
  @IsOptional() @IsString()
  theme?: string;
}
