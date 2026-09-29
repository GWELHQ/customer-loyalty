import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive } from 'class-validator';

export class UpdateSaleAmountDto {
  @ApiProperty({ example: 2068, description: 'Corrected amount paid, in KES' })
  @IsNumber()
  @IsPositive()
  amountPaid!: number;
}
