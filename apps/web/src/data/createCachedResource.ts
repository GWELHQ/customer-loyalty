import type { LoyaltyApiClient } from '@loyalty/api-client';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from './client';
import { useRealtimeRefresh } from './realtime';

/**
 * Same shared-cache-plus-silent-realtime-refresh idea as createCachedList,
 * but for a single fetched value (a dashboard snapshot, a settings object)
 * instead of a list — revisiting the page renders the cached value
 * instantly instead of blanking it behind a loading spinner, then quietly
 * refetches whenever a matching realtime change event arrives.
 */
export function createCachedResourceHook<T>(
  fetchOne: (api: LoyaltyApiClient) => Promise<T>,
  realtimeCollections: string[],
) {
  let cache: T | null = null;
  let inflight: Promise<T> | null = null;

  function invalidate(): void {
    cache = null;
  }

  function useCachedResource(): { data: T | null; loading: boolean; refresh: () => void } {
    const api = useApi();
    const [data, setData] = useState<T | null>(cache);
    const [loading, setLoading] = useState(!cache);

    const load = useCallback(
      (silent: boolean) => {
        if (!inflight) {
          inflight = fetchOne(api).then((result) => {
            cache = result;
            inflight = null;
            return result;
          });
        }
        if (!silent) setLoading(true);
        inflight.then((result) => {
          setData(result);
          setLoading(false);
        });
      },
      [api],
    );

    useEffect(() => {
      if (cache) {
        setData(cache);
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

    return { data, loading, refresh };
  }

  return { useCachedResource, invalidate };
}
