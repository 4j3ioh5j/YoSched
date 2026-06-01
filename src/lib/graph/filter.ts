/**
 * Staff filtering for the statistics graphing pipeline.
 *
 * Slice 1 exposes the minimum-FTE filter that the current page already applies,
 * extracted as a pure function so the upcoming staff picker (by name, by
 * employment type, by FTE%) can compose on top of it without changing behavior.
 */

/**
 * Keep only rows whose FTE percentage is at or above `minFte`.
 * A `minFte` of 0 (or negative) is a no-op and returns the rows unchanged —
 * matching the current page's `minFte > 0 ? filter : data` behavior.
 */
export function filterByMinFte<T extends { ftePercentage: number }>(
  rows: T[],
  minFte: number,
): T[] {
  if (!(minFte > 0)) return rows;
  return rows.filter((d) => d.ftePercentage >= minFte);
}
