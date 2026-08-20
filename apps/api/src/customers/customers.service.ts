import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { normalizePhoneNumber, type Customer } from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import type { PaginatedResult, PaginationQueryDto } from '../common/dto/pagination.dto';

const COLLECTION = 'customers';

@Injectable()
export class CustomersService {
  constructor(private readonly firestore: FirestoreService) {}

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

  async create(input: {
    fullName: string;
    phoneNumber: string;
    homeStationId?: string;
    source?: Customer['source'];
  }): Promise<Customer> {
    const normalized = normalizePhoneNumber(input.phoneNumber);
    const existing = await this.findByPhone(normalized);
    if (existing) {
      throw new ConflictException(`A customer with phone ${normalized} already exists`);
    }

    const now = nowIso();
    const doc: Omit<Customer, 'id'> = {
      fullName: input.fullName,
      phoneNumber: normalized,
      homeStationId: input.homeStationId,
      totalCashbackEarned: 0,
      source: input.source ?? 'manual',
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    return { ...doc, id: ref.id };
  }

  async update(
    id: string,
    input: Partial<Pick<Customer, 'fullName' | 'homeStationId'>>,
  ): Promise<Customer> {
    await this.findById(id);
    await this.col()
      .doc(id)
      .update({ ...input, updatedAt: nowIso() });
    return this.findById(id);
  }

  /** Applies a special rate to a customer once Chairman-approved. Never called directly by RTSM. */
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
  }

  async incrementCashback(id: string, amount: number): Promise<void> {
    await this.firestore.instance.runTransaction(async (tx) => {
      const ref = this.col().doc(id);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new BadRequestException('Customer not found');
      const current = (snap.data()?.totalCashbackEarned as number) ?? 0;
      tx.update(ref, { totalCashbackEarned: current + amount, updatedAt: nowIso() });
    });
  }
}
