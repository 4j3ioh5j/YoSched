import { describe, it, expect } from "vitest";
import {
  evaluateShiftEligibility,
  getWindowBounds,
  isAtRollingMaximum,
  windowIndexForDate,
  checkMinimumTargetMet,
  countInWindow,
  frequencyModeOf,
  applyFrequencyMode,
  describeFrequency,
  describeWindow,
  type FrequencyMode,
  type ShiftEligibilityRule,
  type ShiftMinTarget,
} from "../shift-eligibility";
import { whenToColumns, legacyPatternToWhen } from "../recurrence";

const PP = [
  { startDate: "2025-05-11", endDate: "2025-05-24" },
  { startDate: "2025-05-25", endDate: "2025-06-07" },
  { startDate: "2025-06-08", endDate: "2025-06-21" },
];

// Builds a WHEN-only ShiftEligibilityRule from legacy-style test inputs (the
// dayOfWeek/pattern/cycle* are bridged to when* via legacyPatternToWhen).
function rule(
  shiftTypeId: string,
  dayOfWeek: number,
  overrides: {
    pattern?: "every" | "pp_week_1" | "pp_week_2" | "every_n";
    cycleLength?: number | null;
    cycleOffset?: number | null;
    type?: "eligible" | "ineligible";
    strength?: "rule" | "preference";
  } = {},
): ShiftEligibilityRule {
  const { pattern = "every", cycleLength, cycleOffset, type = "eligible", strength = "rule" } = overrides;
  return {
    shiftTypeId,
    type,
    strength,
    ...whenToColumns(legacyPatternToWhen({ dayOfWeek, pattern, cycleLength, cycleOffset })),
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

  describe("windowCount (per N windows)", () => {
    // 6 consecutive 14-day pay periods anchored at PP[0] = 2025-05-11.
    const PP6 = [
      { startDate: "2025-05-11", endDate: "2025-05-24" }, // idx 0
      { startDate: "2025-05-25", endDate: "2025-06-07" }, // idx 1
      { startDate: "2025-06-08", endDate: "2025-06-21" }, // idx 2
      { startDate: "2025-06-22", endDate: "2025-07-05" }, // idx 3
      { startDate: "2025-07-06", endDate: "2025-07-19" }, // idx 4
      { startDate: "2025-07-20", endDate: "2025-08-02" }, // idx 5
    ];
    const t = (window: ShiftMinTarget["window"], windowCount: number, windowDays?: number): ShiftMinTarget => ({
      shiftTypeId: "st-or",
      minCount: 1,
      window,
      windowCount,
      windowDays,
    });

    it("windowCount=1 reduces to a single pay period (backwards-compatible)", () => {
      expect(getWindowBounds(t("pay_period", 1), "2025-05-30", PP6)).toEqual({ start: "2025-05-25", end: "2025-06-07" });
    });

    it("pay_period x3 tiles into fixed non-overlapping 3-PP blocks anchored at PP[0]", () => {
      // idx 1 → floor(1/3)=block 0 → PP0..PP2
      expect(getWindowBounds(t("pay_period", 3), "2025-05-30", PP6)).toEqual({ start: "2025-05-11", end: "2025-06-21" });
      // idx 2 → still block 0
      expect(getWindowBounds(t("pay_period", 3), "2025-06-15", PP6)).toEqual({ start: "2025-05-11", end: "2025-06-21" });
      // idx 3 → floor(3/3)=block 1 → PP3..PP5
      expect(getWindowBounds(t("pay_period", 3), "2025-06-25", PP6)).toEqual({ start: "2025-06-22", end: "2025-08-02" });
    });

    it("the same '1 per 3 PP' bucket is shared across all 3 of its pay periods (so the cap is one per block)", () => {
      const b1 = getWindowBounds(t("pay_period", 3), "2025-05-15", PP6);
      const b2 = getWindowBounds(t("pay_period", 3), "2025-06-20", PP6);
      expect(b1).toEqual(b2); // dates in PP0 and PP2 fall in the same block
    });

    it("pay_period xN clamps the block end to the last available PP", () => {
      const PP5 = PP6.slice(0, 5); // PP0..PP4
      // idx 3 → block 1 = PP3..PP5, but PP5 missing → clamp to PP4
      expect(getWindowBounds(t("pay_period", 3), "2025-06-25", PP5)).toEqual({ start: "2025-06-22", end: "2025-07-19" });
    });

    it("week x2 tiles into fixed 2-week blocks anchored at the 1970-01-05 Monday epoch", () => {
      // 2025-05-12 (Mon) is week-index 2888 (even) → block start week 2888
      expect(getWindowBounds(t("week", 2), "2025-05-12", PP6)).toEqual({ start: "2025-05-12", end: "2025-05-25" });
      // next week (2025-05-19, odd index) shares the same block
      expect(getWindowBounds(t("week", 2), "2025-05-19", PP6)).toEqual({ start: "2025-05-12", end: "2025-05-25" });
      // 2025-05-26 (even index 2890) → next block
      expect(getWindowBounds(t("week", 2), "2025-05-26", PP6)).toEqual({ start: "2025-05-26", end: "2025-06-08" });
    });

    it("month x3 tiles into calendar quarters anchored at the year boundary", () => {
      // May 2025 → Apr–Jun block (months align to Jan/Apr/Jul/Oct)
      expect(getWindowBounds(t("month", 3), "2025-05-15", PP6)).toEqual({ start: "2025-04-01", end: "2025-06-30" });
      expect(getWindowBounds(t("month", 3), "2025-04-01", PP6)).toEqual({ start: "2025-04-01", end: "2025-06-30" });
      expect(getWindowBounds(t("month", 3), "2025-07-01", PP6)).toEqual({ start: "2025-07-01", end: "2025-09-30" });
    });

    it("windowCount is ignored for the rolling 'days' window (uses windowDays)", () => {
      expect(getWindowBounds(t("days", 3, 7), "2025-05-12", PP6)).toEqual({ start: "2025-05-12", end: "2025-05-18" });
    });
  });
});

