import type { CustomerRegistrationRequest } from '@loyalty/shared';
import { CustomerRegistrationStatus, Permission } from '@loyalty/shared';
import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useCustomerRegistrationsCache } from '../data/entityCaches';
import { usePagedRows } from '../data/usePagedRows';
import { useTextFilter } from '../data/useTextFilter';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { ExportButtons } from '../ui/ExportButtons';
import { formatNairobiDate, formatNairobiDateTime } from '../lib/time';
import { Badge, Button, Card, CardHeader, Field, Modal, Pagination, inputStyle } from '../ui/primitives';

const REGISTRATION_COLUMNS: ExportColumn<CustomerRegistrationRequest>[] = [
  { header: 'Customer', value: (r) => r.customerFullName },
  { header: 'Phone', value: (r) => r.customerPhoneNumber },
  { header: 'Station', value: (r) => r.stationNameAtRequest },
  { header: 'Product', value: (r) => r.product },
  { header: 'Amount paid (KSh)', value: (r) => r.amountPaid },
  { header: 'Cashback (preview, KSh)', value: (r) => r.snapshot.cashbackEarned },
  { header: 'Registered by', value: (r) => r.attendantNameAtRequest },
  { header: 'Status', value: (r) => r.status },
  { header: 'Decided by', value: (r) => r.decidedByName ?? '' },
];

export function CustomerRegistrations() {
  const { hasPermission } = useAuth();
  const { items: requests, loading, refresh: reload } = useCustomerRegistrationsCache();

  const pending = requests.filter((r) => r.status === CustomerRegistrationStatus.PENDING);
  const decided = requests.filter((r) => r.status !== CustomerRegistrationStatus.PENDING);
  const { search, setSearch, filtered: filteredDecided } = useTextFilter(
    decided,
    (r) => `${r.customerFullName} ${r.customerPhoneNumber}`,
  );
  const { paged: pagedDecided, page, pageCount, setPage } = usePagedRows(filteredDecided, 10);

  return (
    <AppShell
      title="Customer registrations"
      subtitle="New customers registered by sales assistants during a sale — approving creates the customer and records the sale"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 960 }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <ExportButtons filename="customer-registrations" title="Customer registrations" columns={REGISTRATION_COLUMNS} rows={requests} />
        </div>
        <Card padding={0}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <CardHeader
              title="Pending requests"
              subtitle="Waiting on approval"
              right={<Badge tone="warning">{pending.length}</Badge>}
            />
          </div>
          {loading && <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>Loading…</div>}
          {!loading && pending.length === 0 && (
            <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>No pending requests.</div>
          )}
          {pending.map((r) => (
            <RequestRow key={r.id} request={r} canApprove={hasPermission(Permission.CUSTOMER_REGISTRATIONS_APPROVE)} onDecided={reload} />
          ))}
        </Card>

        {decided.length > 0 && (
          <Card padding={0}>
            <div
              style={{
                padding: '14px 16px',
                borderBottom: '1px solid var(--color-border)',
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 16,
              }}
            >
              Decided requests
            </div>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--color-border)' }}>
              <input
                placeholder="Search by customer or phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={{ ...inputStyle, maxWidth: 260 }}
              />
            </div>
            {pagedDecided.map((r) => (
              <RequestRow key={r.id} request={r} canApprove={false} onDecided={reload} />
            ))}
            <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${filteredDecided.length} decided`} />
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function RequestRow({
  request,
  canApprove,
  onDecided,
}: {
  request: CustomerRegistrationRequest;
  canApprove: boolean;
  onDecided: () => void;
}) {
  const api = useApi();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);

  async function approve() {
    setError(null);
    setBusy(true);
    try {
      await api.customerRegistrations.approve(request.id);
      onDecided();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not approve this request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 16, borderBottom: '1px solid var(--color-border)' }}>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 15 }}>{request.customerFullName}</div>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{request.customerPhoneNumber}</div>
        </div>
        <Badge
          tone={
            request.status === CustomerRegistrationStatus.APPROVED
              ? 'success'
              : request.status === CustomerRegistrationStatus.REJECTED
                ? 'danger'
                : 'warning'
          }
        >
          {request.status}
        </Badge>
      </div>

      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, background: 'var(--color-surface-sunken)', borderRadius: 8, padding: 12 }}>
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Home station</div>
          <div style={{ fontWeight: 700 }}>{request.stationNameAtRequest}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Product</div>
          <div style={{ fontWeight: 700 }}>{request.product}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Amount paid</div>
          <div style={{ fontWeight: 800, color: 'var(--gw-blue-500)' }}>KSh {request.amountPaid.toLocaleString('en-KE')}</div>
        </div>
        <div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Cashback (preview)</div>
          <div style={{ fontWeight: 800, color: 'var(--color-success)' }}>KSh {request.snapshot.cashbackEarned.toLocaleString('en-KE')}</div>
        </div>
      </div>

      <div style={{ marginTop: 11, fontSize: 13, color: 'var(--color-text-secondary)' }}>
        <strong style={{ color: 'var(--color-text)' }}>Registered by:</strong> {request.attendantNameAtRequest} ·{' '}
        {formatNairobiDateTime(request.createdAt)}
      </div>

      {request.status === CustomerRegistrationStatus.PENDING && canApprove && (
        <div style={{ display: 'flex', gap: 8, marginTop: 13 }}>
          <Button variant="primary" size="sm" onClick={approve} disabled={busy}>
            {busy ? 'Approving…' : 'Approve'}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setShowRejectModal(true)} disabled={busy}>
            Reject
          </Button>
        </div>
      )}
      {request.status === CustomerRegistrationStatus.PENDING && !canApprove && (
        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--color-text-secondary)' }}>
          Waiting on a Station Supervisor, RTSM, or Admin to approve.
        </div>
      )}
      {request.decidedByName && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--color-text-muted)' }}>
          Decided by {request.decidedByName}
          {request.decidedAt && ` · ${formatNairobiDate(request.decidedAt)}`}
          {request.decisionNote && ` — "${request.decisionNote}"`}
        </div>
      )}

      {showRejectModal && (
        <RejectModal
          request={request}
          onClose={() => setShowRejectModal(false)}
          onRejected={() => {
            setShowRejectModal(false);
            onDecided();
          }}
        />
      )}
    </div>
  );
}

function RejectModal({
  request,
  onClose,
  onRejected,
}: {
  request: CustomerRegistrationRequest;
  onClose: () => void;
  onRejected: () => void;
}) {
  const api = useApi();
  const [decisionNote, setDecisionNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api.customerRegistrations.reject(request.id, decisionNote || undefined);
      onRejected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reject this request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`Reject — ${request.customerFullName}`} onClose={onClose}>
      {error && (
        <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12, marginBottom: 12 }}>
          {error}
        </div>
      )}
      <Field label="Reason (optional)">
        <textarea
          style={{ ...inputStyle, minHeight: 70 }}
          value={decisionNote}
          onChange={(e) => setDecisionNote(e.target.value)}
          placeholder="Why this request is being rejected"
        />
      </Field>
      <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
        <Button variant="danger" onClick={submit} disabled={busy}>
          {busy ? 'Rejecting…' : 'Reject request'}
        </Button>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
