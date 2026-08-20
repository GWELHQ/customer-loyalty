import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ATTENDANT_ONLY_KEY } from '../decorators/attendant-only.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { STAFF_ONLY_KEY } from '../decorators/staff_only.decorator';
import { TokenService } from '../token/token.service';

/**
 * Global guard: every route requires a valid session token unless marked
 * @Public(). Resolves the token to either a StaffPrincipal or an
 * AttendantPrincipal and attaches it to req.user for downstream guards,
 * decorators (@CurrentUser), and service-layer station/self scoping.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const token = authHeader.slice('Bearer '.length);
    const principal = await this.tokens.verifyAccessToken(token);
    request.user = principal;

    const attendantOnly = this.reflector.getAllAndOverride<boolean>(ATTENDANT_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (attendantOnly && principal.kind !== 'attendant') {
      throw new UnauthorizedException('This endpoint is for attendant sessions only');
    }

    const staffOnly = this.reflector.getAllAndOverride<boolean>(STAFF_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (staffOnly && principal.kind !== 'staff') {
      throw new UnauthorizedException('This endpoint is for staff sessions only');
    }

    return true;
  }
}
