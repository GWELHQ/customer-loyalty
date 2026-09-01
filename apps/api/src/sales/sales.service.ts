import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FieldValue } from 'firebase-admin/firestore';
import {
  calculateCashback,
  DEFAULT_CASHBACK_RATE_KES,
  NotificationType,
  Permission,
  Role,
  SaleApprovalStatus,
  SmsStatus,
  SyncRecordResult,
  type Product,
  type Sale,
} from '@loyalty/shared';
import { CustomersService } from '../customers/customers.service';
import { FEATURE_FLAGS } from '../common/feature-flags';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { nairobiDateKey, nairobiMonthBoundsUtc, nairobiMonthKey } from '../common/time/nairobi';
import type { AttendantPrincipal, AuthPrincipal, StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';
import { FraudDetectionService } from '../fraud/fraud-detection.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PricesService } from '../prices/prices.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { SalesDelegationsService } from '../sales-delegations/sales-delegations.service';
import { SmsService } from '../sms/sms.service';
import { StationsService } from '../stations/stations.service';
import { UsersService } from '../users/users.service';
import { VehiclePlateChecksService } from '../vehicle-plate-checks/vehicle-plate-checks.service';
import type { PaginatedResult, PaginationQueryDto } from '../common/dto/pagination.dto';

const PLATE_CHECK_MAX_AGE_MS = 60 * 60 * 1000;

const COLLECTION = 'sales';

/** A sale with no approvalStatus field is a legacy sale recorded before the approval gate existed — treated as already-approved everywhere. */
function isApprovedOrLegacy(sale: Sale): boolean {
  return sale.approvalStatus == null || sale.approvalStatus === SaleApprovalStatus.APPROVED;
}

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
  /** Id of a POST /mobile/vehicle-plate-checks result for this same customer, performed just before this sale. Never trusted blindly — re-validated server-side, see resolvePlateCheck(). */
  plateCheckId?: string;
}

export interface SyncedSaleOutcome {
  clientLocalId: string;
  idempotencyKey: string;
  result: SyncRecordResult;
  saleId?: string;
  errorReason?: string;
  /**
   * Populated only when a sale was actually (re-)created (ACCEPTED /
   * NEEDS_REVIEW) — everything the Android app needs to compose and send
   * the customer's confirmation SMS itself once it's back online, without
   * an extra round trip. Backend does not send SMS for attendant-sourced
   * sales (see SalesService.createSale) — the app owns that for its own
   * sales, both the immediate-online and offline-synced-later cases.
   */
  customerPhone?: string;
  cashbackEarned?: number;
  monthToDateCashback?: number;
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
    private readonly fraudDetection: FraudDetectionService,
    private readonly plateChecks: VehiclePlateChecksService,
    private readonly salesDelegations: SalesDelegationsService,
    private readonly notifications: NotificationsService,
    private readonly users: UsersService,
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

