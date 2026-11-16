// Card #309: the rule lines of a printed aggregate column ("Other" and the like). Each line is
// Include or Exclude; a person is listed when they match any Include line and no Exclude line
// (matching lives in print-aggregate-columns.ts). This file is the save/read side: validate a
// payload, coerce the stored JSON, build the client payload, and mirror a simple line set into
// the old single-rule fields so a code rollback still prints something sensible. Pure.

import { coerceConditions, hasSelector, type PrintRule } from "@/lib/print-column-visibility";
import { buildConditionsSave, deriveConditionCodes, parseConditionsIn } from "@/lib/print-conditions";
import { effectiveCriteria, isInertLine, type CriteriaLine } from "@/lib/print-aggregate-columns";

export type { CriteriaLine };

export const MAX_CRITERIA_LINES = 50;

export type CriteriaParse =
  | { ok: true; criteria: CriteriaLine[] }
  | { ok: false; status: 400 | 409; body: { error: string; reason: string; shiftTypeId?: string; staffId?: string } };

const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** Stored JSON → lines, as the readers need them. Not an array (NULL: a row from before card
 *  #309) → null, which effectiveCriteria turns into the old single rule. Malformed entries are
 *  dropped; an unknown mode is read as "include". */
export function coerceCriteria(value: unknown): CriteriaLine[] | null {
  if (!Array.isArray(value)) return null;
  const out: CriteriaLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const fte = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    out.push({
      mode: o.mode === "exclude" ? "exclude" : "include",
      employmentTypeIds: strArr(o.employmentTypeIds),
      minFtePercentage: fte(o.minFtePercentage),
      maxFtePercentage: fte(o.maxFtePercentage),
      conditions: coerceConditions(o.conditions),
      staffIds: strArr(o.staffIds),
    });
  }
  return out;
}

/** Lines with the shifts' current codes beside the ids, for the Settings screen. */
export function deriveCriteriaCodes(lines: readonly CriteriaLine[], shiftTypes: readonly { id: string; code: string }[]) {
  return lines.map((l) => ({ ...l, conditions: deriveConditionCodes(l.conditions, shiftTypes) }));
}

/** Server-side check of a save payload's lines. Every shift id goes through parseConditionsIn
 *  (a code → 409 stale tab; an unknown id → 400); FTE bounds are numbers with min ≤ max. Lines
 *  with nothing set are dropped. At most MAX_CRITERIA_LINES.
 *  People are ids from the Settings picker. One who has been removed since is KEPT: such an id
 *  matches nobody, so the line still means what it meant (an Include line naming only removed
 *  people lists nobody, rather than being dropped and the column falling back to everyone), and
 *  a restored person (same id) is matched again. */
