import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from '../../config/configuration';

/** Protects Cloud Scheduler-triggered endpoints with a shared secret header instead of a user session. */
@Injectable()
export class SchedulerSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const provided = request.headers['x-scheduler-secret'];
    const expected = this.config.get('schedulerSharedSecret');
    if (!expected || provided !== expected) {
      throw new UnauthorizedException('Invalid or missing scheduler secret');
    }
    return true;
  }
}
