import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { StorageService } from '../common/storage/storage.service';
import { ApkVersionsService } from './apk-versions.service';

/**
 * Unauthenticated surface backing the public /apk web page — attendants,
 * supervisors, or anyone else with the link can see what's released and
 * download it without signing in. Admin upload/rollback management lives
 * separately in ApkVersionsController.
 */
@ApiTags('apk')
@Public()
@Controller('apk')
export class ApkController {
  constructor(
    private readonly apkVersions: ApkVersionsService,
    private readonly storage: StorageService,
  ) {}

  @Get('release')
  async release() {
    const version = await this.apkVersions.getCurrentRelease();
    if (!version) throw new NotFoundException('No release is available yet');
    const { gcsPath, uploadedByUserId, uploadedByName, ...publicFields } = version;
    return publicFields;
  }

  @Get('download')
  async download(@Res() res: Response) {
    const version = await this.apkVersions.getCurrentRelease();
    if (!version) throw new NotFoundException('No release is available yet');

    const buffer = await this.storage.downloadBuffer(version.gcsPath);
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="green-wells-${version.versionName}.apk"`);
    res.send(buffer);
  }
}
