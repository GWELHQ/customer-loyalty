export const NAIROBI_TZ = 'Africa/Nairobi';

/** Today's Nairobi calendar date (YYYY-MM-DD) — never the browser's local/UTC date. */
export function nairobiToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: NAIROBI_TZ });
}

/** This month, as a Nairobi calendar month (YYYY-MM). */
export function nairobiThisMonth(): string {
  return nairobiToday().slice(0, 7);
}

/** The calendar month before the current Nairobi month, as YYYY-MM. */
export function nairobiLastMonth(): string {
  const [year, month] = nairobiThisMonth().split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

/** Formats an ISO instant as a Nairobi date+time, regardless of the viewer's own timezone. */
export function formatNairobiDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-KE', { timeZone: NAIROBI_TZ });
}

/** Formats an ISO instant as a Nairobi date, regardless of the viewer's own timezone. */
export function formatNairobiDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-KE', { timeZone: NAIROBI_TZ });
}

/** The same Nairobi calendar day one month ago (YYYY-MM-DD), clamped to the month's last day (e.g. 31 Mar → 28/29 Feb). */
export function nairobiOneMonthAgo(): string {
  const [year, month, day] = nairobiToday().split('-').map(Number) as [number, number, number];
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const lastDay = new Date(Date.UTC(prevYear, prevMonth, 0)).getUTCDate();
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
}

/** Start/end instants (UTC ISO) of a Nairobi calendar-day range, both days inclusive. */
export function nairobiDayRangeToIso(fromDate: string, toDate: string): { from?: string; to?: string } {
  return {
    from: fromDate ? new Date(`${fromDate}T00:00:00+03:00`).toISOString() : undefined,
    to: toDate ? new Date(`${toDate}T23:59:59.999+03:00`).toISOString() : undefined,
  };
}
