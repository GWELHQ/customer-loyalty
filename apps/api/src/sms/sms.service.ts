import { Inject, Injectable, Logger } from '@nestjs/common';
import { SmsStatus, type SmsDelivery } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { SMS_PROVIDER, type SmsProvider } from './sms-provider.interface';

const COLLECTION = 'smsDeliveries';
const MAX_RETRIES = 3;

@Injectable()
export class SmsService {
  private readonly logger = new Logger('SmsService');

  constructor(
    private readonly firestore: FirestoreService,
    @Inject(SMS_PROVIDER) private readonly provider: SmsProvider,
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
    const message = `Green Wells: You earned KSh ${input.cashbackEarned} cashback. Your total this month is KSh ${input.monthToDateCashback}.`;
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
    await this.attemptSend(ref.id, { ...doc, id: ref.id });
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
      await this.col()
        .doc(id)
        .update({
          status: result.success ? SmsStatus.SENT : SmsStatus.FAILED,
          providerResponse: result.providerResponse,
          errorReason: result.errorReason,
          retryCount: delivery.retryCount + 1,
          sentAt: result.success ? nowIso() : null,
          updatedAt: nowIso(),
        });
    } catch (err) {
      this.logger.error(`SMS send failed for delivery ${id}`, err instanceof Error ? err.stack : err);
      await this.col().doc(id).update({
        status: SmsStatus.FAILED,
        errorReason: err instanceof Error ? err.message : 'Unknown error',
        retryCount: delivery.retryCount + 1,
        updatedAt: nowIso(),
      });
    }
  }
}
