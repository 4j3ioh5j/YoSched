// Card #471 (release (a) of card #467): a "dayBalance" factor row that this build does not yet
// grade (a DB migrated by a later release, then rolled back; an old tab's input) is dropped like
// the retired spacing row, so the six known factors keep their configured order instead of the
// whole order falling back to the default.
import { describe, it, expect } from "vitest";
import { DEFAULT_FACTOR_ORDER, autoSchedule, effectiveFactorKeys, type AutoGenFactorConfig } from "../auto-scheduler";
import { fixture } from "./engine-266-fixture";

const LIVE6 = ["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"];
const cfg = (keys: string[], disabled: string[] = []): AutoGenFactorConfig[] =>
  keys.map((key, i) => ({ key, sortOrder: i, enabled: !disabled.includes(key) }));

describe("a not-yet-known day-balance row (card #471)", () => {
  it("the six known rows keep their configured order with dayBalance appended last", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "dayBalance"]))).toEqual(LIVE6);
  });
  it("is ignored enabled or not, wherever it sits", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "dayBalance"], ["dayBalance"]))).toEqual(LIVE6);
    expect(effectiveFactorKeys(cfg(["dayBalance", ...LIVE6]))).toEqual(LIVE6);
  });
  it("is ignored alongside a stale spacing row", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "spacing", "dayBalance"]))).toEqual(LIVE6);
  });
  it("does not excuse a missing or unknown key: those still fall back to the default", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6.slice(0, 5), "dayBalance"]))).toEqual([...DEFAULT_FACTOR_ORDER]);
    expect(effectiveFactorKeys(cfg([...LIVE6, "dayBalance", "bogus"]))).toEqual([...DEFAULT_FACTOR_ORDER]);
  });
  it("a disabled known factor still falls back even with dayBalance present", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "dayBalance"], ["fairness"]))).toEqual([...DEFAULT_FACTOR_ORDER]);
  });
  it("a run with the row grades on six terms in the configured order", () => {
    const r = autoSchedule({ ...fixture(), factorOrder: cfg([...LIVE6, "dayBalance"]) });
    expect(Object.keys(r.quality.breakdown)).not.toContain("dayBalance");
    expect(r.quality.rank.length).toBe(6);
  });
});
