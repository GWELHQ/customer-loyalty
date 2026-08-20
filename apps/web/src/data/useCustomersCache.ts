import type { Customer } from '@loyalty/shared';
import { useCallback, useEffect, useState } from 'react';
import type { LoyaltyApiClient } from '@loyalty/api-client';
import { useApi } from './client';
import { useRealtimeRefresh } from './realtime';

// The whole customer list is small enough (hundreds, not millions) to hold
// client-side — this trades one bulk fetch for instant, no-network search
// as you type, instead of a request per keystroke. One shared, session-lived
// cache instead of every page/search re-fetching its own copy.
let cache: Customer[] | null = null;
let inflight: Promise<Customer[]> | null = null;

const FETCH_PAGE_SIZE = 100;

async function fetchAll(api: LoyaltyApiClient): Promise<Customer[]> {
  const all: Customer[] = [];
  for (let page = 1; ; page++) {
    const res = await api.customers.list({ page, pageSize: FETCH_PAGE_SIZE });
    all.push(...res.items);
    if (res.items.length < FETCH_PAGE_SIZE || all.length >= res.total) break;
  }
  return all;
}

export function invalidateCustomersCache() {
  cache = null;
}

export function useCustomersCache(): { customers: Customer[]; loading: boolean; refresh: () => void } {
  const api = useApi();
  const [customers, setCustomers] = useState<Customer[]>(cache ?? []);
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
        setCustomers(result);
        setLoading(false);
      });
    },
    [api],
  );

  useEffect(() => {
    if (cache) {
      setCustomers(cache);
      setLoading(false);
      return;
    }
    load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Server-side changes refresh the cache in the background — no spinner,
  // no interruption to whatever the user is currently typing.
  const refresh = useCallback(() => {
    cache = null;
    load(true);
  }, [load]);
  useRealtimeRefresh(['customers'], refresh);

  return { customers, loading, refresh };
}
