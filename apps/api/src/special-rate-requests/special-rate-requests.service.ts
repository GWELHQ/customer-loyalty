import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Role, SpecialRateStatus, type SpecialRateRequest } from '@loyalty/shared';
import { CustomersService } from '../customers/customers.service';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import type { StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';

const COLLECTION = 'specialRateRequests';

@Injectable()
export class SpecialRateRequestsService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly customers: CustomersService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async list(status?: SpecialRateStatus): Promise<SpecialRateRequest[]> {
    let query = this.col().orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (status) query = query.where('status', '==', status);
    const snap = await query.get();
    return snap.docs.map((d) => fromDoc<SpecialRateRequest>(d));
  }

  async findById(id: string): Promise<SpecialRateRequest> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Special rate request not found');
    return fromDoc<SpecialRateRequest>(snap);
  }

  async create(
    input: {
      customerId: string;
      proposedKesPerLitre: number;
      effectiveFrom: string;
      effectiveTo?: string;
      reason: string;
    },
    requestedBy: StaffPrincipal,
  ): Promise<SpecialRateRequest> {
    await this.customers.findById(input.customerId); // 404s if missing

    // The Chairman is also the approver, so a Chairman-initiated request
    // has no one left to wait on — it's created already approved and the
    // rate is applied immediately, instead of sitting in the pending queue.
    const isChairman = requestedBy.role === Role.CHAIRMAN;
    const now = nowIso();
    const doc: Omit<SpecialRateRequest, 'id'> = {
      customerId: input.customerId,
      proposedKesPerLitre: input.proposedKesPerLitre,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo,
      reason: input.reason,
      requestedByUserId: requestedBy.userId,
      requestedByName: requestedBy.fullName,
      status: isChairman ? SpecialRateStatus.APPROVED : SpecialRateStatus.PENDING,
      createdAt: now,
      updatedAt: now,
      ...(isChairman
        ? {
            decidedByUserId: requestedBy.userId,
            decidedByName: requestedBy.fullName,
            decidedAt: now,
          }
        : {}),
    };
    const ref = await this.col().add(doc);
    this.changeEvents.emit(COLLECTION);

    if (isChairman) {
      await this.customers.applySpecialRate(input.customerId, {
        specialRateId: ref.id,
        kesPerLitre: input.proposedKesPerLitre,
        effectiveFrom: input.effectiveFrom,
        effectiveTo: input.effectiveTo,
      });
    }

    return { ...doc, id: ref.id };
  }

  /**
   * Chairman-only decision. Only a pending request may be decided, and the
   * decision itself is an immutable audit event on the request document —
   * existing sales keep whatever rate snapshot they already recorded.
   */
  async decide(
    id: string,
    decision: 'approved' | 'rejected',
    decisionNote: string | undefined,
    decidedBy: StaffPrincipal,
  ): Promise<SpecialRateRequest> {
    const request = await this.findById(id);
    if (request.status !== SpecialRateStatus.PENDING) {
      throw new BadRequestException(`Request is already ${request.status}, not pending`);
    }

    const status = decision === 'approved' ? SpecialRateStatus.APPROVED : SpecialRateStatus.REJECTED;
    const now = nowIso();
    await this.col().doc(id).update({
      status,
      decisionNote,
      decidedByUserId: decidedBy.userId,
      decidedByName: decidedBy.fullName,
      decidedAt: now,
      updatedAt: now,
    });
    this.changeEvents.emit(COLLECTION);

    if (status === SpecialRateStatus.APPROVED) {
      await this.customers.applySpecialRate(request.customerId, {
        specialRateId: id,
        kesPerLitre: request.proposedKesPerLitre,
        effectiveFrom: request.effectiveFrom,
        effectiveTo: request.effectiveTo,
      });
    }

    return this.findById(id);
  }

  assertCanApprove(user: StaffPrincipal): void {
    // Defense in depth: PermissionsGuard already enforces this at the
    // route level via Permission.SPECIAL_RATES_APPROVE (Chairman only).
    if (user.role !== Role.CHAIRMAN) {
      throw new ForbiddenException('Only the Chairman may approve or reject special rate requests');
    }
  }
}
