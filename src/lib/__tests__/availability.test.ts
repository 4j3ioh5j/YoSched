import { describe, it, expect } from "vitest";
import {
  evaluateAvailability,
  isBaseWorkDay,
  getBaseWorkDays,
  type AvailabilityRule,
} from "../availability";

const PP = [
  { startDate: "2025-05-11", endDate: "2025-05-24" },
  { startDate: "2025-05-25", endDate: "2025-06-07" },
  { startDate: "2025-06-08", endDate: "2025-06-21" },
  { startDate: "2025-06-22", endDate: "2025-07-05" },
];

function rule(overrides: Partial<AvailabilityRule> & { dayOfWeek: number }): AvailabilityRule {
  return {
    type: "available",
    strength: "rule",
    pattern: "every",
    ...overrides,
  };
}

describe("evaluateAvailability", () => {
  it("returns unavailable with weight 0 when no rules match day of week", () => {
    const result = evaluateAvailability([], "2025-05-12", PP);
    expect(result).toEqual({ available: false, weight: 0 });
  });

  it("hard available rule wins", () => {
    const rules = [rule({ dayOfWeek: 1 })]; // Monday
    // 2025-05-12 is a Monday
    const result = evaluateAvailability(rules, "2025-05-12", PP);
    expect(result.available).toBe(true);
    expect(result.weight).toBeGreaterThanOrEqual(10);
  });

  it("hard unavailable rule wins over preferences", () => {
    const rules = [
      rule({ dayOfWeek: 1, type: "unavailable", strength: "rule" }),
      rule({ dayOfWeek: 1, type: "available", strength: "preference" }),
    ];
    const result = evaluateAvailability(rules, "2025-05-12", PP);
    expect(result.available).toBe(false);
    expect(result.weight).toBe(-10);
  });

  it("hard unavailable beats hard available", () => {
    const rules = [
      rule({ dayOfWeek: 1, type: "available", strength: "rule" }),
      rule({ dayOfWeek: 1, type: "unavailable", strength: "rule" }),
    ];
    const result = evaluateAvailability(rules, "2025-05-12", PP);
    expect(result.available).toBe(false);
    expect(result.weight).toBe(-10);
  });

  it("preferences accumulate weight", () => {
    const rules = [
      rule({ dayOfWeek: 1, type: "available", strength: "preference" }),
      rule({ dayOfWeek: 1, type: "available", strength: "preference" }),
    ];
    const result = evaluateAvailability(rules, "2025-05-12", PP);
    expect(result.available).toBe(true);
    expect(result.weight).toBe(2);
  });

  it("negative preference weight means unavailable", () => {
    const rules = [
      rule({ dayOfWeek: 1, type: "unavailable", strength: "preference" }),
    ];
    const result = evaluateAvailability(rules, "2025-05-12", PP);
    expect(result.available).toBe(false);
    expect(result.weight).toBe(-1);
  });

  describe("patterns", () => {
    it("pp_week_1 matches only first week of pay period", () => {
      const rules = [rule({ dayOfWeek: 1, pattern: "pp_week_1" })];
      // 2025-05-12 = Monday, week 1 of PP 2025-05-11..2025-05-24
      const w1 = evaluateAvailability(rules, "2025-05-12", PP);
      expect(w1.available).toBe(true);
      // 2025-05-19 = Monday, week 2 of same PP
      const w2 = evaluateAvailability(rules, "2025-05-19", PP);
      expect(w2.available).toBe(false);
    });

    it("pp_week_2 matches only second week of pay period", () => {
      const rules = [rule({ dayOfWeek: 1, pattern: "pp_week_2" })];
      const w1 = evaluateAvailability(rules, "2025-05-12", PP);
      expect(w1.available).toBe(false);
      const w2 = evaluateAvailability(rules, "2025-05-19", PP);
      expect(w2.available).toBe(true);
    });

    it("every_n with cycleLength=2 matches every other PP week", () => {
      const rules = [rule({ dayOfWeek: 1, pattern: "every_n", cycleLength: 2, cycleOffset: 0 })];
      // PP index 0, week 1 → occurrence 0 → 0%2=0 → match
      const r0 = evaluateAvailability(rules, "2025-05-12", PP);
      expect(r0.available).toBe(true);
      // PP index 0, week 2 → occurrence 1 → 1%2=1 → no match
      const r1 = evaluateAvailability(rules, "2025-05-19", PP);
      expect(r1.available).toBe(false);
      // PP index 1, week 1 → occurrence 2 → 2%2=0 → match
      const r2 = evaluateAvailability(rules, "2025-05-26", PP);
      expect(r2.available).toBe(true);
    });

    it("every_n with offset=1 shifts the cycle", () => {
      const rules = [rule({ dayOfWeek: 1, pattern: "every_n", cycleLength: 2, cycleOffset: 1 })];
      // occurrence 0 → 0%2=0 ≠ 1 → no match
      const r0 = evaluateAvailability(rules, "2025-05-12", PP);
      expect(r0.available).toBe(false);
      // occurrence 1 → 1%2=1 → match
      const r1 = evaluateAvailability(rules, "2025-05-19", PP);
      expect(r1.available).toBe(true);
    });
  });

  describe("conditional rules", () => {
    it("working condition skips when partner not assigned", () => {
      const rules = [
        rule({
          dayOfWeek: 1,
          conditionStaffId: "partner1",
          conditionType: "working",
        }),
      ];
      const isAssigned = (_id: string, _date: string) => false;
      const result = evaluateAvailability(rules, "2025-05-12", PP, isAssigned);
      // condition not met → rule skipped → no rules apply → unavailable
      expect(result.available).toBe(false);
    });

    it("working condition applies when partner is assigned", () => {
      const rules = [
        rule({
          dayOfWeek: 1,
          conditionStaffId: "partner1",
          conditionType: "working",
        }),
      ];
      const isAssigned = (_id: string, _date: string) => true;
      const result = evaluateAvailability(rules, "2025-05-12", PP, isAssigned);
      expect(result.available).toBe(true);
    });

    it("not_working condition applies when partner not assigned", () => {
      const rules = [
        rule({
          dayOfWeek: 1,
          conditionStaffId: "partner1",
          conditionType: "not_working",
        }),
      ];
      const isAssigned = (_id: string, _date: string) => false;
      const result = evaluateAvailability(rules, "2025-05-12", PP, isAssigned);
      expect(result.available).toBe(true);
    });
  });
});

