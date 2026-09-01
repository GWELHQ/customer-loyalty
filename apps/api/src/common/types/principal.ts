import { Permission, Role, UserStatus } from '@loyalty/shared';

export type PrincipalKind = 'staff' | 'attendant';

export interface StaffPrincipal {
  kind: 'staff';
  userId: string;
  email: string;
  fullName: string;
  /** A Role enum value, or a custom role key created via /rbac/roles. */
  role: string;
  /**
   * Resolved once at session-mint time (login/token refresh) from the
   * role's current definition (RbacService.getPermissionsForRole) and
   * signed straight into the JWT alongside the rest of this principal —
   * PermissionsGuard reads this directly rather than re-resolving from
   * Firestore on every request. Stale for at most one access-token TTL
   * after a role's permissions change, same envelope `role` itself
   * already has today.
   */
  permissions: Permission[];
  /** Present and singular only for station_supervisor. */
  assignedStationId?: string;
  /**
   * Not yet (or no longer) activated by an Admin. Such a principal can
   * still hold a valid session — see AuthService.loginWithMicrosoft — but
   * PermissionsGuard rejects it on every permission-gated route regardless
   * of what its role would otherwise allow, so it can only reach the
   * handful of routes with no permission requirement (e.g. GET /auth/me,
   * the realtime event stream) while it waits to be activated.
   */
  status: UserStatus;
}

export interface AttendantPrincipal {
  kind: 'attendant';
  attendantId: string;
  employeeId: string;
  fullName: string;
  role: Role.ATTENDANT;
  assignedStationId: string;
}

export type AuthPrincipal = StaffPrincipal | AttendantPrincipal;
