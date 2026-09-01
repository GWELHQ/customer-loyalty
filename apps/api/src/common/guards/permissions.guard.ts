import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { getPermissionsForRole, UserStatus, type Permission } from '@loyalty/shared';
import { ANY_PERMISSION_KEY } from '../decorators/any-permission.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthPrincipal } from '../types/principal';

/**
 * Enforces the permission list embedded in the caller's session against
 * whatever a route requires. For staff, that list is resolved dynamically
 * (Firestore `roleDefinitions` override merged over the static system-role
 * defaults — see RbacService) once, at login/token-refresh time, and signed
 * straight into the JWT alongside `role` — so this guard stays synchronous
 * and does zero I/O per request, same as before this became dynamic. A
 * token minted before a role's permissions change (or, briefly at rollout,
 * before this field existed at all) is stale for at most one access-token
 * TTL; a missing/undefined `permissions` array is treated as empty (fail
 * closed). Attendants aren't part of the dynamic-roles feature — their
 * fixed role always resolves against the static default table.
 *
 * @RequirePermissions requires ALL listed permissions; @RequireAnyPermission
 * requires just one (used where a route serves both an "all data" role and
 * a station-scoped role, e.g. reconciliation/reports).
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthPrincipal | undefined;

    const requiredAll = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<Permission[]>(ANY_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if ((!requiredAll || requiredAll.length === 0) && (!requiredAny || requiredAny.length === 0)) {
      return true;
    }
    if (!user) throw new ForbiddenException('No authenticated principal');

    // A not-yet-(or no-longer-)activated staff account still gets a
    // session (see AuthService.loginWithMicrosoft) so the web app can show
    // it a "waiting for an Admin" screen, but it may not hold ANY
    // permission-gated route regardless of what its role would otherwise
    // allow — role alone is not enough once an account is inactive.
    if (user.kind === 'staff' && user.status !== UserStatus.ACTIVE) {
      throw new ForbiddenException('Your account is not yet active. Ask an Admin to activate it.');
    }

    const granted = user.kind === 'staff' ? (user.permissions ?? []) : getPermissionsForRole(user.role);

    if (requiredAll && requiredAll.length > 0) {
      const missing = requiredAll.filter((p) => !granted.includes(p));
      if (missing.length > 0) {
        throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}`);
      }
    }

    if (requiredAny && requiredAny.length > 0) {
      const hasOne = requiredAny.some((p) => granted.includes(p));
      if (!hasOne) {
        throw new ForbiddenException(`Missing at least one of required permission(s): ${requiredAny.join(', ')}`);
      }
    }

    return true;
  }
}
