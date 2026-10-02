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

export interface DashboardStationTrend {
  stations: { id: string; name: string }[];
  days: { date: string; label: string; values: Record<string, number> }[];
}

export type DashboardPeriod = 'today' | 'week' | 'month' | 'year';

export interface DashboardData {
  period: DashboardPeriod;
  month: string;
  totalCashbackMonth: number;
  totalSalesAmountMonth: number;
  saleCount: number;
  uniqueCustomers: number;
  reconciliationRecordsNeedingAttention: number;
  trend: DashboardTrendDay[];
  /** Absent when talking to an API build older than the per-station trend. */
  stationTrend?: DashboardStationTrend;
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
