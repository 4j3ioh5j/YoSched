// Pay-period hours policy for the two hours rows of Auto-Generation Priority
// (overHours / underHours). Per department, stored on AutoGenFactor.hoursPolicy.
//   prohibited  — never crossed, wherever the row ranks (a shortfall is flagged instead)
//   discouraged — the row's rank decides: a factor ranked above it may push past it (flagged)
//   allowed     — never blocks a placement
// NULL / unknown stored values read as "discouraged" (lenient); writes are strict.

export const HOURS_POLICIES = ["prohibited", "discouraged", "allowed"] as const;
export type HoursPolicy = (typeof HOURS_POLICIES)[number];
export const HOURS_POLICY_KEYS = ["overHours", "underHours"] as const;
export type HoursPolicyKey = (typeof HOURS_POLICY_KEYS)[number];
export function isHoursPolicyKey(k: string): k is HoursPolicyKey {
  return (HOURS_POLICY_KEYS as readonly string[]).includes(k);
}
export const DEFAULT_HOURS_POLICY: HoursPolicy = "discouraged";

export function isHoursPolicy(v: unknown): v is HoursPolicy {
  return typeof v === "string" && (HOURS_POLICIES as readonly string[]).includes(v);
}

export function parseHoursPolicy(v: unknown): HoursPolicy {
  return isHoursPolicy(v) ? v : DEFAULT_HOURS_POLICY;
}

export type HoursPoliciesValidation =
  | { ok: true; policies: Partial<Record<HoursPolicyKey, HoursPolicy>> }
  | { ok: false; error: string };

// Strict validation of the optional `policies` body field on PUT /api/settings/autogen-factors.
// Absent → no change. Present → an object whose keys are only overHours/underHours, each a valid policy.
export function validateHoursPolicies(submitted: unknown): HoursPoliciesValidation {
  if (submitted === undefined) return { ok: true, policies: {} };
  if (submitted === null || typeof submitted !== "object" || Array.isArray(submitted)) {
    return { ok: false, error: "policies must be an object" };
  }
  const out: Partial<Record<HoursPolicyKey, HoursPolicy>> = {};
  for (const [k, v] of Object.entries(submitted as Record<string, unknown>)) {
    if (!(HOURS_POLICY_KEYS as readonly string[]).includes(k)) {
      return { ok: false, error: `policies: unknown key "${k}" (only overHours, underHours)` };
    }
    if (!isHoursPolicy(v)) {
      return { ok: false, error: `policies.${k} must be one of ${HOURS_POLICIES.join(", ")}` };
    }
    out[k as HoursPolicyKey] = v;
  }
  return { ok: true, policies: out };
}
