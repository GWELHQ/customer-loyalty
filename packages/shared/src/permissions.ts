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
  /** Sign off that one's own station's sales are ready for the monthly disbursement release — Station Supervisor's narrower, station-scoped counterpart to LEDGERS_MANAGE's org-wide "Release for approval". */
  LEDGERS_RELEASE_OWN_STATION = 'ledgers:release_own_station',
  DISBURSEMENTS_MANAGE = 'disbursements:manage',
  DISBURSEMENTS_VIEW = 'disbursements:view',
  REPORTS_VIEW_ALL = 'reports:view_all',
  REPORTS_VIEW_OWN_STATION = 'reports:view_own_station',
  IMPORTS_VIEW = 'imports:view',
  NOTIFICATIONS_VIEW_OWN = 'notifications:view_own',
  AUDIT_VIEW = 'audit:view',
  FRAUD_VIEW = 'fraud:view',
  FRAUD_MANAGE = 'fraud:manage',
  DISBURSEMENT_SETTINGS_MANAGE = 'disbursement_settings:manage',
  CUSTOMER_INACTIVITY_SETTINGS_MANAGE = 'customer_inactivity_settings:manage',
  SALES_APPROVE_ALL = 'sales:approve_all',
  SALES_APPROVE_OWN_STATION = 'sales:approve_own_station',
  /** Create/edit/delete dynamic role definitions (`/rbac/roles`). Granted only to Admin by default — see SYSTEM_ROLE_DEFINITIONS below. */
  RBAC_MANAGE = 'rbac:manage',
  SHIFTS_VIEW_ALL = 'shifts:view_all',
  SHIFTS_VIEW_OWN_STATION = 'shifts:view_own_station',
  SHIFTS_MANAGE = 'shifts:manage',
  /** Upload/manage Android app builds and choose which one the public /apk page serves. */
  APK_MANAGE = 'apk:manage',
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
  Permission.DISBURSEMENT_SETTINGS_MANAGE,
  Permission.CUSTOMER_INACTIVITY_SETTINGS_MANAGE,
  Permission.SALES_APPROVE_ALL,
  Permission.RBAC_MANAGE,
  Permission.SHIFTS_VIEW_ALL,
  Permission.APK_MANAGE,
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
  Permission.SHIFTS_VIEW_ALL,
];

// Everything the Chairman can see, minus the two actions the Chairman can
// take on special rates (requesting/setting and approving/rejecting) — a
// read-only executive overview role.
const EXEC_VIEWER_PERMISSIONS: Permission[] = CHAIRMAN_PERMISSIONS.filter(
  (p) => p !== Permission.SPECIAL_RATES_APPROVE && p !== Permission.SPECIAL_RATES_REQUEST,
);

// Same rights as Exec Viewer — a distinct role for staff whose function is
// auditing rather than executive oversight, but who need the same read-only
// visibility across the system.
const AUDIT_PERMISSIONS: Permission[] = EXEC_VIEWER_PERMISSIONS;

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
  // Every role lands on /dashboard after sign-in (landingPathForRole) —
  // this is what makes that route resolvable for Finance Disburser rather
  // than an immediate redirect loop against RequireStaff.
  Permission.REPORTS_VIEW_ALL,
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
  Permission.DISBURSEMENT_SETTINGS_MANAGE,
  Permission.CUSTOMER_INACTIVITY_SETTINGS_MANAGE,
  Permission.SALES_APPROVE_ALL,
  Permission.SHIFTS_VIEW_ALL,
];

const STATION_SUPERVISOR_PERMISSIONS: Permission[] = [
  Permission.CUSTOMERS_VIEW,
  Permission.CUSTOMERS_MANAGE,
  // Excel import needs both: CUSTOMERS_IMPORT gates the upload/remap/confirm
  // steps, IMPORTS_VIEW gates the preview/results fetch the wizard also
  // calls mid-flow (CustomerImportWizard.tsx) — without it step 2 onward 403s.
  Permission.CUSTOMERS_IMPORT,
  Permission.IMPORTS_VIEW,
  // Read-only — needed so the branch/home-station dropdowns in customer
  // create and import can populate at all (CustomerCreate.tsx,
  // CustomerImportWizard.tsx both default the selection to the
  // supervisor's own station, but still list every station).
  Permission.STATIONS_VIEW,
  Permission.PRICES_VIEW,
  // Scoped to their own station server-side (assertStationAccessible in
  // prices.controller.ts) — a supervisor can publish a PMS/AGO price only
  // for the station they're assigned to, never system-wide like Admin/RTSM.
  Permission.PRICES_MANAGE,
  // Scoped to their own station server-side (see resolveStationScope /
  // assertStationAccessible in attendants.controller.ts) — a supervisor
  // can list/create/edit/delete attendants only at the station they're
  // assigned to, never system-wide like Admin.
  Permission.ATTENDANTS_MANAGE,
  Permission.SALES_VIEW_OWN_STATION,
  Permission.RECONCILIATION_VIEW_OWN_STATION,
  Permission.RECONCILIATION_MANAGE,
  Permission.REPORTS_VIEW_OWN_STATION,
  Permission.NOTIFICATIONS_VIEW_OWN,
  Permission.CUSTOMER_REGISTRATIONS_VIEW,
  Permission.CUSTOMER_REGISTRATIONS_APPROVE,
  Permission.SALES_APPROVE_OWN_STATION,
  // Records daily attendant rosters for their own station — see
  // apps/api/src/shifts/. Scoped server-side by
  // resolveStationScope/assertStationAccessible, same as
  // RECONCILIATION_MANAGE and the ATTENDANTS_MANAGE grant above.
  Permission.SHIFTS_VIEW_OWN_STATION,
  Permission.SHIFTS_MANAGE,
  // Deliberately not LEDGERS_VIEW — a supervisor never sees the org-wide
  // customer cashback ledger (it isn't broken out per station), only
  // whether their own station has signed off for the month. See
  // CashbackLedgersController's my-station endpoint.
  Permission.LEDGERS_RELEASE_OWN_STATION,
];

