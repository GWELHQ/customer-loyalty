import type { MonthlyCashbackLedger, MonthlyCashbackLedgerEntry, Sale } from '@loyalty/shared';
import { LedgerStatus, Permission } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { usePagedRows } from '../data/usePagedRows';
import { useRealtimeRefresh } from '../data/realtime';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { formatNairobiDateTime, nairobiThisMonth } from '../lib/time';
import { ExportButtons } from '../ui/ExportButtons';
import { Badge, Button, Card, Pagination, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

const LEDGER_ENTRY_COLUMNS: ExportColumn<MonthlyCashbackLedgerEntry>[] = [
  { header: 'Customer', value: (e) => e.customerName },
  { header: 'Phone', value: (e) => e.customerPhone },
  { header: 'Eligible sales', value: (e) => e.eligibleSalesCount },
  { header: 'Total cashback (KSh)', value: (e) => e.totalCashback },
];

const STATUS_TONE: Record<LedgerStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  [LedgerStatus.OPEN_ACCRUING]: 'neutral',
  [LedgerStatus.READY_FOR_REVIEW]: 'neutral',
  [LedgerStatus.SUBMITTED_FOR_APPROVAL]: 'warning',
  [LedgerStatus.APPROVED]: 'success',
  [LedgerStatus.REJECTED]: 'danger',
  [LedgerStatus.DISBURSEMENT_IN_PROGRESS]: 'warning',
  [LedgerStatus.DISBURSED]: 'success',
  [LedgerStatus.FAILED]: 'danger',
  [LedgerStatus.HELD]: 'danger',
};

export function CashbackLedgers() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(Permission.LEDGERS_MANAGE);
  const canApprove = hasPermission(Permission.LEDGERS_APPROVE);
  const [month, setMonth] = useState(nairobiThisMonth);
  const [ledger, setLedger] = useState<MonthlyCashbackLedger | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<MonthlyCashbackLedgerEntry | null>(null);
  const { paged, page, pageCount, setPage } = usePagedRows(ledger?.entries ?? []);

  function reload() {
    api.cashbackLedgers.get(month).then(setLedger);
  }
  useEffect(reload, [api, month]);
  useRealtimeRefresh(['monthlyCashbackLedgers'], reload);

  async function submit() {
    setBusy(true);
    try {
      await api.cashbackLedgers.submit(month);
      reload();
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    setBusy(true);
    try {
      await api.cashbackLedgers.approve(month);
      reload();
    } finally {
      setBusy(false);
    }
  }
  async function reject() {
    const reason = window.prompt('Reason for rejecting this ledger?');
    if (!reason) return;
    setBusy(true);
    try {
      await api.cashbackLedgers.reject(month, reason);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Monthly cashback ledger" subtitle="One customer total per month, with a full approval trail">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1000 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="month" style={{ ...inputStyle, maxWidth: 180 }} value={month} onChange={(e) => setMonth(e.target.value)} />
          {ledger && <Badge tone={STATUS_TONE[ledger.status]}>{ledger.status.replace(/_/g, ' ')}</Badge>}
          <div style={{ flex: 1 }} />
          {ledger && canManage && (ledger.status === LedgerStatus.OPEN_ACCRUING || ledger.status === LedgerStatus.READY_FOR_REVIEW) && (
            <Button variant="primary" onClick={submit} disabled={busy}>
              Submit for approval
            </Button>
          )}
          {ledger && canApprove && ledger.status === LedgerStatus.SUBMITTED_FOR_APPROVAL && (
            <>
              <Button variant="primary" onClick={approve} disabled={busy}>
                Approve
              </Button>
              <Button variant="danger" onClick={reject} disabled={busy}>
                Reject
              </Button>
            </>
          )}
        </div>

        {ledger && (
          <Card>
            <div style={{ display: 'flex', gap: 24 }}>
              <div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>Total cashback</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26 }}>
                  KSh {ledger.totalCashback.toLocaleString('en-KE')}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>Customers</div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26 }}>{ledger.entries.length}</div>
              </div>
            </div>
          </Card>
        )}

        {ledger && ledger.entries.length > 0 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <ExportButtons
              filename={`cashback-ledger-${month}`}
              title={`Cashback ledger — ${month}`}
              columns={LEDGER_ENTRY_COLUMNS}
              rows={ledger.entries}
            />
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 16 }}>
          <Card padding={0}>
            {!ledger || ledger.entries.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>No eligible sales for this month yet.</div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Phone</Th>
                    <Th align="right">Eligible sales</Th>
                    <Th align="right">Total cashback</Th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((e) => (
                    <Tr key={e.customerId} onClick={() => setSelected(e)}>
                      <Td>{e.customerName}</Td>
                      <Td>{e.customerPhone}</Td>
                      <Td align="right">{e.eligibleSalesCount}</Td>
                      <Td align="right">
                        <strong>KSh {e.totalCashback.toLocaleString('en-KE')}</strong>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {ledger && <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${ledger.entries.length} customer(s)`} />}
          </Card>

          {selected && <CustomerMonthSales entry={selected} month={month} onClose={() => setSelected(null)} />}
        </div>
      </div>
    </AppShell>
  );
}

function CustomerMonthSales({
  entry,
  month,
  onClose,
}: {
  entry: MonthlyCashbackLedgerEntry;
  month: string;
  onClose: () => void;
}) {
  const api = useApi();
  const [sales, setSales] = useState<Sale[] | null>(null);

  useEffect(() => {
    setSales(null);
    api.reports.customerActivity(entry.customerId).then((res) => {
      setSales(res.sales.filter((s) => s.saleDate.slice(0, 7) === month));
    });
  }, [api, entry.customerId, month]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>{entry.customerName}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>{month} — every eligible sale</div>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}>
          ×
        </button>
      </div>

      {sales === null && <div style={{ marginTop: 14, fontSize: 13, color: 'var(--color-text-secondary)' }}>Loading…</div>}
      {sales !== null && sales.length === 0 && (
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--color-text-secondary)' }}>No sales found for this month.</div>
      )}
      {sales !== null &&
        sales.map((s) => (
          <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>{s.stationNameAtSale}</span>
              <span>{s.product}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 3 }}>
              <span>{formatNairobiDateTime(s.saleDate)}</span>
              <span>KSh {s.amountPaid.toLocaleString('en-KE')} paid</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 13, fontWeight: 800, color: 'var(--color-primary)', marginTop: 3 }}>
              KSh {s.snapshot.cashbackEarned.toLocaleString('en-KE')} cashback
            </div>
          </div>
        ))}
    </Card>
  );
}
