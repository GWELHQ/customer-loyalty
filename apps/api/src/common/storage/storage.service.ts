import { Injectable, OnModuleInit } from '@nestjs/common';
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
}
