import { ApiProperty } from '@nestjs/swagger';
import { ShiftType } from '@loyalty/shared';
import { IsArray, IsDateString, IsEnum, IsString } from 'class-validator';

export class RecordShiftRosterDto {
  @ApiProperty()
  @IsString()
  stationId!: string;

  @ApiProperty({ enum: ShiftType, enumName: 'ShiftType' })
  @IsEnum(ShiftType)
  shift!: ShiftType;

  @ApiProperty()
  @IsDateString()
  date!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  attendantIds!: string[];
}
