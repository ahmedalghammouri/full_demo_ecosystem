import {
  IsString, IsInt, IsUUID, IsOptional, IsEnum, IsDateString,
  Min, Max, MaxLength, MinLength, IsPositive, IsArray, ValidateNested,
  IsNumber,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

// ─── SPC QUICK-RECORD ────────────────────────────────────────
// Direct SPC point entry (SPC page / Quality Floor) — bypasses a full inspection.
export class RecordSpcDto {
  @ApiProperty()
  @IsString()
  machineId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  workOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  measuredAt?: string;

  @ApiProperty({ type: () => [MeasurementDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements!: MeasurementDto[];
}

// ─── INSPECTION ──────────────────────────────────────────────

export enum InspectionType {
  INCOMING = 'INCOMING',
  IN_PROCESS = 'IN_PROCESS',
  FINAL = 'FINAL',
  SPC = 'SPC',
  PATROL = 'PATROL',
  AUDIT = 'AUDIT',
}

export enum InspectionResult {
  PENDING = 'PENDING',
  PASS = 'PASS',
  FAIL = 'FAIL',
  CONDITIONAL = 'CONDITIONAL',
}

export class MeasurementDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  parameterId?: string;

  @ApiProperty()
  @IsString()
  parameterName!: string;

  @ApiProperty()
  @IsNumber()
  value!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  pass?: boolean;

  @ApiPropertyOptional({ description: 'Sample/unit number within the inspection subgroup (1-based)' })
  @IsOptional()
  @IsNumber()
  subgroupNumber?: number;

  @ApiPropertyOptional({ description: 'Per-parameter inspector note' })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateInspectionDto {
  @ApiPropertyOptional({ example: 'uuid-plan-id' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ example: 'uuid-work-order-id' })
  @IsOptional()
  @IsUUID()
  workOrderId?: string;

  @ApiPropertyOptional({ example: 'uuid-batch-id' })
  @IsOptional()
  @IsUUID()
  batchRecordId?: string;

  @ApiPropertyOptional({ example: 'uuid-machine-id' })
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiProperty({ enum: InspectionType })
  @IsEnum(InspectionType)
  type!: InspectionType;

  @ApiProperty({ example: 100, description: 'Total sample quantity inspected' })
  @IsInt()
  @IsPositive()
  totalQty!: number;

  @ApiProperty({ example: 98 })
  @IsInt()
  @Min(0)
  passQty!: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(0)
  failQty!: number;

  @ApiPropertyOptional({ type: [MeasurementDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements?: MeasurementDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  inspectedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

export class UpdateInspectionDto {
  @ApiPropertyOptional({ enum: InspectionType })
  @IsOptional()
  @IsEnum(InspectionType)
  type?: InspectionType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  workOrderId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchRecordId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiPropertyOptional({ enum: InspectionResult })
  @IsOptional()
  @IsEnum(InspectionResult)
  result?: InspectionResult;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  totalQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  inspectedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  passQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  failQty?: number;

  @ApiPropertyOptional({ type: [MeasurementDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements?: MeasurementDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

// ─── NCR ─────────────────────────────────────────────────────

export enum NCRSeverity {
  MINOR = 'MINOR',
  MAJOR = 'MAJOR',
  CRITICAL = 'CRITICAL',
}

export enum NCRStatus {
  OPEN = 'OPEN',
  IN_REVIEW = 'IN_REVIEW',
  CAPA_PENDING = 'CAPA_PENDING',
  RESOLVED = 'RESOLVED',
  CLOSED = 'CLOSED',
}

const NCR_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['IN_REVIEW', 'RESOLVED'],
  IN_REVIEW: ['CAPA_PENDING', 'RESOLVED'],
  CAPA_PENDING: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

export { NCR_TRANSITIONS };

export class CreateNCRDto {
  @ApiProperty({ example: 'Label misalignment on Betti 2L batch' })
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  title!: string;

  @ApiProperty({ example: 'Detected 15 units with misaligned labels in batch B240606-001' })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @ApiProperty({ enum: NCRSeverity })
  @IsEnum(NCRSeverity)
  severity!: NCRSeverity;

  @ApiPropertyOptional({ example: 'uuid-sku-id' })
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional({ example: 'uuid-batch-id' })
  @IsOptional()
  @IsUUID()
  batchRecordId?: string;

  @ApiPropertyOptional({ example: 'uuid-machine-id' })
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiProperty({ example: 'LABELING', description: 'Defect category code' })
  @IsString()
  @MaxLength(100)
  defectCategory!: string;

  @ApiPropertyOptional({ example: 'DC-001' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  defectCode?: string;

  @ApiProperty({ example: 15, description: 'Non-conforming quantity' })
  @IsInt()
  @IsPositive()
  quantity!: number;

  @ApiPropertyOptional({ example: 'REWORK', enum: ['USE_AS_IS', 'REWORK', 'SCRAP', 'RETURN_TO_SUPPLIER'] })
  @IsOptional()
  @IsString()
  disposition?: string;

  @ApiProperty({ example: '2026-06-06T08:30:00.000Z' })
  @IsDateString()
  detectedAt!: string;

  @ApiProperty({ example: '2026-06-08T17:00:00.000Z', description: 'Resolution due date' })
  @IsDateString()
  dueDate!: string;
}

export class UpdateNCRDto {
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

  @ApiPropertyOptional({ enum: NCRSeverity })
  @IsOptional()
  @IsEnum(NCRSeverity)
  severity?: NCRSeverity;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  batchRecordId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  defectCategory?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50)
  defectCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  quantity?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  detectedAt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  disposition?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  rootCause?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  correctiveAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  preventiveAction?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class UpdateNCRStatusDto {
  @ApiProperty({ enum: NCRStatus })
  @IsEnum(NCRStatus)
  status!: NCRStatus;

  @ApiPropertyOptional({ example: 'Root cause identified as labeler tension setting' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
}

// ─── CAPA ────────────────────────────────────────────────────

export enum CAPAType {
  CORRECTIVE = 'CORRECTIVE',
  PREVENTIVE = 'PREVENTIVE',
}

export enum CAPAStatus {
  OPEN = 'OPEN',
  IN_PROGRESS = 'IN_PROGRESS',
  VERIFIED = 'VERIFIED',
  CLOSED = 'CLOSED',
}

export enum CAPAPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

export class CreateCAPADto {
  @ApiPropertyOptional({ example: 'uuid-ncr-id' })
  @IsOptional()
  @IsUUID()
  ncrId?: string;

  @ApiProperty({ enum: CAPAType })
  @IsEnum(CAPAType)
  type!: CAPAType;

  @ApiProperty({ example: 'Adjust labeler tension to factory spec and recalibrate' })
  @IsString()
  @MinLength(5)
  @MaxLength(255)
  title!: string;

  @ApiProperty({ example: 'The labeler tension was set at 85N vs the 100N factory specification...' })
  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  description!: string;

  @ApiProperty({ enum: CAPAPriority })
  @IsEnum(CAPAPriority)
  priority!: CAPAPriority;

  @ApiPropertyOptional({ example: 'uuid-assigned-user-id' })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiPropertyOptional({ example: '2026-06-10T17:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class UpdateCAPADto {
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

  @ApiPropertyOptional({ enum: CAPAPriority })
  @IsOptional()
  @IsEnum(CAPAPriority)
  priority?: CAPAPriority;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  effectiveness?: string;
}

export class AddCAPAActionDto {
  @ApiProperty({ example: 'Recalibrate labeler tension to 100N per factory spec' })
  @IsString()
  @MinLength(5)
  @MaxLength(1000)
  description!: string;

  @ApiPropertyOptional({ example: 'uuid-user-id' })
  @IsOptional()
  @IsUUID()
  assignedToId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class VerifyCAPADto {
  @ApiProperty({ example: 'Action verified effective — no recurrence in 30 days' })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  effectiveness!: string;
}

// ─── QUALITY PLANS (ISA-95 QualityTestSpecification) ─────────

export class CreateQualityPlanDto {
  @ApiProperty({ example: 'QP-INSP-001' })
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  code!: string;

  @ApiProperty({ example: 'Incoming Raw Material Inspection' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  name!: string;

  @ApiProperty({ example: 'INCOMING', enum: ['INCOMING', 'IN_PROCESS', 'FINAL'] })
  @IsString()
  type!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiPropertyOptional({ example: 'EVERY_BATCH', enum: ['EVERY_BATCH', 'HOURLY', 'SHIFT', 'DAILY', 'WEEKLY'] })
  @IsOptional()
  @IsString()
  samplingFrequency?: string;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @IsPositive()
  samplingQty?: number;

  @ApiPropertyOptional({ example: '1.0' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;
}

export class UpdateQualityPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @ApiPropertyOptional({ enum: ['INCOMING', 'IN_PROCESS', 'FINAL'] })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  skuId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  samplingFrequency?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @IsPositive()
  samplingQty?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  version?: string;

  @ApiPropertyOptional()
  @IsOptional()
  isActive?: boolean;
}

// ─── QUALITY PARAMETERS (ISA-95 QualityTestSpecificationProperty) ─

export class CreateQualityParameterDto {
  @ApiProperty({ example: 'Fill Weight' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'g' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @IsNumber()
  nominalValue?: number;

  @ApiPropertyOptional({ example: 510, description: 'Upper Control Limit (SPC)' })
  @IsOptional()
  @IsNumber()
  ucl?: number;

  @ApiPropertyOptional({ example: 490, description: 'Lower Control Limit (SPC)' })
  @IsOptional()
  @IsNumber()
  lcl?: number;

  @ApiPropertyOptional({ example: 515, description: 'Upper Specification Limit (product spec)' })
  @IsOptional()
  @IsNumber()
  usl?: number;

  @ApiPropertyOptional({ example: 485, description: 'Lower Specification Limit (product spec)' })
  @IsOptional()
  @IsNumber()
  lsl?: number;

  @ApiPropertyOptional({ example: 'Weigh on calibrated scale' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  checkMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  isKPI?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpdateQualityParameterDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  unit?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  nominalValue?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  ucl?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lcl?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  usl?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  lsl?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  checkMethod?: string;

  @ApiPropertyOptional()
  @IsOptional()
  isKPI?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
