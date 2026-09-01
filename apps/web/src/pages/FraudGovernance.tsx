import { FraudFlagStatus, FraudFlagType, Permission, type FraudFlag } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useRealtimeRefresh } from '../data/realtime';
import { useTextFilter } from '../data/useTextFilter';
import { useStations } from '../data/useStations';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { formatNairobiDateTime } from '../lib/time';
import { ExportButtons } from '../ui/ExportButtons';
import { PlateCheckPhoto } from '../ui/PlateCheckPhoto';
import { PromptModal } from '../ui/PromptModal';
import { Badge, Button, Card, EmptyState, Modal, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';

const TYPE_LABELS: Record<FraudFlagType, string> = {
  [FraudFlagType.VOLUME_SPIKE_VS_BASELINE]: 'Volume spike vs. baseline',
  [FraudFlagType.MULTI_LOCATION_SAME_DAY]: 'Multiple locations, same day',
  [FraudFlagType.ATTENDANT_CUSTOMER_CONCENTRATION]: 'Attendant-customer concentration',
  [FraudFlagType.CUSTOMER_MULTI_ATTENDANT_BURST]: 'Many attendants, one customer',
  [FraudFlagType.REPEATED_EXACT_LITRES]: 'Repeated exact litres',
  [FraudFlagType.HIGH_FREQUENCY_REFUEL]: 'High-frequency refuel',
  [FraudFlagType.NEW_CUSTOMER_HIGH_VOLUME]: 'New customer, high volume',
  [FraudFlagType.ATTENDANT_VOLUME_OUTLIER]: 'Attendant volume outlier',
  [FraudFlagType.ADMIN_MANUAL_BURST]: 'Manual-entry burst',
  [FraudFlagType.LICENSE_PLATE_MISMATCH]: 'License plate mismatch',
  [FraudFlagType.ATTENDANT_OUTSIDE_SHIFT]: 'Attendant outside shift',
};

interface RuleInfo {
  mode: 'Real-time' | 'Nightly batch';
  description: string;
}

const RULE_INFO: Record<FraudFlagType, RuleInfo> = {
  [FraudFlagType.REPEATED_EXACT_LITRES]: {
    mode: 'Real-time',
    description:
      'The same customer buys the exact same whole-litre amount 4+ times within the trailing 90 days. Flat, repeated amounts can indicate fabricated sales used to farm cashback.',
  },
  [FraudFlagType.LICENSE_PLATE_MISMATCH]: {
    mode: 'Real-time',
    description:
      "The attendant photographed the vehicle's plate before the sale, and the plate detected by OCR doesn't match the plate on file for that customer (or the customer has none on file). Never blocks the sale — only raises this flag.",
  },
  [FraudFlagType.VOLUME_SPIKE_VS_BASELINE]: {
    mode: 'Nightly batch',
    description:
      "A customer's litres for the day exceed 3× their own trailing average (or average + 2 standard deviations), compared against at least 5 days of history. Catches a sudden jump from a normal fueling pattern.",
  },
  [FraudFlagType.MULTI_LOCATION_SAME_DAY]: {
    mode: 'Nightly batch',
    description:
      'The same customer fuels at 2 or more different stations on the same calendar day — not physically plausible for most customers, and can indicate loyalty-card sharing.',
  },
  [FraudFlagType.ATTENDANT_CUSTOMER_CONCENTRATION]: {
    mode: 'Nightly batch',
    description:
      "One attendant processes more than 80% of a specific customer's sales over a 30-day window (minimum 5 sales) — a possible sign of attendant/customer collusion.",
  },
  [FraudFlagType.CUSTOMER_MULTI_ATTENDANT_BURST]: {
    mode: 'Nightly batch',
    description:
      'One customer is served by 4 or more distinct attendants within 7 days (minimum 4 sales) — the inverse pattern, which can indicate a shared or passed-around loyalty account.',
  },
  [FraudFlagType.HIGH_FREQUENCY_REFUEL]: {
    mode: 'Real-time',
    description:
      "A customer has two or more sales less than 45 minutes apart within a 24-hour window — faster than one vehicle can plausibly refuel twice.",
  },
  [FraudFlagType.ATTENDANT_VOLUME_OUTLIER]: {
    mode: 'Nightly batch',
    description:
      "An attendant's 7-day total litres sold is a statistical outlier (more than 2.5 standard deviations above the mean) compared to peers at the same station (station needs 3+ attendants to compare against).",
  },
  [FraudFlagType.ADMIN_MANUAL_BURST]: {
    mode: 'Nightly batch',
    description:
      "A staff user's 7-day count of manually-entered sales (recorded from the admin web app rather than the field app) exceeds 3× their own 30-day baseline (minimum 5 in the week) — a burst of manual entries bypassing the normal attendant flow.",
  },
  [FraudFlagType.NEW_CUSTOMER_HIGH_VOLUME]: {
    mode: 'Nightly batch',
    description:
      "A customer registered within the last 14 days has a first-sale volume more than 2× the average first-sale volume of other recently registered customers — unusual for a brand-new account.",
  },
  [FraudFlagType.ATTENDANT_OUTSIDE_SHIFT]: {
    mode: 'Real-time',
    description:
      "The selling attendant isn't on the shift roster recorded for that station/date/shift (day 07:30-16:30, night 16:30-07:30). Only fires when a roster was actually recorded — a station with no roster for that day doesn't get flagged.",
  },
};

const STATUS_TONE: Record<FraudFlagStatus, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  [FraudFlagStatus.OPEN]: 'danger',
  [FraudFlagStatus.UNDER_REVIEW]: 'warning',
  [FraudFlagStatus.RESOLVED]: 'success',
  [FraudFlagStatus.DISMISSED]: 'neutral',
};

