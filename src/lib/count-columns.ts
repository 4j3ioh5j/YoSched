// Count columns are linked to the shifts' ids (count_columns.shiftTypeIds, ordered); the
// shift CODES shown as chips are derived here, at read time, from the shift_types rows loaded
// in the same request — so a rename can never leave a column counting a dead code, and the
// grid counts assignments by their shiftTypeId directly.
// Pure (no DB/React): used by the server loaders, the API routes, the Settings section and the grid.

import { saveErrorMessage } from "@/lib/stale-client";

export type CountColumnRow = { label: string; shiftTypeIds: string[] };

/** DB rows → rows with the shifts' CURRENT codes, in the stored order. An id that matches
 *  no shift is dropped from the derived list (never invented). */
export function deriveCountColumnCodes<R extends CountColumnRow>(
  rows: readonly R[],
  shiftTypes: readonly { id: string; code: string }[],
): (R & { shiftCodes: string[] })[] {
  const codeById = new Map(shiftTypes.map((s) => [s.id, s.code] as const));
  return rows.map((r) => ({
    ...r,
    shiftCodes: r.shiftTypeIds.map((id) => codeById.get(id)).filter((c): c is string => typeof c === "string"),
  }));
}

/** Where the Settings section saves. The pre-slice server has no such route (404), so a
 *  save from a new tab against a rolled-back server fails closed. */
export const COUNT_COLUMNS_SAVE_URL = "/api/settings/count-columns/by-shift-id";

export type CountColumnIn = { label: string; shiftTypeIds: string[]; sortOrder: number };

/** The save payload: ids only. The shift codes are display state (from the shared shift
 *  list) and must never travel in a write — a server could resolve a renamed-and-reused
 *  code to the wrong shift. */
export function buildCountColumnsSave(columns: readonly CountColumnRow[]): { columns: CountColumnIn[] } {
  return {
    columns: columns.map((c, i) => ({ label: c.label, shiftTypeIds: [...c.shiftTypeIds], sortOrder: i })),
  };
}

/** The message for a failed save (shared rule: 404/405 → reload; else the server's `error`). */
export const countColumnsSaveErrorMessage = saveErrorMessage;

/** Per column, per date: how many staff are on one of the column's shifts that day.
 *  `shiftTypeIdAt` answers the shift id of a staff's cell (undefined = none). Keyed by id,
 *  so two shifts whose codes are each other's ids, or a renamed shift, count correctly. */
export function countColumnTotals(
  columns: readonly CountColumnRow[],
  dates: readonly string[],
  staffIds: readonly string[],
  shiftTypeIdAt: (staffId: string, date: string) => string | undefined,
): Record<string, number>[] {
  return columns.map((col) => {
    const idSet = new Set(col.shiftTypeIds);
    const counts: Record<string, number> = {};
    for (const date of dates) {
      let count = 0;
      for (const staffId of staffIds) {
        const id = shiftTypeIdAt(staffId, date);
        if (id && idSet.has(id)) count++;
      }
      counts[date] = count;
    }
    return counts;
  });
}