export function parseCriteriaIn(
  value: unknown,
  shifts: { ids: ReadonlySet<string>; codes: ReadonlySet<string> },
  where: string,
): CriteriaParse {
  const bad = (error: string, reason: string, extra: { staffId?: string } = {}): CriteriaParse =>
    ({ ok: false, status: 400, body: { error, reason, ...extra } });
  if (value == null) return { ok: true, criteria: [] };
  if (!Array.isArray(value)) return bad(`${where}: rules must be a list`, "bad-request");
  if (value.length > MAX_CRITERIA_LINES) return bad(`${where}: at most ${MAX_CRITERIA_LINES} rules per column`, "too-many");
  const out: CriteriaLine[] = [];
  for (const [i, item] of value.entries()) {
    const at = `${where}, rule ${i + 1}`;
    if (!item || typeof item !== "object") return bad(`${at} is not an object`, "bad-request");
    const o = item as Record<string, unknown>;
    if (o.mode !== "include" && o.mode !== "exclude") return bad(`${at}: must be Include or Exclude`, "bad-request");
    for (const key of ["employmentTypeIds", "staffIds"] as const) {
      if (o[key] == null) continue;
      if (!Array.isArray(o[key]) || (o[key] as unknown[]).some((x) => typeof x !== "string" || !x)) {
        return bad(`${at}: ${key} must be a list of ids`, "bad-request");
      }
    }
    const people = strArr(o.staffIds);
    const seen = new Set<string>();
    for (const id of people) {
      if (seen.has(id)) return bad(`${at}: a person is listed twice`, "duplicate", { staffId: id });
      seen.add(id);
    }
    const fte = (v: unknown): number | null | undefined => {
      if (v == null || v === "") return null;
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    const min = fte(o.minFtePercentage);
    const max = fte(o.maxFtePercentage);
    if (min === undefined || max === undefined) return bad(`${at}: FTE must be a number`, "bad-request");
    if (min != null && max != null && min > max) return bad(`${at}: FTE min is above FTE max`, "bad-request");
    const conds = parseConditionsIn(o.conditions, shifts, at);
    if (!conds.ok) return conds;
    const line: CriteriaLine = {
      mode: o.mode,
      employmentTypeIds: strArr(o.employmentTypeIds),
      minFtePercentage: min,
      maxFtePercentage: max,
      conditions: conds.conditions,
      staffIds: people,
    };
    if (!isInertLine(line)) out.push(line);
  }
  return { ok: true, criteria: out };
}

type LegacyRule = Pick<PrintRule, "employmentTypeIds" | "minFtePercentage" | "maxFtePercentage" | "conditions">;

/** The old single-rule fields for these lines, or null when the old rule cannot express them
 *  (people named, an Exclude line, or several lines): the caller then leaves the stored fields as
 *  they are, so a code rollback prints that column by its rule from before the change. */
export function legacyMirror(lines: readonly CriteriaLine[]): LegacyRule | null {
  if (lines.length === 0) return { employmentTypeIds: [], minFtePercentage: null, maxFtePercentage: null, conditions: [] };
  if (lines.length > 1) return null;
  const [l] = lines;
  if (l.mode !== "include" || l.staffIds.length > 0) return null;
  return { employmentTypeIds: [...l.employmentTypeIds], minFtePercentage: l.minFtePercentage, maxFtePercentage: l.maxFtePercentage, conditions: l.conditions };
}

/** The client's save payload: ids only (no shift codes) and no line with nothing set. People
 *  are sent as they are, removed ones included (see parseCriteriaIn). */
export function buildCriteriaSave(lines: readonly CriteriaLine[]): CriteriaLine[] {
  const out: CriteriaLine[] = [];
  for (const l of lines) {
    const staffIds = [...new Set(l.staffIds)];
    const line: CriteriaLine = {
      mode: l.mode === "exclude" ? "exclude" : "include",
      employmentTypeIds: [...l.employmentTypeIds],
      minFtePercentage: l.minFtePercentage,
      maxFtePercentage: l.maxFtePercentage,
      conditions: buildConditionsSave(l.conditions),
      staffIds,
    };
    if (!isInertLine(line)) out.push(line);
  }
  return out;
}

type StoredColumn = {
  label: string; isOther: boolean; employmentTypeIds: string[]; minFtePercentage: number | null; maxFtePercentage: number | null;
  conditions: unknown; conditionScope: string; criteria: unknown; criteriaBase: unknown;
};

/** A stored row as the API returns it: the old fields as they are (an old tab still reads them),
 *  conditions with the shifts' current codes, and `criteria` = its EFFECTIVE rule lines (a row
 *  from before card #309 shows its single rule as one Include line). */
export function aggregateColumnOut<T extends StoredColumn>(c: T, shiftTypes: readonly { id: string; code: string }[]) {
  const conditions = coerceConditions(c.conditions);
  const criteria = effectiveCriteria({ ...c, enabled: true, suppressMembers: false, conditions, criteria: liveCriteria(c) });
  return { ...c, conditions: deriveConditionCodes(conditions, shiftTypes), criteria: deriveCriteriaCodes(criteria, shiftTypes) };
}

type LegacyFields = { isOther: boolean; conditionScope: string; employmentTypeIds: string[]; minFtePercentage: number | null; maxFtePercentage: number | null; conditions: unknown };

/** The old single-rule fields in a comparable form: ids sorted (they are sets), conditions read
 *  as every reader reads them. Stored as criteriaBase when the lines are written. */
export function legacySnapshot(r: LegacyFields) {
  const sorted = (a: readonly string[]) => [...a].sort();
  return {
    isOther: r.isOther,
    conditionScope: r.conditionScope === "day" ? "day" : "month",
    employmentTypeIds: sorted(r.employmentTypeIds),
    minFtePercentage: r.minFtePercentage,
    maxFtePercentage: r.maxFtePercentage,
    conditions: coerceConditions(r.conditions).filter(hasSelector).map((c) => ({
      quantifier: c.quantifier, categories: sorted(c.categories), shiftTypeIds: sorted(c.shiftTypeIds), exceptIds: sorted(c.exceptIds),
    })),
  };
}

/** The rule lines that apply to a stored row: its lines, unless its old single-rule fields have
 *  changed since the lines were written (a server from before the lines saved it during a
 *  rollback) or the row has no lines at all. Then null: the single rule applies. */
export function liveCriteria(r: LegacyFields & { criteria: unknown; criteriaBase: unknown }): CriteriaLine[] | null {
  const lines = coerceCriteria(r.criteria);
  if (lines === null) return null;
  return canonicalJson(legacySnapshot(r)) === canonicalJson(r.criteriaBase ?? null) ? lines : null;
}

/** JSON with object keys sorted at every level. PostgreSQL jsonb does not keep key order (it
 *  stores keys by length, then bytes), so a value read back from the database must never be
 *  compared with plain JSON.stringify (Codex REVIEW #1478). Array order is kept: it is data. */
export function canonicalJson(v: unknown): string {
  const norm = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(norm);
    if (!x || typeof x !== "object") return x;
    const o = x as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().map((k) => [k, norm(o[k])]));
  };
  return JSON.stringify(norm(v));
}
