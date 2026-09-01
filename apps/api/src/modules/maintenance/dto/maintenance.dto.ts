import {
  IsString, IsUUID, IsOptional, IsEnum, IsDateString,
  IsNumber, Min, MaxLength, MinLength, IsInt, IsPositive, IsArray,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export enum MaintType {
  PREVENTIVE = 'PREVENTIVE',
  CORRECTIVE = 'CORRECTIVE',
  EMERGENCY = 'EMERGENCY',
  PREDICTIVE = 'PREDICTIVE',
  INSPECTION = 'INSPECTION',
  LUBRICATION = 'LUBRICATION',
}

export enum MaintPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export class SparePartRequestItemDto {
  @ApiProperty({ example: 'uuid-spare-part-id' })
  @IsUUID()
  sparePartId!: string;

  @ApiProperty({ example: 2, description: 'Quantity needed' })
  @IsNumber()
  @IsPositive()
  quantityRequested!: number;

  @ApiPropertyOptional({ description: 'Optional notes for this part' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class IssueSparePartDto {
  @ApiProperty({ example: 2, description: 'Quantity actually issued from inventory' })
  @IsNumber()
  @IsPositive()
  quantityIssued!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class CreateMaintenanceWODto {
  @ApiProperty({ enum: MaintType })
  @IsEnum(MaintType)
  type!: MaintType;

  @ApiProperty({ enum: MaintPriority })
  @IsEnum(MaintPriority)
  priority!: MaintPriority;

  @ApiProperty({ example: 'uuid-machine-id' })
  @IsUUID()
  machineId!: string;

  @ApiProperty({ example: 'Carton Packer conveyor belt replacement' })
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  title!: string;

  @ApiPropertyOptional({ example: 'Belt has visible cracks and needs immediate replacement' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ example: 4.5, description: 'Estimated labor hours' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedHours?: number;

  @ApiPropertyOptional({ example: 'uuid-assigned-user-id' })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiPropertyOptional({ example: '2026-06-07T17:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ example: 'uuid-failure-mode-id', deprecated: true, description: 'Legacy single failure mode — prefer failureModeIds' })
  @IsOptional()
  @IsUUID()
  failureModeId?: string;

  @ApiPropertyOptional({ type: [String], description: 'FMEA failure modes linked to this work order' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  failureModeIds?: string[];

  @ApiPropertyOptional({ example: 'uuid-downtime-event-id' })
  @IsOptional()
  @IsUUID()
  triggeredByDowntimeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ example: 'uuid-production-wo-id', description: 'Link to a production work order (optional)' })
  @IsOptional()
  @IsUUID()
  productionWOId?: string;

  @ApiPropertyOptional({ type: [SparePartRequestItemDto], description: 'Spare parts needed for this work order' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SparePartRequestItemDto)
  spareParts?: SparePartRequestItemDto[];
}

export class UpdateMaintenanceWODto {
  @ApiPropertyOptional({ enum: MaintType })
  @IsOptional()
  @IsEnum(MaintType)
  type?: MaintType;

  @ApiPropertyOptional({ enum: MaintPriority })
  @IsOptional()
  @IsEnum(MaintPriority)
  priority?: MaintPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  estimatedHours?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ example: 'uuid-machine-id' })
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiPropertyOptional({ example: 'uuid-technician-id' })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiPropertyOptional({ example: 'uuid-production-wo-id', description: 'Link to a production work order (optional)' })
  @IsOptional()
  @IsUUID()
  productionWOId?: string;

  @ApiPropertyOptional({ example: 'uuid-failure-mode-id', deprecated: true, description: 'Legacy single failure mode — prefer failureModeIds' })
  @IsOptional()
  @IsUUID()
  failureModeId?: string;

  @ApiPropertyOptional({ type: [String], description: 'FMEA failure modes linked to this work order (replaces existing set)' })
  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  failureModeIds?: string[];
}

export class AssignWODto {
  @ApiProperty({ example: 'uuid-technician-id' })
  @IsUUID()
  assignedToId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class StartWODto {
  @ApiPropertyOptional({ description: 'Machine runtime hours at time of service' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  runtimeHoursAtService?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class SparePartUsageDto {
  @ApiProperty({ example: 'uuid-spare-part-id' })
  @IsUUID()
  sparePartId!: string;

  @ApiProperty({ example: 2 })
  @IsNumber()
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ description: 'Unit cost override' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitCost?: number;
}

export class AddSparePartsToWODto {
  @ApiProperty({ type: [SparePartRequestItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SparePartRequestItemDto)
  parts!: SparePartRequestItemDto[];
}

export class CompleteWODto {
  @ApiProperty({ example: 3.5, description: 'Actual hours worked' })
  @IsNumber()
  @Min(0)
  actualHours!: number;

  @ApiPropertyOptional({ example: 500.0, description: 'Labor cost (SAR)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  laborCost?: number;

  @ApiPropertyOptional({ example: 1200.0, description: 'Parts cost (SAR)' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  partsCost?: number;

  @ApiPropertyOptional({ type: [SparePartUsageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SparePartUsageDto)
  sparesUsed?: SparePartUsageDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Machine runtime hours at time of service completion' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  runtimeHoursAtService?: number;
}

export class CancelWODto {
  @ApiProperty({ example: 'Issue resolved by operator before technician arrived' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class HoldWODto {
  @ApiPropertyOptional({ example: 'Waiting for replacement part from supplier' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

// ── FMEA Failure Modes ────────────────────────────────────────────

export enum FailureModeCategory {
  MECHANICAL = 'MECHANICAL',
  ELECTRICAL = 'ELECTRICAL',
  PROCESS = 'PROCESS',
  MATERIAL = 'MATERIAL',
  OPERATOR = 'OPERATOR',
  CHANGEOVER = 'CHANGEOVER',
  UTILITY = 'UTILITY',
  QUALITY = 'QUALITY',
  PLANNED_MAINTENANCE = 'PLANNED_MAINTENANCE',
  PLANNED_CLEANING = 'PLANNED_CLEANING',
  PLANNED_BREAK = 'PLANNED_BREAK',
  EXTERNAL = 'EXTERNAL',
}

export class CreateFailureModeDto {
  @ApiProperty({ example: 'uuid-machine-id', description: 'Machine this failure mode belongs to' })
  @IsUUID()
  machineId!: string;

  @ApiPropertyOptional({ example: 'FM-001', description: 'Code (auto-generated if omitted)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiProperty({ example: 'Bearing wear' })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  description!: string;

  @ApiPropertyOptional({ enum: FailureModeCategory })
  @IsOptional()
  @IsEnum(FailureModeCategory)
  category?: FailureModeCategory;

  @ApiPropertyOptional({ example: 'Lack of lubrication' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  causeDescription?: string;

  @ApiPropertyOptional({ example: 'Excessive vibration, eventual seizure' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  effectDescription?: string;

  @ApiPropertyOptional({ example: 6, description: 'Severity 1-10' })
  @IsOptional()
  @IsInt()
  @Min(1)
  severityScore?: number;

  @ApiPropertyOptional({ example: 4, description: 'Occurrence 1-10' })
  @IsOptional()
  @IsInt()
  @Min(1)
  occurrenceScore?: number;

  @ApiPropertyOptional({ example: 3, description: 'Detection 1-10' })
  @IsOptional()
  @IsInt()
  @Min(1)
  detectionScore?: number;

  @ApiPropertyOptional({ example: 'Inspect and lubricate bearings monthly' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  recommendedAction?: string;
}

export class UpdateFailureModeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ enum: FailureModeCategory })
  @IsOptional()
  @IsEnum(FailureModeCategory)
  category?: FailureModeCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  causeDescription?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  effectDescription?: string;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsInt()
  @Min(1)
  severityScore?: number;

  @ApiPropertyOptional({ example: 4 })
  @IsOptional()
  @IsInt()
  @Min(1)
  occurrenceScore?: number;

  @ApiPropertyOptional({ example: 3 })
  @IsOptional()
  @IsInt()
  @Min(1)
  detectionScore?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  recommendedAction?: string;
}

export class SeedStandardFailureModesDto {
  @ApiProperty({ example: 'uuid-machine-id', description: 'Machine to seed the standard FMEA library onto' })
  @IsUUID()
  machineId!: string;
}
