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

  @ApiPropertyOptional({
    description:
      'Id of a POST /mobile/vehicle-plate-checks result performed for this customer just before the sale — copied onto the sale for audit if it matches the resolved customer and is recent; silently ignored otherwise. Never blocks the sale.',
  })
  @IsOptional()
  @IsString()
  plateCheckId?: string;
}
