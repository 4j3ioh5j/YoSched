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

// Card #266: the "spacing" factor sits directly after "requests" (David's #52). One helper
// places it wherever a key list predates it: the engine's acceptance of the old exact 6-key
// set, and applying a saved profile that lacks it. Without "requests", spacing goes last.
export const SPACING_KEY = "spacing";
export function insertSpacingAfterRequests(keys: readonly string[]): string[] {
  if (keys.includes(SPACING_KEY)) return [...keys];
  const at = keys.indexOf("requests");
  return at < 0 ? [...keys, SPACING_KEY] : [...keys.slice(0, at + 1), SPACING_KEY, ...keys.slice(at + 1)];
}

// Card #266: the Live grid runs the engine in the browser, and an open tab keeps its old bundle
// across a deploy. An old engine sees an unknown "spacing" row and falls back to the default
// order (overHours above requests), so GET /api/auto-schedule/inputs sends the spacing row ONLY
// to a client that says it knows it (`factors=spacing`, comma-separated list). Without the flag
// the old tab gets the six rows its engine honours exactly.
export const SPACING_CAPABILITY_PARAM = "factors";
export function factorRowsForClient<T extends { key: string }>(rows: readonly T[], capability: string | null): T[] {
  const caps = new Set((capability ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  return caps.has(SPACING_KEY) ? [...rows] : rows.filter((r) => r.key !== SPACING_KEY);
}
