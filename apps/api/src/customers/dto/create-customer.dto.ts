import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class CreateCustomerDto {
  @ApiProperty()
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiProperty({ example: '0712345678' })
  @IsString()
  phoneNumber!: string;

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
