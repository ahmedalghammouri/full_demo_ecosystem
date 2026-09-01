import { IsString, IsNotEmpty, Length, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyMFADto {
  @ApiProperty({ description: 'User ID (for post-login MFA step)' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ example: '123456', description: '6-digit TOTP code' })
  @IsString()
  @Length(6, 6)
  otp!: string;
}
