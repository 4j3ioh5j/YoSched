// How the auto-scheduler splits a scheduled shift's slots (CALL, ORC, ORL, PAIN…)
// across the eligible pool within one run.
//
//   "fte"  — proportional to FTE: a 0.5 FTE carries half as many as a 1.0 FTE
//            (the per-run count is divided by FTE before comparing).
//   "head" — equal per person regardless of FTE (legacy behavior).
//
// A department setting, not a hardcode: equity reporting is FTE-normalized, so
// "fte" keeps distribution and reporting on the same footing, but a department
// that pays long shifts per head can opt out.
export type ShiftShareBasis = "fte" | "head";

export const SHIFT_SHARE_BASES: readonly ShiftShareBasis[] = ["fte", "head"];
export const DEFAULT_SHIFT_SHARE_BASIS: ShiftShareBasis = "fte";

/** STRICT membership check — use to VALIDATE a user write (reject anything else 400). */
export function isShiftShareBasis(v: unknown): v is ShiftShareBasis {
  return typeof v === "string" && (SHIFT_SHARE_BASES as readonly string[]).includes(v);
}

/** LENIENT parse for PERSISTED reads — unknown/legacy falls back to the default. */
export function parseShiftShareBasis(v: unknown): ShiftShareBasis {
  return isShiftShareBasis(v) ? v : DEFAULT_SHIFT_SHARE_BASIS;
}
