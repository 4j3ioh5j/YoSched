/**
 * Pure helper computing the printed schedule's AGGREGATE columns — the configurable
 * replacement for the old hardcoded "FB" collapse column.
 *
 * Each aggregate column lists (per day, handled by the grid) the initials of the staff
 * who belong to it and are scheduled that day. Membership and the individual-column
 * suppression are decided here:
 *
 *   - A NAMED column (isOther = false) holds the staff matching its rule (same matching
 *     as the individual-column visibility — employment type, FTE bounds, shift
 *     conditions). A staff matches at most ONE named column: FIRST-MATCH-WINS in the
 *     given order, so overlapping rules never double-list a person.
 *   - A named column with suppressMembers = true hides its members' individual columns
 *     in print (it "claims" them); with suppressMembers = false the member shows both
 *     individually and in the column.
 *   - A CATCH-ALL column (isOther = true) has no rule. It holds the residual: staff
 *     who appear in NO other printed column — i.e. who have no printed individual
 *     column AND belong to no named column. Crucially this is computed against the
 *     FINAL individual-visible set (after suppression), so a staff claimed by a
 *     suppressing named column is counted as "appearing" there, not in the catch-all.
 *     Catch-all is a per-column flag, not a singleton: there may be zero, one, or
 *     several (multiple catch-all columns simply each list the same residual).
 *
 * `individualVisible` is the set of staff whose individual column would print per the
 * PrintColumnRule visibility helper (null = everyone). Disabled columns are ignored.
 *
 * The grid skips rendering any returned column with no members (over the printed
 * period), so an enabled-but-empty column — including the default catch-all — adds
 * nothing to the printout.
 *
 * Kept DB/React-free so it is unit-testable in isolation.
 */

import type { PrintRule, PrintVisStaff, ShiftKind } from "./print-column-visibility";
import { staffMatchesRule } from "./print-column-visibility";

export type AggregateColumn = {
  label: string;
  enabled: boolean;
  isOther: boolean;
  suppressMembers: boolean;
} & Pick<PrintRule, "employmentTypeIds" | "minFtePercentage" | "maxFtePercentage" | "conditions">;

export type AggregateColumnResult = {
  /** The enabled columns, in input order, each with its resolved member staff ids
   *  (in the input staff order). May include empty columns — the grid skips those. */
  columns: { label: string; isOther: boolean; memberIds: string[] }[];
  /** Staff whose individual column should be HIDDEN in print (claimed by a named
   *  column with suppressMembers = true). */
  suppressedIndividualIds: Set<string>;
};

export function computeAggregateColumns(
  staff: readonly PrintVisStaff[],
  individualVisible: ReadonlySet<string> | null, // null = every staff has an individual column
  columns: readonly AggregateColumn[],
  codesByStaff: ReadonlyMap<string, Set<string>>,
  kindByCode: ReadonlyMap<string, ShiftKind>,
): AggregateColumnResult {
  const enabled = columns.filter((c) => c.enabled);
  const named = enabled.filter((c) => !c.isOther);
  const hasCatchAll = enabled.some((c) => c.isOther);
  const empty = new Set<string>();

  // First-match-wins: each staff joins at most one named column.
  const namedMembers: string[][] = named.map(() => []);
  const memberOfNamed = new Set<string>();
  const suppressedIndividualIds = new Set<string>();
  for (const p of staff) {
    const codes = codesByStaff.get(p.id) ?? empty;
    for (let i = 0; i < named.length; i++) {
      if (staffMatchesRule(p, named[i], codes, kindByCode)) {
        namedMembers[i].push(p.id);
        memberOfNamed.add(p.id);
        if (named[i].suppressMembers) suppressedIndividualIds.add(p.id);
        break;
      }
    }
  }

  // Final individual-visible set = would-be-visible MINUS suppressed.
  const printsIndividually = (id: string) =>
    (individualVisible === null || individualVisible.has(id)) && !suppressedIndividualIds.has(id);

  // Catch-all residual = staff appearing in no other printed column: no printed
  // individual column AND not a member of any named column. Computed once and shared
  // by every catch-all column (there may be zero, one, or several).
  const otherMembers: string[] = [];
  if (hasCatchAll) {
    for (const p of staff) {
      if (!printsIndividually(p.id) && !memberOfNamed.has(p.id)) otherMembers.push(p.id);
    }
  }

  // Re-assemble in the original input order (named + other interleaved as given).
  const columnsOut: { label: string; isOther: boolean; memberIds: string[] }[] = [];
  let ni = 0;
  for (const c of enabled) {
    if (c.isOther) columnsOut.push({ label: c.label, isOther: true, memberIds: otherMembers });
    else columnsOut.push({ label: c.label, isOther: false, memberIds: namedMembers[ni++] });
  }

  return { columns: columnsOut, suppressedIndividualIds };
}
