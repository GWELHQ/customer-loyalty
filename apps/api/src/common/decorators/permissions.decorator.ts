import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@loyalty/shared';

export const PERMISSIONS_KEY = 'permissions';

/** Requires the authenticated staff principal to hold ALL listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
