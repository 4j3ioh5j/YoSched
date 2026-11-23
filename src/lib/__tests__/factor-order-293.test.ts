// Card #293: the Spacing factor and its trial are gone. A stale "spacing" row (a DB not yet
// migrated, an old tab's input, a rollback's re-added row) is ignored: the other six keep their
// configured order instead of falling back to the default. Saved profiles that hold "spacing"
// drop it when applied.
import { describe, it, expect } from "vitest";
import { reconcileOrder } from "../autogen-profile";
import { DEFAULT_FACTOR_ORDER, autoSchedule, effectiveFactorKeys, type AutoGenFactorConfig } from "../auto-scheduler";
import { fixture } from "./engine-266-fixture";

const LIVE6 = ["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"];
// Card #467: a six-row order gains the two lowest factors at the bottom.
const LIVE8 = [...LIVE6, "longWeekends", "dayBalance"];
const LIVE7 = ["hardLimits", "coverage", "underHours", "requests", "overHours", "spacing", "fairness"];
const cfg = (keys: string[], disabled: string[] = []): AutoGenFactorConfig[] =>
  keys.map((key, i) => ({ key, sortOrder: i, enabled: !disabled.includes(key) }));

describe("the factor order without Spacing (card #293)", () => {
  it("the default order has eight factors (card #467) and no spacing", () => {
    expect([...DEFAULT_FACTOR_ORDER]).not.toContain("spacing");
    expect(DEFAULT_FACTOR_ORDER.length).toBe(8);
  });
  it("the live six rows keep their order", () => {
    expect(effectiveFactorKeys(cfg(LIVE6))).toEqual(LIVE8);
  });
  it("a stale seventh spacing row is ignored, enabled or not, wherever it sits", () => {
    expect(effectiveFactorKeys(cfg(LIVE7))).toEqual(LIVE8);
    expect(effectiveFactorKeys(cfg(LIVE7, ["spacing"]))).toEqual(LIVE8);
    expect(effectiveFactorKeys(cfg(["spacing", ...LIVE6]))).toEqual(LIVE8);
  });
  it("an unknown key other than spacing still falls back to the default", () => {
    expect(effectiveFactorKeys(cfg([...LIVE6, "bogus"]))).toEqual([...DEFAULT_FACTOR_ORDER]);
  });
  it("the quality has no spacing term and its rank has one entry per factor", () => {
    const r = autoSchedule({ ...fixture(), factorOrder: cfg(LIVE7) });
    expect(Object.keys(r.quality.breakdown)).not.toContain("spacing");
    expect(r.quality.rank.length).toBe(8);
  });
});

describe("applying a saved profile that holds spacing (card #293)", () => {
  it("drops spacing and keeps the rest in the saved order", () => {
    expect(reconcileOrder(LIVE7, LIVE6)).toEqual(LIVE6);
    expect(reconcileOrder(["spacing", "fairness", ...LIVE6.slice(0, 5)], LIVE6)).toEqual(["fairness", ...LIVE6.slice(0, 5)]);
  });
});
