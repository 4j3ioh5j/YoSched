import { describe, it, expect } from "vitest";
import { daysBetween, bestSpread, autoSchedule, type ScheduleProvider, type ScheduleShiftType, type AutoScheduleResult } from "../auto-scheduler";

// ─── helpers ───

function makeProvider(id: string, initials: string, overrides: Partial<ScheduleProvider> = {}): ScheduleProvider {
  return {
    id,
    initials,
    ftePercentage: 1,
    eligibleShiftTypeIds: ["st-or", "st-off"],
    availabilityRules: [1, 2, 3, 4, 5].map((d) => ({
      dayOfWeek: d,
      type: "available" as const,
      strength: "rule" as const,
      pattern: "every" as const,
    })),
    isActive: true,
    isAutoScheduled: true,
    specialQualifications: [],
    ...overrides,
  };
}

function makeShift(id: string, code: string, overrides: Partial<ScheduleShiftType> = {}): ScheduleShiftType {
  return {
    id,
    code,
    name: code,
    defaultHours: 8,
    countsTowardFte: true,
    countsOnWeekend: false,
    isLeave: false,
    isOffShift: false,
    isFillShift: false,
    schedulePriority: null,
    weekendPaired: false,
    ignoresWorkingDays: false,
    maxPerDay: null,
    category: "clinical",

    autoSchedulable: true,
    ...overrides,
  };
}

const OFF = makeShift("st-off", "X", { isOffShift: true, countsTowardFte: false, autoSchedulable: false });
const OR = makeShift("st-or", "OR", { schedulePriority: 1, isFillShift: true });

const defaultPrefs = {
  prefer3DayWeekends: false,
  prefer4DayWeekends: false,
  preferSequentialOff: false,
  sequentialOffWeight: 1,
  threeDayWeekendWeight: 2,
  fourDayWeekendWeight: 3,
};

