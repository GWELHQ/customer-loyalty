import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  FraudFlagStatus,
  type FraudFlag,
  type FraudFlagSeverity,
  type FraudFlagType,
  type PaginatedResult,
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
    filters: { type?: FraudFlagType; status?: FraudFlagStatus; stationId?: string; customerId?: string },
    cursor?: string,
  ): Promise<PaginatedResult<FraudFlag>> {
    let query = this.col().orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (filters.type) query = query.where('type', '==', filters.type);
    if (filters.status) query = query.where('status', '==', filters.status);
    if (filters.stationId) query = query.where('stationId', '==', filters.stationId);
    if (filters.customerId) query = query.where('customerId', '==', filters.customerId);

    const countSnap = await query.count().get();
    const total = countSnap.data().count;

    if (cursor) {
      const cursorSnap = await this.col().doc(cursor).get();
      if (cursorSnap.exists) query = query.startAfter(cursorSnap);
    }

    const snap = await query.limit(PAGE_SIZE).get();
    const items = snap.docs.map((d) => fromDoc<FraudFlag>(d));

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
    return fromDoc<FraudFlag>(snap);
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
    const doc: Omit<FraudFlag, 'id'> = {
      ...input,
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
