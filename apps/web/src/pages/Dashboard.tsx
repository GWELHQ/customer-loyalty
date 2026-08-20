import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useRealtimeRefresh } from '../data/realtime';
import { AppShell } from '../layout/AppShell';
import { Card, KpiTile } from '../ui/primitives';

interface TrendDay {
  date: string;
  label: string;
  pms: number;
  ago: number;
}

interface StationTotal {
  stationId: string;
  name: string;
  value: number;
}

interface DashboardData {
  month: string;
  totalCashbackMonth: number;
  totalSalesAmountMonth: number;
  saleCount: number;
  uniqueCustomers: number;
  pendingSpecialRateRequests: number | null;
  reconciliationRecordsNeedingAttention: number;
  trend: TrendDay[];
  stationTotals: StationTotal[] | null;
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
        ...(data.pendingSpecialRateRequests !== null
          ? [
              {
                label: 'Special rate requests',
                value: data.pendingSpecialRateRequests,
                note: 'awaiting Chairman decision',
                color: data.pendingSpecialRateRequests > 0 ? 'var(--color-warning)' : undefined,
                go: '/special-rates',
              },
            ]
          : []),
        {
          label: 'Reconciliation needs attention',
          value: data.reconciliationRecordsNeedingAttention,
          note: 'stations/products',
          color: data.reconciliationRecordsNeedingAttention > 0 ? 'var(--color-danger)' : undefined,
          go: '/reconciliation',
        },
      ]
    : [];

  const attention = data
    ? [
        ...(data.pendingSpecialRateRequests !== null && data.pendingSpecialRateRequests > 0
          ? [
              {
                title: `${data.pendingSpecialRateRequests} special rate request(s) waiting`,
                body: 'Awaiting a decision from the Chairman.',
                dot: 'var(--gw-amber-500)',
                go: '/special-rates',
              },
            ]
          : []),
        ...(data.reconciliationRecordsNeedingAttention > 0
          ? [
              {
                title: `${data.reconciliationRecordsNeedingAttention} station/product day(s) need review`,
                body: 'Near or over their loyalty-sales limit.',
                dot: 'var(--color-danger)',
                go: '/reconciliation',
              },
            ]
          : []),
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

          <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 16, alignItems: 'start' }}>
            <TrendCard trend={data.trend} stationTotals={data.stationTotals} />

            <Card padding={0}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>What needs your attention</div>
                <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{attention.length} item(s)</span>
              </div>
              {attention.length === 0 && (
                <div style={{ padding: 16, fontSize: 13, color: 'var(--color-text-secondary)' }}>Nothing needs attention right now.</div>
              )}
              {attention.map((a) => (
                <button
                  key={a.title}
                  onClick={() => navigate(a.go)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'none',
                    border: 'none',
                    borderBottom: '1px solid var(--color-border)',
                    padding: '12px 16px',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 11,
                    alignItems: 'flex-start',
                  }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 999, background: a.dot, marginTop: 6, flexShrink: 0 }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: 'var(--color-text)' }}>{a.title}</span>
                    <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.45 }}>{a.body}</span>
                  </span>
                </button>
              ))}
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function TrendCard({ trend, stationTotals }: { trend: TrendDay[]; stationTotals: StationTotal[] | null }) {
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const max = Math.max(1, ...trend.flatMap((d) => [d.pms, d.ago]));
  const barHeight = (v: number) => `${Math.max(v > 0 ? 3 : 0, (v / max) * 100)}%`;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>Loyalty sales by product · last 7 days</div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--color-primary)' }} />
            Petrol (PMS)
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--gw-blue-500)' }} />
            Diesel (AGO)
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, height: 168, marginTop: 18, paddingBottom: 4 }}>
        {trend.map((d, i) => (
          <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', gap: 3, height: 140 }}>
              <div
                title={`Petrol: KSh ${format(d.pms)}`}
                style={{
                  width: '40%',
                  height: animate ? barHeight(d.pms) : '0%',
                  background: 'var(--color-primary)',
                  borderRadius: '3px 3px 0 0',
                  transition: `height 600ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 45}ms`,
                }}
              />
              <div
                title={`Diesel: KSh ${format(d.ago)}`}
                style={{
                  width: '40%',
                  height: animate ? barHeight(d.ago) : '0%',
                  background: 'var(--gw-blue-500)',
                  borderRadius: '3px 3px 0 0',
                  transition: `height 600ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 45 + 60}ms`,
                }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)' }}>{d.label}</div>
          </div>
        ))}
      </div>

      {stationTotals && stationTotals.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
            Today's sales by station — unrelated to the days above
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${stationTotals.length}, 1fr)`,
              gap: 10,
              background: 'var(--color-surface-sunken)',
              borderRadius: 8,
              padding: 10,
            }}
          >
            {stationTotals.map((st) => (
              <div key={st.stationId}>
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{st.name}</div>
                <div style={{ fontWeight: 800, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>KSh {format(st.value)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function format(n: number): string {
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
}
