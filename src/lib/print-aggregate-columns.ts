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
 * RULE LINES (card #309): each column has Include / Exclude lines (effectiveCriteria; a row
 * from before them has its single rule as one Include line). A line matches a person when its
 * employment types, FTE bounds and ANDed shift conditions hold and, if it names people, the
 * person is one of them. A line with nothing set is ignored (isInertLine).
 *
 * A NAMED column (isOther = false) shows p on day d when p is SCHEDULED (a non-off
 * assignment) that day AND p matches ANY active Include line (everyone, if it has none) and
 * NO active Exclude line — "the column's rule" below. How the rule's shift
 * conditions are evaluated depends on the column's `conditionScope`:
 *   - "month" (default): conditions match over the WHOLE printed month's shifts (today's
 *     behavior). Membership is day-invariant, so the member shows on every scheduled day.
 *   - "day": conditions match against THAT DAY's single shift, so the member shows only on
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
 * A CATCH-ALL column (isOther = true) starts from the residual and then applies its own lines:
 * + whoever matches an Include line, − whoever matches an Exclude line (card #309; its
 * conditionScope applies to those lines). It claims no ownership. Per day the residual is
 * the staff scheduled that day who appear in NO other printed column —
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
import { hasSelector, staffMatchesRule } from "./print-column-visibility";

export type ConditionScope = "month" | "day";

/** Coerce an untrusted value (API body or stored DB string) to a ConditionScope. Only
 *  "day" maps to "day"; everything else — including stale/malformed values — maps to
 *  "month", so a bad stored value can never leak into the helper as a third behavior. */
export function coerceConditionScope(value: unknown): ConditionScope {
  return value === "day" ? "day" : "month";
}

/** Card #309: one rule line of a column. It matches a person when its employment types, FTE
 *  bounds and (ANDed) shift conditions hold and, when `staffIds` is non-empty, the person is
 *  one of them. A column lists whoever matches ANY active Include line (everyone when it has
 *  none) and NO active Exclude line. */
export type CriteriaLine = {
  mode: "include" | "exclude";
  staffIds: string[];
} & Pick<PrintRule, "employmentTypeIds" | "minFtePercentage" | "maxFtePercentage" | "conditions">;

export type AggregateColumn = {
  /** Card #300: the row id (the special-column order names columns by it). */
  id?: string;
  label: string;
  enabled: boolean;
  isOther: boolean;
  suppressMembers: boolean;
  /** Raw value — coerced via coerceConditionScope() inside the helper. */
  conditionScope: string;
  /** Card #309: the rule lines. null/absent = a row from before them: its single rule (below)
   *  is the one Include line (see effectiveCriteria). */
  criteria?: CriteriaLine[] | null;
} & Pick<PrintRule, "employmentTypeIds" | "minFtePercentage" | "maxFtePercentage" | "conditions">;

/** A line with nothing set selects nobody in particular: it is ignored in both modes, so a blank
 *  Exclude line can never empty a column and a blank Include line never widens one. */
export function isInertLine(l: CriteriaLine): boolean {
  return (
    l.employmentTypeIds.length === 0 &&
    l.minFtePercentage == null &&
    l.maxFtePercentage == null &&
    l.staffIds.length === 0 &&
    !l.conditions.some(hasSelector)
  );
}

/** The column's rule lines. Stored lines win; a row without them (criteria null) gets its old
 *  single rule as one Include line, or none for a catch-all or a rule with nothing set, so its
 *  printed result is exactly what it was before card #309. */
export function effectiveCriteria(c: AggregateColumn): CriteriaLine[] {
  if (Array.isArray(c.criteria)) return c.criteria;
  if (c.isOther) return [];
  const legacy: CriteriaLine = {
    mode: "include",
    employmentTypeIds: c.employmentTypeIds,
    minFtePercentage: c.minFtePercentage,
    maxFtePercentage: c.maxFtePercentage,
    conditions: c.conditions,
    staffIds: [],
  };
  return isInertLine(legacy) ? [] : [legacy];
}

type ActiveLines = { includes: CriteriaLine[]; excludes: CriteriaLine[] };

function activeLines(c: AggregateColumn): ActiveLines {
  const lines = effectiveCriteria(c).filter((l) => !isInertLine(l));
  return { includes: lines.filter((l) => l.mode !== "exclude"), excludes: lines.filter((l) => l.mode === "exclude") };
}

function lineMatches(l: CriteriaLine, p: PrintVisStaff, shiftIds: Set<string>, kindById: ReadonlyMap<string, ShiftKind>): boolean {
  if (l.staffIds.length > 0 && !l.staffIds.includes(p.id)) return false;
  return staffMatchesRule(p, l, shiftIds, kindById);
}

export type AggregateColumnResult = {
  /** The enabled columns, in input order, each with per-date member ids (in input staff
   *  order). May include all-empty columns — the grid skips those. */
  columns: { id?: string; label: string; isOther: boolean; memberIdsByDate: Record<string, string[]> }[];
  /** Staff whose individual column should be HIDDEN in print (claimed by a named column
   *  with suppressMembers = true on at least one day). */
  suppressedIndividualIds: Set<string>;
};

