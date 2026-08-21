import type { AuditEvent } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { useRealtimeRefresh } from '../data/realtime';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { formatNairobiDateTime } from '../lib/time';
import { ExportButtons } from '../ui/ExportButtons';
import { Button, Card, EmptyState, Table, Td, Th, Tr } from '../ui/primitives';

const AUDIT_COLUMNS: ExportColumn<AuditEvent>[] = [
  { header: 'When', value: (e) => formatNairobiDateTime(e.createdAt) },
  { header: 'Actor', value: (e) => e.actorName },
  { header: 'Action', value: (e) => e.action },
  { header: 'Entity type', value: (e) => e.entityType },
  { header: 'Entity', value: (e) => e.entityLabel ?? '' },
];

export function AuditLog() {
  const api = useApi();
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  // Cursor pagination is forward-only server-side; this stack lets "Previous" step back through pages already visited this session.
  const [cursorStack, setCursorStack] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  function reload() {
    setLoading(true);
    api.auditEvents
      .list({ cursor: cursorStack[pageIndex] })
      .then((res) => {
        setEvents(res.items);
        setTotal(res.total);
        setNextCursor(res.nextCursor);
      })
      .finally(() => setLoading(false));
  }
  useEffect(reload, [api, pageIndex]);
  useRealtimeRefresh(['auditEvents'], () => {
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

  async function fetchAllForExport(): Promise<AuditEvent[]> {
    const all: AuditEvent[] = [];
    let cursor: string | undefined;
    for (;;) {
      const res = await api.auditEvents.list({ cursor });
      all.push(...res.items);
      if (!res.nextCursor || all.length >= res.total) break;
      cursor = res.nextCursor;
    }
    return all;
  }

  return (
    <AppShell title="Audit log" subtitle="Every state-changing action across the whole system, oldest last">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <ExportButtons filename="audit-log" title="Audit log" columns={AUDIT_COLUMNS} rows={fetchAllForExport} />
      </div>
      <Card padding={0}>
        {!loading && events.length === 0 && <EmptyState title="No audit events yet" />}
        {events.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <Tr key={e.id}>
                  <Td>{formatNairobiDateTime(e.createdAt)}</Td>
                  <Td>{e.actorName}</Td>
                  <Td>{e.action}</Td>
                  <Td>{e.entityLabel ? `${e.entityType} · ${e.entityLabel}` : e.entityType}</Td>
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
    </AppShell>
  );
}
