// Card #266: the "spacing" factor sits after requests (and, card #285, after overHours). One helper places it for both the
// engine's old-6-key acceptance and applying a saved profile.
import { describe, it, expect } from "vitest";
import { insertSpacing } from "../autogen-factor-order";
import { reconcileOrder } from "../autogen-profile";
import { effectiveFactorKeys, DEFAULT_FACTOR_ORDER, type AutoGenFactorConfig } from "../auto-scheduler";
import { FACTOR_META } from "../autogen-priority";

const LIVE6 = ["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"];
const cfg = (keys: string[], o: Partial<Record<string, Partial<AutoGenFactorConfig>>> = {}): AutoGenFactorConfig[] =>
  keys.map((key, i) => ({ key, sortOrder: i, enabled: true, ...(o[key] ?? {}) }));

// insertSpacing itself: factor-order-285.test.ts (below Over hours too, David's #58).

describe("effectiveFactorKeys with spacing (card #266)", () => {
  it("the default order has spacing after requests", () => {
    expect([...DEFAULT_FACTOR_ORDER]).toEqual(["hardLimits", "coverage", "overHours", "underHours", "requests", "spacing", "fairness"]);
  });
  it("honours a 7-key config exactly", () => {
    const k = ["spacing", "hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"];
    expect(effectiveFactorKeys(cfg(k))).toEqual(k);
  });
  it("the old exact 6-key set keeps its order with spacing inserted below requests and overHours (#285)", () => {
    expect(effectiveFactorKeys(cfg(LIVE6))).toEqual(["hardLimits", "coverage", "underHours", "requests", "overHours", "spacing", "fairness"]);
  });
  it("Prohibited hours still move first, on the 6-key set too", () => {
    expect(effectiveFactorKeys(cfg(LIVE6, { underHours: { hoursPolicy: "prohibited" } }))).toEqual(["underHours", "hardLimits", "coverage", "requests", "overHours", "spacing", "fairness"]);
  });
  it.each([
    ["a 6-key set missing another key", ["hardLimits", "coverage", "underHours", "requests", "spacing", "fairness"]],
    ["an unknown key", [...LIVE6, "bogus"]],
    ["a duplicate", [...LIVE6, "requests"]],
    ["5 keys", LIVE6.slice(0, 5)],
  ])("falls back on %s", (_n, keys) => {
    expect(effectiveFactorKeys(cfg(keys))).toEqual([...DEFAULT_FACTOR_ORDER]);
  });
  it("falls back when a key of the 6-key set is disabled", () => {
    expect(effectiveFactorKeys(cfg(LIVE6, { fairness: { enabled: false } }))).toEqual([...DEFAULT_FACTOR_ORDER]);
  });
});

describe("reconcileOrder places a missing spacing below the profile's requests and overHours (cards #266, #285)", () => {
  const LIVE7 = insertSpacing(LIVE6);
  it("an old 6-key profile → spacing below its requests and overHours", () => {
    const old = ["coverage", "hardLimits", "requests", "underHours", "overHours", "fairness"];
    expect(reconcileOrder(old, LIVE7)).toEqual(["coverage", "hardLimits", "requests", "underHours", "overHours", "spacing", "fairness"]);
  });
  it("requests and overHours absent from the profile → spacing last; other missing keys still appended last", () => {
    expect(reconcileOrder(["fairness", "coverage"], LIVE7)).toEqual(["fairness", "coverage", "hardLimits", "underHours", "requests", "overHours", "spacing"]);
  });
  it("a catalog without spacing is unchanged behaviour", () => {
    expect(reconcileOrder(["fairness"], LIVE6)).toEqual(["fairness", "hardLimits", "coverage", "underHours", "requests", "overHours"]);
  });
});

it("FACTOR_META has a spacing entry", () => {
  expect(FACTOR_META.spacing?.label).toBe("Spacing between the same shift");
});
