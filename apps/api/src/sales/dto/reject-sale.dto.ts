import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RejectSaleDto {
  @ApiProperty({ description: 'Required — why this sale is being rejected before cashback is credited.' })
  @IsString()
  @MinLength(3)
  reason!: string;
}
