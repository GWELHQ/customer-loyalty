import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  homeStationId?: string;

  @ApiPropertyOptional({ description: 'Registered vehicle plate, e.g. "KAA 123B" — normalized server-side.' })
  @IsOptional()
  @IsString()
  licensePlateNumber?: string;

  @ApiPropertyOptional({ description: 'Physical NFC tag UID assigned to this customer — normalized server-side, must be unique.' })
  @IsOptional()
  @IsString()
  nfcTagId?: string;
}
