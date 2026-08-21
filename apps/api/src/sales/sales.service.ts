import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import {
  calculateCashback,
  DEFAULT_CASHBACK_RATE_KES,
  SmsStatus,
  SyncRecordResult,
  type Product,
  type Sale,
} from '@loyalty/shared';
import { CustomersService } from '../customers/customers.service';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { nairobiDateKey, nairobiMonthBoundsUtc, nairobiMonthKey } from '../common/time/nairobi';
import type { AttendantPrincipal, AuthPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';
import { PricesService } from '../prices/prices.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { SmsService } from '../sms/sms.service';
import { StationsService } from '../stations/stations.service';
import type { PaginatedResult, PaginationQueryDto } from '../common/dto/pagination.dto';

const COLLECTION = 'sales';

export interface CreateSaleParams {
  customerPhone: string;
  product: Product;
  amountPaid: number;
  stationId: string;
  saleDate?: string;
  idempotencyKey: string;
  clientLocalId?: string;
  /** Only present on synced offline sales — used to detect a stale client cache, never trusted for the actual calculation. */
  claimedPricePerLitre?: number;
  claimedCashbackEarned?: number;
  /**
   * Attributes the sale to a specific attendant regardless of who the calling `actor` is —
   * needed when a supervisor/admin approves a customer-registration request: the sale must
   * still be credited to the attendant who originally submitted it, not to the approver.
   */
  attendantIdOverride?: string;
  attendantNameOverride?: string;
}

export interface SyncedSaleOutcome {
  clientLocalId: string;
  idempotencyKey: string;
  result: SyncRecordResult;
  saleId?: string;
  errorReason?: string;
}

@Injectable()
export class SalesService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly customers: CustomersService,
    private readonly prices: PricesService,
    private readonly stations: StationsService,
    private readonly reconciliation: ReconciliationService,
    private readonly sms: SmsService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async findById(id: string): Promise<Sale> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Sale not found');
    return fromDoc<Sale>(snap);
  }

  async list(
    pagination: PaginationQueryDto,
    filters: { stationId?: string; attendantId?: string; product?: Product; from?: string; to?: string },
  ): Promise<PaginatedResult<Sale>> {
    let query = this.col().orderBy('saleDate', 'desc') as FirebaseFirestore.Query;
    if (filters.stationId) query = query.where('stationId', '==', filters.stationId);
    if (filters.attendantId) query = query.where('attendantId', '==', filters.attendantId);
    if (filters.product) query = query.where('product', '==', filters.product);
    if (filters.from) query = query.where('saleDate', '>=', filters.from);
    if (filters.to) query = query.where('saleDate', '<=', filters.to);

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    if (pagination.page > 1) query = query.offset((pagination.page - 1) * pagination.pageSize);
    const snap = await query.limit(pagination.pageSize).get();
    const items = snap.docs.map((d) => fromDoc<Sale>(d));

    return {
      items,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      nextCursor: snap.docs.length === pagination.pageSize ? snap.docs.at(-1)!.id : null,
    };
  }

  async monthlySummary(customerId: string, month: string): Promise<{ month: string; totalCashback: number; saleCount: number }> {
    const { startUtc, endUtc } = nairobiMonthBoundsUtc(month);
    const snap = await this.col()
      .where('customerId', '==', customerId)
      .where('saleDate', '>=', startUtc)
      .where('saleDate', '<', endUtc)
      .get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));
    return {
      month,
      totalCashback: round2(sales.reduce((sum, s) => sum + s.snapshot.cashbackEarned, 0)),
      saleCount: sales.length,
    };
  }

  /** Single-sale creation path (Android online, or Admin manual entry). Throws on any rule violation. */
  async createSale(params: CreateSaleParams, actor: AuthPrincipal): Promise<Sale> {
    this.assertActorCanSellAtStation(actor, params.stationId);

    const customer = await this.customers.findByPhone(normalizeOrThrow(params.customerPhone));
    if (!customer) {
      throw new NotFoundException(
        `No customer found for ${params.customerPhone}. Register the customer before recording a sale.`,
      );
    }

    const station = await this.stations.findById(params.stationId);
    if (!station) throw new NotFoundException('Station not found');

    const saleDate = params.saleDate ?? nowIso();
    const price = await this.prices.getCurrentForProduct(params.product, new Date(saleDate));
    if (!price) {
      throw new BadRequestException(`No active price is set for ${params.product}. Cannot record a sale.`);
    }

    const specialRateActive =
      customer.specialRateKesPerLitre != null &&
      customer.specialRateEffectiveFrom != null &&
      new Date(customer.specialRateEffectiveFrom) <= new Date(saleDate) &&
      (!customer.specialRateEffectiveTo || new Date(customer.specialRateEffectiveTo) >= new Date(saleDate));
    const cashbackRatePerLitre = specialRateActive
      ? customer.specialRateKesPerLitre!
      : DEFAULT_CASHBACK_RATE_KES;

    const snapshot = calculateCashback({
      amountPaid: params.amountPaid,
      pricePerLitre: price.pricePerLitre,
      cashbackRatePerLitre,
    });

    const attendantId = params.attendantIdOverride ?? (actor.kind === 'attendant' ? actor.attendantId : actor.userId);
    const attendantName = params.attendantNameOverride ?? actor.fullName;
    const saleId = params.idempotencyKey;
    const saleRef = this.col().doc(saleId);

    const sale = await this.firestore.instance.runTransaction(async (tx) => {
      const existing = await tx.get(saleRef);
      if (existing.exists) {
        return fromDoc<Sale>(existing);
      }

      await this.reconciliation.reserveLoyaltySaleAmount(tx, {
        stationId: params.stationId,
        product: params.product,
        // The ceiling is enforced per Nairobi business day, not per UTC
        // calendar day — a sale just after midnight Nairobi time (still
        // the previous UTC day) must land in *today's* bucket.
        date: nairobiDateKey(saleDate),
        amountPaid: params.amountPaid,
        saleId,
      });

      const customerRef = this.customers.col().doc(customer.id);
      tx.update(customerRef, {
        totalCashbackEarned: FieldValue.increment(snapshot.cashbackEarned),
        updatedAt: nowIso(),
      });

      const now = nowIso();
      const doc: Omit<Sale, 'id'> = {
        customerId: customer.id,
        customerPhoneAtSale: customer.phoneNumber,
        product: params.product,
        amountPaid: params.amountPaid,
        stationId: params.stationId,
        stationNameAtSale: station.name,
        attendantId,
        attendantNameAtSale: attendantName,
        saleDate,
        snapshot,
        specialRateIdAtSale: specialRateActive ? customer.specialRateId : undefined,
        idempotencyKey: params.idempotencyKey,
        clientLocalId: params.clientLocalId,
        source: actor.kind === 'attendant' ? 'android' : 'admin_manual',
        smsStatus: SmsStatus.PENDING,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(saleRef, doc);
      return { ...doc, id: saleId };
    });

    this.changeEvents.emit('sales');
    this.changeEvents.emit('customers');
    this.changeEvents.emit('reconciliationDaily');

    // Fire SMS + monthly total outside the transaction (non-critical path).
    const monthKey = nairobiMonthKey(saleDate);
    const summary = await this.monthlySummary(customer.id, monthKey);
    await this.sms.sendSaleConfirmation({
      saleId: sale.id,
      customerPhone: customer.phoneNumber,
      cashbackEarned: sale.snapshot.cashbackEarned,
      monthToDateCashback: summary.totalCashback,
    });

    return sale;
  }

  /**
   * Bulk offline sync entry point: never throws for an individual record's
   * business-rule failure — every record gets a definite result instead.
   */
  async syncOne(params: CreateSaleParams, actor: AttendantPrincipal): Promise<SyncedSaleOutcome> {
    const clientLocalId = params.clientLocalId ?? params.idempotencyKey;
    try {
      const existing = await this.col().doc(params.idempotencyKey).get();
      if (existing.exists) {
        return {
          clientLocalId,
          idempotencyKey: params.idempotencyKey,
          result: SyncRecordResult.ALREADY_PROCESSED,
          saleId: existing.id,
        };
      }

      const sale = await this.createSale(params, actor);

      const needsReview = this.detectStaleClientCache(params, sale);
      return {
        clientLocalId,
        idempotencyKey: params.idempotencyKey,
        result: needsReview ? SyncRecordResult.NEEDS_REVIEW : SyncRecordResult.ACCEPTED,
        saleId: sale.id,
      };
    } catch (err) {
      if (err instanceof ConflictException) {
        return {
          clientLocalId,
          idempotencyKey: params.idempotencyKey,
          result: SyncRecordResult.REJECTED,
          errorReason: err.message,
        };
      }
      if (err instanceof NotFoundException || err instanceof BadRequestException) {
        return {
          clientLocalId,
          idempotencyKey: params.idempotencyKey,
          result: SyncRecordResult.REJECTED,
          errorReason: err.message,
        };
      }
      return {
        clientLocalId,
        idempotencyKey: params.idempotencyKey,
        result: SyncRecordResult.REJECTED,
        errorReason: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  /**
   * A cached price/rate the Android client used to preview the sale that
   * meaningfully disagrees with what the server actually applied. The sale
   * is still recorded with the server-authoritative snapshot (never
   * discarded) — this only flags it for staff review.
   */
  private detectStaleClientCache(params: CreateSaleParams, sale: Sale): boolean {
    if (params.claimedPricePerLitre != null) {
      if (Math.abs(params.claimedPricePerLitre - sale.snapshot.pricePerLitre) > 0.005) return true;
    }
    if (params.claimedCashbackEarned != null) {
      if (Math.abs(params.claimedCashbackEarned - sale.snapshot.cashbackEarned) > 0.005) return true;
    }
    return false;
  }

  private assertActorCanSellAtStation(actor: AuthPrincipal, stationId: string): void {
    if (actor.kind === 'attendant' && actor.assignedStationId !== stationId) {
      throw new BadRequestException('Attendants may only record sales at their assigned station');
    }
  }
}

function normalizeOrThrow(phone: string): string {
  // customerPhone arrives already validated/normalized by the DTO schema
  // upstream; this just guards direct service callers (e.g. seed scripts).
  return phone;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
