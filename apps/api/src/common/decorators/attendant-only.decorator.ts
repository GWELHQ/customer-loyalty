import { SetMetadata } from '@nestjs/common';

export const ATTENDANT_ONLY_KEY = 'attendantOnly';

/** Marks a route as reachable only by an attendant PIN session (Android endpoints). */
export const AttendantOnly = () => SetMetadata(ATTENDANT_ONLY_KEY, true);
