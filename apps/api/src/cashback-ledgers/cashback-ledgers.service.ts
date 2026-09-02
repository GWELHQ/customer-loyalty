import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  LedgerStatus,
  Role,
  SaleApprovalStatus,
  type MonthlyCashbackLedger,
  type MonthlyCashbackLedgerEntry,
  type MonthlyCashbackLedgerStationRelease,
  type Sale,
} from '@loyalty/shared';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import { nairobiMonthBoundsUtc, nairobiToday } from '../common/time/nairobi';
import type { StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';
import { StationsService } from '../stations/stations.service';

const COLLECTION = 'monthlyCashbackLedgers';

@Injectable()
export class CashbackLedgersService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly changeEvents: ChangeEventsService,
    private readonly stations: StationsService,
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
    // Pending/rejected sales haven't (and may never) actually credit any
    // cashback — a sale with no approvalStatus at all is a legacy sale
    // from before this gate existed, already credited the old way.
    const sales = snap.docs
      .map((d) => fromDoc<Sale>(d))
      .filter((s) => s.approvalStatus == null || s.approvalStatus === SaleApprovalStatus.APPROVED);

    // Keyed by (customerId, stationId), not customerId alone — a customer
    // buying at two stations in the same month gets two independent
    // entries, since disbursement batches are always station-scoped and
    // must never attribute cashback to a station it wasn't earned at.
    const byKey = new Map<string, MonthlyCashbackLedgerEntry>();
    for (const sale of sales) {
      const key = entryKey(sale.customerId, sale.stationId);
      const entry = byKey.get(key);
      if (entry) {
        entry.eligibleSalesCount += 1;
        entry.totalCashback = round2(entry.totalCashback + sale.snapshot.cashbackEarned);
      } else {
        byKey.set(key, {
          customerId: sale.customerId,
          customerName: '', // resolved in a batch below
          customerPhone: sale.customerPhoneAtSale,
          stationId: sale.stationId,
          stationName: sale.stationNameAtSale,
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
      const key = entryKey(prior.customerId, prior.stationId);
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          customerId: prior.customerId,
          customerName: '',
          customerPhone: prior.customerPhone,
          stationId: prior.stationId,
          stationName: prior.stationName,
          eligibleSalesCount: 0,
          totalCashback: 0,
        };
        byKey.set(key, entry);
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
    const customerIds = [...new Set([...byKey.values()].map((e) => e.customerId))];
    const names = await this.resolveCustomerNames(customerIds);
    for (const entry of byKey.values()) {
      entry.customerName = names.get(entry.customerId) ?? entry.customerPhone;
    }

    const entries = [...byKey.values()].sort((a, b) => b.totalCashback - a.totalCashback);
    const totalCashback = round2(entries.reduce((sum, e) => sum + e.totalCashback, 0));

    const now = nowIso();
    const doc: Omit<MonthlyCashbackLedger, 'id'> = {
      month,
      status: statusOverride.status ?? existing?.status ?? LedgerStatus.OPEN_ACCRUING,
      entries,
      totalCashback,
      stationReleases: existing?.stationReleases ?? [],
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
   * still owed (totalCashback - disbursedAmount), never re-paying the same
   * amount. Matched by (customerId, stationId) since a customer can have an
   * independent balance at more than one station.
   */
  async recordDisbursedAmounts(
    month: string,
    paid: { customerId: string; stationId: string; amount: number }[],
  ): Promise<void> {
    if (paid.length === 0) return;
    const ledger = await this.findByMonth(month);
    const paidByKey = new Map(paid.map((p) => [entryKey(p.customerId, p.stationId), p.amount]));
    const entries = ledger.entries.map((e) => {
      const amount = paidByKey.get(entryKey(e.customerId, e.stationId));
      if (!amount) return e;
      return { ...e, disbursedAmount: round2((e.disbursedAmount ?? 0) + amount) };
    });
    await this.col().doc(month).update({ entries, updatedAt: nowIso() });
    this.changeEvents.emit(COLLECTION);
  }

  /**
   * Seeds next month's ledger with carried-forward amounts for
   * (customer, station) pairs excluded from this month's disbursement batch
   * (below threshold). Called by DisbursementBatchesService.create() once
   * entries are split by threshold, per station.
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
          stationId: e.stationId,
          stationName: e.stationName,
          eligibleSalesCount: 0,
          totalCashback: e.totalCashback,
          carriedForwardAmount: e.totalCashback,
          carriedForwardFromMonth: fromMonth,
        })),
        totalCashback: round2(excluded.reduce((sum, e) => sum + e.totalCashback, 0)),
        stationReleases: [],
        createdAt: now,
        updatedAt: now,
      };
      await nextRef.set(doc);
    } else {
      const next = fromDoc<MonthlyCashbackLedger>(nextSnap);
      const byKey = new Map(next.entries.map((e) => [entryKey(e.customerId, e.stationId), { ...e }]));
      for (const e of excluded) {
        const key = entryKey(e.customerId, e.stationId);
        const entry = byKey.get(key);
        if (entry) {
          entry.totalCashback = round2(entry.totalCashback + e.totalCashback);
          entry.carriedForwardAmount = round2((entry.carriedForwardAmount ?? 0) + e.totalCashback);
          entry.carriedForwardFromMonth = fromMonth;
        } else {
          byKey.set(key, {
            customerId: e.customerId,
            customerName: e.customerName,
            customerPhone: e.customerPhone,
            stationId: e.stationId,
            stationName: e.stationName,
            eligibleSalesCount: 0,
            totalCashback: e.totalCashback,
            carriedForwardAmount: e.totalCashback,
            carriedForwardFromMonth: fromMonth,
          });
        }
      }
      const entries = [...byKey.values()];
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

  /**
   * The narrow, non-sensitive view a Station Supervisor is allowed —
   * whether their own station is released for the month, without exposing
   * the org-wide customer entries LEDGERS_VIEW would (they don't hold it).
   */
  async getMyStationStatus(
    month: string,
    stationId: string,
  ): Promise<{
    month: string;
    status: LedgerStatus;
    stationId: string;
    stationName: string;
    released: boolean;
    releasedByName?: string;
    releasedAt?: string;
  }> {
    const ledger = await this.getOrCreate(month);
    const station = await this.stations.findById(stationId);
    if (!station) throw new NotFoundException('Station not found');
    const release = ledger.stationReleases.find((r) => r.stationId === stationId);
    return {
      month,
      status: ledger.status,
      stationId,
      stationName: station.name,
      released: !!release,
      releasedByName: release?.releasedByName,
      releasedAt: release?.releasedAt,
    };
  }

  /**
   * A Station Supervisor signs their own station off individually
   * (idempotent — already-released is a no-op, not an error, so a
   * double-click or stale UI never fails loudly). This never changes the
   * ledger's overall status; only submit() below does that.
   */
  async releaseStation(month: string, stationId: string, actor: StaffPrincipal): Promise<MonthlyCashbackLedger> {
    assertWithinReleaseWindow(actor);
    const ledger = await this.getOrCreate(month);
    if (ledger.status !== LedgerStatus.OPEN_ACCRUING && ledger.status !== LedgerStatus.READY_FOR_REVIEW) {
      throw new BadRequestException(`Ledger for ${month} cannot be released from status ${ledger.status}`);
    }
    if (ledger.stationReleases.some((r) => r.stationId === stationId)) {
      return ledger; // already released — idempotent
    }
    const station = await this.stations.findById(stationId);
    if (!station) throw new NotFoundException('Station not found');

    const now = nowIso();
    const release: MonthlyCashbackLedgerStationRelease = {
      stationId,
      stationName: station.name,
      releasedByUserId: actor.userId,
      releasedByName: actor.fullName,
      releasedAt: now,
    };
    await this.col()
      .doc(month)
      .set({ stationReleases: [...ledger.stationReleases, release], updatedAt: now }, { merge: true });
    this.changeEvents.emit(COLLECTION);
    return this.findByMonth(month);
  }

  /**
   * RTSM/Admin's "Release for approval" — fills in a release record
   * (attributed to this actor) for every active station a Station
   * Supervisor hasn't already released, then submits the whole month for
   * Finance Approver review in one action.
   */
  async submit(month: string, actor: StaffPrincipal): Promise<MonthlyCashbackLedger> {
    assertWithinReleaseWindow(actor);
    const ledger = await this.getOrCreate(month);
    if (
      ledger.status !== LedgerStatus.OPEN_ACCRUING &&
      ledger.status !== LedgerStatus.READY_FOR_REVIEW
    ) {
      throw new BadRequestException(`Ledger for ${month} cannot be submitted from status ${ledger.status}`);
    }

    const alreadyReleased = new Set(ledger.stationReleases.map((r) => r.stationId));
    const activeStations = (await this.stations.list()).filter((s) => s.active && !alreadyReleased.has(s.id));
    const now = nowIso();
    const stationReleases: MonthlyCashbackLedgerStationRelease[] = [
      ...ledger.stationReleases,
      ...activeStations.map((s) => ({
        stationId: s.id,
        stationName: s.name,
        releasedByUserId: actor.userId,
        releasedByName: actor.fullName,
        releasedAt: now,
      })),
    ];

    await this.col().doc(month).update({
      status: LedgerStatus.SUBMITTED_FOR_APPROVAL,
      stationReleases,
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

/** Admin can release any day of the month; every other role (RTSM, Station Supervisor) only on the 1st or 2nd (Nairobi calendar day) — release is meant to happen right after the prior month closes. */
function assertWithinReleaseWindow(actor: StaffPrincipal): void {
  if (actor.role === Role.ADMIN) return;
  const dayOfMonth = Number(nairobiToday().slice(8, 10));
  if (dayOfMonth !== 1 && dayOfMonth !== 2) {
    throw new ForbiddenException('The monthly ledger can only be released on the 1st or 2nd of the month');
  }
}

function entryKey(customerId: string, stationId: string): string {
  return `${customerId}:${stationId}`;
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
