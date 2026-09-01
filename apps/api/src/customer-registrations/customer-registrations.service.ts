import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  calculateCashback,
  DEFAULT_CASHBACK_RATE_KES,
  normalizePhoneNumber,
  CustomerRegistrationStatus,
  Role,
  type CustomerRegistrationRequest,
  type Product,
} from '@loyalty/shared';
import { CustomersService } from '../customers/customers.service';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { ChangeEventsService } from '../events/change-events.service';
import { PricesService } from '../prices/prices.service';
import { SalesService } from '../sales/sales.service';
import { StationsService } from '../stations/stations.service';
import type { AttendantPrincipal, StaffPrincipal } from '../common/types/principal';

const COLLECTION = 'customerRegistrationRequests';

export interface SubmitCustomerRegistrationParams {
  customerFullName: string;
  customerPhoneNumber: string;
  product: Product;
  amountPaid: number;
  saleDate?: string;
  idempotencyKey: string;
}

@Injectable()
export class CustomerRegistrationsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly customers: CustomersService,
    private readonly stations: StationsService,
    private readonly prices: PricesService,
    private readonly sales: SalesService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async list(filters: { status?: CustomerRegistrationStatus; stationId?: string }): Promise<CustomerRegistrationRequest[]> {
    let query = this.col().orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (filters.status) query = query.where('status', '==', filters.status);
    if (filters.stationId) query = query.where('stationId', '==', filters.stationId);
    const snap = await query.get();
    return snap.docs.map((d) => fromDoc<CustomerRegistrationRequest>(d));
  }

  async findById(id: string): Promise<CustomerRegistrationRequest> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Customer registration request not found');
    return fromDoc<CustomerRegistrationRequest>(snap);
  }

  /**
   * Submitted by an attendant recording a sale for a phone number that
   * isn't a customer yet. Nothing is written to `customers` or `sales`
   * here — only a pending request a Station Supervisor/RTSM/Admin later
   * approves or rejects. idempotencyKey is the Firestore doc ID, same
   * offline-safe-retry pattern as a normal sale.
   */
  async submit(params: SubmitCustomerRegistrationParams, actor: AttendantPrincipal): Promise<CustomerRegistrationRequest> {
    const ref = this.col().doc(params.idempotencyKey);
    const existing = await ref.get();
    if (existing.exists) return fromDoc<CustomerRegistrationRequest>(existing);

    const normalizedPhone = normalizePhoneNumber(params.customerPhoneNumber);
    const existingCustomer = await this.customers.findByPhone(normalizedPhone);
    if (existingCustomer) {
      throw new ConflictException(
        `A customer with phone ${normalizedPhone} already exists — record a normal sale instead of a new registration.`,
      );
    }

    const station = await this.stations.findById(actor.assignedStationId);
    if (!station) throw new NotFoundException('Station not found');

    const saleDate = params.saleDate ?? nowIso();
    const price = await this.prices.getCurrentForProduct(actor.assignedStationId, params.product, new Date(saleDate));
    if (!price) {
      throw new BadRequestException(`No active price is set for ${params.product}. Cannot record a sale.`);
    }

    // A brand-new customer has no special rate yet — that always requires
    // an existing customer record plus Chairman approval, so this is
    // always the default rate.
    const snapshot = calculateCashback({
      amountPaid: params.amountPaid,
      pricePerLitre: price.pricePerLitre,
      cashbackRatePerLitre: DEFAULT_CASHBACK_RATE_KES,
    });

    const now = nowIso();
    const doc: Omit<CustomerRegistrationRequest, 'id'> = {
      stationId: actor.assignedStationId,
      stationNameAtRequest: station.name,
      attendantId: actor.attendantId,
      attendantNameAtRequest: actor.fullName,
      customerFullName: params.customerFullName,
      customerPhoneNumber: normalizedPhone,
      product: params.product,
      amountPaid: params.amountPaid,
      saleDate,
      snapshot,
      idempotencyKey: params.idempotencyKey,
      status: CustomerRegistrationStatus.PENDING,
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(doc);
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: params.idempotencyKey };
  }

  /**
   * Approving materializes the customer and the sale using the *original*
   * saleDate — this reuses SalesService.createSale as-is, so pricing is
   * looked up as of that date (not now), and every other sale guarantee
   * (reconciliation ceiling, cashback increment, SMS, idempotency) applies
   * unchanged. Rejecting creates nothing; the stored snapshot was preview
   * only.
   */
  async decide(
    id: string,
    decision: 'approved' | 'rejected',
    decisionNote: string | undefined,
    decidedBy: StaffPrincipal,
  ): Promise<CustomerRegistrationRequest> {
    this.assertCanDecide(decidedBy);
    const request = await this.findById(id);
    if (request.status !== CustomerRegistrationStatus.PENDING) {
      throw new BadRequestException(`Request is already ${request.status}, not pending`);
    }
    if (decidedBy.role === Role.STATION_SUPERVISOR && decidedBy.assignedStationId !== request.stationId) {
      throw new ForbiddenException('You do not have access to this station');
    }

    const now = nowIso();

    if (decision === 'rejected') {
      await this.col().doc(id).update({
        status: CustomerRegistrationStatus.REJECTED,
        decisionNote,
        decidedByUserId: decidedBy.userId,
        decidedByName: decidedBy.fullName,
        decidedAt: now,
        updatedAt: now,
      });
      this.changeEvents.emit(COLLECTION);
      return this.findById(id);
    }

    const alreadyRegistered = await this.customers.findByPhone(request.customerPhoneNumber);
    if (alreadyRegistered) {
      throw new ConflictException(
        `A customer with phone ${request.customerPhoneNumber} was already registered separately — reject this request instead.`,
      );
    }

    const customer = await this.customers.create({
      fullName: request.customerFullName,
      phoneNumber: request.customerPhoneNumber,
      homeStationId: request.stationId,
      source: 'android',
    });

    const sale = await this.sales.createSale(
      {
        customerPhone: customer.phoneNumber,
        product: request.product,
        amountPaid: request.amountPaid,
        stationId: request.stationId,
        saleDate: request.saleDate,
        idempotencyKey: request.idempotencyKey,
        // Credit the sale to the attendant who originally submitted the registration, not to
        // whichever supervisor/admin approves it — otherwise the sale never shows up under that
        // attendant's own `/mobile/sales/mine` (it's scoped strictly to attendantId).
        attendantIdOverride: request.attendantId,
        attendantNameOverride: request.attendantNameAtRequest,
      },
      decidedBy,
    );

    await this.col().doc(id).update({
      status: CustomerRegistrationStatus.APPROVED,
      decisionNote,
      decidedByUserId: decidedBy.userId,
      decidedByName: decidedBy.fullName,
      decidedAt: now,
      customerId: customer.id,
      saleId: sale.id,
      updatedAt: now,
    });
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }

  assertCanDecide(user: StaffPrincipal): void {
    // Defense in depth: PermissionsGuard already enforces
    // CUSTOMER_REGISTRATIONS_APPROVE at the route level.
    if (!([Role.ADMIN, Role.RTSM, Role.STATION_SUPERVISOR] as string[]).includes(user.role)) {
      throw new ForbiddenException('You may not approve or reject customer registration requests');
    }
  }
}
