import { ApiPropertyOptional } from '@nestjs/swagger';
import { Product } from '@loyalty/shared';
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * See ListCustomersQueryDto for why this extends PaginationQueryDto rather
 * than pairing it with separate `@Query('stationId')`-style params — the
 * global ValidationPipe's forbidNonWhitelisted check validates `@Query()`
 * against one combined shape.
 */
export class ListSalesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stationId?: string;

  @ApiPropertyOptional({ enum: Product })
  @IsOptional()
  @IsEnum(Product)
  product?: Product;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  to?: string;
}
