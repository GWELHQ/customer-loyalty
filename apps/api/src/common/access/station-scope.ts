import { ForbiddenException } from '@nestjs/common';
import { Role } from '@loyalty/shared';
import type { AuthPrincipal } from '../types/principal';

/**
 * Enforces the "exactly one station" rule for station_supervisor (and
 * attendant) principals at the query/resource level. Every
 * reconciliation/reports/sales query a supervisor makes is scoped to their
 * assigned station server-side — never trusting a station filter from the
 * client for that role.
 */
export function resolveStationScope(user: AuthPrincipal, requestedStationId?: string): string | undefined {
  if (user.kind === 'attendant') return user.assignedStationId;
  if (user.role === Role.STATION_SUPERVISOR) return user.assignedStationId;
  return requestedStationId;
}

export function assertStationAccessible(user: AuthPrincipal, stationId: string): void {
  const scoped =
    user.kind === 'attendant'
      ? user.assignedStationId
      : user.role === Role.STATION_SUPERVISOR
        ? user.assignedStationId
        : undefined;
  if (scoped && scoped !== stationId) {
    throw new ForbiddenException('You do not have access to this station');
  }
}
