import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePhoneNumber, type Customer } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { normalizeNfcTagId } from '../common/nfc/normalize-nfc-tag-id';
import type { PaginatedResult, PaginationQueryDto } from '../common/dto/pagination.dto';
import { ChangeEventsService } from '../events/change-events.service';

const COLLECTION = 'customers';

@Injectable()
export class CustomersService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  col() {
    return this.firestore.collection(COLLECTION);
  }

  async findById(id: string): Promise<Customer> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Customer not found');
    return fromDoc<Customer>(snap);
  }

  async findByPhone(normalizedPhone: string): Promise<Customer | null> {
    const snap = await this.col().where('phoneNumber', '==', normalizedPhone).limit(1).get();
    return snap.empty ? null : fromDoc<Customer>(snap.docs[0]!);
  }

  async findByNfcTagId(tagId: string): Promise<Customer | null> {
    const snap = await this.col().where('nfcTagId', '==', normalizeNfcTagId(tagId)).limit(1).get();
    return snap.empty ? null : fromDoc<Customer>(snap.docs[0]!);
  }

  /**
   * Batched lookup for bulk-import classification — Firestore's `in`
   * clause takes up to 30 values, so this fans a large phone list out into
   * parallel chunked queries instead of one round-trip per number.
   */
  async findManyByPhone(normalizedPhones: string[]): Promise<Map<string, Customer>> {
    const unique = [...new Set(normalizedPhones)];
    const result = new Map<string, Customer>();
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));

    const snaps = await Promise.all(chunks.map((c) => this.col().where('phoneNumber', 'in', c).get()));
    for (const snap of snaps) {
      for (const doc of snap.docs) {
        const customer = fromDoc<Customer>(doc);
        result.set(customer.phoneNumber, customer);
      }
    }
    return result;
  }

  async searchByPhone(rawOrPartialPhone: string): Promise<Customer[]> {
    // Exact match on the normalized number is the primary path (Android
    // attendant search). Fall back to a prefix scan for partial digit
    // entry in the admin UI.
    try {
      const normalized = normalizePhoneNumber(rawOrPartialPhone);
      const exact = await this.findByPhone(normalized);
      if (exact) return [exact];
    } catch {
      // not a fully valid number yet — fall through to prefix search
    }
    const digits = rawOrPartialPhone.replace(/[^\d]/g, '');
    if (digits.length < 4) return [];
    const prefix = digits.startsWith('254') ? `+${digits}` : `+254${digits.replace(/^0/, '')}`;
    const snap = await this.col()
      .where('phoneNumber', '>=', prefix)
      .where('phoneNumber', '<=', prefix + '')
      .limit(20)
      .get();
    return snap.docs.map((d) => fromDoc<Customer>(d));
  }

  async list(
    pagination: PaginationQueryDto,
    filters: { name?: string; stationId?: string },
  ): Promise<PaginatedResult<Customer>> {
    let query = this.col().orderBy('fullName') as FirebaseFirestore.Query;
    if (filters.stationId) query = query.where('homeStationId', '==', filters.stationId);

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    if (pagination.cursor) {
      const cursorSnap = await this.col().doc(pagination.cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    } else if (pagination.page > 1) {
      query = query.offset((pagination.page - 1) * pagination.pageSize);
    }

    const snap = await query.limit(pagination.pageSize).get();
    let items = snap.docs.map((d) => fromDoc<Customer>(d));

    if (filters.name) {
      const needle = filters.name.toLowerCase();
      items = items.filter((c) => c.fullName.toLowerCase().includes(needle));
    }

    return {
      items,
      page: pagination.page,
      pageSize: pagination.pageSize,
      total,
      nextCursor: snap.docs.length === pagination.pageSize ? snap.docs.at(-1)!.id : null,
    };
  }

  /**
   * Full/incremental customer sync for the Android app (`GET
   * /mobile/customers`) — unscoped by station (loyalty customers aren't
   * station-locked) and, unlike `list()`, skips the `count()` call since
   * the mobile client doesn't need a total. Ordered by `updatedAt` rather
   * than `fullName`: with `updatedSince` set, Firestore requires the first
   * `orderBy` to match the field used in the range filter, and ordering by
   * `updatedAt` unconditionally (even for a full pull) keeps one query
   * shape and avoids a second composite index.
   */
  async listForMobile(params: { cursor?: string; limit: number; updatedSince?: string }): Promise<{
    items: Customer[];
    nextCursor: string | null;
  }> {
    let query = this.col() as FirebaseFirestore.Query;
    if (params.updatedSince) query = query.where('updatedAt', '>', params.updatedSince);
    query = query.orderBy('updatedAt');

    if (params.cursor) {
      const cursorSnap = await this.col().doc(params.cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.limit(params.limit).get();
    const items = snap.docs.map((d) => fromDoc<Customer>(d));
    return {
      items,
      nextCursor: snap.docs.length === params.limit ? snap.docs.at(-1)!.id : null,
    };
  }

  async create(input: {
    fullName: string;
    phoneNumber: string;
    homeStationId?: string;
    source?: Customer['source'];
    licensePlateNumbers?: string[];
    nfcTagId?: string;
  }): Promise<Customer> {
    const normalized = normalizePhoneNumber(input.phoneNumber);
    const existing = await this.findByPhone(normalized);
    if (existing) {
      throw new ConflictException(`A customer with phone ${normalized} already exists`);
    }
    if (input.nfcTagId) await this.assertNfcTagAvailable(input.nfcTagId);

    const now = nowIso();
    const doc: Omit<Customer, 'id'> = {
      fullName: input.fullName,
      phoneNumber: normalized,
      homeStationId: input.homeStationId,
      totalCashbackEarned: 0,
      source: input.source ?? 'manual',
      licensePlateNumbers: input.licensePlateNumbers?.length ? normalizeLicensePlates(input.licensePlateNumbers) : undefined,
      nfcTagId: input.nfcTagId ? normalizeNfcTagId(input.nfcTagId) : undefined,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: ref.id };
  }

  async update(
    id: string,
    input: Partial<Pick<Customer, 'fullName' | 'homeStationId' | 'licensePlateNumbers' | 'nfcTagId'>>,
  ): Promise<Customer> {
    await this.findById(id);
    const patch: Record<string, unknown> = { ...input, updatedAt: nowIso() };
    if (input.licensePlateNumbers !== undefined) {
      patch.licensePlateNumbers = input.licensePlateNumbers.length ? normalizeLicensePlates(input.licensePlateNumbers) : null;
    }
    if (input.nfcTagId !== undefined) {
      if (input.nfcTagId) await this.assertNfcTagAvailable(input.nfcTagId, id);
      patch.nfcTagId = input.nfcTagId ? normalizeNfcTagId(input.nfcTagId) : null;
    }
    await this.col().doc(id).update(patch);
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }

  /** Throws if the given NFC tag is already assigned to a different customer. */
  private async assertNfcTagAvailable(tagId: string, excludingCustomerId?: string): Promise<void> {
    const existing = await this.findByNfcTagId(tagId);
    if (existing && existing.id !== excludingCustomerId) {
      throw new ConflictException(`NFC tag ${normalizeNfcTagId(tagId)} is already assigned to another customer`);
    }
  }

  /** Applies a special rate to a customer once Chairman-approved (or Chairman-initiated). Never called directly by RTSM. */
  async applySpecialRate(
    id: string,
    rate: { specialRateId: string; kesPerLitre: number; effectiveFrom: string; effectiveTo?: string },
  ): Promise<void> {
    await this.col().doc(id).update({
      specialRateId: rate.specialRateId,
      specialRateKesPerLitre: rate.kesPerLitre,
      specialRateEffectiveFrom: rate.effectiveFrom,
      specialRateEffectiveTo: rate.effectiveTo ?? null,
      updatedAt: nowIso(),
    });
    this.changeEvents.emit(COLLECTION);
  }

  /** Removes an active special rate, reverting the customer to the default cashback rate. Only called from SpecialRateRequestsService.revoke(). */
  async clearSpecialRate(id: string): Promise<void> {
    await this.col().doc(id).update({
      specialRateId: null,
      specialRateKesPerLitre: null,
      specialRateEffectiveFrom: null,
      specialRateEffectiveTo: null,
      updatedAt: nowIso(),
    });
    this.changeEvents.emit(COLLECTION);
  }

  async delete(id: string): Promise<Customer> {
    const customer = await this.findById(id);
    await this.col().doc(id).delete();
    this.changeEvents.emit(COLLECTION);
    return customer;
  }

  async incrementCashback(id: string, amount: number): Promise<void> {
    const now = nowIso();
    await this.firestore.instance.runTransaction(async (tx) => {
      const ref = this.col().doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new BadRequestException('Customer not found');
      const current = (snap.data()?.totalCashbackEarned as number) ?? 0;
      // A fresh sale is activity — clears any pending inactivity notice so
      // the next inactivity check starts counting from this sale, not the
      // stale notice from before.
      tx.update(ref, {
        totalCashbackEarned: current + amount,
        lastActivityAt: now,
        inactivityNoticeSentAt: null,
        updatedAt: now,
      });
    });
    this.changeEvents.emit(COLLECTION);
  }

  /** Zeroes a customer's lifetime cashback total after sustained inactivity. Only called by the inactivity job. */
  async resetInactiveCashback(id: string): Promise<void> {
    await this.col().doc(id).update({
      totalCashbackEarned: 0,
      inactivityNoticeSentAt: null,
      updatedAt: nowIso(),
    });
    this.changeEvents.emit(COLLECTION);
  }

  /**
   * Customers with lastActivityAt older than the cutoff and no notice sent
   * yet — candidates for an inactivity SMS notice.
   */
  async findDueForInactivityNotice(cutoffIso: string): Promise<Customer[]> {
    const snap = await this.col()
      .where('lastActivityAt', '<', cutoffIso)
      .where('inactivityNoticeSentAt', '==', null)
      .get();
    return snap.docs.map((d) => fromDoc<Customer>(d));
  }

  /** Customers notified long enough ago that continued inactivity now triggers a reset. */
  async findDueForInactivityReset(noticeCutoffIso: string): Promise<Customer[]> {
    const snap = await this.col()
      .where('inactivityNoticeSentAt', '!=', null)
      .where('inactivityNoticeSentAt', '<', noticeCutoffIso)
      .get();
    return snap.docs.map((d) => fromDoc<Customer>(d));
  }

  async markInactivityNoticeSent(id: string): Promise<void> {
    await this.col().doc(id).update({ inactivityNoticeSentAt: nowIso(), updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION);
  }
}

/** Uppercase, strip everything but letters/digits — so "kaa 123b" / "KAA-123-B" / "KAA123B" all compare equal. */
export function normalizeLicensePlate(plate: string): string {
  return plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Normalizes a list of plates, drops blanks, and dedupes — a customer having the same plate listed twice is a no-op, not two vehicles. */
export function normalizeLicensePlates(plates: string[]): string[] {
  return [...new Set(plates.map(normalizeLicensePlate).filter(Boolean))];
}

