import { Injectable } from '@nestjs/common';
import { DEFAULT_TIMEZONE, type PriceReminderSetting } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';

const COLLECTION = 'priceReminderSettings';
const SINGLETON_ID = 'default';

@Injectable()
export class PriceRemindersService {
  constructor(private readonly firestore: FirestoreService) {}

  private doc() {
    return this.firestore.collection(COLLECTION).doc(SINGLETON_ID);
  }

  async get(): Promise<PriceReminderSetting> {
    const snap = await this.doc().get();
    if (snap.exists) return fromDoc<PriceReminderSetting>(snap);
    return this.createDefault();
  }

  private async createDefault(): Promise<PriceReminderSetting> {
    const now = nowIso();
    const doc: Omit<PriceReminderSetting, 'id'> = {
      enabled: true,
      dayOfMonth: 27,
      hourOfDay: 8,
      timezone: DEFAULT_TIMEZONE,
      recipientEmails: [],
      nextReminderAt: computeNextReminderAt(27, 8, DEFAULT_TIMEZONE),
      createdAt: now,
      updatedAt: now,
    };
    await this.doc().set(doc);
    return { ...doc, id: SINGLETON_ID };
  }

  async update(
    input: Partial<Pick<PriceReminderSetting, 'enabled' | 'dayOfMonth' | 'hourOfDay' | 'recipientEmails'>>,
  ): Promise<PriceReminderSetting> {
    const current = await this.get();
    const merged = { ...current, ...input };
    const nextReminderAt = computeNextReminderAt(merged.dayOfMonth, merged.hourOfDay, merged.timezone);
    await this.doc().update({ ...input, nextReminderAt, updatedAt: nowIso() });
    return this.get();
  }

  async markSent(): Promise<void> {
    const current = await this.get();
    await this.doc().update({
      lastSentAt: nowIso(),
      nextReminderAt: computeNextReminderAt(current.dayOfMonth, current.hourOfDay, current.timezone),
      updatedAt: nowIso(),
    });
  }
}

/**
 * Computes the next occurrence of dayOfMonth/hourOfDay at or after now.
 * Timezone offset handling is simplified to Africa/Nairobi's fixed UTC+3
 * (no DST) — fine for this domain's single-timezone deployment.
 */
export function computeNextReminderAt(dayOfMonth: number, hourOfDay: number, _timezone: string): string {
  const now = new Date();
  const eatOffsetMinutes = 3 * 60;
  const candidate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), dayOfMonth, hourOfDay, 0, 0) -
      eatOffsetMinutes * 60_000,
  );
  if (candidate <= now) {
    candidate.setUTCMonth(candidate.getUTCMonth() + 1);
  }
  return candidate.toISOString();
}
