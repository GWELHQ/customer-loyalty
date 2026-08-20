import { Injectable } from '@nestjs/common';
import type { SyncOperation } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import type { SyncedSaleOutcome } from '../sales/sales.service';

const COLLECTION = 'syncOperations';

/** Persists a durable record of every offline-sync attempt for audit and Android-side result polling. */
@Injectable()
export class SyncOperationsService {
  constructor(private readonly firestore: FirestoreService) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async record(attendantId: string, outcome: SyncedSaleOutcome): Promise<void> {
    const now = nowIso();
    const doc: Omit<SyncOperation, 'id'> = {
      attendantId,
      clientLocalId: outcome.clientLocalId,
      idempotencyKey: outcome.idempotencyKey,
      result: outcome.result,
      saleId: outcome.saleId,
      errorReason: outcome.errorReason,
      createdAt: now,
      updatedAt: now,
    };
    await this.col().add(doc);
  }

  async recentForAttendant(attendantId: string, limit = 50): Promise<SyncOperation[]> {
    const snap = await this.col()
      .where('attendantId', '==', attendantId)
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();
    return snap.docs.map((d) => fromDoc<SyncOperation>(d));
  }
}
