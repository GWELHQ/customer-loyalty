import type { Sale, SalesReportGroup } from '@loyalty/shared';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useCustomersCache } from '../data/useCustomersCache';
import { useDashboardSnapshot, type DashboardStationTotal, type DashboardTrendDay } from '../data/useDashboardCache';
import { useRealtimeRefresh } from '../data/realtime';
import { AppShell } from '../layout/AppShell';
import { formatNairobiDateTime } from '../lib/time';
import { Badge, Button, Card, KpiTile, Table, Td, Th, Tr } from '../ui/primitives';

const RECENT_SALES_LIMIT = 8;

type TrendDay = DashboardTrendDay;
type StationTotal = DashboardStationTotal;

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data } = useDashboardSnapshot();

  const kpis = data
    ? [
        {
          label: 'Cashback this month',
          value: `KSh ${format(data.totalCashbackMonth)}`,
          note: data.month,
          color: 'var(--color-primary)',
          go: '/cashback-ledgers',
        },
        {
          label: 'Sales amount this month',
          value: `KSh ${format(data.totalSalesAmountMonth)}`,
          note: `${data.saleCount} sales`,
          go: '/sales',
        },
        {
          label: 'Customers active this month',
          value: data.uniqueCustomers,
          note: 'across all stations',
          go: '/customers',
        },
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

  return (
    <AppShell title="Dashboard" subtitle={`Welcome back, ${user?.fullName ?? ''}`}>
      {!data && <div style={{ color: 'var(--color-text-secondary)' }}>Loading…</div>}
      {data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 12,
            }}
          >
            {kpis.map((k) => (
              <KpiTile
                key={k.label}
                label={k.label}
                value={k.value}
                note={k.note}
                color={k.color}
                onClick={() => navigate(k.go)}
              />
            ))}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1.35fr 1fr',
              gap: 16,
              alignItems: 'start',
            }}
          >
            <TrendCard trend={data.trend} stationTotals={data.stationTotals} />

            <TopAttendantsCard />
          </div>

          <RecentSalesCard />
        </div>
      )}
    </AppShell>
  );
}