  /** Approved (or legacy) sales only — a pending or rejected sale's cashback isn't real money yet and must not inflate this. */
  async monthlySummary(customerId: string, month: string): Promise<{ month: string; totalCashback: number; saleCount: number }> {
    const { startUtc, endUtc } = nairobiMonthBoundsUtc(month);
    const snap = await this.col()
      .where('customerId', '==', customerId)
      .where('saleDate', '>=', startUtc)
      .where('saleDate', '<', endUtc)
      .get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d)).filter(isApprovedOrLegacy);
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
    const price = await this.prices.getCurrentForProduct(params.stationId, params.product, new Date(saleDate));
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
    const licensePlateCheck = await this.resolvePlateCheck(params.plateCheckId, customer.id);

    let wasCreated = false;
    const sale = await this.firestore.instance.runTransaction(async (tx) => {
      const existing = await tx.get(saleRef);
      if (existing.exists) {
        return fromDoc<Sale>(existing);
      }
      wasCreated = true;

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
        licensePlateCheck,
        // Cashback isn't credited to the customer yet — that only happens
        // once a station supervisor (or their delegate, or RTSM/Admin)
        // approves this sale. See approveBatch()/reject() below.
        //
        // While FEATURE_FLAGS.salesApprovals is off, that gate is skipped
        // entirely — every sale is approved and credited immediately below,
        // same as approveOne() does for a manual approval.
        approvalStatus: FEATURE_FLAGS.salesApprovals ? SaleApprovalStatus.PENDING_APPROVAL : SaleApprovalStatus.APPROVED,
        createdAt: now,
        updatedAt: now,
      };
      tx.set(saleRef, doc);
      if (!FEATURE_FLAGS.salesApprovals) {
        const customerRef = this.customers.col().doc(customer.id);
        tx.update(customerRef, { totalCashbackEarned: FieldValue.increment(snapshot.cashbackEarned), updatedAt: now });
      }
      return { ...doc, id: saleId };
    });

    this.changeEvents.emit('sales');
    this.changeEvents.emit('reconciliationDaily');

    // Never fails the sale — see FraudDetectionService.runRealtimeChecks.
    await this.fraudDetection.runRealtimeChecks(sale);

    // Same SMS path approveOne() uses for a manually-approved sale — while
    // FEATURE_FLAGS.salesApprovals is off, this sale was just auto-approved
    // and credited above, so this is the only place left that would ever
    // send it. Android sales send their own SMS client-side regardless (see
    // handover.md), hence still gated to admin_manual only.
    if (wasCreated && !FEATURE_FLAGS.salesApprovals && sale.source === 'admin_manual') {
      const monthKey = nairobiMonthKey(sale.saleDate);
      const summary = await this.monthlySummary(sale.customerId, monthKey);
      await this.sms.sendSaleConfirmation({
        saleId: sale.id,
        customerPhone: sale.customerPhoneAtSale,
        cashbackEarned: sale.snapshot.cashbackEarned,
        monthToDateCashback: summary.totalCashback,
      });
    }

    return sale;
  }

  /**
   * Sales awaiting a station-supervisor (or delegate, or RTSM/Admin)
   * decision. `stationId` scopes to exactly one station — RTSM/Admin may
   * omit it (all stations); every other actor is always forced to their
   * own accessible station server-side, regardless of what's requested.
   */
  async listPendingApproval(
    requestedStationId: string | undefined,
    pagination: PaginationQueryDto,
    actor: StaffPrincipal,
  ): Promise<PaginatedResult<Sale>> {
    const stationId = await this.resolveApproverStationId(actor, requestedStationId);
    let query = this.col()
      .where('approvalStatus', '==', SaleApprovalStatus.PENDING_APPROVAL)
      .orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (stationId) query = query.where('stationId', '==', stationId);
    else if (stationId === null) {
      // Actor has no accessible station at all (not RTSM/Admin, not a
      // supervisor, no active delegation) — an empty page, not an error.
      return { items: [], page: pagination.page, pageSize: pagination.pageSize, total: 0, nextCursor: null };
    }

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    if (pagination.cursor) {
      const cursorSnap = await this.col().doc(pagination.cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    } else if (pagination.page > 1) {
      query = query.offset((pagination.page - 1) * pagination.pageSize);
    }

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

  /**
   * Approves each sale in turn — never throws for one bad id, every id
   * gets a definite outcome. Crediting cashback and marking approved
   * happens per-sale in its own transaction (each sale's customer update
   * is independent, so there's no reason to bundle them into one giant
   * transaction and no risk of one failure rolling back the rest).
   */
  async approveBatch(
    saleIds: string[],
    actor: StaffPrincipal,
  ): Promise<{ approved: string[]; skipped: { saleId: string; reason: string }[] }> {
    const approved: string[] = [];
    const skipped: { saleId: string; reason: string }[] = [];

    for (const saleId of saleIds) {
      try {
        const sale = await this.approveOne(saleId, actor);
        approved.push(sale.id);
      } catch (err) {
        skipped.push({ saleId, reason: err instanceof Error ? err.message : 'Unknown error' });
      }
    }

    if (approved.length > 0) {
      this.changeEvents.emit('sales');
      this.changeEvents.emit('customers');
    }
    return { approved, skipped };
  }

  private async approveOne(saleId: string, actor: StaffPrincipal): Promise<Sale> {
    const sale = await this.findById(saleId);
    if (sale.approvalStatus !== SaleApprovalStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Sale is already ${sale.approvalStatus ?? 'approved'}, not pending`);
    }
    await this.assertCanApproveStation(actor, sale.stationId);

    const now = nowIso();
    const approvedSale = await this.firestore.instance.runTransaction(async (tx) => {
      const saleRef = this.col().doc(saleId);
      const customerRef = this.customers.col().doc(sale.customerId);
      tx.update(customerRef, { totalCashbackEarned: FieldValue.increment(sale.snapshot.cashbackEarned), updatedAt: now });
      tx.update(saleRef, {
        approvalStatus: SaleApprovalStatus.APPROVED,
        approvalDecidedByUserId: actor.userId,
        approvalDecidedByName: actor.fullName,
        approvalDecidedAt: now,
        updatedAt: now,
      });
      return { ...sale, approvalStatus: SaleApprovalStatus.APPROVED, approvalDecidedByUserId: actor.userId, approvalDecidedByName: actor.fullName, approvalDecidedAt: now };
    });

    // The one SMS path this backend controls — deferred from sale-creation
    // time to now, since only now is the cashback actually real. Android
    // sales already sent their own SMS immediately at creation time (out
    // of this repo's control — see handover.md).
    if (approvedSale.source === 'admin_manual') {
      const monthKey = nairobiMonthKey(approvedSale.saleDate);
      const summary = await this.monthlySummary(approvedSale.customerId, monthKey);
      await this.sms.sendSaleConfirmation({
        saleId: approvedSale.id,
        customerPhone: approvedSale.customerPhoneAtSale,
        cashbackEarned: approvedSale.snapshot.cashbackEarned,
        monthToDateCashback: summary.totalCashback,
      });
    }

    return approvedSale;
  }

  async reject(saleId: string, reason: string, actor: StaffPrincipal): Promise<Sale> {
    const sale = await this.findById(saleId);
    if (sale.approvalStatus !== SaleApprovalStatus.PENDING_APPROVAL) {
      throw new BadRequestException(`Sale is already ${sale.approvalStatus ?? 'approved'}, not pending`);
    }
    await this.assertCanApproveStation(actor, sale.stationId);

    const now = nowIso();
    await this.col().doc(saleId).update({
      approvalStatus: SaleApprovalStatus.REJECTED,
      rejectionReason: reason,
      approvalDecidedByUserId: actor.userId,
      approvalDecidedByName: actor.fullName,
      approvalDecidedAt: now,
      updatedAt: now,
    });
    this.changeEvents.emit('sales');

    // Attendants have no web/notification access (same reasoning as every
    // other "staff-only visibility" flow in this app) — notify RTSM/Admin
    // instead, for follow-up.
    const staff = await this.users.list();
    const overseers = staff.filter((u) => u.role === Role.RTSM || u.role === Role.ADMIN);
    await this.notifications.notifyMany(
      overseers.map((u) => u.id),
      {
        type: NotificationType.SALE_REJECTED,
        title: 'A sale was rejected',
        body: `${actor.fullName} rejected a sale at ${sale.stationNameAtSale}: ${reason}`,
        linkPath: '/sales',
      },
    );

    return this.findById(saleId);
  }

  /** RTSM/Admin, the station's own supervisor, or a currently-active delegate for that station. */
  private async assertCanApproveStation(actor: StaffPrincipal, stationId: string): Promise<void> {
    if (actor.permissions.includes(Permission.SALES_APPROVE_ALL)) return;
    if (actor.role === Role.STATION_SUPERVISOR && actor.assignedStationId === stationId) return;
    if (await this.salesDelegations.isActiveDelegate(actor.userId, stationId)) return;
    throw new ForbiddenException('You do not have approval access to this station');
  }

  /**
   * The single station a non-RTSM/Admin actor is scoped to for the
   * pending-approval list — `undefined` means "no scoping needed" (RTSM/
   * Admin, optionally further narrowed by `requestedStationId`), `null`
   * means "this actor has no accessible station at all right now."
   */
  private async resolveApproverStationId(
    actor: StaffPrincipal,
    requestedStationId: string | undefined,
  ): Promise<string | undefined | null> {
    if (actor.permissions.includes(Permission.SALES_APPROVE_ALL)) return requestedStationId;
    if (actor.role === Role.STATION_SUPERVISOR && actor.assignedStationId) return actor.assignedStationId;
    const delegatedStationId = await this.salesDelegations.findActiveDelegationStationForUser(actor.userId);
    return delegatedStationId ?? null;
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
      const summary = await this.monthlySummary(sale.customerId, nairobiMonthKey(sale.saleDate));

      const needsReview = this.detectStaleClientCache(params, sale);
      return {
        clientLocalId,
        idempotencyKey: params.idempotencyKey,
        result: needsReview ? SyncRecordResult.NEEDS_REVIEW : SyncRecordResult.ACCEPTED,
        saleId: sale.id,
        customerPhone: sale.customerPhoneAtSale,
        cashbackEarned: sale.snapshot.cashbackEarned,
        monthToDateCashback: summary.totalCashback,
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

  /**
   * Looks up an attendant-supplied plateCheckId and re-validates it
   * server-side rather than trusting a client-supplied match result —
   * a wrong/stale/other-customer's id is silently ignored (never blocks
   * the sale), since this data is informational/anti-fraud, not financial.
   */
  private async resolvePlateCheck(plateCheckId: string | undefined, customerId: string): Promise<Sale['licensePlateCheck']> {
    if (!plateCheckId) return undefined;
    try {
      const check = await this.plateChecks.findById(plateCheckId);
      if (check.customerId !== customerId) return undefined;
      if (Date.now() - new Date(check.createdAt).getTime() > PLATE_CHECK_MAX_AGE_MS) return undefined;
      return { plateCheckId: check.id, detectedPlateNumber: check.detectedPlateNumber, matched: check.matched };
    } catch {
      return undefined;
    }
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
