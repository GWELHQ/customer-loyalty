import { Role, UserStatus } from '@loyalty/shared';

export type PrincipalKind = 'staff' | 'attendant';

export interface StaffPrincipal {
  kind: 'staff';
  userId: string;
  email: string;
  fullName: string;
  role: Role;
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
