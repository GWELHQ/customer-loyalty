import { useEffect, useRef } from 'react';
import { env } from '../env';

type Listener = (entityId?: string) => void;

/**
 * Live-update channel: one SSE connection to the API, fanned out to
 * whichever pages are currently mounted and interested in a given
 * collection. Native EventSource can't send an Authorization header, so
 * this hand-rolls SSE parsing over fetch()'s streaming body instead —
 * same bearer-token auth as every other request.
 */
const listeners = new Map<string, Set<Listener>>();

let abortController: AbortController | null = null;
let activeToken: string | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelayMs = 1000;

function notify(collection: string, entityId?: string): void {
  listeners.get(collection)?.forEach((fn) => fn(entityId));
}

async function readStream(token: string): Promise<void> {
  abortController = new AbortController();
  try {
    const res = await fetch(`${env.apiBaseUrl}/events/stream`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' },
      signal: abortController.signal,
    });
    if (!res.ok || !res.body) throw new Error(`Realtime connect failed: ${res.status}`);
    reconnectDelayMs = 1000;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const raw of events) {
        const dataLine = raw.split('\n').find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        try {
          const payload = JSON.parse(dataLine.slice(5).trim()) as { collection?: string; entityId?: string };
          if (payload.collection && payload.collection !== '__ping__') notify(payload.collection, payload.entityId);
        } catch {
          // malformed chunk — skip it, the connection itself is still fine
        }
      }
    }
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') return;
  }

  if (activeToken === token) {
    reconnectTimer = setTimeout(() => readStream(token), reconnectDelayMs);
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
  }
}

/** Opens (or re-opens, if the token changed) the live-update connection. Call on login and whenever the token refreshes. */
export function connectRealtime(token: string): void {
  if (activeToken === token && abortController) return;
  disconnectRealtime();
  activeToken = token;
  reconnectDelayMs = 1000;
  void readStream(token);
}

/** Call on sign-out. */
export function disconnectRealtime(): void {
  activeToken = null;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  abortController?.abort();
  abortController = null;
}

/** Subscribe `handler` to one or more Firestore collection names; returns an unsubscribe function. */
export function subscribeToChanges(collections: string[], handler: Listener): () => void {
  for (const collection of collections) {
    if (!listeners.has(collection)) listeners.set(collection, new Set());
    listeners.get(collection)!.add(handler);
  }
  return () => {
    for (const collection of collections) listeners.get(collection)?.delete(handler);
  };
}

/** Re-runs `onChange` whenever any of `collections` changes server-side. `onChange` identity may change freely across renders. */
export function useRealtimeRefresh(collections: string[], onChange: Listener): void {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const key = collections.join(',');

  useEffect(() => {
    return subscribeToChanges(collections, (entityId) => onChangeRef.current(entityId));
    // `collections` is intentionally reduced to `key` — pass a stable array (or an inline literal) at the call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
