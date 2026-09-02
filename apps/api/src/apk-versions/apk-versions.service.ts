import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { ApkVersion } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { StorageService } from '../common/storage/storage.service';
import type { StaffPrincipal } from '../common/types/principal';

const COLLECTION = 'apkVersions';

@Injectable()
export class ApkVersionsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly storage: StorageService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async list(): Promise<ApkVersion[]> {
    const snap = await this.col().orderBy('versionCode', 'desc').get();
    return snap.docs.map((d) => fromDoc<ApkVersion>(d));
  }

  async findById(id: string): Promise<ApkVersion> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('App version not found');
    return fromDoc<ApkVersion>(snap);
  }

  /** The version currently served by the public /apk download button — null if none has been marked yet. */
  async getCurrentRelease(): Promise<ApkVersion | null> {
    const snap = await this.col().where('isRelease', '==', true).limit(1).get();
    return snap.empty ? null : fromDoc<ApkVersion>(snap.docs[0]!);
  }

  async create(
    input: { versionName: string; versionCode: number; features: string[]; fixes: string[] },
    file: { originalname: string; buffer: Buffer; mimetype: string },
    actor: StaffPrincipal,
  ): Promise<ApkVersion> {
    const existing = await this.col().where('versionCode', '==', input.versionCode).limit(1).get();
    if (!existing.empty) {
      throw new BadRequestException(`Version code ${input.versionCode} already exists`);
    }

    const gcsPath = await this.storage.uploadBuffer('apk-releases', file.originalname, file.buffer, file.mimetype);

    const now = nowIso();
    const doc: Omit<ApkVersion, 'id'> = {
      versionName: input.versionName,
      versionCode: input.versionCode,
      features: input.features,
      fixes: input.fixes,
      fileName: file.originalname,
      gcsPath,
      fileSizeBytes: file.buffer.length,
      isRelease: false,
      uploadedByUserId: actor.userId,
      uploadedByName: actor.fullName,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    return { ...doc, id: ref.id };
  }

  /**
   * Marks one version as the release the public /apk page serves —
   * unsetting whatever was previously marked. Also how a rollback works:
   * marking an older version release again immediately makes it the one
   * users download.
   */
  async markRelease(id: string): Promise<ApkVersion> {
    await this.findById(id);
    const now = nowIso();
    await this.firestore.instance.runTransaction(async (tx) => {
      const currentlyReleased = await tx.get(this.col().where('isRelease', '==', true));
      for (const doc of currentlyReleased.docs) {
        if (doc.id !== id) tx.update(doc.ref, { isRelease: false, updatedAt: now });
      }
      tx.update(this.col().doc(id), { isRelease: true, updatedAt: now });
    });
    return this.findById(id);
  }

  async delete(id: string): Promise<void> {
    const version = await this.findById(id);
    if (version.isRelease) {
      throw new BadRequestException('Cannot delete the current release version — mark a different version as the release first');
    }
    await this.col().doc(id).delete();
    await this.storage.deleteObject(version.gcsPath);
  }
}
