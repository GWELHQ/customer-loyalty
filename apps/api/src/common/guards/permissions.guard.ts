import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { roleHasPermission, UserStatus, type Permission } from '@loyalty/shared';
import { ANY_PERMISSION_KEY } from '../decorators/any-permission.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthPrincipal } from '../types/principal';

/**
 * Enforces the centralized RBAC matrix from @loyalty/shared against the
 * authenticated principal's role. This is the actual security boundary —
 * the React app's nav-visibility mirrors the same matrix, but only for UX.
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

    if (requiredAll && requiredAll.length > 0) {
      const missing = requiredAll.filter((p) => !roleHasPermission(user.role, p));
      if (missing.length > 0) {
        throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}`);
      }
    }

    if (requiredAny && requiredAny.length > 0) {
      const hasOne = requiredAny.some((p) => roleHasPermission(user.role, p));
      if (!hasOne) {
        throw new ForbiddenException(`Missing at least one of required permission(s): ${requiredAny.join(', ')}`);
      }
    }

    return true;
  }
}
