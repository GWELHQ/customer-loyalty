import type { LedgerPayoutRow, MonthlyCashbackLedger, MonthlyCashbackLedgerEntry } from '@loyalty/shared';

export interface PayoutPlan {
  rows: LedgerPayoutRow[];
  /** Per (customer, station) amount being paid — written back as each entry's disbursedAmount. */
  paid: { customerId: string; stationId: string; amount: number }[];
  /** Per (customer, station) still-owed amount for customers under the minimum — carried into next month. */
  belowThreshold: MonthlyCashbackLedgerEntry[];
}

/**
 * Still-owed per entry (totalCashback - disbursedAmount), summed per
 * customer across stations. The minimum disbursement amount applies to the
 * customer's combined total, since that's the single transfer they get.
 */
export function planPayout(ledger: MonthlyCashbackLedger, minDisbursementAmount: number): PayoutPlan {
  const byCustomer = new Map<string, { owed: { entry: MonthlyCashbackLedgerEntry; amount: number }[]; total: number }>();
  for (const entry of ledger.entries) {
    const amount = round2(entry.totalCashback - (entry.disbursedAmount ?? 0));
    if (amount <= 0) continue;
    const bucket = byCustomer.get(entry.customerId) ?? { owed: [], total: 0 };
    bucket.owed.push({ entry, amount });
    bucket.total = round2(bucket.total + amount);
    byCustomer.set(entry.customerId, bucket);
  }

  const plan: PayoutPlan = { rows: [], paid: [], belowThreshold: [] };
  for (const [customerId, bucket] of byCustomer) {
    if (bucket.total < minDisbursementAmount) {
      plan.belowThreshold.push(...bucket.owed.map(({ entry, amount }) => ({ ...entry, totalCashback: amount })));
      continue;
    }
    // Every entry carries the customer's current phone (recomputeFrom reads it off the customer doc).
    const first = bucket.owed[0]!.entry;
    plan.rows.push({ customerId, customerName: first.customerName, customerPhone: first.customerPhone, amount: bucket.total });
    plan.paid.push(...bucket.owed.map(({ entry, amount }) => ({ customerId, stationId: entry.stationId, amount })));
  }
  plan.rows.sort((a, b) => a.customerName.localeCompare(b.customerName));
  return plan;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
