import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FraudFlagStatus,
  type FraudFlag,
  type FraudFlagSeverity,
  type FraudFlagType,
  type PaginatedResult,
  type Sale,
} from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import type { StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';

const COLLECTION = 'fraudFlags';
const PAGE_SIZE = 50;

export interface CreateFraudFlagInput {
  type: FraudFlagType;
  severity: FraudFlagSeverity;
  customerId?: string;
  customerNameAtFlag?: string;
  stationId?: string;
  stationNameAtFlag?: string;
  attendantId?: string;
  attendantNameAtFlag?: string;
  relatedSaleIds: string[];
  periodStart?: string;
  periodEnd?: string;
  detectionMode: 'realtime' | 'batch';
  evidence: Record<string, unknown>;
}

@Injectable()
export class FraudFlagsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async list(
    filters: { type?: FraudFlagType; status?: FraudFlagStatus; stationId?: string; customerId?: string; search?: string },
    cursor?: string,
  ): Promise<PaginatedResult<FraudFlag>> {
    let query = this.col().orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (filters.type) query = query.where('type', '==', filters.type);
    if (filters.status) query = query.where('status', '==', filters.status);
    if (filters.stationId) query = query.where('stationId', '==', filters.stationId);
    if (filters.customerId) query = query.where('customerId', '==', filters.customerId);

    const needle = filters.search?.trim().toLowerCase();
    if (needle) {
      // Matched against every flag that satisfies the structural filters
      // above, not just the current cursor page — customerNameAtFlag/
      // attendantNameAtFlag are already denormalized onto the doc, so no
      // extra lookups are needed, unlike sales' customer-name search.
      const snap = await query.get();
      const all = await this.withAttendants(snap.docs.map((d) => fromDoc<FraudFlag>(d)));
      const matches = all.filter((f) =>
        `${f.customerNameAtFlag ?? ''} ${f.attendantNameAtFlag ?? ''} ${(f.attendantNamesAtFlag ?? []).join(' ')}`
          .toLowerCase()
          .includes(needle),
      );
      return { items: matches, page: 1, pageSize: matches.length, total: matches.length, nextCursor: null };
    }

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    if (cursor) {
      const cursorSnap = await this.col().doc(cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.limit(PAGE_SIZE).get();
    const items = await this.withAttendants(snap.docs.map((d) => fromDoc<FraudFlag>(d)));

    return {
      items,
      page: 1,
      pageSize: PAGE_SIZE,
      total,
      nextCursor: snap.docs.length === PAGE_SIZE ? snap.docs.at(-1)!.id : null,
    };
  }

  async findById(id: string): Promise<FraudFlag> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Fraud flag not found');
    const [flag] = await this.withAttendants([fromDoc<FraudFlag>(snap)]);
    return flag!;
  }

  /** De-duplicated sales assistants across the given sales, in first-seen order. */
  private async attendantsForSales(saleIds: string[]): Promise<{ ids: string[]; names: string[] }> {
    const unique = [...new Set(saleIds)];
    const sales = (
      await Promise.all(unique.map((id) => this.firestore.collection('sales').doc(id).get()))
    )
      .filter((d) => d.exists)
      .map((d) => fromDoc<Sale>(d));
    const byId = new Map<string, string>();
    for (const sale of sales) if (!byId.has(sale.attendantId)) byId.set(sale.attendantId, sale.attendantNameAtSale);
    return { ids: [...byId.keys()], names: [...byId.values()] };
  }

  /**
   * Flags created before attendants were tracked on every flag type lack
   * attendantNamesAtFlag; derive it from their related sales and persist it
   * so each legacy flag is only resolved once.
   */
  private async withAttendants(flags: FraudFlag[]): Promise<FraudFlag[]> {
    const legacy = flags.filter((f) => f.attendantNamesAtFlag === undefined && f.relatedSaleIds.length > 0);
    for (let i = 0; i < legacy.length; i += 5) {
      await Promise.all(
        legacy.slice(i, i + 5).map(async (flag) => {
          try {
            const { ids, names } = await this.attendantsForSales(flag.relatedSaleIds);
            flag.attendantIds = ids;
            flag.attendantNamesAtFlag = names;
            await this.col().doc(flag.id).update({ attendantIds: ids, attendantNamesAtFlag: names });
          } catch {
            // Best effort — the flag still renders with its single attendantNameAtFlag.
          }
        }),
      );
    }
    return flags;
  }

  /**
   * Sale ids (out of the given set) that have at least one fraud flag —
   * resolved/dismissed included, this answers "was this sale ever flagged",
   * not "is it still open". Used to color flagged sales in the audit log.
   */
  async findSaleIdsWithFlags(saleIds: string[]): Promise<Set<string>> {
    const unique = [...new Set(saleIds)];
    if (unique.length === 0) return new Set();

    // array-contains-any accepts at most 30 values per query.
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));

    const flagged = new Set<string>();
    const snaps = await Promise.all(
      chunks.map((chunk) => this.col().where('relatedSaleIds', 'array-contains-any', chunk).get()),
    );
    for (const snap of snaps) {
      for (const doc of snap.docs) {
        const flag = fromDoc<FraudFlag>(doc);
        for (const saleId of flag.relatedSaleIds) {
          if (unique.includes(saleId)) flagged.add(saleId);
        }
      }
    }
    return flagged;
  }

  /**
   * True if an open/under-review flag of this type already exists for the
   * given subject (a customer or an attendant). Once a flag is
   * resolved/dismissed it no longer matches, so the same irregularity can
   * be re-flagged later if it recurs after review.
   */
  async hasOpenFlag(type: FraudFlagType, subject: { customerId?: string; attendantId?: string }): Promise<boolean> {
    let query = this.col()
      .where('type', '==', type)
      .where('status', 'in', [FraudFlagStatus.OPEN, FraudFlagStatus.UNDER_REVIEW]) as FirebaseFirestore.Query;
    if (subject.customerId) query = query.where('customerId', '==', subject.customerId);
    if (subject.attendantId) query = query.where('attendantId', '==', subject.attendantId);
    const snap = await query.limit(1).get();
    return !snap.empty;
  }

  async create(input: CreateFraudFlagInput): Promise<FraudFlag> {
    const now = nowIso();
    const { ids, names } = await this.attendantsForSales(input.relatedSaleIds).catch(() => ({ ids: [], names: [] }));
    const doc: Omit<FraudFlag, 'id'> = {
      ...input,
      attendantIds: ids,
      attendantNamesAtFlag: names,
      status: FraudFlagStatus.OPEN,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: ref.id };
  }

  async startReview(id: string, reviewer: StaffPrincipal): Promise<FraudFlag> {
    const flag = await this.findById(id);
    if (flag.status !== FraudFlagStatus.OPEN) {
      throw new BadRequestException(`Flag is already ${flag.status}, not open`);
    }
    await this.col().doc(id).update({
      status: FraudFlagStatus.UNDER_REVIEW,
      reviewedByUserId: reviewer.userId,
      reviewedByName: reviewer.fullName,
      reviewedAt: nowIso(),
      updatedAt: nowIso(),
    });
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }

  async decide(
    id: string,
    decision: 'resolved' | 'dismissed',
    note: string | undefined,
    reviewer: StaffPrincipal,
  ): Promise<FraudFlag> {
    const flag = await this.findById(id);
    if (flag.status === FraudFlagStatus.RESOLVED || flag.status === FraudFlagStatus.DISMISSED) {
      throw new BadRequestException(`Flag is already ${flag.status}`);
    }
    const status = decision === 'resolved' ? FraudFlagStatus.RESOLVED : FraudFlagStatus.DISMISSED;
    await this.col().doc(id).update({
      status,
      resolutionNote: note,
      reviewedByUserId: reviewer.userId,
      reviewedByName: reviewer.fullName,
      reviewedAt: nowIso(),
      updatedAt: nowIso(),
    });
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }
}
