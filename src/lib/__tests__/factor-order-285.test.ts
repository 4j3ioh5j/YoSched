// Card #285: a missing "spacing" goes BELOW Over hours too (David's #58), not just below
// Requests (#52): directly after whichever of the two comes later in the list.
import { describe, it, expect } from "vitest";
import { insertSpacing } from "../autogen-factor-order";
import { reconcileOrder } from "../autogen-profile";
import { effectiveFactorKeys, type AutoGenFactorConfig } from "../auto-scheduler";

const LIVE6 = ["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"];
const cfg = (keys: string[]): AutoGenFactorConfig[] => keys.map((key, i) => ({ key, sortOrder: i, enabled: true }));

describe("insertSpacing (card #285)", () => {
  it("Over hours below Requests → spacing directly after Over hours", () => {
    expect(insertSpacing(LIVE6)).toEqual(["hardLimits", "coverage", "underHours", "requests", "overHours", "spacing", "fairness"]);
  });
  it("Requests below Over hours → spacing directly after Requests", () => {
    expect(insertSpacing(["overHours", "coverage", "requests", "fairness"])).toEqual(["overHours", "coverage", "requests", "spacing", "fairness"]);
  });
  it("only Over hours → after it; only Requests → after it; neither → last", () => {
    expect(insertSpacing(["a", "overHours", "b"])).toEqual(["a", "overHours", "spacing", "b"]);
    expect(insertSpacing(["a", "requests", "b"])).toEqual(["a", "requests", "spacing", "b"]);
    expect(insertSpacing(["a", "b"])).toEqual(["a", "b", "spacing"]);
  });
  it("a list that already has spacing is unchanged", () => {
    const k = ["spacing", ...LIVE6];
    expect(insertSpacing(k)).toEqual(k);
  });
});

describe("the engine's old 6-key acceptance (card #285)", () => {
  it("places spacing below Over hours", () => {
    expect(effectiveFactorKeys(cfg(LIVE6))).toEqual(["hardLimits", "coverage", "underHours", "requests", "overHours", "spacing", "fairness"]);
  });
});

describe("applying a saved profile without spacing (card #285)", () => {
  const CATALOG = ["hardLimits", "coverage", "underHours", "requests", "overHours", "spacing", "fairness"];
  it("an old 6-key profile → spacing below its Over hours", () => {
    expect(reconcileOrder(LIVE6, CATALOG)).toEqual(["hardLimits", "coverage", "underHours", "requests", "overHours", "spacing", "fairness"]);
  });
  it("a profile with Over hours but no Requests → spacing after Over hours; missing keys still last", () => {
    expect(reconcileOrder(["overHours", "fairness"], CATALOG)).toEqual(["overHours", "spacing", "fairness", "hardLimits", "coverage", "underHours", "requests"]);
  });
  it("a profile with neither → spacing last, after the other missing keys", () => {
    expect(reconcileOrder(["fairness", "coverage"], CATALOG)).toEqual(["fairness", "coverage", "hardLimits", "underHours", "requests", "overHours", "spacing"]);
  });
});
