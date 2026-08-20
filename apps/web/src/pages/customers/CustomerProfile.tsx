import type { Customer, Sale, Station } from '@loyalty/shared';
import { Permission } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { useApi } from '../../data/client';
import { invalidateCustomersCache } from '../../data/useCustomersCache';
import { usePagedRows } from '../../data/usePagedRows';
import { useRealtimeRefresh } from '../../data/realtime';
import { useStations } from '../../data/useStations';
import { AppShell } from '../../layout/AppShell';
import type { ExportColumn } from '../../lib/exportTable';
import { ExportButtons } from '../../ui/ExportButtons';
import { Icon } from '../../ui/Icon';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Modal, Pagination, Table, Td, Th, Tr, inputStyle } from '../../ui/primitives';

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
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(Permission.CUSTOMERS_MANAGE);
  const canDelete = hasPermission(Permission.CUSTOMERS_DELETE);
  const { stations } = useStations();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDetails, setEditingDetails] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
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

  async function confirmDelete() {
    if (!id) return;
    setDeleteError(null);
    setDeleting(true);
    try {
      await api.customers.delete(id);
      invalidateCustomersCache();
      navigate('/customers');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete this customer');
      setDeleting(false);
    }
  }

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
          {canManage && (
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Details</div>
                {!editingDetails && (
                  <Button variant="secondary" size="sm" onClick={() => setEditingDetails(true)}>
                    Edit
                  </Button>
                )}
              </div>
              {!editingDetails ? (
                <div style={{ marginTop: 8, fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  <div>{customer.fullName}</div>
                  <div style={{ marginTop: 4 }}>
                    Home station: {stations.find((s) => s.id === customer.homeStationId)?.name ?? 'None set'}
                  </div>
                </div>
              ) : (
                <CustomerDetailsForm
                  customer={customer}
                  stations={stations}
                  onCancel={() => setEditingDetails(false)}
                  onSaved={() => {
                    setEditingDetails(false);
                    reload();
                  }}
                />
              )}
            </Card>
          )}

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

          {canDelete && (
            <Card style={{ borderColor: 'var(--color-danger)' }}>
              <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--color-danger)' }}>Danger zone</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                Permanently deletes this customer record. Their past sales and cashback history stay on record — this only removes the customer profile itself.
              </div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowDeleteConfirm(true)}
                style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <Icon name="trash" size={13} />
                Delete customer
              </Button>
            </Card>
          )}
        </div>
      </div>

      {showDeleteConfirm && (
        <Modal title="Delete this customer?" onClose={() => !deleting && setShowDeleteConfirm(false)}>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            This permanently deletes <strong>{customer.fullName}</strong> ({customer.phoneNumber}). This cannot be undone.
            {customer.totalCashbackEarned > 0 && (
              <div style={{ marginTop: 8, color: 'var(--color-danger)' }}>
                This customer has earned KSh {customer.totalCashbackEarned.toLocaleString('en-KE')} in lifetime cashback — deleting them does not affect past sales or ledger records, but their profile will no longer be reachable.
              </div>
            )}
          </div>
          {deleteError && (
            <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginTop: 12 }}>
              {deleteError}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <Button variant="danger" onClick={confirmDelete} disabled={deleting}>
              {deleting ? 'Deleting…' : 'Delete permanently'}
            </Button>
            <Button variant="secondary" onClick={() => setShowDeleteConfirm(false)} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </Modal>
      )}
    </AppShell>
  );
}

function CustomerDetailsForm({
  customer,
  stations,
  onCancel,
  onSaved,
}: {
  customer: Customer;
  stations: Station[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const api = useApi();
  const [fullName, setFullName] = useState(customer.fullName);
  const [homeStationId, setHomeStationId] = useState(customer.homeStationId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await api.customers.update(customer.id, { fullName, homeStationId: homeStationId || undefined });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save changes');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
          {error}
        </div>
      )}
      <Field label="Full name">
        <input style={inputStyle} value={fullName} onChange={(e) => setFullName(e.target.value)} />
      </Field>
      <Field label="Home station">
        <select style={inputStyle} value={homeStationId} onChange={(e) => setHomeStationId(e.target.value)}>
          <option value="">None</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="primary" size="sm" onClick={save} disabled={busy || !fullName}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
