/**
 * Client-side-only expiry check (no signature verification — the server is
 * always the actual authority). Lets callers refresh proactively instead of
 * firing a request that's certain to 401, which is what was showing up as
 * console noise on `/auth/me` and the realtime SSE connection after the
 * access token's 15-minute TTL lapsed while the tab was idle.
 */
export function isTokenExpiringSoon(token: string, bufferSeconds = 30): boolean {
  try {
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) return false;
    const normalized = payloadB64.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(normalized)) as { exp?: number };
    if (typeof json.exp !== 'number') return false;
    return Date.now() >= json.exp * 1000 - bufferSeconds * 1000;
  } catch {
    return false; // unparseable — let the server be the judge
  }
}
