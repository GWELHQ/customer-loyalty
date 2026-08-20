import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class AttendantLoginDto {
  @ApiProperty({ example: 'KIS1-042' })
  @IsString()
  employeeId!: string;

  @ApiProperty({ example: '4821', description: '4 to 6 digit PIN' })
  @Matches(/^\d{4,6}$/)
  pin!: string;
}
