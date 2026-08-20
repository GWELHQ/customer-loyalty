import type { LoyaltyApiClient } from '@loyalty/api-client';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from './client';
import { useRealtimeRefresh } from './realtime';

/**
 * Same shared-cache-plus-silent-realtime-refresh pattern as useStations()
 * and useCustomersCache(), generalized so every bounded entity list (not
 * unbounded/ever-growing ones like sales or audit events, which stay
 * server-paginated) gets it without re-deriving the same hook by hand.
 * Fetches once per session, shared across every component that calls the
 * returned hook, and refetches silently (no loading flicker) whenever a
 * matching realtime change event arrives.
 */
export function createCachedListHook<T>(
  fetchAll: (api: LoyaltyApiClient) => Promise<T[]>,
  realtimeCollections: string[],
) {
  let cache: T[] | null = null;
  let inflight: Promise<T[]> | null = null;

  function invalidate(): void {
    cache = null;
  }

  function useCachedList(): { items: T[]; loading: boolean; refresh: () => void } {
    const api = useApi();
    const [items, setItems] = useState<T[]>(cache ?? []);
    const [loading, setLoading] = useState(!cache);

    const load = useCallback(
      (silent: boolean) => {
        if (!inflight) {
          inflight = fetchAll(api).then((result) => {
            cache = result;
            inflight = null;
            return result;
          });
        }
        if (!silent) setLoading(true);
        inflight.then((result) => {
          setItems(result);
          setLoading(false);
        });
      },
      [api],
    );

    useEffect(() => {
      if (cache) {
        setItems(cache);
        setLoading(false);
        return;
      }
      load(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const refresh = useCallback(() => {
      cache = null;
      load(true);
    }, [load]);
    useRealtimeRefresh(realtimeCollections, refresh);

    return { items, loading, refresh };
  }

  return { useCachedList, invalidate };
}
