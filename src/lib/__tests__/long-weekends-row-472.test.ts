// Card #472 (release (a2) of card #467): a "longWeekends" factor row that this build does not yet
// grade is dropped like the pending dayBalance row (card #471), so the six known factors keep
// their configured order instead of the whole order falling back to the default.
import { describe, it, expect } from "vitest";
import { DEFAULT_FACTOR_ORDER, autoSchedule, effectiveFactorKeys, type AutoGenFactorConfig } from "../auto-scheduler";
import { fixture } from "./engine-266-fixture";

const LIVE6 = ["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"];
const cfg = (keys: string[], disabled: string[] = []): AutoGenFactorConfig[] =>
  keys.map((key, i) => ({ key, sortOrder: i, enabled: !disabled.includes(key) }));

describe("a not-yet-known long-weekends row (card #472)", () => {
  it("the six known rows keep their order with longWeekends and dayBalance appended", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "longWeekends"]))).toEqual(LIVE6);
    expect(effectiveFactorKeys(cfg([...LIVE6, "longWeekends", "dayBalance"]))).toEqual(LIVE6);
    expect(effectiveFactorKeys(cfg([...LIVE6, "dayBalance", "longWeekends"]))).toEqual(LIVE6);
  });
  it("is ignored enabled or not, wherever it sits", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "longWeekends"], ["longWeekends"]))).toEqual(LIVE6);
    expect(effectiveFactorKeys(cfg(["longWeekends", ...LIVE6]))).toEqual(LIVE6);
  });
  it("does not excuse a missing or unknown key", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6.slice(0, 5), "longWeekends"]))).toEqual([...DEFAULT_FACTOR_ORDER]);
    expect(effectiveFactorKeys(cfg([...LIVE6, "longWeekends", "bogus"]))).toEqual([...DEFAULT_FACTOR_ORDER]);
  });
  it("a run with both rows grades on six terms", () => {
    const r = autoSchedule({ ...fixture(), factorOrder: cfg([...LIVE6, "longWeekends", "dayBalance"]) });
    expect(Object.keys(r.quality.breakdown)).not.toContain("longWeekends");
    expect(r.quality.rank.length).toBe(6);
  });
});
