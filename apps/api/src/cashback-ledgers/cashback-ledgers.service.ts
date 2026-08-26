import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LedgerStatus,
  type MonthlyCashbackLedger,
  type MonthlyCashbackLedgerEntry,
  type Sale,
} from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { nairobiMonthBoundsUtc } from '../common/time/nairobi';
import type { StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';

const COLLECTION = 'monthlyCashbackLedgers';

@Injectable()
export class CashbackLedgersService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
  ) {}

  private col() {
    return this.firestore.collection(COLLECTION);
  }

  async list(): Promise<MonthlyCashbackLedger[]> {
    const snap = await this.col().orderBy('month', 'desc').get();
    return snap.docs.map((d) => fromDoc<MonthlyCashbackLedger>(d));
  }

  /** Returns the ledger for a month, computing/refreshing its entries from sales while it's still open_accruing. */
  async getOrCreate(month: string): Promise<MonthlyCashbackLedger> {
    const snap = await this.col().doc(month).get();
    if (!snap.exists) {
      return this.recompute(month);
    }
    const ledger = fromDoc<MonthlyCashbackLedger>(snap);
    if (ledger.status === LedgerStatus.OPEN_ACCRUING) {
      return this.recompute(month);
    }
    return ledger;
  }

  private async recompute(month: string): Promise<MonthlyCashbackLedger> {
    const existingSnap = await this.col().doc(month).get();
    const existing = existingSnap.exists ? fromDoc<MonthlyCashbackLedger>(existingSnap) : undefined;
    return this.recomputeFrom(month, existing, { status: LedgerStatus.OPEN_ACCRUING });
  }

  /**
   * Re-sums sales for the month and folds in carried-forward/disbursed
   * bookkeeping from the existing doc, without touching ledger status or
   * approval/submission audit fields — safe to call after a ledger has
   * left open_accruing, e.g. right before creating a follow-up disbursement
   * batch that needs to see sales made since the ledger was approved.
   */
  async recomputeAccrual(month: string): Promise<MonthlyCashbackLedger> {
    const existing = await this.findByMonth(month);
    return this.recomputeFrom(month, existing, {});
  }

  private async recomputeFrom(
    month: string,
    existing: MonthlyCashbackLedger | undefined,
    statusOverride: { status?: LedgerStatus },
  ): Promise<MonthlyCashbackLedger> {
    const { startUtc, endUtc } = nairobiMonthBoundsUtc(month);
    const snap = await this.firestore
      .collection('sales')
      .where('saleDate', '>=', startUtc)
      .where('saleDate', '<', endUtc)
      .get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));

    const byCustomer = new Map<string, MonthlyCashbackLedgerEntry>();
    for (const sale of sales) {
      const entry = byCustomer.get(sale.customerId);
      if (entry) {
        entry.eligibleSalesCount += 1;
        entry.totalCashback = round2(entry.totalCashback + sale.snapshot.cashbackEarned);
      } else {
        byCustomer.set(sale.customerId, {
          customerId: sale.customerId,
          customerName: '', // resolved in a batch below
          customerPhone: sale.customerPhoneAtSale,
          eligibleSalesCount: 1,
          totalCashback: sale.snapshot.cashbackEarned,
        });
      }
    }

    // Carried-forward and already-disbursed bookkeeping persist on the
    // ledger doc itself, since sales don't carry that memory — fold them
    // back in on every recompute so they survive re-fetches.
    for (const prior of existing?.entries ?? []) {
      if (!prior.carriedForwardAmount && !prior.disbursedAmount) continue;
      let entry = byCustomer.get(prior.customerId);
      if (!entry) {
        entry = {
          customerId: prior.customerId,
          customerName: '',
          customerPhone: prior.customerPhone,
          eligibleSalesCount: 0,
          totalCashback: 0,
        };
        byCustomer.set(prior.customerId, entry);
      }
      if (prior.carriedForwardAmount) {
        entry.totalCashback = round2(entry.totalCashback + prior.carriedForwardAmount);
        entry.carriedForwardAmount = prior.carriedForwardAmount;
        entry.carriedForwardFromMonth = prior.carriedForwardFromMonth;
      }
      if (prior.disbursedAmount) {
        entry.disbursedAmount = prior.disbursedAmount;
      }
    }

    // Resolve customer names in one batch rather than per-sale.
    const customerIds = [...byCustomer.keys()];
    const names = await this.resolveCustomerNames(customerIds);
    for (const [id, entry] of byCustomer) {
      entry.customerName = names.get(id) ?? entry.customerPhone;
    }

    const entries = [...byCustomer.values()].sort((a, b) => b.totalCashback - a.totalCashback);
    const totalCashback = round2(entries.reduce((sum, e) => sum + e.totalCashback, 0));

    const now = nowIso();
    const doc: Omit<MonthlyCashbackLedger, 'id'> = {
      month,
      status: statusOverride.status ?? existing?.status ?? LedgerStatus.OPEN_ACCRUING,
      entries,
      totalCashback,
      submittedByUserId: existing?.submittedByUserId,
      submittedByName: existing?.submittedByName,
      submittedAt: existing?.submittedAt,
      approvedByUserId: existing?.approvedByUserId,
      approvedByName: existing?.approvedByName,
      approvedAt: existing?.approvedAt,
      rejectedByUserId: existing?.rejectedByUserId,
      rejectedByName: existing?.rejectedByName,
      rejectedAt: existing?.rejectedAt,
      rejectionReason: existing?.rejectionReason,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now,
    };
    await this.col().doc(month).set(doc, { merge: true });
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: month };
  }

  /**
   * Accumulates newly-paid amounts into each entry's disbursedAmount after a
   * disbursement batch completes — so a follow-up batch only picks up what's
   * still owed (totalCashback - disbursedAmount), never re-paying the same amount.
   */
  async recordDisbursedAmounts(month: string, paid: { customerId: string; amount: number }[]): Promise<void> {
    if (paid.length === 0) return;
    const ledger = await this.findByMonth(month);
    const paidByCustomer = new Map(paid.map((p) => [p.customerId, p.amount]));
    const entries = ledger.entries.map((e) => {
      const amount = paidByCustomer.get(e.customerId);
      if (!amount) return e;
      return { ...e, disbursedAmount: round2((e.disbursedAmount ?? 0) + amount) };
    });
    await this.col().doc(month).update({ entries, updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION);
  }

  /**
   * Seeds next month's ledger with carried-forward amounts for customers
   * excluded from this month's disbursement batch (below threshold). Called
   * by DisbursementBatchesService.create() once entries are split by threshold.
   */
  async carryForwardToNextMonth(fromMonth: string, excluded: MonthlyCashbackLedgerEntry[]): Promise<void> {
    if (excluded.length === 0) return;
    const nextMonth = nextMonthKey(fromMonth);
    const nextRef = this.col().doc(nextMonth);
    const nextSnap = await nextRef.get();
    const now = nowIso();
    if (!nextSnap.exists) {
      const doc: Omit<MonthlyCashbackLedger, 'id'> = {
        month: nextMonth,
        status: LedgerStatus.OPEN_ACCRUING,
        entries: excluded.map((e) => ({
          customerId: e.customerId,
          customerName: e.customerName,
          customerPhone: e.customerPhone,
          eligibleSalesCount: 0,
          totalCashback: e.totalCashback,
          carriedForwardAmount: e.totalCashback,
          carriedForwardFromMonth: fromMonth,
        })),
        totalCashback: round2(excluded.reduce((sum, e) => sum + e.totalCashback, 0)),
        createdAt: now,
        updatedAt: now,
      };
      await nextRef.set(doc);
    } else {
      const next = fromDoc<MonthlyCashbackLedger>(nextSnap);
      const byCustomer = new Map(next.entries.map((e) => [e.customerId, { ...e }]));
      for (const e of excluded) {
        const entry = byCustomer.get(e.customerId);
        if (entry) {
          entry.totalCashback = round2(entry.totalCashback + e.totalCashback);
          entry.carriedForwardAmount = round2((entry.carriedForwardAmount ?? 0) + e.totalCashback);
          entry.carriedForwardFromMonth = fromMonth;
        } else {
          byCustomer.set(e.customerId, {
            customerId: e.customerId,
            customerName: e.customerName,
            customerPhone: e.customerPhone,
            eligibleSalesCount: 0,
            totalCashback: e.totalCashback,
            carriedForwardAmount: e.totalCashback,
            carriedForwardFromMonth: fromMonth,
          });
        }
      }
      const entries = [...byCustomer.values()];
      await nextRef.update({
        entries,
        totalCashback: round2(entries.reduce((sum, en) => sum + en.totalCashback, 0)),
        updatedAt: now,
      });
    }
    this.changeEvents.emit(COLLECTION);
  }

  private async resolveCustomerNames(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const chunks = chunk(ids, 30);
    for (const c of chunks) {
      if (c.length === 0) continue;
      const snaps = await Promise.all(c.map((id) => this.firestore.collection('customers').doc(id).get()));
      for (const s of snaps) {
        if (s.exists) map.set(s.id, (s.data()?.fullName as string) ?? '');
      }
    }
    return map;
  }

  async submit(month: string, actor: StaffPrincipal): Promise<MonthlyCashbackLedger> {
    const ledger = await this.getOrCreate(month);
    if (
      ledger.status !== LedgerStatus.OPEN_ACCRUING &&
      ledger.status !== LedgerStatus.READY_FOR_REVIEW
    ) {
      throw new BadRequestException(`Ledger for ${month} cannot be submitted from status ${ledger.status}`);
    }
    const now = nowIso();
    await this.col().doc(month).update({
      status: LedgerStatus.SUBMITTED_FOR_APPROVAL,
      submittedByUserId: actor.userId,
      submittedByName: actor.fullName,
      submittedAt: now,
      updatedAt: now,
    });
    this.changeEvents.emit(COLLECTION);
    return this.findByMonth(month);
  }

  async approve(month: string, actor: StaffPrincipal): Promise<MonthlyCashbackLedger> {
    const ledger = await this.findByMonth(month);
    if (ledger.status !== LedgerStatus.SUBMITTED_FOR_APPROVAL) {
      throw new BadRequestException(`Ledger for ${month} is not awaiting approval (status: ${ledger.status})`);
    }
    const now = nowIso();
    await this.col().doc(month).update({
      status: LedgerStatus.APPROVED,
      approvedByUserId: actor.userId,
      approvedByName: actor.fullName,
      approvedAt: now,
      updatedAt: now,
    });
    this.changeEvents.emit(COLLECTION);
    return this.findByMonth(month);
  }

  async reject(month: string, reason: string, actor: StaffPrincipal): Promise<MonthlyCashbackLedger> {
    const ledger = await this.findByMonth(month);
    if (ledger.status !== LedgerStatus.SUBMITTED_FOR_APPROVAL) {
      throw new BadRequestException(`Ledger for ${month} is not awaiting approval (status: ${ledger.status})`);
    }
    const now = nowIso();
    await this.col().doc(month).update({
      status: LedgerStatus.REJECTED,
      rejectedByUserId: actor.userId,
      rejectedByName: actor.fullName,
      rejectedAt: now,
      rejectionReason: reason,
      updatedAt: now,
    });
    this.changeEvents.emit(COLLECTION);
    return this.findByMonth(month);
  }

  async findByMonth(month: string): Promise<MonthlyCashbackLedger> {
    const snap = await this.col().doc(month).get();
    if (!snap.exists) throw new NotFoundException(`No ledger found for ${month}`);
    return fromDoc<MonthlyCashbackLedger>(snap);
  }

  async setStatus(month: string, status: LedgerStatus): Promise<void> {
    await this.col().doc(month).update({ status, updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION);
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function nextMonthKey(month: string): string {
  const parts = month.split('-').map(Number);
  const year = parts[0] ?? 0;
  const mo = parts[1] ?? 1;
  const date = new Date(Date.UTC(year, mo, 1)); // mo is 1-based, so this already rolls forward one month
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
