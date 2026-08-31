import { ApiProperty } from '@nestjs/swagger';
import { Product } from '@loyalty/shared';
import { IsDateString, IsEnum, IsPositive, IsNumber, IsString } from 'class-validator';

export class CreatePriceDto {
  @ApiProperty()
  @IsString()
  stationId!: string;

  @ApiProperty({ enum: Product, enumName: 'Product' })
  @IsEnum(Product)
  product!: Product;

  @ApiProperty({ example: 226.4 })
  @IsNumber()
  @IsPositive()
  pricePerLitre!: number;

  @ApiProperty()
  @IsDateString()
  effectiveFrom!: string;
}
