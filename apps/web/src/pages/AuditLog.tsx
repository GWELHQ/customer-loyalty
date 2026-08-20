import type { AuditEvent } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { AppShell } from '../layout/AppShell';
import { Card, EmptyState, Table, Td, Th, Tr } from '../ui/primitives';

export function AuditLog() {
  const api = useApi();
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    api.auditEvents.list({ limit: 200 }).then(setEvents);
  }, [api]);

  return (
    <AppShell title="Audit log" subtitle="Every state-changing action across the whole system, oldest last">
      <Card padding={0}>
        {events.length === 0 && <EmptyState title="No audit events yet" />}
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
                  <Td>{new Date(e.createdAt).toLocaleString('en-KE')}</Td>
                  <Td>{e.actorName}</Td>
                  <Td>{e.action}</Td>
                  <Td>
                    {e.entityType} · {e.entityId.slice(0, 8)}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </AppShell>
  );
}
