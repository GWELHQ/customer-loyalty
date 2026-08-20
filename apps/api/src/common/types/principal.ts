import { Role } from '@loyalty/shared';

export type PrincipalKind = 'staff' | 'attendant';

export interface StaffPrincipal {
  kind: 'staff';
  userId: string;
  email: string;
  fullName: string;
  role: Role;
  /** Present and singular only for station_supervisor. */
  assignedStationId?: string;
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
