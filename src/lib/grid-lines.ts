// Card #345: one set of grid lines for every on-screen schedule cell. Every cell (staff,
// OTHER/aggregate, dedicated, count, on day rows and pay-period rows alike) draws the same
// faint grid, and the extra columns right of the staff get a darker divider on BOTH sides.
//
// Why both sides: the table uses border-collapse, and where two equal 1px solid borders meet
// the browser keeps the LEFT cell's one. A divider drawn only as a cell's left border is lost
// to its neighbor's faint right border, so it showed on some rows and not others. Drawing it
// on the right of the last staff cell and on both sides of each extra column makes both
// cells agree, so the divider is the same on every row. Print CSS sets its own borders
// with !important, so none of this reaches the printout.
export const CELL_LINES = "border border-slate-700/30";
export const EXTRA_COL_LINES = "border-x-slate-700";
export const LAST_STAFF_LINE = "border-r-slate-700";
export const PP_ROW_LINES = "border-y-indigo-500/60";

/** Lines of a staff cell: the divider on its right when it is the last staff column and
 *  extra columns follow. */
export function staffCellLines(isLastStaff: boolean, hasExtraColumns: boolean): string {
  return isLastStaff && hasExtraColumns ? `${CELL_LINES} ${LAST_STAFF_LINE}` : CELL_LINES;
}

/** Lines of an extra (OTHER/aggregate, dedicated or count) column's cell. */
export function extraCellLines(): string {
  return `${CELL_LINES} ${EXTRA_COL_LINES}`;
}
