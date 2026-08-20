import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive } from 'class-validator';
import { CreateSaleDto } from '../../sales/dto/create-sale.dto';

export class MobileCreateSaleDto extends CreateSaleDto {
  @ApiPropertyOptional({ description: 'Price per litre the Android app used for its own preview, for stale-cache detection' })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  claimedPricePerLitre?: number;

  @ApiPropertyOptional({ description: 'Cashback the Android app calculated locally, for stale-cache detection' })
  @IsOptional()
  @IsNumber()
  claimedCashbackEarned?: number;
}
