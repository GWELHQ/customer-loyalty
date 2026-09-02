import type { MonthlyCashbackLedger, MonthlyCashbackLedgerEntry, Sale } from '@loyalty/shared';
import { LedgerStatus, Permission, Role } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { usePagedRows } from '../data/usePagedRows';
import { useTextFilter } from '../data/useTextFilter';
import { useRealtimeRefresh } from '../data/realtime';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { formatNairobiDate, formatNairobiDateTime, nairobiThisMonth, NAIROBI_TZ } from '../lib/time';
import { ExportButtons } from '../ui/ExportButtons';
import { PromptModal } from '../ui/PromptModal';
import { Badge, Button, Card, CardHeader, Field, Pagination, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';
import { StepIndicator, type StepIndicatorStep, type StepState } from '../ui/StepIndicator';

const LEDGER_ENTRY_COLUMNS: ExportColumn<MonthlyCashbackLedgerEntry>[] = [
  { header: 'Customer', value: (e) => e.customerName },
  { header: 'Phone', value: (e) => e.customerPhone },
  { header: 'Station', value: (e) => e.stationName },
  { header: 'Eligible sales', value: (e) => e.eligibleSalesCount },
  { header: 'Total cashback (KSh)', value: (e) => e.totalCashback },
];

const STATUS_TONE: Record<LedgerStatus, 'neutral' | 'success' | 'warning' | 'danger'> = {
  [LedgerStatus.OPEN_ACCRUING]: 'neutral',
  [LedgerStatus.READY_FOR_REVIEW]: 'neutral',
  [LedgerStatus.SUBMITTED_FOR_APPROVAL]: 'warning',
  [LedgerStatus.APPROVED]: 'success',
  [LedgerStatus.REJECTED]: 'danger',
  [LedgerStatus.DISBURSEMENT_IN_PROGRESS]: 'warning',
  [LedgerStatus.DISBURSED]: 'success',
  [LedgerStatus.FAILED]: 'danger',
  [LedgerStatus.HELD]: 'danger',
};

/** Release is only open on the 1st/2nd of the month (Nairobi time) for everyone except Admin — see assertWithinReleaseWindow on the API. */
function isWithinReleaseWindow(role: string): boolean {
  if (role === Role.ADMIN) return true;
  const dayOfMonth = Number(new Date().toLocaleDateString('en-CA', { timeZone: NAIROBI_TZ }).slice(8, 10));
  return dayOfMonth === 1 || dayOfMonth === 2;
}

function formatMonthLabel(month: string): string {
  const [year, monthNum] = month.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, monthNum - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** RTSM releases -> Finance Approver approves -> Finance Disburser pays out. */
function ledgerSteps(ledger: MonthlyCashbackLedger): StepIndicatorStep[] {
  const s = ledger.status;
  const notYetReleased = s === LedgerStatus.OPEN_ACCRUING || s === LedgerStatus.READY_FOR_REVIEW;

  const releasedState: StepState = notYetReleased ? 'current' : 'done';
  const approvedState: StepState = notYetReleased
    ? 'pending'
    : s === LedgerStatus.SUBMITTED_FOR_APPROVAL
      ? 'current'
      : s === LedgerStatus.REJECTED
        ? 'rejected'
        : 'done';
  const disbursedState: StepState =
    s === LedgerStatus.DISBURSED
      ? 'done'
      : s === LedgerStatus.FAILED
        ? 'rejected'
        : s === LedgerStatus.APPROVED || s === LedgerStatus.DISBURSEMENT_IN_PROGRESS || s === LedgerStatus.HELD
          ? 'current'
          : 'pending';

  return [
    {
      label: 'Released',
      state: releasedState,
      subtext: ledger.submittedAt ? `${ledger.submittedByName ?? 'Unknown'} · ${formatNairobiDate(ledger.submittedAt)}` : undefined,
    },
    {
      label: 'Approved',
      state: approvedState,
      subtext:
        approvedState === 'rejected' && ledger.rejectedAt
          ? `${ledger.rejectedByName ?? 'Unknown'} · ${formatNairobiDate(ledger.rejectedAt)}`
          : ledger.approvedAt
            ? `${ledger.approvedByName ?? 'Unknown'} · ${formatNairobiDate(ledger.approvedAt)}`
            : undefined,
    },
    { label: 'Disbursed', state: disbursedState },
  ];
}

export function CashbackLedgers() {
  const { hasPermission } = useAuth();
  const canViewFull = hasPermission(Permission.LEDGERS_VIEW);
  const isStationReleaser = hasPermission(Permission.LEDGERS_RELEASE_OWN_STATION);

  return canViewFull ? <FullLedgerView /> : isStationReleaser ? <MyStationReleaseView /> : null;
}

/**
 * What a Station Supervisor sees — just whether their own station has
 * signed off for the month, never the org-wide customer ledger (they
 * don't hold LEDGERS_VIEW).
 */
function MyStationReleaseView() {
  const api = useApi();
  const { user } = useAuth();
  const [month, setMonth] = useState(nairobiThisMonth);
  const [status, setStatus] = useState<Awaited<ReturnType<typeof api.cashbackLedgers.myStationStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    api.cashbackLedgers.myStationStatus(month).then(setStatus);
  }
  useEffect(reload, [api, month]);
  useRealtimeRefresh(['monthlyCashbackLedgers'], reload);

  const withinWindow = isWithinReleaseWindow(user?.role ?? '');

  async function release() {
    if (!status) return;
    setError(null);
    setBusy(true);
    try {
      await api.cashbackLedgers.releaseStation(month, status.stationId);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not release this station for disbursement');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Cashback ledger" subtitle="Release your station's monthly sales for disbursement">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 480 }}>
        <Field label="Month" required>
          <input type="month" style={{ ...inputStyle, maxWidth: 180 }} value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>

        {error && (
          <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
            {error}
          </div>
        )}

        {status && (
          <Card>
            <CardHeader title={status.stationName} subtitle={formatMonthLabel(month)} />
            <div style={{ marginTop: 16 }}>
              {status.released ? (
                <>
                  <Button variant="secondary" disabled style={{ width: '100%', opacity: 0.7 }}>
                    {formatMonthLabel(month)} released
                  </Button>
                  <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                    Released by {status.releasedByName ?? 'Unknown'}
                    {status.releasedAt ? ` · ${formatNairobiDateTime(status.releasedAt)}` : ''}
                  </div>
                </>
              ) : (
                <>
                  <Button variant="primary" onClick={release} disabled={busy || !withinWindow} style={{ width: '100%' }}>
                    {busy ? 'Releasing…' : `Release ${status.stationName} for ${formatMonthLabel(month)}`}
                  </Button>
                  {!withinWindow && (
                    <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 8 }}>
                      Only available on the 1st or 2nd of the month.
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

function FullLedgerView() {
  const api = useApi();
  const { user, hasPermission } = useAuth();
  const canManage = hasPermission(Permission.LEDGERS_MANAGE);
  const canApprove = hasPermission(Permission.LEDGERS_APPROVE);
  const { stations: activeStations } = useStations();
  const [month, setMonth] = useState(nairobiThisMonth);
  const [ledger, setLedger] = useState<MonthlyCashbackLedger | null>(null);
  const [busy, setBusy] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [selected, setSelected] = useState<MonthlyCashbackLedgerEntry | null>(null);
  const [showReject, setShowReject] = useState(false);
  const { search, setSearch, filtered } = useTextFilter(
    ledger?.entries ?? [],
    (e) => `${e.customerName} ${e.customerPhone} ${e.stationName}`,
  );
  const { paged, page, pageCount, setPage } = usePagedRows(filtered);

  function reload() {
    api.cashbackLedgers.get(month).then(setLedger);
  }
  useEffect(reload, [api, month]);
  useRealtimeRefresh(['monthlyCashbackLedgers'], reload);

  const canRelease = ledger && (ledger.status === LedgerStatus.OPEN_ACCRUING || ledger.status === LedgerStatus.READY_FOR_REVIEW);
  const withinWindow = isWithinReleaseWindow(user?.role ?? '');
  const releasedStationIds = new Set((ledger?.stationReleases ?? []).map((r) => r.stationId));
  const stationsForReleaseList = activeStations.filter((s) => s.active);

  async function submit() {
    setReleaseError(null);
    setBusy(true);
    try {
      await api.cashbackLedgers.submit(month);
      reload();
    } catch (err) {
      setReleaseError(err instanceof Error ? err.message : 'Could not release this month for approval');
    } finally {
      setBusy(false);
    }
  }
  async function approve() {
    setBusy(true);
    try {
      await api.cashbackLedgers.approve(month);
      reload();
    } finally {
      setBusy(false);
    }
  }
  async function reject(reason: string) {
    setShowReject(false);
    setBusy(true);
    try {
      await api.cashbackLedgers.reject(month, reason);
      reload();
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Monthly cashback ledger" subtitle="Supervisors release their own station, RTSM releases the rest, Finance Approver checks and approves, Finance Disburser pays out">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1000 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Field label="Month" required>
            <input type="month" style={{ ...inputStyle, maxWidth: 180 }} value={month} onChange={(e) => setMonth(e.target.value)} />
          </Field>
          {ledger && <Badge tone={STATUS_TONE[ledger.status]}>{ledger.status.replace(/_/g, ' ')}</Badge>}
          <div style={{ flex: 1 }} />
          {canRelease && canManage && (
            <Button variant="primary" onClick={submit} disabled={busy || !withinWindow} title={!withinWindow ? 'Only available on the 1st or 2nd of the month' : undefined}>
              Release for approval
            </Button>
          )}
          {ledger && canApprove && ledger.status === LedgerStatus.SUBMITTED_FOR_APPROVAL && (
            <>
              <Button variant="primary" onClick={approve} disabled={busy}>
                Approve
              </Button>
              <Button variant="danger" onClick={() => setShowReject(true)} disabled={busy}>
                Reject
              </Button>
            </>
          )}
        </div>

        {canRelease && canManage && !withinWindow && (
          <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: -8 }}>
            Releasing for approval is only available on the 1st or 2nd of the month.
          </div>
        )}

        {releaseError && (
          <div style={{ fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
            {releaseError}
          </div>
        )}

        {canRelease && stationsForReleaseList.length > 0 && (
          <Card padding={0}>
            <div style={{ padding: '14px 16px 6px' }}>
              <CardHeader title="Station sign-off" subtitle="A station's Supervisor releases it individually — anything left unreleased is picked up automatically when RTSM releases for approval." />
            </div>
            <Table>
              <thead>
                <tr>
                  <Th>Station</Th>
                  <Th>Status</Th>
                  <Th>Released by</Th>
                </tr>
              </thead>
              <tbody>
                {stationsForReleaseList.map((s) => {
                  const release = (ledger?.stationReleases ?? []).find((r) => r.stationId === s.id);
                  return (
                    <Tr key={s.id}>
                      <Td>{s.name}</Td>
                      <Td>
                        <Badge tone={release ? 'success' : 'neutral'}>{release ? 'Released' : 'Pending'}</Badge>
                      </Td>
                      <Td>
                        {release ? `${release.releasedByName} · ${formatNairobiDate(release.releasedAt)}` : '—'}
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
        )}

        {ledger && (
          <Card>
            {(() => {
              const released = ledger.status !== LedgerStatus.OPEN_ACCRUING && ledger.status !== LedgerStatus.READY_FOR_REVIEW;
              return (
                <>
                  {released && <StepIndicator steps={ledgerSteps(ledger)} />}
                  {ledger.status === LedgerStatus.REJECTED && ledger.rejectionReason && (
                    <div style={{ marginTop: 14, fontSize: 13, color: 'var(--color-danger)', background: 'var(--color-danger-tint)', borderRadius: 8, padding: 12 }}>
                      <strong>Rejection reason:</strong> {ledger.rejectionReason}
                    </div>
                  )}
                  <div
                    style={{
                      display: 'flex',
                      gap: 24,
                      ...(released ? { marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--color-border)' } : {}),
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>Total cashback</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26 }}>
                        KSh {ledger.totalCashback.toLocaleString('en-KE')}
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>Customers</div>
                      <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26 }}>
                        {new Set(ledger.entries.map((e) => e.customerId)).size}
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </Card>
        )}

        {ledger && ledger.entries.length > 0 && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              placeholder="Search by customer, phone, or station…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ ...inputStyle, maxWidth: 260 }}
            />
            <div style={{ flex: 1 }} />
            <ExportButtons
              filename={`cashback-ledger-${month}`}
              title={`Cashback ledger — ${month}`}
              columns={LEDGER_ENTRY_COLUMNS}
              rows={filtered}
            />
          </div>
        )}

        <div className={selected ? 'detail-grid has-detail' : 'detail-grid'}>
          <Card padding={0}>
            {!ledger || filtered.length === 0 ? (
              <div style={{ padding: 20, fontSize: 13, color: 'var(--color-text-secondary)' }}>No eligible sales for this month yet.</div>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Customer</Th>
                    <Th>Phone</Th>
                    <Th>Station</Th>
                    <Th align="right">Eligible sales</Th>
                    <Th align="right">Total cashback</Th>
                  </tr>
                </thead>
                <tbody>
                  {paged.map((e) => (
                    <Tr key={`${e.customerId}:${e.stationId}`} onClick={() => setSelected(e)}>
                      <Td>{e.customerName}</Td>
                      <Td>{e.customerPhone}</Td>
                      <Td>{e.stationName}</Td>
                      <Td align="right">{e.eligibleSalesCount}</Td>
                      <Td align="right">
                        <strong>KSh {e.totalCashback.toLocaleString('en-KE')}</strong>
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
            {ledger && <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${filtered.length} entries`} />}
          </Card>

          {selected && <CustomerMonthSales entry={selected} month={month} onClose={() => setSelected(null)} />}
        </div>
      </div>

      {showReject && (
        <PromptModal
          title="Reject cashback ledger"
          label="Reason for rejecting this ledger"
          confirmLabel="Reject"
          destructive
          onCancel={() => setShowReject(false)}
          onSubmit={reject}
        />
      )}
    </AppShell>
  );
}

function CustomerMonthSales({
  entry,
  month,
  onClose,
}: {
  entry: MonthlyCashbackLedgerEntry;
  month: string;
  onClose: () => void;
}) {
  const api = useApi();
  const [sales, setSales] = useState<Sale[] | null>(null);

  useEffect(() => {
    setSales(null);
    api.reports.customerActivity(entry.customerId).then((res) => {
      setSales(res.sales.filter((s) => s.saleDate.slice(0, 7) === month && s.stationId === entry.stationId));
    });
  }, [api, entry.customerId, entry.stationId, month]);

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>{entry.customerName}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
            {month} — {entry.stationName} only
          </div>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}>
          ×
        </button>
      </div>

      {sales === null && <div style={{ marginTop: 14, fontSize: 13, color: 'var(--color-text-secondary)' }}>Loading…</div>}
      {sales !== null && sales.length === 0 && (
        <div style={{ marginTop: 14, fontSize: 13, color: 'var(--color-text-secondary)' }}>No sales found for this month.</div>
      )}
      {sales !== null &&
        sales.map((s) => (
          <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
              <span style={{ fontWeight: 700 }}>{s.stationNameAtSale}</span>
              <span>{s.product}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 3 }}>
              <span>{formatNairobiDateTime(s.saleDate)}</span>
              <span>KSh {s.amountPaid.toLocaleString('en-KE')} paid</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', fontSize: 13, fontWeight: 800, color: 'var(--color-primary)', marginTop: 3 }}>
              KSh {s.snapshot.cashbackEarned.toLocaleString('en-KE')} cashback
            </div>
          </div>
        ))}
    </Card>
  );
}
