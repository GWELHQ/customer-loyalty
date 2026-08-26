import { Role } from './enums.js';

/**
 * Centralized permission keys. The API enforces these in guards; the web
 * app uses the same keys only to decide navigation/UI visibility — never
 * as the actual security boundary.
 */
export enum Permission {
  USERS_MANAGE = 'users:manage',
  ATTENDANTS_MANAGE = 'attendants:manage',
  CUSTOMERS_VIEW = 'customers:view',
  CUSTOMERS_MANAGE = 'customers:manage',
  CUSTOMERS_DELETE = 'customers:delete',
  CUSTOMERS_IMPORT = 'customers:import',
  STATIONS_MANAGE = 'stations:manage',
  STATIONS_VIEW = 'stations:view',
  PRICES_VIEW = 'prices:view',
  PRICES_MANAGE = 'prices:manage',
  SALES_VIEW_ALL = 'sales:view_all',
  SALES_VIEW_OWN_STATION = 'sales:view_own_station',
  SALES_VIEW_OWN = 'sales:view_own',
  SALES_CREATE_OWN = 'sales:create_own',
  SPECIAL_RATES_REQUEST = 'special_rates:request',
  SPECIAL_RATES_APPROVE = 'special_rates:approve',
  SPECIAL_RATES_VIEW = 'special_rates:view',
  CUSTOMER_REGISTRATIONS_VIEW = 'customer_registrations:view',
  CUSTOMER_REGISTRATIONS_APPROVE = 'customer_registrations:approve',
  RECONCILIATION_VIEW_ALL = 'reconciliation:view_all',
  RECONCILIATION_VIEW_OWN_STATION = 'reconciliation:view_own_station',
  RECONCILIATION_MANAGE = 'reconciliation:manage',
  LEDGERS_VIEW = 'ledgers:view',
  LEDGERS_MANAGE = 'ledgers:manage',
  LEDGERS_APPROVE = 'ledgers:approve',
  DISBURSEMENTS_MANAGE = 'disbursements:manage',
  DISBURSEMENTS_VIEW = 'disbursements:view',
  REPORTS_VIEW_ALL = 'reports:view_all',
  REPORTS_VIEW_OWN_STATION = 'reports:view_own_station',
  IMPORTS_VIEW = 'imports:view',
  NOTIFICATIONS_VIEW_OWN = 'notifications:view_own',
  AUDIT_VIEW = 'audit:view',
  FRAUD_VIEW = 'fraud:view',
  FRAUD_MANAGE = 'fraud:manage',
}

const ADMIN_PERMISSIONS: Permission[] = [
  Permission.USERS_MANAGE,
  Permission.ATTENDANTS_MANAGE,
  Permission.CUSTOMERS_VIEW,
  Permission.CUSTOMERS_MANAGE,
  Permission.CUSTOMERS_DELETE,
  Permission.CUSTOMERS_IMPORT,
  Permission.STATIONS_MANAGE,
  Permission.STATIONS_VIEW,
  Permission.PRICES_VIEW,
  Permission.PRICES_MANAGE,
  Permission.SALES_VIEW_ALL,
  Permission.SPECIAL_RATES_VIEW,
  Permission.RECONCILIATION_VIEW_ALL,
  Permission.RECONCILIATION_MANAGE,
  Permission.LEDGERS_VIEW,
  Permission.LEDGERS_MANAGE,
  Permission.REPORTS_VIEW_ALL,
  Permission.IMPORTS_VIEW,
  Permission.NOTIFICATIONS_VIEW_OWN,
  Permission.AUDIT_VIEW,
  Permission.CUSTOMER_REGISTRATIONS_VIEW,
  Permission.CUSTOMER_REGISTRATIONS_APPROVE,
  Permission.FRAUD_VIEW,
  Permission.FRAUD_MANAGE,
  // Admin explicitly does NOT get SPECIAL_RATES_APPROVE.
];

const CHAIRMAN_PERMISSIONS: Permission[] = [
  Permission.CUSTOMERS_VIEW,
  Permission.STATIONS_VIEW,
  Permission.PRICES_VIEW,
  Permission.SALES_VIEW_ALL,
  Permission.SPECIAL_RATES_VIEW,
  Permission.SPECIAL_RATES_APPROVE,
  // The Chairman can also set a special rate directly, with no RTSM
  // request needed — see SpecialRateRequestsService.create(), which
  // auto-approves and applies the rate immediately for a Chairman actor.
  Permission.SPECIAL_RATES_REQUEST,
  Permission.RECONCILIATION_VIEW_ALL,
  Permission.LEDGERS_VIEW,
  Permission.DISBURSEMENTS_VIEW,
  Permission.REPORTS_VIEW_ALL,
  Permission.NOTIFICATIONS_VIEW_OWN,
  Permission.AUDIT_VIEW,
  Permission.FRAUD_VIEW,
];

