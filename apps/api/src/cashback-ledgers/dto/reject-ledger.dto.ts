import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class RejectLedgerDto {
  @ApiProperty()
  @IsString()
  @MinLength(5)
  reason!: string;
}
