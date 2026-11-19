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
// Card #346: solid, not 30% alpha, so a row's weekend or holiday tint cannot show through.
export const CELL_LINES = "border border-[color-mix(in_srgb,var(--color-slate-700)_30%,var(--background))]";
// Card #356: the date and day cells get the same faint line at their top and bottom (not at
// their sides: the two read as one block). Without it their box started half a line away from
// the other cells', so their shading and today's lines sat off from the rest of the row.
export const DATE_CELL_LINES = "border-y border-y-[color-mix(in_srgb,var(--color-slate-700)_30%,var(--background))]";
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
