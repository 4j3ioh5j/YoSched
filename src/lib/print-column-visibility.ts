/**
 * Pure helper deciding which staff get their own column on the PRINTED schedule.
 *
 * Each rule is "include" or "exclude". The printed set is built in two passes:
 *   1. base = union (OR) of all enabled INCLUDE rules — or, if there are no enabled
 *      include rules, everyone.
 *   2. remove every staff matching any enabled EXCLUDE rule.
 * So "include FTEs" prints only FTEs, while "exclude fee-basis" prints everyone
 * except fee-basis. When no enabled rule exists the function returns `null` — the
 * sentinel for "show everyone" (today's behavior, backward compatible). The
 * on-screen grid is never filtered by this; the caller applies the result to print.
 *
 * Kept DB/React-free so it is unit-testable in isolation (the grid is a large
 * "use client" component).
 */

export type PrintRule = {
  enabled: boolean;
  mode: string; // "include" (default) | "exclude"
  employmentTypeIds: string[]; // empty = any employment type
  minFtePercentage: number | null; // null = no lower bound
  maxFtePercentage: number | null; // null = no upper bound
  shiftCodes: string[]; // empty = no shift requirement
  shiftMatch: string; // "any" (>=1 of codes that period) | "all"
};

export type PrintVisStaff = {
  id: string;
  employmentTypeId: string;
  ftePercentage: number | null;
};

/** Does one staff member match a single rule? */
function matchesRule(
  staff: PrintVisStaff,
  rule: PrintRule,
  codes: Set<string> | undefined,
): boolean {
  // Employment type: empty list = any.
  if (
    rule.employmentTypeIds.length > 0 &&
    !rule.employmentTypeIds.includes(staff.employmentTypeId)
  ) {
    return false;
  }

  // FTE bounds: a rule with any bound excludes a staff whose fte is unknown (null).
  if (rule.minFtePercentage != null || rule.maxFtePercentage != null) {
    if (staff.ftePercentage == null) return false;
    if (rule.minFtePercentage != null && staff.ftePercentage < rule.minFtePercentage) {
      return false;
    }
    if (rule.maxFtePercentage != null && staff.ftePercentage > rule.maxFtePercentage) {
      return false;
    }
  }

  // Shift requirement: empty list = no requirement.
  if (rule.shiftCodes.length > 0) {
    const has = codes ?? new Set<string>();
    if (rule.shiftMatch === "all") {
      if (!rule.shiftCodes.every((c) => has.has(c))) return false;
    } else {
      // "any" (default): at least one of the listed codes present this period.
      if (!rule.shiftCodes.some((c) => has.has(c))) return false;
    }
  }

  return true;
}

/**
 * The set of staff ids whose individual column should print, or `null` to print
 * everyone (no enabled rules). `codesByStaff` maps each staff id to the set of
 * shift codes they have assigned within the printed period (caller supplies real
 * assignment codes only — print reflects the committed schedule).
 */
export function printVisibleStaffIds(
  staff: readonly PrintVisStaff[],
  rules: readonly PrintRule[],
  codesByStaff: ReadonlyMap<string, Set<string>>,
): Set<string> | null {
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return null; // show everyone

  const includes = enabled.filter((r) => r.mode !== "exclude");
  const excludes = enabled.filter((r) => r.mode === "exclude");

  const visible = new Set<string>();
  for (const p of staff) {
    const codes = codesByStaff.get(p.id);
    // Base: union of include rules, or everyone when there are no include rules.
    const included =
      includes.length === 0 || includes.some((rule) => matchesRule(p, rule, codes));
    if (!included) continue;
    // Exclusions remove matching staff from the printed set.
    if (excludes.some((rule) => matchesRule(p, rule, codes))) continue;
    visible.add(p.id);
  }
  return visible;
}
