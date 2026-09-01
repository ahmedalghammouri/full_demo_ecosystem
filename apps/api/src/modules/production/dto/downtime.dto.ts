import {
  IsString, IsBoolean, IsOptional, IsDateString,
  IsEnum, MaxLength, IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DowntimeCategory {
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
  OTHER = 'OTHER',
}

export enum DowntimeReasonCodeEnum {
  PLANNED_MAINTENANCE  = 'PLANNED_MAINTENANCE',
  CHANGEOVER           = 'CHANGEOVER',
  UNPLANNED_BREAKDOWN  = 'UNPLANNED_BREAKDOWN',
  MICRO_STOP           = 'MICRO_STOP',
  STARVED              = 'STARVED',
  BLOCKED              = 'BLOCKED',
  EXTERNAL             = 'EXTERNAL',
}

export class CreateDowntimeEventDto {
  @ApiPropertyOptional({ example: 'uuid-machine-id' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  machineId?: string;

  @ApiPropertyOptional({ example: 'uuid-work-center-id' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  workCenterId?: string;

  @ApiPropertyOptional({ example: 'uuid-work-order-id' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  workOrderId?: string;

  @ApiPropertyOptional({ example: 'cause-id' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  causeId?: string;

  @ApiPropertyOptional({ enum: DowntimeReasonCodeEnum, example: 'UNPLANNED_BREAKDOWN' })
  @IsOptional()
  @IsEnum(DowntimeReasonCodeEnum)
  reasonCode?: DowntimeReasonCodeEnum;

  @ApiPropertyOptional({ enum: DowntimeCategory })
  @IsOptional()
  @IsEnum(DowntimeCategory)
  category?: DowntimeCategory;

  @ApiPropertyOptional({ example: 'Cartoning machine feeder jam' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiPropertyOptional({ example: '2026-06-06T08:15:00.000Z' })
  @IsOptional()
  @IsDateString()
  startTime?: string;

  @ApiPropertyOptional({ example: '2026-06-06T08:42:00.000Z' })
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isPlanned?: boolean = false;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class UpdateDowntimeEventDto {
  @ApiPropertyOptional({ example: 'cause-id' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  causeId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiPropertyOptional({ enum: DowntimeCategory })
  @IsOptional()
  @IsEnum(DowntimeCategory)
  category?: DowntimeCategory;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class EndDowntimeEventDto {
  @ApiPropertyOptional({ example: '2026-06-06T08:42:00.000Z' })
  @IsOptional()
  @IsDateString()
  endTime?: string;

  @ApiPropertyOptional({ example: 'cause-id' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  causeId?: string;

  @ApiPropertyOptional({ example: 'Jam cleared, production resumed' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  resolution?: string;
}

export class AcknowledgeDowntimeDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
