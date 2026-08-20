import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useRealtimeRefresh } from '../data/realtime';
import { AppShell } from '../layout/AppShell';
import { Card, KpiTile } from '../ui/primitives';

interface DashboardData {
  month: string;
  totalCashbackMonth: number;
  totalSalesAmountMonth: number;
  saleCount: number;
  uniqueCustomers: number;
  pendingSpecialRateRequests: number;
  reconciliationRecordsNeedingAttention: number;
}

export function Dashboard() {
  const api = useApi();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  function reload() {
    api.reports
      .dashboard()
      .then((d) => setData(d as DashboardData))
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api]);
  useRealtimeRefresh(['sales', 'customers', 'specialRateRequests', 'reconciliationDaily'], reload);

  const kpis = data
    ? [
        { label: 'Cashback this month', value: `KSh ${format(data.totalCashbackMonth)}`, note: data.month, color: 'var(--color-primary)', go: '/cashback-ledgers' },
        { label: 'Sales amount this month', value: `KSh ${format(data.totalSalesAmountMonth)}`, note: `${data.saleCount} sales`, go: '/sales' },
        { label: 'Customers active this month', value: data.uniqueCustomers, note: 'across all stations', go: '/customers' },
        {
          label: 'Special rate requests',
          value: data.pendingSpecialRateRequests,
          note: 'awaiting Chairman decision',
          color: data.pendingSpecialRateRequests > 0 ? 'var(--color-warning)' : undefined,
          go: '/special-rates',
        },
        {
          label: 'Reconciliation needs attention',
          value: data.reconciliationRecordsNeedingAttention,
          note: 'stations/products',
          color: data.reconciliationRecordsNeedingAttention > 0 ? 'var(--color-danger)' : undefined,
          go: '/reconciliation',
        },
      ]
    : [];

  return (
    <AppShell title="Dashboard" subtitle={`Welcome back, ${user?.fullName ?? ''}`}>
      {loading && <div style={{ color: 'var(--color-text-secondary)' }}>Loading…</div>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            {kpis.map((k) => (
              <KpiTile key={k.label} label={k.label} value={k.value} note={k.note} color={k.color} onClick={() => navigate(k.go)} />
            ))}
          </div>

          <Card>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, marginBottom: 4 }}>
              What needs your attention
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
              {data.pendingSpecialRateRequests > 0 && (
                <div>
                  • {data.pendingSpecialRateRequests} special rate request(s) are waiting on a decision.
                </div>
              )}
              {data.reconciliationRecordsNeedingAttention > 0 && (
                <div>
                  • {data.reconciliationRecordsNeedingAttention} station/product day(s) are near or over their
                  loyalty-sales limit.
                </div>
              )}
              {data.pendingSpecialRateRequests === 0 && data.reconciliationRecordsNeedingAttention === 0 && (
                <div>Nothing needs attention right now.</div>
              )}
            </div>
          </Card>
        </div>
      )}
    </AppShell>
  );
}

function format(n: number): string {
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
}
