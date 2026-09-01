import {
  IsString, IsOptional, IsIn, IsNumber, IsBoolean, IsArray, ValidateNested, IsObject, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const ENTITY_TYPES = ['plant', 'area', 'line', 'machine'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const WIDGET_TYPES = [
  'kpiValue', 'equipmentStatus', 'multiKpi', 'productionSummary', 'oeeSummary',
  'trendChart', 'activeAlarms', 'lineStatus', 'text', 'image', 'navButton',
] as const;

export class WidgetDto {
  @IsOptional() @IsString() id?: string;
  @IsString() @IsIn(WIDGET_TYPES as unknown as string[]) widgetType!: string;
  @IsOptional() @IsString() @MaxLength(200) title?: string;

  @IsNumber() x!: number;
  @IsNumber() y!: number;
  @IsNumber() width!: number;
  @IsNumber() height!: number;
  @IsOptional() @IsNumber() zIndex?: number;
  @IsOptional() @IsNumber() rotation?: number;
  @IsOptional() @IsBoolean() locked?: boolean;
  @IsOptional() @IsBoolean() visible?: boolean;

  @IsOptional() @IsObject() scopeConfig?: Record<string, unknown>;
  @IsOptional() @IsObject() dataConfig?: Record<string, unknown>;
  @IsOptional() @IsObject() displayConfig?: Record<string, unknown>;
  @IsOptional() @IsObject() refreshConfig?: Record<string, unknown>;
  @IsOptional() @IsObject() thresholdConfig?: Record<string, unknown>;
}

export class CreatePlantDashboardDto {
  @IsString() @MaxLength(200) name!: string;
  @IsString() @IsIn(ENTITY_TYPES as unknown as string[]) entityType!: string;
  @IsString() entityId!: string;
  @IsOptional() @IsString() backgroundImageUrl?: string;
  @IsOptional() @IsObject() backgroundSettings?: Record<string, unknown>;
  @IsOptional() @IsObject() canvasSettings?: Record<string, unknown>;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => WidgetDto) widgets?: WidgetDto[];
}

export class UpdatePlantDashboardDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() backgroundImageUrl?: string;
  @IsOptional() @IsObject() backgroundSettings?: Record<string, unknown>;
  @IsOptional() @IsObject() canvasSettings?: Record<string, unknown>;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => WidgetDto) widgets?: WidgetDto[];
}

export class LiveSubscriptionDto {
  @IsString() widgetId!: string;
  @IsString() kpiCode!: string;
  @IsString() @IsIn(ENTITY_TYPES as unknown as string[]) scopeType!: string;
  @IsString() scopeId!: string;
  @IsOptional() @IsString() timeRange?: string; // current | today | shift | week | month
}

export class LiveDataDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => LiveSubscriptionDto)
  subscriptions!: LiveSubscriptionDto[];
}
