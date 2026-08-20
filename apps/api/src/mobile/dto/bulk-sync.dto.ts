import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator';
import { MobileCreateSaleDto } from './mobile-create-sale.dto';

export class BulkSyncDto {
  @ApiProperty({ type: [MobileCreateSaleDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => MobileCreateSaleDto)
  sales!: MobileCreateSaleDto[];
}