export function computeAggregateColumns(
  staff: readonly PrintVisStaff[],
  individualVisible: ReadonlySet<string> | null, // null = every staff has an individual column
  columns: readonly AggregateColumn[],
  dates: readonly string[],
  monthShiftIdsByStaff: ReadonlyMap<string, Set<string>>, // month-wide shift ids per staff (for "month" scope)
  shiftTypeIdByStaffDate: (staffId: string, date: string) => string | undefined, // that day's shift id (for "day" scope)
  kindById: ReadonlyMap<string, ShiftKind>,
  isScheduledNonOff: (staffId: string, date: string) => boolean, // the render gate (assignment exists + not off)
): AggregateColumnResult {
  const enabled = columns.filter((c) => c.enabled);
  const named = enabled.filter((c) => !c.isOther);
  const emptyIds = new Set<string>();

  // Does a column's line set (any active Include — or none — and no active Exclude) match p,
  // given the shift ids the column's scope sees? `includeDefault` is what "no Include lines"
  // means: everyone for a named column, nobody EXTRA for a catch-all (it adds to the residual).
  const matchesLines = (lines: ActiveLines, p: PrintVisStaff, ids: Set<string>, includeDefault: boolean): boolean => {
    const included = lines.includes.length === 0 ? includeDefault : lines.includes.some((l) => lineMatches(l, p, ids, kindById));
    return included && !lines.excludes.some((l) => lineMatches(l, p, ids, kindById));
  };
  const excludedBy = (lines: ActiveLines, p: PrintVisStaff, ids: Set<string>): boolean =>
    lines.excludes.some((l) => lineMatches(l, p, ids, kindById));
  const includedBy = (lines: ActiveLines, p: PrintVisStaff, ids: Set<string>): boolean =>
    lines.includes.some((l) => lineMatches(l, p, ids, kindById));
  // The shift ids a column's conditions see for p on day d under its scope.
  const idsFor = (scope: ConditionScope, p: PrintVisStaff, d: string): Set<string> => {
    if (scope === "month") return (monthShiftIdsByStaff.get(p.id) as Set<string> | undefined) ?? emptyIds;
    const id = shiftTypeIdByStaffDate(p.id, d);
    return id != null ? new Set([id]) : emptyIds;
  };

  const scopeOf = named.map((c) => coerceConditionScope(c.conditionScope));
  const namedLines = named.map(activeLines);

  // Month-scoped membership is day-invariant — precompute once per month-scoped column to
  // avoid re-matching it on every day. Day-scoped columns are matched per day below.
  const monthMatch: (ReadonlySet<string> | null)[] = named.map((_, i) =>
    scopeOf[i] === "month"
      ? new Set(staff.filter((p) => matchesLines(namedLines[i], p, idsFor("month", p, ""), true)).map((p) => p.id))
      : null,
  );

  // Does named column i show staff p on day d? (render gate + scope-specific rule match)
  const showsOnNamed = (i: number, p: PrintVisStaff, d: string): boolean => {
    if (!isScheduledNonOff(p.id, d)) return false;
    if (scopeOf[i] === "month") return monthMatch[i]!.has(p.id);
    return matchesLines(namedLines[i], p, idsFor("day", p, d), true);
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
  const inResidual = (p: PrintVisStaff, d: string) => !printsIndividually(p.id) && !ownedOnDay.has(`${p.id}:${d}`);

  // Catch-all, per day: the residual — staff scheduled that day who print in no other column (no
  // printed individual column AND owned by no named column that day) — plus whoever matches one of
  // its Include lines, minus whoever matches one of its Exclude lines (card #309). Computed per
  // catch-all column, since each may carry its own lines; a catch-all claims no ownership.
  const catchAllIdsByDate = (c: AggregateColumn): Record<string, string[]> => {
    const lines = activeLines(c);
    const scope = coerceConditionScope(c.conditionScope);
    const byDate: Record<string, string[]> = {};
    for (const d of dates) {
      const list: string[] = [];
      for (const p of staff) {
        if (!isScheduledNonOff(p.id, d)) continue;
        const ids = lines.includes.length + lines.excludes.length > 0 ? idsFor(scope, p, d) : emptyIds;
        if (!inResidual(p, d) && !includedBy(lines, p, ids)) continue;
        if (excludedBy(lines, p, ids)) continue;
        list.push(p.id);
      }
      byDate[d] = list;
    }
    return byDate;
  };

  // Re-assemble in the original input order (named + other interleaved as given).
  const columnsOut: AggregateColumnResult["columns"] = [];
  let ni = 0;
  for (const c of enabled) {
    if (c.isOther) columnsOut.push({ id: c.id, label: c.label, isOther: true, memberIdsByDate: catchAllIdsByDate(c) });
    else columnsOut.push({ id: c.id, label: c.label, isOther: false, memberIdsByDate: namedIdsByDate[ni++] });
  }

  return { columns: columnsOut, suppressedIndividualIds };
}
