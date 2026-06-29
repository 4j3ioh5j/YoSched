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
