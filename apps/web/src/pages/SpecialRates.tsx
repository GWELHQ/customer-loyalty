import type { Customer, SpecialRateRequest } from '@loyalty/shared';
import { Permission, SpecialRateStatus } from '@loyalty/shared';
import { useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useCustomersCache } from '../data/useCustomersCache';
import { useSpecialRateRequestsCache } from '../data/entityCaches';
import { usePagedRows } from '../data/usePagedRows';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { formatNairobiDate } from '../lib/time';
import { ExportButtons } from '../ui/ExportButtons';
import { Badge, Button, Card, CardHeader, Field, Pagination, inputStyle } from '../ui/primitives';

function specialRateColumns(customers: Record<string, Customer>): ExportColumn<SpecialRateRequest>[] {
  return [
    { header: 'Customer', value: (r) => customers[r.customerId]?.fullName ?? 'Unknown customer' },
    { header: 'Phone', value: (r) => customers[r.customerId]?.phoneNumber ?? '' },
    { header: 'Proposed rate (KSh/L)', value: (r) => r.proposedKesPerLitre },
    { header: 'Effective from', value: (r) => formatNairobiDate(r.effectiveFrom) },
    { header: 'Requested by', value: (r) => r.requestedByName },
    { header: 'Reason', value: (r) => r.reason },
    { header: 'Status', value: (r) => r.status },
    { header: 'Decided by', value: (r) => r.decidedByName ?? '' },
  ];
}

