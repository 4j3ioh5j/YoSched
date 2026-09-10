// Pay-period calendar math. All arithmetic is done in whole days on UTC epoch-day
// numbers — never through local-time Date mutation — because the server's timezone
// observes DST: local setDate() across a spring-forward transition lands the stored
// midnight at 23:00Z the previous day, which produced real 13- and 15-day periods
// (Mar 8 and Oct 31, 2026) and shifted every date between the transitions.
//
// The model: a single ANCHOR date (any real period start) plus a fixed LENGTH in
// days defines an infinite ladder of contiguous periods extending both directions.
// Periods are never entered by count; coverage is derived from the ladder on demand.
//
// Numbering restarts each year: the first period that starts on/after Jan 1 is that
// year's PP 1 (it is always the first period falling fully within the year, since
// its predecessor started in December). The period straddling New Year's belongs to
// the year it STARTS in, as that year's last PP.

const MS_PER_DAY = 86_400_000;

/** Inclusive-bounds period in "YYYY-MM-DD" strings, matching stored PayPeriod rows. */
export type PayPeriodRange = { startDate: string; endDate: string };

export const MIN_PERIOD_LENGTH_DAYS = 7;
export const MAX_PERIOD_LENGTH_DAYS = 56;

export function isValidPeriodLength(len: unknown): len is number {
  return typeof len === "number" && Number.isInteger(len) && len >= MIN_PERIOD_LENGTH_DAYS && len <= MAX_PERIOD_LENGTH_DAYS;
}

export function isValidDateString(s: unknown): s is string {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function toEpochDay(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

export function fromEpochDay(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Floor division that is correct for negative numerators (dates before the anchor). */
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** The ladder period containing `date`. Works for dates before the anchor. */
export function periodContaining(anchor: string, lengthDays: number, date: string): PayPeriodRange {
  const a = toEpochDay(anchor);
  const d = toEpochDay(date);
  const k = floorDiv(d - a, lengthDays);
  const start = a + k * lengthDays;
  return { startDate: fromEpochDay(start), endDate: fromEpochDay(start + lengthDays - 1) };
}

/** All ladder periods overlapping the inclusive window [from, to]. */
export function periodsCovering(anchor: string, lengthDays: number, from: string, to: string): PayPeriodRange[] {
  const a = toEpochDay(anchor);
  const kFrom = floorDiv(toEpochDay(from) - a, lengthDays);
  const kTo = floorDiv(toEpochDay(to) - a, lengthDays);
  const periods: PayPeriodRange[] = [];
  for (let k = kFrom; k <= kTo; k++) {
    const start = a + k * lengthDays;
    periods.push({ startDate: fromEpochDay(start), endDate: fromEpochDay(start + lengthDays - 1) });
  }
  return periods;
}

/**
 * Year-scoped label for a ladder period, from its own start date alone. A period
 * belongs to the year it starts in; its number is its 1-based position among the
 * ladder's periods starting that year. Because consecutive starts are exactly
 * `lengthDays` apart, that position is floor(daysSinceJan1 / lengthDays) + 1 —
 * no anchor or period list needed, so client components can label rows directly.
 */
export function payPeriodLabel(startDate: string, lengthDays: number): { year: number; number: number } {
  const year = Number(startDate.slice(0, 4));
  const offset = toEpochDay(startDate) - toEpochDay(`${year}-01-01`);
  return { year, number: floorDiv(offset, lengthDays) + 1 };
}

/** Length of a stored period row, for deriving the ladder step from data. */
export function periodLengthOf(p: PayPeriodRange): number {
  return toEpochDay(p.endDate) - toEpochDay(p.startDate) + 1;
}
