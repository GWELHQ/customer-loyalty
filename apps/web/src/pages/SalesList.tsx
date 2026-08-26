import type { Sale } from '@loyalty/shared';
import { useEffect, useMemo, useState } from 'react';
import { useApi } from '../data/client';
import { useCustomersCache } from '../data/useCustomersCache';
import { useRealtimeRefresh } from '../data/realtime';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { formatNairobiDateTime } from '../lib/time';
import { ExportButtons } from '../ui/ExportButtons';
import { Badge, Button, Card, EmptyState, Pagination, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

const PAGE_SIZE = 25;

const SALE_COLUMNS: ExportColumn<Sale>[] = [
  { header: 'Date', value: (s) => formatNairobiDateTime(s.saleDate) },
  { header: 'Station', value: (s) => s.stationNameAtSale },
  { header: 'Attendant', value: (s) => s.attendantNameAtSale },
  { header: 'Product', value: (s) => s.product },
  { header: 'Amount paid (KSh)', value: (s) => s.amountPaid },
  { header: 'Litres', value: (s) => s.snapshot.litres },
  { header: 'Cashback rate (KSh/L)', value: (s) => s.snapshot.cashbackRatePerLitre },
  { header: 'Cashback earned (KSh)', value: (s) => s.snapshot.cashbackEarned },
  { header: 'SMS status', value: (s) => s.smsStatus },
  { header: 'Source', value: (s) => s.source },
  { header: 'Approval', value: (s) => approvalLabel(s.approvalStatus) },
];

export function SalesList() {
  const api = useApi();
  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const { stations } = useStations();
  const [stationId, setStationId] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Sale | null>(null);
  const { customers } = useCustomersCache();
  const customerNames = useMemo(() => new Map(customers.map((c) => [c.id, c.fullName])), [customers]);

  function reload() {
    setLoading(true);
    api.sales
      .list({ page, pageSize: PAGE_SIZE, stationId: stationId || undefined })
      .then((res) => {
        setSales(res.items);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api, stationId, page]);
  useRealtimeRefresh(['sales'], reload);
  useEffect(() => setPage(1), [stationId]);

  function customerName(s: Sale): string {
    return customerNames.get(s.customerId) ?? s.customerPhoneAtSale;
  }

  async function fetchAllForExport(): Promise<Sale[]> {
    const all: Sale[] = [];
    for (let p = 1; ; p++) {
      const res = await api.sales.list({ page: p, pageSize: 100, stationId: stationId || undefined });
      all.push(...res.items);
      if (res.items.length < 100 || all.length >= res.total) break;
    }
    return all;
  }

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function retrySms(sale: Sale) {
    await api.sales.retrySms(sale.id);
  }

  return (
    <AppShell title="Sales activity" subtitle="Every sale keeps an immutable snapshot of how its cashback was calculated">
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        {stations.length > 0 && (
          <select style={{ ...inputStyle, maxWidth: 220 }} value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">All stations</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <ExportButtons filename="sales" title="Sales activity" columns={SALE_COLUMNS} rows={fetchAllForExport} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 16 }}>
        <Card padding={0}>
          {loading && <div style={{ padding: 20, color: 'var(--color-text-secondary)' }}>Loading…</div>}
          {!loading && sales.length === 0 && <EmptyState title="No sales recorded yet" />}
          {!loading && sales.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Station</Th>
                  <Th>Customer</Th>
                  <Th>Attendant</Th>
                  <Th>Product</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Cashback</Th>
                  <Th>SMS</Th>
                  <Th>Approval</Th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <Tr key={s.id} onClick={() => setSelected(s)}>
                    <Td>{formatNairobiDateTime(s.saleDate)}</Td>
                    <Td>{s.stationNameAtSale}</Td>
                    <Td>{customerName(s)}</Td>
                    <Td>{s.attendantNameAtSale}</Td>
                    <Td>{s.product}</Td>
                    <Td align="right">KSh {s.amountPaid.toLocaleString('en-KE')}</Td>
                    <Td align="right">
                      <strong>KSh {s.snapshot.cashbackEarned}</strong>
                    </Td>
                    <Td>
                      <Badge tone={s.smsStatus === 'sent' ? 'success' : s.smsStatus === 'failed' ? 'danger' : 'neutral'}>
                        {smsStatusLabel(s.smsStatus)}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={approvalTone(s.approvalStatus)}>{approvalLabel(s.approvalStatus)}</Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
          <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${total} sale(s)`} />
        </Card>

        {selected && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>Sale detail</div>
              <button onClick={() => setSelected(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}>
                ×
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>Immutable — this is exactly what was recorded at sale time</div>

            <DetailRow label="Customer" value={customerName(selected)} />
            <DetailRow label="Customer phone" value={selected.customerPhoneAtSale} />
            <DetailRow label="Station" value={selected.stationNameAtSale} />
            <DetailRow label="Attendant" value={selected.attendantNameAtSale} />
            <DetailRow label="Product" value={selected.product} />
            <DetailRow label="Amount paid" value={`KSh ${selected.amountPaid}`} />
            <DetailRow label="Price per litre (snapshot)" value={`KSh ${selected.snapshot.pricePerLitre}`} />
            <DetailRow label="Litres" value={`${selected.snapshot.litres}`} />
            <DetailRow label="Whole litres" value={`${selected.snapshot.wholeLitres}`} />
            <DetailRow label="Cashback rate" value={`KSh ${selected.snapshot.cashbackRatePerLitre} / litre`} />
            <DetailRow label="Cashback earned" value={`KSh ${selected.snapshot.cashbackEarned}`} strong />
            <DetailRow label="Source" value={selected.source} />
            <DetailRow label="SMS status" value={smsStatusLabel(selected.smsStatus)} />
            <DetailRow label="Approval" value={approvalLabel(selected.approvalStatus)} />
            {selected.approvalDecidedByName && (
              <DetailRow
                label={selected.approvalStatus === 'rejected' ? 'Rejected by' : 'Approved by'}
                value={`${selected.approvalDecidedByName}${selected.approvalDecidedAt ? ` · ${formatNairobiDateTime(selected.approvalDecidedAt)}` : ''}`}
              />
            )}
            {selected.rejectionReason && <DetailRow label="Rejection reason" value={selected.rejectionReason} />}
            {selected.licensePlateCheck && (
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>License plate</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {selected.licensePlateCheck.detectedPlateNumber ?? 'Not detected'}
                  <Badge tone={selected.licensePlateCheck.matched ? 'success' : 'danger'}>
                    {selected.licensePlateCheck.matched ? 'Matched' : 'Mismatch'}
                  </Badge>
                </span>
              </div>
            )}

            {selected.smsStatus === 'failed' && (
              <Button variant="secondary" size="sm" onClick={() => retrySms(selected)} style={{ marginTop: 12 }}>
                Retry SMS
              </Button>
            )}
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function smsStatusLabel(status: Sale['smsStatus']): string {
  return status === 'not_applicable' ? 'No cashback' : status;
}

// Undefined = a legacy sale recorded before the approval gate existed — already credited the old way.
function approvalLabel(status: Sale['approvalStatus']): string {
  if (!status || status === 'approved') return 'Approved';
  if (status === 'pending_approval') return 'Pending approval';
  return 'Rejected';
}

function approvalTone(status: Sale['approvalStatus']): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (!status || status === 'approved') return 'success';
  if (status === 'pending_approval') return 'warning';
  return 'danger';
}

function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: strong ? 800 : 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
