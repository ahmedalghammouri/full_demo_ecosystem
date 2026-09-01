import {
  IsString, IsOptional, IsInt, IsNumber, IsBoolean, IsArray, IsEnum,
  IsUUID, IsDateString, Matches, MaxLength, Min, Max, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export enum ShiftInstanceStatus {
  PLANNED = 'PLANNED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

// ── Shift template (the reusable shift definition) ───────────────────────────
export class CreateShiftTemplateDto {
  @ApiProperty({ example: 'S1', description: 'Short unique code per factory' })
  @IsString() @MaxLength(20)
  code!: string;

  @ApiProperty({ example: 'Day Shift' })
  @IsString() @MaxLength(80)
  name!: string;

  @ApiPropertyOptional({ example: 'الوردية الصباحية' })
  @IsOptional() @IsString() @MaxLength(80)
  nameAr?: string;

  @ApiProperty({ example: '07:30', description: '24h HH:mm' })
  @Matches(HHMM, { message: 'startTime must be HH:mm (24h)' })
  startTime!: string;

  @ApiProperty({ example: '19:30', description: '24h HH:mm' })
  @Matches(HHMM, { message: 'endTime must be HH:mm (24h)' })
  endTime!: string;

  @ApiProperty({ example: 12, description: 'Total shift length in hours' })
  @IsNumber() @Min(0.5) @Max(24)
  shiftDurationHours!: number;

  @ApiProperty({ example: 11, description: 'Planned production hours (OEE denominator)' })
  @IsNumber() @Min(0) @Max(24)
  plannedProductionHours!: number;

  @ApiPropertyOptional({ example: 30, description: 'Break minutes (excluded from availability)' })
  @IsOptional() @IsInt() @Min(0) @Max(600)
  breakMinutes?: number;

  @ApiPropertyOptional({ example: 30, description: 'Cleaning minutes (excluded from availability)' })
  @IsOptional() @IsInt() @Min(0) @Max(600)
  cleaningMinutes?: number;

  @ApiProperty({ example: [6, 0, 1, 2, 3, 4], description: 'Working days (0=Sun … 6=Sat)' })
  @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  days!: number[];

  @ApiPropertyOptional({ example: 3000, description: 'Default production target per shift per line' })
  @IsOptional() @IsInt() @Min(0)
  targetQtyPerShift?: number;

  @ApiPropertyOptional({ example: 'CARTON', description: 'Unit of the target: PIECE/INNER/CARTON/PALLET' })
  @IsOptional() @IsString()
  targetUnit?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

export class UpdateShiftTemplateDto extends PartialType(CreateShiftTemplateDto) {}

// ── Instance generation (materialise daily shifts from templates) ────────────
export class GenerateInstancesDto {
  @ApiProperty({ example: '2026-06-10', description: 'First calendar date (inclusive)' })
  @IsDateString()
  dateFrom!: string;

  @ApiPropertyOptional({ example: '2026-06-16', description: 'Last calendar date (inclusive). Defaults to dateFrom.' })
  @IsOptional() @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Limit generation to these template ids' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  templateIds?: string[];

  @ApiPropertyOptional({ description: 'Production line to attach instances to' })
  @IsOptional() @IsUUID('4')
  lineId?: string;

  @ApiPropertyOptional({ default: false, description: 'Also materialise planned downtime (break + cleaning) per machine' })
  @IsOptional() @IsBoolean()
  withPlannedDowntime?: boolean;
}

// ── Planned downtime generation (break/cleaning from the shift model) ─────────
export class GeneratePlannedDowntimeDto {
  @ApiProperty({ example: '2026-06-10' })
  @IsDateString()
  dateFrom!: string;

  @ApiPropertyOptional({ example: '2026-06-16' })
  @IsOptional() @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ description: 'Limit to these templates' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  templateIds?: string[];

  @ApiPropertyOptional({ description: 'Target machines (defaults to all active machines in the factory)' })
  @IsOptional() @IsArray() @IsUUID('4', { each: true })
  machineIds?: string[];
}

export enum PlannedDowntimeScope {
  AREA = 'AREA',
  LINE = 'LINE',
  MACHINE = 'MACHINE',
}

// ── Manual planned downtime (pick a reason + a hierarchy scope) ───────────────
export class AddPlannedDowntimeDto {
  @ApiProperty({ description: 'Downtime reason (planned DowntimeCause id)' })
  @IsString() @MaxLength(60)
  causeId!: string;

  @ApiProperty({ enum: PlannedDowntimeScope, description: 'AREA → all lines+machines, LINE → all machines, MACHINE → one' })
  @IsEnum(PlannedDowntimeScope)
  scopeType!: PlannedDowntimeScope;

  @ApiProperty({ description: 'Id of the area / line / machine' })
  @IsUUID('4')
  scopeId!: string;

  @ApiProperty({ example: '2026-06-12T13:00:00.000Z', description: 'Planned start (ISO)' })
  @IsDateString()
  startTime!: string;

  @ApiProperty({ example: 30, description: 'Duration in minutes' })
  @IsInt() @Min(1) @Max(1440)
  durationMinutes!: number;

  @ApiPropertyOptional({ description: 'Optional note' })
  @IsOptional() @IsString() @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({ description: 'Optionally attach to a shift instance' })
  @IsOptional() @IsUUID('4')
  shiftInstanceId?: string;
}

export class ListPlannedDowntimeQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID('4')
  machineId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number;
}

// ── Instance listing ─────────────────────────────────────────────────────────
export class ListInstancesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ enum: ShiftInstanceStatus })
  @IsOptional() @IsEnum(ShiftInstanceStatus)
  status?: ShiftInstanceStatus;

  @ApiPropertyOptional() @IsOptional() @IsUUID('4')
  templateId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID('4')
  lineId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200)
  limit?: number;
}

// ── Instance lifecycle ───────────────────────────────────────────────────────
export class StartShiftDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID('4')
  operatorId?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID('4')
  supervisorId?: string;
}

export class CompleteShiftDto {
  @ApiPropertyOptional({ example: 3200 })
  @IsOptional() @IsInt() @Min(0)
  actualQty?: number;

  @ApiPropertyOptional({ example: 3150 })
  @IsOptional() @IsInt() @Min(0)
  goodQty?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional() @IsInt() @Min(0)
  scrapQty?: number;

  @ApiPropertyOptional({ description: 'Shift handover notes for the next crew' })
  @IsOptional() @IsString() @MaxLength(2000)
  handoverNotes?: string;
}
