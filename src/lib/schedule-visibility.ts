/**
 * Pure helpers deciding which staff get a column in the schedule grid for
 * the displayed month. Kept DB/React-free so they are unit-testable in isolation
 * (the grid is a large "use client" component).
 */
export type VisStaff = { id: string; isActive: boolean };
export type VisAssignment = { staffId: string; date: string; shiftTypeId: string };

/** A month is "past" if it ends before the first of the current calendar month
 *  (month-granularity cutover). */
export function isPastMonth(viewYear: number, viewMonth: number, now: Date): boolean {
  const curY = now.getFullYear();
  const curM = now.getMonth();
  return viewYear < curY || (viewYear === curY && viewMonth < curM);
}

/**
 * Which staff get a column for the displayed month.
 *  - current/future month: the active roster (today's behavior — active staff
 *    show even with no assignments, so there are columns to schedule into). The
 *    `showAll` override does NOT apply here — it must never leak inactive
 *    staff into a current/future view.
 *  - past month, showAll: the active roster PLUS any staff (active or not) with
 *    a REAL assignment that month. The override reveals active staff who had no
 *    shifts that month — it must NOT resurrect inactive/departed staff who never
 *    worked the viewed month.
 *  - past month, default: only staff with >=1 REAL (non-off-shift) assignment
 *    in the month proper [firstOfMonth, lastOfMonth]. Off-shift "X" placeholders
 *    never make a staff visible; leave shifts (on the roster) do.
 */
export function visibleStaffForMonth<P extends VisStaff>(
  staff: P[],
  assignments: VisAssignment[],
  firstOfMonth: string,
  lastOfMonth: string,
  past: boolean,
  showAll: boolean,
  offShiftTypeIds: Set<string>,
): P[] {
  // Current/future: always the active roster — showAll only applies to past months.
  if (!past) return staff.filter((p) => p.isActive);
  const scheduled = new Set<string>();
  for (const a of assignments) {
    if (a.date >= firstOfMonth && a.date <= lastOfMonth && !offShiftTypeIds.has(a.shiftTypeId)) {
      scheduled.add(a.staffId);
    }
  }
  // showAll reveals active staff who had no shifts that month, but never inactive
  // staff who didn't actually work it — they only appear via a real assignment.
  if (showAll) return staff.filter((p) => p.isActive || scheduled.has(p.id));
  return staff.filter((p) => scheduled.has(p.id));
}
