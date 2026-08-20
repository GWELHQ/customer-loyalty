import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsIn, IsOptional, IsString, ValidateNested } from 'class-validator';

class EntryResultDto {
  @ApiProperty()
  @IsString()
  customerId!: string;

  @ApiProperty({ enum: ['paid', 'failed'] })
  @IsIn(['paid', 'failed'])
  status!: 'paid' | 'failed';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reference?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  failureReason?: string;
}

export class CompleteBatchDto {
  @ApiProperty({ type: [EntryResultDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryResultDto)
  results!: EntryResultDto[];
}
