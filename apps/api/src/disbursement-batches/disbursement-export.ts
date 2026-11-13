import type { DisbursementBatch, LedgerPayoutRow } from '@loyalty/shared';

/**
 * Tab-delimited bulk-payment file, matching the bank's own upload template.
 * Every disbursement is via M-Pesa, so Debit Account/Branch code/Bank/
 * Branch/BIC are fixed constants (confirmed correct for customer cashback,
 * not just the staff-advances template they were originally copied from) —
 * only Beneficiary Name, AccountNo./PhoneNumber, and Net Pay/Amount vary
 * per row.
 */
const DEBIT_ACCOUNT = '1138112682';
const BRANCH_BIC_SORT_CODE = '01105';
const BANK = 'Safaricom';
const BRANCH = 'Safaricom';
const MPESA_BIC = '99999';

const COLUMN_COUNT = 8;
const HEADER = [
  'Debit/From Account',
  'Your Branch BIC/SORT Code',
  'Beneficiary Name',
  'Bank',
  'Branch',
  'BIC/SORT Code (Mpesa 99999)',
  'AccountNo./PhoneNumber',
  'Net Pay/Amount',
];

function padRow(cells: string[]): string {
  const row = [...cells];
  while (row.length < COLUMN_COUNT) row.push('');
  return row.join('\t');
}

function monthTitle(month: string, scopeLabel: string): string {
  const [year, monthNum] = month.split('-').map(Number) as [number, number];
  const monthName = new Date(Date.UTC(year, monthNum - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
    .toUpperCase();
  return `GREEN WELLS ENERGIES LTD - ${monthName} ${year} CUSTOMER LOYALTY CASHBACK - ${scopeLabel.toUpperCase()}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildPaymentFileText(title: string, rows: { customerName: string; customerPhone: string; amount: number }[]): string {
  const lines: string[] = [padRow([title]), padRow(HEADER), padRow([])];

  const sortedRows = [...rows].sort((a, b) => a.customerName.localeCompare(b.customerName));
  let total = 0;
  for (const row of sortedRows) {
    total += row.amount;
    lines.push(
      padRow([
        DEBIT_ACCOUNT,
        BRANCH_BIC_SORT_CODE,
        row.customerName,
        BANK,
        BRANCH,
        MPESA_BIC,
        row.customerPhone.replace(/^\+/, ''),
        `${row.amount.toFixed(2)} `,
      ]),
    );
  }

  lines.push(padRow(['', '', '', '', '', '', '', round2(total).toFixed(2)]));
  return lines.join('\r\n') + '\r\n';
}

/** One station's batch file (legacy per-station batch flow). */
export function buildDisbursementExportText(batch: DisbursementBatch): string {
  return buildPaymentFileText(monthTitle(batch.month, batch.stationName), batch.entries);
}

/** The month's single combined payment file — every station, one row per customer. */
export function buildLedgerPaymentFileText(month: string, rows: LedgerPayoutRow[]): string {
  return buildPaymentFileText(monthTitle(month, 'All stations'), rows);
}
