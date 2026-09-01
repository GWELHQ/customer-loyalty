import { CustomerRegistrationStatus, Permission, type Notification } from '@loyalty/shared';
import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useApi } from '../data/client';
import { useRealtimeRefresh } from '../data/realtime';
import { useRoles } from '../data/useRoles';
import { formatNairobiDateTime } from '../lib/time';
import { EmptyState } from '../ui/primitives';
import { Icon } from '../ui/Icon';
import { navItemsForRole } from './nav';

export function AppShell({ title, subtitle, children }: PropsWithChildren<{ title: string; subtitle?: string }>) {
  const { user, hasPermission, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const api = useApi();
  const { roles } = useRoles();
  const roleLabel = useMemo(() => new Map(roles.map((r) => [r.key, r.displayName])), [roles]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingRegistrations, setPendingRegistrations] = useState(0);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const notificationsPanelRef = useRef<HTMLDivElement>(null);
  const canViewRegistrations = !!user && hasPermission(Permission.CUSTOMER_REGISTRATIONS_VIEW);

  const reloadUnreadCount = useCallback(() => {
    if (!user) return;
    api.notifications
      .list()
      .then((list) => setUnreadCount(list.filter((n) => !n.read).length))
      .catch(() => {});
  }, [api, user]);

  const reloadNotifications = useCallback(() => {
    if (!user) return;
    api.notifications
      .list()
      .then(setNotifications)
      .catch(() => {});
  }, [api, user]);

  const reloadPendingRegistrations = useCallback(() => {
    if (!canViewRegistrations) return;
    api.customerRegistrations
      .list(CustomerRegistrationStatus.PENDING)
      .then((list) => setPendingRegistrations(list.length))
      .catch(() => {});
  }, [api, canViewRegistrations]);

  useEffect(reloadUnreadCount, [reloadUnreadCount, location.pathname]);
  useRealtimeRefresh(['notifications'], reloadUnreadCount);
  useRealtimeRefresh(['notifications'], () => {
    if (notificationsOpen) reloadNotifications();
  });
  useEffect(reloadPendingRegistrations, [reloadPendingRegistrations, location.pathname]);
  useRealtimeRefresh(['customerRegistrationRequests'], reloadPendingRegistrations);

  useEffect(() => setSidebarOpen(false), [location.pathname]);

  useEffect(() => {
    if (!notificationsOpen) return;
    reloadNotifications();
    function onClickOutside(e: MouseEvent) {
      if (notificationsPanelRef.current && !notificationsPanelRef.current.contains(e.target as Node)) {
        setNotificationsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [notificationsOpen, reloadNotifications]);

  async function markAllRead() {
    await api.notifications.markAllRead();
    reloadUnreadCount();
    reloadNotifications();
  }

  async function clearAllNotifications() {
    await api.notifications.clearAll();
    reloadUnreadCount();
    reloadNotifications();
  }

  async function openNotification(n: Notification) {
    if (!n.read) {
      await api.notifications.markRead(n.id);
      reloadUnreadCount();
      reloadNotifications();
    }
    setNotificationsOpen(false);
    if (n.linkPath) {
      // linkPath may point at a per-item detail path (e.g. /cashback-ledgers/2026-08)
      // that has no dedicated route — the item is decided from its list page instead,
      // so navigate to that top-level list rather than 404ing.
      const listPath = '/' + n.linkPath.split('/').filter(Boolean)[0];
      navigate(listPath);
    }
  }

  if (!user) return null;
  const nav = navItemsForRole(user.role, hasPermission);
  const initials = user.fullName
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="app-shell-grid" style={{ display: 'grid', minHeight: '100vh', alignItems: 'stretch' }}>
      <div
        className={sidebarOpen ? 'app-shell-overlay open' : 'app-shell-overlay'}
        onClick={() => setSidebarOpen(false)}
      />
      <div
        className={sidebarOpen ? 'app-shell-sidebar open' : 'app-shell-sidebar'}
        style={{
          background: 'var(--gw-blue-500)',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '20px 18px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo-mark.png" alt="Green Wells" style={{ width: 30, height: 30, objectFit: 'contain', flex: 'none' }} />
          <div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, letterSpacing: '0.03em' }}>
              GREEN WELLS
            </div>
            <div style={{ fontSize: 12, color: '#8fa8d0', marginTop: 2 }}>Loyalty cashback</div>
          </div>
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
                {n.path === '/customer-registrations' && pendingRegistrations > 0 && (
                  <span
                    style={{
                      background: 'var(--gw-amber-500)',
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
                    {pendingRegistrations}
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
            <div style={{ fontSize: 11.5, color: '#8fa8d0' }}>{roleLabel.get(user.role) ?? user.role}</div>
          </div>
          <button onClick={signOut} style={{ background: 'none', border: 'none', padding: 4, cursor: 'pointer', display: 'flex' }} aria-label="Sign out">
            <Icon name="logout" size={16} color="#8fa8d0" />
          </button>
        </div>
      </div>

      <div className="app-shell-content" style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
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
          <button
            className="app-shell-hamburger"
            onClick={() => setSidebarOpen(true)}
            style={{
              width: 34,
              height: 34,
              borderRadius: 8,
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              flex: 'none',
            }}
            aria-label="Open menu"
          >
            <Icon name="menu" size={17} color="var(--color-text-secondary)" />
          </button>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, letterSpacing: '-0.01em' }}>{title}</div>
            {subtitle && <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginTop: 1 }}>{subtitle}</div>}
          </div>
          <div ref={notificationsPanelRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setNotificationsOpen((v) => !v)}
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
            {notificationsOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 42,
                  right: 0,
                  width: 'min(360px, calc(100vw - 32px))',
                  maxHeight: 420,
                  overflow: 'auto',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 10,
                  boxShadow: '0 8px 24px rgba(0,0,0,.12)',
                  zIndex: 20,
                }}
              >
                <div
                  style={{
                    padding: '10px 14px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                  }}
                >
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>Notifications</span>
                  {notifications.length > 0 && (
                    <span style={{ display: 'flex', gap: 10 }}>
                      {unreadCount > 0 && (
                        <button
                          onClick={markAllRead}
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            fontSize: 11.5,
                            fontWeight: 700,
                            color: 'var(--color-primary)',
                          }}
                        >
                          Mark all as read
                        </button>
                      )}
                      <button
                        onClick={clearAllNotifications}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: 'var(--color-text-secondary)',
                        }}
                      >
                        Clear all
                      </button>
                    </span>
                  )}
                </div>
                {notifications.length === 0 && <EmptyState title="You're all caught up" />}
                {notifications.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openNotification(n)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      background: n.read ? 'transparent' : 'var(--color-primary-tint)',
                      border: 'none',
                      borderBottom: '1px solid var(--color-border)',
                      padding: '12px 14px',
                      cursor: 'pointer',
                      display: 'flex',
                      gap: 10,
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
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 13, fontWeight: 700 }}>{n.title}</span>
                      <span
                        style={{
                          display: 'block',
                          fontSize: 12,
                          color: 'var(--color-text-secondary)',
                          marginTop: 2,
                          lineHeight: 1.4,
                        }}
                      >
                        {n.body}
                      </span>
                      <span style={{ display: 'block', fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3 }}>
                        {formatNairobiDateTime(n.createdAt)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ flex: 1, padding: '20px 24px 40px', minWidth: 0 }}>{children}</div>
      </div>
    </div>
  );
}