// Everything the Chairman can see, minus the two actions the Chairman can
// take on special rates (requesting/setting and approving/rejecting) — a
// read-only executive overview role.
const EXEC_VIEWER_PERMISSIONS: Permission[] = CHAIRMAN_PERMISSIONS.filter(
  (p) => p !== Permission.SPECIAL_RATES_APPROVE && p !== Permission.SPECIAL_RATES_REQUEST,
);

// Checks and approves the monthly ledger RTSM releases. Deliberately does
// NOT hold DISBURSEMENTS_MANAGE — approving and executing a payout are
// different people by design (segregation of duties), see
// FINANCE_DISBURSER_PERMISSIONS below.
const FINANCE_APPROVER_PERMISSIONS: Permission[] = [
  Permission.CUSTOMERS_VIEW,
  Permission.STATIONS_VIEW,
  Permission.PRICES_VIEW,
  Permission.SALES_VIEW_ALL,
  Permission.SPECIAL_RATES_VIEW,
  Permission.RECONCILIATION_VIEW_ALL,
  Permission.LEDGERS_VIEW,
  Permission.LEDGERS_APPROVE,
  Permission.DISBURSEMENTS_VIEW,
  Permission.REPORTS_VIEW_ALL,
  Permission.NOTIFICATIONS_VIEW_OWN,
  Permission.AUDIT_VIEW,
  Permission.FRAUD_VIEW,
  Permission.FRAUD_MANAGE,
];

// Executes payout on an already-approved ledger — cannot approve one
// itself (no LEDGERS_APPROVE).
const FINANCE_DISBURSER_PERMISSIONS: Permission[] = [
  Permission.LEDGERS_VIEW,
  Permission.DISBURSEMENTS_VIEW,
  Permission.DISBURSEMENTS_MANAGE,
  Permission.NOTIFICATIONS_VIEW_OWN,
  Permission.AUDIT_VIEW,
];

const RTSM_PERMISSIONS: Permission[] = [
  Permission.CUSTOMERS_VIEW,
  Permission.CUSTOMERS_MANAGE,
  Permission.CUSTOMERS_IMPORT,
  Permission.STATIONS_VIEW,
  Permission.PRICES_VIEW,
  Permission.PRICES_MANAGE,
  Permission.SALES_VIEW_ALL,
  Permission.SPECIAL_RATES_VIEW,
  Permission.SPECIAL_RATES_REQUEST,
  Permission.RECONCILIATION_VIEW_ALL,
  // Releases the monthly cashback ledger for Finance Approver review.
  Permission.LEDGERS_VIEW,
  Permission.LEDGERS_MANAGE,
  Permission.REPORTS_VIEW_ALL,
  Permission.NOTIFICATIONS_VIEW_OWN,
  Permission.CUSTOMER_REGISTRATIONS_VIEW,
  Permission.CUSTOMER_REGISTRATIONS_APPROVE,
  Permission.FRAUD_VIEW,
  Permission.FRAUD_MANAGE,
];

const STATION_SUPERVISOR_PERMISSIONS: Permission[] = [
  Permission.CUSTOMERS_VIEW,
  Permission.PRICES_VIEW,
  Permission.SALES_VIEW_OWN_STATION,
  Permission.RECONCILIATION_VIEW_OWN_STATION,
  Permission.RECONCILIATION_MANAGE,
  Permission.REPORTS_VIEW_OWN_STATION,
  Permission.NOTIFICATIONS_VIEW_OWN,
  Permission.CUSTOMER_REGISTRATIONS_VIEW,
  Permission.CUSTOMER_REGISTRATIONS_APPROVE,
];

const ATTENDANT_PERMISSIONS: Permission[] = [
  Permission.SALES_VIEW_OWN,
  Permission.SALES_CREATE_OWN,
  Permission.PRICES_VIEW,
];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  [Role.ADMIN]: ADMIN_PERMISSIONS,
  [Role.CHAIRMAN]: CHAIRMAN_PERMISSIONS,
  [Role.FINANCE_APPROVER]: FINANCE_APPROVER_PERMISSIONS,
  [Role.FINANCE_DISBURSER]: FINANCE_DISBURSER_PERMISSIONS,
  [Role.RTSM]: RTSM_PERMISSIONS,
  [Role.STATION_SUPERVISOR]: STATION_SUPERVISOR_PERMISSIONS,
  [Role.ATTENDANT]: ATTENDANT_PERMISSIONS,
  [Role.EXEC_VIEWER]: EXEC_VIEWER_PERMISSIONS,
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
