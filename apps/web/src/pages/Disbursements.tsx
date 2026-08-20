import type { DisbursementBatch } from '@loyalty/shared';
import { DisbursementBatchStatus, Permission } from '@loyalty/shared';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useDisbursementBatchesCache } from '../data/entityCaches';
import { usePagedRows } from '../data/usePagedRows';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { ExportButtons } from '../ui/ExportButtons';
import { Badge, Button, Card, Pagination, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

const BATCH_COLUMNS: ExportColumn<DisbursementBatch>[] = [
  { header: 'Month', value: (b) => b.month },
  { header: 'Total amount (KSh)', value: (b) => b.totalAmount },
  { header: 'Customers', value: (b) => b.entries.length },
  { header: 'Status', value: (b) => b.status },
];

const STATUS_TONE: Record<DisbursementBatchStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  [DisbursementBatchStatus.DRAFT]: 'neutral',
  [DisbursementBatchStatus.PROCESSING]: 'warning',
  [DisbursementBatchStatus.COMPLETED]: 'success',
  [DisbursementBatchStatus.FAILED]: 'danger',
  [DisbursementBatchStatus.HELD]: 'danger',
};

export function Disbursements() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(Permission.DISBURSEMENTS_MANAGE);
  const { items: batches, refresh: reload } = useDisbursementBatchesCache();
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selected, setSelected] = useState<DisbursementBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const { paged, page, pageCount, setPage } = usePagedRows(batches);

  async function createBatch() {
    setBusy(true);
    try {
      const batch = await api.disbursementBatches.create(month);
      setSelected(batch);
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: 'confirm' | 'markProcessing' | 'hold', batch: DisbursementBatch) {
    setBusy(true);
    try {
      if (action === 'hold') {
        const reason = window.prompt('Reason for holding this batch?');
        if (!reason) return;
        await api.disbursementBatches.hold(batch.id, reason);
      } else if (action === 'confirm') {
        await api.disbursementBatches.confirm(batch.id);
      } else {
        await api.disbursementBatches.markProcessing(batch.id);
      }
      reload();
      setSelected(await api.disbursementBatches.get(batch.id));
    } finally {
      setBusy(false);
    }
  }

  async function completeBatch(batch: DisbursementBatch) {
    setBusy(true);
    try {
      const completed = await api.disbursementBatches.complete(
        batch.id,
        batch.entries.map((e) => ({ customerId: e.customerId, status: 'paid' as const, reference: `MPESA-${Date.now()}` })),
      );
      setSelected(completed);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Disbursement batches" subtitle="A batch is only shown as disbursed once every payment is confirmed">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {canManage && (
            <>
              <input type="month" style={{ ...inputStyle, maxWidth: 180 }} value={month} onChange={(e) => setMonth(e.target.value)} />
              <Button variant="primary" onClick={createBatch} disabled={busy}>
                Create batch from approved ledger
              </Button>
            </>
          )}
          <div style={{ flex: 1 }} />
          <ExportButtons filename="disbursement-batches" title="Disbursement batches" columns={BATCH_COLUMNS} rows={batches} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 16 }}>
          <Card padding={0}>
            {batches.length === 0 && <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>No disbursement batches yet.</div>}
            {batches.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <Th>Month</Th>
                    <Th align="right">Total</Th>
                    <Th align="right">Customers</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((b) => (
                    <Tr key={b.id} onClick={() => setSelected(b)}>
                      <Td>{b.month}</Td>
                      <Td align="right">KSh {b.totalAmount.toLocaleString('en-KE')}</Td>
                      <Td align="right">{b.entries.length}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[b.status]}>{b.status}</Badge>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${batches.length} batch(es)`} />
          </Card>

          {selected && (
            <Card>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>Batch {selected.month}</div>
              <Badge tone={STATUS_TONE[selected.status]}>{selected.status}</Badge>
              <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {selected.entries.length} customers · KSh {selected.totalAmount.toLocaleString('en-KE')}
              </div>

              {canManage && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
                  {selected.status === DisbursementBatchStatus.DRAFT && !selected.confirmedAt && (
                    <Button variant="primary" size="sm" onClick={() => transition('confirm', selected)} disabled={busy}>
                      Confirm batch
                    </Button>
                  )}
                  {selected.status === DisbursementBatchStatus.DRAFT && selected.confirmedAt && (
                    <Button variant="primary" size="sm" onClick={() => transition('markProcessing', selected)} disabled={busy}>
                      Mark processing
                    </Button>
                  )}
                  {selected.status === DisbursementBatchStatus.PROCESSING && (
                    <Button variant="primary" size="sm" onClick={() => completeBatch(selected)} disabled={busy}>
                      Mark all as paid
                    </Button>
                  )}
                  {selected.status !== DisbursementBatchStatus.COMPLETED && (
                    <Button variant="danger" size="sm" onClick={() => transition('hold', selected)} disabled={busy}>
                      Hold batch
                    </Button>
                  )}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
    </AppShell>
  );
}
