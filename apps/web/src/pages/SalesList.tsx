import type { Sale } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import { Badge, Button, Card, EmptyState, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

export function SalesList() {
  const api = useApi();
  const [sales, setSales] = useState<Sale[]>([]);
  const { stations } = useStations();
  const [stationId, setStationId] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Sale | null>(null);

  useEffect(() => {
    setLoading(true);
    api.sales
      .list({ page: 1, pageSize: 50, stationId: stationId || undefined })
      .then((res) => setSales(res.items))
      .finally(() => setLoading(false));
  }, [api, stationId]);

  async function retrySms(sale: Sale) {
    await api.sales.retrySms(sale.id);
  }

  return (
    <AppShell title="Sales activity" subtitle="Every sale keeps an immutable snapshot of how its cashback was calculated">
      <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
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
                  <Th>Attendant</Th>
                  <Th>Product</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Cashback</Th>
                  <Th>SMS</Th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <Tr key={s.id} onClick={() => setSelected(s)}>
                    <Td>{new Date(s.saleDate).toLocaleString('en-KE')}</Td>
                    <Td>{s.stationNameAtSale}</Td>
                    <Td>{s.attendantNameAtSale}</Td>
                    <Td>{s.product}</Td>
                    <Td align="right">KSh {s.amountPaid.toLocaleString('en-KE')}</Td>
                    <Td align="right">
                      <strong>KSh {s.snapshot.cashbackEarned}</strong>
                    </Td>
                    <Td>
                      <Badge tone={s.smsStatus === 'sent' ? 'success' : s.smsStatus === 'failed' ? 'danger' : 'neutral'}>
                        {s.smsStatus}
                      </Badge>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
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
            <DetailRow label="SMS status" value={selected.smsStatus} />

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

function DetailRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: strong ? 800 : 600, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
