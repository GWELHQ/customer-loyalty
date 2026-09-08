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

    // Let GCS serve the file instead of proxying it through Cloud Run (which
    // has a 32 MiB HTTP/1 response limit).
    const url = await this.storage.getSignedReadUrl(version.gcsPath);
    res.redirect(url);
  }
}
