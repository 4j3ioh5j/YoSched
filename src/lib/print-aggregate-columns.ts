/**
 * Pure helper computing the printed schedule's AGGREGATE columns — the configurable
 * replacement for the old hardcoded "FB" collapse column.
 *
 * Each aggregate column lists, PER DAY, the initials (here: member ids; the grid maps
 * to initials) of the staff who belong to it and are scheduled that day. Ownership and
 * the individual-column suppression are decided here.
 *
 * OWNERSHIP IS PER DAY. For each day d and staff p, the FIRST enabled named column (in
 * order) that "shows" p on day d OWNS p that day — p's id goes in that column's cell for
 * d. A person can therefore land in different columns on different days (e.g. an OR
 * day-scoped column on Monday, an ICU day-scoped column on Tuesday).
 *
 * A NAMED column (isOther = false) shows p on day d when p is SCHEDULED (a non-off
 * assignment) that day AND p satisfies the column's rule. How the rule's shift
 * conditions are evaluated depends on the column's `conditionScope`:
 *   - "month" (default): conditions match over the WHOLE printed month's codes (today's
 *     behavior). Membership is day-invariant, so the member shows on every scheduled day.
 *   - "day": conditions match against THAT DAY's single code, so the member shows only on
 *     days whose shift satisfies the conditions.
 * Employment-type and FTE bounds are person-level and apply identically in both scopes.
 * The non-off "scheduled" render gate applies in BOTH scopes — so a no-condition day
 * column shows on every scheduled day (never on unscheduled days), and a condition that
 * only matches `off` shifts can never render (off is gated out, as aggregate columns
 * never show off shifts).
 *
 * A named column with suppressMembers = true hides the individual columns of the staff it
 * OWNS on at least one day; with suppressMembers = false the member shows both
 * individually and in the column. Suppression is whole-column (all-or-nothing).
 *
 * A CATCH-ALL column (isOther = true) has no rule and ignores conditionScope. Per day it
 * holds the residual: staff scheduled that day who appear in NO other printed column —
 * i.e. who have no printed individual column AND are owned by no named column that day.
 * Computed against the FINAL individual-visible set (after suppression), so a staff
 * claimed by a suppressing named column is "appearing" there (and is picked up by the
 * catch-all on days that column does not own them). Catch-all is a per-column flag, not a
 * singleton: zero, one, or several catch-all columns each list the same residual.
 *
 * `individualVisible` is the set of staff whose individual column would print per the
 * PrintColumnRule visibility helper (null = everyone). Disabled columns are ignored.
 *
 * The grid skips rendering any returned column with no members over the printed period,
 * so an enabled-but-empty column — including the default catch-all — adds nothing.
 *
 * Kept DB/React-free so it is unit-testable in isolation.
 */

import type { PrintRule, PrintVisStaff, ShiftKind } from "./print-column-visibility";
import { staffMatchesRule } from "./print-column-visibility";

export type ConditionScope = "month" | "day";

/** Coerce an untrusted value (API body or stored DB string) to a ConditionScope. Only
 *  "day" maps to "day"; everything else — including stale/malformed values — maps to
 *  "month", so a bad stored value can never leak into the helper as a third behavior. */
export function coerceConditionScope(value: unknown): ConditionScope {
  return value === "day" ? "day" : "month";
}

export type AggregateColumn = {
  label: string;
  enabled: boolean;
  isOther: boolean;
  suppressMembers: boolean;
  /** Raw value — coerced via coerceConditionScope() inside the helper. */
  conditionScope: string;
} & Pick<PrintRule, "employmentTypeIds" | "minFtePercentage" | "maxFtePercentage" | "conditions">;

export type AggregateColumnResult = {
  /** The enabled columns, in input order, each with per-date member ids (in input staff
   *  order). May include all-empty columns — the grid skips those. */
  columns: { label: string; isOther: boolean; memberIdsByDate: Record<string, string[]> }[];
  /** Staff whose individual column should be HIDDEN in print (claimed by a named column
   *  with suppressMembers = true on at least one day). */
  suppressedIndividualIds: Set<string>;
};

