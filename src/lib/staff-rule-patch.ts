// Card #206: a staff save sends only the rule lists the page changed, each with the version of
// the copy the page holds (`ruleBases`), so a page loaded before another tab's edit can no longer
// erase that edit. Pure and browser-safe; the server's versions come from staff-rule-versions.ts.
//
// The invariant (Codex #1003): a version is only ever held next to the contents it was computed
// from. After a save, a list the page sent takes the version the server computed for it in the
// same transaction; a list it did not send keeps its old contents AND its old version, even if
// the server reports a newer one. A later edit of that list then carries the old base and is
// refused ("reload") instead of overwriting rules this page never saw.

export const RULE_KEYS = [
  "availabilityRules",
  "shiftEligibilityRules",
  "shiftMinimumTargets",
  "standingCommitments",
  "shiftOverrides",
] as const;

export type RuleKey = (typeof RULE_KEYS)[number];
export type RuleVersions = Partial<Record<RuleKey, string>>;
export type RuleHolder = { [K in RuleKey]: readonly unknown[] } & { ruleVersions: RuleVersions };
export type RulesPatch = { sent: RuleKey[]; lists: Partial<Record<RuleKey, readonly unknown[]>>; ruleBases: RuleVersions };

/** JSON with sorted keys and undefined as null: key order and a missing optional field are no change. */
function canon(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

function patchOf(keys: RuleKey[], from: RuleHolder, bases: RuleVersions): RulesPatch {
  const out: RulesPatch = { sent: [], lists: {}, ruleBases: {} };
  for (const k of keys) {
    out.sent.push(k);
    out.lists[k] = from[k];
    const b = bases[k];
    if (typeof b === "string") out.ruleBases[k] = b;
  }
  return out;
}

/** The lists `edited` changed against the copy the page holds, with the held versions as bases. */
export function rulesPatch<T extends RuleHolder>(edited: T, held: T): RulesPatch {
  return patchOf(RULE_KEYS.filter((k) => canon(edited[k]) !== canon(held[k])), edited, held.ruleVersions);
}

/**
 * Undo of a save: prev's contents for exactly the lists that save sent (its mask), based on the
 * versions that save produced. Never a diff against a refreshed row (that would undo other edits).
 */
export function undoRulesPatch<T extends RuleHolder>(prev: T, saved: T, sent: readonly RuleKey[]): RulesPatch {
  return patchOf(RULE_KEYS.filter((k) => sent.includes(k)), prev, saved.ruleVersions);
}

/**
 * The row the page holds after a successful save: `next`'s other fields; for each list sent,
 * `next`'s contents with the server's version for it; for each list not sent, `held`'s contents
 * and version unchanged. A missing server version leaves that list without one (fails closed).
 */
export function afterRulesSave<T extends RuleHolder>(next: T, held: RuleHolder, sent: readonly RuleKey[], versions: RuleVersions | undefined): T {
  const out = { ...next, ruleVersions: { ...held.ruleVersions } } as T;
  const mut = out as unknown as Record<RuleKey, readonly unknown[]>;
  for (const k of RULE_KEYS) {
    if (sent.includes(k)) {
      const v = versions?.[k];
      if (typeof v === "string") out.ruleVersions[k] = v;
      else delete out.ruleVersions[k];
    } else {
      mut[k] = held[k];
    }
  }
  return out;
}

/** A row without its rule lists and versions: the fields every save sends. */
export function withoutRules<T extends RuleHolder>(row: T): Omit<T, RuleKey | "ruleVersions"> {
  const out: Record<string, unknown> = { ...row };
  for (const k of RULE_KEYS) delete out[k];
  delete out.ruleVersions;
  return out as Omit<T, RuleKey | "ruleVersions">;
}
