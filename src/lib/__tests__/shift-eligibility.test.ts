import { describe, it, expect } from "vitest";
import {
  evaluateShiftEligibility,
  getWindowBounds,
  checkMinimumTargetMet,
  countInWindow,
  type ShiftEligibilityRule,
  type ShiftMinTarget,
} from "../shift-eligibility";

const PP = [
  { startDate: "2025-05-11", endDate: "2025-05-24" },
  { startDate: "2025-05-25", endDate: "2025-06-07" },
  { startDate: "2025-06-08", endDate: "2025-06-21" },
];

function rule(shiftTypeId: string, dayOfWeek: number, overrides: Partial<ShiftEligibilityRule> = {}): ShiftEligibilityRule {
  return {
    shiftTypeId,
    dayOfWeek,
    type: "eligible",
    strength: "rule",
    pattern: "every",
    ...overrides,
  };
}

describe("evaluateShiftEligibility", () => {
  it("returns null when no rules exist for the shift type", () => {
    const rules = [rule("st-other", 1)];
    expect(evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP)).toBeNull();
  });

  it("returns null for empty rules", () => {
    expect(evaluateShiftEligibility([], "st-or", "2025-05-12", PP)).toBeNull();
  });

  it("returns ineligible when rules exist for shift but none match day of week", () => {
    const rules = [rule("st-or", 3)]; // Wednesday only
    // 2025-05-12 is Monday
    const result = evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP);
    expect(result).toEqual({ eligible: false, weight: 0 });
  });

  it("returns eligible when hard rule matches", () => {
    const rules = [rule("st-or", 1)]; // Monday
    const result = evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP);
    expect(result!.eligible).toBe(true);
    expect(result!.weight).toBeGreaterThanOrEqual(10);
  });

  it("hard ineligible overrides hard eligible", () => {
    const rules = [
      rule("st-or", 1, { type: "eligible" }),
      rule("st-or", 1, { type: "ineligible" }),
    ];
    const result = evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP);
    expect(result!.eligible).toBe(false);
    expect(result!.weight).toBe(-10);
  });

  it("preferences accumulate weight", () => {
    const rules = [
      rule("st-or", 1, { strength: "preference" }),
      rule("st-or", 1, { strength: "preference" }),
    ];
    const result = evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP);
    expect(result!.eligible).toBe(true);
    expect(result!.weight).toBe(2);
  });

  it("negative preference weight means ineligible", () => {
    const rules = [
      rule("st-or", 1, { type: "ineligible", strength: "preference" }),
    ];
    const result = evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP);
    expect(result!.eligible).toBe(false);
    expect(result!.weight).toBe(-1);
  });

  describe("patterns", () => {
    it("pp_week_1 matches only first week", () => {
      const rules = [rule("st-or", 1, { pattern: "pp_week_1" })];
      // 2025-05-12 = Monday week 1 of PP
      const w1 = evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP);
      expect(w1!.eligible).toBe(true);
      // 2025-05-19 = Monday week 2
      const w2 = evaluateShiftEligibility(rules, "st-or", "2025-05-19", PP);
      expect(w2!.eligible).toBe(false);
    });

    it("pp_week_2 matches only second week", () => {
      const rules = [rule("st-or", 1, { pattern: "pp_week_2" })];
      const w1 = evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP);
      expect(w1!.eligible).toBe(false);
      const w2 = evaluateShiftEligibility(rules, "st-or", "2025-05-19", PP);
      expect(w2!.eligible).toBe(true);
    });

    it("every_n with cycleLength=2 matches every other PP week", () => {
      const rules = [rule("st-or", 1, { pattern: "every_n", cycleLength: 2, cycleOffset: 0 })];
      // PP 0, week 1 → occurrence 0 → 0%2=0 → match
      expect(evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP)!.eligible).toBe(true);
      // PP 0, week 2 → occurrence 1 → 1%2=1 → no match
      expect(evaluateShiftEligibility(rules, "st-or", "2025-05-19", PP)!.eligible).toBe(false);
      // PP 1, week 1 → occurrence 2 → 2%2=0 → match
      expect(evaluateShiftEligibility(rules, "st-or", "2025-05-26", PP)!.eligible).toBe(true);
    });
  });

  it("only evaluates rules for the requested shift type", () => {
    const rules = [
      rule("st-or", 1, { type: "eligible" }),
      rule("st-card", 1, { type: "ineligible" }),
    ];
    const orResult = evaluateShiftEligibility(rules, "st-or", "2025-05-12", PP);
    expect(orResult!.eligible).toBe(true);
    const cardResult = evaluateShiftEligibility(rules, "st-card", "2025-05-12", PP);
    expect(cardResult!.eligible).toBe(false);
  });
});

