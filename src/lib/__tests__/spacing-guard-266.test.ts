// Card #266: a spacing trial is eligible only if no single item of a factor ranked above spacing
// is worse than in the ORIGINAL off run. Totals don't protect individuals (Codex #1237), and the
// graded coverage / requests terms carry waivers, so the raw forms are guarded too (Codex #1261).
import { describe, it, expect } from "vitest";
import { spacingGuardBlocks, type QualityItems } from "../auto-scheduler";

const items = (o: Partial<QualityItems> = {}): QualityItems => ({
  coverage: new Map(), coverageRaw: new Map(), hardLimits: new Map(), overHours: new Map(), underHours: new Map(),
  requestsHonoured: new Set(), fairness: 0, spacingUnits: new Map(), ...o,
});
const LIVE_ABOVE = ["underHours", "hardLimits", "coverage", "requests"]; // live: underHours Prohibited first

describe("spacingGuardBlocks (card #266)", () => {
  it("shortage moved between people with an equal total (80/72 → 72/80) is blocked", () => {
    const off = items({ underHours: new Map([["b|pp1", 8]]) });          // A 80, B 72
    const cand = items({ underHours: new Map([["a|pp1", 8]]) });         // A 72, B 80
    expect(spacingGuardBlocks(cand, off, LIVE_ABOVE)).toBe("underHours");
  });
  it("the same person less under is fine", () => {
    const off = items({ underHours: new Map([["b|pp1", 8]]) });
    expect(spacingGuardBlocks(items({ underHours: new Map([["b|pp1", 4]]) }), off, LIVE_ABOVE)).toBeNull();
  });
  it("coverage moved from one day to another is blocked", () => {
    const off = items({ coverage: new Map([["2027-02-01|or", 1]]), coverageRaw: new Map([["2027-02-01|or", 1]]) });
    const cand = items({ coverage: new Map([["2027-02-02|or", 1]]), coverageRaw: new Map([["2027-02-02|or", 1]]) });
    expect(spacingGuardBlocks(cand, off, LIVE_ABOVE)).toBe("coverage");
  });
  it("a RAW shortfall the graded term waives (locked leave) is still blocked", () => {
    const cand = items({ coverageRaw: new Map([["2027-02-03|orl", 1], ["2027-02-10|orl", 1]]) }); // graded coverage 0
    expect(spacingGuardBlocks(cand, items(), LIVE_ABOVE)).toBe("coverage");
  });
  it("a requested day honoured in off and denied in the trial is blocked (any strength)", () => {
    const off = items({ requestsHonoured: new Set(["req-soft|2027-02-04", "req-a|2027-02-05"]) });
    const swapped = items({ requestsHonoured: new Set(["req-a|2027-02-05", "req-b|2027-02-05"]) });
    expect(spacingGuardBlocks(swapped, off, LIVE_ABOVE)).toBe("requests");
    expect(spacingGuardBlocks(items({ requestsHonoured: new Set(["req-soft|2027-02-04", "req-a|2027-02-05", "x|2027-02-06"]) }), off, LIVE_ABOVE)).toBeNull();
  });
  it("a hard target item worse is blocked", () => {
    expect(spacingGuardBlocks(items({ hardLimits: new Map([["a|0|max", 1]]) }), items(), LIVE_ABOVE)).toBe("hardLimits");
  });
  it("factors ranked below spacing are not guarded (overHours and fairness in the live order)", () => {
    const cand = items({ overHours: new Map([["a|pp1", 4]]), fairness: 3 });
    expect(spacingGuardBlocks(cand, items(), LIVE_ABOVE)).toBeNull();
    expect(spacingGuardBlocks(cand, items(), [...LIVE_ABOVE, "overHours"])).toBe("overHours");
    expect(spacingGuardBlocks(items({ fairness: 3 }), items({ fairness: 2 }), ["fairness"])).toBe("fairness");
  });
  it("the first blocking factor in rank order is named", () => {
    const cand = items({ underHours: new Map([["a|pp1", 1]]), coverage: new Map([["d|s", 1]]) });
    expect(spacingGuardBlocks(cand, items(), ["coverage", "underHours"])).toBe("coverage");
  });
});
