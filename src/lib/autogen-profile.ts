// Pure helpers for named auto-generation priority profiles (#252). A profile is a saved
// snapshot of the AutoGenFactor order (a string[] of factor keys). Kept separate from the
// route so the validation/reconciliation logic is unit-testable without prisma/auth.

import { validateFactorOrder } from "./autogen-factor-order";

export type ProfileInputValidation =
  | { ok: true; name: string; order: string[] }
  | { ok: false; error: string };

// Validates a "save as profile" request: a non-empty name plus an order that is an EXACT
// permutation of the current factor keys (delegated to validateFactorOrder so a profile can
// only ever store a complete, valid ordering). Returns the trimmed name on success.
export function validateProfileInput(
  name: unknown,
  order: unknown,
  existingKeys: string[],
): ProfileInputValidation {
  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, error: "Profile name is required" };
  }
  const orderResult = validateFactorOrder(order, existingKeys);
  if (!orderResult.ok) return { ok: false, error: orderResult.error };
  return { ok: true, name: name.trim(), order: orderResult.order };
}

// Reconciles a saved profile order against the live factor catalog so that APPLYING an old
// profile always yields an exact permutation of the current keys — even if the catalog has
// since changed. Known keys keep their saved relative order; unknown keys are dropped; any
// current key missing from the snapshot is appended (in existingKeys order). The result is
// always a permutation of existingKeys, so the subsequent Save passes validateFactorOrder.
export function reconcileOrder(savedOrder: unknown, existingKeys: string[]): string[] {
  const known = new Set(existingKeys);
  const seen = new Set<string>();
  const reconciled: string[] = [];
  if (Array.isArray(savedOrder)) {
    for (const key of savedOrder) {
      if (typeof key === "string" && known.has(key) && !seen.has(key)) {
        seen.add(key);
        reconciled.push(key);
      }
    }
  }
  for (const key of existingKeys) {
    if (!seen.has(key)) reconciled.push(key);
  }
  return reconciled;
}
