import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';

/**
 * The global ValidationPipe validates `@Query()` against the whole
 * declared shape with `forbidNonWhitelisted: true` — extending
 * PaginationQueryDto here (rather than pairing it with separate
 * `@Query('name')`-style params) is what lets page/pageSize/cursor and
 * these filters coexist on the same request without a false "property
 * should not exist" rejection.
 */
export class ListCustomersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stationId?: string;
}
