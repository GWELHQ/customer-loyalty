import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MinLength, Min } from 'class-validator';

/**
 * Submitted after the APK has been uploaded directly to GCS using a signed
 * URL. The API validates the GCS object before recording the release.
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

  @ApiProperty({ description: 'The gs:// path returned by the upload-url endpoint.' })
  @IsString()
  @MinLength(1)
  gcsPath!: string;
}

export class CreateApkUploadUrlDto {
  @ApiProperty({ example: 'green-wells-1.4.0.apk' })
  @IsString()
  @MinLength(1)
  fileName!: string;

  @ApiProperty({ example: 'application/vnd.android.package-archive' })
  @IsString()
  @MinLength(1)
  contentType!: string;
}
