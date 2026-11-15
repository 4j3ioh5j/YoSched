// Card #258: a Pay-period preferences row (department-wide, per-FTE shift target) and the
// FrequencyPicker that edits it. The picker's Hard/Prefer dropdown is the row's one strength
// control, so the row hands the picker its saved strength and the save takes the picker's.

export type DeptTargetRow = {
  id: string;
  shiftTypeId: string;
  minCount: number;
  maxCount: number | null;
  window: string;
  windowDays: number | null;
  windowCount: number | null;
  strength: string; // "preference" (Prefer / soft) | "rule" (Hard)
  perFte: boolean;
};

export type DeptPickerTarget = {
  shiftTypeId: string;
  minCount: number;
  maxCount?: number | null;
  window: string;
  windowDays?: number | null;
  windowCount?: number | null;
  strength?: string;
};

/** A new department row starts as Prefer, as the old Soft/Hard button did. */
export const DEPT_DEFAULT_STRENGTH = "preference";

const norm = (s: string | undefined): string | undefined =>
  s === "preference" ? "preference" : s === "rule" ? "rule" : undefined;

/** The picker's view of a saved row, its strength included. */
export function deptPickerTarget(row: DeptTargetRow): DeptPickerTarget {
  return {
    shiftTypeId: row.shiftTypeId,
    minCount: row.minCount,
    maxCount: row.maxCount,
    window: row.window,
    windowDays: row.windowDays,
    windowCount: row.windowCount,
    strength: norm(row.strength) ?? DEPT_DEFAULT_STRENGTH,
  };
}

/** The PUT body for a picker edit: the picker's strength wins, then the saved one, then Prefer. */
export function deptTargetPutBody(shiftTypeId: string, target: DeptPickerTarget, existing: DeptTargetRow | undefined) {
  return {
    shiftTypeId,
    minCount: target.minCount,
    maxCount: target.maxCount ?? null,
    window: target.window,
    windowDays: target.windowDays ?? null,
    windowCount: target.window === "days" ? 1 : target.windowCount ?? 1,
    strength: norm(target.strength) ?? norm(existing?.strength) ?? DEPT_DEFAULT_STRENGTH,
    perFte: true,
  };
}
