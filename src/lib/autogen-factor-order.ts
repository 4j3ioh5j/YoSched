// Pure validation for the auto-generation factor reorder (#252, Slice 1). The new
// order submitted to PUT /api/settings/autogen-factors must be an EXACT permutation of
// the existing factor keys — same set, no duplicates, nothing added or removed. Slice 1
// is reorder-only, so the catalog is fixed; this also guarantees the engine still sees
// every known factor (and honors the config rather than falling back). Kept pure and
// separate from the route so it's unit-testable without prisma/auth machinery.

export type FactorOrderValidation = { ok: true; order: string[] } | { ok: false; error: string };

export function validateFactorOrder(submitted: unknown, existingKeys: string[]): FactorOrderValidation {
  if (!Array.isArray(submitted) || !submitted.every((k) => typeof k === "string")) {
    return { ok: false, error: "Body must be { order: string[] }" };
  }
  const order = submitted as string[];
  if (new Set(order).size !== order.length) {
    return { ok: false, error: "order has duplicate keys" };
  }
  if (order.length !== existingKeys.length || !order.every((k) => existingKeys.includes(k))) {
    return { ok: false, error: "order must be a permutation of the existing factor keys" };
  }
  return { ok: true, order };
}

// Card #293: "spacing" (cards #266–#289) is retired. The engine drops a stale row with this key
// (a DB not yet migrated, an old tab's input, a rollback's re-added row) instead of falling back.
export const RETIRED_SPACING_KEY = "spacing";


// Card #467: the two lowest factors ("Long weekends off", "Even OR staffing across days"). An engine
// that knows them appends any that a saved order lacks; an engine older than 0.640.0 falls back to
// its default order when it meets an unknown row, so the Live input bundle sends these rows only to
// a browser that says it knows them (FACTORS_HEADER lists the keys its engine knows).
export const LATER_FACTOR_KEYS: readonly string[] = ["longWeekends", "dayBalance"];
export const FACTORS_HEADER = "x-yosched-factors";

/** The factor rows for a browser engine: drops a later factor the browser didn't list in FACTORS_HEADER. */
export function factorsForClient<T extends { key: string }>(rows: readonly T[], header: string | null): T[] {
  const known = new Set((header ?? "").split(",").map((k) => k.trim()).filter(Boolean));
  return rows.filter((r) => !LATER_FACTOR_KEYS.includes(r.key) || known.has(r.key));
}
