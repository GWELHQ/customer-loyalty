import type { DisbursementBatch } from '@loyalty/shared';

/**
 * Tab-delimited bulk-payment file, matching the bank's own upload template
 * (see PESAPAL_TRANSITION_PROPOSAL.md history / the "STAFF SALARY ADVANCES"
 * sample the format was copied from). Every disbursement is via M-Pesa, so
 * Bank/Branch/BIC are fixed constants — only Beneficiary Name,
 * AccountNo./PhoneNumber, and Net Pay/Amount vary per row.
 *
 * ASSUMPTION worth confirming with Finance: the debit account and branch
 * BIC/SORT code below were copied from a staff-salary-advances template,
 * not a customer-cashback one — update DEBIT_ACCOUNT/BRANCH_BIC_SORT_CODE
 * here if the customer disbursement account differs.
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

function monthTitle(month: string): string {
  const [year, monthNum] = month.split('-').map(Number) as [number, number];
  const monthName = new Date(Date.UTC(year, monthNum - 1, 1))
    .toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
    .toUpperCase();
  return `GREEN WELLS ENERGIES LTD - ${monthName} ${year} CUSTOMER CASHBACK DISBURSEMENT`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function buildDisbursementExportText(batch: DisbursementBatch): string {
  const lines: string[] = [padRow([monthTitle(batch.month)]), padRow(HEADER), padRow([])];

  const sortedEntries = [...batch.entries].sort((a, b) => a.customerName.localeCompare(b.customerName));
  let total = 0;
  for (const entry of sortedEntries) {
    total += entry.amount;
    lines.push(
      padRow([
        DEBIT_ACCOUNT,
        BRANCH_BIC_SORT_CODE,
        entry.customerName,
        BANK,
        BRANCH,
        MPESA_BIC,
        entry.customerPhone.replace(/^\+/, ''),
        `${entry.amount.toFixed(2)} `,
      ]),
    );
  }

  lines.push(padRow(['', '', '', '', '', '', '', round2(total).toFixed(2)]));
  return lines.join('\r\n') + '\r\n';
}