describe("windowIndexForDate", () => {
  const PP6 = [
    { startDate: "2025-05-11", endDate: "2025-05-24" }, // idx 0
    { startDate: "2025-05-25", endDate: "2025-06-07" }, // idx 1
    { startDate: "2025-06-08", endDate: "2025-06-21" }, // idx 2
  ];
  it("pay_period returns the containing PP index, null when outside seeded PPs", () => {
    expect(windowIndexForDate("pay_period", "2025-05-15", PP6)).toBe(0);
    expect(windowIndexForDate("pay_period", "2025-05-30", PP6)).toBe(1);
    expect(windowIndexForDate("pay_period", "2024-01-01", PP6)).toBeNull();
  });
  it("week index is contiguous (consecutive Mondays differ by 1)", () => {
    const a = windowIndexForDate("week", "2025-05-12", PP6)!; // Monday
    const b = windowIndexForDate("week", "2025-05-19", PP6)!; // next Monday
    expect(b - a).toBe(1);
    // any day in the same Mon–Sun week shares the index
    expect(windowIndexForDate("week", "2025-05-18", PP6)).toBe(a); // Sunday of that week
  });
  it("month index is y*12+(m-1) and contiguous across the year boundary", () => {
    expect(windowIndexForDate("month", "2025-05-15", PP6)).toBe(2025 * 12 + 4);
    const dec = windowIndexForDate("month", "2025-12-31", PP6)!;
    const jan = windowIndexForDate("month", "2026-01-01", PP6)!;
    expect(jan - dec).toBe(1);
  });
  it("returns null for the rolling 'days' window", () => {
    expect(windowIndexForDate("days", "2025-05-15", PP6)).toBeNull();
  });
});

