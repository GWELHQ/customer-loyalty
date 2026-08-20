import type { Notification } from '@loyalty/shared';
import { useApi } from '../data/client';
import { useNotificationsCache } from '../data/entityCaches';
import { usePagedRows } from '../data/usePagedRows';
import { AppShell } from '../layout/AppShell';
import type { ExportColumn } from '../lib/exportTable';
import { ExportButtons } from '../ui/ExportButtons';
import { Card, EmptyState, Pagination } from '../ui/primitives';

const NOTIFICATION_COLUMNS: ExportColumn<Notification>[] = [
  { header: 'Title', value: (n) => n.title },
  { header: 'Body', value: (n) => n.body },
  { header: 'Type', value: (n) => n.type },
  { header: 'Read', value: (n) => (n.read ? 'Yes' : 'No') },
  { header: 'Created', value: (n) => new Date(n.createdAt).toLocaleString('en-KE') },
];

export function Notifications() {
  const api = useApi();
  const { items, refresh: reload } = useNotificationsCache();
  const { paged, page, pageCount, setPage } = usePagedRows(items);

  async function open(n: Notification) {
    if (!n.read) {
      await api.notifications.markRead(n.id);
      reload();
    }
  }

  return (
    <AppShell title="Notifications" subtitle="Everything routed to you specifically">
      {items.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14, maxWidth: 720 }}>
          <ExportButtons filename="notifications" title="Notifications" columns={NOTIFICATION_COLUMNS} rows={items} />
        </div>
      )}
      <Card padding={0} style={{ maxWidth: 720 }}>
        {items.length === 0 && <EmptyState title="You're all caught up" />}
        {paged.map((n) => (
          <button
            key={n.id}
            onClick={() => open(n)}
            style={{
              width: '100%',
              textAlign: 'left',
              background: n.read ? 'transparent' : 'var(--color-primary-tint)',
              border: 'none',
              borderBottom: '1px solid var(--color-border)',
              padding: '14px 16px',
              cursor: 'pointer',
              display: 'flex',
              gap: 11,
              alignItems: 'flex-start',
            }}
          >
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: 999,
                background: n.read ? 'var(--color-border-strong)' : 'var(--color-primary)',
                marginTop: 6,
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700 }}>{n.title}</span>
              <span style={{ display: 'block', fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 2, lineHeight: 1.45 }}>
                {n.body}
              </span>
              <span style={{ display: 'block', fontSize: 11.5, color: 'var(--color-text-muted)', marginTop: 4 }}>
                {new Date(n.createdAt).toLocaleString('en-KE')}
              </span>
            </span>
          </button>
        ))}
        <Pagination page={page} pageCount={pageCount} onChange={setPage} totalLabel={`${items.length} notification(s)`} />
      </Card>
    </AppShell>
  );
}
