import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MinLength } from 'class-validator';

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

  @ApiPropertyOptional({
    description: 'Registered vehicle plates, e.g. ["KAA 123B", "KBW 878S"] — one customer can fuel more than one vehicle. Normalized server-side.',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  licensePlateNumbers?: string[];

  @ApiPropertyOptional({ description: 'Physical NFC tag UID assigned to this customer — normalized server-side, must be unique.' })
  @IsOptional()
  @IsString()
  nfcTagId?: string;
}
