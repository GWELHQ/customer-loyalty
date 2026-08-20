import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AssignStationDto {
  @ApiProperty()
  @IsString()
  stationId!: string;
}
