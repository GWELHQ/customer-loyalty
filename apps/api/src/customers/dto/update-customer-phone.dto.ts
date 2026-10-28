import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UpdateCustomerPhoneDto {
  @ApiProperty({ example: '0712345678', description: 'Corrected phone number — normalized server-side, must not belong to another active customer.' })
  @IsString()
  phoneNumber!: string;
}
