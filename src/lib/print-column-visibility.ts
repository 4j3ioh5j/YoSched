/**
 * Pure helper deciding which staff get their own column on the PRINTED schedule.
 *
 * Each rule is "include" or "exclude". The printed set is built in two passes:
 *   1. base = union (OR) of all enabled INCLUDE rules — or, if there are no enabled
 *      include rules, everyone.
 *   2. remove every staff matching any enabled EXCLUDE rule.
 * When no enabled rule exists the function returns `null` — the sentinel for "show
 * everyone" (backward compatible). The on-screen grid is never filtered by this;
 * the caller applies the result to print only.
 *
 * A rule matches a staff when its employment-type filter, FTE bounds, and ALL of
 * its shift CONDITIONS hold. A condition is a quantifier (has_any / has_none /
 * has_all) over a "shift set" defined by categories (work | leave | off) and/or
 * explicit codes, minus an `except` list. This expresses things like "has no work
 * shift except ICU/CARD" (has_none of {work except ICU,CARD}) or "any work or any
 * leave" (has_any of {work, leave}). Conditions within a rule are ANDed.
 *
 * Kept DB/React-free so it is unit-testable in isolation (the grid is a large
 * "use client" component).
 */

export type ShiftKind = "work" | "leave" | "off";

export type ShiftCondition = {
  quantifier: string; // "has_any" | "has_none" | "has_all"
  categories: string[]; // subset of "work" | "leave" | "off"
  codes: string[]; // explicit shift codes added to the set
  except: string[]; // codes removed from the set
};

export type PrintRule = {
  enabled: boolean;
  mode: string; // "include" (default) | "exclude"
  employmentTypeIds: string[]; // empty = any employment type
  minFtePercentage: number | null; // null = no lower bound
  maxFtePercentage: number | null; // null = no upper bound
  conditions: ShiftCondition[]; // ANDed; empty = no shift constraint
};

export type PrintVisStaff = {
  id: string;
  employmentTypeId: string;
  ftePercentage: number | null;
};

const QUANTIFIERS = new Set(["has_any", "has_none", "has_all"]);
const KINDS = new Set<ShiftKind>(["work", "leave", "off"]);

/** Validate/coerce an untrusted value (API body or DB Json) into ShiftCondition[].
 *  Unknown quantifiers fall back to "has_any"; non-string/unknown entries dropped. */
export function coerceConditions(value: unknown): ShiftCondition[] {
  if (!Array.isArray(value)) return [];
  const out: ShiftCondition[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const quantifier = typeof o.quantifier === "string" && QUANTIFIERS.has(o.quantifier) ? o.quantifier : "has_any";
    const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const categories = strArr(o.categories).filter((c) => KINDS.has(c as ShiftKind));
    out.push({ quantifier, categories, codes: strArr(o.codes), except: strArr(o.except) });
  }
  return out;
}

/** Legacy single shiftCodes/shiftMatch selector expressed as one condition. */
export function legacyToConditions(shiftCodes: string[], shiftMatch: string): ShiftCondition[] {
  if (!shiftCodes || shiftCodes.length === 0) return [];
  return [{ quantifier: shiftMatch === "all" ? "has_all" : "has_any", categories: [], codes: [...shiftCodes], except: [] }];
}

/** The conditions to evaluate for a stored rule: its `conditions`, or — for rows
 *  predating the conditions column — a synthesized condition from the legacy fields. */
export function effectiveConditions(conditionsJson: unknown, legacyShiftCodes: string[], legacyShiftMatch: string): ShiftCondition[] {
  const c = coerceConditions(conditionsJson);
  return c.length > 0 ? c : legacyToConditions(legacyShiftCodes, legacyShiftMatch);
}

/** A condition with neither a category nor an explicit code selects nothing, so
 *  it imposes no constraint (skipped) rather than matching/excluding everyone. */
function hasSelector(c: ShiftCondition): boolean {
  return c.categories.length > 0 || c.codes.length > 0;
}

/** Is `code` in this condition's shift set? except wins, then explicit codes,
 *  then category membership (via the code→kind catalog). */
function codeInSet(code: string, c: ShiftCondition, kindByCode: ReadonlyMap<string, ShiftKind>): boolean {
  if (c.except.includes(code)) return false;
  if (c.codes.includes(code)) return true;
  const kind = kindByCode.get(code);
  return kind != null && c.categories.includes(kind);
}

function conditionMatches(
  codes: Set<string>,
  c: ShiftCondition,
  kindByCode: ReadonlyMap<string, ShiftKind>,
): boolean {
  if (!hasSelector(c)) return true; // empty condition = no constraint

  if (c.quantifier === "has_all") {
    // Every listed explicit code must be present that period (categories N/A).
    if (c.codes.length === 0) return true;
    return c.codes.every((code) => codes.has(code));
  }

  let any = false;
  for (const code of codes) {
    if (codeInSet(code, c, kindByCode)) { any = true; break; }
  }
  return c.quantifier === "has_none" ? !any : any; // default: has_any
}

/** The subset of a rule used for matching a staff (no mode/enabled). Lets the
 *  aggregate-column helper reuse this matcher with its own column type. */
export type RuleMatchable = Pick<
  PrintRule,
  "employmentTypeIds" | "minFtePercentage" | "maxFtePercentage" | "conditions"
>;

/** Does this staff satisfy a rule's employment-type filter, FTE bounds, and ALL of
 *  its (ANDed) shift conditions? Exported so the aggregate-column helper can reuse
 *  the exact same matching as the individual-column visibility. */
export function staffMatchesRule(
  staff: PrintVisStaff,
  rule: RuleMatchable,
  codes: Set<string>,
  kindByCode: ReadonlyMap<string, ShiftKind>,
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
    if (rule.minFtePercentage != null && staff.ftePercentage < rule.minFtePercentage) return false;
    if (rule.maxFtePercentage != null && staff.ftePercentage > rule.maxFtePercentage) return false;
  }

  // All shift conditions (ANDed).
  for (const c of rule.conditions) {
    if (!conditionMatches(codes, c, kindByCode)) return false;
  }

  return true;
}

/**
 * The set of staff ids whose individual column should print, or `null` to print
 * everyone (no enabled rules). `codesByStaff` maps each staff id to the set of
 * shift codes they have assigned within the printed period (real assignment codes
 * only, incl. leave/off so category conditions can see them). `kindByCode` maps a
 * code to its kind (work | leave | off) for category conditions.
 */
export function printVisibleStaffIds(
  staff: readonly PrintVisStaff[],
  rules: readonly PrintRule[],
  codesByStaff: ReadonlyMap<string, Set<string>>,
  kindByCode: ReadonlyMap<string, ShiftKind>,
): Set<string> | null {
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return null; // show everyone

  const includes = enabled.filter((r) => r.mode !== "exclude");
  const excludes = enabled.filter((r) => r.mode === "exclude");
  const empty = new Set<string>();

  const visible = new Set<string>();
  for (const p of staff) {
    const codes = codesByStaff.get(p.id) ?? empty;
    const included =
      includes.length === 0 || includes.some((rule) => staffMatchesRule(p, rule, codes, kindByCode));
    if (!included) continue;
    if (excludes.some((rule) => staffMatchesRule(p, rule, codes, kindByCode))) continue;
    visible.add(p.id);
  }
  return visible;
}