describe("isBaseWorkDay", () => {
  const weekdayRules = [1, 2, 3, 4, 5].map((d) => rule({ dayOfWeek: d }));

  it("returns true for Monday-Friday with standard rules", () => {
    for (const d of [1, 2, 3, 4, 5]) {
      expect(isBaseWorkDay(weekdayRules, d)).toBe(true);
    }
  });

  it("returns false for Saturday and Sunday", () => {
    expect(isBaseWorkDay(weekdayRules, 0)).toBe(false);
    expect(isBaseWorkDay(weekdayRules, 6)).toBe(false);
  });

  it("ignores preference-strength rules", () => {
    const rules = [rule({ dayOfWeek: 1, strength: "preference" })];
    expect(isBaseWorkDay(rules, 1)).toBe(false);
  });

  it("ignores conditional rules", () => {
    const rules = [rule({ dayOfWeek: 1, conditionStaffId: "p1" })];
    expect(isBaseWorkDay(rules, 1)).toBe(false);
  });

  it("ignores non-every patterns", () => {
    const rules = [rule({ dayOfWeek: 1, pattern: "pp_week_1" })];
    expect(isBaseWorkDay(rules, 1)).toBe(false);
  });
});

describe("getBaseWorkDays", () => {
  it("returns empty array for no rules", () => {
    expect(getBaseWorkDays([])).toEqual([]);
  });

  it("returns weekday DOW numbers for standard M-F rules", () => {
    const rules = [1, 2, 3, 4, 5].map((d) => rule({ dayOfWeek: d }));
    expect(getBaseWorkDays(rules)).toEqual([1, 2, 3, 4, 5]);
  });

  it("returns sorted DOW numbers", () => {
    const rules = [5, 1, 3].map((d) => rule({ dayOfWeek: d }));
    expect(getBaseWorkDays(rules)).toEqual([1, 3, 5]);
  });
});

// Slice 7: isBaseWorkDay/getBaseWorkDays read the WHEN model (ruleToWhen), so
// when the explicit when* columns are present they are authoritative over the
// inert legacy dayOfWeek/pattern. These rows mimic post-backfill data where
// whenKind is set and the legacy columns may disagree (lossy back-projection).
describe("isBaseWorkDay / getBaseWorkDays read the WHEN model", () => {
  it("uses whenDays coverage, not the legacy dayOfWeek, for a multi-day every rule", () => {
    // Legacy dayOfWeek=1, but the authoritative WHEN says Tue+Wed every week.
    const rules = [
      rule({ dayOfWeek: 1, whenKind: "every", whenDays: [2, 3] }),
    ];
    expect(isBaseWorkDay(rules, 1)).toBe(false); // legacy day ignored
    expect(isBaseWorkDay(rules, 2)).toBe(true);
    expect(isBaseWorkDay(rules, 3)).toBe(true);
    expect(getBaseWorkDays(rules)).toEqual([2, 3]);
  });

  it("excludes a non-every WHEN kind even when legacy pattern is 'every'", () => {
    // Legacy pattern says every; WHEN says only pay-period week 1 → not a base day.
    const rules = [
      rule({ dayOfWeek: 1, pattern: "every", whenKind: "ppWeek", whenDays: [1], whenPpWeek: 1 }),
    ];
    expect(isBaseWorkDay(rules, 1)).toBe(false);
  });

  it("falls back to the legacy bridge when whenKind is null", () => {
    const rules = [rule({ dayOfWeek: 4, pattern: "every" })]; // whenKind unset
    expect(isBaseWorkDay(rules, 4)).toBe(true);
    expect(isBaseWorkDay(rules, 1)).toBe(false);
  });
});
