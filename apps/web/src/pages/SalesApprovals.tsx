import { Role, type Sale, type SaleApprovalDelegation } from '@loyalty/shared';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useCustomersCache } from '../data/useCustomersCache';
import { useRealtimeRefresh } from '../data/realtime';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import { formatNairobiDate, formatNairobiDateTime } from '../lib/time';
import { PromptModal } from '../ui/PromptModal';
import { Badge, Button, Card, EmptyState, Field, Modal, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

export function SalesApprovals() {
  const api = useApi();
  const { user } = useAuth();
  const { stations } = useStations();
  const { customers } = useCustomersCache();
  const customerNames = new Map(customers.map((c) => [c.id, c.fullName]));

  const canManageDelegation = user?.role === Role.STATION_SUPERVISOR || user?.role === Role.ADMIN;
  const canPickStation = user?.role === Role.ADMIN || user?.role === Role.RTSM;

  const [stationId, setStationId] = useState('');
  const [sales, setSales] = useState<Sale[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [approveResult, setApproveResult] = useState<{ approved: string[]; skipped: { saleId: string; reason: string }[] } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<Sale | null>(null);

  function resetToFirstPage() {
    setCursorStack([undefined]);
    setPageIndex(0);
    setSelected(new Set());
  }

  const reload = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api.sales
      .listPendingApproval({ stationId: stationId || undefined, cursor: cursorStack[pageIndex] })
      .then((res) => {
        setSales(res.items);
        setTotal(res.total);
        setNextCursor(res.nextCursor);
      })
      .catch((err) => {
        // Surfaced explicitly rather than left to fall through to the "nothing
        // pending" empty state — this page's whole job is showing what needs
        // attention, so a failed fetch must never look identical to "all clear."
        setSales([]);
        setTotal(0);
        setNextCursor(null);
        setLoadError(err instanceof Error ? err.message : 'Could not load pending sales');
      })
      .finally(() => setLoading(false));
  }, [api, stationId, cursorStack, pageIndex]);
  useEffect(reload, [reload]);
  useEffect(resetToFirstPage, [stationId]);
  useRealtimeRefresh(['sales'], resetToFirstPage);

  function goNext() {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  }
  function goPrev() {
    setPageIndex((i) => Math.max(0, i - 1));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected((prev) => (prev.size === sales.length ? new Set() : new Set(sales.map((s) => s.id))));
  }

  async function approveSelected() {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      const result = await api.sales.approveBatch([...selected]);
      if (result.skipped.length > 0) setApproveResult(result);
      setSelected(new Set());
      reload();
    } finally {
      setBusy(false);
    }
  }

  async function rejectOne(sale: Sale, reason: string) {
    setRejectTarget(null);
    setBusy(true);
    try {
      await api.sales.reject(sale.id, reason);
      reload();
    } finally {
      setBusy(false);
    }
  }

  function customerName(s: Sale): string {
    return customerNames.get(s.customerId) ?? s.customerPhoneAtSale;
  }

  return (
    <AppShell title="Sale approvals" subtitle="Cashback is only credited once a sale here is approved">
      <div style={{ display: 'grid', gridTemplateColumns: canManageDelegation ? '1fr 320px' : '1fr', gap: 16, alignItems: 'start' }}>
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
            {canPickStation && stations.length > 0 && (
              <select style={{ ...inputStyle, maxWidth: 220 }} value={stationId} onChange={(e) => setStationId(e.target.value)}>
                <option value="">All stations</option>
                {stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{selected.size} selected</span>
            <Button variant="primary" size="sm" onClick={approveSelected} disabled={selected.size === 0 || busy}>
              Approve selected
            </Button>
          </div>

          <Card padding={0}>
            {loading && <div style={{ padding: 20, color: 'var(--color-text-secondary)' }}>Loading…</div>}
            {!loading && loadError && (
              <div style={{ padding: 20, color: 'var(--color-danger)', background: 'var(--color-danger-tint)' }}>
                Couldn't load pending sales: {loadError}
              </div>
            )}
            {!loading && !loadError && sales.length === 0 && (
              <EmptyState title="Nothing awaiting approval" body="Every sale here has already been approved or rejected." />
            )}
            {!loading && !loadError && sales.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <Th>
                      <input type="checkbox" checked={selected.size === sales.length} onChange={toggleAll} />
                    </Th>
                    <Th>Date</Th>
                    <Th>Station</Th>
                    <Th>Customer</Th>
                    <Th>Attendant</Th>
                    <Th align="right">Amount</Th>
                    <Th align="right">Cashback</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {sales.map((s) => (
                    <Tr key={s.id}>
                      <Td>
                        <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggleOne(s.id)} />
                      </Td>
                      <Td>{formatNairobiDateTime(s.saleDate)}</Td>
                      <Td>{s.stationNameAtSale}</Td>
                      <Td>{customerName(s)}</Td>
                      <Td>{s.attendantNameAtSale}</Td>
                      <Td align="right">KSh {s.amountPaid.toLocaleString('en-KE')}</Td>
                      <Td align="right">
                        <strong>KSh {s.snapshot.cashbackEarned}</strong>
                      </Td>
                      <Td>
                        <Button variant="danger" size="sm" onClick={() => setRejectTarget(s)} disabled={busy}>
                          Reject
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 12,
                padding: '12px 14px',
                borderTop: '1px solid var(--color-border)',
              }}
            >
              <span style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
                Page {pageIndex + 1} · {total} sale(s) awaiting approval
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button variant="secondary" size="sm" onClick={goPrev} disabled={pageIndex === 0 || loading}>
                  Previous
                </Button>
                <Button variant="secondary" size="sm" onClick={goNext} disabled={!nextCursor || loading}>
                  Next
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {canManageDelegation && <DelegationPanel />}
      </div>

      {approveResult && (
        <Modal title="Batch approval result" onClose={() => setApproveResult(null)}>
          <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
            <strong>{approveResult.approved.length}</strong> approved.{' '}
            <strong>{approveResult.skipped.length}</strong> could not be approved:
          </div>
          <ul style={{ marginTop: 10, paddingLeft: 18, fontSize: 13 }}>
            {approveResult.skipped.map((s) => (
              <li key={s.saleId} style={{ marginBottom: 4 }}>
                {s.reason}
              </li>
            ))}
          </ul>
          <Button variant="secondary" onClick={() => setApproveResult(null)} style={{ marginTop: 12 }}>
            Close
          </Button>
        </Modal>
      )}

      {rejectTarget && (
        <PromptModal
          title="Reject sale"
          label="Reason for rejecting this sale (cashback will never be credited)"
          confirmLabel="Reject"
          destructive
          onCancel={() => setRejectTarget(null)}
          onSubmit={(reason) => rejectOne(rejectTarget, reason)}
        />
      )}
    </AppShell>
  );
}

function DelegationPanel() {
  const api = useApi();
  const { user } = useAuth();
  const { stations } = useStations();
  const isAdmin = user?.role === Role.ADMIN;

  const [stationId, setStationId] = useState(isAdmin ? '' : (user?.assignedStationId ?? ''));
  const [current, setCurrent] = useState<SaleApprovalDelegation | null>(null);
  const [eligibleStaff, setEligibleStaff] = useState<{ id: string; fullName: string; role: Role }[]>([]);
  const [delegateUserId, setDelegateUserId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!stationId) {
      setCurrent(null);
      return;
    }
    api.salesDelegations.listForStation(stationId).then((list) => {
      const now = new Date();
      setCurrent(list.find((d) => !d.revokedAt && new Date(d.startDate) <= now && now <= new Date(d.endDate)) ?? null);
    });
  }, [api, stationId]);
  useEffect(reload, [reload]);
  useEffect(() => {
    api.salesDelegations.listEligibleStaff().then(setEligibleStaff);
  }, [api]);

  async function create() {
    if (!stationId || !delegateUserId || !startDate || !endDate) return;
    setError(null);
    setBusy(true);
    try {
      await api.salesDelegations.create({ stationId, delegateUserId, startDate, endDate });
      setDelegateUserId('');
      setStartDate('');
      setEndDate('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create delegation');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!current) return;
    setBusy(true);
    try {
      await api.salesDelegations.revoke(current.id);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Delegate approval authority</div>
      {isAdmin && (
        <Field label="Station">
          <select style={inputStyle} value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">Select a station</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
      )}

      {stationId && current && (
        <div style={{ marginTop: 10, padding: 10, borderRadius: 'var(--radius-md)', background: 'var(--color-primary-tint)' }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>{current.delegateName}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
            {formatNairobiDate(current.startDate)} – {formatNairobiDate(current.endDate)}
          </div>
          <Button variant="secondary" size="sm" onClick={revoke} disabled={busy} style={{ marginTop: 8 }}>
            Revoke
          </Button>
        </div>
      )}

      {stationId && !current && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
          {error && (
            <div style={{ fontSize: 12.5, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 10 }}>
              {error}
            </div>
          )}
          <Field label="Delegate to">
            <select style={inputStyle} value={delegateUserId} onChange={(e) => setDelegateUserId(e.target.value)}>
              <option value="">Select a staff member</option>
              {eligibleStaff.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName} ({u.role})
                </option>
              ))}
            </select>
          </Field>
          <Field label="From">
            <input type="date" style={inputStyle} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="Until">
            <input type="date" style={inputStyle} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
          <Button variant="primary" size="sm" onClick={create} disabled={busy || !delegateUserId || !startDate || !endDate}>
            {busy ? 'Saving…' : 'Set delegate'}
          </Button>
        </div>
      )}
    </Card>
  );
}
