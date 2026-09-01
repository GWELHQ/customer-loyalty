import type { RoleDefinition } from '@loyalty/shared';
import { useCallback, useEffect, useState } from 'react';
import { useApi } from './client';
import { useRealtimeRefresh } from './realtime';

// Same shared, session-lived cache pattern as useStations.ts — roles
// rarely change, but many pages (AppShell, Users, RolesAdmin) each need
// the live catalogue for display names and the assignable-role picker.
let cache: RoleDefinition[] | null = null;
let inflight: Promise<RoleDefinition[]> | null = null;

export function invalidateRolesCache() {
  cache = null;
}

export function useRoles(): { roles: RoleDefinition[]; loading: boolean; refresh: () => void } {
  const api = useApi();
  const [roles, setRoles] = useState<RoleDefinition[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);

  const load = useCallback(() => {
    if (!inflight) {
      inflight = api.rbac.listRoles().then((result) => {
        cache = result;
        inflight = null;
        return result;
      });
    }
    setLoading(true);
    inflight.then((result) => {
      setRoles(result);
      setLoading(false);
    });
  }, [api]);

  useEffect(() => {
    if (cache) {
      setRoles(cache);
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

  useRealtimeRefresh(['roleDefinitions'], refresh);

  return { roles, loading, refresh };
}
