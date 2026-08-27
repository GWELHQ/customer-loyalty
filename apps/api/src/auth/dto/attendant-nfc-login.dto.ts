import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class AttendantNfcLoginDto {
  @ApiProperty({ description: 'Raw UID read off the tapped RFID/NFC badge — normalized server-side.' })
  @IsString()
  @MinLength(1)
  tagId!: string;
}
