// Card #75: the writers of the eligibility tables — staff_eligible_shifts (who may get a shift)
// and employment_type_default_shifts (which shifts a new hire of a type gets) — are serialised by
// one transaction-scoped advisory lock, and a page's save applies only what the user changed.
//
// Why: the activation panel (Settings → turn a shift's Auto-schedule on) rewrites one shift's
// column across every active staff member and every employment type. The Staff page and the
// employment-type editor used to send the WHOLE list and replace it, so a page loaded before the
// activation reverted it on its next save. Now a save sends the list it started from (`base`) and
// the server applies only the difference; an old cached client that sends no base may only send
// the list exactly as stored (a no-op), otherwise it gets a 409 "reload".

import type { Prisma } from "@/generated/prisma/client";

/** Advisory-lock key for every writer of the two eligibility tables. */
export const ELIGIBILITY_LOCK_KEY = 750_075;

/** Take the eligibility lock. Call FIRST in the transaction, before reading what you compare. */
export async function lockEligibility(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ELIGIBILITY_LOCK_KEY}::bigint)`;
}

export class EligibilityStale extends Error {
  constructor() {
    super("This list was changed elsewhere (for example a shift was turned on in Settings). Reload the page and try again.");
  }
}

const isIdList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");

/**
 * What to add and remove so the stored list reflects the user's edit.
 * - With `base` (the list the page started from): apply only the user's changes —
 *   added = sent − base, removed = base − sent — on top of what is stored now.
 * - Without `base` (an old cached client): allowed only when `sent` equals what is stored
 *   (nothing changes); anything else would overwrite a change made elsewhere → EligibilityStale.
 */
export function eligibilityDiff(
  stored: readonly string[],
  sent: unknown,
  base: unknown,
): { add: string[]; remove: string[] } {
  if (!isIdList(sent)) throw new TypeError("list must be an array of ids");
  const now = new Set(stored);
  const want = new Set(sent);
  if (base === undefined || base === null) {
    if (want.size !== now.size || [...want].some((id) => !now.has(id))) throw new EligibilityStale();
    return { add: [], remove: [] };
  }
  if (!isIdList(base)) throw new TypeError("base must be an array of ids");
  const from = new Set(base);
  const add = [...want].filter((id) => !from.has(id) && !now.has(id));
  const remove = [...from].filter((id) => !want.has(id) && now.has(id));
  return { add, remove };
}
