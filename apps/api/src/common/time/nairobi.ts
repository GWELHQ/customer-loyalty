const NAIROBI_OFFSET_MS = 3 * 60 * 60 * 1000;

/**
 * Africa/Nairobi is a fixed UTC+3 with no DST, so all of this is safe as
 * plain arithmetic on the UTC instant — no Intl/timezone-database lookup
 * needed. Every "today"/"this month" boundary in the app must go through
 * these helpers rather than slicing `Date#toISOString()` directly: that
 * slices the UTC calendar day, which is wrong for any sale made between
 * 00:00 and 02:59 Nairobi time (still the previous UTC day).
 */

/** The Nairobi calendar date (YYYY-MM-DD) a UTC instant falls on. */
export function nairobiDateKey(input: string | Date = new Date()): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  return new Date(d.getTime() + NAIROBI_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Nairobi calendar month (YYYY-MM) a UTC instant falls in. */
export function nairobiMonthKey(input: string | Date = new Date()): string {
  return nairobiDateKey(input).slice(0, 7);
}

export function nairobiToday(): string {
  return nairobiDateKey(new Date());
}

/** UTC instant bounds [startUtc, endUtc) covering one Nairobi calendar day. */
export function nairobiDayBoundsUtc(dateKey: string): { startUtc: string; endUtc: string } {
  const startMs = new Date(`${dateKey}T00:00:00.000Z`).getTime() - NAIROBI_OFFSET_MS;
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(startMs + 24 * 60 * 60 * 1000).toISOString(),
  };
}

/** UTC instant bounds [startUtc, endUtc) covering one Nairobi calendar month. */
export function nairobiMonthBoundsUtc(monthKey: string): { startUtc: string; endUtc: string } {
  const [year, month] = monthKey.split('-').map(Number) as [number, number];
  const startMs = Date.UTC(year, month - 1, 1, 0, 0, 0) - NAIROBI_OFFSET_MS;
  const endMs = Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1, 0, 0, 0) - NAIROBI_OFFSET_MS;
  return {
    startUtc: new Date(startMs).toISOString(),
    endUtc: new Date(endMs).toISOString(),
  };
}
