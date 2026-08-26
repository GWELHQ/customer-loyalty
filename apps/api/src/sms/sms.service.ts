import { Inject, Injectable, Logger } from '@nestjs/common';
import { SmsStatus, type PaginatedResult, type SmsDelivery } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { ChangeEventsService } from '../events/change-events.service';
import { SMS_PROVIDER, type SmsProvider } from './sms-provider.interface';

const COLLECTION = 'smsDeliveries';
const MAX_RETRIES = 3;
const PAGE_SIZE = 50;

/** Canonical sale-confirmation SMS text — shared by the backend send path and the Android app (which composes the same message for its own direct send). */
export function buildSaleConfirmationMessage(input: { cashbackEarned: number; monthToDateCashback: number }): string {
  return `Green Wells: You earned KSh ${input.cashbackEarned} cashback. Your total this month is KSh ${input.monthToDateCashback}.`;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger('SmsService');

  constructor(
    private readonly firestore: FirestoreService,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  /**
   * Creates the delivery record and attempts the send. Sale success is
   * always independent of SMS outcome — this never throws back to the
   * caller; failures just leave the delivery in FAILED for later retry.
   */
  async sendSaleConfirmation(input: {
    saleId: string;
    customerPhone: string;
    cashbackEarned: number;
    monthToDateCashback: number;
  }): Promise<void> {
    const message = buildSaleConfirmationMessage(input);
    const now = nowIso();
    const doc: Omit<SmsDelivery, 'id'> = {
      saleId: input.saleId,
      customerPhone: input.customerPhone,
      message,
      status: SmsStatus.PENDING,
      providerName: this.provider.name,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);
    await this.attemptSend(ref.id, { ...doc, id: ref.id });
  }

  /**
   * Sends a customer inactivity reset notice — same delivery/log/retry
   * shape as a sale-confirmation SMS, but with no saleId (nothing to sync
   * a sale's smsStatus against) and no retry beyond the provider's own result.
   */
  async sendInactivityNotice(input: { customerPhone: string; message: string }): Promise<void> {
    const now = nowIso();
    const doc: Omit<SmsDelivery, 'id'> = {
      customerPhone: input.customerPhone,
      message: input.message,
      status: SmsStatus.PENDING,
      providerName: this.provider.name,
      retryCount: 0,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);
    try {
      const result = await this.provider.send(input.customerPhone, input.message);
      await this.col()
        .doc(ref.id)
        .update({
          status: result.success ? SmsStatus.SENT : SmsStatus.FAILED,
          providerResponse: result.providerResponse,
          errorReason: result.errorReason,
          retryCount: 1,
          sentAt: result.success ? nowIso() : null,
          updatedAt: nowIso(),
        });
    } catch (err) {
      this.logger.error(`Inactivity notice SMS failed for ${input.customerPhone}`, err instanceof Error ? err.stack : err);
      await this.col().doc(ref.id).update({
        status: SmsStatus.FAILED,
        errorReason: err instanceof Error ? err.message : 'Unknown error',
        retryCount: 1,
        updatedAt: nowIso(),
      });
    }
    this.changeEvents.emit(COLLECTION);
  }

  /** Every SMS ever sent (or attempted), newest first — powers the Logs page's SMS tab. */
  async list(cursor?: string): Promise<PaginatedResult<SmsDelivery>> {
    let query = this.col().orderBy('createdAt', 'desc') as FirebaseFirestore.Query;

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    if (cursor) {
      const cursorSnap = await this.col().doc(cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.limit(PAGE_SIZE).get();
    const items = snap.docs.map((d) => fromDoc<SmsDelivery>(d));

    return {
      items,
      page: 1,
      pageSize: PAGE_SIZE,
      total,
      nextCursor: snap.docs.length === PAGE_SIZE ? snap.docs.at(-1)!.id : null,
    };
  }

  async retry(saleId: string): Promise<SmsDelivery | null> {
    const snap = await this.col().where('saleId', '==', saleId).limit(1).get();
    if (snap.empty) return null;
    const delivery = fromDoc<SmsDelivery>(snap.docs[0]!);
    await this.attemptSend(delivery.id, delivery);
    return this.getBySaleId(saleId);
  }

  async getBySaleId(saleId: string): Promise<SmsDelivery | null> {
    const snap = await this.col().where('saleId', '==', saleId).limit(1).get();
    return snap.empty ? null : fromDoc<SmsDelivery>(snap.docs[0]!);
  }

  private async attemptSend(id: string, delivery: SmsDelivery): Promise<void> {
    if (delivery.retryCount >= MAX_RETRIES && delivery.status === SmsStatus.FAILED) {
      return;
    }
    try {
      const result = await this.provider.send(delivery.customerPhone, delivery.message);
      await this.applyOutcome(id, delivery.saleId, result.success, {
        providerResponse: result.providerResponse,
        errorReason: result.errorReason,
        retryCount: delivery.retryCount + 1,
      });
    } catch (err) {
      this.logger.error(`SMS send failed for delivery ${id}`, err instanceof Error ? err.stack : err);
      await this.applyOutcome(id, delivery.saleId, false, {
        errorReason: err instanceof Error ? err.message : 'Unknown error',
        retryCount: delivery.retryCount + 1,
      });
    }
  }

  private async applyOutcome(
    deliveryId: string,
    saleId: string | undefined,
    success: boolean,
    extra: { providerResponse?: string; errorReason?: string; retryCount: number },
  ): Promise<void> {
    const now = nowIso();
    const status = success ? SmsStatus.SENT : SmsStatus.FAILED;
    await this.col().doc(deliveryId).update({
      status,
      providerResponse: extra.providerResponse,
      errorReason: extra.errorReason,
      retryCount: extra.retryCount,
      sentAt: success ? now : null,
      updatedAt: now,
    });
    if (!saleId) return;
    // Keep the sale's own smsStatus (shown in the web app's Sales table) in
    // sync — it's a denormalized read shortcut, the smsDeliveries doc above
    // is the source of truth.
    await this.firestore.collection('sales').doc(saleId).update({ smsStatus: status, updatedAt: now });
    this.changeEvents.emit(COLLECTION);
  }

  /**
   * Records the outcome of an SMS the *caller* sent directly (e.g. the
   * Android app calling Africa's Talking itself for an attendant-recorded
   * sale, instead of this backend sending it) — same audit trail and same
   * `sale.smsStatus` sync as a backend-initiated send, just without this
   * service having made the provider call itself.
   */
  async recordExternalOutcome(input: {
    saleId: string;
    customerPhone: string;
    message: string;
    success: boolean;
    providerName: string;
    providerResponse?: string;
    errorReason?: string;
  }): Promise<SmsDelivery> {
    const now = nowIso();
    const doc: Omit<SmsDelivery, 'id'> = {
      saleId: input.saleId,
      customerPhone: input.customerPhone,
      message: input.message,
      status: input.success ? SmsStatus.SENT : SmsStatus.FAILED,
      providerName: input.providerName,
      providerResponse: input.providerResponse,
      errorReason: input.errorReason,
      retryCount: 0,
      sentAt: input.success ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    await this.firestore
      .collection('sales')
      .doc(input.saleId)
      .update({ smsStatus: doc.status, updatedAt: now });
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: ref.id };
  }
}
