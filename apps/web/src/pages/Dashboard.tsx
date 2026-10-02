import type { Sale, SalesReportGroup } from '@loyalty/shared';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useCustomersCache } from '../data/useCustomersCache';
import type { DashboardData, DashboardPeriod, DashboardStationTotal, DashboardTrendDay } from '../data/useDashboardCache';
import { useRealtimeRefresh } from '../data/realtime';
import { AppShell } from '../layout/AppShell';
import { formatNairobiDateTime } from '../lib/time';
import { Badge, Button, Card, KpiTile, Table, Td, Th, Tr } from '../ui/primitives';

const RECENT_SALES_LIMIT = 8;

const PERIOD_OPTIONS: { value: DashboardPeriod; label: string; kpiLabel: string }[] = [
  { value: 'today', label: 'Today', kpiLabel: 'today' },
  { value: 'week', label: 'This week', kpiLabel: 'this week' },
  { value: 'month', label: 'This month', kpiLabel: 'this month' },
  { value: 'year', label: 'This year', kpiLabel: 'this year' },
];

/** Fetches the dashboard summary for one KPI period — a fresh call per period, not the cross-page cached month-only snapshot (see useDashboardCache), since the whole point here is switching periods on the fly. */
function useDashboardPeriodData(period: DashboardPeriod): DashboardData | null {
  const api = useApi();
  const [data, setData] = useState<DashboardData | null>(null);

  function reload() {
    api.reports.dashboard(undefined, period).then((res) => setData(res as DashboardData));
  }
  useEffect(reload, [api, period]);
  useRealtimeRefresh(['sales', 'customers', 'reconciliationDaily'], reload);

  return data;
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<DashboardPeriod>('month');
  const data = useDashboardPeriodData(period);
  const periodLabel = PERIOD_OPTIONS.find((p) => p.value === period)!.kpiLabel;

  const kpis = data
    ? [
        {
          label: `Cashback ${periodLabel}`,
          value: `KSh ${format(data.totalCashbackMonth)}`,
          color: 'var(--color-primary)',
          go: '/cashback-ledgers',
        },
        {
          label: `Sales amount ${periodLabel}`,
          value: `KSh ${format(data.totalSalesAmountMonth)}`,
          note: `${data.saleCount} sales`,
          go: '/sales',
        },
        {
          label: `Customers active ${periodLabel}`,
          value: data.uniqueCustomers,
          note: 'across all stations',
          go: '/customers',
        },
        {
          label: `Sales ${periodLabel}`,
          value: data.saleCount,
          note: 'number of sales',
          go: '/sales',
        },
        {
          label: 'Reconciliation needs attention',
          value: data.reconciliationRecordsNeedingAttention,
          note: 'stations/products, today',
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
              display: 'inline-flex',
              alignSelf: 'flex-start',
              background: 'var(--color-surface-sunken)',
              borderRadius: 999,
              padding: 3,
              gap: 2,
            }}
          >
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPeriod(opt.value)}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  borderRadius: 999,
                  padding: '7px 14px',
                  fontSize: 12.5,
                  fontWeight: 700,
                  fontFamily: 'var(--font-body)',
                  background: period === opt.value ? 'var(--color-surface)' : 'transparent',
                  color: period === opt.value ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  boxShadow: period === opt.value ? 'var(--shadow-sm)' : 'none',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

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

          <TrendAnalysisCard trend={data.trend} />

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
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>Top sales assistants this month</div>
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
              <Th>Sales Assistant</Th>
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
  trend: DashboardTrendDay[];
  stationTotals: DashboardStationTotal[] | null;
}) {
  const week = trend.slice(-7).map((d) => ({
    ...d,
    label: new Date(`${d.date}T00:00:00.000Z`).toLocaleDateString('en-KE', { weekday: 'short', timeZone: 'UTC' }),
  }));
  const [animate, setAnimate] = useState(false);
  const [hovered, setHovered] = useState<string | null>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const max = Math.max(1, ...week.flatMap((d) => [d.pms, d.ago]));
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
        {week.map((d, i) => (
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

const CHART_W = 640;
const CHART_H = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 48 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

function compact(n: number): string {
  return n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${+(n / 1000).toFixed(1)}k` : String(n);
}

function TrendAnalysisCard({ trend }: { trend: DashboardTrendDay[] }) {
  const [hovered, setHovered] = useState<number | null>(null);

  const n = trend.length;
  const yMax = niceMax(Math.max(0, ...trend.flatMap((d) => [d.pms, d.ago])));
  const plotW = CHART_W - PAD.left - PAD.right;
  const plotH = CHART_H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => PAD.top + plotH - (v / yMax) * plotH;
  const line = (pick: (d: DashboardTrendDay) => number) =>
    trend.map((d, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(pick(d)).toFixed(1)}`).join(' ');

  const totals = trend.map((d) => d.pms + d.ago);
  const grandTotal = totals.reduce((a, b) => a + b, 0);
  const peakIdx = totals.reduce((best, v, i) => (v > totals[best]! ? i : best), 0);
  const half = Math.floor(n / 2);
  const earlier = totals.slice(0, half).reduce((a, b) => a + b, 0);
  const recent = totals.slice(half).reduce((a, b) => a + b, 0);
  const change = earlier > 0 ? ((recent - earlier) / earlier) * 100 : null;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const xTickEvery = 5;

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * CHART_W;
    const i = Math.round(((px - PAD.left) / plotW) * (n - 1));
    setHovered(Math.min(n - 1, Math.max(0, i)));
  }

  const h = hovered != null ? trend[hovered] : null;

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15 }}>
          Loyalty sales trend · last 30 days
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--color-fuel-pms)' }} />
            Petrol (PMS)
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: 'var(--color-fuel-ago)' }} />
            Diesel (AGO)
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginTop: 12, fontSize: 12, color: 'var(--color-text-secondary)' }}>
        <div>
          <div>Total</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
            KSh {format(grandTotal)}
          </div>
        </div>
        <div>
          <div>Daily average</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
            KSh {format(n ? grandTotal / n : 0)}
          </div>
        </div>
        <div>
          <div>Peak day</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--color-text)', fontVariantNumeric: 'tabular-nums' }}>
            {grandTotal > 0 ? `${trend[peakIdx]!.label} · KSh ${format(totals[peakIdx]!)}` : '—'}
          </div>
        </div>
        <div>
          <div>Last {n - half} days vs previous {half}</div>
          <div
            style={{
              fontWeight: 800,
              fontSize: 16,
              fontVariantNumeric: 'tabular-nums',
              color: change == null ? 'var(--color-text)' : change >= 0 ? 'var(--color-success, var(--color-primary))' : 'var(--color-danger)',
            }}
          >
            {change == null ? '—' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%`}
          </div>
        </div>
      </div>

      <div style={{ position: 'relative', marginTop: 12 }}>
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          width="100%"
          role="img"
          aria-label="Daily petrol and diesel loyalty sales amount over the last 30 days"
          onMouseMove={onMove}
          onMouseLeave={() => setHovered(null)}
          style={{ display: 'block', overflow: 'visible' }}
        >
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD.left} x2={CHART_W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--color-border)" strokeWidth={1} />
              <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--color-text-muted)">
                {compact(t)}
              </text>
            </g>
          ))}
          {trend.map((d, i) =>
            i % xTickEvery === 0 || i === n - 1 ? (
              <text key={d.date} x={x(i)} y={CHART_H - 6} textAnchor="middle" fontSize={11} fill="var(--color-text-muted)">
                {d.label}
              </text>
            ) : null,
          )}
          <path d={line((d) => d.pms)} fill="none" stroke="var(--color-fuel-pms)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          <path d={line((d) => d.ago)} fill="none" stroke="var(--color-fuel-ago)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hovered != null && h && (
            <g pointerEvents="none">
              <line x1={x(hovered)} x2={x(hovered)} y1={PAD.top} y2={PAD.top + plotH} stroke="var(--color-text-muted)" strokeWidth={1} strokeDasharray="3 3" />
              <circle cx={x(hovered)} cy={y(h.pms)} r={4.5} fill="var(--color-fuel-pms)" stroke="var(--color-surface)" strokeWidth={2} />
              <circle cx={x(hovered)} cy={y(h.ago)} r={4.5} fill="var(--color-fuel-ago)" stroke="var(--color-surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {h && hovered != null && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: `${(x(hovered) / CHART_W) * 100}%`,
              transform: hovered > n / 2 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)',
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
            <div style={{ fontWeight: 800, marginBottom: 3 }}>{h.label}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-fuel-pms)' }} />
              Petrol: KSh {format(h.pms)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--color-fuel-ago)' }} />
              Diesel: KSh {format(h.ago)}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function format(n: number): string {
  return n.toLocaleString('en-KE', { maximumFractionDigits: 0 });
}
