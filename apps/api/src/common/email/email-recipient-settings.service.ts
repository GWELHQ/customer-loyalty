import { Injectable } from '@nestjs/common';
import type { EmailRecipientList, EmailRecipientSettings, SystemEmailType } from '@loyalty/shared';
import { FirestoreService } from '../firestore/firestore.service';
import { fromDoc, nowIso } from '../firestore/helpers';

const COLLECTION = 'emailRecipientSettings';
const SINGLETON_ID = 'default';

export function normalizeEmails(emails: string[] | undefined): string[] {
  return [...new Set((emails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))];
}

/** Extra To/CC recipients per system email type, set on the Email recipients settings page. */
@Injectable()
export class EmailRecipientSettingsService {
  constructor(private readonly firestore: FirestoreService) {}

  private doc() {
    return this.firestore.collection(COLLECTION).doc(SINGLETON_ID);
  }

  async get(): Promise<EmailRecipientSettings> {
    const snap = await this.doc().get();
    if (snap.exists) return fromDoc<EmailRecipientSettings>(snap);
    const now = nowIso();
    return { id: SINGLETON_ID, byType: {}, createdAt: now, updatedAt: now };
  }

  async extrasFor(type: SystemEmailType): Promise<EmailRecipientList> {
    const entry = (await this.get()).byType[type];
    return { to: entry?.to ?? [], cc: entry?.cc ?? [] };
  }

  async update(type: SystemEmailType, input: { to?: string[]; cc?: string[] }): Promise<EmailRecipientList> {
    const to = normalizeEmails(input.to);
    // An address in both lists only needs to be in To.
    const cc = normalizeEmails(input.cc).filter((e) => !to.includes(e));
    const now = nowIso();
    const snap = await this.doc().get();
    if (snap.exists) {
      // Field-path update so saving one type never overwrites another saved concurrently.
      await this.doc().update({ [`byType.${type}`]: { to, cc }, updatedAt: now });
    } else {
      await this.doc().set({ byType: { [type]: { to, cc } }, createdAt: now, updatedAt: now });
    }
    return { to, cc };
  }
}
