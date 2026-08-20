import type { Notification } from '@loyalty/shared';
import { useEffect, useState } from 'react';
import { useApi } from '../data/client';
import { AppShell } from '../layout/AppShell';
import { Card, EmptyState } from '../ui/primitives';

export function Notifications() {
  const api = useApi();
  const [items, setItems] = useState<Notification[]>([]);

  function reload() {
    api.notifications.list().then(setItems);
  }
  useEffect(reload, [api]);

  async function open(n: Notification) {
    if (!n.read) {
      await api.notifications.markRead(n.id);
      reload();
    }
  }

  return (
    <AppShell title="Notifications" subtitle="Everything routed to you specifically">
      <Card padding={0} style={{ maxWidth: 720 }}>
        {items.length === 0 && <EmptyState title="You're all caught up" />}
        {items.map((n) => (
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
      </Card>
    </AppShell>
  );
}