function RecentSalesCard() {
  const api = useApi();
  const navigate = useNavigate();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const { customers } = useCustomersCache();
  const customerNames = useMemo(() => new Map(customers.map((c) => [c.id, c.fullName])), [customers]);

  function reload() {
    api.sales
      .list({ page: 1, pageSize: RECENT_SALES_LIMIT })
      .then((res) => setSales(res.items))
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api]);
  useRealtimeRefresh(['sales'], reload);

  return (
    <Card padding={0}>
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>Recent sales</div>
        <Button variant="secondary" size="sm" onClick={() => navigate('/sales')}>
          View all
        </Button>
      </div>
      {!loading && sales.length === 0 && (
        <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>No sales recorded yet.</div>
      )}
      {sales.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Time</Th>
              <Th>Customer</Th>
              <Th>Station</Th>
              <Th>Product</Th>
              <Th align="right">Amount (KSh)</Th>
              <Th align="right">Cashback (KSh)</Th>
              <Th>SMS</Th>
            </tr>
          </thead>
          <tbody>
            {sales.map((s) => (
              <Tr key={s.id} onClick={() => navigate('/sales')}>
                <Td>{formatNairobiDateTime(s.saleDate)}</Td>
                <Td>{customerNames.get(s.customerId) ?? s.customerPhoneAtSale}</Td>
                <Td>{s.stationNameAtSale}</Td>
                <Td>{s.product}</Td>
                <Td align="right">{s.amountPaid.toLocaleString('en-KE')}</Td>
                <Td align="right">{s.snapshot.cashbackEarned.toLocaleString('en-KE')}</Td>
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
  );
}

function TopAttendantsCard() {
  const api = useApi();
  const navigate = useNavigate();
  const [groups, setGroups] = useState<SalesReportGroup[]>([]);
  const [loading, setLoading] = useState(true);

  function reload() {
    api.reports
      .sales({ preset: 'this_month', groupBy: 'attendant' })
      .then((r) => setGroups(r.groups.slice(0, 5)))
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api]);
  useRealtimeRefresh(['sales'], reload);

  return (
    <Card padding={0}>
      <div
        style={{
          padding: '14px 16px',
          borderBottom: '1px solid var(--color-border)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>Top service assistants this month</div>
        <Button variant="secondary" size="sm" onClick={() => navigate('/reports')}>
          View full report
        </Button>
      </div>
      {!loading && groups.length === 0 && (
        <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>No sales recorded this month yet.</div>
      )}
      {groups.length > 0 && (
        <Table>
          <thead>
            <tr>
              <Th>Service Assistant</Th>
              <Th align="right">Sales</Th>
              <Th align="right">Amount (KSh)</Th>
              <Th align="right">Cashback (KSh)</Th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Tr key={g.key} onClick={() => navigate('/reports')}>
                <Td>{g.label}</Td>
                <Td align="right">{g.count}</Td>
                <Td align="right">{g.amount.toLocaleString('en-KE')}</Td>
                <Td align="right">{g.cashback.toLocaleString('en-KE')}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function TrendCard({
  trend,
  stationTotals,
}: {
  trend: TrendDay[];
  stationTotals: StationTotal[] | null;
}) {
  const [animate, setAnimate] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const max = Math.max(1, ...trend.flatMap((d) => [d.pms, d.ago]));
  const barHeight = (v: number) => `${Math.max(v > 0 ? 3 : 0, (v / max) * 100)}%`;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>
          Loyalty sales by product · last 7 days
        </div>
        <div
          style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--color-text-secondary)' }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--color-fuel-pms)' }}
            />
            Petrol (PMS)
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--color-fuel-ago)' }}
            />
            Diesel (AGO)
          </span>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: 14,
          height: 168,
          marginTop: 18,
          paddingBottom: 4,
        }}
      >
        {trend.map((d, i) => (
          <div
            key={d.date}
            onMouseEnter={() => setHovered(d.date)}
            onMouseLeave={() => setHovered((h) => (h === d.date ? null : h))}
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
              position: 'relative',
            }}
          >
            {hovered === d.date && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '100%',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  marginBottom: 8,
                  background: 'var(--color-text)',
                  color: 'var(--color-surface)',
                  borderRadius: 8,
                  padding: '8px 11px',
                  fontSize: 12,
                  whiteSpace: 'nowrap',
                  boxShadow: '0 6px 16px rgba(0,0,0,.18)',
                  zIndex: 2,
                  pointerEvents: 'none',
                }}
              >
                <div style={{ fontWeight: 800, marginBottom: 3 }}>{d.label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-fuel-pms)' }} />
                  Petrol: KSh {format(d.pms)}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-fuel-ago)' }} />
                  Diesel: KSh {format(d.ago)}
                </div>
              </div>
            )}
            <div
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'center',
                gap: 3,
                height: 140,
              }}
            >
              <div
                style={{
                  width: '40%',
                  height: animate ? barHeight(d.pms) : '0%',
                  background: 'var(--color-fuel-pms)',
                  borderRadius: '3px 3px 0 0',
                  transition: `height 600ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 45}ms`,
                  opacity: hovered && hovered !== d.date ? 0.45 : 1,
                }}
              />
              <div
                style={{
                  width: '40%',
                  height: animate ? barHeight(d.ago) : '0%',
                  background: 'var(--color-fuel-ago)',
                  borderRadius: '3px 3px 0 0',
                  transition: `height 600ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 45 + 60}ms`,
                  opacity: hovered && hovered !== d.date ? 0.45 : 1,
                }}
              />
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', fontWeight: hovered === d.date ? 800 : 400 }}>
              {d.label}
            </div>
          </div>
        ))}
      </div>

      {stationTotals && stationTotals.length > 0 && (
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--color-border)' }}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: 'var(--color-text-secondary)',
              marginBottom: 10,
            }}
          >
            Today's sales by station
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
                <div style={{ fontWeight: 800, fontSize: 15, fontVariantNumeric: 'tabular-nums' }}>
                  KSh {format(st.value)}
                </div>
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
