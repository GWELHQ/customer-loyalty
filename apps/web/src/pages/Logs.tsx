import type { AuditEvent, SmsDelivery } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { useRealtimeRefresh } from '../data/realtime';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { formatNairobiDateTime } from '../lib/time';
import { Badge, Button, Card, EmptyState, Table, Td, Th, Tr, inputStyle } from '../ui/primitives';
import { ExportButtons } from '../ui/ExportButtons';
import { useTextFilter } from '../data/useTextFilter';

// Every entityType value any audit.record() call in apps/api/src currently
// uses — kept as a flat allow-list rather than derived from live data so the
// dropdown is stable even on a quiet day with no recent events of a type.
const AUDIT_ENTITY_TYPES = [
  'sale',
  'customer',
  'customerRegistrationRequest',
  'attendant',
  'user',
  'station',
  'productPrice',
  'priceReminderSetting',
  'specialRateRequest',
  'monthlyCashbackLedger',
  'disbursementBatch',
  'disbursementSettings',
  'customerInactivitySettings',
  'reconciliationDaily',
  'fraudFlags',
  'importJob',
  'saleApprovalDelegations',
].sort();

type Tab = 'audit' | 'sms';

export function Logs() {
  const [tab, setTab] = useState<Tab>('audit');

  return (
    <AppShell title="Logs" subtitle="Every state-changing action and every SMS sent, across the whole system">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Button variant={tab === 'audit' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('audit')}>
          Audit log
        </Button>
        <Button variant={tab === 'sms' ? 'primary' : 'secondary'} size="sm" onClick={() => setTab('sms')}>
          SMS log
        </Button>
      </div>
      {tab === 'audit' ? <AuditLogTab /> : <SmsLogTab />}
    </AppShell>
  );
}

const AUDIT_COLUMNS: ExportColumn<AuditEvent>[] = [
  { header: 'When', value: (e) => formatNairobiDateTime(e.createdAt) },
  { header: 'Actor', value: (e) => e.actorName },
  { header: 'Action', value: (e) => e.action },
  { header: 'Entity type', value: (e) => e.entityType },
  { header: 'Entity', value: (e) => e.entityLabel ?? '' },
  { header: 'Entity ID', value: (e) => e.entityId },
  { header: 'Fraud flag', value: (e) => (e.hasFraudFlag ? 'Yes' : '') },
  { header: 'Details', value: (e) => (e.metadata ? JSON.stringify(e.metadata) : '') },
];

