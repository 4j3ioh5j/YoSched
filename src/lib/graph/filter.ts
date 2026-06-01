/**
 * Filtering for the statistics graphing pipeline.
 *
 * Two independent stages, applied at different points in the pipeline:
 *  - `filterAssignmentsByDate` runs BEFORE `computeStatsModel`, so the metrics
 *    genuinely recompute over the chosen time subset.
 *  - `filterStaff` (and `filterByMinFte`) runs AFTER compute, as a display
 *    filter — department-relative z-scores stay computed over everyone, then a
 *    subset of providers is shown. This preserves the original page behavior,
 *    which filtered the computed rows by min-FTE.
 */
import type { GraphDateRange, GraphStaffFilter } from "./spec";

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

export type PayPeriodRef = { id: string; startDate: string; endDate: string };

/**
 * Filter date-stamped rows (assignments) to a `GraphDateRange`.
 * Dates are ISO `YYYY-MM-DD` strings, which sort lexically, so plain string
 * comparison is correct and timezone-free.
 *
 * - `custom`: inclusive [start, end]; an empty bound is unbounded on that side
 *   (so the default `{start:"", end:""}` keeps everything).
 * - `payPeriods`: keep rows whose date falls within any selected pay period's
 *   inclusive [startDate, endDate]. An empty selection (no periods, or none
 *   matched in `payPeriods`) is treated as "all" — a no-op — so the page never
 *   silently blanks out.
 */
export function filterAssignmentsByDate<T extends { date: string }>(
  rows: T[],
  range: GraphDateRange,
  payPeriods: PayPeriodRef[],
): T[] {
  if (range.kind === "custom") {
    const { start, end } = range;
    if (!start && !end) return rows;
    return rows.filter((r) => (!start || r.date >= start) && (!end || r.date <= end));
  }
  const selected = new Set(range.payPeriodIds);
  const intervals = payPeriods.filter((p) => selected.has(p.id));
  if (intervals.length === 0) return rows;
  return rows.filter((r) => intervals.some((i) => r.date >= i.startDate && r.date <= i.endDate));
}

export type StaffRow = {
  providerId: string;
  employmentTypeName: string;
  ftePercentage: number;
};

/**
 * Composable staff display filter (AND semantics):
 *  - `names`: when non-empty, keep only those provider ids.
 *  - `employmentType`: when set (non-null/non-empty), keep matching type.
 *  - `minFtePct`: when > 0, keep rows at/above the FTE threshold.
 * The `all` flag is advisory UI state and imposes no constraint here.
 */
export function filterStaff<T extends StaffRow>(rows: T[], staff: GraphStaffFilter): T[] {
  let out = rows;
  if (staff.names && staff.names.length > 0) {
    const ids = new Set(staff.names);
    out = out.filter((r) => ids.has(r.providerId));
  }
  if (staff.employmentType) {
    out = out.filter((r) => r.employmentTypeName === staff.employmentType);
  }
  if (staff.minFtePct && staff.minFtePct > 0) {
    out = filterByMinFte(out, staff.minFtePct);
  }
  return out;
}
