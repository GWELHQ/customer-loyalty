import { createCachedResourceHook } from '../data/createCachedResource';
import { useDashboardSnapshot } from '../data/useDashboardCache';
import { AppShell } from '../layout/AppShell';
import { Card, KpiTile } from '../ui/primitives';

type SalesByProduct = { byProduct: Record<string, { count: number; amount: number; cashback: number }> };

// Same cached-snapshot-plus-silent-refresh approach as the Dashboard page,
// and literally the same dashboard cache — this is an unfiltered,
// whole-org summary, so sharing it is safe and avoids fetching it twice.
const { useCachedResource: useSalesByProduct } = createCachedResourceHook<SalesByProduct>(
  (api) => api.reports.sales({}) as Promise<SalesByProduct>,
  ['sales'],
);

export function Reports() {
  const { data: dashboard } = useDashboardSnapshot();
  const { data: sales } = useSalesByProduct();

  return (
    <AppShell title="Reports" subtitle="Operational summaries across every station">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {dashboard && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <KpiTile label="Cashback this month" value={`KSh ${Number(dashboard.totalCashbackMonth).toLocaleString('en-KE')}`} />
            <KpiTile label="Sales this month" value={`KSh ${Number(dashboard.totalSalesAmountMonth).toLocaleString('en-KE')}`} />
            <KpiTile label="Sale count" value={dashboard.saleCount} />
            <KpiTile label="Unique customers" value={dashboard.uniqueCustomers} />
          </div>
        )}

        {sales && (
          <Card>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, marginBottom: 10 }}>Sales by product</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              {Object.entries(sales.byProduct).map(([product, bucket]) => (
                <div key={product} style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 14 }}>
                  <div style={{ fontWeight: 800 }}>{product}</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 6 }}>{bucket.count} sales</div>
                  <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>KSh {bucket.amount.toLocaleString('en-KE')} total</div>
                  <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>KSh {bucket.cashback.toLocaleString('en-KE')} cashback</div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
