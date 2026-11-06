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
 * explicit shifts, minus an `exceptIds` list. This expresses things like "has no work
 * shift except ICU/CARD" (has_none of {work except ICU,CARD}) or "any work or any
 * leave" (has_any of {work, leave}). Conditions within a rule are ANDed.
 *
 * Shifts are named by their ID (shift_types.id) everywhere here — stored conditions,
 * the per-staff shift sets and the kind catalog — so a renamed shift code changes
 * nothing. The codes shown to the admin are derived from the shift list at read time
 * (see print-conditions.ts).
 *
 * Kept DB/React-free so it is unit-testable in isolation (the grid is a large
 * "use client" component).
 */

export type ShiftKind = "work" | "leave" | "off";

export type ShiftCondition = {
  quantifier: string; // "has_any" | "has_none" | "has_all"
  categories: string[]; // subset of "work" | "leave" | "off"
  shiftTypeIds: string[]; // explicit shifts (by id) added to the set
  exceptIds: string[]; // shifts (by id) removed from the set
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
 *  Unknown quantifiers fall back to "has_any"; non-string/unknown entries dropped. The
 *  legacy `codes` / `except` keys (Phase A compat, derived by the DB) are ignored. */
export function coerceConditions(value: unknown): ShiftCondition[] {
  if (!Array.isArray(value)) return [];
  const out: ShiftCondition[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const quantifier = typeof o.quantifier === "string" && QUANTIFIERS.has(o.quantifier) ? o.quantifier : "has_any";
    const strArr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
    const categories = strArr(o.categories).filter((c) => KINDS.has(c as ShiftKind));
    out.push({ quantifier, categories, shiftTypeIds: strArr(o.shiftTypeIds), exceptIds: strArr(o.exceptIds) });
  }
  return out;
}

/** A condition with neither a category nor an explicit shift selects nothing, so
 *  it imposes no constraint (skipped) rather than matching/excluding everyone. */
export function hasSelector(c: ShiftCondition): boolean {
  return c.categories.length > 0 || c.shiftTypeIds.length > 0;
}

/** Is shift `id` in this condition's shift set? except wins, then explicit shifts,
 *  then category membership (via the id→kind catalog). */
function idInSet(id: string, c: ShiftCondition, kindById: ReadonlyMap<string, ShiftKind>): boolean {
  if (c.exceptIds.includes(id)) return false;
  if (c.shiftTypeIds.includes(id)) return true;
  const kind = kindById.get(id);
  return kind != null && c.categories.includes(kind);
}

function conditionMatches(
  shiftIds: Set<string>,
  c: ShiftCondition,
  kindById: ReadonlyMap<string, ShiftKind>,
): boolean {
  if (!hasSelector(c)) return true; // empty condition = no constraint

  if (c.quantifier === "has_all") {
    // Every listed explicit shift must be present that period (categories N/A).
    if (c.shiftTypeIds.length === 0) return true;
    return c.shiftTypeIds.every((id) => shiftIds.has(id));
  }

  let any = false;
  for (const id of shiftIds) {
    if (idInSet(id, c, kindById)) { any = true; break; }
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
 *  its (ANDed) shift conditions? `shiftIds` = the shift ids the staff has in the
 *  period. Exported so the aggregate-column helper can reuse the exact same matching
 *  as the individual-column visibility. */
export function staffMatchesRule(
  staff: PrintVisStaff,
  rule: RuleMatchable,
  shiftIds: Set<string>,
  kindById: ReadonlyMap<string, ShiftKind>,
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
    if (!conditionMatches(shiftIds, c, kindById)) return false;
  }

  return true;
}

/**
 * The set of staff ids whose individual column should print, or `null` to print
 * everyone (no enabled rules). `shiftIdsByStaff` maps each staff id to the set of
 * shift ids they have assigned within the printed period (real assignments only,
 * incl. leave/off so category conditions can see them). `kindById` maps a shift id
 * to its kind (work | leave | off) for category conditions.
 */
export function printVisibleStaffIds(
  staff: readonly PrintVisStaff[],
  rules: readonly PrintRule[],
  shiftIdsByStaff: ReadonlyMap<string, Set<string>>,
  kindById: ReadonlyMap<string, ShiftKind>,
): Set<string> | null {
  const enabled = rules.filter((r) => r.enabled);
  if (enabled.length === 0) return null; // show everyone

  const includes = enabled.filter((r) => r.mode !== "exclude");
  const excludes = enabled.filter((r) => r.mode === "exclude");
  const empty = new Set<string>();

  const visible = new Set<string>();
  for (const p of staff) {
    const ids = shiftIdsByStaff.get(p.id) ?? empty;
    const included =
      includes.length === 0 || includes.some((rule) => staffMatchesRule(p, rule, ids, kindById));
    if (!included) continue;
    if (excludes.some((rule) => staffMatchesRule(p, rule, ids, kindById))) continue;
    visible.add(p.id);
  }
  return visible;
}
