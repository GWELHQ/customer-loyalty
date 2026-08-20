import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateStationDto {
  @ApiProperty({ example: 'Kisumu 1' })
  @IsString()
  @MinLength(2)
  name!: string;

  @ApiProperty({ example: 'KIS1' })
  @IsString()
  code!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  location?: string;
}
