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
}