const ATTENDANT_PERMISSIONS: Permission[] = [
  Permission.SALES_VIEW_OWN,
  Permission.SALES_CREATE_OWN,
  Permission.PRICES_VIEW,
];

/**
 * A role's live definition: its display metadata plus permission set.
 * `isSystem` roles (the 9 built into this table) can never be deleted and
 * always exist even with no Firestore `roleDefinitions` doc — see
 * `apps/api/src/rbac/rbac.service.ts`, the single place both the API's
 * `PermissionsGuard`-embedded-in-JWT permission list and the web app's
 * roles catalogue ultimately resolve from. A custom role created by an
 * Admin at runtime has the same shape with `isSystem: false`.
 */
export interface RoleDefinition {
  key: string;
  displayName: string;
  description: string;
  permissions: Permission[];
  isSystem: boolean;
}

/**
 * Static defaults for the 9 built-in roles — every one of these still
 * works identically even if `roleDefinitions` in Firestore is completely
 * empty (no migration/backfill needed to ship dynamic roles). This is
 * also the single source of a role's display name now, replacing what
 * used to be two separately hand-maintained `ROLE_LABELS` maps in
 * `apps/web/src/layout/AppShell.tsx` and `apps/web/src/pages/Users.tsx`.
 */
export const SYSTEM_ROLE_DEFINITIONS: Record<Role, RoleDefinition> = {
  [Role.ADMIN]: {
    key: Role.ADMIN,
    displayName: 'Admin',
    description: 'Full operational access, including creating roles and assigning permissions.',
    permissions: ADMIN_PERMISSIONS,
    isSystem: true,
  },
  [Role.CHAIRMAN]: {
    key: Role.CHAIRMAN,
    displayName: 'Chairman',
    description: 'Approves special cashback rates and has read-only executive visibility.',
    permissions: CHAIRMAN_PERMISSIONS,
    isSystem: true,
  },
  [Role.FINANCE_APPROVER]: {
    key: Role.FINANCE_APPROVER,
    displayName: 'Finance Approver',
    description: 'Checks and approves the monthly cashback ledger RTSM releases.',
    permissions: FINANCE_APPROVER_PERMISSIONS,
    isSystem: true,
  },
  [Role.FINANCE_DISBURSER]: {
    key: Role.FINANCE_DISBURSER,
    displayName: 'Finance Disburser',
    description: 'Executes approved disbursement batches.',
    permissions: FINANCE_DISBURSER_PERMISSIONS,
    isSystem: true,
  },
  [Role.RTSM]: {
    key: Role.RTSM,
    displayName: 'Retail Sales Manager',
    description: 'Manages customers, prices, and reconciliation; releases the monthly cashback ledger.',
    permissions: RTSM_PERMISSIONS,
    isSystem: true,
  },
  [Role.STATION_SUPERVISOR]: {
    key: Role.STATION_SUPERVISOR,
    displayName: 'Station Supervisor',
    description: 'Manages one station’s day-to-day operations, reconciliation, and sale approvals.',
    permissions: STATION_SUPERVISOR_PERMISSIONS,
    isSystem: true,
  },
  [Role.ATTENDANT]: {
    key: Role.ATTENDANT,
    displayName: 'Sales Assistant',
    description: 'Records sales at the pump via the mobile app. Not assignable to a staff (web) account.',
    permissions: ATTENDANT_PERMISSIONS,
    isSystem: true,
  },
  [Role.EXEC_VIEWER]: {
    key: Role.EXEC_VIEWER,
    displayName: 'Exec Viewer',
    description: 'Read-only view of everything the Chairman sees.',
    permissions: EXEC_VIEWER_PERMISSIONS,
    isSystem: true,
  },
  [Role.AUDIT]: {
    key: Role.AUDIT,
    displayName: 'Audit',
    description: 'Same read-only visibility as Exec Viewer, for staff whose function is auditing.',
    permissions: AUDIT_PERMISSIONS,
    isSystem: true,
  },
};

/**
 * Static-defaults-only view of every role's permissions — NOT the live
 * security boundary. The API resolves permissions dynamically per
 * request via `RbacService` (Firestore `roleDefinitions` overrides
 * merged over this table); this export exists for `permissions.test.ts`
 * and the frontend's backend-less demo-mode session.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = Object.fromEntries(
  Object.entries(SYSTEM_ROLE_DEFINITIONS).map(([key, def]) => [key, def.permissions]),
) as Record<Role, Permission[]>;

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.includes(permission) ?? false;
}

export function getPermissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}
