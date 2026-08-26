import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DisbursementBatchStatus,
  DisbursementEntryStatus,
  LedgerStatus,
  type DisbursementBatch,
  type DisbursementEntry,
  type MonthlyCashbackLedgerEntry,
} from '@loyalty/shared';
import { CashbackLedgersService } from '../cashback-ledgers/cashback-ledgers.service';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import type { StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';
import { DisbursementSettingsService } from '../settings/disbursement-settings.service';

const COLLECTION = 'disbursementBatches';

@Injectable()
export class DisbursementBatchesService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly ledgers: CashbackLedgersService,
    private readonly changeEvents: ChangeEventsService,
    private readonly disbursementSettings: DisbursementSettingsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async list(month?: string): Promise<DisbursementBatch[]> {
    let query = this.col().orderBy('createdAt', 'desc') as FirebaseFirestore.Query;
    if (month) query = query.where('month', '==', month);
    const snap = await query.get();
    return snap.docs.map((d) => fromDoc<DisbursementBatch>(d));
  }

  async findById(id: string): Promise<DisbursementBatch> {
    const snap = await this.col().doc(id).get();
    if (!snap.exists) throw new NotFoundException('Disbursement batch not found');
    return fromDoc<DisbursementBatch>(snap);
  }

  /**
   * Finance creates a batch covering whatever's still owed for the month —
   * the first batch needs the ledger to have been approved at least once;
   * follow-up batches (after a prior one completed/failed/was held) pick up
   * new accrual and anything not yet paid. Only one batch may be in flight
   * (draft/processing) for a month at a time.
   */
  async create(month: string, actor: StaffPrincipal): Promise<DisbursementBatch> {
    const priorBatches = await this.list(month);
    const inFlight = priorBatches[0]; // list() is already sorted createdAt desc
    if (
      inFlight &&
      (inFlight.status === DisbursementBatchStatus.DRAFT || inFlight.status === DisbursementBatchStatus.PROCESSING)
    ) {
      throw new BadRequestException(
        `A disbursement batch for ${month} is already ${inFlight.status} — finish or hold it before creating another`,
      );
    }

    const NEVER_APPROVED_STATUSES = new Set([
      LedgerStatus.OPEN_ACCRUING,
      LedgerStatus.READY_FOR_REVIEW,
      LedgerStatus.SUBMITTED_FOR_APPROVAL,
      LedgerStatus.REJECTED,
    ]);
    let ledger = await this.ledgers.findByMonth(month);
    if (priorBatches.length === 0 && NEVER_APPROVED_STATUSES.has(ledger.status)) {
      throw new BadRequestException(
        `Ledger for ${month} must be approved before a disbursement batch can be created (status: ${ledger.status})`,
      );
    }

    // Pick up sales made since the ledger was last approved/disbursed —
    // recomputeAccrual is safe to call regardless of ledger status.
    ledger = await this.ledgers.recomputeAccrual(month);

    const { minDisbursementAmount } = await this.disbursementSettings.get();
    const belowThreshold: MonthlyCashbackLedgerEntry[] = [];
    const eligible: { entry: MonthlyCashbackLedgerEntry; owed: number }[] = [];
    for (const e of ledger.entries) {
      const owed = round2(e.totalCashback - (e.disbursedAmount ?? 0));
      if (owed <= 0) continue;
      if (owed < minDisbursementAmount) belowThreshold.push({ ...e, totalCashback: owed });
      else eligible.push({ entry: e, owed });
    }

    if (eligible.length === 0) {
      throw new BadRequestException(`Nothing owed for ${month} — every customer is already paid, below threshold, or has no accrual`);
    }

    const entries: DisbursementEntry[] = eligible.map(({ entry: e, owed }) => ({
      customerId: e.customerId,
      customerName: e.customerName,
      customerPhone: e.customerPhone,
      amount: owed,
      status: DisbursementEntryStatus.PENDING,
    }));

    const now = nowIso();
    const doc: Omit<DisbursementBatch, 'id'> = {
      month,
      ledgerId: ledger.id,
      status: DisbursementBatchStatus.DRAFT,
      entries,
      totalAmount: round2(entries.reduce((sum, e) => sum + e.amount, 0)),
      createdByUserId: actor.userId,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await this.col().add(doc);
    await this.ledgers.carryForwardToNextMonth(month, belowThreshold);
    await this.ledgers.setStatus(month, LedgerStatus.DISBURSEMENT_IN_PROGRESS);
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: ref.id };
  }

  /** Finance confirms the batch is correct and ready to be sent to the payment channel. */
  async confirm(id: string, actor: StaffPrincipal): Promise<DisbursementBatch> {
    const batch = await this.findById(id);
    if (batch.status !== DisbursementBatchStatus.DRAFT) {
      throw new BadRequestException(`Batch is not in draft (status: ${batch.status})`);
    }
    const now = nowIso();
    await this.col().doc(id).update({
      confirmedByUserId: actor.userId,
      confirmedAt: now,
      updatedAt: now,
    });
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }

  async markProcessing(id: string): Promise<DisbursementBatch> {
    const batch = await this.findById(id);
    if (!batch.confirmedAt) {
      throw new BadRequestException('Batch must be confirmed before processing');
    }
    await this.col().doc(id).update({ status: DisbursementBatchStatus.PROCESSING, updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }

  /**
   * Marks the batch complete only from confirmed per-entry results — never
   * exposes a batch as disbursed before every entry has an actual outcome.
   */
  async complete(
    id: string,
    entryResults: { customerId: string; status: 'paid' | 'failed'; reference?: string; failureReason?: string }[],
  ): Promise<DisbursementBatch> {
    const batch = await this.findById(id);
    if (batch.status !== DisbursementBatchStatus.PROCESSING) {
      throw new BadRequestException(`Batch must be processing to complete (status: ${batch.status})`);
    }

    const resultByCustomer = new Map(entryResults.map((r) => [r.customerId, r]));
    const entries = batch.entries.map((e) => {
      const result = resultByCustomer.get(e.customerId);
      if (!result) return e;
      return {
        ...e,
        status: result.status === 'paid' ? DisbursementEntryStatus.PAID : DisbursementEntryStatus.FAILED,
        reference: result.reference,
        failureReason: result.failureReason,
      };
    });

    const anyFailed = entries.some((e) => e.status === DisbursementEntryStatus.FAILED);
    const status = anyFailed ? DisbursementBatchStatus.FAILED : DisbursementBatchStatus.COMPLETED;
    const now = nowIso();
    await this.col().doc(id).update({ entries, status, completedAt: now, updatedAt: now });

    const paid = entries
      .filter((e) => e.status === DisbursementEntryStatus.PAID)
      .map((e) => ({ customerId: e.customerId, amount: e.amount }));
    await this.ledgers.recordDisbursedAmounts(batch.month, paid);
    await this.ledgers.setStatus(batch.month, anyFailed ? LedgerStatus.FAILED : LedgerStatus.DISBURSED);
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }

  async hold(id: string, reason: string): Promise<DisbursementBatch> {
    const batch = await this.findById(id);
    await this.col()
      .doc(id)
      .update({ status: DisbursementBatchStatus.HELD, holdReason: reason, updatedAt: nowIso() });
    await this.ledgers.setStatus(batch.month, LedgerStatus.HELD);
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
