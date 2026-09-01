import {
  IsString, IsInt, IsPositive, IsDateString, IsEnum, IsOptional,
  IsUUID, MinLength, MaxLength, Min, Max, IsNumber, IsBoolean, IsArray, IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

import { UNIT_LADDER } from '../../../common/units.util';

export enum WOPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export class CreateWorkOrderDto {
  @ApiProperty({ example: 'uuid-sku-id' })
  @IsUUID()
  skuId!: string;

  @ApiPropertyOptional({ example: 'uuid-line-id' })
  @IsOptional()
  @IsUUID()
  lineId?: string;

  @ApiPropertyOptional({ example: 'uuid-production-order-id' })
  @IsOptional()
  @IsUUID()
  productionOrderId?: string;

  @ApiProperty({ example: 3000, description: 'Planned quantity (boxes/cartons)' })
  @IsInt()
  @IsPositive()
  @Max(1_000_000)
  plannedQty!: number;

  @ApiProperty({ example: '2026-06-06T07:30:00.000Z' })
  @IsDateString()
  plannedStart!: string;

  @ApiProperty({ example: '2026-06-06T19:30:00.000Z' })
  @IsDateString()
  plannedEnd!: string;

  @ApiProperty({ enum: WOPriority, example: WOPriority.HIGH })
  @IsEnum(WOPriority)
  priority!: WOPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  operatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supervisorId?: string;

  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @ApiPropertyOptional({ description: 'Start the WO + its job orders automatically when plannedStart arrives' })
  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;

  @ApiPropertyOptional({ description: 'Per-routing-step operator pre-assignment: [{ stepId, operatorId }]' })
  @IsOptional()
  assignments?: Array<{ stepId: string; operatorId: string }>;
}

export class UpdateWorkOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  plannedQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedEnd?: string;

  @ApiPropertyOptional({ enum: WOPriority })
  @IsOptional()
  @IsEnum(WOPriority)
  priority?: WOPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  operatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  supervisorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class StartWorkOrderDto {
  @ApiPropertyOptional({ example: 'uuid-operator-id' })
  @IsOptional()
  @IsUUID()
  operatorId?: string;
}

export class CompleteWorkOrderDto {
  @ApiProperty({ example: 2950, description: 'Actual quantity produced' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  actualQty!: number;

  @ApiPropertyOptional({ example: 2900 })
  @IsOptional()
  @IsInt()
  @Min(0)
  goodQty?: number;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional()
  @IsInt()
  @Min(0)
  scrapQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class HoldWorkOrderDto {
  @ApiProperty({ example: 'Machine breakdown — waiting for spare part' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class CancelWorkOrderDto {
  @ApiProperty({ example: 'Cancelled by supervisor — SKU changed' })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

export class RecordCountDto {
  @ApiProperty({ example: 150, description: 'Good units produced since last update' })
  @IsInt()
  @Min(0)
  goodCount!: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  rejectCount?: number;

  @ApiPropertyOptional({ example: 'uuid-shift-instance-id' })
  @IsOptional()
  @IsUUID()
  shiftInstanceId?: string;
}

export class WorkOrderFiltersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

// ─────────────────────────────────────────────────────────────
// PRODUCTION ORDER DTOs (ISA-95 Level 4 — ERP/Scheduling)
// ─────────────────────────────────────────────────────────────

export class CreateProductionOrderDto {
  @ApiProperty({ example: 'PO-NPDF-1055' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  orderNumber!: string;

  @ApiPropertyOptional({ example: 'SAP-4500012345', description: 'SAP / ERP reference number' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  sapOrderNumber?: string;

  @ApiProperty({ example: 'uuid-sku-id' })
  @IsUUID()
  skuId!: string;

  @ApiProperty({ example: 1000, description: 'Target quantity (cartons/units)' })
  @IsInt()
  @IsPositive()
  @Max(10_000_000)
  targetQty!: number;

  @ApiPropertyOptional({ example: 'CARTON' })
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiProperty({ enum: WOPriority, example: WOPriority.HIGH })
  @IsEnum(WOPriority)
  priority!: WOPriority;

  @ApiProperty({ example: '2026-06-08T07:30:00.000Z' })
  @IsDateString()
  plannedStart!: string;

  @ApiProperty({ example: '2026-06-09T19:30:00.000Z' })
  @IsDateString()
  plannedEnd!: string;

  @ApiPropertyOptional({ example: 'Al-Othaim Markets — June restock' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateProductionOrderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  targetQty?: number;

  /**
   * The rung `targetQty` is counted on.
   *
   * The edit form has always OFFERED this — a Unit dropdown beside Target Qty —
   * and the DTO did not accept it, so every save was refused with "property
   * unit should not exist" and no field on screen to blame. A form that shows a
   * control the API rejects is worse than one that hides it.
   *
   * Validated against the packaging ladder rather than left a free string, as
   * the create DTO leaves it: a quantity counted in a unit nothing can convert
   * is a quantity nothing downstream can use.
   */
  @ApiPropertyOptional({ enum: UNIT_LADDER })
  @IsOptional()
  @IsIn([...UNIT_LADDER], { message: `unit must be one of: ${UNIT_LADDER.join(', ')}` })
  unit?: string;

  @ApiPropertyOptional({ enum: WOPriority })
  @IsOptional()
  @IsEnum(WOPriority)
  priority?: WOPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedStart?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  plannedEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  customer?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateWOFromPODto {
  @ApiProperty({ example: 1000 })
  @IsInt()
  @IsPositive()
  @Max(10_000_000)
  plannedQty!: number;

  @ApiProperty({ example: '2026-06-08T07:30:00.000Z' })
  @IsDateString()
  plannedStart!: string;

  @ApiProperty({ example: '2026-06-08T19:30:00.000Z' })
  @IsDateString()
  plannedEnd!: string;

  @ApiPropertyOptional({ enum: WOPriority })
  @IsOptional()
  @IsEnum(WOPriority)
  priority?: WOPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  operatorId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class HoldProductionOrderDto {
  @ApiProperty({ example: 'Waiting for raw material delivery' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class CancelProductionOrderDto {
  @ApiProperty({ example: 'Customer order postponed' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class AutoGenerateWOsDto {
  @ApiProperty({ example: '2026-06-09T07:30:00.000Z' })
  @IsDateString()
  plannedStart!: string;

  @ApiProperty({ example: '2026-06-11T19:30:00.000Z' })
  @IsDateString()
  plannedEnd!: string;

  @ApiPropertyOptional({ description: 'Approved reschedule request — required when the smart finish exceeds the due date' })
  @IsOptional()
  @IsUUID('4')
  rescheduleRequestId?: string;

  @ApiPropertyOptional({ description: 'Start the WO + its job orders automatically when plannedStart arrives' })
  @IsOptional()
  @IsBoolean()
  autoStart?: boolean;

  @ApiPropertyOptional({ description: 'Per-routing-step operator pre-assignment: [{ stepId, operatorId }]' })
  @IsOptional()
  @IsArray()
  assignments?: Array<{ stepId: string; operatorId: string }>;
}

export class CreateRescheduleRequestDto {
  @ApiProperty() @IsDateString()
  proposedStart!: string;

  @ApiProperty() @IsDateString()
  proposedEnd!: string;

  @ApiPropertyOptional() @IsOptional() @IsString()
  reason?: string;

  @ApiPropertyOptional() @IsOptional() @IsInt()
  workContentMins?: number;

  @ApiPropertyOptional() @IsOptional() @IsInt()
  plannedStoppageMins?: number;

  @ApiPropertyOptional() @IsOptional() @IsDateString()
  dueDate?: string;
}

export class ReviewRescheduleRequestDto {
  @ApiProperty({ description: 'true = approve, false = reject' })
  @IsBoolean()
  approve!: boolean;

  @ApiPropertyOptional() @IsOptional() @IsString()
  reason?: string;
}

export class ProductionOrderFiltersDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  // Analysis scope — filter POs to those with a work order on the area/line/machine.
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  machineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  lineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  areaId?: string;

  @ApiPropertyOptional({ description: 'archive scope: active | archived | all' })
  @IsOptional()
  @IsString()
  archived?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