describe("getWindowBounds", () => {
  const target = (window: ShiftMinTarget["window"], windowDays?: number): ShiftMinTarget => ({
    shiftTypeId: "st-or",
    minCount: 2,
    window,
    windowDays,
  });

  describe("pay_period", () => {
    it("returns PP bounds for date within a PP", () => {
      const bounds = getWindowBounds(target("pay_period"), "2025-05-15", PP);
      expect(bounds).toEqual({ start: "2025-05-11", end: "2025-05-24" });
    });

    it("returns null for date outside all PPs", () => {
      const bounds = getWindowBounds(target("pay_period"), "2025-01-01", PP);
      expect(bounds).toBeNull();
    });
  });

  describe("week", () => {
    it("returns Mon-Sun bounds for a Wednesday", () => {
      // 2025-05-14 is Wednesday
      const bounds = getWindowBounds(target("week"), "2025-05-14", PP);
      expect(bounds).toEqual({ start: "2025-05-12", end: "2025-05-18" });
    });

    it("returns Mon-Sun bounds for a Monday", () => {
      const bounds = getWindowBounds(target("week"), "2025-05-12", PP);
      expect(bounds).toEqual({ start: "2025-05-12", end: "2025-05-18" });
    });

    it("returns Mon-Sun bounds for a Sunday", () => {
      // 2025-05-18 is Sunday
      const bounds = getWindowBounds(target("week"), "2025-05-18", PP);
      expect(bounds).toEqual({ start: "2025-05-12", end: "2025-05-18" });
    });
  });

  describe("month", () => {
    it("returns first and last day of the month", () => {
      const bounds = getWindowBounds(target("month"), "2025-05-15", PP);
      expect(bounds).toEqual({ start: "2025-05-01", end: "2025-05-31" });
    });

    it("handles February correctly", () => {
      const bounds = getWindowBounds(target("month"), "2025-02-15", PP);
      expect(bounds).toEqual({ start: "2025-02-01", end: "2025-02-28" });
    });

    it("handles leap year February", () => {
      const bounds = getWindowBounds(target("month"), "2024-02-15", PP);
      expect(bounds).toEqual({ start: "2024-02-01", end: "2024-02-29" });
    });
  });

  describe("days", () => {
    it("returns window of N days from the given date", () => {
      const bounds = getWindowBounds(target("days", 7), "2025-05-12", PP);
      expect(bounds).toEqual({ start: "2025-05-12", end: "2025-05-18" });
    });

    it("returns null for missing windowDays", () => {
      const bounds = getWindowBounds(target("days"), "2025-05-12", PP);
      expect(bounds).toBeNull();
    });
  });
});

describe("checkMinimumTargetMet", () => {
  const target: ShiftMinTarget = { shiftTypeId: "st-or", minCount: 3, window: "pay_period" };

  it("returns met=true when count meets minimum", () => {
    const result = checkMinimumTargetMet(target, ["2025-05-12", "2025-05-13", "2025-05-14"]);
    expect(result).toEqual({ met: true, current: 3, needed: 3 });
  });

  it("returns met=true when count exceeds minimum", () => {
    const result = checkMinimumTargetMet(target, ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15"]);
    expect(result).toEqual({ met: true, current: 4, needed: 3 });
  });

  it("returns met=false when below minimum", () => {
    const result = checkMinimumTargetMet(target, ["2025-05-12"]);
    expect(result).toEqual({ met: false, current: 1, needed: 3 });
  });

  it("returns met=false for empty assignments", () => {
    const result = checkMinimumTargetMet(target, []);
    expect(result).toEqual({ met: false, current: 0, needed: 3 });
  });
});

describe("countInWindow", () => {
  it("filters dates within window bounds", () => {
    const all = ["2025-05-10", "2025-05-12", "2025-05-15", "2025-05-25"];
    const result = countInWindow(all, "2025-05-11", "2025-05-24");
    expect(result).toEqual(["2025-05-12", "2025-05-15"]);
  });

  it("includes dates at window boundaries", () => {
    const all = ["2025-05-11", "2025-05-24"];
    const result = countInWindow(all, "2025-05-11", "2025-05-24");
    expect(result).toEqual(["2025-05-11", "2025-05-24"]);
  });

  it("returns empty for no matches", () => {
    const all = ["2025-05-01", "2025-05-30"];
    const result = countInWindow(all, "2025-05-11", "2025-05-24");
    expect(result).toEqual([]);
  });
});
