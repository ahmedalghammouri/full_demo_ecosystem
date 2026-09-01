import { IsEmail, IsString, MinLength, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class LoginDto {
  @ApiProperty({ example: 'issa.masadeh@npdf.com.sa' })
  @IsEmail()
  @Transform(({ value }: { value: string }) => value.toLowerCase().trim())
  email!: string;

  @ApiProperty({ example: 'Password@123' })
  @IsString()
  @MinLength(6)
  password!: string;

  @ApiProperty({ example: 'NPDF', required: false, description: 'Factory code from the factory selector. Required for non-SUPER_ADMIN users.' })
  @IsOptional()
  @IsString()
  @Transform(({ value }: { value: string }) => value?.toUpperCase().trim())
  factoryCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}
