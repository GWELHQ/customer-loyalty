import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsString } from 'class-validator';

export class CreateSalesDelegationDto {
  @ApiProperty()
  @IsString()
  stationId!: string;

  @ApiProperty()
  @IsString()
  delegateUserId!: string;

  @ApiProperty()
  @IsDateString()
  startDate!: string;

  @ApiProperty()
  @IsDateString()
  endDate!: string;
}
