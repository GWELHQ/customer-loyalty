import { Role } from '@loyalty/shared';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { Icon } from '../ui/Icon';
import { navItemsForRole } from './nav';

const ROLE_LABELS: Record<Role, string> = {
  [Role.ADMIN]: 'Admin',
  [Role.CHAIRMAN]: 'Chairman',
  [Role.FINANCE]: 'Finance',
  [Role.RTSM]: 'Retail Sales Manager',
  [Role.STATION_SUPERVISOR]: 'Station Supervisor',
  [Role.ATTENDANT]: 'Attendant',
  [Role.EXEC_VIEWER]: 'Exec Viewer',
};

export function AppShell({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle?: string }>) {
  const { user, hasPermission, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const api = useApi();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    api.notifications
      .list()
      .then((list) => setUnreadCount(list.filter((n) => !n.read).length))
      .catch(() => {});
  }, [api, user, location.pathname]);

  if (!user) return null;
  const nav = navItemsForRole(user.role, hasPermission);
  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '244px 1fr', minHeight: '100vh', alignItems: 'stretch' }}>
      <div
        style={{
          background: 'var(--gw-blue-500)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          position: 'sticky',
          top: 0,
          height: '100vh',
        }}
      >
        <div style={{ padding: '20px 18px 16px' }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, letterSpacing: '0.03em' }}>
            GREEN WELLS
          </div>
          <div style={{ fontSize: 12, color: '#8fa8d0', marginTop: 2 }}>Loyalty cashback</div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: '0 10px 16px', display: 'flex', flexDirection: 'column', gap: 2 }}>
          {nav.map((n) => {
            const active = location.pathname.startsWith(n.path);
            return (
              <button
                key={n.path}
                onClick={() => navigate(n.path)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  border: 'none',
                  borderRadius: 8,
                  padding: '9px 10px',
                  cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13.5,
                  fontWeight: 600,
                  background: active ? 'rgba(255,255,255,.14)' : 'transparent',
                  color: active ? '#fff' : '#c3d0e6',
                }}
              >
                <Icon name={n.icon} size={17} color={active ? '#fff' : '#8fa8d0'} />
                <span style={{ flex: 1 }}>{n.label}</span>
                {n.path === '/notifications' && unreadCount > 0 && (
                  <span
                    style={{
                      background: 'var(--gw-red-500)',
                      color: '#fff',
                      fontSize: 11,
                      fontWeight: 800,
                      borderRadius: 999,
                      minWidth: 18,
                      height: 18,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0 5px',
                    }}
                  >
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <div style={{ padding: '14px 16px', borderTop: '1px solid rgba(255,255,255,.14)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              background: 'rgba(255,255,255,.16)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 800,
              fontSize: 12,
            }}
          >
            {initials}
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user.fullName}
            </div>
            <div style={{ fontSize: 11.5, color: '#8fa8d0' }}>{ROLE_LABELS[user.role]}</div>
          </div>
          <button onClick={signOut} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', display: 'flex' }} aria-label="Sign out">
            <Icon name="logout" size={16} color="#8fa8d0" />
          </button>
        </div>
      </div>

      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            padding: '12px 24px',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            flexWrap: 'wrap',
            position: 'sticky',
            top: 0,
            zIndex: 5,
          }}
        >
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, letterSpacing: '-0.01em' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 1 }}>{subtitle}</div>}
          </div>
          <button
            onClick={() => navigate('/notifications')}
            style={{
              position: 'relative',
              width: 34,
              height: 34,
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
            aria-label="Notifications"
          >
            <Icon name="bell" size={17} color="var(--color-text-secondary)" />
            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: -5,
                  right: -5,
                  background: 'var(--gw-red-500)',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 800,
                  borderRadius: 999,
                  minWidth: 17,
                  height: 17,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {unreadCount}
              </span>
            )}
          </button>
        </div>

        <div style={{ flex: 1, padding: '20px 24px 40px', minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
