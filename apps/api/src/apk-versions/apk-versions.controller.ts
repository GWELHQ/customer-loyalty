import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { ApkVersionsService } from './apk-versions.service';
import { CreateApkUploadUrlDto, CreateApkVersionDto } from './dto/create-apk-version.dto';
import { StorageService } from '../common/storage/storage.service';

/** Admin management of Android app builds — see ApkController for the public download surface these feed. */
@ApiTags('apk-versions')
@ApiBearerAuth()
@StaffOnly()
@RequirePermissions(Permission.APK_MANAGE)
@Controller('apk-versions')
export class ApkVersionsController {
  constructor(
    private readonly apkVersions: ApkVersionsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.apkVersions.list();
  }

  @Post()
  async create(
    @Body() dto: CreateApkVersionDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    const features = parseStringArrayField(dto.featuresJson);
    const fixes = parseStringArrayField(dto.fixesJson);

    const version = await this.apkVersions.create(
      { versionName: dto.versionName, versionCode: dto.versionCode, features, fixes, gcsPath: dto.gcsPath },
      actor,
    );
    await this.audit.record({
      actor,
      action: 'apk_version.create',
      entityType: 'apkVersion',
      entityId: version.id,
      entityLabel: version.versionName,
      metadata: { versionCode: version.versionCode },
    });
    return version;
  }

  @Post('upload-url')
  createUploadUrl(@Body() dto: CreateApkUploadUrlDto) {
    return this.storage.createApkUploadUrl(dto.fileName, dto.contentType);
  }

  @Patch(':id/release')
  async markRelease(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    const version = await this.apkVersions.markRelease(id);
    await this.audit.record({
      actor,
      action: 'apk_version.mark_release',
      entityType: 'apkVersion',
      entityId: version.id,
      entityLabel: version.versionName,
    });
    return version;
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @CurrentUser() actor: StaffPrincipal) {
    await this.apkVersions.delete(id);
    await this.audit.record({ actor, action: 'apk_version.delete', entityType: 'apkVersion', entityId: id });
    return { success: true };
  }
}

/**
 * The DTO's own array fields don't survive the multipart body the same way
 * a plain field does — the client JSON-stringifies `features`/`fixes`
 * before appending them to FormData, so they need parsing back out here
 * rather than through class-validator/class-transformer like the rest of
 * `CreateApkVersionDto`.
 */
function parseStringArrayField(raw: string | undefined): string[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BadRequestException('features/fixes must be a JSON array of strings');
  }
  if (!Array.isArray(parsed) || !parsed.every((v) => typeof v === 'string')) {
    throw new BadRequestException('features/fixes must be a JSON array of strings');
  }
  return parsed.filter((s) => s.trim().length > 0);
}
