import { BadRequestException, Injectable } from '@nestjs/common';
import { LedgerStatus, type LedgerPayoutRow, type MonthlyCashbackLedger } from '@loyalty/shared';
import { CashbackLedgersService } from '../cashback-ledgers/cashback-ledgers.service';
import { CashbackTrendService } from '../cashback-trend/cashback-trend.service';
import { FirestoreService } from '../common/firestore/firestore.service';
import { fromDoc, nowIso } from '../common/firestore/helpers';
import type { StaffPrincipal } from '../common/types/principal';
import { ChangeEventsService } from '../events/change-events.service';
import { DisbursementSettingsService } from '../settings/disbursement-settings.service';
import { buildLedgerPaymentFileText } from './disbursement-export';
import { planPayout } from './ledger-payout-plan';

const LEDGERS_COLLECTION = 'monthlyCashbackLedgers';

/**
 * The ledger-page payout flow: once a month's ledger is approved, one
 * combined payment file covers every station (one row per customer, their
 * stations summed), and Finance Disburser / Super Admin then marks the
 * ledger disbursed. Replaces the per-station batch flow for new months.
 *
 * The approved ledger is deliberately NOT recomputed here — the file that
 * was downloaded and the amounts marked paid must be the same numbers.
 */
@Injectable()
export class LedgerPayoutService {
  constructor(
    private readonly firestore: FirestoreService,
    private readonly ledgers: CashbackLedgersService,
    private readonly changeEvents: ChangeEventsService,
    private readonly disbursementSettings: DisbursementSettingsService,
    private readonly cashbackTrend: CashbackTrendService,
  ) {}

  /** The combined payment file: what's owed while approved, or exactly what was paid once marked disbursed. */
  async paymentFile(month: string): Promise<{ text: string; rows: LedgerPayoutRow[] }> {
    const ledger = await this.ledgers.findByMonth(month);
    let rows: LedgerPayoutRow[];
    if (ledger.status === LedgerStatus.APPROVED) {
      const { minDisbursementAmount } = await this.disbursementSettings.get();
      rows = planPayout(ledger, minDisbursementAmount).rows;
    } else if (ledger.status === LedgerStatus.DISBURSED && ledger.payoutRows) {
      rows = ledger.payoutRows;
    } else {
      throw new BadRequestException(
        `The payment file is only available once the ${month} ledger is approved (status: ${ledger.status})`,
      );
    }
    return { text: buildLedgerPaymentFileText(month, rows), rows };
  }

  async markDisbursed(month: string, actor: StaffPrincipal): Promise<MonthlyCashbackLedger> {
    const { minDisbursementAmount } = await this.disbursementSettings.get();
    const ref = this.firestore.collection(LEDGERS_COLLECTION).doc(month);
    const now = nowIso();

    // Status check, payout and status flip in one transaction — a double
    // click or two people at once can never pay the month twice.
    const plan = await this.firestore.instance.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new BadRequestException(`No ledger found for ${month}`);
      const ledger = fromDoc<MonthlyCashbackLedger>(snap);
      if (ledger.status !== LedgerStatus.APPROVED) {
        throw new BadRequestException(`Only an approved ledger can be marked disbursed (status: ${ledger.status})`);
      }
      const planned = planPayout(ledger, minDisbursementAmount);
      const paidByKey = new Map(planned.paid.map((p) => [entryKey(p.customerId, p.stationId), p.amount]));
      const entries = ledger.entries.map((e) => {
        const amount = paidByKey.get(entryKey(e.customerId, e.stationId));
        return amount ? { ...e, disbursedAmount: round2((e.disbursedAmount ?? 0) + amount) } : e;
      });
      tx.update(ref, {
        entries,
        status: LedgerStatus.DISBURSED,
        payoutRows: planned.rows,
        disbursedByUserId: actor.userId,
        disbursedByName: actor.fullName,
        disbursedAt: now,
        updatedAt: now,
      });
      return planned;
    });

    await this.ledgers.carryForwardToNextMonth(month, plan.belowThreshold);

    const paidByStation = new Map<string, number>();
    for (const p of plan.paid) paidByStation.set(p.stationId, round2((paidByStation.get(p.stationId) ?? 0) + p.amount));
    await this.cashbackTrend.onMonthDisbursed(
      month,
      [...paidByStation.entries()].map(([stationId, amount]) => ({ stationId, amount })),
    );

    this.changeEvents.emit(LEDGERS_COLLECTION);
    return this.ledgers.findByMonth(month);
  }
}

function entryKey(customerId: string, stationId: string): string {
  return `${customerId}:${stationId}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
