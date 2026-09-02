import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { Permission } from '@loyalty/shared';
import { AuditService } from '../common/audit/audit.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RequirePermissions } from '../common/decorators/permissions.decorator';
import { StaffOnly } from '../common/decorators/staff_only.decorator';
import type { StaffPrincipal } from '../common/types/principal';
import { ApkVersionsService } from './apk-versions.service';
import { CreateApkVersionDto } from './dto/create-apk-version.dto';

/** Admin management of Android app builds — see ApkController for the public download surface these feed. */
@ApiTags('apk-versions')
@ApiBearerAuth()
@StaffOnly()
@RequirePermissions(Permission.APK_MANAGE)
@Controller('apk-versions')
export class ApkVersionsController {
  constructor(
    private readonly apkVersions: ApkVersionsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list() {
    return this.apkVersions.list();
  }

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 300 * 1024 * 1024 } }))
  async create(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateApkVersionDto,
    @CurrentUser() actor: StaffPrincipal,
  ) {
    if (!file) throw new BadRequestException('file is required');
    const features = parseStringArrayField(dto.featuresJson);
    const fixes = parseStringArrayField(dto.fixesJson);

    const version = await this.apkVersions.create(
      { versionName: dto.versionName, versionCode: dto.versionCode, features, fixes },
      file,
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
