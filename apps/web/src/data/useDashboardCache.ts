import { createCachedResourceHook } from './createCachedResource';

export interface DashboardTrendDay {
  date: string;
  label: string;
  pms: number;
  ago: number;
}

export interface DashboardStationTotal {
  stationId: string;
  name: string;
  value: number;
}

export interface DashboardData {
  month: string;
  totalCashbackMonth: number;
  totalSalesAmountMonth: number;
  saleCount: number;
  uniqueCustomers: number;
  pendingSpecialRateRequests: number | null;
  reconciliationRecordsNeedingAttention: number;
  trend: DashboardTrendDay[];
  stationTotals: DashboardStationTotal[] | null;
}

// Shared by Dashboard and Reports — both hit the same unfiltered,
// whole-org summary endpoint, so one cached snapshot serves both instead
// of each page fetching it separately. Revisiting either page renders the
// last snapshot instantly, then silently refetches on a relevant realtime
// change (see createCachedResourceHook).
export const { useCachedResource: useDashboardSnapshot } = createCachedResourceHook<DashboardData>(
  (api) => api.reports.dashboard() as Promise<DashboardData>,
  ['sales', 'customers', 'specialRateRequests', 'reconciliationDaily'],
);
