import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateAttendantDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @ApiPropertyOptional({ example: 'KIS1-042' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ description: 'Physical RFID/NFC badge UID assigned to this attendant — normalized server-side, must be unique. Logs the attendant straight in, no PIN.' })
  @IsOptional()
  @IsString()
  nfcTagId?: string;
}
