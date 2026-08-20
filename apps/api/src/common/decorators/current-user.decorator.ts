import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthPrincipal } from '../types/principal';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const request = ctx.switchToHttp().getRequest();
    return request.user as AuthPrincipal;
  },
);
