// Card #266: old open browser tabs run the engine client-side. The inputs endpoint sends the
// spacing row only to a bundle that says it knows it; an old tab gets the six rows its engine
// honours exactly.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { factorRowsForClient } from "@/lib/autogen-factor-order";
import { effectiveFactorKeys } from "@/lib/auto-scheduler";

const SRC = path.resolve(__dirname, "..");
const read = (p: string) => readFileSync(path.join(SRC, p), "utf8");
const LIVE7 = ["hardLimits", "coverage", "underHours", "requests", "spacing", "overHours", "fairness"].map((key, i) => ({ key, sortOrder: i, enabled: true }));

// The pre-#266 engine's validity rule (auto-scheduler.ts at 5acde0c): honoured only when the config
// is EXACTLY its six known keys, else the default order [hardLimits, coverage, overHours, underHours, requests, fairness].
const OLD_KNOWN = ["hardLimits", "coverage", "overHours", "underHours", "requests", "fairness"];
function oldEngineOrder(config: { key: string; sortOrder: number; enabled: boolean }[]): string[] {
  const keys = new Set(config.map((f) => f.key));
  const valid = config.length === OLD_KNOWN.length && keys.size === config.length && config.every((f) => f.enabled && OLD_KNOWN.includes(f.key));
  return valid ? [...config].sort((a, b) => a.sortOrder - b.sortOrder).map((f) => f.key) : OLD_KNOWN;
}

describe("old-tab bridge for the spacing factor (card #266)", () => {
  it("without the flag the spacing row is omitted, and an old engine honours the live order", () => {
    const rows = factorRowsForClient(LIVE7, null);
    expect(rows.map((r) => r.key)).toEqual(["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"]);
    expect(oldEngineOrder(rows)).toEqual(["hardLimits", "coverage", "underHours", "requests", "overHours", "fairness"]);
    // (the 7 rows would have made the old engine fall back: requests and overHours swap)
    expect(oldEngineOrder(LIVE7)).toEqual(OLD_KNOWN);
  });
  it("with the flag (alone or in a list) all seven rows are sent", () => {
    expect(factorRowsForClient(LIVE7, "spacing")).toHaveLength(7);
    expect(factorRowsForClient(LIVE7, "other, spacing")).toHaveLength(7);
    expect(factorRowsForClient(LIVE7, "other")).toHaveLength(6);
  });
  it("a new tab on a rolled-back server (6 rows) keeps the live order with spacing after requests", () => {
    expect(effectiveFactorKeys(factorRowsForClient(LIVE7, null))).toEqual(LIVE7.map((r) => r.key));
  });
  it("the route filters by the flag and the Live grid sends it", () => {
    expect(read("api/auto-schedule/inputs/route.ts")).toContain("factorRowsForClient(input.factorOrder, req.nextUrl.searchParams.get(SPACING_CAPABILITY_PARAM))");
    expect(read("schedule-grid.tsx")).toContain("/api/auto-schedule/inputs?start=${dates[0]}&end=${dates[dates.length - 1]}&factors=spacing");
  });
});
