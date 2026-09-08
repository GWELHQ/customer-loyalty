import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Storage } from '@google-cloud/storage';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../config/configuration';

/**
 * Wraps Google Cloud Storage for the file categories the domain needs:
 * customer Excel imports, their generated error reports, captured
 * vehicle-plate photos, and uploaded Android .apk builds. All are kept out
 * of Firestore entirely — only the gs:// path is persisted there.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private storage!: Storage;
  private bucketName!: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  onModuleInit() {
    this.storage = new Storage({ projectId: this.config.get('gcpProjectId') });
    this.bucketName = this.config.get('gcsBucketName');
  }

  private get bucket() {
    return this.storage.bucket(this.bucketName);
  }

  async uploadBuffer(
    pathPrefix: 'imports' | 'import-error-reports' | 'vehicle-plate-checks' | 'apk-releases',
    originalFileName: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    const objectPath = `${pathPrefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${originalFileName}`;
    const file = this.bucket.file(objectPath);
    await file.save(buffer, { contentType, resumable: false });
    return `gs://${this.bucketName}/${objectPath}`;
  }

  /**
   * Creates a short-lived, single-object upload URL.  The browser uploads
   * directly to GCS so large APKs never pass through Cloud Run.
   */
  async createApkUploadUrl(originalFileName: string, contentType: string): Promise<{ uploadUrl: string; gcsPath: string }> {
    if (!originalFileName.toLowerCase().endsWith('.apk')) {
      throw new BadRequestException('Only .apk files can be uploaded');
    }
    if (contentType && contentType !== 'application/vnd.android.package-archive') {
      throw new BadRequestException('APK file must use application/vnd.android.package-archive content type');
    }

    const objectPath = this.newObjectPath('apk-releases', originalFileName);
    const [uploadUrl] = await this.bucket.file(objectPath).getSignedUrl({
      version: 'v4',
      action: 'write',
      expires: Date.now() + 15 * 60 * 1000,
      contentType: 'application/vnd.android.package-archive',
    });
    return { uploadUrl, gcsPath: `gs://${this.bucketName}/${objectPath}` };
  }

  async getObjectSize(gcsPath: string): Promise<number> {
    const [metadata] = await this.bucket.file(this.toObjectPath(gcsPath)).getMetadata();
    const size = Number(metadata.size);
    if (!Number.isSafeInteger(size) || size <= 0) {
      throw new BadRequestException('Uploaded APK is empty or has an invalid size');
    }
    return size;
  }

  async downloadBuffer(gcsPath: string): Promise<Buffer> {
    const objectPath = this.toObjectPath(gcsPath);
    const [buffer] = await this.bucket.file(objectPath).download();
    return buffer;
  }

  async getSignedReadUrl(gcsPath: string, expiresInMinutes = 15): Promise<string> {
    const objectPath = this.toObjectPath(gcsPath);
    const [url] = await this.bucket.file(objectPath).getSignedUrl({
      action: 'read',
      expires: Date.now() + expiresInMinutes * 60 * 1000,
    });
    return url;
  }

  async deleteObject(gcsPath: string): Promise<void> {
    const objectPath = this.toObjectPath(gcsPath);
    await this.bucket.file(objectPath).delete({ ignoreNotFound: true });
  }

  private toObjectPath(gcsPath: string): string {
    const prefix = `gs://${this.bucketName}/`;
    if (!gcsPath.startsWith(prefix)) {
      throw new Error(`gcsPath ${gcsPath} does not belong to bucket ${this.bucketName}`);
    }
    return gcsPath.slice(prefix.length);
  }

  private newObjectPath(pathPrefix: 'imports' | 'import-error-reports' | 'vehicle-plate-checks' | 'apk-releases', originalFileName: string): string {
    // Object names are not executed, but normalizing avoids awkward paths and
    // keeps each upload confined to its intended prefix.
    const safeFileName = originalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `${pathPrefix}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFileName}`;
  }
}
