export const NAIROBI_TZ = 'Africa/Nairobi';

/** Today's Nairobi calendar date (YYYY-MM-DD) — never the browser's local/UTC date. */
export function nairobiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: NAIROBI_TZ });
}

/** This month, as a Nairobi calendar month (YYYY-MM). */
export function nairobiThisMonth(): string {
  return nairobiToday().slice(0, 7);
}

/** Formats an ISO instant as a Nairobi date+time, regardless of the viewer's own timezone. */
export function formatNairobiDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', { timeZone: NAIROBI_TZ });
}

/** Formats an ISO instant as a Nairobi date, regardless of the viewer's own timezone. */
export function formatNairobiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-KE', { timeZone: NAIROBI_TZ });
}
