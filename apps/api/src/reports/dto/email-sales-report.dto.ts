import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import type { SalesReportGroupBy } from '@loyalty/shared';
import { ArrayMinSize, IsArray, IsDateString, IsEmail, IsIn, IsOptional, IsString } from 'class-validator';

const GROUP_BY_VALUES: SalesReportGroupBy[] = ['attendant', 'station', 'shift', 'product'];

export class EmailSalesReportDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stationId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  preset?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({ enum: GROUP_BY_VALUES })
  @IsOptional()
  @IsIn(GROUP_BY_VALUES)
  groupBy?: SalesReportGroupBy;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsEmail({}, { each: true })
  recipients!: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsEmail({}, { each: true })
  cc?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  subject?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  body?: string;
}
