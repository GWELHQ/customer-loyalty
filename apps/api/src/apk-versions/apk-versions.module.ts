import { Module } from '@nestjs/common';
import { ApkController } from './apk.controller';
import { ApkVersionsController } from './apk-versions.controller';
import { ApkVersionsService } from './apk-versions.service';

@Module({
  controllers: [ApkVersionsController, ApkController],
  providers: [ApkVersionsService],
})
export class ApkVersionsModule {}
