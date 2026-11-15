// Card #206: the version of each of a staff member's rule lists is a hash of its rows over
// exactly the columns PUT /api/staff writes, independent of row order and of ids. Server only.
import { createHash } from "node:crypto";
import { RULE_KEYS, type RuleKey, type RuleVersions } from "./staff-rule-patch";

const WHEN = ["whenKind", "whenDays", "whenPpWeek", "whenOrds", "whenCycleUnit", "whenCycleN", "whenCycleOffset"];

/** The columns PUT writes for each list (everything but id and staffId). */
export const RULE_COLUMNS: Readonly<Record<RuleKey, readonly string[]>> = Object.freeze({
  availabilityRules: ["type", "strength", "conditionStaffId", "conditionType", ...WHEN],
  shiftEligibilityRules: ["shiftTypeId", "type", "strength", ...WHEN],
  shiftMinimumTargets: ["shiftTypeId", "minCount", "maxCount", "window", "windowDays", "windowCount", "strength"],
  standingCommitments: ["shiftTypeId", "notes", ...WHEN],
  shiftOverrides: ["shiftTypeId", "durationHrs", "durationHrsWeekday", "durationHrsWeekend", "durationHrsHoliday"],
});

/** A Prisma `select` of the written columns of a list. */
export function ruleSelect(key: RuleKey): Record<string, true> {
  return Object.fromEntries(RULE_COLUMNS[key].map((c) => [c, true]));
}

function rowKey(key: RuleKey, row: Record<string, unknown>): string {
  return JSON.stringify(RULE_COLUMNS[key].map((c) => row[c] ?? null));
}

export function ruleListVersion(key: RuleKey, rows: readonly Record<string, unknown>[]): string {
  const lines = rows.map((r) => rowKey(key, r)).sort();
  return createHash("sha256").update(`${key}\n${rows.length}\n${lines.join("\n")}`).digest("hex").slice(0, 32);
}

export function ruleVersionsOf(row: Partial<Record<RuleKey, readonly Record<string, unknown>[]>>): RuleVersions {
  const out: RuleVersions = {};
  for (const k of RULE_KEYS) { const l = row[k]; if (Array.isArray(l)) out[k] = ruleListVersion(k, l); }
  return out;
}

export { RULE_KEYS };

/** First key of the per-person advisory lock (the second is hashtext(staff id)). */
export const STAFF_RULES_LOCK_CLASS = 206_206;
