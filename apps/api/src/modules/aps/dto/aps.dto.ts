import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, IsDateString, IsNumber, Min, IsInt, IsBoolean, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class RunScheduleDto {
  @ApiPropertyOptional({ description: 'Schedule forward from this instant (defaults to now)' })
  @IsOptional() @IsDateString()
  startFrom?: string;

  @ApiPropertyOptional({ description: 'Recalculate ONLY this work order — other open jobs keep their plan and pre-occupy their machines' })
  @IsOptional() @IsUUID('4')
  workOrderId?: string;

  @ApiPropertyOptional({ description: 'Compute the plan and return it WITHOUT writing to the database (preview for the Gantt — review, then Save)' })
  @IsOptional() @IsBoolean()
  dryRun?: boolean;

  @ApiPropertyOptional({ description: 'Manual drag/resize overrides — each op is pinned at {start,end} and the rest reflows around it (respecting relationships)' })
  @IsOptional() @IsArray()
  overrides?: Array<{ id: string; start: string; end: string }>;
}

export class SaveScheduleDto {
  @ApiProperty({ description: 'The reviewed plan to commit — job order new start/end windows', type: [Object] })
  @IsArray()
  updates!: Array<{ id: string; start: string; end: string }>;
}

export class RescheduleJobDto {
  @ApiProperty({ description: 'Job order to move' })
  @IsUUID('4')
  jobId!: string;

  @ApiPropertyOptional({ description: 'Move to a different machine' })
  @IsOptional() @IsUUID('4')
  machineId?: string;

  @ApiProperty({ description: 'New planned start (ISO)' })
  @IsDateString()
  start!: string;

  @ApiPropertyOptional({ description: 'New planned end (ISO) — if omitted, keeps the same duration' })
  @IsOptional() @IsDateString()
  end?: string;
}

export class CtpDto {
  @ApiProperty({ description: 'SKU to promise' })
  @IsUUID('4')
  skuId!: string;

  @ApiProperty({ example: 1000, description: 'Requested quantity' })
  @Type(() => Number) @IsInt() @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ description: 'Customer requested date (ISO) — feasibility is checked against it' })
  @IsOptional() @IsDateString()
  dueDate?: string;
}
