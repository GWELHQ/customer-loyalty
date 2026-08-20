import type { Customer, SpecialRateRequest } from '@loyalty/shared';
import { Permission, SpecialRateStatus } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { AppShell } from '../layout/AppShell';
import { Badge, Button, Card, CardHeader, Field, inputStyle } from '../ui/primitives';

export function SpecialRates() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission(Permission.SPECIAL_RATES_APPROVE);
  const canRequest = hasPermission(Permission.SPECIAL_RATES_REQUEST);
  const [requests, setRequests] = useState<SpecialRateRequest[]>([]);
  const [customers, setCustomers] = useState<Record<string, Customer>>({});
  const [showForm, setShowForm] = useState(false);

  function reload() {
    api.specialRateRequests.list().then(async (list) => {
      setRequests(list);
      const missingIds = [...new Set(list.map((r) => r.customerId))];
      const fetched = await Promise.all(missingIds.map((id) => api.customers.get(id).catch(() => null)));
      const map: Record<string, Customer> = {};
      fetched.forEach((c) => c && (map[c.id] = c));
      setCustomers(map);
    });
  }
  useEffect(reload, [api]);

  const pending = requests.filter((r) => r.status === SpecialRateStatus.PENDING);
  const decided = requests.filter((r) => r.status !== SpecialRateStatus.PENDING);

  return (
    <AppShell title="Special cashback rates" subtitle="Only the Chairman can approve or reject a request">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 900 }}>
        {canRequest && (
          <div>
            <Button variant="primary" onClick={() => setShowForm((v) => !v)}>
              {showForm ? 'Cancel' : 'Request a special rate'}
            </Button>
          </div>
        )}
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
            {decided.map((r) => (
              <RequestRow key={r.id} request={r} customer={customers[r.customerId]} canApprove={false} onDecided={reload} />
            ))}
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
          <div style={{ fontWeight: 800, fontSize: 15 }}>{customer?.fullName ?? request.customerId}</div>
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
          <div style={{ fontWeight: 700 }}>{new Date(request.effectiveFrom).toLocaleDateString('en-KE')}</div>
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
          {request.decidedAt && ` · ${new Date(request.decidedAt).toLocaleDateString('en-KE')}`}
        </div>
      )}
    </div>
  );
}

function RequestForm({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const [customerId, setCustomerId] = useState('');
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      await api.specialRateRequests.create({
        customerId,
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
        <Field label="Customer ID">
          <input style={inputStyle} value={customerId} onChange={(e) => setCustomerId(e.target.value)} placeholder="Paste from the customer profile" />
        </Field>
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
      <Button variant="primary" onClick={submit} disabled={busy || !customerId || !rate || !effectiveFrom || !reason} style={{ marginTop: 14 }}>
        {busy ? 'Submitting…' : 'Submit request'}
      </Button>
    </Card>
  );
}
