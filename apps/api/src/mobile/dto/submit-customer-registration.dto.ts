import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Product } from '@loyalty/shared';
import { IsDateString, IsEnum, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MinLength } from 'class-validator';

export class SubmitCustomerRegistrationDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  customerFullName!: string;

  @ApiProperty()
  @IsString()
  customerPhoneNumber!: string;

  @ApiProperty({ enum: Product })
  @IsEnum(Product)
  product!: Product;

  @ApiProperty()
  @IsNumber()
  @IsPositive()
  amountPaid!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  saleDate?: string;

  @ApiProperty()
  @IsUUID()
  idempotencyKey!: string;
}
