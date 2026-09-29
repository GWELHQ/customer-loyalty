import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SmsStatus, type PaginatedResult, type SmsDelivery } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { ChangeEventsService } from '../events/change-events.service';
import { SMS_PROVIDER, type SmsProvider } from './sms-provider.interface';

const COLLECTION = 'smsDeliveries';
const MAX_RETRIES = 3;
const PAGE_SIZE = 50;
// SMS deliveries grow forever, so a text search can't realistically scan the
// entire history — this caps how far back (by row count, most recent first)
// a search looks, trading "the whole table" for "everything recent enough
// to plausibly be what someone's searching for."
const SEARCH_SCAN_LIMIT = 5000;

/**
 * Canonical sale-confirmation SMS text — shared by the backend send path
 * and the Android app (which composes the same message for its own direct
 * send; the Android team must mirror this text and the "skip when
 * cashbackEarned is 0" rule below, since that path bypasses SmsService
 * entirely — see docs/ANDROID-HANDOVER.md). Amounts are rounded to whole
 * KES — cashback is always a whole-litre multiple of a KES-denominated
 * rate, and `amountPaid` is customer-entered cash, so neither carries cents
 * worth showing. `amountPaid` is this sale's own amount, not a cumulative
 * figure — `monthToDateCashback` is the only running total in the message.
 */
export function buildSaleConfirmationMessage(input: {
  amountPaid: number;
  cashbackEarned: number;
  monthToDateCashback: number;
}): string {
  return `Green Wells: You paid KES ${Math.round(input.amountPaid)} and earned KES ${Math.round(input.cashbackEarned)} cashback. Your total cashback this month is KES ${Math.round(input.monthToDateCashback)}.`;
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
   * No SMS (and no delivery record at all) when the sale earned zero
   * cashback — nothing worth texting the customer about.
   */
  async sendSaleConfirmation(input: {
    saleId: string;
    customerPhone: string;
    amountPaid: number;
    cashbackEarned: number;
    monthToDateCashback: number;
  }): Promise<void> {
    if (input.cashbackEarned === 0) {
      await this.firestore
        .collection('sales')
        .doc(input.saleId)
        .update({ smsStatus: SmsStatus.NOT_APPLICABLE, updatedAt: nowIso() });
      return;
    }
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
   * Sends a customer inactivity reset notice — same delivery/log shape as a
   * sale-confirmation SMS, but with no saleId (nothing to sync a sale's
   * smsStatus against). A failure here is picked up by the same hourly
   * retry sweep as everything else in smsDeliveries.
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
  async list(cursor?: string, filters: { status?: SmsStatus; search?: string } = {}): Promise<PaginatedResult<SmsDelivery>> {
    let query = this.col().orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (filters.status) query = query.where('status', '==', filters.status);

    const needle = filters.search?.trim().toLowerCase();
    if (needle) {
      // Matched against every recent delivery satisfying the status filter
      // above, not just the current cursor page — see SEARCH_SCAN_LIMIT.
      const snap = await query.limit(SEARCH_SCAN_LIMIT).get();
      const matches = snap.docs
        .map((d) => fromDoc<SmsDelivery>(d))
        .filter((d) => `${d.customerPhone} ${d.message}`.toLowerCase().includes(needle));
      return { items: matches, page: 1, pageSize: matches.length, total: matches.length, nextCursor: null };
    }

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

  /**
   * Hourly sweep that retries every PENDING delivery (stuck mid-send, e.g.
   * from a crash between creating the record and reaching the provider —
   * uncapped, since it never actually attempted a send) and every FAILED
   * delivery still under MAX_RETRIES. Runs sequentially, not in parallel,
   * to stay well under the SMS provider's own rate limit during a sweep
   * that could cover a large batch at once.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async retryPendingAndFailed(): Promise<void> {
    const [pendingSnap, failedSnap] = await Promise.all([
      this.col().where('status', '==', SmsStatus.PENDING).get(),
      this.col().where('status', '==', SmsStatus.FAILED).get(),
    ]);
    const candidates = [
      ...pendingSnap.docs.map((d) => fromDoc<SmsDelivery>(d)),
      ...failedSnap.docs.map((d) => fromDoc<SmsDelivery>(d)).filter((d) => d.retryCount < MAX_RETRIES),
    ];
    if (candidates.length === 0) return;

    this.logger.log(`Hourly SMS retry sweep: retrying ${candidates.length} pending/failed delivery(ies)`);
    for (const delivery of candidates) {
      await this.attemptSend(delivery.id, delivery);
    }
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
