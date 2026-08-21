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
    const { startUtc, endUtc } = nairobiMonthBoundsUtc(month);
    const snap = await this.firestore
      .collection('sales')
      .where('saleDate', '>=', startUtc)
      .where('saleDate', '<', endUtc)
      .get();
    const sales = snap.docs.map((d) => fromDoc<Sale>(d));

    const byCustomer = new Map<string, MonthlyCashbackLedgerEntry>();
    for (const sale of sales) {
      const existing = byCustomer.get(sale.customerId);
      if (existing) {
        existing.eligibleSalesCount += 1;
        existing.totalCashback = round2(existing.totalCashback + sale.snapshot.cashbackEarned);
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

    // Resolve customer names in one batch rather than per-sale.
    const customerIds = [...byCustomer.keys()];
    const names = await this.resolveCustomerNames(customerIds);
    for (const [id, entry] of byCustomer) {
      entry.customerName = names.get(id) ?? entry.customerPhone;
    }

    const entries = [...byCustomer.values()].sort((a, b) => b.totalCashback - a.totalCashback);
    const totalCashback = round2(entries.reduce((sum, e) => sum + e.totalCashback, 0));

    const now = nowIso();
    const existingSnap = await this.col().doc(month).get();
    const doc: Omit<MonthlyCashbackLedger, 'id'> = {
      month,
      status: LedgerStatus.OPEN_ACCRUING,
      entries,
      totalCashback,
      createdAt: existingSnap.exists ? (existingSnap.data()?.createdAt as string) : now,
      updatedAt: now,
    };
    await this.col().doc(month).set(doc, { merge: true });
    this.changeEvents.emit(COLLECTION);
    return { ...doc, id: month };
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
