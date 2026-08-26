import { Injectable, NotFoundException } from '@nestjs/common';
import type { Notification, NotificationType } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { ChangeEventsService } from '../events/change-events.service';

const COLLECTION = 'notifications';

@Injectable()
export class NotificationsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async notify(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    linkPath?: string;
  }): Promise<void> {
    const now = nowIso();
    const doc: Omit<Notification, 'id'> = {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      linkPath: input.linkPath,
      read: false,
      createdAt: now,
      updatedAt: now,
    };
    await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);
  }

  async notifyMany(userIds: string[], rest: Omit<Parameters<typeof this.notify>[0], 'userId'>): Promise<void> {
    await Promise.all(userIds.map((userId) => this.notify({ ...rest, userId })));
  }

  async listForUser(userId: string): Promise<Notification[]> {
    const snap = await this.col()
      .where('userId', '==', userId)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get();
    return snap.docs.map((d) => fromDoc<Notification>(d));
  }

  async markRead(id: string, userId: string): Promise<Notification> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Notification not found');
    const notification = fromDoc<Notification>(snap);
    if (notification.userId !== userId) throw new NotFoundException('Notification not found');
    await this.col().doc(id).update({ read: true, updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION);
    return { ...notification, read: true };
  }

  async markAllRead(userId: string): Promise<void> {
    const snap = await this.col().where('userId', '==', userId).where('read', '==', false).get();
    if (snap.empty) return;
    const now = nowIso();
    await this.commitInChunks(snap.docs, (batch, doc) => batch.update(doc.ref, { read: true, updatedAt: now }));
    this.changeEvents.emit(COLLECTION);
  }

  async deleteAll(userId: string): Promise<void> {
    const snap = await this.col().where('userId', '==', userId).get();
    if (snap.empty) return;
    await this.commitInChunks(snap.docs, (batch, doc) => batch.delete(doc.ref));
    this.changeEvents.emit(COLLECTION);
  }

  /** Firestore batches cap out at 500 writes — chunk larger result sets rather than assume every user's notification history stays under that. */
  private async commitInChunks(
    docs: FirebaseFirestore.QueryDocumentSnapshot[],
    apply: (batch: FirebaseFirestore.WriteBatch, doc: FirebaseFirestore.QueryDocumentSnapshot) => void,
  ): Promise<void> {
    for (let i = 0; i < docs.length; i += 500) {
      const batch = this.firestore.batch();
      for (const doc of docs.slice(i, i + 500)) apply(batch, doc);
      await batch.commit();
    }
  }
}