function weekdayDates(startDate: string, count: number): string[] {
  const dates: string[] = [];
  const cur = new Date(startDate + "T12:00:00");
  while (dates.length < count) {
    const dow = cur.getDay();
    if (dow >= 1 && dow <= 5) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      dates.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function runSchedule(overrides: Record<string, unknown> = {}): AutoScheduleResult {
  return autoSchedule({
    dates: weekdayDates("2025-05-12", 5),
    providers: [makeProvider("p1", "AB"), makeProvider("p2", "CD")],
    shiftTypes: [OR, OFF],
    existingAssignments: [],
    payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
    holidays: [],
    desirabilityWeights: [],
    standingCommitments: [],
    providerOverrides: [],
    dayPreferences: [],
    historicalAssignments: [],
    staffingRequirements: [],
    schedulingPreferences: defaultPrefs,
    equityFactors: [],
    followRules: [],
    ...overrides,
  });
}

// ─── daysBetween ───

describe("daysBetween", () => {
  it("returns 0 for the same date", () => {
    expect(daysBetween("2025-05-12", "2025-05-12")).toBe(0);
  });

  it("returns positive for adjacent dates", () => {
    expect(daysBetween("2025-05-12", "2025-05-13")).toBe(1);
  });

  it("is symmetric", () => {
    expect(daysBetween("2025-05-12", "2025-05-20")).toBe(daysBetween("2025-05-20", "2025-05-12"));
  });

  it("handles cross-month", () => {
    expect(daysBetween("2025-05-30", "2025-06-02")).toBe(3);
  });
});

// ─── bestSpread ───

describe("bestSpread", () => {
  const alwaysValid = () => true;

  it("returns all candidates when count >= length", () => {
    const result = bestSpread(["2025-05-12", "2025-05-13"], 5, [], alwaysValid);
    expect(result).toEqual(["2025-05-12", "2025-05-13"]);
  });

  it("picks maximally spread dates", () => {
    const candidates = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
    const result = bestSpread(candidates, 2, [], alwaysValid);
    // Should pick the two endpoints for max gap (4 days)
    expect(result).toEqual(["2025-05-12", "2025-05-16"]);
  });

  it("respects anchors when spreading", () => {
    const candidates = ["2025-05-13", "2025-05-14", "2025-05-15"];
    // Anchor at 2025-05-12, so picking 2025-05-13 would be gap=1 from anchor
    // Picking 2025-05-15 maximizes min gap (3 from anchor)
    const result = bestSpread(candidates, 1, ["2025-05-12"], alwaysValid);
    expect(result).toEqual(["2025-05-15"]);
  });

  it("respects validity filter", () => {
    const candidates = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16"];
    // Block the endpoints
    const isValid = (_picked: string[], next: string) => next !== "2025-05-12" && next !== "2025-05-16";
    const result = bestSpread(candidates, 2, [], isValid);
    expect(result).not.toContain("2025-05-12");
    expect(result).not.toContain("2025-05-16");
    expect(result).toHaveLength(2);
  });

  it("returns empty when no valid combination exists", () => {
    const candidates = ["2025-05-12"];
    const isValid = () => false;
    const result = bestSpread(candidates, 1, [], isValid);
    expect(result).toEqual([]);
  });
});

// ─── autoSchedule ───

describe("autoSchedule", () => {
  it("returns suggestions, warnings, and stats", () => {
    const result = runSchedule();
    expect(result).toHaveProperty("suggestions");
    expect(result).toHaveProperty("warnings");
    expect(result).toHaveProperty("stats");
    expect(result.stats).toHaveProperty("totalSlotsFilled");
    expect(result.stats).toHaveProperty("byStep");
  });

  describe("step 1: standing commitments", () => {
    it("assigns standing commitments on matching days", () => {
      const result = runSchedule({
        standingCommitments: [
          { providerId: "p1", shiftTypeId: "st-or", dayOfWeek: 1, frequency: "weekly" },
        ],
        staffingRequirements: [],
      });
      const mondayCommitments = result.suggestions.filter(
        (s) => s.providerId === "p1" && s.step === "standing" && s.date === "2025-05-12"
      );
      expect(mondayCommitments).toHaveLength(1);
      expect(mondayCommitments[0].code).toBe("OR");
    });

    it("skips standing commitments on holidays", () => {
      const result = runSchedule({
        standingCommitments: [
          { providerId: "p1", shiftTypeId: "st-or", dayOfWeek: 1, frequency: "weekly" },
        ],
        holidays: [{ date: "2025-05-12" }],
      });
      const mondayStanding = result.suggestions.filter(
        (s) => s.providerId === "p1" && s.step === "standing" && s.date === "2025-05-12"
      );
      expect(mondayStanding).toHaveLength(0);
    });

    it("skips standing commitments when temporal eligibility rules block the date", () => {
      const result = runSchedule({
        providers: [
          makeProvider("p1", "AB", {
            shiftEligibilityRules: [
              { shiftTypeId: "st-or", dayOfWeek: 3, type: "eligible", strength: "rule", pattern: "every" },
            ],
          }),
        ],
        standingCommitments: [
          { providerId: "p1", shiftTypeId: "st-or", dayOfWeek: 1, frequency: "weekly" },
        ],
      });
      // p1 has temporal rules for OR: only Wednesday eligible
      // Standing commitment is for Monday — should be skipped
      const mondayStanding = result.suggestions.filter(
        (s) => s.providerId === "p1" && s.step === "standing" && s.date === "2025-05-12"
      );
      expect(mondayStanding).toHaveLength(0);
    });

    it("skips standing commitments for non-autoSchedulable shifts", () => {
      const result = runSchedule({
        standingCommitments: [
          { providerId: "p1", shiftTypeId: "st-off", dayOfWeek: 1, frequency: "weekly" },
        ],
      });
      const standing = result.suggestions.filter((s) => s.step === "standing");
      expect(standing).toHaveLength(0);
    });
  });

  describe("step 2: staffing requirements", () => {
    it("fills staffing requirements evenly across providers", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 2, autoSchedulable: true });
      const providers = [
        makeProvider("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"] }),
        makeProvider("p2", "CD", { eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"] }),
      ];
      const result = runSchedule({
        providers,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "1", minCount: 1 },
          { shiftCode: "ORC", dayKey: "2", minCount: 1 },
          { shiftCode: "ORC", dayKey: "3", minCount: 1 },
          { shiftCode: "ORC", dayKey: "4", minCount: 1 },
          { shiftCode: "ORC", dayKey: "5", minCount: 1 },
        ],
      });
      const orcByProvider = new Map<string, number>();
      for (const s of result.suggestions) {
        if (s.code === "ORC") {
          orcByProvider.set(s.providerId, (orcByProvider.get(s.providerId) || 0) + 1);
        }
      }
      // Should be roughly even — neither provider gets all 5
      for (const [, count] of orcByProvider) {
        expect(count).toBeGreaterThanOrEqual(2);
        expect(count).toBeLessThanOrEqual(3);
      }
    });

    it("warns when no eligible provider is available", () => {
      const RARE = makeShift("st-rare", "RARE", { schedulePriority: 1, autoSchedulable: true });
      const result = runSchedule({
        providers: [makeProvider("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-off"] })],
        shiftTypes: [OR, RARE, OFF],
        staffingRequirements: [{ shiftCode: "RARE", dayKey: "1", minCount: 1 }],
      });
      // No provider is eligible for RARE
      expect(result.warnings.some((w) => w.includes("RARE"))).toBe(true);
    });
  });

  describe("step 3: fill shifts for FTE hours", () => {
    it("fills to target hours", () => {
      const result = runSchedule({
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
      });
      const p1Fill = result.suggestions.filter(
        (s) => s.providerId === "p1" && s.step === "fill"
      );
      // 40 target / 8 hrs per day = 5 fill days needed
      expect(p1Fill.length).toBe(5);
    });

    it("warns when not enough available days to reach target", () => {
      // Only 2 weekday dates available, but target is 40hrs (5 days needed)
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 2),
        providers: [makeProvider("p1", "AB")],
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
      });
      expect(result.warnings.some((w) => w.includes("cannot reach"))).toBe(true);
    });

    it("respects FTE percentage for part-time providers", () => {
      const result = runSchedule({
        providers: [makeProvider("p1", "AB", { ftePercentage: 0.5 })],
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 80 }],
        dates: weekdayDates("2025-05-12", 10),
      });
      const p1Fill = result.suggestions.filter(
        (s) => s.providerId === "p1" && s.step === "fill"
      );
      // 80 * 0.5 = 40 target / 8 hrs per day = 5 fill days
      expect(p1Fill.length).toBe(5);
    });
  });

  describe("step 4: off-shift fill", () => {
    it("fills remaining empty cells with off-shift", () => {
      const result = runSchedule();
      const offSuggestions = result.suggestions.filter((s) => s.step === "off");
      // 2 providers * 5 days = 10 slots, minus fill slots = off slots
      const totalSlots = 2 * 5;
      const fillSlots = result.suggestions.filter((s) => s.step === "fill").length;
      expect(offSuggestions.length).toBe(totalSlots - fillSlots);
    });
  });

  describe("existing assignments", () => {
    it("does not overwrite existing assignments", () => {
      const result = runSchedule({
        existingAssignments: [
          { providerId: "p1", date: "2025-05-12", shiftTypeId: "st-or", code: "OR", isLocked: false },
        ],
      });
      const p1Mon = result.suggestions.filter(
        (s) => s.providerId === "p1" && s.date === "2025-05-12"
      );
      expect(p1Mon).toHaveLength(0);
    });
  });

  describe("follow rules integration", () => {
    it("places recovery day after shift with recovery-only follow rule", () => {
      const CALL = makeShift("st-call", "CALL", { schedulePriority: 1, autoSchedulable: true });
      const providers = [
        makeProvider("p1", "AB", { eligibleShiftTypeIds: ["st-or", "st-call", "st-off"] }),
      ];
      const result = runSchedule({
        providers,
        shiftTypes: [OR, CALL, OFF],
        staffingRequirements: [
          { shiftCode: "CALL", dayKey: "1", minCount: 1 },
        ],
        followRules: [
          { sourceShiftId: "st-call", allowedShiftId: null, allowOffShifts: true, mode: "allow" },
        ],
      });
      const callDay = result.suggestions.find((s) => s.code === "CALL");
      expect(callDay).toBeDefined();
      const nextDay = result.suggestions.find(
        (s) => s.providerId === callDay!.providerId && s.step.includes("recovery")
      );
      expect(nextDay).toBeDefined();
      expect(nextDay!.code).toBe("X");
    });
  });

  describe("weekend-paired shifts", () => {
    it("assigns paired weekend shifts to the same provider", () => {
      const ORC = makeShift("st-orc", "ORC", {
        schedulePriority: 1,
        autoSchedulable: true,
        weekendPaired: true,
        countsOnWeekend: true,
      });
      const providers = [
        makeProvider("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            dayOfWeek: d, type: "available" as const, strength: "rule" as const, pattern: "every" as const,
          })),
        }),
        makeProvider("p2", "CD", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
            dayOfWeek: d, type: "available" as const, strength: "rule" as const, pattern: "every" as const,
          })),
        }),
      ];
      // Include Sat+Sun in dates
      const dates = ["2025-05-17", "2025-05-18"]; // Sat, Sun
      const result = runSchedule({
        dates,
        providers,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "6", minCount: 1 },
          { shiftCode: "ORC", dayKey: "0", minCount: 1 },
        ],
      });
      const orcSuggestions = result.suggestions.filter((s) => s.code === "ORC");
      expect(orcSuggestions).toHaveLength(2);
      expect(orcSuggestions[0].providerId).toBe(orcSuggestions[1].providerId);
    });
  });

  describe("inactive / non-auto providers", () => {
    it("skips inactive providers entirely", () => {
      const result = runSchedule({
        providers: [
          makeProvider("p1", "AB"),
          makeProvider("p2", "CD", { isActive: false }),
        ],
      });
      const p2Suggestions = result.suggestions.filter((s) => s.providerId === "p2");
      expect(p2Suggestions).toHaveLength(0);
    });

    it("skips non-auto-scheduled providers", () => {
      const result = runSchedule({
        providers: [
          makeProvider("p1", "AB"),
          makeProvider("p2", "CD", { isAutoScheduled: false }),
        ],
      });
      const p2Suggestions = result.suggestions.filter((s) => s.providerId === "p2");
      expect(p2Suggestions).toHaveLength(0);
    });
  });

  describe("stats tracking", () => {
    it("counts total slots filled", () => {
      const result = runSchedule();
      expect(result.stats.totalSlotsFilled).toBe(result.suggestions.length);
    });

    it("tracks counts per step", () => {
      const result = runSchedule();
      const sumByStep = Object.values(result.stats.byStep).reduce((a, b) => a + b, 0);
      expect(sumByStep).toBe(result.stats.totalSlotsFilled);
    });
  });

  describe("shift eligibility rules", () => {
    it("restricts provider to eligible days only via temporal rules", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true });
      const providers = [
        makeProvider("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          shiftEligibilityRules: [
            { shiftTypeId: "st-orc", dayOfWeek: 1, type: "eligible", strength: "rule", pattern: "every" },
          ],
        }),
        makeProvider("p2", "CD", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
        }),
      ];
      const dates = weekdayDates("2025-05-12", 5); // Mon-Fri
      const result = runSchedule({
        dates,
        providers,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "1", minCount: 1 },
          { shiftCode: "ORC", dayKey: "2", minCount: 1 },
          { shiftCode: "ORC", dayKey: "3", minCount: 1 },
          { shiftCode: "ORC", dayKey: "4", minCount: 1 },
          { shiftCode: "ORC", dayKey: "5", minCount: 1 },
        ],
      });
      // p1 has temporal rules for ORC: only Monday eligible
      // So p1 should only get ORC on Monday, p2 gets the rest
      const p1Orc = result.suggestions.filter((s) => s.providerId === "p1" && s.code === "ORC");
      const p1OrcDays = p1Orc.map((s) => new Date(s.date + "T12:00:00").getDay());
      for (const dow of p1OrcDays) {
        expect(dow).toBe(1); // Monday only
      }
    });

    it("falls back to static eligibility when no temporal rules exist", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true });
      const providers = [
        makeProvider("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          shiftEligibilityRules: [], // empty = no temporal rules
        }),
      ];
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        providers,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [{ shiftCode: "ORC", dayKey: "1", minCount: 1 }],
      });
      // Should still assign ORC since static eligibility allows it
      const p1Orc = result.suggestions.filter((s) => s.providerId === "p1" && s.code === "ORC");
      expect(p1Orc.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("shift minimum targets", () => {
    it("prioritizes provider below their minimum target", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true });
      const providers = [
        makeProvider("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 3, window: "pay_period" }],
        }),
        makeProvider("p2", "CD", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
        }),
      ];
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        providers,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "1", minCount: 1 },
          { shiftCode: "ORC", dayKey: "2", minCount: 1 },
          { shiftCode: "ORC", dayKey: "3", minCount: 1 },
          { shiftCode: "ORC", dayKey: "4", minCount: 1 },
          { shiftCode: "ORC", dayKey: "5", minCount: 1 },
        ],
      });
      const p1Orc = result.suggestions.filter((s) => s.providerId === "p1" && s.code === "ORC");
      // p1 has min 3/PP so should get at least 3
      expect(p1Orc.length).toBeGreaterThanOrEqual(3);
    });

    it("warns when minimum cannot be met", () => {
      const ORC = makeShift("st-orc", "ORC", { schedulePriority: 1, autoSchedulable: true });
      const providers = [
        makeProvider("p1", "AB", {
          eligibleShiftTypeIds: ["st-or", "st-orc", "st-off"],
          shiftMinimumTargets: [{ shiftTypeId: "st-orc", minCount: 10, window: "pay_period" }],
        }),
      ];
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        providers,
        shiftTypes: [OR, ORC, OFF],
        staffingRequirements: [
          { shiftCode: "ORC", dayKey: "1", minCount: 1 },
          { shiftCode: "ORC", dayKey: "2", minCount: 1 },
          { shiftCode: "ORC", dayKey: "3", minCount: 1 },
          { shiftCode: "ORC", dayKey: "4", minCount: 1 },
          { shiftCode: "ORC", dayKey: "5", minCount: 1 },
        ],
      });
      // 10/PP is impossible with only 5 days — should warn
      expect(result.warnings.some((w) => w.includes("AB") && w.includes("ORC"))).toBe(true);
    });
  });

  describe("maxCount enforcement", () => {
    it("caps assignments at maxCount per window", () => {
      const p = makeProvider("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-or", minCount: 0, maxCount: 2, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        providers: [p],
        staffingRequirements: [
          { shiftCode: "OR", dayKey: "1", minCount: 1 },
          { shiftCode: "OR", dayKey: "2", minCount: 1 },
          { shiftCode: "OR", dayKey: "3", minCount: 1 },
          { shiftCode: "OR", dayKey: "4", minCount: 1 },
          { shiftCode: "OR", dayKey: "5", minCount: 1 },
        ],
      });
      const orCount = result.suggestions.filter((s) => s.providerId === "p1" && s.code === "OR").length;
      expect(orCount).toBeLessThanOrEqual(2);
    });

    it("warns when maxCount is exceeded by existing assignments", () => {
      const p = makeProvider("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-or", minCount: 0, maxCount: 1, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        providers: [p],
        existingAssignments: [
          { providerId: "p1", date: "2025-05-12", shiftTypeId: "st-or", code: "OR", isLocked: false },
          { providerId: "p1", date: "2025-05-13", shiftTypeId: "st-or", code: "OR", isLocked: false },
        ],
      });
      expect(result.warnings.some((w) => w.includes("AB") && w.includes("max") && w.includes("OR"))).toBe(true);
    });

    it("caps standing commitments at maxCount", () => {
      const p = makeProvider("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-or", minCount: 0, maxCount: 2, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        providers: [p],
        standingCommitments: [
          { providerId: "p1", shiftTypeId: "st-or", dayOfWeek: null, frequency: "weekly" },
        ],
      });
      const orCount = result.suggestions.filter((s) => s.providerId === "p1" && s.code === "OR").length;
      expect(orCount).toBeLessThanOrEqual(2);
    });

    it("warns when fill-hours is capped by maxCount", () => {
      const p = makeProvider("p1", "AB", {
        eligibleShiftTypeIds: ["st-or", "st-off"],
        shiftMinimumTargets: [
          { shiftTypeId: "st-or", minCount: 0, maxCount: 2, window: "pay_period" as const },
        ],
      });
      const result = runSchedule({
        dates: weekdayDates("2025-05-12", 5),
        providers: [p],
        payPeriods: [{ startDate: "2025-05-11", endDate: "2025-05-24", targetHours: 40 }],
      });
      expect(result.warnings.some((w) => w.includes("AB") && w.includes("capped by max"))).toBe(true);
    });

    it("caps weekend-paired shifts at maxCount and warns", () => {
      const CALL = makeShift("st-call", "CALL", {
        weekendPaired: true,
        countsOnWeekend: true,
        schedulePriority: 1,
      });
      const p = makeProvider("p1", "AB", {
        eligibleShiftTypeIds: ["st-call", "st-off"],
        availabilityRules: [0, 1, 2, 3, 4, 5, 6].map((d) => ({
          dayOfWeek: d,
          type: "available" as const,
          strength: "rule" as const,
          pattern: "every" as const,
        })),
        shiftMinimumTargets: [
          { shiftTypeId: "st-call", minCount: 0, maxCount: 1, window: "pay_period" as const },
        ],
      });
      // 2025-05-17 is Saturday, 2025-05-18 is Sunday
      const dates = ["2025-05-12", "2025-05-13", "2025-05-14", "2025-05-15", "2025-05-16", "2025-05-17", "2025-05-18"];
      const result = runSchedule({
        dates,
        providers: [p],
        shiftTypes: [CALL, OFF],
        staffingRequirements: [
          { shiftCode: "CALL", dayKey: "6", minCount: 1 },
          { shiftCode: "CALL", dayKey: "0", minCount: 1 },
        ],
      });
      const callCount = result.suggestions.filter((s) => s.providerId === "p1" && s.code === "CALL").length;
      expect(callCount).toBeLessThanOrEqual(1);
      expect(result.warnings.some((w) => w.includes("AB") && w.includes("capped by max"))).toBe(true);
    });
  });
});
