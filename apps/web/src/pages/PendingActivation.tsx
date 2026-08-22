import { UserStatus } from '@loyalty/shared';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { AppShell } from '../layout/AppShell';
import { Card } from '../ui/primitives';
import { Icon } from '../ui/Icon';

/**
 * Landing page for a signed-in account an Admin hasn't activated yet (see
 * AuthContext.landingPath). The session is real — Microsoft successfully
 * verified the person — but PermissionsGuard rejects every permission-gated
 * route until an Admin assigns a role and flips the account active, so
 * there is nothing real to show yet. Once activated, the realtime push
 * this account is already listening for (see AuthContext's 'users'
 * subscription) refreshes the session automatically — no reload needed.
 */
export function PendingActivation() {
  const { user, landingPath } = useAuth();

  // Once activated, the realtime session refresh (or a normal token
  // refresh) updates `user.status` in place — send an already-active
  // visitor on to their real landing page instead of leaving them stuck
  // here on a stale bookmark/link.
  if (user?.status === UserStatus.ACTIVE) return <Navigate to={landingPath} replace />;

  return (
    <AppShell title="Welcome" subtitle="Your account is signed in but not active yet">
      <Card style={{ maxWidth: 520, textAlign: 'center', padding: 36 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 999,
            background: 'var(--color-warning-tint)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto',
          }}
        >
          <Icon name="clock" size={24} color="var(--gw-amber-600)" />
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, marginTop: 16 }}>
          Waiting for an Admin to activate your account
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--color-text-secondary)', marginTop: 8, lineHeight: 1.55 }}>
          {user?.fullName ? `Hi ${user.fullName.split(' ')[0]}, y` : 'Y'}our sign-in worked, but an Admin still needs to
          assign your role and activate your account before you can use Green Wells Loyalty Cashback. This page will
          switch to your dashboard automatically as soon as that happens — no need to sign in again.
        </div>
      </Card>
    </AppShell>
  );
}
