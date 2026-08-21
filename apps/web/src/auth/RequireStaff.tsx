import type { Permission } from '@loyalty/shared';
import type { PropsWithChildren } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * Route guard. Unauthenticated -> sign-in. Authenticated but lacking the
 * route's permission -> silently redirected to their own landing page,
 * never a "you don't have access" page (the backend is still the real
 * enforcement boundary; this is UX only). `anyPermission` passes when the
 * user holds at least one of the listed permissions — for routes the API
 * itself gates with @RequireAnyPermission (e.g. an "all stations" vs.
 * "own station" pair).
 */
export function RequireStaff({
  permission,
  anyPermission,
  children,
}: PropsWithChildren<{ permission?: Permission; anyPermission?: Permission[] }>) {
  const { user, loading, hasPermission, landingPath } = useAuth();

  if (loading) return null;
  if (!user) return <Navigate to="/" replace />;
  if (permission && !hasPermission(permission)) return <Navigate to={landingPath} replace />;
  if (anyPermission && !anyPermission.some(hasPermission)) return <Navigate to={landingPath} replace />;
  return <>{children}</>;
}
