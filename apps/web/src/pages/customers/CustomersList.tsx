import type { Customer } from '@loyalty/shared';
import { Permission } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../data/client';
import { useStations } from '../../data/useStations';
import { AppShell } from '../../layout/AppShell';
import { Button, EmptyState, Table, Td, Th, Tr, inputStyle } from '../../ui/primitives';

export function CustomersList() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const { stations } = useStations();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.customers
      .list({ page: 1, pageSize: 50, name: search || undefined })
      .then((res) => {
        setCustomers(res.items);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }, [api, search]);

  return (
    <AppShell title="Customers" subtitle={`${total} centralised across every station`}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          placeholder="Search by name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: 280 }}
        />
        <div style={{ flex: 1 }} />
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

      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 12, boxShadow: 'var(--shadow-sm)', overflow: 'hidden' }}>
        {loading && <div style={{ padding: 20, color: 'var(--color-text-secondary)' }}>Loading…</div>}
        {!loading && customers.length === 0 && <EmptyState title="No customers found" body="Try a different search, or add one." />}
        {!loading && customers.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Phone</Th>
                <Th>Home station</Th>
                <Th align="right">Total cashback earned</Th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <Tr key={c.id} onClick={() => navigate(`/customers/${c.id}`)}>
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
      </div>
    </AppShell>
  );
}
