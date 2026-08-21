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
import type { LoyaltyApiClient } from '@loyalty/api-client';
import { setRefreshHandler, setTokenGetter, setUnauthorizedHandler, useApi } from '../data/client';
import { connectRealtime, disconnectRealtime } from '../data/realtime';
import { env } from '../env';
import { isTokenExpiringSoon } from '../lib/jwt';
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

/** Exchanges the stored refresh token for a new session. Used both as the reactive post-401 handler and proactively wherever a call is about to be made with a token that's about to expire. */
async function refreshStoredSession(api: LoyaltyApiClient): Promise<StoredSession | null> {
  const stored = loadStoredSession();
  if (!stored) return null;
  try {
    const refreshed = await api.auth.refresh(stored.refreshToken);
    return { ...refreshed };
  } catch {
    return null;
  }
}

export function landingPathForRole(role: Role): string {
  switch (role) {
    case Role.CHAIRMAN:
      return '/special-rates';
    case Role.FINANCE_APPROVER:
      return '/cashback-ledgers';
    case Role.FINANCE_DISBURSER:
      return '/disbursements';
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

  // Live-update channel: reconnects whenever the access token changes
  // (login, token refresh) and tears down on sign-out. Demo mode has no
  // real backend to stream from. Skips connecting with a token that's
  // already expiring — the SSE fetch has no retry-on-401 logic of its own
  // (unlike HttpClient), so connecting with a stale token would just log a
  // guaranteed-to-fail request. The mount-validation effect below refreshes
  // proactively, which updates `session` and re-runs this effect.
  useEffect(() => {
    if (!session?.accessToken || env.dataMode === 'demo') {
      disconnectRealtime();
      return;
    }
    if (isTokenExpiringSoon(session.accessToken)) return;
    connectRealtime(session.accessToken);
  }, [session?.accessToken]);

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
      const next = await refreshStoredSession(api);
      if (!next) return null;
      setSession(next);
      saveSession(next);
      return next.accessToken;
    });
  }, [api]);

  // Validate the session on load. An already-expired access token is
  // refreshed proactively here rather than left to fail its first request
  // — that first failure would still self-correct via the retry-on-401
  // handler above, but it'd also log a guaranteed-to-fail request to the
  // console for no benefit. A real failure (refresh token also dead)
  // clears the session.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (env.dataMode === 'demo') {
        setLoading(false);
        return;
      }
      const stored = loadStoredSession();
      if (!stored) {
        setLoading(false);
        return;
      }
      if (isTokenExpiringSoon(stored.accessToken)) {
        const refreshed = await refreshStoredSession(api);
        if (!refreshed) {
          if (!cancelled) {
            setSession(null);
            saveSession(null);
            setLoading(false);
          }
          return;
        }
        // setSession's effect (which re-registers the token getter) only
        // takes effect on the next render — set it directly too so the
        // api.auth.me() call right below doesn't race it with the stale token.
        setTokenGetter(() => refreshed.accessToken);
        if (!cancelled) {
          setSession(refreshed);
          saveSession(refreshed);
        }
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
      hasPermission: (permission) =>
        session ? getPermissionsForRole(session.user.role).includes(permission) : false,
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
      email: 'a.wanjiru@greenwellsenergies.co.ke',
      fullName: 'Amina Wanjiru',
      role: Role.ADMIN,
    },
  };
}
