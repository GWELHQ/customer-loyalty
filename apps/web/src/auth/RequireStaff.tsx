import type { Permission } from '@loyalty/shared';
import type { PropsWithChildren } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Route guard. Unauthenticated -> sign-in. Authenticated but lacking the
 * route's permission -> silently redirected to their own landing page,
 * never a "you don't have access" page (the backend is still the real
 * enforcement boundary; this is UX only).
 */
export function RequireStaff({ permission, children }: PropsWithChildren<{ permission?: Permission }>) {
  const { user, loading, hasPermission, landingPath } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to={landingPath} replace />;
  return <>{children}</>;
}
