import type { SalesReportGroup, SalesReportGroupBy, Station } from '@loyalty/shared';
import { Role } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useDashboardSnapshot } from '../data/useDashboardCache';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { nairobiToday } from '../lib/time';
import { ExportButtons } from '../ui/ExportButtons';
import { Card, KpiTile, Table, Td, Th, Tr, inputStyle, Button } from '../ui/primitives';
import { SendReportEmailModal } from '../ui/SendReportEmailModal';

type RangePreset = 'this_month' | 'this_quarter' | 'ytd' | 'custom';

const GROUP_LABEL: Record<SalesReportGroupBy, string> = {
  attendant: 'Sales Assistant',
  station: 'Station',
  shift: 'Shift',
  product: 'Product',
};

const RANGE_LABEL: Record<RangePreset, string> = {
  this_month: 'This month',
  this_quarter: 'This quarter',
  ytd: 'Year to date',
  custom: 'Custom range',
};

function groupColumns(groupBy: SalesReportGroupBy): ExportColumn<SalesReportGroup>[] {
  return [
    { header: GROUP_LABEL[groupBy], value: (g) => g.label },
    { header: 'Sales', value: (g) => g.count },
    { header: 'Amount (KSh)', value: (g) => g.amount },
    { header: 'Cashback (KSh)', value: (g) => g.cashback },
  ];
}

export function Reports() {
  const api = useApi();
  const { user } = useAuth();
  const lockedStationId = user?.role === Role.STATION_SUPERVISOR ? user.assignedStationId : undefined;
  const { stations } = useStations();
  const { data: dashboard } = useDashboardSnapshot();

  const [stationId, setStationId] = useState(lockedStationId ?? '');
  const [groupBy, setGroupBy] = useState<SalesReportGroupBy>('station');
  const [range, setRange] = useState<RangePreset>('this_month');
  const [from, setFrom] = useState(nairobiToday);
  const [to, setTo] = useState(nairobiToday);
  const [groups, setGroups] = useState<SalesReportGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEmailModal, setShowEmailModal] = useState(false);

  function reload() {
    setLoading(true);
    api.reports
      .sales({
        stationId: stationId || undefined,
        groupBy,
        ...(range === 'custom' ? { from, to } : { preset: range }),
      })
      .then((r) => setGroups(r.groups))
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api, stationId, groupBy, range, from, to]);

  const maxAmount = Math.max(1, ...groups.map((g) => g.amount));

  return (
    <AppShell title="Reports" subtitle="Sales broken down by sales assistant, station, shift, or product, over any date range">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {dashboard && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
            <KpiTile label="Cashback this month" value={`KSh ${Number(dashboard.totalCashbackMonth).toLocaleString('en-KE')}`} />
            <KpiTile label="Sales this month" value={`KSh ${Number(dashboard.totalSalesAmountMonth).toLocaleString('en-KE')}`} />
            <KpiTile label="Sale count" value={dashboard.saleCount} />
            <KpiTile label="Unique customers" value={dashboard.uniqueCustomers} />
          </div>
        )}

        <Card padding={0}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 16, borderBottom: '1px solid var(--color-border)' }}>
            <select style={{ ...inputStyle, maxWidth: 180 }} value={groupBy} onChange={(e) => setGroupBy(e.target.value as SalesReportGroupBy)}>
              {(Object.keys(GROUP_LABEL) as SalesReportGroupBy[]).map((g) => (
                <option key={g} value={g}>
                  Group by {GROUP_LABEL[g]}
                </option>
              ))}
            </select>
            <select style={{ ...inputStyle, maxWidth: 180 }} value={range} onChange={(e) => setRange(e.target.value as RangePreset)}>
              {(Object.keys(RANGE_LABEL) as RangePreset[]).map((r) => (
                <option key={r} value={r}>
                  {RANGE_LABEL[r]}
                </option>
              ))}
            </select>
            {range === 'custom' && (
              <>
                <input type="date" style={{ ...inputStyle, maxWidth: 160 }} value={from} onChange={(e) => setFrom(e.target.value)} />
                <input type="date" style={{ ...inputStyle, maxWidth: 160 }} value={to} onChange={(e) => setTo(e.target.value)} />
              </>
            )}
            {!lockedStationId && stations.length > 0 && (
              <select style={{ ...inputStyle, maxWidth: 200 }} value={stationId} onChange={(e) => setStationId(e.target.value)}>
                <option value="">All stations</option>
                {stations.map((s: Station) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <div style={{ flex: 1 }} />
            <ExportButtons filename={`sales-by-${groupBy}`} title={`Sales by ${GROUP_LABEL[groupBy]}`} columns={groupColumns(groupBy)} rows={groups} />
            <Button variant="secondary" size="sm" onClick={() => setShowEmailModal(true)}>
              Send email
            </Button>
          </div>

          {!loading && groups.length === 0 && (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>No sales in this range.</div>
          )}
          {groups.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>{GROUP_LABEL[groupBy]}</Th>
                  <Th align="right">Sales</Th>
                  <Th align="right">Amount</Th>
                  <Th align="right">Cashback</Th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Tr key={g.key}>
                    <Td>{g.label}</Td>
                    <Td align="right">{g.count}</Td>
                    <Td align="right">
                      <div style={{ position: 'relative' }}>
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            right: `${100 - (g.amount / maxAmount) * 100}%`,
                            background: 'var(--color-primary-tint)',
                            borderRadius: 4,
                            zIndex: 0,
                          }}
                        />
                        <span style={{ position: 'relative', zIndex: 1 }}>KSh {g.amount.toLocaleString('en-KE')}</span>
                      </div>
                    </Td>
                    <Td align="right">KSh {g.cashback.toLocaleString('en-KE')}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {showEmailModal && (
        <SendReportEmailModal
          reportParams={{
            stationId: stationId || undefined,
            groupBy,
            ...(range === 'custom' ? { from, to } : { preset: range }),
          }}
          onClose={() => setShowEmailModal(false)}
        />
      )}
    </AppShell>
  );
}
