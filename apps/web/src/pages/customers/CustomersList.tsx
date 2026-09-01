import type { Customer, Station } from '@loyalty/shared';
import { Permission } from '@loyalty/shared';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { usePagedRows } from '../../data/usePagedRows';
import { useTextFilter } from '../../data/useTextFilter';
import { useCustomersCache } from '../../data/useCustomersCache';
import { useStations } from '../../data/useStations';
import { AppShell } from '../../layout/AppShell';
import type { ExportColumn } from '../../lib/exportTable';
import { exportCustomerQrCodesPdf } from '../../lib/customerSticker';
import { ExportButtons } from '../../ui/ExportButtons';
import { Button, EmptyState, Pagination, Table, Td, Th, Tr, inputStyle } from '../../ui/primitives';

function customerColumns(stations: Station[]): ExportColumn<Customer>[] {
  return [
    { header: 'Name', value: (c) => c.fullName },
    { header: 'Phone', value: (c) => c.phoneNumber },
    { header: 'Home station', value: (c) => stations.find((s) => s.id === c.homeStationId)?.name ?? '' },
    { header: 'Total cashback earned (KSh)', value: (c) => c.totalCashbackEarned },
    { header: 'Special rate (KSh/L)', value: (c) => c.specialRateKesPerLitre ?? '' },
    { header: 'Source', value: (c) => c.source },
  ];
}

export function CustomersList() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const { stations } = useStations();
  // Loaded once and kept fresh silently via realtime updates — search below
  // filters this in-memory list instead of hitting the API per keystroke.
  const { customers, loading } = useCustomersCache();
  const [stationId, setStationId] = useState('');
  const byStation = useMemo(
    () => (stationId ? customers.filter((c) => c.homeStationId === stationId) : customers),
    [customers, stationId],
  );
  const { search, setSearch, filtered } = useTextFilter(byStation, (c) => `${c.fullName} ${c.phoneNumber}`);
  const { paged, page, pageCount, setPage } = usePagedRows(filtered);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportingQr, setExportingQr] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllOnPage() {
    const pageIds = paged.map((c) => c.id);
    const allChecked = pageIds.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allChecked) pageIds.forEach((id) => next.delete(id));
      else pageIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function exportQrCodes() {
    const customers = selected.size > 0 ? filtered.filter((c) => selected.has(c.id)) : filtered;
    setQrError(null);
    setExportingQr(true);
    try {
      await exportCustomerQrCodesPdf(customers);
    } catch (err) {
      setQrError(err instanceof Error ? err.message : 'Could not generate the QR code PDF');
    } finally {
      setExportingQr(false);
    }
  }

  return (
    <AppShell title="Customers" subtitle={`${customers.length} centralised across every station`}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          placeholder="Search by name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: 280 }}
        />
        {stations.length > 0 && (
          <select style={{ ...inputStyle, maxWidth: 200 }} value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">All home stations</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <Button variant="secondary" onClick={exportQrCodes} disabled={exportingQr || filtered.length === 0}>
          {exportingQr ? 'Generating…' : selected.size > 0 ? `Export ${selected.size} QR code(s)` : 'Export all QR codes'}
        </Button>
        <ExportButtons filename="customers" title="Customers" columns={customerColumns(stations)} rows={filtered} />
        {hasPermission(Permission.CUSTOMERS_IMPORT) && (
          <Button variant="secondary" onClick={() => navigate('/customers/import')}>
            Import from Excel
          </Button>
        )}
        {hasPermission(Permission.CUSTOMERS_MANAGE) && (
          <Button variant="primary" onClick={() => navigate('/customers/new')}>
            Add customer
          </Button>
        )}
      </div>

      {qrError && (
        <div style={{ fontSize: 12.5, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 10, marginBottom: 14 }}>
          {qrError}
        </div>
      )}

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        {loading && <div style={{ padding: 20, color: 'var(--color-text-secondary)' }}>Loading…</div>}
        {!loading && filtered.length === 0 && <EmptyState title="No customers found" body="Try a different search, or add one." />}
        {!loading && filtered.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>
                  <input
                    type="checkbox"
                    checked={paged.length > 0 && paged.every((c) => selected.has(c.id))}
                    onChange={toggleAllOnPage}
                    onClick={(e) => e.stopPropagation()}
                  />
                </Th>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Home station</Th>
                <Th align="right">Total cashback earned</Th>
              </tr>
            </thead>
            <tbody>
              {paged.map((c) => (
                <Tr key={c.id} onClick={() => navigate(`/customers/${c.id}`)}>
                  <Td>
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggleOne(c.id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Td>
                  <Td>
                    <span style={{ fontWeight: 700 }}>{c.fullName}</span>
                    {c.specialRateKesPerLitre && (
                      <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--gw-blue-500)', fontWeight: 700 }}>
                        special rate
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{c.phoneNumber}</span>
                  </Td>
                  <Td>{stations.find((s) => s.id === c.homeStationId)?.name ?? '—'}</Td>
                  <Td align="right">
                    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                      KSh {c.totalCashbackEarned.toLocaleString('en-KE')}
                    </span>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${filtered.length} customer(s)`} />
      </div>
    </AppShell>
  );
}
