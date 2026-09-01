import {
  IsString, IsOptional, IsEnum, IsUUID, MaxLength, MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AlarmSeverityDto {
  CRITICAL = 'CRITICAL',
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
  INFO = 'INFO',
}

export class CreateAlarmDto {
  @ApiPropertyOptional({ example: 'uuid-machine-id' })
  @IsOptional()
  @IsUUID()
  machineId?: string;

  @ApiPropertyOptional({ example: 'uuid-job-order-id', description: 'Tag the alarm to a job order (live dashboard link)' })
  @IsOptional()
  @IsUUID()
  jobOrderId?: string;

  @ApiPropertyOptional({ example: 'uuid-work-order-id' })
  @IsOptional()
  @IsUUID()
  workOrderId?: string;

  @ApiPropertyOptional({ example: 'JAM_FEEDER' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @ApiProperty({ example: 'Feeder jam on cartoning machine — repeated stops' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  @ApiPropertyOptional({ enum: AlarmSeverityDto, default: AlarmSeverityDto.HIGH })
  @IsOptional()
  @IsEnum(AlarmSeverityDto)
  severity?: AlarmSeverityDto;

  @ApiPropertyOptional({ example: 'PROCESS', description: 'PROCESS | SAFETY | QUALITY | OPERATOR | EQUIPMENT' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class ResolveAlarmDto {
  @ApiPropertyOptional({ example: 'Jam cleared, guards re-checked' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
