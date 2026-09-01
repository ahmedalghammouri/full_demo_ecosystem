import { IsString, IsOptional, IsIn, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export const ATTACHMENT_ENTITY_TYPES = [
  'MAINTENANCE_WO',
  'QUALITY_INSPECTION',
  'NCR',
  'CAPA',
  'QUALITY_PLAN',
  'PM_PLAN',
] as const;

export class UploadAttachmentDto {
  @ApiProperty({ enum: ATTACHMENT_ENTITY_TYPES })
  @IsString()
  @IsIn(ATTACHMENT_ENTITY_TYPES as unknown as string[])
  entityType!: string;

  @ApiProperty({ description: 'Id of the owning record' })
  @IsString()
  entityId!: string;

  @ApiPropertyOptional({ enum: ['INSTRUCTION', 'EVIDENCE'], default: 'EVIDENCE' })
  @IsOptional()
  @IsIn(['INSTRUCTION', 'EVIDENCE'])
  category?: 'INSTRUCTION' | 'EVIDENCE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
