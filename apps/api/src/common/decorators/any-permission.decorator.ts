import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@loyalty/shared';

export const ANY_PERMISSION_KEY = 'anyPermission';

/** Requires the authenticated staff principal to hold AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(ANY_PERMISSION_KEY, permissions);
