import { ApiProperty } from '@nestjs/swagger';
import { Product } from '@loyalty/shared';
import { IsDateString, IsEnum, IsNumber, IsString, Min } from 'class-validator';

export class IngestDailyTotalsDto {
  @ApiProperty()
  @IsString()
  stationId!: string;

  @ApiProperty({ enum: Product, enumName: 'Product' })
  @IsEnum(Product)
  product!: Product;

  @ApiProperty()
  @IsDateString()
  date!: string;

  @ApiProperty()
  @IsNumber()
  @Min(0)
  totalSales!: number;
}
