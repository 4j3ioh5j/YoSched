// Presentation helper for the schedule conflict dialog ("this cell changed
// underneath you"). Pure + unit-tested so the wording stays stable.

export type ConflictLine = {
  staff: string; // staff initials/name for the cell
  date: string; // the cell date (display string)
  code: string | null; // the current shift code, or null if the cell is now empty
  by: string | null; // resolved updater name, or null when unattributed
};

/** One line describing what a cell was changed to and by whom. */
export function describeConflict({ staff, date, code, by }: ConflictLine): string {
  const what = code ? `now ${code}` : "now empty";
  const who = by ? `by ${by}` : "by someone else";
  return `${staff} · ${date} — ${what} (${who})`;
}

/** Title for the conflict dialog given how many cells conflicted. */
export function conflictTitle(count: number): string {
  return count === 1 ? "This cell changed underneath you" : `${count} cells changed underneath you`;
}
