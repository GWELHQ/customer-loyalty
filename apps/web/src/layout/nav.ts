import { Permission, type Role } from '@loyalty/shared';

export interface NavItem {
  label: string;
  path: string;
  icon: string;
  permission?: Permission;
}

const ALL_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: 'dashboard', permission: Permission.REPORTS_VIEW_ALL },
  { label: 'Customers', path: '/customers', icon: 'customers', permission: Permission.CUSTOMERS_VIEW },
  { label: 'Sales', path: '/sales', icon: 'sales', permission: Permission.SALES_VIEW_ALL },
  { label: 'Prices', path: '/prices', icon: 'fuel', permission: Permission.PRICES_VIEW },
  { label: 'Special rates', path: '/special-rates', icon: 'star', permission: Permission.SPECIAL_RATES_VIEW },
  { label: 'Customer registrations', path: '/customer-registrations', icon: 'checkCircle', permission: Permission.CUSTOMER_REGISTRATIONS_VIEW },
  { label: 'Reconciliation', path: '/reconciliation', icon: 'reconciliation', permission: Permission.RECONCILIATION_VIEW_ALL },
  { label: 'Cashback ledger', path: '/cashback-ledgers', icon: 'ledger', permission: Permission.LEDGERS_VIEW },
  { label: 'Disbursements', path: '/disbursements', icon: 'disbursements', permission: Permission.DISBURSEMENTS_VIEW },
  { label: 'Reports', path: '/reports', icon: 'reports', permission: Permission.REPORTS_VIEW_ALL },
  { label: 'Notifications', path: '/notifications', icon: 'bell' },
  { label: 'Users', path: '/users', icon: 'users', permission: Permission.USERS_MANAGE },
  { label: 'Attendants', path: '/attendants', icon: 'customers', permission: Permission.ATTENDANTS_MANAGE },
  { label: 'Stations', path: '/stations', icon: 'stations', permission: Permission.STATIONS_VIEW },
  { label: 'Logs', path: '/logs', icon: 'audit', permission: Permission.AUDIT_VIEW },
  { label: 'Fraud & Governance', path: '/fraud', icon: 'shield', permission: Permission.FRAUD_VIEW },
];

// Station Supervisor gets its own station-scoped variants of a few items —
// the underlying permission (view_own_station) differs from the "all" one
// above, so it needs its own entries rather than reusing ALL_NAV_ITEMS.
const STATION_SCOPED_NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: 'dashboard', permission: Permission.REPORTS_VIEW_OWN_STATION },
  { label: 'Reconciliation', path: '/reconciliation', icon: 'reconciliation', permission: Permission.RECONCILIATION_VIEW_OWN_STATION },
  { label: 'Sales', path: '/sales', icon: 'sales', permission: Permission.SALES_VIEW_OWN_STATION },
  { label: 'Reports', path: '/reports', icon: 'reports', permission: Permission.REPORTS_VIEW_OWN_STATION },
];

export function navItemsForRole(role: Role, hasPermission: (p: Permission) => boolean): NavItem[] {
  const merged = [...ALL_NAV_ITEMS, ...STATION_SCOPED_NAV_ITEMS];
  const seenPaths = new Set<string>();
  const result: NavItem[] = [];
  for (const item of merged) {
    if (seenPaths.has(item.path)) continue;
    if (item.permission && !hasPermission(item.permission)) continue;
    seenPaths.add(item.path);
    result.push(item);
  }
  return result;
}
