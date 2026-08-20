import { LoyaltyApiClient } from '@loyalty/api-client';
import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { env } from '../env';
import { demoFetch } from './demoFetch';

const DataClientContext = createContext<LoyaltyApiClient | null>(null);

let tokenGetter: () => string | null = () => null;
let unauthorizedHandler: () => void = () => {};
let refreshHandler: () => Promise<string | null> = async () => null;

export function setTokenGetter(fn: () => string | null) {
  tokenGetter = fn;
}
export function setUnauthorizedHandler(fn: () => void) {
  unauthorizedHandler = fn;
}
export function setRefreshHandler(fn: () => Promise<string | null>) {
  refreshHandler = fn;
}

export function DataClientProvider({ children }: PropsWithChildren) {
  const client = useMemo(
    () =>
      new LoyaltyApiClient({
        baseUrl: env.apiBaseUrl,
        getAccessToken: () => tokenGetter(),
        onUnauthorized: () => unauthorizedHandler(),
        refreshAccessToken: () => refreshHandler(),
        fetchImpl: env.dataMode === 'demo' ? (demoFetch as typeof fetch) : undefined,
      }),
    [],
  );
  return <DataClientContext.Provider value={client}>{children}</DataClientContext.Provider>;
}

export function useApi(): LoyaltyApiClient {
  const ctx = useContext(DataClientContext);
  if (!ctx) throw new Error('useApi() called outside <DataClientProvider>');
  return ctx;
}
