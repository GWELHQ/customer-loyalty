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
   * Finance creates one batch **per station** covering whatever's still
   * owed for the month — a customer who earned cashback at two stations
   * gets an entry in each station's batch, never one combined batch. The
   * first run needs the ledger to have been approved at least once;
   * follow-up runs (after a prior batch completed/failed/was held) pick up
   * new accrual and anything not yet paid. Only one batch may be in flight
   * (draft/processing) per station at a time — a station already in flight
   * is silently skipped rather than erroring, so this can always be
   * re-run to pick up whichever stations are ready.
   */
  async create(month: string, actor: StaffPrincipal): Promise<DisbursementBatch[]> {
    const priorBatches = await this.list(month);
    const inFlightStationIds = new Set(
      priorBatches
        .filter((b) => b.status === DisbursementBatchStatus.DRAFT || b.status === DisbursementBatchStatus.PROCESSING)
        .map((b) => b.stationId),
    );

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
    const byStation = new Map<
      string,
      { stationName: string; eligible: { entry: MonthlyCashbackLedgerEntry; owed: number }[]; belowThreshold: MonthlyCashbackLedgerEntry[] }
    >();
    for (const e of ledger.entries) {
      const owed = round2(e.totalCashback - (e.disbursedAmount ?? 0));
      if (owed <= 0) continue;
      let bucket = byStation.get(e.stationId);
      if (!bucket) {
        bucket = { stationName: e.stationName, eligible: [], belowThreshold: [] };
        byStation.set(e.stationId, bucket);
      }
      if (owed < minDisbursementAmount) bucket.belowThreshold.push({ ...e, totalCashback: owed });
      else bucket.eligible.push({ entry: e, owed });
    }

    const now = nowIso();
    const createdBatches: DisbursementBatch[] = [];
    const allBelowThreshold: MonthlyCashbackLedgerEntry[] = [];
    for (const [stationId, bucket] of byStation) {
      if (inFlightStationIds.has(stationId)) continue; // already has a batch in flight — its carry-forward already happened when that batch was created

      allBelowThreshold.push(...bucket.belowThreshold);
      if (bucket.eligible.length === 0) continue; // nothing new to pay this station right now

      const entries: DisbursementEntry[] = bucket.eligible.map(({ entry: e, owed }) => ({
        customerId: e.customerId,
        customerName: e.customerName,
        customerPhone: e.customerPhone,
        amount: owed,
        status: DisbursementEntryStatus.PENDING,
      }));

      const doc: Omit<DisbursementBatch, 'id'> = {
        month,
        stationId,
        stationName: bucket.stationName,
        ledgerId: ledger.id,
        status: DisbursementBatchStatus.DRAFT,
        entries,
        totalAmount: round2(entries.reduce((sum, e) => sum + e.amount, 0)),
        createdByUserId: actor.userId,
        createdAt: now,
        updatedAt: now,
      };
      const ref = await this.col().add(doc);
      createdBatches.push({ ...doc, id: ref.id });
    }

    if (createdBatches.length === 0) {
      throw new BadRequestException(
        `Nothing new to disburse for ${month} — every station is already in flight, fully paid, or below threshold`,
      );
    }

    await this.ledgers.carryForwardToNextMonth(month, allBelowThreshold);
    await this.recomputeLedgerDisbursementStatus(month);
    this.changeEvents.emit(COLLECTION);
    return createdBatches;
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
      .map((e) => ({ customerId: e.customerId, stationId: batch.stationId, amount: e.amount }));
    await this.ledgers.recordDisbursedAmounts(batch.month, paid);
    await this.recomputeLedgerDisbursementStatus(batch.month);
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }

  async hold(id: string, reason: string): Promise<DisbursementBatch> {
    const batch = await this.findById(id);
    await this.col()
      .doc(id)
      .update({ status: DisbursementBatchStatus.HELD, holdReason: reason, updatedAt: nowIso() });
    await this.recomputeLedgerDisbursementStatus(batch.month);
    this.changeEvents.emit(COLLECTION);
    return this.findById(id);
  }

  /**
   * A month's ledger status is now an aggregate across every station's
   * batch — held takes priority (needs a human to look at it), then
   * failed, then still-in-flight, and only once every station's batch has
   * completed does the whole month read as disbursed.
   */
  private async recomputeLedgerDisbursementStatus(month: string): Promise<void> {
    const batches = await this.list(month);
    if (batches.length === 0) return;
    const status = batches.some((b) => b.status === DisbursementBatchStatus.HELD)
      ? LedgerStatus.HELD
      : batches.some((b) => b.status === DisbursementBatchStatus.FAILED)
        ? LedgerStatus.FAILED
        : batches.every((b) => b.status === DisbursementBatchStatus.COMPLETED)
          ? LedgerStatus.DISBURSED
          : LedgerStatus.DISBURSEMENT_IN_PROGRESS;
    await this.ledgers.setStatus(month, status);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
