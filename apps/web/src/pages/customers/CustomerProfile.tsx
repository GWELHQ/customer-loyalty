import type { Customer, Sale } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useApi } from '../../data/client';
import { usePagedRows } from '../../data/usePagedRows';
import { useRealtimeRefresh } from '../../data/realtime';
import { AppShell } from '../../layout/AppShell';
import type { ExportColumn } from '../../lib/exportTable';
import { ExportButtons } from '../../ui/ExportButtons';
import { Badge, Card, CardHeader, EmptyState, Pagination, Table, Td, Th, Tr } from '../../ui/primitives';

const SALE_COLUMNS: ExportColumn<Sale>[] = [
  { header: 'Date', value: (s) => new Date(s.saleDate).toLocaleDateString('en-KE') },
  { header: 'Station', value: (s) => s.stationNameAtSale },
  { header: 'Product', value: (s) => s.product },
  { header: 'Amount paid (KSh)', value: (s) => s.amountPaid },
  { header: 'Litres', value: (s) => s.snapshot.wholeLitres },
  { header: 'Cashback (KSh)', value: (s) => s.snapshot.cashbackEarned },
];

export function CustomerProfile() {
  const { id } = useParams<{ id: string }>();
  const api = useApi();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const { paged, page, pageCount, setPage } = usePagedRows(sales);

  function reload() {
    if (!id) return;
    Promise.all([api.customers.get(id), api.reports.customerActivity(id)])
      .then(([c, activity]) => {
        setCustomer(c);
        setSales((activity as { sales: Sale[] }).sales ?? []);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api, id]);
  useRealtimeRefresh(['customers', 'sales'], reload);

  if (loading) return <AppShell title="Customer">Loading…</AppShell>;
  if (!customer) return <AppShell title="Customer not found">This customer could not be found.</AppShell>;

  const hasSpecialRate = !!customer.specialRateKesPerLitre;

  return (
    <AppShell title={customer.fullName} subtitle={customer.phoneNumber}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 16, alignItems: 'start' }}>
        <Card>
          <CardHeader
            title="Sales history"
            subtitle={`${sales.length} sale(s) recorded`}
            right={sales.length > 0 && <ExportButtons filename={`customer-${customer.id}-sales`} title={`${customer.fullName} — sales history`} columns={SALE_COLUMNS} rows={sales} />}
          />
          <div style={{ marginTop: 12 }}>
            {sales.length === 0 && <EmptyState title="No sales yet" body="This customer hasn't fuelled at any station yet." />}
            {sales.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Station</Th>
                    <Th>Product</Th>
                    <Th align="right">Amount paid</Th>
                    <Th align="right">Litres</Th>
                    <Th align="right">Cashback</Th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((s) => (
                    <Tr key={s.id}>
                      <Td>{new Date(s.saleDate).toLocaleDateString('en-KE')}</Td>
                      <Td>{s.stationNameAtSale}</Td>
                      <Td>{s.product}</Td>
                      <Td align="right">KSh {s.amountPaid.toLocaleString('en-KE')}</Td>
                      <Td align="right">{s.snapshot.wholeLitres} L</Td>
                      <Td align="right">
                        <strong>KSh {s.snapshot.cashbackEarned}</strong>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${sales.length} sale(s)`} />
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Card>
            <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>Total cashback earned</div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28, marginTop: 4 }}>
              KSh {customer.totalCashbackEarned.toLocaleString('en-KE')}
            </div>
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Cashback rate</div>
            {hasSpecialRate ? (
              <div style={{ marginTop: 8 }}>
                <Badge tone="info">Special rate: KSh {customer.specialRateKesPerLitre} / litre</Badge>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                  Effective from {customer.specialRateEffectiveFrom && new Date(customer.specialRateEffectiveFrom).toLocaleDateString('en-KE')}
                  {customer.specialRateEffectiveTo && ` to ${new Date(customer.specialRateEffectiveTo).toLocaleDateString('en-KE')}`}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                Standard rate — KSh 2 per whole litre.
              </div>
            )}
          </Card>

          <Card>
            <div style={{ fontWeight: 700, fontSize: 14 }}>Record source</div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
              {customer.source === 'import' ? 'Bulk Excel import' : customer.source === 'android' ? 'Registered on Android' : 'Added manually'}
              {' · '}
              {new Date(customer.createdAt).toLocaleDateString('en-KE')}
            </div>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
