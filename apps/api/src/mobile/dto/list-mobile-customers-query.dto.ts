import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListMobileCustomersQueryDto {
  /** Opaque cursor (last customer's document ID) for paging past the first page. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ default: 500, minimum: 1, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit: number = 500;

  /** Only return customers updated after this ISO8601 timestamp, for incremental syncs after an initial full pull. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  updatedSince?: string;
}
