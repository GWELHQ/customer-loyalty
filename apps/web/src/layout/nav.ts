import { Permission } from '@loyalty/shared';

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
  { label: 'Shifts', path: '/shifts', icon: 'clock', permission: Permission.SHIFTS_VIEW_ALL },
  { label: 'Cashback ledger', path: '/cashback-ledgers', icon: 'ledger', permission: Permission.LEDGERS_VIEW },
  { label: 'Disbursements', path: '/disbursements', icon: 'disbursements', permission: Permission.DISBURSEMENTS_VIEW },
  { label: 'Reports', path: '/reports', icon: 'reports', permission: Permission.REPORTS_VIEW_ALL },
  { label: 'Users', path: '/users', icon: 'users', permission: Permission.USERS_MANAGE },
  { label: 'Roles', path: '/roles', icon: 'key', permission: Permission.RBAC_MANAGE },
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
  { label: 'Shifts', path: '/shifts', icon: 'clock', permission: Permission.SHIFTS_VIEW_OWN_STATION },
  { label: 'Sales', path: '/sales', icon: 'sales', permission: Permission.SALES_VIEW_OWN_STATION },
  { label: 'Reports', path: '/reports', icon: 'reports', permission: Permission.REPORTS_VIEW_OWN_STATION },
];

export function navItemsForRole(role: string, hasPermission: (p: Permission) => boolean): NavItem[] {
  // Single pass over ALL_NAV_ITEMS' fixed declaration order — every role
  // sees the same relative sidebar order (Dashboard always first). A
  // station-scoped item (Dashboard/Reconciliation/Shifts/Sales/Reports for
  // Station Supervisor) is substituted in at its ALL_NAV_ITEMS position
  // when the "_all" permission is missing but the "_own_station" one
  // isn't — never appended at the end, which previously pushed those
  // items to the bottom of the sidebar for that role only.
  const scopedByPath = new Map(STATION_SCOPED_NAV_ITEMS.map((item) => [item.path, item]));
  const result: NavItem[] = [];
  for (const item of ALL_NAV_ITEMS) {
    if (item.permission && hasPermission(item.permission)) {
      result.push(item);
      continue;
    }
    const scoped = scopedByPath.get(item.path);
    if (scoped?.permission && hasPermission(scoped.permission)) {
      result.push(scoped);
    }
  }
  return result;
}
