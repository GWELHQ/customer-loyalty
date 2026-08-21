import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString } from 'class-validator';

/** Reported by the Android app after it sends a sale-confirmation SMS directly via Africa's Talking. */
export class ReportSmsStatusDto {
  @ApiProperty()
  @IsBoolean()
  success!: boolean;

  @ApiPropertyOptional({ description: "Africa's Talking messageId or raw response, for audit" })
  @IsOptional()
  @IsString()
  providerResponse?: string;

  @ApiPropertyOptional({ description: 'Why the send failed, if it did' })
  @IsOptional()
  @IsString()
  errorReason?: string;
}
