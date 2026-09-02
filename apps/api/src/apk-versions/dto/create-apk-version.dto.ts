import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MinLength, Min } from 'class-validator';

/**
 * Submitted as multipart/form-data alongside the .apk file — `featuresJson`
 * and `fixesJson` are JSON-stringified string arrays (FormData has no
 * native array field type); the controller parses them back into arrays
 * after DTO validation.
 */
export class CreateApkVersionDto {
  @ApiProperty({ example: '1.4.0' })
  @IsString()
  @MinLength(1)
  versionName!: string;

  @ApiProperty({ example: 14 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  versionCode!: number;

  @ApiPropertyOptional({ type: String, description: 'JSON-stringified string array of new features in this build.' })
  @IsOptional()
  @IsString()
  featuresJson?: string;

  @ApiPropertyOptional({ type: String, description: 'JSON-stringified string array of bug fixes in this build.' })
  @IsOptional()
  @IsString()
  fixesJson?: string;
}
