import type { Station } from '@loyalty/shared';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from './client';

// Stations rarely change, but ~7 different pages each fetched their own
// copy on every visit. One shared, session-lived cache instead of a
// Firestore round-trip every time a page mounts.
let cache: Station[] | null = null;
let inflight: Promise<Station[]> | null = null;

export function invalidateStationsCache() {
  cache = null;
}

export function useStations(): { stations: Station[]; loading: boolean; refresh: () => void } {
  const api = useApi();
  const [stations, setStations] = useState<Station[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  const load = useCallback(() => {
    if (!inflight) {
      inflight = api.stations.list().then((result) => {
        cache = result;
        inflight = null;
        return result;
      });
    }
    setLoading(true);
    inflight.then((result) => {
      setStations(result);
      setLoading(false);
    });
  }, [api]);

  useEffect(() => {
    if (cache) {
      setStations(cache);
      setLoading(false);
      return;
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = useCallback(() => {
    cache = null;
    load();
  }, [load]);

  return { stations, loading, refresh };
}