export function computeAggregateColumns(
  staff: readonly PrintVisStaff[],
  individualVisible: ReadonlySet<string> | null, // null = every staff has an individual column
  columns: readonly AggregateColumn[],
  dates: readonly string[],
  monthCodesByStaff: ReadonlyMap<string, Set<string>>, // month-wide codes per staff (for "month" scope)
  codeByStaffDate: (staffId: string, date: string) => string | undefined, // that day's code (for "day" scope)
  kindByCode: ReadonlyMap<string, ShiftKind>,
  isScheduledNonOff: (staffId: string, date: string) => boolean, // the render gate (assignment exists + not off)
): AggregateColumnResult {
  const enabled = columns.filter((c) => c.enabled);
  const named = enabled.filter((c) => !c.isOther);
  const hasCatchAll = enabled.some((c) => c.isOther);
  const emptyCodes = new Set<string>();
  const scopeOf = named.map((c) => coerceConditionScope(c.conditionScope));

  // Month-scoped membership is day-invariant — precompute once per month-scoped column to
  // avoid re-matching it on every day. Day-scoped columns are matched per day below.
  const monthMatch: (ReadonlySet<string> | null)[] = named.map((c, i) =>
    scopeOf[i] === "month"
      ? new Set(
          staff
            .filter((p) => staffMatchesRule(p, c, monthCodesByStaff.get(p.id) ?? emptyCodes, kindByCode))
            .map((p) => p.id),
        )
      : null,
  );

  // Does named column i show staff p on day d? (render gate + scope-specific rule match)
  const showsOnNamed = (i: number, p: PrintVisStaff, d: string): boolean => {
    if (!isScheduledNonOff(p.id, d)) return false;
    if (scopeOf[i] === "month") return monthMatch[i]!.has(p.id);
    const code = codeByStaffDate(p.id, d);
    return staffMatchesRule(p, named[i], code != null ? new Set([code]) : emptyCodes, kindByCode);
  };

  // Per-day, first-match-wins ownership. Each named column gets a per-date id list; track
  // which (staff, day) pairs any named column owns (for the catch-all residual) and which
  // staff a suppressing column owns on ≥1 day (for whole-column suppression).
  const namedIdsByDate: Record<string, string[]>[] = named.map(() => {
    const byDate: Record<string, string[]> = {};
    for (const d of dates) byDate[d] = [];
    return byDate;
  });
  const ownedOnDay = new Set<string>(); // `${staffId}:${date}`
  const suppressedIndividualIds = new Set<string>();
  for (const d of dates) {
    for (const p of staff) {
      for (let i = 0; i < named.length; i++) {
        if (showsOnNamed(i, p, d)) {
          namedIdsByDate[i][d].push(p.id);
          ownedOnDay.add(`${p.id}:${d}`);
          if (named[i].suppressMembers) suppressedIndividualIds.add(p.id);
          break; // first-match per day
        }
      }
    }
  }

  // Final individual-visible set = would-be-visible MINUS suppressed.
  const printsIndividually = (id: string) =>
    (individualVisible === null || individualVisible.has(id)) && !suppressedIndividualIds.has(id);

  // Catch-all residual, per day: staff scheduled that day who print in no other column —
  // no printed individual column AND owned by no named column that day. Shared by every
  // catch-all column (there may be zero, one, or several).
  const otherIdsByDate: Record<string, string[]> = {};
  if (hasCatchAll) {
    for (const d of dates) {
      const list: string[] = [];
      for (const p of staff) {
        if (!isScheduledNonOff(p.id, d)) continue;
        if (printsIndividually(p.id)) continue;
        if (ownedOnDay.has(`${p.id}:${d}`)) continue;
        list.push(p.id);
      }
      otherIdsByDate[d] = list;
    }
  }

  // Re-assemble in the original input order (named + other interleaved as given).
  const columnsOut: { label: string; isOther: boolean; memberIdsByDate: Record<string, string[]> }[] = [];
  let ni = 0;
  for (const c of enabled) {
    if (c.isOther) columnsOut.push({ label: c.label, isOther: true, memberIdsByDate: otherIdsByDate });
    else columnsOut.push({ label: c.label, isOther: false, memberIdsByDate: namedIdsByDate[ni++] });
  }

  return { columns: columnsOut, suppressedIndividualIds };
}
