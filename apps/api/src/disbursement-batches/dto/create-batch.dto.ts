import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class CreateBatchDto {
  @ApiProperty({ example: '2026-08', description: 'YYYY-MM' })
  @IsString()
  @Matches(/^\d{4}-\d{2}$/)
  month!: string;
}
