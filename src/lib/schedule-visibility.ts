/**
 * Pure helpers deciding which providers get a column in the schedule grid for
 * the displayed month. Kept DB/React-free so they are unit-testable in isolation
 * (the grid is a large "use client" component).
 */
export type VisProvider = { id: string; isActive: boolean };
export type VisAssignment = { providerId: string; date: string; shiftTypeId: string };

/** A month is "past" if it ends before the first of the current calendar month
 *  (month-granularity cutover). */
export function isPastMonth(viewYear: number, viewMonth: number, now: Date): boolean {
  const curY = now.getFullYear();
  const curM = now.getMonth();
  return viewYear < curY || (viewYear === curY && viewMonth < curM);
}

/**
 * Which providers get a column for the displayed month.
 *  - current/future month: the active roster (today's behavior — active providers
 *    show even with no assignments, so there are columns to schedule into). The
 *    `showAll` override does NOT apply here — it must never leak inactive
 *    providers into a current/future view.
 *  - past month, showAll: the full set (the "Show all staff" override).
 *  - past month, default: only providers with >=1 REAL (non-off-shift) assignment
 *    in the month proper [firstOfMonth, lastOfMonth]. Off-shift "X" placeholders
 *    never make a provider visible; leave shifts (on the roster) do.
 */
export function visibleProvidersForMonth<P extends VisProvider>(
  providers: P[],
  assignments: VisAssignment[],
  firstOfMonth: string,
  lastOfMonth: string,
  past: boolean,
  showAll: boolean,
  offShiftTypeIds: Set<string>,
): P[] {
  // Current/future: always the active roster — showAll only applies to past months.
  if (!past) return providers.filter((p) => p.isActive);
  if (showAll) return providers;
  const scheduled = new Set<string>();
  for (const a of assignments) {
    if (a.date >= firstOfMonth && a.date <= lastOfMonth && !offShiftTypeIds.has(a.shiftTypeId)) {
      scheduled.add(a.providerId);
    }
  }
  return providers.filter((p) => scheduled.has(p.id));
}