describe("isAtRollingMaximum", () => {
  // 6 consecutive 14-day pay periods anchored at PP[0] = 2025-05-11.
  const PP6 = [
    { startDate: "2025-05-11", endDate: "2025-05-24" }, // idx 0
    { startDate: "2025-05-25", endDate: "2025-06-07" }, // idx 1
    { startDate: "2025-06-08", endDate: "2025-06-21" }, // idx 2
    { startDate: "2025-06-22", endDate: "2025-07-05" }, // idx 3
    { startDate: "2025-07-06", endDate: "2025-07-19" }, // idx 4
    { startDate: "2025-07-20", endDate: "2025-08-02" }, // idx 5
  ];
  const m = (
    window: ShiftMinTarget["window"],
    opts: { windowCount?: number; maxCount?: number; windowDays?: number } = {},
  ): ShiftMinTarget => ({
    shiftTypeId: "st-or",
    minCount: 0,
    maxCount: opts.maxCount ?? 1,
    window,
    windowCount: opts.windowCount ?? 1,
    windowDays: opts.windowDays,
  });

  it("returns false when maxCount is null (no cap configured)", () => {
    const t = { ...m("pay_period", { windowCount: 2 }), maxCount: null };
    expect(isAtRollingMaximum(t, "2025-06-15", ["2025-05-30"], PP6)).toBe(false);
  });

  describe("pay_period, windowCount=2, max=1 (RM's '1 per 2 PP')", () => {
    const t = m("pay_period", { windowCount: 2, maxCount: 1 });
    it("BLOCKS a placement in the PP adjacent to an existing one (the boundary-straddle the fixed block missed)", () => {
      // existing in idx1 (2025-05-30), candidate in idx2 (2025-06-15): a 2-PP
      // span [idx1,idx2] holds the existing one → blocked. Fixed tiling put these
      // in different blocks ([0,1] vs [2,3]) and wrongly allowed both.
      expect(isAtRollingMaximum(t, "2025-06-15", ["2025-05-30"], PP6)).toBe(true);
    });
    it("ALLOWS a placement two pay periods away (respaced)", () => {
      // existing idx1 (2025-05-30), candidate idx3 (2025-06-25): no 2-PP span
      // contains both → allowed.
      expect(isAtRollingMaximum(t, "2025-06-25", ["2025-05-30"], PP6)).toBe(false);
    });
    it("ALLOWS placement when there is no prior assignment", () => {
      expect(isAtRollingMaximum(t, "2025-06-15", [], PP6)).toBe(false);
    });
  });

  describe("windowCount=1 reduces exactly to a single window", () => {
    const t = m("pay_period", { windowCount: 1, maxCount: 1 });
    it("blocks a second placement in the SAME pay period", () => {
      expect(isAtRollingMaximum(t, "2025-05-20", ["2025-05-15"], PP6)).toBe(true);
    });
    it("allows a placement in the NEXT pay period (no rolling spillover at N=1)", () => {
      expect(isAtRollingMaximum(t, "2025-05-30", ["2025-05-15"], PP6)).toBe(false);
    });
  });

  describe("days window is a true sliding day-range (fixes #194 forward-only bug)", () => {
    const t = m("days", { maxCount: 1, windowDays: 14 });
    it("BLOCKS when a prior placement is within windowDays BEFORE the candidate", () => {
      // 2025-05-20 is 5 days before the candidate — the old forward-only check
      // ([candidate .. candidate+13]) missed this; the sliding window catches it.
      expect(isAtRollingMaximum(t, "2025-05-25", ["2025-05-20"], PP6)).toBe(true);
    });
    it("BLOCKS when a prior placement is within windowDays AFTER the candidate", () => {
      expect(isAtRollingMaximum(t, "2025-05-25", ["2025-05-30"], PP6)).toBe(true);
    });
    it("ALLOWS when the nearest placement is windowDays or more away", () => {
      expect(isAtRollingMaximum(t, "2025-05-25", ["2025-06-09"], PP6)).toBe(false); // 15 days after
      expect(isAtRollingMaximum(t, "2025-05-25", ["2025-05-10"], PP6)).toBe(false); // 15 days before
    });
    it("returns false when windowDays is missing", () => {
      expect(isAtRollingMaximum(m("days", { maxCount: 1 }), "2025-05-25", ["2025-05-26"], PP6)).toBe(false);
    });
  });

  describe("week, windowCount=2, max=1", () => {
    const t = m("week", { windowCount: 2, maxCount: 1 });
    it("blocks placements one week apart (within a 2-week span)", () => {
      expect(isAtRollingMaximum(t, "2025-05-19", ["2025-05-12"], PP6)).toBe(true);
    });
    it("allows placements two weeks apart (non-overlapping 2-week spans)", () => {
      expect(isAtRollingMaximum(t, "2025-05-26", ["2025-05-12"], PP6)).toBe(false);
    });
  });

  describe("month, windowCount=3, max=1 (quarter)", () => {
    const t = m("month", { windowCount: 3, maxCount: 1 });
    it("blocks placements within 3 months", () => {
      expect(isAtRollingMaximum(t, "2025-06-15", ["2025-05-15"], PP6)).toBe(true);
    });
    it("allows placements 3+ months apart", () => {
      expect(isAtRollingMaximum(t, "2025-09-15", ["2025-05-15"], PP6)).toBe(false);
    });
  });

  describe("maxCount=2 permits a burst then caps", () => {
    const t = m("pay_period", { windowCount: 2, maxCount: 2 });
    it("allows a second within the rolling span", () => {
      expect(isAtRollingMaximum(t, "2025-06-15", ["2025-05-30"], PP6)).toBe(false);
    });
    it("blocks a third within the rolling span", () => {
      expect(isAtRollingMaximum(t, "2025-06-15", ["2025-05-26", "2025-05-30"], PP6)).toBe(true);
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

describe("frequency mode helpers", () => {
  const mk = (minCount: number, maxCount: number | null): ShiftMinTarget => ({
    shiftTypeId: "s", minCount, maxCount, window: "pay_period", windowCount: 1,
  });

  it("frequencyModeOf derives the mode from min/max", () => {
    expect(frequencyModeOf(mk(2, null))).toBe("atLeast");
    expect(frequencyModeOf(mk(0, 3))).toBe("atMost");
    expect(frequencyModeOf(mk(2, 2))).toBe("exactly");
    expect(frequencyModeOf(mk(1, 3))).toBe("between");
  });

  it("applyFrequencyMode is the inverse mapping", () => {
    expect(applyFrequencyMode("atLeast", 2, 0)).toEqual({ minCount: 2, maxCount: null });
    expect(applyFrequencyMode("atMost", 0, 3)).toEqual({ minCount: 0, maxCount: 3 });
    expect(applyFrequencyMode("exactly", 2, 9)).toEqual({ minCount: 2, maxCount: 2 });
    expect(applyFrequencyMode("between", 1, 3)).toEqual({ minCount: 1, maxCount: 3 });
  });

  it("round-trips: applyFrequencyMode(frequencyModeOf(t), min, max) preserves t", () => {
    const cases: ShiftMinTarget[] = [mk(2, null), mk(0, 3), mk(2, 2), mk(1, 3)];
    for (const t of cases) {
      const mode: FrequencyMode = frequencyModeOf(t);
      expect(applyFrequencyMode(mode, t.minCount, t.maxCount ?? 0)).toEqual({
        minCount: t.minCount,
        maxCount: t.maxCount ?? null,
      });
    }
  });

  it("describeWindow handles windowCount and rolling days, singular/plural", () => {
    expect(describeWindow({ window: "pay_period", windowCount: 1 })).toBe("pay period");
    expect(describeWindow({ window: "pay_period", windowCount: 3 })).toBe("3 pay periods");
    expect(describeWindow({ window: "month", windowCount: 1 })).toBe("month");
    expect(describeWindow({ window: "days", windowDays: 1 })).toBe("rolling 1 day");
    expect(describeWindow({ window: "days", windowDays: 14 })).toBe("rolling 14 days");
  });

  it("describeFrequency renders each mode", () => {
    expect(describeFrequency(mk(2, null))).toBe("At least 2 per pay period");
    expect(describeFrequency({ ...mk(0, 3), windowCount: 3 })).toBe("At most 3 per 3 pay periods");
    expect(describeFrequency({ ...mk(1, 1), window: "month" })).toBe("Exactly 1 per month");
    expect(describeFrequency({ ...mk(1, 3), window: "days", windowDays: 7 })).toBe("Between 1 and 3 per rolling 7 days");
  });

  it("renders existing invalid rows gracefully (CR #983)", () => {
    // min > max → ordered low-to-high, not "Between 3 and 1".
    expect(describeFrequency(mk(3, 1))).toBe("Between 1 and 3 per pay period");
    // unknown window string → falls back to the raw value, no throw.
    expect(describeWindow({ window: "quarter" as ShiftMinTarget["window"], windowCount: 2 })).toBe("2 quarters");
    expect(describeFrequency({ ...mk(2, null), window: "quarter" as ShiftMinTarget["window"] })).toBe("At least 2 per quarter");
  });
});
