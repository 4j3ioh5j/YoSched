// Pure helper for the printed schedule's collapsed "OTHER" column: per date, the
// initials of the collapsed (e.g. fee-basis) staff who are scheduled that day, in the
// given staff order. Kept React/DB-free so it's unit-testable; the grid memoizes it and
// joins each day's list with ", ". Whether a staff is "scheduled" (working/leave, not an
// off-shift) is decided by the caller via the isScheduled predicate.

export type OtherStaff = { id: string; initials: string };

export function otherColumnInitials(
  staff: readonly OtherStaff[],
  dates: readonly string[],
  isScheduled: (staffId: string, date: string) => boolean,
): Record<string, string[]> {
  const byDate: Record<string, string[]> = {};
  for (const date of dates) {
    const inits: string[] = [];
    for (const p of staff) {
      if (isScheduled(p.id, date)) inits.push(p.initials);
    }
    byDate[date] = inits;
  }
  return byDate;
}
