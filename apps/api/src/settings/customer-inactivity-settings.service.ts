import { Injectable } from '@nestjs/common';
import type { CustomerInactivitySettings } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';

const COLLECTION = 'customerInactivitySettings';
const SINGLETON_ID = 'default';

@Injectable()
export class CustomerInactivitySettingsService {
  constructor(private readonly firestore: FirestoreService) {}

  private doc() {
    return this.firestore.collection(COLLECTION).doc(SINGLETON_ID);
  }

  async get(): Promise<CustomerInactivitySettings> {
    const snap = await this.doc().get();
    if (snap.exists) return fromDoc<CustomerInactivitySettings>(snap);
    return this.createDefault();
  }

  private async createDefault(): Promise<CustomerInactivitySettings> {
    const now = nowIso();
    const doc: Omit<CustomerInactivitySettings, 'id'> = {
      noticeAfterDays: 90,
      resetAfterAdditionalDays: 30,
      createdAt: now,
      updatedAt: now,
    };
    await this.doc().set(doc);
    return { ...doc, id: SINGLETON_ID };
  }

  async update(
    input: Partial<Pick<CustomerInactivitySettings, 'noticeAfterDays' | 'resetAfterAdditionalDays'>>,
  ): Promise<CustomerInactivitySettings> {
    await this.get();
    await this.doc().update({ ...input, updatedAt: nowIso() });
    return this.get();
  }
}