export function SpecialRates() {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission(Permission.SPECIAL_RATES_APPROVE);
  const canRequest = hasPermission(Permission.SPECIAL_RATES_REQUEST);
  const { items: requests, refresh: reload } = useSpecialRateRequestsCache();
  const { customers: allCustomers } = useCustomersCache();
  const customers = useMemo(() => {
    const map: Record<string, Customer> = {};
    for (const c of allCustomers) map[c.id] = c;
    return map;
  }, [allCustomers]);
  const [showForm, setShowForm] = useState(false);

  const pending = requests.filter((r) => r.status === SpecialRateStatus.PENDING);
  const decided = requests.filter((r) => r.status !== SpecialRateStatus.PENDING);
  const { paged: pagedDecided, page, pageCount, setPage } = usePagedRows(decided, 10);

  return (
    <AppShell title="Special cashback rates" subtitle="Only the Chairman can approve or reject a request">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          {canRequest && (
            <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'Request a special rate'}
            </Button>
          )}
          <div style={{ flex: 1 }} />
          <ExportButtons filename="special-rate-requests" title="Special rate requests" columns={specialRateColumns(customers)} rows={requests} />
        </div>
        {showForm && <RequestForm onDone={() => { setShowForm(false); reload(); }} />}

        <Card padding={0}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <CardHeader title="Pending requests" subtitle="Waiting on the Chairman" right={<Badge tone="warning">{pending.length}</Badge>} />
          </div>
          {pending.length === 0 && <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>No pending requests.</div>}
          {pending.map((r) => (
            <RequestRow key={r.id} request={r} customer={customers[r.customerId]} canApprove={canApprove} onDecided={reload} />
          ))}
        </Card>

        {decided.length > 0 && (
          <Card padding={0}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>
              Decided requests
            </div>
            {pagedDecided.map((r) => (
              <RequestRow key={r.id} request={r} customer={customers[r.customerId]} canApprove={false} onDecided={reload} />
            ))}
            <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${decided.length} decided`} />
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function RequestRow({
  request,
  customer,
  canApprove,
  onDecided,
}: {
  request: SpecialRateRequest;
  customer?: Customer;
  canApprove: boolean;
  onDecided: () => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);

  async function decide(action: 'approve' | 'reject') {
    setBusy(true);
    try {
      if (action === 'approve') await api.specialRateRequests.approve(request.id);
      else await api.specialRateRequests.reject(request.id);
      onDecided();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 16, borderBottom: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{customer?.fullName ?? 'Unknown customer'}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{customer?.phoneNumber}</div>
        </div>
        <Badge tone={request.status === SpecialRateStatus.APPROVED ? 'success' : request.status === SpecialRateStatus.REJECTED ? 'danger' : 'warning'}>
          {request.status}
        </Badge>
      </div>
      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, background: 'var(--color-surface-sunken)', borderRadius: 8, padding: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Proposed rate</div>
          <div style={{ fontWeight: 800, color: 'var(--gw-blue-500)' }}>KSh {request.proposedKesPerLitre} / L</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Effective from</div>
          <div style={{ fontWeight: 700 }}>{formatNairobiDate(request.effectiveFrom)}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Requested by</div>
          <div style={{ fontWeight: 700 }}>{request.requestedByName}</div>
        </div>
      </div>
      <div style={{ marginTop: 11, fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
        <strong style={{ color: 'var(--color-text)' }}>Reason:</strong> {request.reason}
      </div>
      {request.status === SpecialRateStatus.PENDING && canApprove && (
        <div style={{ display: 'flex', gap: 8, marginTop: 13 }}>
          <Button variant="primary" size="sm" onClick={() => decide('approve')} disabled={busy}>
            Approve rate
          </Button>
          <Button variant="danger" size="sm" onClick={() => decide('reject')} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
      {request.status === SpecialRateStatus.PENDING && !canApprove && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Waiting on the Chairman. No other role can approve it.
        </div>
      )}
      {request.decidedByName && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
          Decided by {request.decidedByName}
          {request.decidedAt && ` · ${formatNairobiDate(request.decidedAt)}`}
        </div>
      )}
    </div>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const { customers } = useCustomersCache();
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerQuery, setCustomerQuery] = useState('');
  const [showMatches, setShowMatches] = useState(false);
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => {
    const q = customerQuery.trim().toLowerCase();
    if (!q) return [];
    return customers.filter((c) => c.fullName.toLowerCase().includes(q) || c.phoneNumber.includes(q)).slice(0, 8);
  }, [customers, customerQuery]);

  async function submit() {
    if (!selectedCustomer) return;
    setError(null);
    setBusy(true);
    try {
      await api.specialRateRequests.create({
        customerId: selectedCustomer.id,
        proposedKesPerLitre: Number(rate),
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        reason,
      });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ position: 'relative' }}>
          <Field label="Customer">
            {selectedCustomer ? (
              <div
                style={{
                  ...inputStyle,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  cursor: 'default',
                }}
              >
                <span>
                  {selectedCustomer.fullName} <span style={{ color: 'var(--color-text-muted)' }}>· {selectedCustomer.phoneNumber}</span>
                </span>
                <button
                  onClick={() => {
                    setSelectedCustomer(null);
                    setCustomerQuery('');
                  }}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: 16 }}
                >
                  ×
                </button>
              </div>
            ) : (
              <input
                style={inputStyle}
                value={customerQuery}
                onChange={(e) => {
                  setCustomerQuery(e.target.value);
                  setShowMatches(true);
                }}
                onFocus={() => setShowMatches(true)}
                onBlur={() => setTimeout(() => setShowMatches(false), 150)}
                placeholder="Search by name or phone"
              />
            )}
          </Field>
          {showMatches && !selectedCustomer && matches.length > 0 && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 10,
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border-strong)',
                borderRadius: 'var(--radius-md)',
                marginTop: 4,
                maxHeight: 220,
                overflowY: 'auto',
                boxShadow: '0 4px 14px rgba(0,0,0,0.12)',
              }}
            >
              {matches.map((c) => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelectedCustomer(c);
                    setShowMatches(false);
                  }}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: '9px 12px',
                    border: 'none',
                    background: 'none',
                    cursor: 'pointer',
                    fontSize: 13.5,
                  }}
                >
                  {c.fullName} <span style={{ color: 'var(--color-text-muted)' }}>· {c.phoneNumber}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Field label="Proposed rate (KSh per litre)">
          <input type="number" style={inputStyle} value={rate} onChange={(e) => setRate(e.target.value)} />
        </Field>
        <Field label="Effective from">
          <input type="date" style={inputStyle} value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
        </Field>
        <div style={{ gridColumn: 'span 2' }}>
          <Field label="Reason">
            <textarea style={{ ...inputStyle, minHeight: 70 }} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </div>
      </div>
      <Button variant="primary" onClick={submit} disabled={busy || !selectedCustomer || !rate || !effectiveFrom || !reason} style={{ marginTop: 14 }}>
        {busy ? 'Submitting…' : 'Submit request'}
      </Button>
    </Card>
  );
}