const FLAG_COLUMNS: ExportColumn<FraudFlag>[] = [
  { header: 'Detected', value: (f) => formatNairobiDateTime(f.createdAt) },
  { header: 'Type', value: (f) => TYPE_LABELS[f.type] },
  { header: 'Severity', value: (f) => f.severity },
  { header: 'Status', value: (f) => f.status },
  { header: 'Customer', value: (f) => f.customerNameAtFlag ?? '' },
  { header: 'Station', value: (f) => f.stationNameAtFlag ?? '' },
  { header: 'Attendant', value: (f) => f.attendantNameAtFlag ?? '' },
  { header: 'Detection mode', value: (f) => f.detectionMode },
];

export function FraudGovernance() {
  const api = useApi();
  const { hasPermission } = useAuth();
  const canManage = hasPermission(Permission.FRAUD_MANAGE);
  const { stations } = useStations();

  const [flags, setFlags] = useState<FraudFlag[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<FraudFlag | null>(null);
  const [busy, setBusy] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<FraudFlag | null>(null);
  const [dismissTarget, setDismissTarget] = useState<FraudFlag | null>(null);

  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [stationId, setStationId] = useState('');
  // Filters this page only — fraud flags have no backend search endpoint.
  const { search, setSearch, filtered: filteredFlags } = useTextFilter(
    flags,
    (f) => `${f.customerNameAtFlag ?? ''} ${f.attendantNameAtFlag ?? ''}`,
  );

  function resetToFirstPage() {
    setCursorStack([undefined]);
    setPageIndex(0);
  }

  function reload() {
    setLoading(true);
    api.fraudFlags
      .list({
        type: (type || undefined) as FraudFlagType | undefined,
        status: (status || undefined) as FraudFlagStatus | undefined,
        stationId: stationId || undefined,
        cursor: cursorStack[pageIndex],
      })
      .then((res) => {
        setFlags(res.items);
        setTotal(res.total);
        setNextCursor(res.nextCursor);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api, type, status, stationId, pageIndex]);
  useEffect(resetToFirstPage, [type, status, stationId]);
  useRealtimeRefresh(['fraudFlags'], resetToFirstPage);

  function goNext() {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  }
  function goPrev() {
    setPageIndex((i) => Math.max(0, i - 1));
  }

  async function fetchAllForExport(): Promise<FraudFlag[]> {
    const all: FraudFlag[] = [];
    let cursor: string | undefined;
    for (;;) {
      const res = await api.fraudFlags.list({
        type: (type || undefined) as FraudFlagType | undefined,
        status: (status || undefined) as FraudFlagStatus | undefined,
        stationId: stationId || undefined,
        cursor,
      });
      all.push(...res.items);
      if (!res.nextCursor || all.length >= res.total) break;
      cursor = res.nextCursor;
    }
    return all;
  }

  async function startReview(flag: FraudFlag) {
    setBusy(true);
    try {
      const updated = await api.fraudFlags.startReview(flag.id);
      setSelected(updated);
    } finally {
      setBusy(false);
    }
  }

  async function resolve(flag: FraudFlag, note: string) {
    setResolveTarget(null);
    setBusy(true);
    try {
      const updated = await api.fraudFlags.resolve(flag.id, note);
      setSelected(updated);
    } finally {
      setBusy(false);
    }
  }

  async function dismiss(flag: FraudFlag, note: string) {
    setDismissTarget(null);
    setBusy(true);
    try {
      const updated = await api.fraudFlags.dismiss(flag.id, note);
      setSelected(updated);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AppShell title="Fraud & Governance" subtitle="Irregular fueling activity flagged automatically for review">
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          placeholder="Search this page by customer or attendant…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, maxWidth: 260 }}
        />
        <select style={{ ...inputStyle, maxWidth: 220 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All types</option>
          {Object.values(FraudFlagType).map((t) => (
            <option key={t} value={t}>
              {TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <select style={{ ...inputStyle, maxWidth: 180 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {Object.values(FraudFlagStatus).map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        {stations.length > 0 && (
          <select style={{ ...inputStyle, maxWidth: 200 }} value={stationId} onChange={(e) => setStationId(e.target.value)}>
            <option value="">All stations</option>
            {stations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <div style={{ flex: 1 }} />
        <ExportButtons filename="fraud-flags" title="Fraud & Governance" columns={FLAG_COLUMNS} rows={fetchAllForExport} />
        <Button
          variant="secondary"
          size="sm"
          aria-label="Explain the fraud detection rules"
          title="Explain the fraud detection rules"
          onClick={() => setShowRules(true)}
          style={{ width: 34, height: 34, padding: 0, borderRadius: '50%' }}
        >
          ?
        </Button>
      </div>

      {showRules && (
        <Modal title="Fraud detection rules" onClose={() => setShowRules(false)}>
          <div style={{ maxHeight: '65vh', overflowY: 'auto', paddingRight: 4 }}>
            <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginTop: 0 }}>
              Sales are checked automatically for irregular patterns. Real-time checks run right after a sale is
              recorded; the rest run once nightly over the recent sales history. A flag never blocks a sale — it
              only queues the activity for review.
            </p>
            {Object.entries(RULE_INFO).map(([type, info]) => (
              <div key={type} style={{ padding: '10px 0', borderBottom: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 13.5 }}>{TYPE_LABELS[type as FraudFlagType]}</span>
                  <Badge tone={info.mode === 'Real-time' ? 'info' : 'neutral'}>{info.mode}</Badge>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 4, lineHeight: 1.5 }}>
                  {info.description}
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 380px' : '1fr', gap: 16 }}>
        <Card padding={0}>
          {loading && <div style={{ padding: 20, color: 'var(--color-text-secondary)' }}>Loading…</div>}
          {!loading && filteredFlags.length === 0 && <EmptyState title="No irregularities flagged" body="Nothing to review right now." />}
          {!loading && filteredFlags.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Detected</Th>
                  <Th>Type</Th>
                  <Th>Severity</Th>
                  <Th>Status</Th>
                  <Th>Subject</Th>
                </tr>
              </thead>
              <tbody>
                {filteredFlags.map((f) => (
                  <Tr key={f.id} onClick={() => setSelected(f)}>
                    <Td>{formatNairobiDateTime(f.createdAt)}</Td>
                    <Td>{TYPE_LABELS[f.type]}</Td>
                    <Td>
                      <Badge tone={f.severity === 'high' ? 'danger' : f.severity === 'medium' ? 'warning' : 'neutral'}>
                        {f.severity}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge tone={STATUS_TONE[f.status]}>{f.status.replace('_', ' ')}</Badge>
                    </Td>
                    <Td>{f.customerNameAtFlag ?? f.attendantNameAtFlag ?? '—'}</Td>
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
              Page {pageIndex + 1} · {total} flag(s) total
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

        {selected && (
          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 16 }}>{TYPE_LABELS[selected.type]}</div>
              <button
                onClick={() => setSelected(null)}
                style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 18, color: 'var(--color-text-muted)' }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <Badge tone={selected.severity === 'high' ? 'danger' : selected.severity === 'medium' ? 'warning' : 'neutral'}>
                {selected.severity}
              </Badge>
              <Badge tone={STATUS_TONE[selected.status]}>{selected.status.replace('_', ' ')}</Badge>
            </div>

            <DetailRow label="Detected" value={formatNairobiDateTime(selected.createdAt)} />
            {selected.customerNameAtFlag && <DetailRow label="Customer" value={selected.customerNameAtFlag} />}
            {selected.stationNameAtFlag && <DetailRow label="Station" value={selected.stationNameAtFlag} />}
            {selected.attendantNameAtFlag && <DetailRow label="Attendant" value={selected.attendantNameAtFlag} />}
            <DetailRow label="Detection mode" value={selected.detectionMode} />
            <DetailRow label="Related sales" value={`${selected.relatedSaleIds.length}`} />

            <div style={{ marginTop: 12, fontSize: 13, fontWeight: 700 }}>Evidence</div>
            <div
              style={{
                marginTop: 6,
                padding: 10,
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-surface-muted, rgba(127,127,127,0.08))',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
              }}
            >
              {Object.entries(selected.evidence).map(([key, value]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                  <span style={{ color: 'var(--color-text-secondary)' }}>{key}</span>
                  <span>{String(value)}</span>
                </div>
              ))}
            </div>
            {typeof selected.evidence.plateCheckId === 'string' && (
              <div style={{ marginTop: 8 }}>
                <PlateCheckPhoto plateCheckId={selected.evidence.plateCheckId} />
              </div>
            )}

            {selected.reviewedByName && (
              <>
                <DetailRow label="Reviewed by" value={selected.reviewedByName} />
                {selected.reviewedAt && <DetailRow label="Reviewed at" value={formatNairobiDateTime(selected.reviewedAt)} />}
                {selected.resolutionNote && <DetailRow label="Note" value={selected.resolutionNote} />}
              </>
            )}

            {canManage && selected.status === FraudFlagStatus.OPEN && (
              <Button variant="secondary" size="sm" onClick={() => startReview(selected)} disabled={busy} style={{ marginTop: 12, marginRight: 8 }}>
                Start review
              </Button>
            )}
            {canManage && (selected.status === FraudFlagStatus.OPEN || selected.status === FraudFlagStatus.UNDER_REVIEW) && (
              <>
                <Button variant="primary" size="sm" onClick={() => setResolveTarget(selected)} disabled={busy} style={{ marginTop: 12, marginRight: 8 }}>
                  Resolve
                </Button>
                <Button variant="danger" size="sm" onClick={() => setDismissTarget(selected)} disabled={busy} style={{ marginTop: 12 }}>
                  Dismiss
                </Button>
              </>
            )}
          </Card>
        )}
      </div>

      {resolveTarget && (
        <PromptModal
          title="Resolve fraud flag"
          label="Resolution note (what was found)"
          confirmLabel="Resolve"
          onCancel={() => setResolveTarget(null)}
          onSubmit={(note) => resolve(resolveTarget, note)}
        />
      )}

      {dismissTarget && (
        <PromptModal
          title="Dismiss fraud flag"
          label="Reason for dismissing this flag"
          confirmLabel="Dismiss"
          destructive
          onCancel={() => setDismissTarget(null)}
          onSubmit={(note) => dismiss(dismissTarget, note)}
        />
      )}
    </AppShell>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid var(--color-border)', fontSize: 13 }}>
      <span style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ fontWeight: 600 }}>{value}</span>
    </div>
  );
}
