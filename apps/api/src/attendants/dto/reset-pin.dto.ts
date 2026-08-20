import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

export class ResetPinDto {
  @ApiProperty({ example: '4821', description: '4 to 6 digit PIN' })
  @Matches(/^\d{4,6}$/)
  newPin!: string;
}
