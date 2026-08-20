import { SetMetadata } from '@nestjs/common';

export const STAFF_ONLY_KEY = 'staffOnly';

/** Marks a route as reachable only by a Microsoft-authenticated staff session (admin web). */
export const StaffOnly = () => SetMetadata(STAFF_ONLY_KEY, true);
