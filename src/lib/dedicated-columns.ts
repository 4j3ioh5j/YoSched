/**
 * Pure helper for the schedule grid's "dedicated column" feature. A shift type
 * flagged `dedicatedColumn` gets an extra column (left of the count columns)
 * listing the initials of whoever covers that shift on each day. Kept DB/React-
 * free so it is unit-testable in isolation (the grid is a large "use client"
 * component).
 */
export type CoverageProvider = { id: string; initials: string };

/** Resolve the shift code shown in a cell (real assignment, else suggestion),
 *  or undefined if the provider has nothing that day. */
export type CellCodeLookup = (providerId: string, date: string) => string | undefined;

/**
 * For a single dedicated-column shift `code`, map each date to the initials of
 * the providers covering that shift that day, preserving the given provider
 * order. Scans all supplied providers (not just visible ones) so coverage shows
 * even when a provider's own grid column is hidden. A day with no coverage maps
 * to an empty array.
 */
export function dedicatedColumnInitials(
  providers: CoverageProvider[],
  dates: string[],
  code: string,
  codeForCell: CellCodeLookup,
): Record<string, string[]> {
  const byDate: Record<string, string[]> = {};
  for (const date of dates) {
    const inits: string[] = [];
    for (const p of providers) {
      if (codeForCell(p.id, date) === code) inits.push(p.initials);
    }
    byDate[date] = inits;
  }
  return byDate;
}
