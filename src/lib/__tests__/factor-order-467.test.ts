// Card #467: "Long weekends off" and "Even OR staffing across days" join the priority list,
// appended at the bottom in that order. A legacy six-row order (a DB before the migration, an
// inputs response without the new rows) keeps its custom order and gains both new keys.
import { describe, it, expect } from "vitest";
import { DEFAULT_FACTOR_ORDER, effectiveFactorKeys, type AutoGenFactorConfig } from "../auto-scheduler";

const LIVE6 = ["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"];
const cfg = (keys: string[], disabled: string[] = []): AutoGenFactorConfig[] =>
  keys.map((key, i) => ({ key, sortOrder: i, enabled: !disabled.includes(key) }));

describe("the two new bottom factors (card #467)", () => {
  it("the default order ends with longWeekends then dayBalance", () => {
    expect([...DEFAULT_FACTOR_ORDER].slice(-2)).toEqual(["longWeekends", "dayBalance"]);
    expect(DEFAULT_FACTOR_ORDER.length).toBe(8);
  });
  it("a legacy six-row custom order gains both new keys without falling back", () => {
    expect(effectiveFactorKeys(cfg(LIVE6))).toEqual([...LIVE6, "longWeekends", "dayBalance"]);
  });
  it("a seven-row order missing one new key gains it at the bottom", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "dayBalance"]))).toEqual([...LIVE6, "dayBalance", "longWeekends"]);
    expect(effectiveFactorKeys(cfg([...LIVE6, "longWeekends"]))).toEqual([...LIVE6, "longWeekends", "dayBalance"]);
  });
  it("the full eight honor the configured order, either way round", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "longWeekends", "dayBalance"]))).toEqual([...LIVE6, "longWeekends", "dayBalance"]);
    expect(effectiveFactorKeys(cfg([...LIVE6, "dayBalance", "longWeekends"]))).toEqual([...LIVE6, "dayBalance", "longWeekends"]);
    expect(effectiveFactorKeys(cfg(["dayBalance", ...LIVE6, "longWeekends"]))).toEqual(["dayBalance", ...LIVE6, "longWeekends"]);
  });
  it("a stale spacing row is still ignored", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "spacing", "longWeekends", "dayBalance"]))).toEqual([...LIVE6, "longWeekends", "dayBalance"]);
  });
  it("missing original, unknown, duplicate or disabled keys still fall back", () => {
    const def = [...DEFAULT_FACTOR_ORDER];
    expect(effectiveFactorKeys(cfg([...LIVE6.slice(0, 5), "longWeekends", "dayBalance"]))).toEqual(def);
    expect(effectiveFactorKeys(cfg([...LIVE6, "bogus"]))).toEqual(def);
    expect(effectiveFactorKeys(cfg([...LIVE6, "dayBalance", "dayBalance"]))).toEqual(def);
    expect(effectiveFactorKeys(cfg([...LIVE6, "longWeekends", "dayBalance"], ["dayBalance"]))).toEqual(def);
  });
});
