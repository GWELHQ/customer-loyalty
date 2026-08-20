import type { ReconciliationDaily, Station } from '@loyalty/shared';
import { Permission, ReconciliationStatus } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { usePagedRows } from '../data/usePagedRows';
import { useRealtimeRefresh } from '../data/realtime';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { ExportButtons } from '../ui/ExportButtons';
import { Badge, Button, Card, Field, Pagination, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

function reconciliationColumns(stations: Station[]): ExportColumn<ReconciliationDaily>[] {
  return [
    { header: 'Station', value: (r) => stations.find((s) => s.id === r.stationId)?.name ?? 'Unknown station' },
    { header: 'Product', value: (r) => r.product },
    { header: 'Total sales (KSh)', value: (r) => r.totalSales },
    { header: 'Loyalty sales (KSh)', value: (r) => r.loyaltySales },
    { header: 'Percentage', value: (r) => r.percentage },
    { header: 'Headroom (KSh)', value: (r) => r.headroom },
    { header: 'Status', value: (r) => r.status },
  ];
}

const STATUS_TONE: Record<ReconciliationStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  [ReconciliationStatus.PENDING]: 'neutral',
  [ReconciliationStatus.HEALTHY]: 'success',
  [ReconciliationStatus.NEAR_LIMIT]: 'warning',
  [ReconciliationStatus.EXCEEDED]: 'danger',
  [ReconciliationStatus.NEEDS_REVIEW]: 'danger',
};

export function Reconciliation() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(Permission.RECONCILIATION_MANAGE);
  const { stations } = useStations();
  const [records, setRecords] = useState<ReconciliationDaily[]>([]);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showIngest, setShowIngest] = useState(false);
  const { paged, page, pageCount, setPage } = usePagedRows(records);

  function reload() {
    api.reconciliation.daily({ date }).then(setRecords);
  }
  useEffect(reload, [api, date]);
  useRealtimeRefresh(['reconciliationDaily'], reload);

  return (
    <AppShell title="Daily reconciliation" subtitle="Loyalty sales must never exceed an attendant's total sales for the day">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1100 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <input type="date" style={{ ...inputStyle, maxWidth: 180 }} value={date} onChange={(e) => setDate(e.target.value)} />
          <div style={{ flex: 1 }} />
          <ExportButtons filename={`reconciliation-${date}`} title={`Reconciliation — ${date}`} columns={reconciliationColumns(stations)} rows={records} />
          {canManage && (
            <Button variant="primary" onClick={() => setShowIngest((v) => !v)}>
              {showIngest ? 'Cancel' : 'Record daily totals'}
            </Button>
          )}
        </div>

        {showIngest && (
          <IngestForm
            stations={stations}
            defaultDate={date}
            onDone={() => {
              setShowIngest(false);
              reload();
            }}
          />
        )}

        <Card padding={0}>
          {records.length === 0 && <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>No reconciliation records for this date yet.</div>}
          {records.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Station</Th>
                  <Th>Product</Th>
                  <Th align="right">Total sales</Th>
                  <Th align="right">Loyalty sales</Th>
                  <Th align="right">%</Th>
                  <Th align="right">Headroom</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {paged.map((r) => (
                  <Tr key={r.id}>
                    <Td>{stations.find((s) => s.id === r.stationId)?.name ?? 'Unknown station'}</Td>
                    <Td>{r.product}</Td>
                    <Td align="right">KSh {r.totalSales.toLocaleString('en-KE')}</Td>
                    <Td align="right">KSh {r.loyaltySales.toLocaleString('en-KE')}</Td>
                    <Td align="right">{r.percentage.toFixed(1)}%</Td>
                    <Td align="right">KSh {r.headroom.toLocaleString('en-KE')}</Td>
                    <Td>
                      <Badge tone={STATUS_TONE[r.status]}>{r.status.replace('_', ' ')}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${records.length} record(s)`} />
        </Card>
      </div>
    </AppShell>
  );
}

function IngestForm({ stations, defaultDate, onDone }: { stations: Station[]; defaultDate: string; onDone: () => void }) {
  const api = useApi();
  const [stationId, setStationId] = useState('');
  const [product, setProduct] = useState<'PMS' | 'AGO'>('PMS');
  const [totalSales, setTotalSales] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.reconciliation.ingestDailyTotals({
        stationId,
        product: product as never,
        date: new Date(defaultDate).toISOString(),
        totalSales: Number(totalSales),
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record totals');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        <Field label="Station">
          <select style={inputStyle} value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">Choose station</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Product">
          <select style={inputStyle} value={product} onChange={(e) => setProduct(e.target.value as 'PMS' | 'AGO')}>
            <option value="PMS">PMS</option>
            <option value="AGO">AGO</option>
          </select>
        </Field>
        <Field label="Total sales (KSh)">
          <input type="number" style={inputStyle} value={totalSales} onChange={(e) => setTotalSales(e.target.value)} />
        </Field>
      </div>
      <Button variant="primary" onClick={submit} disabled={busy || !stationId || !totalSales} style={{ marginTop: 14 }}>
        {busy ? 'Saving…' : 'Save daily total'}
      </Button>
    </Card>
  );
}
