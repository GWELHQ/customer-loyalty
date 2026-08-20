import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class CreateAttendantDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiProperty({ example: 'KIS1-042' })
  @IsString()
  employeeId!: string;

  @ApiProperty()
  @IsString()
  assignedStationId!: string;

  @ApiProperty({ example: '4821', description: '4 to 6 digit PIN' })
  @Matches(/^\d{4,6}$/)
  pin!: string;
}
