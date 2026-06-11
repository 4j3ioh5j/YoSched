// Optimistic-concurrency (compare-and-swap) helpers for assignment writes.
//
// The concurrency token is `Assignment.updatedAt`, which Postgres stores as
// TIMESTAMP(3) (millisecond precision), so `Date#toISOString()` round-trips the
// value exactly and CAS-by-equality is precise. `@updatedAt` auto-bumps on every
// write, so the token stays current across all write paths for free.
//
// A request opts into conflict checking by sending `baseUpdatedAt` — the token it
// based its edit on, or `null` to mean "I saw this cell EMPTY". When the property
// is ABSENT the write is "legacy" and behaves exactly as it did before CAS (so the
// server can ship dormant until the client starts sending tokens). `force: true`
// overrides a detected conflict (but never the lock check).

export type AssignmentBase =
  | { kind: "legacy" } // no token sent → preserve pre-CAS behavior
  | { kind: "force" } // force:true → skip the updatedAt check (lock still enforced)
  | { kind: "check"; base: Date | null } // base=null means "I saw an empty cell"
  | { kind: "invalid"; message: string }; // malformed → caller returns 400

/**
 * Parse the concurrency intent from a request object — the body for a single
 * write or a swap side, or an individual bulk cell. Property PRESENCE (not value)
 * distinguishes an omitted token (legacy) from an explicit `null` (saw-empty).
 *
 * `batchForce` lets a bulk/auto request carry one body-level `force` that applies
 * to every cell (the "Overwrite all" retry) without each cell repeating it.
 */
export function parseAssignmentBase(obj: unknown, opts?: { batchForce?: boolean }): AssignmentBase {
  if (typeof obj !== "object" || obj === null) return { kind: "legacy" };
  const o = obj as Record<string, unknown>;
  if (opts?.batchForce === true || o.force === true) return { kind: "force" };
  if (!Object.prototype.hasOwnProperty.call(o, "baseUpdatedAt")) return { kind: "legacy" };
  const v = o.baseUpdatedAt;
  if (v === null) return { kind: "check", base: null };
  if (typeof v !== "string") return { kind: "invalid", message: "baseUpdatedAt must be an ISO timestamp string or null" };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return { kind: "invalid", message: "baseUpdatedAt is not a valid timestamp" };
  return { kind: "check", base: d };
}

/**
 * After a conditional `updateMany`/`deleteMany` matches 0 rows, classify why by
 * inspecting the freshly reloaded current row. The CALLER decides what each means
 * for its operation — notably, "gone" is a conflict for an UPDATE (deleted
 * underneath you) but an idempotent success for a DELETE (the cell is already
 * empty, which is the goal).
 */
export type CasFailure = "gone" | "locked" | "conflict";
export function classifyCasFailure(current: { isLocked: boolean } | null): CasFailure {
  if (current === null) return "gone";
  if (current.isLocked) return "locked";
  return "conflict";
}

/**
 * A single 409 conflict entry. Always carries `staffId` + `date` (identity) and
 * the `current` server value (or null if the cell is now empty) so the client can
 * map the conflict back to a specific cell and show what it changed to.
 */
export type ConflictItem<T> = { staffId: string; date: string; current: T | null };
export function conflictItem<T>(staffId: string, date: string, current: T | null): ConflictItem<T> {
  return { staffId, date, current };
}
