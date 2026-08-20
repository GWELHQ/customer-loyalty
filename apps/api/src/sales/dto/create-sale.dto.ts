import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Product } from '@loyalty/shared';
import { IsDateString, IsEnum, IsOptional, IsPositive, IsNumber, IsString, IsUUID } from 'class-validator';

export class CreateSaleDto {
  @ApiProperty({ example: '0712345678' })
  @IsString()
  customerPhone!: string;

  @ApiProperty({ enum: Product, enumName: 'Product' })
  @IsEnum(Product)
  product!: Product;

  @ApiProperty({ example: 2068 })
  @IsNumber()
  @IsPositive()
  amountPaid!: number;

  @ApiProperty()
  @IsString()
  stationId!: string;

  @ApiPropertyOptional({ description: 'Defaults to now if omitted' })
  @IsOptional()
  @IsDateString()
  saleDate?: string;

  @ApiProperty({ description: 'Client-generated UUID; also used as the sale document ID for idempotency' })
  @IsUUID()
  idempotencyKey!: string;

  @ApiPropertyOptional({ description: 'Client-generated local ID, required for offline-originated sales' })
  @IsOptional()
  @IsString()
  clientLocalId?: string;
}