function AuditLogTab() {
  const api = useApi();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [entityType, setEntityType] = useState('');
  // Cursor pagination is forward-only server-side; this stack lets "Previous" step back through pages already visited this session.
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  // Filters this page only — there's no backend search endpoint for audit
  // events, so this narrows the currently-loaded page, not the whole log.
  const { search, setSearch, filtered: filteredEvents } = useTextFilter(
    events,
    (e) => `${e.actorName} ${e.action} ${e.entityLabel ?? ''} ${e.entityType}`,
  );

  function reload() {
    setLoading(true);
    api.auditEvents
      .list({ cursor: cursorStack[pageIndex], entityType: entityType || undefined })
      .then((res) => {
        setEvents(res.items);
        setTotal(res.total);
        setNextCursor(res.nextCursor);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api, pageIndex, entityType]);
  useRealtimeRefresh(['auditEvents'], () => {
    setCursorStack([undefined]);
    setPageIndex(0);
  });

  function changeEntityType(value: string) {
    setEntityType(value);
    setCursorStack([undefined]);
    setPageIndex(0);
  }

  function goNext() {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  }
  function goPrev() {
    setPageIndex((i) => Math.max(0, i - 1));
  }

  async function fetchAllForExport(): Promise<AuditEvent[]> {
    const all: AuditEvent[] = [];
    let cursor: string | undefined;
    for (;;) {
      const res = await api.auditEvents.list({ cursor, entityType: entityType || undefined });
      all.push(...res.items);
      if (!res.nextCursor || all.length >= res.total) break;
      cursor = res.nextCursor;
    }
    return all;
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            placeholder="Search this page…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, maxWidth: 220 }}
          />
          <select
            style={{ ...inputStyle, maxWidth: 220 }}
            value={entityType}
            onChange={(e) => changeEntityType(e.target.value)}
            aria-label="Filter by action type"
          >
            <option value="">All actions</option>
            {AUDIT_ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <ExportButtons filename="audit-log" title="Audit log" columns={AUDIT_COLUMNS} rows={fetchAllForExport} />
      </div>
      <Card padding={0}>
        {!loading && filteredEvents.length === 0 && (
          <EmptyState title={entityType ? `No "${entityType}" events yet` : 'No audit events yet'} />
        )}
        {filteredEvents.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>Entity ID</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((e) => (
                <Tr
                  key={e.id}
                  style={e.hasFraudFlag ? { background: 'var(--color-danger-tint)' } : undefined}
                >
                  <Td>{formatNairobiDateTime(e.createdAt)}</Td>
                  <Td>{e.actorName}</Td>
                  <Td>{e.action}</Td>
                  <Td>
                    {e.entityLabel ? `${e.entityType} · ${e.entityLabel}` : e.entityType}
                    {e.hasFraudFlag && (
                      <span style={{ marginLeft: 6 }}>
                        <Badge tone="danger">Fraud</Badge>
                      </span>
                    )}
                  </Td>
                  <Td>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, color: 'var(--color-text-muted)' }}>
                      {e.entityId}
                    </span>
                  </Td>
                  <Td>
                    {e.metadata ? (
                      <span
                        title={JSON.stringify(e.metadata)}
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 11.5,
                          color: 'var(--color-text-secondary)',
                          display: 'inline-block',
                          maxWidth: 260,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          verticalAlign: 'bottom',
                        }}
                      >
                        {JSON.stringify(e.metadata)}
                      </span>
                    ) : (
                      ''
                    )}
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
            Page {pageIndex + 1} · {total} event(s) total
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
    </>
  );
}

const SMS_COLUMNS: ExportColumn<SmsDelivery>[] = [
  { header: 'When', value: (d) => formatNairobiDateTime(d.createdAt) },
  { header: 'Phone', value: (d) => d.customerPhone },
  { header: 'Message', value: (d) => d.message },
  { header: 'Status', value: (d) => d.status },
  { header: 'Provider', value: (d) => d.providerName },
  { header: 'Sale ID', value: (d) => d.saleId ?? '' },
  { header: 'Retry count', value: (d) => d.retryCount },
  { header: 'Sent at', value: (d) => (d.sentAt ? formatNairobiDateTime(d.sentAt) : '') },
  { header: 'Error reason', value: (d) => d.errorReason ?? '' },
];

function SmsLogTab() {
  const api = useApi();
  const [deliveries, setDeliveries] = useState<SmsDelivery[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const byStatus = deliveries.filter((d) => !statusFilter || d.status === statusFilter);
  const { search, setSearch, filtered: filteredDeliveries } = useTextFilter(byStatus, (d) => `${d.customerPhone} ${d.message}`);

  function reload() {
    setLoading(true);
    api.smsDeliveries
      .list({ cursor: cursorStack[pageIndex] })
      .then((res) => {
        setDeliveries(res.items);
        setTotal(res.total);
        setNextCursor(res.nextCursor);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api, pageIndex]);
  useRealtimeRefresh(['smsDeliveries'], () => {
    setCursorStack([undefined]);
    setPageIndex(0);
  });

  function goNext() {
    if (!nextCursor) return;
    setCursorStack((stack) => [...stack.slice(0, pageIndex + 1), nextCursor]);
    setPageIndex((i) => i + 1);
  }
  function goPrev() {
    setPageIndex((i) => Math.max(0, i - 1));
  }

  async function fetchAllForExport(): Promise<SmsDelivery[]> {
    const all: SmsDelivery[] = [];
    let cursor: string | undefined;
    for (;;) {
      const res = await api.smsDeliveries.list({ cursor });
      all.push(...res.items);
      if (!res.nextCursor || all.length >= res.total) break;
      cursor = res.nextCursor;
    }
    return all;
  }

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <input
            placeholder="Search this page by phone or message…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...inputStyle, maxWidth: 260 }}
          />
          <select style={{ ...inputStyle, maxWidth: 160 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="failed">Failed</option>
          </select>
        </div>
        <ExportButtons filename="sms-log" title="SMS log" columns={SMS_COLUMNS} rows={fetchAllForExport} />
      </div>
      <Card padding={0}>
        {!loading && filteredDeliveries.length === 0 && <EmptyState title="No SMS found" />}
        {filteredDeliveries.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Phone</Th>
                <Th>Message</Th>
                <Th>Status</Th>
                <Th>Provider</Th>
              </tr>
            </thead>
            <tbody>
              {filteredDeliveries.map((d) => (
                <Tr key={d.id}>
                  <Td>{formatNairobiDateTime(d.createdAt)}</Td>
                  <Td>{d.customerPhone}</Td>
                  <Td>
                    <span
                      title={d.message}
                      style={{
                        display: 'inline-block',
                        maxWidth: 340,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        verticalAlign: 'bottom',
                      }}
                    >
                      {d.message}
                    </span>
                  </Td>
                  <Td>
                    <Badge tone={d.status === 'sent' ? 'success' : d.status === 'failed' ? 'danger' : 'neutral'}>
                      {d.status}
                    </Badge>
                    {d.status === 'failed' && d.errorReason && (
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 3 }}>{d.errorReason}</div>
                    )}
                  </Td>
                  <Td>{d.providerName}</Td>
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
            Page {pageIndex + 1} · {total} message(s) total
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
    </>
  );
}
