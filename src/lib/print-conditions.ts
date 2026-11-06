// Printed-schedule column rules and aggregate columns name shifts by id inside their
// `conditions` (shiftTypeIds / exceptIds). The shift CODES the admin sees are derived here,
// at read time, from the shift_types rows loaded in the same request — so a rename can never
// leave a rule pointing at a dead code. Pure (no DB/React): used by the server loaders, the
// API routes, the Settings sections and the shift-types DELETE guard.

import { coerceConditions, hasSelector, type ShiftCondition } from "@/lib/print-column-visibility";
import { STALE_CLIENT, saveErrorMessage } from "@/lib/stale-client";

export type { ShiftCondition };

/** Conditions → conditions with the shifts' CURRENT codes beside the ids (`codes` /
 *  `except`, in the stored order; an unknown id is dropped, never invented). */
export function deriveConditionCodes(
  conditions: readonly ShiftCondition[],
  shiftTypes: readonly { id: string; code: string }[],
): (ShiftCondition & { codes: string[]; except: string[] })[] {
  const codeById = new Map(shiftTypes.map((s) => [s.id, s.code] as const));
  const codesOf = (ids: readonly string[]) => ids.map((id) => codeById.get(id)).filter((c): c is string => typeof c === "string");
  return conditions.map((c) => ({ ...c, codes: codesOf(c.shiftTypeIds), except: codesOf(c.exceptIds) }));
}

/** Does a condition list name this shift (as a selected or an excepted shift)? */
export function conditionsReference(conditions: readonly ShiftCondition[], shiftTypeId: string): boolean {
  return conditions.some((c) => c.shiftTypeIds.includes(shiftTypeId) || c.exceptIds.includes(shiftTypeId));
}

/** Where the Settings sections save. The pre-slice server has no such routes (404), so a
 *  save from a new tab against a rolled-back server fails closed. */
export const PRINT_COLUMN_RULES_SAVE_URL = "/api/settings/print-column-rules/by-shift-id";
export const PRINT_AGGREGATE_COLUMNS_SAVE_URL = "/api/settings/print-aggregate-columns/by-shift-id";

/** The conditions of a save payload: ids only, no `codes` / `except` key, and no condition
 *  without a selector (it would impose no constraint). The shift codes are display state
 *  (from the shared shift list) and must never travel in a write — a server could resolve a
 *  renamed-and-reused code to the wrong shift. */
export function buildConditionsSave(conditions: readonly ShiftCondition[]): ShiftCondition[] {
  return conditions
    .filter(hasSelector)
    .map((c) => ({ quantifier: c.quantifier, categories: [...c.categories], shiftTypeIds: [...c.shiftTypeIds], exceptIds: [...c.exceptIds] }));
}

/** The message for a failed save (shared rule: 404/405 → reload; else the server's `error`). */
export const printSaveErrorMessage = saveErrorMessage;

export type ConditionsParse =
  | { ok: true; conditions: ShiftCondition[] }
  | { ok: false; status: 400 | 409; body: { error: string; reason: string; shiftTypeId?: string } };

/** Server-side validation of the conditions in a NEW-client payload (both by-shift-id routes).
 *  A `codes` / `except` key marks a pre-slice tab → 400; a current CODE where an id belongs →
 *  409 stale-client; an unknown id → 400; a shift listed twice in one list → 400. Shape is
 *  coerced as the readers do (bad quantifier → has_any, unknown categories dropped); conditions
 *  without a selector are dropped. */
export function parseConditionsIn(
  value: unknown,
  shifts: { ids: ReadonlySet<string>; codes: ReadonlySet<string> },
  where: string,
): ConditionsParse {
  const bad = (error: string, reason: string, extra: { shiftTypeId?: string } = {}): ConditionsParse =>
    ({ ok: false, status: 400, body: { error, reason, ...extra } });
  if (value == null) return { ok: true, conditions: [] };
  if (!Array.isArray(value)) return bad(`${where}: conditions must be an array`, "bad-request");
  for (const [i, item] of value.entries()) {
    if (!item || typeof item !== "object") return bad(`${where}: condition ${i} is not an object`, "bad-request");
    const o = item as Record<string, unknown>;
    if ("codes" in o || "except" in o) return bad(`${where}: condition ${i}: shift codes are not accepted here; send shiftTypeIds / exceptIds`, "bad-request");
    for (const key of ["shiftTypeIds", "exceptIds"] as const) {
      if (o[key] == null) continue;
      if (!Array.isArray(o[key])) return bad(`${where}: condition ${i}: ${key} must be an array`, "bad-request");
      const seen = new Set<string>();
      for (const id of o[key] as unknown[]) {
        if (typeof id !== "string" || !id) return bad(`${where}: condition ${i}: ${key} must be strings`, "bad-request");
        if (!shifts.ids.has(id)) {
          // A current CODE where an id belongs is a tab from before the id link.
          if (shifts.codes.has(id)) return { ok: false, status: 409, body: STALE_CLIENT };
          return bad(`Unknown shift ${id}`, "unknown-shift", { shiftTypeId: id });
        }
        if (seen.has(id)) return bad(`${where}: condition ${i}: shift listed twice in ${key}`, "duplicate", { shiftTypeId: id });
        seen.add(id);
      }
    }
  }
  return { ok: true, conditions: coerceConditions(value).filter(hasSelector) };
}
