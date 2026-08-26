import { Injectable } from '@nestjs/common';
import type { DisbursementSettings } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';

const COLLECTION = 'disbursementSettings';
const SINGLETON_ID = 'default';

@Injectable()
export class DisbursementSettingsService {
  constructor(private readonly firestore: FirestoreService) {}

  private doc() {
    return this.firestore.collection(COLLECTION).doc(SINGLETON_ID);
  }

  async get(): Promise<DisbursementSettings> {
    const snap = await this.doc().get();
    if (snap.exists) return fromDoc<DisbursementSettings>(snap);
    return this.createDefault();
  }

  private async createDefault(): Promise<DisbursementSettings> {
    const now = nowIso();
    const doc: Omit<DisbursementSettings, 'id'> = {
      minDisbursementAmount: 0,
      createdAt: now,
      updatedAt: now,
    };
    await this.doc().set(doc);
    return { ...doc, id: SINGLETON_ID };
  }

  async update(input: Partial<Pick<DisbursementSettings, 'minDisbursementAmount'>>): Promise<DisbursementSettings> {
    await this.get();
    await this.doc().update({ ...input, updatedAt: nowIso() });
    return this.get();
  }
}
