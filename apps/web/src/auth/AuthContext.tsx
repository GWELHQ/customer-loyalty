import { getPermissionsForRole, Permission, Role } from '@loyalty/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';
import { setRefreshHandler, setTokenGetter, setUnauthorizedHandler, useApi } from '../data/client';
import { env } from '../env';
import { msalInstance, msalReady, msalScopes } from './msal';

export interface StaffUser {
  kind: 'staff';
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  assignedStationId?: string;
}

const STORAGE_KEY = 'gw_session_v1';

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  user: StaffUser;
}

interface AuthContextValue {
  user: StaffUser | null;
  loading: boolean;
  hasPermission: (permission: Permission) => boolean;
  signInWithMicrosoft: () => Promise<void>;
  signOut: () => void;
  /** Where this role should land after sign-in, and where a forbidden route should silently redirect to. */
  landingPath: string;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function loadStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function saveSession(session: StoredSession | null) {
  if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else localStorage.removeItem(STORAGE_KEY);
}

export function landingPathForRole(role: Role): string {
  switch (role) {
    case Role.CHAIRMAN:
      return '/special-rates';
    case Role.FINANCE:
      return '/cashback-ledgers';
    case Role.STATION_SUPERVISOR:
      return '/reconciliation';
    default:
      return '/dashboard';
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const api = useApi();
  const [session, setSession] = useState<StoredSession | null>(() =>
    env.dataMode === 'demo' ? demoSession() : loadStoredSession(),
  );
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setTokenGetter(() => session?.accessToken ?? null);
  }, [session]);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession(null);
      saveSession(null);
    });
  }, []);

  // A 401 anywhere in the app first tries this before giving up and
  // signing out — an expired access token (15m TTL) is the common case,
  // and the refresh token (7d TTL) is almost always still good.
  useEffect(() => {
    setRefreshHandler(async () => {
      const stored = loadStoredSession();
      if (!stored) return null;
      try {
        const refreshed = await api.auth.refresh(stored.refreshToken);
        const next: StoredSession = { ...refreshed };
        setSession(next);
        saveSession(next);
        return next.accessToken;
      } catch {
        return null;
      }
    });
  }, [api]);

  // Validate the session on load. If the access token has expired, the
  // request transparently refreshes and retries via the handler above; a
  // real failure (refresh token also dead) clears the session there too.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (env.dataMode === 'demo') {
        setLoading(false);
        return;
      }
      if (!loadStoredSession()) {
        setLoading(false);
        return;
      }
      try {
        await api.auth.me();
      } catch {
        // onUnauthorized already cleared the session for a genuine 401;
        // any other error just leaves the stored session as-is.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signInWithMicrosoft = useCallback(async () => {
    await msalReady;
    const result = await msalInstance.loginPopup({ scopes: msalScopes });
    const idToken = result.idToken;
    const staffSession = await api.auth.microsoftCallback(idToken);
    const next: StoredSession = staffSession;
    setSession(next);
    saveSession(next);
  }, [api]);

  const signOut = useCallback(() => {
    setSession(null);
    saveSession(null);
    api.auth.logout().catch(() => {});
  }, [api]);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      loading,
      hasPermission: (permission) => (session ? getPermissionsForRole(session.user.role).includes(permission) : false),
      signInWithMicrosoft,
      signOut,
      landingPath: session ? landingPathForRole(session.user.role) : '/',
    }),
    [session, loading, signInWithMicrosoft, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() called outside <AuthProvider>');
  return ctx;
}

function demoSession(): StoredSession {
  return {
    accessToken: 'demo',
    refreshToken: 'demo',
    user: {
      kind: 'staff',
      userId: 'u-admin',
      email: 'a.wanjiru@greenwells.co.ke',
      fullName: 'Amina Wanjiru',
      role: Role.ADMIN,
    },
  };
}
