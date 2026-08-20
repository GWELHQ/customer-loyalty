import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNumber, IsOptional, IsPositive, IsString, MinLength } from 'class-validator';

export class CreateSpecialRateRequestDto {
  @ApiProperty()
  @IsString()
  customerId!: string;

  @ApiProperty({ example: 5 })
  @IsNumber()
  @IsPositive()
  proposedKesPerLitre!: number;

  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  effectiveTo?: string;

  @ApiProperty()
  @IsString()
  @MinLength(5)
  reason!: string;
}
